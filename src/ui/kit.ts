/**
 * The v0.0.16 component kit (docs/DESIGN_SYSTEM.md §12): the pieces every rebuilt screen is made
 * of, after the approved design canvas "paperwars.io screens".
 *
 * Same rules as components.ts: functions that return HTML strings, no literal text (every word is
 * an argument from the dictionary), `…Html` arguments are trusted markup and everything else is
 * escaped, interactive pieces are real buttons / links / inputs with a role and a name, at least
 * 44px tall. Styles live in kit.css and use tokens only.
 *
 * Global rules the styles enforce: 2px ink borders on panels, cards, chips and widgets (3px only
 * on the primary call to action, a selected item and the focus ring); offset shadows 4px on
 * panels and 3px on chips and buttons; nested elements have no shadow; radius 12px on buttons,
 * chips, cards and fields, 20px on panels and drawers, pills only for badges, segmented controls
 * and toggles; the 8px spacing grid.
 */

import { attrs, glyph, keyTipAttrs, tooltipAttrs, type Attrs } from './components';
import { esc } from './dom';
import { icon, type IconName } from './icons';
import type { GlyphSpec } from '../input/glyphs';
import './kit.css';

export type { Attrs } from './components';

const cls = (base: string, extra?: string): string => (extra ? `${base} ${extra}` : base);

/** The tooltip attributes for an optional tip, naming its binding when given. */
function tipAttrs(tip?: string, tipKey?: GlyphSpec): Attrs {
  if (!tip) return {};
  return tipKey ? keyTipAttrs(tip, tipKey) : tooltipAttrs(tip);
}

/** Semantic tones; each maps to the token pairs in kit.css. */
export type KitTone = 'plain' | 'good' | 'friend' | 'hostile' | 'warn' | 'gold' | 'objective';

// ---- Panel ---------------------------------------------------------------------------------------

export interface PanelOptions {
  bodyHtml: string;
  /** The red margin line of a notebook page. */
  margin?: boolean;
  /** Accessible name. */
  label?: string;
  /** The recessed paper variant (a panel inside a sheet: no shadow). */
  inset?: boolean;
  className?: string;
  attrs?: Attrs;
  tag?: 'section' | 'div' | 'aside';
}

/** A paper sheet: 2px ink border, 20px radius, 4px offset shadow, optional red margin line. */
export function panel(o: PanelOptions): string {
  const tag = o.tag ?? 'section';
  return `<${tag}${attrs({
    class: cls('pw-panel', o.className),
    role: o.label ? 'group' : undefined,
    'aria-label': o.label,
    'data-margin': o.margin ? '' : undefined,
    'data-inset': o.inset ? '' : undefined,
    ...o.attrs,
  })}>${o.bodyHtml}</${tag}>`;
}

// ---- Button --------------------------------------------------------------------------------------

export type KitButtonVariant = 'primary' | 'paper' | 'danger' | 'quiet';

export interface KitButtonOptions {
  label: string;
  variant?: KitButtonVariant;
  icon?: IconName;
  /** The binding, as a key cap (shown with hints on). */
  key?: GlyphSpec;
  /** Show the key cap only while key hints are on (the HUD). */
  hintKey?: boolean;
  /** s 44px, m 52px, l 60px, xl 80px. */
  size?: 's' | 'm' | 'l' | 'xl';
  /** Full width. */
  block?: boolean;
  disabled?: boolean;
  /** A toggle button's state (aria-pressed). */
  pressed?: boolean;
  tip?: string;
  tipKey?: GlyphSpec;
  /** A link instead of a button. */
  href?: string;
  /** Trusted markup after the label (a price, a count). */
  afterHtml?: string;
  className?: string;
  attrs?: Attrs;
}

/** Primary pencil-yellow, paper, danger or quiet (a text button). */
export function kbutton(o: KitButtonOptions): string {
  const variant = o.variant ?? 'paper';
  const a: Attrs = {
    class: cls(`pw-btn${variant === 'primary' ? ' primary' : ''}`, o.className),
    'data-variant': variant,
    'data-size': o.size ?? 'm',
    'data-block': o.block ? '' : undefined,
    'aria-pressed': o.pressed === undefined ? undefined : String(o.pressed),
    ...tipAttrs(o.tip, o.tipKey),
    ...o.attrs,
  };
  const inner = `${o.icon ? icon(o.icon, 'icon pw-icon') : ''}<span class="pw-label">${esc(o.label)}</span>${o.afterHtml ?? ''}${o.key ? glyph(o.key, { className: o.hintKey ? 'pw-key hint-key' : 'pw-key' }) : ''}`;
  if (o.href !== undefined) return `<a${attrs({ ...a, href: o.href, 'aria-disabled': o.disabled ? 'true' : undefined })}>${inner}</a>`;
  return `<button${attrs({ type: 'button', ...a, disabled: !!o.disabled })}>${inner}</button>`;
}

