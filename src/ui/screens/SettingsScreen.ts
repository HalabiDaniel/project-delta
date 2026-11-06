import { glyph } from '../components';
import { esc } from '../dom';
import { icon } from '../icons';
import { kbutton, kseg, ktabs, ktoggle, settingRow, panel, kbadge } from '../kit';
import { keyboardControls, padControls } from '../keymap';
import { T } from '../strings';
import { TEXT_SCALES, type AccessSettings, type CaptionMode, type MotionMode } from '../access';
import type { GraphicsPreset } from '../../render/GraphicsSettings';
import type { HintMode, SettingsView } from '../views';
import type { SettingsTab } from '../flow';
import { getPadSettings, setPadSettings, type PadLevel } from '../../input/Controls';
import { pct } from '../format';

/** What Settings can change. The game (or the multiplayer game) applies and saves each at once. */
export interface SettingsActions {
  setHints(mode: HintMode): void;
  setUiScale(scale: number): void;
  setAccess(patch: Partial<AccessSettings>): void;
  setGraphicsPreset(preset: GraphicsPreset): void;
  toggleSound(): void;
  setVolume(v: number): void;
  restartTutorial(): void;
  resetProgress(): void;
  signIn(): void;
  signOut(): void;
  back(): void;
}

/** Everything Settings shows beyond the game's SettingsView. */
export interface SettingsExtras {
  volume: number;
  saveNote: string;
  /** The signed-in name, or null for a guest. */
  account: { name: string | null; guest: boolean; online: boolean } | null;
  /** Multiplayer: Reset progress becomes Leave the classroom, and the account is the server's. */
  multiplayer: boolean;
  /** The key map shown first. */
  device: 'keyboard' | 'gamepad';
}

const S = (): typeof T.settings => T.settings;
const UI_SCALES = (): Array<[string, number]> => [[S().sizeS, 0.9], [S().sizeM, 1], [S().sizeL, 1.15]];

/**
 * One screen of settings (Main menu → Settings, Pause → Settings or Controls): Back, the title,
 * tabs on the left (Game, Sound, Accessibility, Controls, Account), the rows in the middle, and the
 * quick settings on the right. Each row: a label and at most one short line, the control on the
 * right; rows sit on the rule lines. "Changes save as you go" once, in the footer.
 */
export class SettingsScreen {
  readonly el: HTMLElement;
  private tab: SettingsTab = 'game';
  private keys: 'keyboard' | 'gamepad' = 'keyboard';
  private key = '';

