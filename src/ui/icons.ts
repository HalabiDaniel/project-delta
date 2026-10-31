/**
 * One line-icon family for the whole HUD: 16 × 16, drawn in the current text colour with a single
 * stroke weight, so icons sit next to numbers in place of words. Every icon has a name (ICON_NAMES)
 * for its tooltip and screen readers, so no value is ever left unexplained.
 */
const PATHS = {
  // Objectives and threats
  bomb: '<circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3.4"/><circle cx="8" cy="8" r="0.9" fill="currentColor"/>',
  turret: '<path d="M2.5 14h11M4 14v-3.2a4 4 0 0 1 8 0V14"/><path d="M8 7.2 13.6 2.6"/>',
  launcher: '<path d="M2.5 14h11M5 14l2-4h2l2 4"/><path d="M4.4 9.6 11.6 2.4M6.6 10.4l5.6-5.6"/><path d="M11.6 2.4l1.8-.6-.6 1.8"/>',
  radar: '<path d="M8 14V8.6M5.2 14h5.6"/><path d="M3.2 6.8a5.2 5.2 0 0 1 9.6-2.4L8 8.6z"/><path d="M12.4 1.6a2.6 2.6 0 0 1 1.9 2.2"/>',
  supply: '<path d="M2.4 5.4 8 2.6l5.6 2.8v5.6L8 13.8 2.4 11z"/><path d="M2.4 5.4 8 8.2l5.6-2.8M8 8.2v5.6"/>',
  recon: '<path d="M1.6 8s2.4-4.4 6.4-4.4S14.4 8 14.4 8 12 12.4 8 12.4 1.6 8 1.6 8z"/><circle cx="8" cy="8" r="2.2"/>',
  survive: '<path d="M8 1.8 13.2 3.8v4c0 3.2-2.2 5.2-5.2 6.4C5 13 2.8 11 2.8 7.8v-4z"/><path d="M8 5v3.4l2 1.2"/>',
  escape: '<path d="M8 13.6V3M3.8 7.2 8 3l4.2 4.2"/><path d="M2.6 13.6h10.8"/>',
  land: '<path d="M2.4 13.4h11.2M3.6 13.4 8 2.6l4.4 10.8M8 6.4v1.6M8 10v1.6"/>',
  ring: '<circle cx="8" cy="8" r="5.4"/><path d="M8 1v2.6M8 12.4V15"/>',
  practice: '<path d="M1.6 8.6 14.4 3 9.4 14l-1.8-4.4z"/><path d="M7.6 9.6 14.4 3"/>',
  reach: '<path d="M3.4 14.6V1.8M3.4 2.4h8.4l-2 2.8 2 2.8H3.4"/>',
  rocket: '<path d="M8 1.4c2 1.6 2.8 3.8 2.8 6.4V11H5.2V7.8c0-2.6.8-4.8 2.8-6.4z"/><path d="M5.2 9.4 3 12.4h2.2M10.8 9.4l2.2 3h-2.2M7 13.2 8 15l1-1.8"/>',
  fighter: '<path d="M8 1.6 9.2 7l5 3.4v1.2L9 10.4 8.6 13l1.6 1.2H5.8L7.4 13 7 10.4l-5.2 1.2v-1.2L6.8 7z"/>',
  scout: '<path d="M8 2 9 8.6l3.6 2.6v.9L8.8 11l-.3 2.8H7.5L7.2 11l-3.8 1.1v-.9L7 8.6z"/><circle cx="8" cy="5.4" r="0.8" fill="currentColor"/>',
  bomber: '<path d="M8 2.2c.8 0 1.2.8 1.2 2V7l5.4 2.2v1.6L9.2 10l-.3 2.6 1.8 1.2v.8H5.3v-.8l1.8-1.2L6.8 10l-5.4.8V9.2L6.8 7V4.2c0-1.2.4-2 1.2-2z"/>',
  escort: '<path d="M8 1.8 13.2 3.8v4c0 3.2-2.2 5.2-5.2 6.4C5 13 2.8 11 2.8 7.8v-4z"/><path d="M8 4.6 8.7 8l2.3 1.4v.6L8.6 9.4 8 11.6l-.6-2.2L5 10v-.6L7.3 8z"/>',
  patrol: '<path d="M13.2 8A5.2 5.2 0 1 1 8 2.8"/><path d="M8 .8 10.2 2.8 8 4.8"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>',
  // Economy
  paper: '<path d="M3.5 1.8h6l3 3v9.4h-9z"/><path d="M9.5 1.8v3h3M5.6 8.2h4.8M5.6 10.8h3.4"/>',
  rate: '<path d="M2 12.5 6 8.5l2.5 2.5L14 5.5"/><path d="M10.5 5.5H14V9"/>',
  capacity: '<path d="M2.5 5.5h11v8h-11z"/><path d="M1.8 5.5 3.6 2.6h8.8l1.8 2.9"/><path d="M5.2 9.4h5.6"/>',
  lock: '<rect x="3.2" y="7" width="9.6" height="7" rx="1.4"/><path d="M5.3 7V5a2.7 2.7 0 0 1 5.4 0v2"/>',
  refund: '<path d="M6 3.6 3 6.6l3 3"/><path d="M3 6.6h6.4a3.8 3.8 0 0 1 0 7.6H6"/>',
  store: '<path d="M2.4 10.6 8 13.4l5.6-2.8"/><path d="M2.4 7.8 8 10.6l5.6-2.8"/><path d="M2.4 5 8 2.2 13.6 5 8 7.8z"/>',
  workshop: '<path d="M1.8 14.2V8l3.4 2V8l3.4 2V4.2h3.6v10z"/><path d="M4.4 12.2h1.6M9.4 12.2h1.6"/>',
  storage: '<path d="M2.6 6.2h10.8v7.6H2.6z"/><path d="M2.6 6.2 1.4 3.6h5.2L8 6.2M13.4 6.2l1.2-2.6H9.4L8 6.2"/><path d="M6.4 9.2h3.2"/>',
  // Flight
  speed: '<path d="M2.2 11.5a6 6 0 1 1 11.6 0"/><path d="M8 10.4 11 6.2"/><circle cx="8" cy="10.6" r="1" fill="currentColor"/>',
  altitude: '<path d="M1.5 14 6 6.5l2.6 4.2 1.6-2.4L14.5 14z"/><path d="M12 6V1.8M10.2 3.6 12 1.8l1.8 1.8"/>',
  boost: '<path d="M9 1.5 3.5 9h4L6.8 14.5 12.5 7h-4z"/>',
  health: '<path d="M8 13.8S2 10.2 2 6.1A3.1 3.1 0 0 1 8 4.6a3.1 3.1 0 0 1 6 1.5c0 4.1-6 7.7-6 7.7z"/>',
  range: '<path d="M2.2 13.6c2.4 0 2.6-3.4 5-3.4s2.8-3.6 5.4-3.6" stroke-dasharray="1.8 1.9"/><circle cx="2.4" cy="13.4" r="1.1" fill="currentColor"/><path d="M12.8 7.8V2M12.8 2.2h2.4l-.9 1.2.9 1.2h-2.4"/>',
  ink: '<path d="M8 1.6C5.4 5.2 3.8 7.6 3.8 9.8a4.2 4.2 0 0 0 8.4 0c0-2.2-1.6-4.6-4.2-8.2z" fill="currentColor" fill-opacity=".18"/><path d="M6.2 10.4a1.8 1.8 0 0 0 1.8 1.8"/>',
  bombload: '<circle cx="8" cy="10" r="4.6" fill="currentColor" fill-opacity=".18"/><path d="M6.6 5.4h2.8V4H6.6z"/><path d="M8 4c0-1.2.9-2 2.2-1.9"/><path d="M11.6 1.4v1.4M12.3 2.1h-1.4"/>',
  rearm: '<path d="M13 6.5A5.2 5.2 0 0 0 3.6 4.8M3 9.5a5.2 5.2 0 0 0 9.4 1.7"/><path d="M3.4 2.2v2.8h2.8M12.6 13.8V11H9.8"/>',
  plane: '<path d="M1.6 8.6 14.4 3 9.4 14l-1.8-4.4z"/><path d="M7.6 9.6 14.4 3"/>',
  heading: '<path d="M8 1.8 12.2 14 8 11.2 3.8 14z"/>',
  // Base
  base: '<path d="M2.5 14V6.5h2V4.6h2v1.9h3V4.6h2v1.9h2V14z"/><path d="M6.6 14v-3.2h2.8V14"/>',
  repair: '<path d="M10.3 1.9a3.4 3.4 0 0 0-3.2 4.6L2.2 11.4a1.4 1.4 0 0 0 2 2l4.9-4.9a3.4 3.4 0 0 0 4.6-3.2l-2 1.1-1.7-.4-.4-1.7z"/>',
  upgrade: '<path d="M3.5 9 8 4.5 12.5 9M3.5 13 8 8.5l4.5 4.5"/>',
  build: '<path d="M2.2 13.8 8.6 7.4"/><path d="M7 3.4 9.4 1.8l4.4 4.4-1.6 2.4-2-.6-1.6 1.6-2.6-2.6 1.6-1.6z"/>',
  remove: '<path d="M3 4.2h10M6.2 4.2V2.6h3.6v1.6M4.3 4.2l.7 9.6h6l.7-9.6"/><path d="M6.6 7v4.4M9.4 7v4.4"/>',
  slot: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.2 1.8"/><path d="M8 5.5v5M5.5 8h5"/>',
  level: '<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
  shield: '<path d="M8 1.8 13.2 3.8v4c0 3.2-2.2 5.2-5.2 6.4C5 13 2.8 11 2.8 7.8v-4z"/>',
  raid: '<path d="M4 12.5V8.4a4 4 0 0 1 8 0v4.1"/><path d="M2.6 14.2h10.8v-1.7H2.6z"/><path d="M8 1.4v1.6M2.6 3.4l1.1 1.1M13.4 3.4l-1.1 1.1"/>',
  // Status
  ok: '<circle cx="8" cy="8" r="6"/><path d="M5.2 8.2 7.2 10.2 10.9 6"/>',
  warn: '<path d="M8 2 14.6 13.6H1.4z"/><path d="M8 6.4v3.4"/><circle cx="8" cy="11.8" r=".6" fill="currentColor"/>',
  wrecked: '<circle cx="8" cy="8" r="6"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"/>',
  offline: '<circle cx="8" cy="8" r="6"/><path d="M3.8 12.2 12.2 3.8"/>',
  // Results
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/>',
  distance: '<path d="M1.8 8h12.4M4 5.6 1.8 8 4 10.4M12 5.6 14.2 8 12 10.4"/>',
  home: '<path d="M2 7.6 8 2.4l6 5.2"/><path d="M3.8 6.4v7.2h8.4V6.4"/><path d="M6.6 13.6V10h2.8v3.6"/>',
  kills: '<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><path d="M8 .9v3M8 12.1v3M.9 8h3M12.1 8h3"/>',
  crumple: '<path d="M4 4.5 7 2.8l3.4 1 2.6 2.6-.4 3.6-2.4 2.8-3.8.6L3.2 11 2.6 7.4z"/><path d="M5.5 6.4 8 8l2.6-1.4M8 8l-.6 3.4"/>',
  damage: '<path d="M8 1.5 9.4 5.3l3.9-1.1-2 3.5 3.2 2.4-4 .5.3 4-2.8-2.9L5.2 14.6l.3-4-4-.5 3.2-2.4-2-3.5 3.9 1.1z"/>',
  medal: '<circle cx="8" cy="10.2" r="4"/><path d="M5.6 1.8 8 6.2l2.4-4.4"/>',
  streak: '<path d="M8 14.4c-2.8 0-4.6-1.9-4.6-4.4 0-2.8 2.4-4.3 2.8-7.6 2 1.2 3 3 3 4.6.9-.4 1.4-1.2 1.6-2 1.2 1.2 1.8 3 1.8 4.6 0 2.8-1.8 4.8-4.6 4.8z"/>',
  // Controls
  swap: '<path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13"/>',
  book: '<path d="M2.5 3.2c2-.8 3.8-.6 5.5.6 1.7-1.2 3.5-1.4 5.5-.6v9.8c-2-.8-3.8-.6-5.5.6-1.7-1.2-3.5-1.4-5.5-.6z"/><path d="M8 3.8v9.8"/>',
  sound: '<path d="M2.5 6h2.6L8.6 3v10L5.1 10H2.5z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8"/>',
  mute: '<path d="M2.5 6h2.6L8.6 3v10L5.1 10H2.5z"/><path d="M11 6l3.5 4M14.5 6 11 10"/>',
  menu: '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4.2"/><circle cx="8" cy="5" r=".7" fill="currentColor"/>',
  tip: '<path d="M5.4 10.4a4.4 4.4 0 1 1 5.2 0v1.8H5.4z"/><path d="M6 14.4h4"/>',
  close: '<path d="M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4"/>',
  more: '<path d="M4 6l4 4 4-4"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** What each icon stands for: tooltips and screen readers. */
export const ICON_NAMES: Record<IconName, string> = {
  bomb: 'Bullseye', turret: 'Ink turret', launcher: 'Rocket launcher', radar: 'Radar', supply: 'Supply depot', recon: 'Reconnaissance',
  survive: 'Survive', escape: 'Escape', land: 'Land', ring: 'Ring', practice: 'Practice plane', reach: 'Reach', rocket: 'Rocket',
  fighter: 'Fighter', scout: 'Scout', bomber: 'Bomber', escort: 'Escort', patrol: 'Patrol',
  paper: 'Paper', rate: 'Paper per minute', capacity: 'Storage capacity', lock: 'Protected paper', refund: 'Refund', store: 'Paper store',
  workshop: 'Paper workshop', storage: 'Storage box',
  speed: 'Speed', altitude: 'Altitude', boost: 'Boost', health: 'Health', range: 'Range', ink: 'Ink', bombload: 'Bombs', rearm: 'Rearm',
  plane: 'Aircraft', heading: 'Direction',
  base: 'Base', repair: 'Repair', upgrade: 'Upgrade', build: 'Build', remove: 'Remove', slot: 'Empty slot', level: 'Level', shield: 'Defenses',
  raid: 'Raid',
  ok: 'Operational', warn: 'Damaged', wrecked: 'Destroyed', offline: 'Offline',
  clock: 'Time', distance: 'Distance', home: 'Home', kills: 'Shot down', crumple: 'Planes lost', damage: 'Damage', medal: 'Medal', streak: 'Streak',
  swap: 'Swap', book: 'Logbook', sound: 'Sound', mute: 'Muted', menu: 'Menu', info: 'Info', tip: 'Tip', close: 'Close', more: 'Details',
};

/**
 * A small line icon as an SVG string, drawn in the current text colour. With `label` it is
 * announced (and shows a tooltip on hover); without, it is decoration next to its own label.
 */
export function icon(name: IconName, className = 'icon', label?: string): string {
  const a11y = label !== undefined ? `role="img" aria-label="${label}"><title>${label}</title` : 'aria-hidden="true"';
  return `<svg class="${className}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${PATHS[name]}</svg>`;
}