export interface KitIconButtonOptions {
  icon: IconName;
  /** Accessible name; also the tooltip. */
  name: string;
  tip?: string;
  tipKey?: GlyphSpec;
  /** A small count in a pip. */
  badge?: string;
  /** 44 (default) or 52 (HUD). */
  size?: 's' | 'm';
  variant?: 'paper' | 'quiet' | 'danger';
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  attrs?: Attrs;
}

/** An icon-only button: aria-label and a tooltip, always. */
export function kiconButton(o: KitIconButtonOptions): string {
  return `<button${attrs({
    type: 'button',
    class: cls('pw-iconbtn', o.className),
    'data-size': o.size ?? 's',
    'data-variant': o.variant ?? 'paper',
    'aria-label': o.name,
    'aria-pressed': o.pressed === undefined ? undefined : String(o.pressed),
    ...tipAttrs(o.tip ?? o.name, o.tipKey),
    disabled: !!o.disabled,
    ...o.attrs,
  })}>${icon(o.icon, 'icon pw-icon')}${o.badge !== undefined ? `<span class="pw-pip num">${esc(o.badge)}</span>` : ''}</button>`;
}

// ---- Chip and badge -------------------------------------------------------------------------------

export interface KitChipOptions {
  icon?: IconName;
  /** The main text (a number goes in `value`). */
  label?: string;
  /** A number, in the display face. */
  value?: string;
  /** A quieter part after the value ("/ 300"). */
  suffix?: string;
  tone?: KitTone;
  /** 52px in the HUD, 36px in panels. */
  size?: 'hud' | 'panel';
  tip?: string;
  /** Trusted markup at the end (a meter). */
  afterHtml?: string;
  /** The chip is a button (opens something). */
  button?: boolean;
  className?: string;
  attrs?: Attrs;
}

export function kchip(o: KitChipOptions): string {
  const tag = o.button ? 'button' : 'span';
  return `<${tag}${attrs({
    type: o.button ? 'button' : undefined,
    class: cls('pw-chip', o.className),
    'data-size': o.size ?? 'panel',
    'data-tone': o.tone && o.tone !== 'plain' ? o.tone : undefined,
    ...tipAttrs(o.tip),
    ...o.attrs,
  })}>${o.icon ? icon(o.icon, 'icon pw-icon') : ''}${o.label ? `<span class="pw-chip-label">${esc(o.label)}</span>` : ''}${o.value !== undefined ? `<b class="num pw-chip-value">${esc(o.value)}</b>` : ''}${o.suffix ? `<span class="pw-chip-suffix num">${esc(o.suffix)}</span>` : ''}${o.afterHtml ?? ''}</${tag}>`;
}

export interface KitBadgeOptions {
  label: string;
  tone?: KitTone;
  icon?: IconName;
  tip?: string;
  className?: string;
  attrs?: Attrs;
}

/** A small uppercase pill: level, role, "Host", "Full", "Tracking". */
export function kbadge(o: KitBadgeOptions): string {
  return `<span${attrs({ class: cls('pw-badge', o.className), 'data-tone': o.tone && o.tone !== 'plain' ? o.tone : undefined, ...tipAttrs(o.tip), ...o.attrs })}>${o.icon ? icon(o.icon, 'icon pw-icon') : ''}<span>${esc(o.label)}</span></span>`;
}

// ---- Segmented control and toggle -------------------------------------------------------------------

export interface KitSegment {
  value: string;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  tip?: string;
}

export interface KitSegmentedOptions {
  /** The group's accessible name. */
  label: string;
  items: readonly KitSegment[];
  /** Written as `data-seg` (the screen finds the control by it). */
  id: string;
  className?: string;
  attrs?: Attrs;
}

