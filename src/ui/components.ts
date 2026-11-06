/**
 * The shared component set (docs/DESIGN_SYSTEM.md, plan v0.0.15 §1B).
 *
 * Each component is a function that returns an HTML string, like the rest of the HUD (modules
 * write `innerHTML` and update in place). Styles are in components.css and use only tokens.
 *
 * Rules every component follows:
 * - No literal user-facing text: every word comes in as an argument (from the dictionary,
 *   src/ui/strings.ts). Arguments named `…Html` are trusted markup (other components); every
 *   other string is escaped.
 * - States are data attributes: `data-state` = hover | focused | pressed | warning | critical
 *   (absent = default); disabled is the `disabled` attribute (or `aria-disabled`). Real hover,
 *   focus and press use the same rules as the forced states, so the gallery shows what players see.
 * - Every interactive component has a role and an accessible name.
 * - Sizes are in tokens and em, so components follow the HUD size and the text scale.
 */

import { esc } from './dom';
import { level as levelOf } from './format';
import { icon, type IconName } from './icons';
import { glyphText, keyTip, type GlyphDevice, type GlyphSpec } from '../input/glyphs';
import './fonts';
import './components.css';

// ---- Shared ------------------------------------------------------------------------------------------

export type UiState = 'default' | 'hover' | 'focused' | 'pressed' | 'disabled' | 'warning' | 'critical';
export const UI_STATES: readonly UiState[] = ['default', 'hover', 'focused', 'pressed', 'disabled', 'warning', 'critical'];

/** A colour meaning for chips, cards and stats. */
export type Tone = 'plain' | 'good' | 'friend' | 'hostile' | 'warn' | 'gold' | 'streak' | 'objective';

/** Extra attributes: string values are escaped; true writes a bare attribute; false / undefined is skipped. */
export type Attrs = Record<string, string | number | boolean | undefined>;

export function attrs(map: Attrs): string {
  let out = '';
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined || v === false) continue;
    out += v === true ? ` ${k}` : ` ${k}="${esc(String(v))}"`;
  }
  return out;
}

interface Common {
  state?: UiState;
  /** Extra classes. */
  className?: string;
  attrs?: Attrs;
}

function stateAttrs(state: UiState | undefined, disabledAttr: 'disabled' | 'aria-disabled' = 'disabled'): Attrs {
  if (!state || state === 'default') return {};
  if (state === 'disabled') return { [disabledAttr]: disabledAttr === 'disabled' ? true : 'true', 'data-state': 'disabled' };
  return { 'data-state': state };
}

function cls(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

// ---- Glyph ---------------------------------------------------------------------------------------------

export interface GlyphOptions {
  /**
   * Draw for this device and keep it (the gallery). Leave it out in the HUD: the glyph is written
   * with the keyboard key and relabelled live for the controller in use (applyGlyphs).
   */
  device?: GlyphDevice;
  /**
   * The label already names the device's control (text from `controlLabel`, which follows the
   * device): show it as written, never relabel it.
   */
  literal?: boolean;
  className?: string;
}

/** A key cap or controller button for a binding. Empty when the device has no equivalent. */
export function glyph(spec: GlyphSpec, opts: GlyphOptions = {}): string {
  const fixed = opts.device !== undefined || opts.literal === true || spec.literal === true;
  const label = opts.device !== undefined ? glyphText(spec, opts.device) : spec.key;
  if (fixed && label === '') return '';
  return `<kbd${attrs({
    class: cls('ui-glyph', opts.className),
    'data-pad': spec.pad,
    'data-pad-text': spec.padText,
    'data-device': opts.device,
    'data-glyph-fixed': fixed,
    'data-key': fixed ? spec.key : undefined,
  })}>${esc(label)}</kbd>`;
}

// ---- Tooltip -------------------------------------------------------------------------------------------

/**
 * Attributes that give an element a tooltip: `data-tip` (shown on hover, on focus after a short
 * delay, and by the info button; see src/input/FocusNav.ts) and, with an id, `aria-describedby`
 * pointing at a `tooltip()` element for screen readers.
 */
export function tooltipAttrs(text: string, describedBy?: string): Attrs {
  return { 'data-tip': text, 'aria-describedby': describedBy };
}

/**
 * A tooltip that names its binding, "Base (B)": written for the keyboard and relabelled for the
 * controller in use by applyGlyphs ("Base (Y)", "Base (△)", or just "Base" without an equivalent).
 */
export function keyTipAttrs(text: string, spec: GlyphSpec): Attrs {
  return { 'data-tip': keyTip(text, spec.key), 'data-tip-text': text, 'data-tip-key': spec.key, 'data-tip-pad': spec.pad, 'data-tip-pad-text': spec.padText };
}

export interface TooltipOptions {
  id: string;
  text: string;
  /** Shown in place (the gallery, a static explanation); otherwise hidden and read by screen readers. */
  open?: boolean;
  className?: string;
}

export function tooltip(o: TooltipOptions): string {
  return `<span${attrs({ class: cls('ui-tooltip', o.className), role: 'tooltip', id: o.id, 'data-open': o.open ? 'true' : undefined })}>${esc(o.text)}</span>`;
}

// ---- Card ----------------------------------------------------------------------------------------------

export interface CardOptions extends Common {
  /** The card's content (trusted markup). */
  bodyHtml: string;
  title?: string;
  icon?: IconName;
  /** Accessible name when there is no visible title. */
  label?: string;
  id?: string;
  tone?: Tone;
  elevation?: 'flat' | 'raised' | 'floating';
  /** The folded corner (default on). */
  fold?: boolean;
}

export function card(o: CardOptions): string {
  const titleId = o.title && o.id ? `${o.id}-title` : undefined;
  const head = o.title
    ? `<header class="ui-card-head">${o.icon ? icon(o.icon, 'icon ui-icon') : ''}<span class="ui-card-title"${attrs({ id: titleId })}>${esc(o.title)}</span></header>`
    : '';
  return `<section${attrs({
    class: cls('ui-card', o.className),
    id: o.id,
    role: 'group',
    'aria-labelledby': titleId,
    'aria-label': titleId ? undefined : (o.label ?? o.title),
    'data-tone': o.tone && o.tone !== 'plain' ? o.tone : undefined,
    'data-elevation': o.elevation && o.elevation !== 'raised' ? o.elevation : undefined,
    'data-fold': o.fold === false ? 'none' : undefined,
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}>${head}<div class="ui-card-body">${o.bodyHtml}</div></section>`;
}

// ---- Chip ----------------------------------------------------------------------------------------------

export interface ChipOptions extends Common {
  label: string;
  /** A number shown in the number face after the label. */
  value?: string;
  icon?: IconName;
  tone?: Tone;
  tip?: string;
}

export function chip(o: ChipOptions): string {
  return `<span${attrs({
    class: cls('ui-chip', o.className),
    'data-tone': o.tone && o.tone !== 'plain' ? o.tone : undefined,
    ...(o.tip ? tooltipAttrs(o.tip) : {}),
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}>${o.icon ? icon(o.icon, 'icon ui-icon') : ''}<span class="ui-label">${esc(o.label)}</span>${o.value !== undefined ? `<b class="num">${esc(o.value)}</b>` : ''}</span>`;
}

// ---- Button --------------------------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonOptions extends Common {
  label: string;
  variant?: ButtonVariant;
  icon?: IconName;
  /** The binding shown as a key cap or controller glyph. */
  key?: GlyphSpec;
  /** Draw the glyph for this device (gallery); omit in the HUD to follow the device live. */
  device?: GlyphDevice;
  size?: 'small' | 'normal' | 'big';
  tip?: string;
  /** The binding the tooltip names ("Base (B)"), following the device. */
  tipKey?: GlyphSpec;
  id?: string;
  disabled?: boolean;
}

