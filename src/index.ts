// ES module entry. Core only: importing this module has no side effects and never loads a
// character on its own. Call init({ character }) with the manifest of your choice.

import { createGary, VERSION } from './api';
import type { GaryAPI } from './types';

export { createGary, VERSION };
export { parseCharacter, ManifestError } from './characters/manifest';
export type { Character, Clip } from './characters/manifest';
export type * from './types';

let instance: GaryAPI | null = null;

/** The shared page instance (created on first use). */
export function getGary(): GaryAPI {
  return (instance ??= createGary());
}

export const init: GaryAPI['init'] = (c) => getGary().init(c);
export const say: GaryAPI['say'] = (t) => getGary().say(t);
const doBehavior: GaryAPI['do'] = (b) => getGary().do(b);
export { doBehavior as do };
export const mute: GaryAPI['mute'] = () => getGary().mute();
export const unmute: GaryAPI['unmute'] = () => getGary().unmute();
export const dismiss: GaryAPI['dismiss'] = () => getGary().dismiss();
export const reset: GaryAPI['reset'] = () => getGary().reset();
export const emit: GaryAPI['emit'] = (n, d) => getGary().emit(n, d);
export const on: GaryAPI['on'] = (n, h) => getGary().on(n, h);
export const destroy: GaryAPI['destroy'] = () => getGary().destroy();

const Gary = {
  get ready() {
    return getGary().ready;
  },
  init,
  say,
  do: doBehavior,
  mute,
  unmute,
  dismiss,
  reset,
  emit,
  on,
  destroy,
  version: VERSION,
};
export default Gary;
