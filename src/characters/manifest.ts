// Character manifest validation and normalisation (schemaVersion 1).
// The engine never trusts a manifest: every field is checked, URLs are resolved against the
// manifest's own URL, and nothing in here knows about any particular character.

import type { CharacterManifest, CreditLink, LineEntry, Role } from '../types';
import { safeHttpUrl } from '../util/url';

export interface Clip {
  id: string;
  role: string | null;
  loop: boolean;
  load: 'initial' | 'lazy';
  w: number;
  h: number;
  feet: [number, number];
  hit: [number, number, number, number];
  frameMs: number[];
  /** Cumulative end time of each frame. */
  ends: number[];
  durationMs: number;
  mirror: boolean;
  atlas: { url: string; columns: number; rows: number; frames: number };
}

export interface Character {
  id: string;
  name: string;
  licence: { name: string; url: string | null };
  assetRevision: string;
  manifestUrl: string;
  height: number;
  minHeight: number;
  walkSpeed: number;
  poster: { clip: string; frame: number };
  bubbleAnchor: [number, number];
  credit: CreditLink | null | undefined;
  lines: Map<string, LineEntry[]>;
  clips: Map<string, Clip>;
  /** role -> clip id, first clip in document order wins. */
  roles: Map<string, string>;
  /** Clip used for a walk direction; `mirrored` when it is drawn flipped. */
  walk: { left: { clip: string; mirrored: boolean } | null; right: { clip: string; mirrored: boolean } | null };
  warnings: string[];
}