export function button(o: ButtonOptions): string {
  const variant = o.variant ?? 'secondary';
  const disabled = o.disabled || o.state === 'disabled';
  return `<button${attrs({
    type: 'button',
    class: cls(`ui-button${variant === 'primary' ? ' primary' : ''}`, o.className),
    id: o.id,
    'data-variant': variant,
    'data-size': o.size && o.size !== 'normal' ? o.size : undefined,
    ...(o.tip ? (o.tipKey ? keyTipAttrs(o.tip, o.tipKey) : tooltipAttrs(o.tip)) : {}),
    ...stateAttrs(o.state),
    disabled,
    ...o.attrs,
  })}>${o.icon ? icon(o.icon, 'icon ui-icon') : ''}<span class="ui-label">${esc(o.label)}</span>${o.key ? glyph(o.key, { device: o.device }) : ''}</button>`;
}

// ---- Icon button ---------------------------------------------------------------------------------------

export interface IconButtonOptions extends Common {
  icon: IconName;
  /** The accessible name (also the tooltip unless `tip` is given). */
  name: string;
  tip?: string;
  /** The binding the tooltip names ("Base (B)"), following the device. */
  tipKey?: GlyphSpec;
  key?: GlyphSpec;
  device?: GlyphDevice;
  /** A small count in the corner ("3"). */
  badge?: string;
  id?: string;
  disabled?: boolean;
}

export function iconButton(o: IconButtonOptions): string {
  const disabled = o.disabled || o.state === 'disabled';
  return `<button${attrs({
    type: 'button',
    class: cls('ui-icon-button', o.className),
    id: o.id,
    'aria-label': o.name,
    ...(o.tipKey ? keyTipAttrs(o.tip ?? o.name, o.tipKey) : tooltipAttrs(o.tip ?? o.name)),
    ...stateAttrs(o.state),
    disabled,
    ...o.attrs,
  })}>${icon(o.icon, 'icon ui-icon')}${o.badge !== undefined ? `<span class="ui-badge num">${esc(o.badge)}</span>` : ''}${o.key ? glyph(o.key, { device: o.device, className: 'ui-corner' }) : ''}</button>`;
}

/** The info button: an icon button that opens its tooltip (Y / Triangle on a controller). */
export function infoButton(o: { name: string; tip: string; key?: GlyphSpec; device?: GlyphDevice; state?: UiState }): string {
  return iconButton({ icon: 'info', name: o.name, tip: o.tip, key: o.key, device: o.device, state: o.state, className: 'ui-info', attrs: { 'data-info': '' } });
}

// ---- Bar -----------------------------------------------------------------------------------------------

export type BarLevel = 'ok' | 'worn' | 'critical';

export interface BarOptions extends Common {
  /** 0–1. */
  value: number;
  /** Accessible name ("Health"). */
  label: string;
  /** Text for screen readers ("62 %"); defaults to the percentage number. */
  valueText?: string;
  /** Override the level (default from format.level: >0.6 ok, >0.3 worn, else critical). */
  level?: BarLevel;
  /** A bar that is not about condition (progress, boost) keeps one colour. */
  kind?: 'level' | 'progress' | 'boost' | 'capacity';
  size?: 'normal' | 'thin' | 'mini';
  /** Segments in the track (the style guide's Meter): 10 by default, 0 for a plain fill. Thin and mini bars are plain. */
  segments?: number;
}