/** A pill of choices; the chosen one is an ink fill. Buttons with aria-pressed. */
export function kseg(o: KitSegmentedOptions): string {
  return `<div${attrs({ class: cls('pw-seg', o.className), role: 'group', 'aria-label': o.label, 'data-seg': o.id, ...o.attrs })}>${o.items
    .map((i) => `<button${attrs({ type: 'button', 'data-v': i.value, 'aria-pressed': i.pressed ? 'true' : 'false', disabled: !!i.disabled, ...tipAttrs(i.tip) })}>${esc(i.label)}</button>`)
    .join('')}</div>`;
}

export interface KitToggleOptions {
  /** Accessible name (the row's label is visible beside it). */
  label: string;
  checked: boolean;
  id: string;
  disabled?: boolean;
  attrs?: Attrs;
}

/** An on/off switch: a button with role="switch" and aria-checked (reachable by the controller). */
export function ktoggle(o: KitToggleOptions): string {
  return `<button${attrs({ type: 'button', class: 'pw-toggle', role: 'switch', 'aria-checked': String(o.checked), 'aria-label': o.label, 'data-toggle': o.id, disabled: !!o.disabled, ...o.attrs })}><i></i></button>`;
}

// ---- Meter ----------------------------------------------------------------------------------------

export interface KitMeterOptions {
  label: string;
  /** 0–1. */
  value: number;
  /** Shown at the end ("8", "70%"); also the screen reader's value. */
  valueText?: string;
  segments?: number;
  /** ok (pencil / good), warn, hostile, friend (sky), progress (pencil). */
  tone?: 'progress' | 'good' | 'warn' | 'hostile' | 'friend';
  /** Hide the label visually (a meter inside a chip). */
  hideLabel?: boolean;
  className?: string;
  attrs?: Attrs;
}

/** A segmented bar with a label and a value. role="meter". */
export function kmeter(o: KitMeterOptions): string {
  const v = Math.max(0, Math.min(1, Number.isFinite(o.value) ? o.value : 0));
  const segs = Math.max(1, Math.round(o.segments ?? 10));
  const on = Math.round(v * segs);
  let cells = '';
  for (let i = 0; i < segs; i++) cells += `<i${i < on ? ' data-on' : ''}></i>`;
  return `<div${attrs({ class: cls('pw-meter', o.className), 'data-tone': o.tone ?? 'progress', 'data-hide-label': o.hideLabel ? '' : undefined, ...o.attrs })}>${o.hideLabel ? '' : `<span class="pw-meter-label">${esc(o.label)}</span>`}<span${attrs({
    class: 'pw-meter-track',
    role: 'meter',
    'aria-label': o.label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round(v * 100),
    'aria-valuetext': o.valueText,
  })}>${cells}</span>${o.valueText !== undefined && !o.hideLabel ? `<b class="num pw-meter-value">${esc(o.valueText)}</b>` : ''}</div>`;
}

/** Updates a kmeter in place (keeps the markup, moves the fill and the value). */
export function setMeter(el: Element | null, value: number, valueText?: string, tone?: KitMeterOptions['tone']): void {
  if (!el) return;
  const track = el.querySelector('.pw-meter-track');
  if (!track) return;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const cells = track.children;
  const on = Math.round(v * cells.length);
  for (let i = 0; i < cells.length; i++) cells[i].toggleAttribute('data-on', i < on);
  const now = String(Math.round(v * 100));
  if (track.getAttribute('aria-valuenow') !== now) track.setAttribute('aria-valuenow', now);
  if (valueText !== undefined) {
    track.setAttribute('aria-valuetext', valueText);
    const b = el.querySelector('.pw-meter-value');
    if (b && b.textContent !== valueText) b.textContent = valueText;
  }
  if (tone && (el as HTMLElement).dataset.tone !== tone) (el as HTMLElement).dataset.tone = tone;
}

// ---- Tabs ------------------------------------------------------------------------------------------

export interface KitTab {
  id: string;
  label: string;
  icon?: IconName;
  selected?: boolean;
  /** A count after the label. */
  count?: string;
}