export class ManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid character manifest: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`);
    this.name = 'ManifestError';
  }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CLIPS = 64;
const MAX_FRAMES = 1024;
const MAX_POOL = 2000;
const MAX_LINE = 500;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const safeKey = (k: string) => !RESERVED.has(k);

export function parseCharacter(input: unknown, manifestUrl: string): Character {
  const errs: string[] = [];
  const warnings: string[] = [];
  const bad = (path: string, msg: string) => errs.push(`${path}: ${msg}`);

  if (!isObj(input)) throw new ManifestError(['manifest: expected a JSON object']);
  const m = input as Partial<CharacterManifest> & Record<string, unknown>;

  if (m.schemaVersion !== 1) bad('schemaVersion', `unsupported version ${JSON.stringify(m.schemaVersion)} (expected 1)`);
  if (typeof m.id !== 'string' || !ID_RE.test(m.id) || !safeKey(m.id)) bad('id', 'expected 1-64 letters, digits, ".", "_" or "-"');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) bad('name', 'expected a non-empty string of at most 60 characters');
  if (typeof m.assetRevision !== 'string' || !m.assetRevision || m.assetRevision.length > 64) bad('assetRevision', 'expected a non-empty string');

  let licence: Character['licence'] = { name: '', url: null };
  if (typeof m.licence === 'string' && m.licence.trim()) licence = { name: m.licence.slice(0, 120), url: null };
  else if (isObj(m.licence) && typeof m.licence.name === 'string' && m.licence.name.trim()) {
    const url = m.licence.url === undefined ? null : safeHttpUrl(m.licence.url, manifestUrl);
    if (m.licence.url !== undefined && !url) bad('licence.url', 'expected an http(s) URL');
    licence = { name: m.licence.name.slice(0, 120), url };
  } else bad('licence', 'expected a licence name or { name, url }');

  // ---- clips
  const clips = new Map<string, Clip>();
  const roles = new Map<string, string>();
  if (!isObj(m.clips)) bad('clips', 'expected an object of clips');
  else {
    const ids = Object.keys(m.clips);
    if (ids.length === 0) bad('clips', 'at least one clip is required');
    if (ids.length > MAX_CLIPS) bad('clips', `at most ${MAX_CLIPS} clips`);
    for (const id of ids.slice(0, MAX_CLIPS)) {
      const p = `clips.${id}`;
      if (!ID_RE.test(id) || !safeKey(id)) { bad(p, 'invalid clip id'); continue; }
      const c = (m.clips as Record<string, unknown>)[id];
      if (!isObj(c)) { bad(p, 'expected an object'); continue; }
      const n0 = errs.length;

      const role = c.role === undefined ? null : c.role;
      if (role !== null && (typeof role !== 'string' || !/^[a-z][a-z0-9.-]{0,40}$/.test(role))) bad(`${p}.role`, 'expected a role name such as "idle" or "walk.left"');
      if (c.loop !== undefined && typeof c.loop !== 'boolean') bad(`${p}.loop`, 'expected true or false');
      if (c.load !== undefined && c.load !== 'initial' && c.load !== 'lazy') bad(`${p}.load`, 'expected "initial" or "lazy"');
      if (c.mirror !== undefined && typeof c.mirror !== 'boolean') bad(`${p}.mirror`, 'expected true or false');

      const size = c.size;
      const sizeOk = Array.isArray(size) && size.length === 2 && isPosInt(size[0]) && isPosInt(size[1]) && size[0] <= 4096 && size[1] <= 4096;
      if (!sizeOk) bad(`${p}.size`, 'expected [width, height] in whole pixels (1-4096)');
      const [w, h] = sizeOk ? (size as [number, number]) : [1, 1];

      let feet: [number, number] = [0.5, 1];
      const f = isObj(c.anchor) ? c.anchor.feet : undefined;
      if (c.anchor !== undefined && !isObj(c.anchor)) bad(`${p}.anchor`, 'expected an object');
      if (f !== undefined) {
        if (Array.isArray(f) && f.length === 2 && isNum(f[0]) && isNum(f[1]) && f[0] >= 0 && f[0] <= 1 && f[1] >= 0 && f[1] <= 1) feet = [f[0], f[1]];
        else bad(`${p}.anchor.feet`, 'expected [x, y] between 0 and 1');
      }

      let hit: [number, number, number, number] = [0, 0, w, h];
      if (c.hit !== undefined) {
        const r = c.hit;
        // x/y may be slightly negative: extremities can leave the frame box. Clamped at hit-test time.
        if (Array.isArray(r) && r.length === 4 && r.every(isNum) && r[2] > 0 && r[3] > 0) hit = [r[0], r[1], r[2], r[3]];
        else bad(`${p}.hit`, 'expected [x, y, width, height] with positive width and height');
      }

      const fm = c.frameMs;
      if (!Array.isArray(fm) || fm.length === 0 || fm.length > MAX_FRAMES || !fm.every((d) => isNum(d) && d > 0 && d <= 60_000)) {
        bad(`${p}.frameMs`, `expected 1-${MAX_FRAMES} positive frame durations in milliseconds`);
      }
      const frameMs = Array.isArray(fm) ? (fm as number[]) : [];
      const ends: number[] = [];
      let acc = 0;
      for (const d of frameMs) ends.push((acc += d));
      if (c.durationMs !== undefined && (!isNum(c.durationMs) || Math.abs(c.durationMs - acc) > frameMs.length)) {
        bad(`${p}.durationMs`, `does not match the sum of frameMs (${acc})`);
      }

      let atlas: Clip['atlas'] | null = null;
      if (!Array.isArray(c.sources) || c.sources.length === 0) bad(`${p}.sources`, 'expected at least one source');
      else {
        c.sources.forEach((s, i) => {
          const sp = `${p}.sources[${i}]`;
          if (!isObj(s) || typeof s.type !== 'string') return bad(sp, 'expected { type, url }');
          if (s.type !== 'atlas') return; // unknown source types are ignored for forward compatibility
          if (atlas) return;
          const g = s.grid;
          if (!isObj(g) || !isPosInt(g.columns) || !isPosInt(g.rows) || !isPosInt(g.frames)) return bad(`${sp}.grid`, 'expected positive whole columns, rows and frames');
          if ((g.columns as number) * (g.rows as number) < (g.frames as number)) return bad(`${sp}.grid`, 'frames do not fit in columns x rows');
          if ((g.columns as number) * w > 16384 || (g.rows as number) * h > 16384) return bad(`${sp}.grid`, 'atlas larger than 16384 px');
          if (g.frames !== frameMs.length) return bad(`${sp}.grid.frames`, `is ${g.frames} but frameMs has ${frameMs.length} entries`);
          const url = safeHttpUrl(s.url, manifestUrl);
          if (!url) return bad(`${sp}.url`, 'expected a relative or http(s) URL');
          atlas = { url, columns: g.columns as number, rows: g.rows as number, frames: g.frames as number };
        });
        if (!atlas && errs.length === n0) bad(`${p}.sources`, 'no supported source (type "atlas")');
      }

      if (errs.length > n0 || !atlas) continue;
      const clip: Clip = {
        id,
        role: role as string | null,
        loop: c.loop === true,
        load: c.load === 'initial' ? 'initial' : 'lazy',
        w,
        h,
        feet,
        hit,
        frameMs,
        ends,
        durationMs: acc,
        mirror: c.mirror === true,
        atlas,
      };
      clips.set(id, clip);
      if (clip.role) {
        if (roles.has(clip.role)) warnings.push(`clips.${id}: role "${clip.role}" is already used by "${roles.get(clip.role)}"; the first one wins`);
        else roles.set(clip.role, id);
      }
    }
  }

  if (clips.size && !roles.has('idle' satisfies Role)) bad('clips', 'a clip with role "idle" is required');

  // ---- walk directions (with explicit mirror permission only)
  const dir = (own: Role, other: Role) => {
    const id = roles.get(own);
    if (id) return { clip: id, mirrored: false };
    const o = roles.get(other);
    if (o && clips.get(o)!.mirror) return { clip: o, mirrored: true };
    return null;
  };
  const walk = { left: dir('walk.left', 'walk.right'), right: dir('walk.right', 'walk.left') };
  if (clips.size && !walk.left && !walk.right) warnings.push('no walk clip: the character will appear in place and never walk');

  // ---- display
  const d = isObj(m.display) ? m.display : {};
  if (m.display !== undefined && !isObj(m.display)) bad('display', 'expected an object');
  const num = (v: unknown, path: string, min: number, max: number, dflt: number) => {
    if (v === undefined) return dflt;
    if (!isNum(v) || v < min || v > max) { bad(path, `expected a number between ${min} and ${max}`); return dflt; }
    return v;
  };
  const height = num(d.height, 'display.height', 40, 1000, 200);
  const minHeight = Math.min(height, num(d.minHeight, 'display.minHeight', 24, 1000, Math.round(height * 0.6)));
  const walkSpeed = num(d.walkSpeed, 'display.walkSpeed', 5, 2000, Math.round(height * 0.3));

  // ---- poster
  const idleId = roles.get('idle') ?? '';
  let poster = { clip: idleId, frame: 0 };
  if (m.poster !== undefined) {
    const pc = isObj(m.poster) ? m.poster : null;
    const pClip = pc && typeof pc.clip === 'string' ? clips.get(pc.clip) : undefined;
    const pFrame = pc?.frame === undefined ? 0 : pc.frame;
    if (!pClip) bad('poster.clip', 'expected the id of a clip in this manifest');
    else if (!Number.isInteger(pFrame) || (pFrame as number) < 0 || (pFrame as number) >= pClip.frameMs.length) bad('poster.frame', 'frame index out of range');
    else poster = { clip: pClip.id, frame: pFrame as number };
  }

  // ---- bubble anchor
  let bubbleAnchor: [number, number] = [0.5, 0.05];
  if (m.bubble !== undefined) {
    const a = isObj(m.bubble) ? m.bubble.anchor : undefined;
    if (Array.isArray(a) && a.length === 2 && isNum(a[0]) && isNum(a[1]) && a[0] >= 0 && a[0] <= 1 && a[1] >= 0 && a[1] <= 1) bubbleAnchor = [a[0], a[1]];
    else bad('bubble.anchor', 'expected [x, y] between 0 and 1');
  }

  // ---- menu credit: undefined = engine default, null = no credit link
  let credit: CreditLink | null | undefined;
  if (isObj(m.menu) && m.menu.credit !== undefined) {
    const cr = m.menu.credit;
    if (cr === null) credit = null;
    else {
      credit = parseCredit(cr, manifestUrl) ?? undefined;
      if (!credit) bad('menu.credit', 'expected { label, url } with an http(s) URL, or null');
    }
  }

  // ---- lines
  const lines = parseLines(m.lines, 'lines', bad);

  if (errs.length) throw new ManifestError(errs);
  return {
    id: m.id as string,
    name: (m.name as string).trim(),
    licence,
    assetRevision: m.assetRevision as string,
    manifestUrl,
    height,
    minHeight,
    walkSpeed,
    poster,
    bubbleAnchor,
    credit,
    lines,
    clips,
    roles,
    walk,
    warnings,
  };
}

export function parseCredit(v: unknown, base: string): CreditLink | null {
  if (!isObj(v) || typeof v.label !== 'string' || !v.label.trim() || v.label.length > 60) return null;
  const url = safeHttpUrl(v.url, base);
  return url ? { label: v.label.trim(), url } : null;
}

/** Validates line pools. Returns a Map so pool names can never touch Object.prototype. */
export function parseLines(v: unknown, path: string, bad: (path: string, msg: string) => void): Map<string, LineEntry[]> {
  const out = new Map<string, LineEntry[]>();
  if (v === undefined) return out;
  if (!isObj(v)) { bad(path, 'expected an object of line pools'); return out; }
  for (const pool of Object.keys(v)) {
    const p = `${path}.${pool}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(pool) || !safeKey(pool)) { bad(p, 'invalid pool name'); continue; }
    const arr = v[pool];
    if (!Array.isArray(arr) || arr.length > MAX_POOL) { bad(p, `expected an array of at most ${MAX_POOL} lines`); continue; }
    const entries: LineEntry[] = [];
    arr.forEach((e, i) => {
      if (typeof e === 'string' && e.trim() && e.length <= MAX_LINE) entries.push(e);
      else if (isObj(e) && typeof e.text === 'string' && e.text.trim() && e.text.length <= MAX_LINE && (e.weight === undefined || (isNum(e.weight) && e.weight >= 0 && e.weight <= 1000))) {
        entries.push(e.weight === undefined ? { text: e.text } : { text: e.text, weight: e.weight });
      } else bad(`${p}[${i}]`, `expected a line of 1-${MAX_LINE} characters or { text, weight }`);
    });
    out.set(pool, entries);
  }
  return out;
}
