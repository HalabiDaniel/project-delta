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
    ...stateAttrs(o.state, 'aria-disabled'),
    ...o.attrs,
  })}><i style="width:${pctValue}%"></i></div>`;
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