export function bar(o: BarOptions): string {
  const v = Math.max(0, Math.min(1, Number.isFinite(o.value) ? o.value : 0));
  const pctValue = Math.round(v * 100);
  const lvl = o.level ?? levelOf(v);
  return `<div${attrs({
    class: cls('ui-bar', o.className),
    role: 'meter',
    'aria-label': o.label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': pctValue,
    'aria-valuetext': o.valueText,
    'data-kind': o.kind && o.kind !== 'level' ? o.kind : undefined,
    'data-level': lvl,
    'data-size': o.size && o.size !== 'normal' ? o.size : undefined,
    'data-segments': o.segments !== undefined ? Math.max(0, Math.round(o.segments)) : undefined,
    style: o.segments ? `--segs:${Math.max(1, Math.round(o.segments))}` : undefined,
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}><i style="width:${pctValue}%"></i></div>`;
}

// ---- Meter ---------------------------------------------------------------------------------------------

export interface MeterOptions extends Omit<BarOptions, 'label'> {
  /** What it measures ("Hull"): shown and the accessible name. */
  label: string;
  /** The value as text ("70%"), already formatted. */
  valueText: string;
  icon?: IconName;
}

/**
 * The style guide's Meter: the label, a segmented bar and the value as text. Low (≤ 30%, or level
 * critical) turns raid-500 and is hatched; progress and boost fill pencil.
 */
export function meter(o: MeterOptions): string {
  const v = Math.max(0, Math.min(1, Number.isFinite(o.value) ? o.value : 0));
  const lvl = o.level ?? levelOf(v);
  const low = (o.kind ?? 'level') === 'level' && lvl === 'critical';
  return `<div${attrs({ class: cls('ui-meter', o.className), 'data-low': low ? '' : undefined })}><span class="ui-meter-label">${o.icon ? icon(o.icon, 'icon ui-icon') : ''}<span>${esc(o.label)}</span></span>${bar({ ...o, attrs: undefined, className: undefined, value: v, level: lvl, segments: o.segments ?? 10 })}<b class="num">${esc(o.valueText)}</b></div>`;
}

// ---- Stat ----------------------------------------------------------------------------------------------

export interface StatOptions extends Common {
  icon: IconName;
  /** The number, already formatted (format.ts). */
  value: string;
  /** What it is ("Paper"): the accessible name and tooltip. */
  label: string;
  /** A change, already formatted ("+12"), shown as a pop. */
  delta?: string;
  deltaTone?: 'good' | 'bad';
  /** A small unit or "of" after the number ("/ 400"). */
  suffix?: string;
  tone?: Tone;
}

export function stat(o: StatOptions): string {
  return `<span${attrs({
    class: cls('ui-stat', o.className),
    role: 'group',
    'aria-label': o.label,
    ...tooltipAttrs(o.label),
    'data-tone': o.tone && o.tone !== 'plain' ? o.tone : undefined,
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}>${icon(o.icon, 'icon ui-icon')}<b class="num">${esc(o.value)}</b>${o.suffix ? `<span class="ui-suffix num">${esc(o.suffix)}</span>` : ''}${o.delta ? `<em${attrs({ class: 'ui-delta num', 'data-tone': o.deltaTone })}>${esc(o.delta)}</em>` : ''}</span>`;
}

// ---- Pips ----------------------------------------------------------------------------------------------

export interface PipsOptions extends Common {
  filled: number;
  total: number;
  /** Accessible name with the count ("Threat 2 of 3"). */
  label: string;
  tone?: Tone | 'threat';
  shape?: 'dot' | 'bar';
}

export function pips(o: PipsOptions): string {
  const total = Math.max(0, Math.round(o.total));
  const filled = Math.max(0, Math.min(total, Math.round(o.filled)));
  let inner = '';
  for (let i = 0; i < total; i++) inner += `<i${i < filled ? ' data-on' : ''}></i>`;
  return `<span${attrs({
    class: cls('ui-pips', o.className),
    role: 'img',
    'aria-label': o.label,
    'data-tone': o.tone && o.tone !== 'plain' ? o.tone : undefined,
    'data-shape': o.shape && o.shape !== 'dot' ? o.shape : undefined,
    'data-filled': filled,
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}>${inner}</span>`;
}

// ---- Alert ---------------------------------------------------------------------------------------------

export type Severity = 'info' | 'good' | 'warning' | 'critical';

export interface AlertOptions extends Common {
  title: string;
  /** One value (a number, a distance), already formatted. */
  value?: string;
  icon?: IconName;
  severity?: Severity;
  /** Repeats, already formatted ("×3"). */
  count?: string;
}

/** Critical alerts are `role="alert"` (read at once); the rest `role="status"`. At most three show (Alerts.ts). */
export function alert(o: AlertOptions): string {
  const severity = o.severity ?? 'info';
  return `<div${attrs({
    class: cls('ui-alert', o.className),
    role: severity === 'critical' ? 'alert' : 'status',
    'data-severity': severity,
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}>${o.icon ? icon(o.icon, 'icon ui-icon') : ''}<span class="ui-alert-title">${esc(o.title)}</span>${o.value ? `<b class="num">${esc(o.value)}</b>` : ''}${o.count ? `<span class="ui-alert-count num">${esc(o.count)}</span>` : ''}</div>`;
}

// ---- Caption -------------------------------------------------------------------------------------------

export interface CaptionOptions extends Common {
  /** What the sound means, in a few words ("Rocket lock"). Shown in brackets (CSS), like a subtitle. */
  text: string;
  icon?: IconName;
  /**
   * Where it came from, relative to the view (radians: 0 ahead, positive to the right), when
   * known: an arrow turned that way, named by `directionLabel` for screen readers.
   */
  direction?: number | null;
  directionLabel?: string;
}