/** Tabs shaped like a segmented control (the design's tab nav), or a vertical list (`vertical`). */
export function ktabs(o: { id: string; label: string; tabs: readonly KitTab[]; vertical?: boolean; className?: string }): string {
  const selected = o.tabs.find((t) => t.selected) ?? o.tabs[0];
  return `<div${attrs({ class: cls(o.vertical ? 'pw-vtabs' : 'pw-seg pw-tabs', o.className), role: 'tablist', 'aria-label': o.label, 'aria-orientation': o.vertical ? 'vertical' : undefined, id: o.id })}>${o.tabs
    .map((t) => {
      const on = t === selected;
      return `<button${attrs({ type: 'button', role: 'tab', id: `${o.id}-${t.id}`, 'data-tab': t.id, 'aria-selected': String(on), 'aria-pressed': String(on), tabindex: on ? 0 : -1 })}>${t.icon ? icon(t.icon, 'icon pw-icon') : ''}<span>${esc(t.label)}</span>${t.count ? `<span class="pw-tab-count num">${esc(t.count)}</span>` : ''}</button>`;
    })
    .join('')}</div>`;
}

// ---- Drawer ----------------------------------------------------------------------------------------

export interface DrawerOptions {
  id: string;
  title: string;
  icon?: IconName;
  /** A count badge after the title ("4 / 6"). */
  count?: string;
  /** Trusted markup after the title (the reroll button). */
  headHtml?: string;
  bodyHtml: string;
  footHtml?: string;
  closeName: string;
  closeKey?: GlyphSpec;
  className?: string;
}

/** The right drawer: 400px, from 104px below the top to above the dock; head, scrolling body, foot. */
export function drawer(o: DrawerOptions): string {
  const titleId = `${o.id}-title`;
  return `<aside${attrs({ class: cls('pw-drawer', o.className), id: o.id, role: 'dialog', 'aria-labelledby': titleId })}>
    <header class="pw-drawer-head">${o.icon ? icon(o.icon, 'icon pw-icon pw-drawer-icon') : ''}<h2 class="pw-drawer-title" id="${esc(titleId)}">${esc(o.title)}</h2>${o.count !== undefined ? `<span class="pw-badge num" data-d="count">${esc(o.count)}</span>` : ''}<span class="pw-drawer-extra">${o.headHtml ?? ''}</span>${kiconButton({ icon: 'close', name: o.closeName, tipKey: o.closeKey, attrs: { 'data-act': 'close' } })}</header>
    <div class="pw-drawer-body" data-nav-scroll>${o.bodyHtml}</div>
    ${o.footHtml ? `<footer class="pw-drawer-foot">${o.footHtml}</footer>` : ''}
  </aside>`;
}

// ---- Dock and tray ----------------------------------------------------------------------------------

export interface DockButtonOptions {
  id: string;
  icon: IconName;
  label: string;
  key?: GlyphSpec;
  active?: boolean;
  /** A count in a pencil pip. */
  pip?: string;
  tip?: string;
  disabled?: boolean;
}

export function dockButton(o: DockButtonOptions): string {
  return `<button${attrs({ type: 'button', class: 'pw-dock-btn', 'data-dock': o.id, 'aria-pressed': String(!!o.active), disabled: !!o.disabled, ...tipAttrs(o.tip ?? o.label, o.key) })}>${o.pip !== undefined ? `<span class="pw-pip num">${esc(o.pip)}</span>` : ''}${icon(o.icon, 'icon pw-icon')}<span class="pw-dock-label">${esc(o.label)}</span>${o.key ? glyph(o.key, { className: 'pw-key hint-key' }) : ''}</button>`;
}

/** The dock: one row, bottom centre. `mainHtml` (the big context button) comes after a divider. */
export function dock(o: { label: string; itemsHtml: string; mainHtml?: string }): string {
  return `<nav${attrs({ class: 'pw-dock', 'aria-label': o.label })}>${o.itemsHtml}${o.mainHtml ? `<span class="pw-dock-rule" aria-hidden="true"></span>${o.mainHtml}` : ''}</nav>`;
}

/** The build tray that sits on the dock: category tabs and a row of cards. */
export function tray(o: { label: string; tabsHtml: string; cardsHtml: string }): string {
  return `<section${attrs({ class: 'pw-tray', role: 'group', 'aria-label': o.label })}><div class="pw-tray-tabs">${o.tabsHtml}</div><div class="pw-tray-row" data-t="row">${o.cardsHtml}</div></section>`;
}

// ---- Status bar, feed, toast ------------------------------------------------------------------------

