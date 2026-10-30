/**
 * bomb – a bullseye. turret, launcher, radar, supply – the defenses. recon – an eye. survive – a
 * shield. escape – an arrow out. land – home. ring – a hoop. practice – a paper plane. reach – a
 * flag. rocket – an incoming rocket.
 */
export type IconName =
  | 'bomb'
  | 'turret'
  | 'launcher'
  | 'radar'
  | 'supply'
  | 'recon'
  | 'survive'
  | 'escape'
  | 'land'
  | 'ring'
  | 'practice'
  | 'reach'
  | 'rocket';

const PATHS: Record<IconName, string> = {
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
};

/** A small line icon as an SVG string, drawn in the current text colour. */
export function icon(name: IconName, className = 'icon'): string {
  return `<svg class="${className}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
