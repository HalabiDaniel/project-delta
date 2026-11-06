/**
 * The design system gallery (`?ui-gallery`, developer only): every component in every state, at
 * HUD sizes S / M / L, in either theme (Daylight, Lights out) and either palette, with keyboard, Xbox and PlayStation glyphs. Toggles
 * switch the palette, reduced motion, high contrast, text scale and the glyph device. The page is
 * navigable with the focus manager (arrows / D-pad, Enter / A, Esc / B, Q / E / LB / RB, PageUp /
 * PageDown / triggers, Y for a tooltip), like the game's menus.
 *
 * Developer tooling: the English labels here are sample content, not game text.
 */

import {
  alert, bar, caption, bindTabs, button, card, chip, dialog, glyph, iconButton, infoButton, list, pips, stat, tabPanel, tabs, tooltip,
  badge, buildSlot, coachMark, meter, missionCard, paperCounter, planeCard as planeCardComponent, raidAlert, resultDialog, scoreboard, segmented, teamChip, toggleSwitch,
  ConfirmDialog, UI_STATES, type UiState,
} from '../components';
import { applyTokens, COLOUR_NAMES, THEME_PALETTES, tokenOptions, type PaletteName, type ThemeName } from '../tokens';
import { ALL_ICONS, icon, ICON_NAMES } from '../icons';
import { FocusManager } from '../../input/FocusNav';
import { applyGlyphs, DIALOG_KEYS, GLYPH_DEVICES, type GlyphDevice, type GlyphSpec } from '../../input/glyphs';
import { GamepadSource, padActive, type PadButton } from '../../input/Gamepad';
import { NavRepeater, stickDirection, type NavDirection } from '../../input/analog';
import { esc } from '../dom';
import { fmt, signed } from '../format';
import { PSEUDO, pseudoDom } from '../strings';
import '../components.css';
import './gallery.css';

const SIZES: ReadonlyArray<[string, number]> = [['S', 0.9], ['M', 1], ['L', 1.15]];
const TEXT_SCALES = [0.9, 1, 1.15, 1.3];
const DEVICE_NAMES: Record<GlyphDevice, string> = { keyboard: 'Keyboard', xbox: 'Xbox', playstation: 'PlayStation', generic: 'Generic' };

const KEYS: Record<string, GlyphSpec> = {
  confirm: DIALOG_KEYS.confirm,
  back: DIALOG_KEYS.cancel,
  fold: { key: 'F', pad: 'south' },
  rearm: { key: 'R', pad: 'west' },
  base: { key: 'B', pad: 'north' },
  logbook: { key: 'L', pad: 'view' },
  prevTab: { key: 'Q', pad: 'lb' },
  nextTab: { key: 'E', pad: 'rb' },
  fire: { key: 'LMB', pad: 'rt' },
  bomb: { key: 'RMB', pad: 'lt' },
  boost: { key: 'Shift', pad: 'rb' },
  pause: { key: 'Esc', pad: 'menu' },
};

interface GalleryState {
  device: GlyphDevice;
}