/** One bar split into cells by 2px rules. Each cell is trusted markup. */
export function statusBar(o: { label: string; cellsHtml: readonly string[]; className?: string }): string {
  return `<div${attrs({ class: cls('pw-status', o.className), role: 'group', 'aria-label': o.label })}>${o.cellsHtml.map((c) => `<span class="pw-status-cell">${c}</span>`).join('')}</div>`;
}

export interface FeedRowOptions {
  /** Who did it, and their team colour (a CSS colour from the tokens, `var(--team-3)`). */
  left: { name: string; colour: string };
  action: IconName;
  actionLabel: string;
  right?: { name: string; colour: string };
  /** The player is involved: a sky-blue left bar. */
  you?: boolean;
  /** Older rows drop to 60% opacity. */
  old?: boolean;
  /** Trusted markup at the end ("+120"). */
  endHtml?: string;
}

/** A kill feed row: team dot, name, action icon, team dot, name. Every row the same width. */
export function feedRow(o: FeedRowOptions): string {
  const dot = (c: string): string => `<i class="pw-dot" style="--dot:${esc(c)}"></i>`;
  return `<li${attrs({ class: 'pw-feed-row', 'data-you': o.you ? '' : undefined, 'data-old': o.old ? '' : undefined })}>${dot(o.left.colour)}<span class="pw-feed-name">${esc(o.left.name)}</span><span class="pw-feed-act" role="img" aria-label="${esc(o.actionLabel)}">${icon(o.action, 'icon pw-icon')}</span>${o.right ? `${dot(o.right.colour)}<span class="pw-feed-name">${esc(o.right.name)}</span>` : '<span></span><span></span>'}<span class="pw-feed-end num">${o.endHtml ?? ''}</span></li>`;
}

/** A one-line toast with an icon: top centre, 2.5 seconds. */
export function toast(o: { icon: IconName; text: string; tone?: KitTone; value?: string }): string {
  return `<div${attrs({ class: 'pw-toast', role: o.tone === 'hostile' ? 'alert' : 'status', 'data-tone': o.tone && o.tone !== 'plain' ? o.tone : undefined })}>${icon(o.icon, 'icon pw-icon')}<span>${esc(o.text)}</span>${o.value ? `<b class="num">${esc(o.value)}</b>` : ''}</div>`;
}

// ---- Result card ---------------------------------------------------------------------------------

export interface ResultCardOptions {
  icon: IconName;
  tone: 'good' | 'hostile' | 'warn';
  status: string;
  title: string;
  meta: string;
  /** Four [icon, value, label] tiles. */
  tiles: ReadonlyArray<readonly [IconName, string, string]>;
  /** One short tip, shown while Details is closed. */
  tip?: string;
  detailsHtml: string;
  detailsOpen: boolean;
  detailsLabel: string;
  continueLabel: string;
  continueKey?: GlyphSpec;
}