  constructor(host: HTMLElement, private readonly actions: SettingsActions, private readonly onTab?: (tab: SettingsTab) => void) {
    this.el = document.createElement('div');
    this.el.className = 'settings-screen';
    host.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.range === 'volume') this.actions.setVolume(Number(t.value) / 100);
    });
  }

  open(tab: SettingsTab, device: 'keyboard' | 'gamepad'): void {
    this.tab = tab;
    this.keys = device;
    this.key = '';
  }

  get currentTab(): SettingsTab {
    return this.tab;
  }

  render(v: SettingsView, x: SettingsExtras): void {
    const key = JSON.stringify([v, x, this.tab, this.keys, getPadSettings()]);
    if (key === this.key) return;
    this.key = key;
    const s = S();
    const tabs = ktabs({
      id: 'settings-tabs', label: s.title, vertical: true,
      tabs: ([['game', 'sliders'], ['sound', 'sound'], ['accessibility', 'eye'], ['controls', 'gamepad'], ['account', 'user']] as const).map(([id, i]) => ({ id, label: s.tabs[id], icon: i, selected: id === this.tab })),
    });
    const quick = panel({
      className: 'settings-quick', inset: true, label: s.quick,
      bodyHtml: `<h3 class="settings-quick-title">${esc(s.quick)}</h3>
        ${settingRow({ label: s.theme, controlHtml: kseg({ id: 'theme', label: s.theme, items: [{ value: 'daylight', label: s.daylight, pressed: v.access.theme !== 'lightsOut' }, { value: 'lightsOut', label: s.lightsOut, pressed: v.access.theme === 'lightsOut' }] }) })}
        ${settingRow({ label: s.reduceMotion, desc: s.reduceMotionDesc, controlHtml: ktoggle({ id: 'reduce-motion', label: s.reduceMotion, checked: v.access.motion === 'reduced' }) })}
        ${settingRow({ label: s.mute, controlHtml: ktoggle({ id: 'mute', label: s.mute, checked: v.muted }) })}
        ${this.volumeRow(x.volume)}
        <p class="settings-saved">${icon('ok', 'icon pw-icon')}<span>${esc(s.saved)}</span></p>`,
    });
    this.el.innerHTML = `
      <header class="screen-head">${kbutton({ label: T.front.back, icon: 'arrowLeft', size: 's', attrs: { 'data-act': 'back' }, key: { key: 'Esc', pad: 'east' }, hintKey: false })}<h1 class="screen-title">${esc(s.title)}</h1></header>
      <div class="settings-grid">
        <nav class="settings-nav">${tabs}</nav>
        <section class="settings-body" role="tabpanel" aria-labelledby="settings-tabs-${this.tab}">
          ${this.body(v, x)}
        </section>
        ${quick}
      </div>`;
  }

  private volumeRow(volume: number): string {
    const s = S();
    return `<div class="pw-setting settings-volume"><span class="pw-setting-text"><span class="pw-setting-label">${esc(s.volume)}</span></span><span class="pw-setting-control"><b class="num">${esc(pct(volume).replace('%', ''))}</b></span><input class="pw-range" type="range" min="0" max="100" step="5" value="${Math.round(volume * 100)}" data-range="volume" aria-label="${esc(s.volume)}" style="--fill:${Math.round(volume * 100)}%"></div>`;
  }

  private body(v: SettingsView, x: SettingsExtras): string {
    const s = S();
    const seg = (id: string, label: string, items: Array<[string, string]>, chosen: string): string =>
      kseg({ id, label, items: items.map(([value, l]) => ({ value, label: l, pressed: value === chosen })) });
    const title = (t: string, extraHtml = ''): string => `<div class="settings-body-head"><h2 class="settings-body-title">${esc(t)}</h2>${extraHtml}</div>`;
    switch (this.tab) {
      case 'game':
        return title(s.tabs.game) + [
          settingRow({ label: s.hints, desc: s.hintsDesc, controlHtml: seg('hints', s.hints, [['auto', s.auto], ['on', s.on], ['off', s.off]], v.hints) }),
          settingRow({ label: s.hudSize, desc: s.hudSizeDesc, controlHtml: seg('hud-size', s.hudSize, UI_SCALES().map(([l, n]) => [String(n), l]), String(v.uiScale)) }),
          settingRow({ label: s.graphics, desc: s.graphicsDesc, controlHtml: seg('graphics', s.graphics, [['low', s.low], ['medium', s.medium], ['high', s.high]], v.graphics.preset ?? '') }),
          settingRow({ label: s.theme, controlHtml: seg('theme', s.theme, [['daylight', s.daylight], ['lightsOut', s.lightsOut]], v.access.theme === 'lightsOut' ? 'lightsOut' : 'daylight') }),
        ].join('');
      case 'sound':
        return title(s.tabs.sound) + [
          settingRow({ label: s.mute, desc: s.muteDesc, controlHtml: ktoggle({ id: 'mute', label: s.mute, checked: v.muted }) }),
          this.volumeRow(x.volume),
          settingRow({ label: s.captions, desc: s.captionsDesc, controlHtml: seg('captions', s.captions, [['auto', s.auto], ['on', s.on], ['off', s.off]], v.access.captions) }),
        ].join('');
      case 'accessibility': {
        const a = v.access;
        return title(s.tabs.accessibility) + [
          settingRow({ label: s.colours, desc: s.coloursDesc, controlHtml: seg('palette', s.colours, [['standard', s.standard], ['colourblind', s.colourblind]], a.palette) }),
          settingRow({ label: s.textSize, controlHtml: seg('text', s.textSize, [...TEXT_SCALES.map((n): [string, string] => [String(n), s.textPct(Math.round(n * 100))])], String(a.textScale)) }),
          settingRow({ label: s.panels, desc: s.panelsDesc, controlHtml: seg('contrast', s.panels, [['normal', s.normal], ['high', s.highContrast]], a.highContrast ? 'high' : 'normal') }),
          settingRow({ label: s.motion, desc: s.motionDesc, controlHtml: seg('motion', s.motion, [['auto', s.auto], ['full', s.full], ['reduced', s.reduced]], a.motion) }),
          settingRow({ label: s.captions, desc: s.captionsDesc, controlHtml: seg('captions', s.captions, [['auto', s.auto], ['on', s.on], ['off', s.off]], a.captions) }),
          settingRow({ label: s.safeArea, desc: s.safeAreaDesc, controlHtml: ktoggle({ id: 'safe-area', label: s.safeArea, checked: a.safeArea }) }),
          settingRow({ id: 'prompts', label: s.prompts, desc: s.promptsDesc, controlHtml: seg('prompts', s.prompts, [['auto', s.auto], ['keyboard', s.keyboard], ['xbox', s.xbox], ['playstation', s.playstation], ['generic', s.generic]], a.prompts) }),
        ].join('');
      }
      case 'controls': {
        const pad = getPadSettings();
        const rows = (this.keys === 'gamepad' ? padControls() : keyboardControls())
          .map((r) => `<div class="keymap-row"><span>${esc(r.label)}</span>${glyph(r.spec, this.keys === 'gamepad' ? {} : { device: 'keyboard' })}</div>`)
          .join('');
        const padRows = this.keys === 'gamepad'
          ? [
            settingRow({ label: s.invertY, desc: s.invertYDesc, controlHtml: ktoggle({ id: 'pad-invert', label: s.invertY, checked: pad.invertY }) }),
            settingRow({ label: s.stick, controlHtml: seg('pad-stick', s.stick, [['low', s.low], ['medium', s.medium], ['high', s.high]], pad.stick) }),
            settingRow({ label: s.camera, controlHtml: seg('pad-camera', s.camera, [['low', s.low], ['medium', s.medium], ['high', s.high]], pad.camera) }),
          ].join('')
          : '';
        return title(s.tabs.controls, seg('keys', s.tabs.controls, [['keyboard', s.mouseKeyboard], ['gamepad', s.controller]], this.keys)) +
          `${padRows}<div class="keymap" role="list">${rows}</div>`;
      }
      case 'account': {
        const acc = x.account;
        const who = acc && !acc.guest ? acc.name ?? '' : s.guestPilot;
        return title(s.tabs.account) + [
          settingRow({
            label: who, desc: acc && !acc.guest ? s.signedIn : s.guestDesc,
            controlHtml: x.multiplayer ? '' : acc && !acc.guest
              ? kbutton({ label: s.signOut, icon: 'logOut', size: 's', attrs: { 'data-act': 'sign-out' } })
              : kbutton({ label: s.signIn, icon: 'logIn', size: 's', variant: 'primary', attrs: { 'data-act': 'sign-in' } }),
          }),
          settingRow({ label: s.save, desc: x.saveNote, controlHtml: acc && !acc.online && !x.multiplayer ? kbadge({ label: s.thisBrowser, tip: s.thisBrowserTip }) : '' }),
          settingRow({ label: s.tutorial, desc: s.tutorialDesc, controlHtml: kbutton({ label: s.replay, icon: 'reset', size: 's', attrs: { 'data-act': 'tutorial' } }) }),
          settingRow({ label: s.licences, desc: s.licencesDesc, controlHtml: '' }),
          `<div class="settings-danger">${settingRow({
            label: x.multiplayer ? s.leave : s.reset, desc: x.multiplayer ? s.leaveDesc : s.resetDesc,
            controlHtml: kbutton({ label: x.multiplayer ? s.leave : s.reset, icon: x.multiplayer ? 'logOut' : 'remove', variant: 'danger', size: 's', attrs: { 'data-act': 'reset' } }),
          })}</div>`,
        ].join('');
      }
    }
  }

  private click(e: Event): void {
    const t = e.target as Element;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const tab = t.closest<HTMLElement>('[role="tab"]')?.dataset.tab as SettingsTab | undefined;
    if (tab) {
      this.tab = tab;
      this.key = '';
      this.onTab?.(tab);
      return;
    }
    if (act) {
      if (act === 'back') this.actions.back();
      else if (act === 'tutorial') this.actions.restartTutorial();
      else if (act === 'reset') this.actions.resetProgress();
      else if (act === 'sign-in') this.actions.signIn();
      else if (act === 'sign-out') this.actions.signOut();
      return;
    }
    const sw = t.closest<HTMLElement>('[data-toggle]');
    if (sw) {
      const on = sw.getAttribute('aria-checked') !== 'true';
      switch (sw.dataset.toggle) {
        case 'reduce-motion':
          return this.actions.setAccess({ motion: on ? 'reduced' : 'auto' });
        case 'mute':
          return this.actions.toggleSound();
        case 'safe-area':
          return this.actions.setAccess({ safeArea: on });
        case 'pad-invert':
          setPadSettings({ ...getPadSettings(), invertY: on });
          this.key = '';
          return;
      }
      return;
    }
    const b = t.closest<HTMLButtonElement>('[data-seg] > button[data-v]');
    if (!b || b.disabled) return;
    const v = b.dataset.v!;
    switch (b.parentElement!.dataset.seg) {
      case 'hints':
        return this.actions.setHints(v as HintMode);
      case 'hud-size':
        return this.actions.setUiScale(Number(v));
      case 'graphics':
        return this.actions.setGraphicsPreset(v as GraphicsPreset);
      case 'theme':
        return this.actions.setAccess({ theme: v === 'lightsOut' ? 'lightsOut' : 'daylight' });
      case 'palette':
        return this.actions.setAccess({ palette: v === 'colourblind' ? 'colourblind' : 'standard' });
      case 'text':
        return this.actions.setAccess({ textScale: Number(v) });
      case 'contrast':
        return this.actions.setAccess({ highContrast: v === 'high' });
      case 'motion':
        return this.actions.setAccess({ motion: v as MotionMode });
      case 'captions':
        return this.actions.setAccess({ captions: v as CaptionMode });
      case 'prompts':
        return this.actions.setAccess({ prompts: v as AccessSettings['prompts'] });
      case 'keys':
        this.keys = v === 'gamepad' ? 'gamepad' : 'keyboard';
        this.key = '';
        return;
      case 'pad-stick':
        setPadSettings({ ...getPadSettings(), stick: v as PadLevel });
        this.key = '';
        return;
      case 'pad-camera':
        setPadSettings({ ...getPadSettings(), camera: v as PadLevel });
        this.key = '';
        return;
    }
  }
}