export function mountGallery(host: HTMLElement): void {
  document.title = 'paperwars.io · UI gallery';
  const state: GalleryState = { device: 'keyboard' };
  const page = document.createElement('div');
  page.className = 'ui-gallery';
  page.dataset.navScroll = '';
  page.innerHTML = `<header class="g-bar" aria-label="Gallery options"></header><main class="g-main"></main>`;
  host.appendChild(page);
  const bar = page.querySelector<HTMLElement>('.g-bar')!;
  const main = page.querySelector<HTMLElement>('.g-main')!;
  const confirm = new ConfirmDialog(document.body);
  const nav = new FocusManager(document);

  const renderBar = (): void => {
    const o = tokenOptions();
    const seg = (group: string, items: Array<[string, string, boolean]>): string =>
      `<div class="g-seg" role="group" aria-label="${esc(group)}"><span class="g-seg-label">${esc(group)}</span>${items.map(([v, label, on]) =>
        button({ label, size: 'small', variant: on ? 'primary' : 'secondary', attrs: { 'data-g': group, 'data-v': v, 'aria-pressed': on ? 'true' : 'false' } })).join('')}</div>`;
    bar.innerHTML = `<b class="g-title">paperwars.io design system</b>
      ${seg('Theme', (['daylight', 'lightsOut'] as ThemeName[]).map((t) => [t, t === 'daylight' ? 'Daylight' : 'Lights out', o.theme === t]))}
      ${seg('Palette', (['standard', 'colourblind'] as PaletteName[]).map((p) => [p, p === 'standard' ? 'Standard' : 'Colour-blind', o.palette === p]))}
      ${seg('Motion', [['full', 'Full', !o.reducedMotion], ['reduced', 'Reduced', o.reducedMotion]])}
      ${seg('Contrast', [['normal', 'Normal', !o.highContrast], ['high', 'High', o.highContrast]])}
      ${seg('Text', TEXT_SCALES.map((t) => [String(t), `${Math.round(t * 100)}%`, Math.abs(o.textScale - t) < 0.001]))}
      ${seg('Glyphs', GLYPH_DEVICES.map((d) => [d, DEVICE_NAMES[d], state.device === d]))}`;
  };

  const render = (): void => {
    main.innerHTML = renderSections(state.device, tokenOptions().theme);
    applyGlyphs(main, state.device === 'keyboard' ? null : state.device);
    // ?pseudo: the sample text is not from the dictionary, so it is stretched here, in the page.
    if (PSEUDO) pseudoDom(main);
  };

  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-g]');
    if (!b) return;
    const v = b.dataset.v!;
    switch (b.dataset.g) {
      case 'Theme': applyTokens(document.documentElement, { theme: v as ThemeName }); break;
      case 'Palette': applyTokens(document.documentElement, { palette: v as PaletteName }); break;
      case 'Motion': applyTokens(document.documentElement, { reducedMotion: v === 'reduced' }); break;
      case 'Contrast': applyTokens(document.documentElement, { highContrast: v === 'high' }); break;
      case 'Text': applyTokens(document.documentElement, { textScale: Number(v) }); break;
      case 'Glyphs': state.device = v as GlyphDevice; document.body.classList.toggle('pad-mode', v !== 'keyboard'); break;
    }
    renderBar();
    render();
  });
  main.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-open-dialog]')) {
      void confirm.open({
        title: 'End the sortie?', body: 'The plane returns to the hangar. Paper carried is lost.',
        confirm: { label: 'End sortie', key: KEYS.confirm, icon: 'land' }, cancel: { label: 'Keep flying', key: KEYS.back },
        danger: true, device: state.device,
      }).then((ok) => {
        const out = main.querySelector<HTMLElement>('[data-dialog-result]');
        if (out) out.textContent = ok ? 'Confirmed' : 'Cancelled';
      });
    }
  });
  bindTabs(main);
  renderBar();
  render();
  wireInput(nav);
  (window as unknown as { gallery: unknown }).gallery = { nav, confirm, applyTokens };
}

/** Keyboard, mouse and controller for the gallery, like Controls does for the game's menus. */
function wireInput(nav: FocusManager): void {
  nav.bindHoverTips(document);
  const dirs: Record<string, NavDirection> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const dir = dirs[e.key];
    if (dir) {
      nav.setActive(true);
      nav.update();
      nav.move(dir);
      e.preventDefault();
    } else if (e.key === 'Enter' && nav.active) {
      if (nav.press()) e.preventDefault();
    } else if (e.key === 'Escape') {
      nav.back();
    } else if (e.key === 'q' || e.key === 'Q') {
      nav.switchTab(-1);
    } else if (e.key === 'e' || e.key === 'E') {
      nav.switchTab(1);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      if (nav.page(e.key === 'PageDown' ? 1 : -1)) e.preventDefault();
    } else if (e.key === 'i' || e.key === 'I') {
      nav.info();
    }
  });
  window.addEventListener('mousemove', () => nav.setActive(false));
  const pad = new GamepadSource();
  const repeat = new NavRepeater();
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = pad.poll();
    if (s && padActive(s)) {
      nav.setActive(true);
      const family = s.family;
      if (document.body.dataset.pad !== family) {
        document.body.dataset.pad = family;
      }
    }
    if (s) {
      const pressed = (b: PadButton): boolean => pad.justPressed(b);
      if (pressed('south')) nav.press();
      if (pressed('east')) nav.back();
      if (pressed('lb')) nav.switchTab(-1);
      if (pressed('rb')) nav.switchTab(1);
      if (pressed('lt')) nav.page(-1);
      if (pressed('rt')) nav.page(1);
      if (pressed('north')) nav.info();
      const dpad: NavDirection | null = s.pressed.up ? 'up' : s.pressed.down ? 'down' : s.pressed.left ? 'left' : s.pressed.right ? 'right' : null;
      const step = repeat.update(dpad ?? stickDirection(s.left), dt);
      if (step) nav.move(step);
    }
    nav.update();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---- Sections ------------------------------------------------------------------------------------