/** The single centred 640px result panel. */
export function resultCard(o: ResultCardOptions): string {
  return `<section class="pw-result pw-panel" role="dialog" aria-labelledby="pw-result-title" data-tone="${o.tone}">
    <span class="pw-result-icon">${icon(o.icon, 'icon pw-icon')}</span>
    <p class="pw-result-status">${esc(o.status)}</p>
    <h2 class="pw-result-title" id="pw-result-title">${esc(o.title)}</h2>
    <p class="pw-result-meta">${esc(o.meta)}</p>
    <div class="pw-result-tiles">${o.tiles.map(([i, v, l]) => `<div class="pw-tile" role="group" aria-label="${esc(l)}">${icon(i, 'icon pw-icon')}<b class="num">${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
    ${o.detailsOpen ? `<div class="pw-result-details" id="pw-result-details">${o.detailsHtml}</div>` : o.tip ? `<p class="pw-result-tip">${icon('tip', 'icon pw-icon')}<span>${esc(o.tip)}</span></p>` : ''}
    <footer class="pw-result-foot">${kbutton({ label: o.detailsLabel, variant: 'quiet', icon: 'more', size: 's', className: o.detailsOpen ? 'open' : undefined, attrs: { 'data-act': 'details', 'aria-expanded': String(o.detailsOpen), 'aria-controls': 'pw-result-details' } })}${kbutton({ label: o.continueLabel, variant: 'primary', size: 'l', key: o.continueKey, attrs: { 'data-act': 'continue', 'data-nav-default': '' } })}</footer>
  </section>`;
}

// ---- Coach mark ---------------------------------------------------------------------------------

export interface CoachOptions {
  step: string;
  text: string;
  /** Trusted markup: the key glyph(s). */
  keysHtml?: string;
  skipLabel: string;
  /** Where the arrow points from the note: the side of the note it sits on. */
  arrow: 'up' | 'down' | 'left' | 'right' | 'none';
  name: string;
}

/** A small paper note in Kalam (≤320px), anchored to what it explains by an arrow. */
export function coach(o: CoachOptions): string {
  return `<aside${attrs({ class: 'pw-coach', role: 'note', 'aria-label': o.name, 'data-arrow': o.arrow })}><span class="pw-coach-step num">${esc(o.step)}</span><p class="pw-coach-text">${esc(o.text)}</p><div class="pw-coach-foot">${o.keysHtml ?? ''}<button type="button" class="pw-coach-skip" data-act="skip-tutorial">${esc(o.skipLabel)}</button></div></aside>`;
}

// ---- Field ------------------------------------------------------------------------------------------

export interface FieldOptions {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  value?: string;
  placeholder?: string;
  icon?: IconName;
  help?: string;
  error?: string;
  /** A green check at the end. */
  valid?: boolean;
  validLabel?: string;
  autocomplete?: string;
  /** Trusted markup inside the box at the end (show / hide). */
  trailingHtml?: string;
  /** Trusted markup under the box (a strength meter). */
  belowHtml?: string;
  maxLength?: number;
  className?: string;
  attrs?: Attrs;
}

/** A labelled text input with help and error states. */
export function field(o: FieldOptions): string {
  const helpId = `${o.id}-help`;
  const msg = o.error ?? o.help;
  return `<div${attrs({ class: cls('pw-field', o.className), 'data-error': o.error ? '' : undefined, 'data-valid': o.valid ? '' : undefined })}>
    <label class="pw-field-label" for="${esc(o.id)}">${esc(o.label)}</label>
    <span class="pw-field-box">${o.icon ? icon(o.icon, 'icon pw-icon') : ''}<input${attrs({
      id: o.id,
      name: o.id,
      type: o.type ?? 'text',
      value: o.value,
      placeholder: o.placeholder,
      autocomplete: o.autocomplete,
      maxlength: o.maxLength,
      spellcheck: 'false',
      'aria-invalid': o.error ? 'true' : undefined,
      'aria-describedby': msg ? helpId : undefined,
      ...o.attrs,
    })}>${o.valid ? `<span class="pw-field-ok" role="img" aria-label="${esc(o.validLabel ?? '')}">${icon('ok', 'icon pw-icon')}</span>` : ''}${o.trailingHtml ?? ''}</span>
    ${o.belowHtml ?? ''}
    ${msg ? `<span class="pw-field-help" id="${esc(helpId)}"${o.error ? ' role="alert"' : ''}>${esc(msg)}</span>` : ''}
  </div>`;
}

/** A checkbox with its label (trusted markup: it may hold links). */
export function checkbox(o: { id: string; labelHtml: string; checked: boolean }): string {
  return `<label class="pw-check"><input type="checkbox" id="${esc(o.id)}"${o.checked ? ' checked' : ''}><span class="pw-check-box">${icon('check', 'icon pw-icon')}</span><span class="pw-check-label">${o.labelHtml}</span></label>`;
}

// ---- Card ---------------------------------------------------------------------------------------

export interface SelectCardOptions {
  /** Trusted markup: the art area (an image, a mini layout). */
  artHtml?: string;
  title: string;
  /** The footer tag ("8 desks", "Fighter", a price). */
  tag?: string;
  /** Trusted markup instead of the plain tag. */
  tagHtml?: string;
  selected?: boolean;
  /** Locked: 40% opacity with a lock badge. */
  locked?: string;
  disabled?: boolean;
  tip?: string;
  /** A row (art left) instead of a tile. */
  row?: boolean;
  /** Trusted markup in the art's corner (a fit icon). */
  cornerHtml?: string;
  className?: string;
  attrs?: Attrs;
}

/** The selectable tile: an art area and a footer; selected sky-500, locked dimmed with a badge. */
export function selectCard(o: SelectCardOptions): string {
  return `<button${attrs({
    type: 'button',
    class: cls('pw-card', o.className),
    'data-row': o.row ? '' : undefined,
    'aria-pressed': String(!!o.selected),
    'data-locked': o.locked ? '' : undefined,
    disabled: !!o.disabled,
    'aria-disabled': o.locked ? 'true' : undefined,
    ...tipAttrs(o.tip),
    ...o.attrs,
  })}>${o.artHtml !== undefined ? `<span class="pw-card-art">${o.artHtml}${o.locked ? `<span class="pw-badge pw-card-lock">${icon('lock', 'icon pw-icon')}<span>${esc(o.locked)}</span></span>` : ''}${o.cornerHtml ?? ''}</span>` : ''}<span class="pw-card-foot"><span class="pw-card-title">${esc(o.title)}</span>${o.tagHtml ?? (o.tag ? `<span class="pw-card-tag">${esc(o.tag)}</span>` : '')}</span></button>`;
}

// ---- Rows ---------------------------------------------------------------------------------------

/** A key-value row on a rule line. */
export function kvRow(label: string, valueHtml: string): string {
  return `<div class="pw-kv"><span class="pw-kv-label">${esc(label)}</span><span class="pw-kv-value">${valueHtml}</span></div>`;
}

/** A settings row: label (16/800), at most one 13px line, the control on the right. */
export function settingRow(o: { label: string; desc?: string; controlHtml: string; id?: string }): string {
  return `<div${attrs({ class: 'pw-setting', 'data-row': o.id })}><span class="pw-setting-text"><span class="pw-setting-label">${esc(o.label)}</span>${o.desc ? `<span class="pw-setting-desc">${esc(o.desc)}</span>` : ''}</span><span class="pw-setting-control">${o.controlHtml}</span></div>`;
}

/** The uppercase section label. */
export function sectionLabel(text: string, id?: string): string {
  return `<h3${attrs({ class: 'pw-section', id })}>${esc(text)}</h3>`;
}

/** A round avatar: the first letter on a team colour. */
export function avatar(o: { name: string; colour: string; size?: 's' | 'm' }): string {
  const letter = Array.from(o.name.trim())[0]?.toUpperCase() ?? '?';
  return `<span class="pw-avatar" data-size="${o.size ?? 'm'}" style="--av:${esc(o.colour)}" aria-hidden="true">${esc(letter)}</span>`;
}

/** A number stepper: − value + and a note. */
export function stepper(o: { id: string; label: string; value: number; min: number; max: number; decName: string; incName: string; note?: string }): string {
  return `<div class="pw-stepper" role="group" aria-label="${esc(o.label)}" data-stepper="${esc(o.id)}">${kiconButton({ icon: 'minus', name: o.decName, disabled: o.value <= o.min, attrs: { 'data-step': '-1' } })}<b class="num pw-stepper-value" aria-live="polite">${o.value}</b>${kiconButton({ icon: 'plus', name: o.incName, disabled: o.value >= o.max, attrs: { 'data-step': '1' } })}${o.note ? `<span class="pw-stepper-note">${esc(o.note)}</span>` : ''}</div>`;
}

/** Colour swatches (44px), each a button with its name. */
export function swatches(o: { id: string; label: string; items: ReadonlyArray<{ value: string; name: string; colour: string; selected: boolean }> }): string {
  return `<div class="pw-swatches" role="group" aria-label="${esc(o.label)}" data-seg="${esc(o.id)}">${o.items
    .map((s) => `<button type="button" class="pw-swatch" data-v="${esc(s.value)}" aria-pressed="${s.selected}" aria-label="${esc(s.name)}" data-tip="${esc(s.name)}" style="--sw:${esc(s.colour)}"></button>`)
    .join('')}</div>`;
}

/** The OR divider. */
export function divider(label: string): string {
  return `<div class="pw-divider" role="separator"><span>${esc(label)}</span></div>`;
}

/** The brand: the logo tile and the word mark. */
export function brand(name: string): string {
  return `<div class="pw-brand"><span class="pw-logo">${icon('send', 'icon pw-icon')}</span><span class="pw-wordmark">${esc(name)}</span></div>`;
}

/** Plane or building art: a thumbnail image when one was drawn, else the line icon. */
export function art(src: string | null, fallback: IconName, alt = ''): string {
  return src ? `<img class="pw-art" src="${esc(src)}" alt="${esc(alt)}" draggable="false">` : `<span class="pw-art pw-art-icon">${icon(fallback, 'icon pw-icon')}</span>`;
}
