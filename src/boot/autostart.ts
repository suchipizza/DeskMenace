// Script-tag boot: reads configuration from the page and starts the character.
//
//   <script defer src="gary.js"
//           data-character="/characters/mine/character.json"   (optional manifest URL)
//           data-config="/gary.json"                           (optional JSON config URL)
//           data-preset="404"                                   (optional character preset)
//           data-autostart="false"></script>                   (optional: wait for Gary.init())
//   <script type="application/json" data-gary-config>{ ... }</script>   (optional inline JSON)

import type { GaryAPI } from '../types';
import { createGary, type CreateOptions } from '../api';
import { ConfigError, defaults, mergeConfig, parseJsonConfig } from './config';
import { safeHttpUrl } from '../util/url';

export function scriptElement(): HTMLScriptElement | null {
  const cur = document.currentScript;
  if (cur instanceof HTMLScriptElement) return cur;
  const all = document.querySelectorAll<HTMLScriptElement>('script[src]');
  for (let i = all.length - 1; i >= 0; i--) if (/gary(\.core)?(\.min)?\.js(\?|#|$)/.test(all[i].src)) return all[i];
  return null;
}

async function readLayers(script: HTMLScriptElement | null, opts: CreateOptions): Promise<void> {
  let cfg = defaults();
  const apply = (layer: unknown, source: string) => {
    const r = mergeConfig(cfg, layer, source);
    for (const w of r.warnings) console.warn(`[gary.js] ${w}`);
    cfg = r.config;
  };
  try {
    const inline = document.querySelector<HTMLScriptElement>('script[type="application/json"][data-gary-config]');
    if (inline) apply(parseJsonConfig(inline.textContent ?? '', 'inline config'), 'inline config');
    const cfgUrl = script?.dataset.config ? safeHttpUrl(script.dataset.config, document.baseURI) : null;
    if (script?.dataset.config && !cfgUrl) throw new ConfigError('data-config must be a URL');
    if (cfgUrl) {
      const res = await fetch(cfgUrl, { credentials: 'omit' });
      if (!res.ok) throw new ConfigError(`data-config: HTTP ${res.status} from ${cfgUrl}`);
      apply(parseJsonConfig(await res.text(), 'data-config'), 'data-config');
    }
    if (script?.dataset.character) apply({ character: script.dataset.character }, 'data-character');
    if (script?.dataset.preset) apply({ preset: script.dataset.preset }, 'data-preset');
  } catch (e) {
    console.warn(`[gary.js] ${(e as Error).message}`);
    cfg = { ...cfg, enabled: false };
  }
  opts.base = cfg;
}

/** Creates the page-wide API and starts it unless data-autostart="false". */
export function boot(defaultCharacter: (script: HTMLScriptElement | null) => string | null): GaryAPI {
  const script = scriptElement();
  const opts: CreateOptions = {};
  opts.defaultCharacter = defaultCharacter(script);
  opts.baseReady = new Promise<void>((resolve) => {
    const go = () => void readLayers(script, opts).then(resolve);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  });
  const api = createGary(opts);
  if (script?.dataset.autostart !== 'false') void api.init();
  return api;
}