function section(id: string, title: string, note: string, inner: string): string {
  return `<section class="g-section" id="g-${id}" aria-labelledby="g-${id}-h"><h2 id="g-${id}-h">${esc(title)}</h2><p class="g-note">${esc(note)}</p>${inner}</section>`;
}

/** Rows of states, columns of HUD sizes. */
function stateTable(render: (s: UiState) => string, states: readonly UiState[] = UI_STATES): string {
  const head = `<tr><th scope="col">State</th>${SIZES.map(([n, k]) => `<th scope="col">${n} · ${k}</th>`).join('')}</tr>`;
  const rows = states.map((s) => `<tr><th scope="row">${s}</th>${SIZES.map(([, k]) => `<td><div class="g-cell" style="zoom:${k}">${render(s)}</div></td>`).join('')}</tr>`).join('');
  return `<table class="g-table">${head}${rows}</table>`;
}

function tone(s: UiState): 'warn' | 'hostile' | undefined {
  return s === 'warning' ? 'warn' : s === 'critical' ? 'hostile' : undefined;
}

let sample = 0;

function renderSections(device: GlyphDevice, theme: ThemeName): string {
  const out: string[] = [];

  // Tokens: both palettes of the theme in effect, side by side.
  const swatches = (p: PaletteName): string => `<div class="g-swatches" data-palette-sample="${p}"><h3>${p === 'standard' ? 'Standard' : 'Colour-blind'}</h3><ul>${COLOUR_NAMES.map((n) =>
    `<li><i style="background:${THEME_PALETTES[theme][p][n]}"></i><code>--${n}</code></li>`).join('')}</ul></div>`;
  out.push(section('tokens', 'Tokens: colour', 'The style guide names (paper-100, ink-900, pencil-400, sky-500, …) and the semantic aliases, in both palettes of this theme. The colour-blind palette is a token swap (Okabe–Ito based).', `<div class="g-two">${swatches('standard')}${swatches('colourblind')}</div>`));

  out.push(section('type', 'Type', 'Lilita One for display and HUD numbers, Nunito 600 / 800 / 900 for everything you read, Kalam for hand-written hints only.',
    `<div class="g-type"><span class="g-t-xl">Defend your desk</span><span class="g-t-display">Raid incoming!</span><span class="g-t-title">Heavy Bomber</span><span class="g-t-counter">1,240</span><span class="g-t-body">Scout an enemy desk and come home with the map.</span><span class="g-t-sm">Costs 120 paper · 40 s to fold</span><span class="g-t-label">Build</span><span class="g-t-doodle">psst… their radar is down!</span></div>`));

  out.push(section('icons', 'Icons', 'Lucide 0.460.0 at a 2.5px stroke in the text colour; game-specific icons drawn to the same weight.',
    `<ul class="g-icons">${ALL_ICONS.map((n) => `<li data-tip="${esc(ICON_NAMES[n])}">${icon(n, 'icon ui-icon')}<code>${n}</code></li>`).join('')}</ul>`));

  out.push(section('card', 'Card', 'A sheet of paper: a 3px marker outline and a hard shadow; the container for every panel.', stateTable((s) =>
    card({ title: 'Hangar', icon: 'plane', state: s, bodyHtml: `<span>${stat({ icon: 'paper', value: fmt(1240), label: 'Paper' })}</span>`, tone: tone(s) }))));

  out.push(section('chip', 'Chip / tag', 'A small labelled value or state.', stateTable((s) =>
    `<div class="g-row">${chip({ label: 'Bonus', value: '+40', icon: 'paper', tone: 'good', state: s })}${chip({ label: 'Record', icon: 'medal', tone: 'gold', state: s })}${chip({ label: 'Streak', value: '3', icon: 'streak', tone: 'streak', state: s })}${chip({ label: 'Hostile', tone: 'hostile', state: s })}${chip({ label: 'Off', state: s })}</div>`)));

  out.push(section('button', 'Button', 'Label plus the binding as a key cap or controller glyph. Primary, secondary, danger.', stateTable((s) =>
    `<div class="g-row">${button({ label: 'Launch', icon: 'plane', variant: 'primary', key: KEYS.fold, device, state: s })}${button({ label: 'Rearm', icon: 'rearm', key: KEYS.rearm, device, state: s })}${button({ label: 'Remove', icon: 'remove', variant: 'danger', key: { key: 'Delete' }, device, state: s })}</div>`)));

  out.push(section('icon-button', 'Icon button', 'Icon only, with a tooltip and an accessible name.', stateTable((s) =>
    `<div class="g-row">${iconButton({ icon: 'base', name: 'Base', key: KEYS.base, device, state: s })}${iconButton({ icon: 'book', name: 'Logbook', key: KEYS.logbook, device, badge: '2', state: s })}${iconButton({ icon: 'menu', name: 'Menu', key: KEYS.pause, device, state: s })}${infoButton({ name: 'More about storage', tip: 'Paper over capacity is lost when you land.', state: s })}</div>`)));

  out.push(section('meter', 'Meter', 'Label, a segmented bar, the value as text. Low (30% or less) turns raid and is hatched; progress fills pencil.', stateTable((s) =>
    `<div class="g-col">${meter({ label: 'Hull', icon: 'health', value: 0.7, valueText: '70%', state: s })}${meter({ label: 'Boost', icon: 'boost', value: 0.4, valueText: '40%', kind: 'progress', state: s })}${meter({ label: 'Hull', icon: 'health', value: 0.2, valueText: '20%', state: s })}</div>`, ['default', 'disabled', 'warning', 'critical'])));

  out.push(section('bar', 'Bar', 'Health, range, boost, progress, capacity, segmented. Thresholds from format.level: over 60% ok, over 30% worn, else critical (hatched).', stateTable((s) =>
    `<div class="g-col">${bar({ value: 0.82, label: 'Health', state: s })}${bar({ value: 0.45, label: 'Range', state: s })}${bar({ value: 0.18, label: 'Health', state: s })}${bar({ value: 0.6, label: 'Progress', kind: 'progress', size: 'thin', state: s })}${bar({ value: 0.35, label: 'Boost', kind: 'boost', size: 'mini', state: s })}</div>`)));

  out.push(section('stat', 'Stat', 'Icon plus a tabular number, an optional delta pop.', stateTable((s) =>
    `<div class="g-row">${stat({ icon: 'paper', value: fmt(1240), suffix: `/ ${fmt(2000)}`, label: 'Paper', delta: signed(40), deltaTone: 'good', state: s })}${stat({ icon: 'speed', value: '142', label: 'Speed', state: s })}${stat({ icon: 'ink', value: '38', label: 'Ink', delta: signed(-6), deltaTone: 'bad', state: s })}</div>`)));

  out.push(section('pips', 'Pips', 'Discrete counts: bombs, levels, ratings, threat.', stateTable((s) =>
    `<div class="g-row">${pips({ filled: 2, total: 3, label: 'Threat 2 of 3', tone: 'threat', state: s })}${pips({ filled: 4, total: 5, label: 'Speed 4 of 5', state: s })}${pips({ filled: 1, total: 4, label: 'Bombs 1 of 4', shape: 'bar', state: s })}</div>`)));

  out.push(section('tooltip', 'Tooltip', 'Details on demand: hover, focus (after a short delay) or the info button (Y / Triangle, I in the gallery).',
    `<div class="g-row">${chip({ label: 'Hover or focus me', tip: 'Tooltips open on hover and on focus.' })}${button({ label: 'With tooltip', tip: 'Every tooltip is also available on focus.' })}${infoButton({ name: 'Info', tip: 'The info button shows the tooltip at once.' })}${tooltip({ id: 'g-tip-open', text: 'An open tooltip', open: true })}</div>`));

  out.push(section('alert', 'Alert', 'Short top-centre message with a severity; at most three show.', stateTable((s) =>
    `<div class="g-col">${alert({ title: 'Storage full', icon: 'storage', severity: 'warning', state: s })}${alert({ title: 'Raid inbound', value: '0:42', icon: 'raid', severity: 'critical', count: '×2', state: s })}${alert({ title: 'Target down', value: '+60', icon: 'ok', severity: 'good', state: s })}${alert({ title: 'Rearmed', icon: 'rearm', state: s })}</div>`, ['default', 'hover', 'warning', 'critical'])));

  out.push(section('caption', 'Caption', 'Sound captions (§8D): the sound in a few words, its icon and an arrow toward it when known.', stateTable((s) =>
    `<div class="g-col">${caption({ text: 'Rocket lock', icon: 'launcher', direction: -1.2, directionLabel: 'to the left', state: s === 'default' ? 'critical' : s })}${caption({ text: 'Spotted', icon: 'radar', state: s })}${caption({ text: 'Hit', icon: 'damage', direction: Math.PI, directionLabel: 'behind', state: s })}</div>`, ['default', 'critical'])));

  out.push(section('counter', 'Paper counter', 'The paper balance: a pencil pill, the paper icon in a white well, the number in the display face, a delta.',
    `<div class="g-row">${paperCounter({ value: fmt(1240), label: '1,240 paper', delta: signed(120) })}${paperCounter({ value: fmt(85), label: '85 paper' })}</div>`));

  out.push(section('raid', 'Raid alert', 'Radar warnings and results: a signal badge, a title, one line and the ETA.',
    `<div class="g-col">${raidAlert({ title: 'Raid on your desk!', body: '2 bombers from Desk 1 heading for your Workshop.', eta: '0:18', icon: 'raid' })}${raidAlert({ title: 'Radar contact', body: 'A scout is circling Desk 3.', icon: 'radar', tone: 'info' })}${raidAlert({ title: 'Raid repelled', body: 'Your Turret crumpled a fighter.', icon: 'shield', tone: 'win' })}</div>`));

  out.push(section('badge', 'Badge', 'New, level, locked, enemy.',
    `<div class="g-row">${badge({ label: 'New', kind: 'new' })}${badge({ label: 'Lv 2', kind: 'level' })}${badge({ label: 'Locked', kind: 'locked', icon: 'lock' })}${badge({ label: 'Enemy', kind: 'enemy' })}${badge({ label: 'Fighter', icon: 'kills' })}</div>`));

  out.push(section('toggle', 'Toggle and segmented control', 'On / off settings; a choice of a few. The chosen segment is an ink fill.',
    `<div class="g-row">${toggleSwitch({ label: 'Raid alerts', checked: true })}${toggleSwitch({ label: 'Reduce motion', checked: false })}${segmented({ label: 'Theme', items: [{ value: 'daylight', label: 'Daylight', pressed: true }, { value: 'lightsOut', label: 'Lights out' }] })}${segmented({ label: 'Size', items: [{ value: 's', label: 'S' }, { value: 'm', label: 'M', pressed: true }, { value: 'l', label: 'L' }] })}</div>`));

  out.push(section('coach', 'Coach mark', 'A taped-on sticky note for tutorial and first-time tips, in the hand-written face. Never numbers or controls in the note itself.',
    `<div class="g-row">${coachMark({ text: 'psst… their radar is down! Fly low and they won’t see you coming.', close: { label: 'Got it', key: KEYS.confirm, device }, name: 'Tip' })}</div>`));

  out.push(section('mission', 'Mission card', 'A notebook page: the red margin line, the mission type, a one-sentence brief, the reward in win and the risk naming the plane in raid.',
    `<div class="g-two">${missionCard({ title: 'Bomb the workshop', icon: 'bombload', typeLabel: 'Bombing', brief: 'Fly to Desk 4 and drop one on their Workshop.', reward: '+300', rewardLabel: 'Reward 300 paper', risk: 'Crash and you lose your Swift', interactive: true, selected: true })}${missionCard({ title: 'Scout Desk 3', icon: 'recon', typeLabel: 'Reconnaissance', brief: 'Circle their radar and come home with the map.', reward: '+120', risk: 'Two turrets', interactive: true })}</div>`));

  out.push(section('plane', 'Plane card', 'One of the planes: name, role, stats, cost in cardboard; the risk names what you lose.',
    `<div class="g-row">${planeCardComponent({ name: 'Lightning', role: 'Fighter', roleIcon: 'kills', stats: [['Speed', 4, 5], ['Hull', 3, 5], ['Bombs', 1, 5]], cost: '80', costLabel: '80 paper', risk: { text: 'Crash and you lose', strong: '80 paper' }, selected: true })}${planeCardComponent({ name: 'Thug', role: 'Bomber', roleIcon: 'bombload', stats: [['Speed', 2, 5], ['Hull', 5, 5], ['Bombs', 4, 5]], cost: '70', risk: { text: 'Crash and you lose', strong: '70 paper' } })}</div>`));

  out.push(section('slot', 'Build slot', 'A defence or building on your desk: levels 1 to 3, a status line with an icon; damaged has a raid outline; empty is dashed with a plus.',
    `<div class="g-row">${buildSlot({ name: 'Workshop', icon: 'workshop', level: 2, maxLevel: 3, meta: '+10 paper / min', metaIcon: 'rate' })}${buildSlot({ name: 'Turret', icon: 'turret', level: 1, maxLevel: 3, status: 'damaged', meta: 'Damaged · 40%', metaIcon: 'warn' })}${buildSlot({ name: 'Build here', status: 'empty' })}</div>`));

  out.push(section('result', 'Result dialog', 'The sortie report: home safe (win) or crumpled (raid), the numbers, the actions.',
    `<div class="g-two">${resultDialog({ title: 'Home safe!', sub: 'Mission done. +300 paper', tone: 'win', rows: [['Reward', '+300'], ['Ink used', '42'], ['Time', '1:12']], actionsHtml: button({ label: 'Back to desk', variant: 'primary', key: KEYS.confirm, device }) })}${resultDialog({ title: 'Crumpled', sub: 'Your Swift was shot down over Desk 4.', tone: 'loss', rows: [['Lost', '−15'], ['Time', '0:48']], actionsHtml: button({ label: 'Back to desk', variant: 'primary', key: KEYS.confirm, device }) })}</div>`));

  out.push(section('score', 'Scoreboard and team chip', 'Room standings; a team is always its colour and its desk number.',
    `<div class="g-two">${scoreboard({ label: 'Room standings', columns: [{ label: '#' }, { label: 'Pilot' }, { label: 'Paper', num: true }, { label: 'Shot down', num: true }], rows: [
      { cells: ['1', teamChip({ name: 'Mira', team: 1, desk: 'Desk 1' }), '1,980', '7'], html: true },
      { cells: ['2', teamChip({ name: 'You', team: 2, desk: 'Desk 5', you: 'You' }), '1,240', '4'], html: true, you: true },
      { cells: ['3', teamChip({ name: 'Jonas', team: 3, desk: 'Desk 3' }), '880', '2'], html: true },
    ] })}<div class="g-row">${[1, 2, 3, 4, 5, 6, 7, 8].map((t) => teamChip({ name: `Team ${t}`, team: t })).join('')}</div></div>`));

  const planeCard = (name: string, s?: UiState): string =>
    card({ title: name, icon: 'plane', state: s, attrs: { 'data-nav': `plane-${name}` }, bodyHtml: `<div class="g-row">${pips({ filled: 3, total: 5, label: 'Speed 3 of 5' })}${chip({ label: 'Fit', tone: 'good' })}</div>` });
  out.push(section('list', 'List / grid', 'Focus-navigable collections. The long list scrolls with triggers or PageUp / PageDown.',
    `<div class="g-two">${list({ label: 'Hangar', layout: 'grid', columns: 3, itemsHtml: ['Swift', 'Falcon', 'Widewing', 'Hornet', 'Raptor', 'Spare'].map((n, i) => planeCard(n, i === 5 ? 'disabled' : undefined)) })}
    ${list({ label: 'History', scroll: true, itemsHtml: Array.from({ length: 24 }, (_, i) => button({ label: `Sortie ${i + 1}`, size: 'small', attrs: { 'data-nav': `row-${i}` } })) })}</div>`));

  const tabItems = [{ id: 'records', label: 'Records', icon: 'medal' as const }, { id: 'base', label: 'Base', icon: 'base' as const, selected: true }, { id: 'aircraft', label: 'Aircraft', icon: 'plane' as const, badge: '5' }, { id: 'paper', label: 'Paper', icon: 'paper' as const, disabled: true }];
  out.push(section('tabs', 'Tabs', 'Section switching: Q / E or LB / RB anywhere on the screen.',
    `${tabs({ id: 'g-logbook', label: 'Logbook sections', tabs: tabItems, prev: KEYS.prevTab, next: KEYS.nextTab, device })}${tabItems.map((t) => tabPanel({ tabsId: 'g-logbook', tab: t.id, selected: !!t.selected, bodyHtml: `<p class="g-note">${esc(t.label)} panel</p>` })).join('')}
    ${stateTable((s) => tabs({ id: `g-sample-${s}-${++sample}`, label: 'Sample', tabs: [{ id: 'a', label: 'Selected', selected: true }, { id: 'b', label: 'Other', state: s }] }), ['default', 'hover', 'focused', 'pressed', 'disabled', 'warning', 'critical'])}`));

  out.push(section('dialog', 'Dialog', 'Confirmations for destructive actions. Focus is trapped; Esc / B cancels; Enter / A presses the focused button (confirm first).',
    `<div class="g-row">${button({ label: 'Open confirm dialog', variant: 'danger', icon: 'land', attrs: { 'data-open-dialog': '' } })}<span class="g-note" data-dialog-result aria-live="polite"></span></div>
    <div class="g-two">${dialog({ id: 'g-dialog-a', inline: true, title: 'Remove the turret?', body: 'You get half its paper back.', confirm: { label: 'Remove', key: KEYS.confirm, icon: 'remove' }, cancel: { label: 'Keep', key: KEYS.back }, danger: true, device }).replace('aria-modal="true"', 'aria-modal="false"')}
    ${dialog({ id: 'g-dialog-b', inline: true, title: 'Leave the classroom?', confirm: { label: 'Leave', key: KEYS.confirm }, cancel: { label: 'Stay', key: KEYS.back }, device, confirmState: 'focused' }).replace('aria-modal="true"', 'aria-modal="false"')}</div>`));

  const actions: Array<[string, GlyphSpec]> = Object.entries(KEYS);
  out.push(section('glyph', 'Glyph', 'Every binding on every device. Fixed glyphs (left) and live glyphs that follow the glyph toggle (right column).',
    `<table class="g-table"><tr><th scope="col">Action</th>${GLYPH_DEVICES.map((d) => `<th scope="col">${DEVICE_NAMES[d]}</th>`).join('')}<th scope="col">Live</th></tr>${actions.map(([name, spec]) =>
      `<tr><th scope="row">${esc(name)}</th>${GLYPH_DEVICES.map((d) => `<td>${glyph(spec, { device: d }) || '<span class="g-note">—</span>'}</td>`).join('')}<td>${glyph(spec)}</td></tr>`).join('')}</table>`));

  out.push(section('focus', 'Focus ring', 'One ring from the focus tokens, for keyboard and controller. Arrows or the D-pad move it here.',
    `<div class="g-row">${button({ label: 'Focused', state: 'focused' })}${iconButton({ icon: 'info', name: 'Focused', state: 'focused' })}${chip({ label: 'Focused chip', state: 'focused' })}<input class="g-input" aria-label="Text field" placeholder="Text field" /><select class="g-input" aria-label="Select"><option>Select</option><option>Two</option></select><textarea class="g-input" aria-label="Notes" rows="2" placeholder="Textarea"></textarea></div>`));

  return out.join('');
}