/** A sound caption (plan v0.0.15 §8D): "[Rocket lock]" with an icon and, when known, a direction arrow. */
export function caption(o: CaptionOptions): string {
  const dir = typeof o.direction === 'number' && Number.isFinite(o.direction);
  const deg = dir ? Math.round((o.direction! * 180) / Math.PI) : 0;
  return `<div${attrs({ class: cls('ui-caption', o.className), role: 'status', ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}>${o.icon ? icon(o.icon, 'icon ui-icon') : ''}<span class="ui-caption-text">${esc(o.text)}</span>${dir
    ? `<span class="ui-caption-dir" role="img"${attrs({ 'aria-label': o.directionLabel })} style="--dir: ${deg}deg"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 L10.5 10 L6 7.6 L1.5 10 Z" fill="currentColor"/></svg></span>`
    : ''}</div>`;
}

// ---- List / grid ---------------------------------------------------------------------------------------

export interface ListOptions extends Common {
  /** Accessible name of the collection. */
  label: string;
  /** Each item's markup (plane cards, mission cards, slots, rows). */
  itemsHtml: readonly string[];
  layout?: 'list' | 'grid' | 'row';
  /** Grid columns (layout 'grid'). */
  columns?: number;
  /** A long list that triggers / PageUp / PageDown scroll. */
  scroll?: boolean;
}

export function list(o: ListOptions): string {
  const layout = o.layout ?? 'list';
  return `<ul${attrs({
    class: cls('ui-list', o.className),
    role: 'list',
    'aria-label': o.label,
    'data-layout': layout,
    'data-nav-scroll': o.scroll ? '' : undefined,
    style: layout === 'grid' && o.columns ? `--cols:${Math.max(1, Math.round(o.columns))}` : undefined,
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}>${o.itemsHtml.map((h) => `<li>${h}</li>`).join('')}</ul>`;
}

// ---- Tabs ----------------------------------------------------------------------------------------------

export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
  selected?: boolean;
  disabled?: boolean;
  state?: UiState;
  /** A count or note after the label, already formatted. */
  badge?: string;
}

export interface TabsOptions extends Common {
  /** Prefix for the tab and panel ids. */
  id: string;
  /** Accessible name of the tab list. */
  label: string;
  tabs: readonly TabItem[];
  /** The bindings that switch tabs (Q / E, LB / RB), shown at the ends. */
  prev?: GlyphSpec;
  next?: GlyphSpec;
  device?: GlyphDevice;
}

export const tabId = (tabsId: string, tab: string): string => `${tabsId}-tab-${tab}`;
export const panelId = (tabsId: string, tab: string): string => `${tabsId}-panel-${tab}`;

export function tabs(o: TabsOptions): string {
  const selected = o.tabs.find((t) => t.selected) ?? o.tabs[0];
  const items = o.tabs.map((t) => {
    const on = t === selected;
    return `<button${attrs({
      type: 'button',
      class: 'ui-tab',
      role: 'tab',
      id: tabId(o.id, t.id),
      'aria-selected': on ? 'true' : 'false',
      'aria-controls': panelId(o.id, t.id),
      tabindex: on ? 0 : -1,
      'data-tab': t.id,
      ...stateAttrs(t.state),
      disabled: t.disabled || t.state === 'disabled',
    })}>${t.icon ? icon(t.icon, 'icon ui-icon') : ''}<span class="ui-label">${esc(t.label)}</span>${t.badge ? `<span class="ui-badge num">${esc(t.badge)}</span>` : ''}</button>`;
  }).join('');
  const end = (spec?: GlyphSpec): string => (spec ? `<span class="ui-tabs-key" aria-hidden="true">${glyph(spec, { device: o.device })}</span>` : '');
  return `<div${attrs({ class: cls('ui-tabs', o.className), ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}>${end(o.prev)}<div${attrs({
    class: 'ui-tablist',
    role: 'tablist',
    'aria-label': o.label,
    id: o.id,
  })}>${items}</div>${end(o.next)}</div>`;
}

export function tabPanel(o: { tabsId: string; tab: string; bodyHtml: string; selected: boolean; className?: string }): string {
  return `<div${attrs({
    class: cls('ui-tabpanel', o.className),
    role: 'tabpanel',
    id: panelId(o.tabsId, o.tab),
    'aria-labelledby': tabId(o.tabsId, o.tab),
    hidden: !o.selected,
  })}>${o.bodyHtml}</div>`;
}

/**
 * Makes tab lists under `root` switch on click (and on the focus manager's Q / E, LB / RB, which
 * click the next tab): updates aria-selected, tabindex and the panels, then calls `onChange`.
 */
export function bindTabs(root: HTMLElement, onChange?: (tabsId: string, tab: string) => void): () => void {
  const handler = (e: Event): void => {
    const tab = (e.target as Element | null)?.closest?.<HTMLElement>('[role="tab"]');
    if (!tab || !root.contains(tab) || (tab as HTMLButtonElement).disabled) return;
    const listEl = tab.closest<HTMLElement>('[role="tablist"]');
    if (!listEl) return;
    selectTab(listEl, tab);
    onChange?.(listEl.id, tab.dataset.tab ?? '');
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

export function selectTab(listEl: HTMLElement, tab: HTMLElement): void {
  for (const t of listEl.querySelectorAll<HTMLElement>('[role="tab"]')) {
    const on = t === tab;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
    const panel = t.getAttribute('aria-controls');
    const p = panel ? listEl.ownerDocument.getElementById(panel) : null;
    if (p) p.hidden = !on;
  }
}

// ---- Badge ---------------------------------------------------------------------------------------------

export type BadgeKind = 'plain' | 'new' | 'level' | 'locked' | 'enemy';

export interface BadgeOptions extends Common {
  label: string;
  kind?: BadgeKind;
  icon?: IconName;
  tip?: string;
}

/** A small uppercase tag: new (eraser), level (pencil), locked (desk), enemy (raid). */
export function badge(o: BadgeOptions): string {
  return `<span${attrs({
    class: cls('ui-badge-tag', o.className),
    'data-kind': o.kind && o.kind !== 'plain' ? o.kind : undefined,
    ...(o.tip ? tooltipAttrs(o.tip) : {}),
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}>${o.icon ? icon(o.icon, 'icon ui-icon') : ''}<span class="ui-label">${esc(o.label)}</span></span>`;
}

// ---- Paper counter -------------------------------------------------------------------------------------

export interface PaperCounterOptions extends Common {
  /** The balance, already formatted ("1,240"). */
  value: string;
  /** The accessible name ("1,240 paper"). */
  label: string;
  /** A change, already formatted ("+120"). */
  delta?: string;
  icon?: IconName;
}

/** The paper balance: a pencil pill with the paper icon in a white well and the number in the display face. */
export function paperCounter(o: PaperCounterOptions): string {
  return `<span${attrs({ class: cls('ui-counter', o.className), role: 'status', 'aria-label': o.label, ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}><span class="ui-counter-icon">${icon(o.icon ?? 'paper', 'icon ui-icon')}</span><b class="ui-counter-value num">${esc(o.value)}</b><span class="ui-counter-delta num">${o.delta ? esc(o.delta) : ''}</span></span>`;
}

// ---- Raid alert ----------------------------------------------------------------------------------------

export interface RaidAlertOptions extends Common {
  title: string;
  body?: string;
  /** Time left, already formatted ("0:18"). */
  eta?: string;
  icon?: IconName;
  /** raid (danger, default), info, win. */
  tone?: 'raid' | 'info' | 'win';
}

/** The style guide's RaidAlert: a signal badge, a title, a line of body and the ETA. Raid is `role="alert"`. */
export function raidAlert(o: RaidAlertOptions): string {
  const tone = o.tone ?? 'raid';
  return `<div${attrs({
    class: cls('ui-raid', o.className),
    role: tone === 'raid' ? 'alert' : 'status',
    'data-tone': tone !== 'raid' ? tone : undefined,
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}><span class="ui-raid-badge">${icon(o.icon ?? 'raid', 'icon ui-icon')}</span><div class="ui-raid-text"><p class="ui-raid-title">${esc(o.title)}</p>${o.body ? `<p class="ui-raid-body">${esc(o.body)}</p>` : ''}</div>${o.eta ? `<span class="ui-raid-eta num">${esc(o.eta)}</span>` : ''}</div>`;
}

// ---- Toggle and segmented control ----------------------------------------------------------------------

export interface ToggleOptions extends Common {
  /** The setting's name (visible unless `hideLabel`, always the accessible name). */
  label: string;
  checked: boolean;
  id?: string;
  hideLabel?: boolean;
  disabled?: boolean;
}

/** An on/off setting: a switch (`role="switch"`) with its label. */
export function toggleSwitch(o: ToggleOptions): string {
  return `<label${attrs({ class: cls('ui-toggle', o.className), ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}><input${attrs({
    type: 'checkbox', role: 'switch', id: o.id, checked: o.checked, disabled: o.disabled || o.state === 'disabled', 'aria-label': o.hideLabel ? o.label : undefined,
  })}>${o.hideLabel ? '' : `<span class="ui-label">${esc(o.label)}</span>`}</label>`;
}

export interface SegmentItem {
  value: string;
  label: string;
  pressed?: boolean;
}

export interface SegmentedOptions extends Common {
  /** The group's accessible name. */
  label: string;
  items: readonly SegmentItem[];
  /** Written as `data-u` (the pause menu finds its controls by it). */
  id?: string;
}

/** A segmented choice: buttons with `aria-pressed`; the chosen one is an ink fill. */
export function segmented(o: SegmentedOptions): string {
  return `<span${attrs({ class: cls('ui-seg seg', o.className), role: 'group', 'aria-label': o.label, 'data-u': o.id, ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}>${o.items
    .map((i) => `<button type="button" data-v="${esc(i.value)}" aria-pressed="${i.pressed ? 'true' : 'false'}"${i.pressed ? ' class="on"' : ''}>${esc(i.label)}</button>`).join('')}</span>`;
}

// ---- Coach mark ----------------------------------------------------------------------------------------

export interface CoachMarkOptions extends Common {
  /** The hint, in the hand-written face (never numbers or controls: those go in `extraHtml`). */
  text: string;
  /** The close button ("Got it"). */
  close: { label: string; key?: GlyphSpec; device?: GlyphDevice };
  /** Trusted markup under the text (key caps, a step count). */
  extraHtml?: string;
  /** The accessible name of the note ("Tip"). */
  name?: string;
  id?: string;
}

/** A taped-on sticky note for tutorial and first-time tips, with a "Got it" button. */
export function coachMark(o: CoachMarkOptions): string {
  return `<aside${attrs({ class: cls('ui-coach', o.className), role: 'note', 'aria-label': o.name, id: o.id, ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}><p class="ui-coach-text">${esc(o.text)}</p><div class="ui-coach-foot">${o.extraHtml ?? ''}<button type="button" class="ui-coach-close" data-coach-close>${icon('check', 'icon ui-icon')}<span class="ui-label">${esc(o.close.label)}</span>${o.close.key ? glyph(o.close.key, { device: o.close.device }) : ''}</button></div></aside>`;
}

// ---- Mission card --------------------------------------------------------------------------------------

export interface MissionCardOptions extends Common {
  title: string;
  /** The mission type's icon. */
  icon: IconName;
  /** Its accessible name ("Bombing"). */
  typeLabel?: string;
  /** One sentence. */
  brief?: string;
  /** The reward, already formatted ("+300"); shown in win-500 with the trophy and the paper icon. */
  reward?: string;
  rewardLabel?: string;
  /** The risk, naming the plane ("Crash and you lose your Swift"), in raid-500. */
  risk?: string;
  /** Trusted markup after the terms (chips, fit letters, actions). */
  footHtml?: string;
  /** Trusted markup at the end of the head (a key cap, a badge). */
  headHtml?: string;
  selected?: boolean;
  /** A button (focusable card) instead of an article. */
  interactive?: boolean;
}

/** A notebook page: paper, the red margin line, the type icon, a one-sentence brief, reward and risk. */
export function missionCard(o: MissionCardOptions): string {
  const tag = o.interactive ? 'button' : 'article';
  const terms = o.reward || o.risk
    ? `<div class="ui-mission-terms">${o.reward ? `<span class="ui-mission-reward"${attrs({ 'aria-label': o.rewardLabel })}>${icon('trophy', 'icon ui-icon')}<b class="num">${esc(o.reward)}</b>${icon('paper', 'icon ui-icon')}</span>` : ''}${o.risk ? `<span class="ui-mission-risk">${icon('warn', 'icon ui-icon')}<span>${esc(o.risk)}</span></span>` : ''}</div>`
    : '';
  return `<${tag}${attrs({
    class: cls('ui-mission', o.className),
    type: o.interactive ? 'button' : undefined,
    'aria-pressed': o.interactive ? String(!!o.selected) : undefined,
    'data-selected': o.selected ? '' : undefined,
    ...stateAttrs(o.state, o.interactive ? 'disabled' : 'aria-disabled'),
    ...o.attrs,
  })}><span class="ui-mission-type"${o.typeLabel ? attrs({ role: 'img', 'aria-label': o.typeLabel }) : ''}>${icon(o.icon, 'icon ui-icon')}</span><span class="ui-mission-head"><span class="ui-mission-title">${esc(o.title)}</span>${o.headHtml ?? ''}</span>${o.brief ? `<span class="ui-mission-brief">${esc(o.brief)}</span>` : ''}${terms}${o.footHtml ?? ''}</${tag}>`;
}

// ---- Plane card ----------------------------------------------------------------------------------------

export interface PlaneCardOptions extends Common {
  name: string;
  role: string;
  roleIcon?: IconName;
  /** Rated stats: [label, filled, total]. */
  stats?: ReadonlyArray<readonly [string, number, number]>;
  /** The cost, already formatted, and its accessible name. */
  cost?: string;
  costLabel?: string;
  /** "Crash and you lose {cost} paper": the words before and the bold part. */
  risk?: { text: string; strong: string };
  selected?: boolean;
  /** Trusted markup at the end (trick cards, actions). */
  footHtml?: string;
}

/** One of the planes: name in the display face, role tag, stat pips, cost in cardboard, the risk named. */
export function planeCard(o: PlaneCardOptions): string {
  const stats = o.stats?.length
    ? `<dl class="ui-plane-stats">${o.stats.map(([l, f, t]) => `<dt>${esc(l)}</dt><dd>${pips({ filled: f, total: t, label: `${l} ${f}/${t}`, shape: 'bar' })}</dd>`).join('')}</dl>`
    : '';
  return `<article${attrs({ class: cls('ui-plane', o.className), 'aria-selected': o.selected ? 'true' : undefined, 'aria-label': o.name, ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}><div class="ui-plane-head"><h3 class="ui-plane-name">${esc(o.name)}</h3>${o.cost ? `<span class="ui-plane-cost"${attrs({ 'aria-label': o.costLabel })}>${icon('paper', 'icon ui-icon')}<b class="num">${esc(o.cost)}</b></span>` : ''}</div><span class="ui-plane-role">${o.roleIcon ? icon(o.roleIcon, 'icon ui-icon') : ''}${esc(o.role)}</span>${stats}${o.risk ? `<p class="ui-plane-risk">${esc(o.risk.text)} <strong>${esc(o.risk.strong)}</strong></p>` : ''}${o.footHtml ?? ''}</article>`;
}

// ---- Build slot ----------------------------------------------------------------------------------------

export interface BuildSlotOptions extends Common {
  /** The building's name, or the empty slot's ("Build here"). */
  name: string;
  icon?: IconName;
  level?: number;
  maxLevel?: number;
  status?: 'ok' | 'damaged' | 'empty';
  /** The status line ("+10 paper / min", "Damaged 40%"). */
  meta?: string;
  metaIcon?: IconName;
  /** Trusted markup at the end (actions). */
  footHtml?: string;
}

/** A defence or building on the desk: name, levels 1–3 as pips, a status line; damaged = raid outline, empty = dashed with a plus. */
export function buildSlot(o: BuildSlotOptions): string {
  const status = o.status ?? 'ok';
  if (status === 'empty') {
    return `<div${attrs({ class: cls('ui-slot', o.className), role: 'group', 'aria-label': o.name, 'data-status': 'empty', ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}>${icon('plus', 'icon ui-icon')}<span class="ui-slot-meta">${esc(o.name)}</span>${o.footHtml ?? ''}</div>`;
  }
  const max = Math.max(0, Math.round(o.maxLevel ?? 0));
  const lv = Math.max(0, Math.min(max, Math.round(o.level ?? 0)));
  let levels = '';
  for (let i = 0; i < max; i++) levels += `<i class="ui-slot-lv"${i < lv ? ' data-on' : ''}></i>`;
  return `<div${attrs({ class: cls('ui-slot', o.className), role: 'group', 'aria-label': o.name, 'data-status': status !== 'ok' ? status : undefined, ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}><div class="ui-slot-head">${o.icon ? icon(o.icon, 'icon ui-icon') : ''}<span class="ui-slot-name">${esc(o.name)}</span></div>${max > 0 ? `<span class="ui-slot-levels" role="img" aria-label="${esc(`${lv}/${max}`)}">${levels}</span>` : ''}${o.meta ? `<span class="ui-slot-meta">${o.metaIcon ? icon(o.metaIcon, 'icon ui-icon') : ''}<span>${esc(o.meta)}</span></span>` : ''}${o.footHtml ?? ''}</div>`;
}

// ---- Result dialog -------------------------------------------------------------------------------------

export interface ResultDialogOptions extends Common {
  title: string;
  sub?: string;
  tone?: 'win' | 'loss' | 'plain';
  /** [label, value] rows, already formatted. */
  rows?: ReadonlyArray<readonly [string, string]>;
  /** Trusted markup: the actions (buttons). */
  actionsHtml?: string;
  /** Trusted markup between the sub-line and the rows. */
  bodyHtml?: string;
  id?: string;
}

/** The sortie result: a big title (win-500 home safe, raid-500 crumpled), a line, rows of numbers, the actions. */
export function resultDialog(o: ResultDialogOptions): string {
  const titleId = o.id ? `${o.id}-title` : undefined;
  return `<section${attrs({ class: cls('ui-result', o.className), role: 'group', id: o.id, 'aria-labelledby': titleId, 'aria-label': titleId ? undefined : o.title, 'data-tone': o.tone && o.tone !== 'plain' ? o.tone : undefined, ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}><h2 class="ui-result-title"${attrs({ id: titleId })}>${esc(o.title)}</h2>${o.sub ? `<p class="ui-result-sub">${esc(o.sub)}</p>` : ''}${o.bodyHtml ?? ''}${o.rows?.length ? `<ul class="ui-result-rows">${o.rows.map(([l, v]) => `<li><span>${esc(l)}</span><b class="num">${esc(v)}</b></li>`).join('')}</ul>` : ''}${o.actionsHtml ? `<div class="ui-result-actions">${o.actionsHtml}</div>` : ''}</section>`;
}

// ---- Scoreboard ----------------------------------------------------------------------------------------

export interface ScoreColumn {
  label: string;
  /** A number column: right-aligned, display face. */
  num?: boolean;
}

export interface ScoreRow {
  /** Cell text, or trusted markup when `html` is set for the row. */
  cells: readonly string[];
  you?: boolean;
  html?: boolean;
}

export interface ScoreboardOptions extends Common {
  /** The table's accessible name. */
  label: string;
  columns: readonly ScoreColumn[];
  rows: readonly ScoreRow[];
}

/** Room standings: a ruled table; your row is marked with a sky edge. */
export function scoreboard(o: ScoreboardOptions): string {
  const head = `<thead><tr>${o.columns.map((c) => `<th scope="col"${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${o.rows.map((r) => `<tr${r.you ? ' data-you' : ''}>${r.cells.map((cell, i) => `<td${o.columns[i]?.num ? ' class="num"' : ''}>${r.html ? cell : esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<table${attrs({ class: cls('ui-score', o.className), 'aria-label': o.label, ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}>${head}${body}</table>`;
}

// ---- Team chip -----------------------------------------------------------------------------------------

export interface TeamChipOptions extends Common {
  name: string;
  /** Seat 1–8: the team colour (team-1 … team-8), always with its number. */
  team: number;
  /** The desk ("Desk 5"), shown quietly after the name. */
  desk?: string;
  /** "You", when it is the player. */
  you?: string;
}

/** A player in a room: the team colour with its number, the name, the desk. Never colour alone. */
export function teamChip(o: TeamChipOptions): string {
  const n = Math.max(1, Math.min(8, Math.round(o.team)));
  return `<span${attrs({ class: cls('ui-team', o.className), 'data-you': o.you ? '' : undefined, ...stateAttrs(o.state, 'aria-disabled'), ...o.attrs })}><span class="ui-team-desk num" style="--team: var(--team-${n})">${n}</span><span>${esc(o.name)}</span>${o.desk ? `<span class="ui-team-num">${esc(o.desk)}</span>` : ''}${o.you ? `<span class="ui-team-you">${esc(o.you)}</span>` : ''}</span>`;
}

// ---- Dialog --------------------------------------------------------------------------------------------

export interface DialogAction {
  label: string;
  icon?: IconName;
  key?: GlyphSpec;
}

export interface DialogOptions {
  id: string;
  title: string;
  body?: string;
  confirm: DialogAction;
  cancel: DialogAction;
  /** A destructive action: the confirm button is the danger variant. */
  danger?: boolean;
  device?: GlyphDevice;
  /** Render in place (gallery) instead of over the page. */
  inline?: boolean;
  /** Force a state on the confirm button (gallery). */
  confirmState?: UiState;
}

/** A modal confirmation: role="dialog", aria-modal, the focus manager confines focus to it. */
export function dialog(o: DialogOptions): string {
  const titleId = `${o.id}-title`;
  const bodyId = o.body ? `${o.id}-body` : undefined;
  const cancel = button({ label: o.cancel.label, icon: o.cancel.icon, key: o.cancel.key, device: o.device, variant: 'secondary', attrs: { 'data-dialog-cancel': '' } });
  const confirm = button({
    label: o.confirm.label, icon: o.confirm.icon, key: o.confirm.key, device: o.device, state: o.confirmState,
    variant: o.danger ? 'danger' : 'primary', className: o.danger ? 'primary' : undefined, attrs: { 'data-dialog-confirm': '' },
  });
  const box = `<div${attrs({
    class: 'ui-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'aria-describedby': bodyId,
    id: o.id,
    'data-danger': o.danger ? '' : undefined,
  })}><h2 class="ui-dialog-title" id="${esc(titleId)}">${esc(o.title)}</h2>${o.body ? `<p class="ui-dialog-body" id="${esc(bodyId!)}">${esc(o.body)}</p>` : ''}<div class="ui-dialog-actions">${cancel}${confirm}</div></div>`;
  return `<div${attrs({ class: 'ui-dialog-backdrop', 'data-inline': o.inline ? '' : undefined, 'data-dialog-backdrop': '' })}>${box}</div>`;
}

let dialogCount = 0;

/**
 * The confirm dialog controller for destructive actions (End sortie, Leave, Remove, Reset,
 * Abandon). `open()` resolves true on confirm, false on cancel.
 *
 * - Focus moves to the confirm button and is trapped in the dialog (Tab, arrows); closing gives
 *   focus back to what had it.
 * - Esc (and B / Circle, through the focus manager's back) cancels; Enter (and A / Cross) presses
 *   the focused button, which starts as confirm. A click on the backdrop cancels.
 * - Keys never reach the game while it is open.
 */
export class ConfirmDialog {
  private el: HTMLElement | null = null;
  private resolve: ((ok: boolean) => void) | null = null;
  private restoreTo: HTMLElement | null = null;
  private readonly onKey = (e: KeyboardEvent): void => this.key(e);
  /**
   * The browser presses a focused button on Enter (keypress) and Space (keyup). The key that
   * opened the dialog would otherwise confirm it at once, as focus has just moved to Confirm:
   * only the dialog's own keydown handling presses its buttons.
   */
  private readonly onKeyAfter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
    if (e.type === 'keypress') e.stopImmediatePropagation();
  };

  constructor(private readonly host: HTMLElement | null = typeof document !== 'undefined' ? document.body : null) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  /** The dialog element while open (tests, the focus manager). */
  get element(): HTMLElement | null {
    return this.el?.querySelector<HTMLElement>('[role="dialog"]') ?? null;
  }

  open(o: Omit<DialogOptions, 'id' | 'inline'>): Promise<boolean> {
    if (this.el) this.close(false);
    const host = this.host;
    if (!host) return Promise.resolve(false);
    const doc = host.ownerDocument;
    this.restoreTo = doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    const wrap = doc.createElement('div');
    wrap.className = 'ui-dialog-host';
    wrap.innerHTML = dialog({ ...o, id: `ui-confirm-${++dialogCount}` });
    host.appendChild(wrap);
    this.el = wrap;
    wrap.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t.closest('[data-dialog-confirm]')) this.close(true);
      else if (t.closest('[data-dialog-cancel]')) this.close(false);
      else if (t.matches('[data-dialog-backdrop]')) this.close(false);
      e.stopPropagation();
    });
    wrap.addEventListener('mousedown', (e) => e.stopPropagation());
    doc.defaultView?.addEventListener('keydown', this.onKey, true);
    doc.defaultView?.addEventListener('keypress', this.onKeyAfter, true);
    doc.defaultView?.addEventListener('keyup', this.onKeyAfter, true);
    this.buttons()[1]?.focus({ preventScroll: true });
    return new Promise<boolean>((resolve) => (this.resolve = resolve));
  }

  close(ok: boolean): void {
    if (!this.el) return;
    const el = this.el;
    const doc = el.ownerDocument;
    doc.defaultView?.removeEventListener('keydown', this.onKey, true);
    doc.defaultView?.removeEventListener('keypress', this.onKeyAfter, true);
    doc.defaultView?.removeEventListener('keyup', this.onKeyAfter, true);
    this.el = null;
    el.remove();
    const back = this.restoreTo;
    this.restoreTo = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
    const r = this.resolve;
    this.resolve = null;
    r?.(ok);
  }

  /** [cancel, confirm]. */
  private buttons(): HTMLButtonElement[] {
    return this.el ? [...this.el.querySelectorAll<HTMLButtonElement>('[data-dialog-cancel], [data-dialog-confirm]')] : [];
  }

  private key(e: KeyboardEvent): void {
    if (!this.el) return;
    const buttons = this.buttons();
    const doc = this.el.ownerDocument;
    const at = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    let handled = true;
    switch (e.key) {
      case 'Escape':
        this.close(false);
        break;
      case 'Enter':
      case ' ':
        // A key held down from the shortcut that opened the dialog does not confirm it.
        if (e.repeat) break;
        if (at === 0) this.close(false);
        else this.close(true);
        break;
      case 'Tab':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
        const next = at < 0 ? 1 : (at + (back ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
        break;
      }
      default:
        handled = false;
    }
    // Nothing reaches the game while the dialog is open.
    e.stopImmediatePropagation();
    if (handled) e.preventDefault();
  }
}
