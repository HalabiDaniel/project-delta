/**
 * Prints the Lucide icon nodes that src/ui/icons.ts copies (the style guide pins lucide@0.460.0,
 * ISC licence). Run after changing the map below and paste the output into LUCIDE in icons.ts:
 *
 *   node tools/lucide-icons.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Our icon name → the Lucide icon drawn for it. */
export const MAP = {
  bomb: 'target', radar: 'radar', supply: 'package', recon: 'eye', survive: 'hourglass', escape: 'arrow-up-from-line',
  land: 'plane-landing', ring: 'circle-dot', practice: 'send', reach: 'flag', rocket: 'rocket', patrol: 'rotate-cw',
  paper: 'files', rate: 'trending-up', capacity: 'archive', lock: 'lock', refund: 'undo-2', store: 'layers', workshop: 'factory',
  storage: 'package-open', speed: 'gauge', altitude: 'mountain', boost: 'zap', health: 'heart', range: 'route', ink: 'droplet',
  bombload: 'bomb', rearm: 'refresh-cw', plane: 'plane', heading: 'navigation-2', base: 'castle', repair: 'wrench',
  upgrade: 'circle-arrow-up', build: 'hammer', remove: 'trash-2', slot: 'square-dashed', level: 'star', shield: 'shield',
  raid: 'siren', ok: 'circle-check', warn: 'triangle-alert', wrecked: 'circle-x', offline: 'ban', clock: 'clock',
  distance: 'move-horizontal', home: 'house', kills: 'crosshair', medal: 'medal', streak: 'flame', swap: 'arrow-left-right',
  book: 'book-open', sound: 'volume-2', mute: 'volume-x', menu: 'menu', pencil: 'pencil', graphics: 'image', info: 'info',
  tip: 'lightbulb', close: 'x', more: 'chevron-down',
  // Added with the style guide (2026-11-06).
  trophy: 'trophy', users: 'users', pause: 'pause', plus: 'plus', minus: 'minus', check: 'check', back: 'chevron-left',
  map: 'map', swords: 'swords', sun: 'sun', moon: 'moon',
  // Added with the v0.0.16 UI rebuild (menus, sign-in, multiplayer, settings).
  play: 'play', arrowLeft: 'arrow-left', logIn: 'log-in', logOut: 'log-out', user: 'user', userPlus: 'user-plus',
  eye: 'eye', eyeOff: 'eye-off', mail: 'mail', copy: 'copy', crown: 'crown', wifi: 'wifi', sliders: 'sliders-horizontal',
  search: 'search', gamepad: 'gamepad-2', monitor: 'monitor', keyboard: 'keyboard', reset: 'rotate-ccw', move: 'move',
  hangar: 'warehouse', award: 'award', heart: 'heart', chart: 'chart-line', send: 'send', timer: 'timer',
  // v0.0.16: the maneuver slot.
  maneuver: 'rotate-ccw',
};

const require = createRequire(import.meta.url);
const dir = join(dirname(require.resolve('lucide/package.json')), 'dist/esm/icons');
const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
for (const [ours, lucide] of Object.entries(MAP)) {
  const src = readFileSync(join(dir, `${lucide}.js`), 'utf8');
  const body = src.slice(src.indexOf('defaultAttributes,') + 'defaultAttributes,'.length, src.lastIndexOf(']'));
  const nodes = Function(`return ${body.trim().replace(/,\s*$/, '')}`)();
  const svg = nodes.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
  console.log(`  ${/^[a-z][a-zA-Z]*$/.test(ours) ? ours : `'${ours}'`}: '${svg}', // ${lucide}`);
}
