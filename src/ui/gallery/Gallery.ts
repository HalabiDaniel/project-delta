/**
 * The design system gallery (`?ui-gallery`, developer only): every component in every state, at
 * HUD sizes S / M / L, in either palette, with keyboard, Xbox and PlayStation glyphs. Toggles
 * switch the palette, reduced motion, high contrast, text scale and the glyph device. The page is
 * navigable with the focus manager (arrows / D-pad, Enter / A, Esc / B, Q / E / LB / RB, PageUp /
 * PageDown / triggers, Y for a tooltip), like the game's menus.
 *
 * Developer tooling: the English labels here are sample content, not game text.
 */

import {
  alert, bar, caption, bindTabs, button, card, chip, dialog, glyph, iconButton, infoButton, list, pips, stat, tabPanel, tabs, tooltip,
  ConfirmDialog, UI_STATES, type UiState,
} from '../components';
import { applyTokens, COLOUR_NAMES, PALETTES, tokenOptions, type PaletteName } from '../tokens';
import { FocusManager } from '../../input/FocusNav';
import { applyGlyphs, DIALOG_KEYS, GLYPH_DEVICES, type GlyphDevice, type GlyphSpec } from '../../input/glyphs';
import { GamepadSource, padActive, type PadButton } from '../../input/Gamepad';
import { NavRepeater, stickDirection, type NavDirection } from '../../input/analog';
import { esc } from '../dom';
import { fmt, signed } from '../format';
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
    bar.innerHTML = `<b class="g-title">Design system</b>
      ${seg('Palette', (['standard', 'colourblind'] as PaletteName[]).map((p) => [p, p === 'standard' ? 'Standard' : 'Colour-blind', o.palette === p]))}
      ${seg('Motion', [['full', 'Full', !o.reducedMotion], ['reduced', 'Reduced', o.reducedMotion]])}
      ${seg('Contrast', [['normal', 'Normal', !o.highContrast], ['high', 'High', o.highContrast]])}
      ${seg('Text', TEXT_SCALES.map((t) => [String(t), `${Math.round(t * 100)}%`, Math.abs(o.textScale - t) < 0.001]))}
      ${seg('Glyphs', GLYPH_DEVICES.map((d) => [d, DEVICE_NAMES[d], state.device === d]))}`;
  };

  const render = (): void => {
    main.innerHTML = renderSections(state.device);
    applyGlyphs(main, state.device === 'keyboard' ? null : state.device);
  };

  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-g]');
    if (!b) return;
    const v = b.dataset.v!;
    switch (b.dataset.g) {
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

function renderSections(device: GlyphDevice): string {
  const out: string[] = [];

  // Tokens: both palettes side by side.
  const swatches = (p: PaletteName): string => `<div class="g-swatches" data-palette-sample="${p}"><h3>${p === 'standard' ? 'Standard' : 'Colour-blind'}</h3><ul>${COLOUR_NAMES.map((n) =>
    `<li><i style="background:${PALETTES[p][n]}"></i><code>--${n}</code></li>`).join('')}</ul></div>`;
  out.push(section('tokens', 'Tokens: colour', 'Both palettes. The colour-blind palette is a token swap (Okabe–Ito based).', `<div class="g-two">${swatches('standard')}${swatches('colourblind')}</div>`));

  out.push(section('card', 'Card', 'Cut card stock with a folded corner; the container for every panel.', stateTable((s) =>
    card({ title: 'Hangar', icon: 'plane', state: s, bodyHtml: `<span>${stat({ icon: 'paper', value: fmt(1240), label: 'Paper' })}</span>`, tone: tone(s) }))));

  out.push(section('chip', 'Chip / tag', 'A small labelled value or state.', stateTable((s) =>
    `<div class="g-row">${chip({ label: 'Bonus', value: '+40', icon: 'paper', tone: 'good', state: s })}${chip({ label: 'Record', icon: 'medal', tone: 'gold', state: s })}${chip({ label: 'Streak', value: '3', icon: 'streak', tone: 'streak', state: s })}${chip({ label: 'Hostile', tone: 'hostile', state: s })}${chip({ label: 'Off', state: s })}</div>`)));

  out.push(section('button', 'Button', 'Label plus the binding as a key cap or controller glyph. Primary, secondary, danger.', stateTable((s) =>
    `<div class="g-row">${button({ label: 'Launch', icon: 'plane', variant: 'primary', key: KEYS.fold, device, state: s })}${button({ label: 'Rearm', icon: 'rearm', key: KEYS.rearm, device, state: s })}${button({ label: 'Remove', icon: 'remove', variant: 'danger', key: { key: 'Delete' }, device, state: s })}</div>`)));

  out.push(section('icon-button', 'Icon button', 'Icon only, with a tooltip and an accessible name.', stateTable((s) =>
    `<div class="g-row">${iconButton({ icon: 'base', name: 'Base', key: KEYS.base, device, state: s })}${iconButton({ icon: 'book', name: 'Logbook', key: KEYS.logbook, device, badge: '2', state: s })}${iconButton({ icon: 'menu', name: 'Menu', key: KEYS.pause, device, state: s })}${infoButton({ name: 'More about storage', tip: 'Paper over capacity is lost when you land.', state: s })}</div>`)));

  out.push(section('bar', 'Bar', 'Health, range, boost, progress, capacity. Thresholds from format.level: over 60% ok, over 30% worn, else critical (hatched).', stateTable((s) =>
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
