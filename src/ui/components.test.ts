// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  alert, bar, caption, bindTabs, button, card, chip, ConfirmDialog, dialog, glyph, iconButton, infoButton, list, pips, stat, tabPanel, tabs, tooltip, tooltipAttrs, attrs,
  UI_STATES, type UiState,
} from './components';
import { applyGlyphs, buttonLabel, DIALOG_KEYS, GLYPH_DEVICES, glyphDeviceFor, glyphText, padHint, type GlyphDevice, type GlyphSpec } from '../input/glyphs';
import { PAD_BUTTONS, type PadFamily } from '../input/Gamepad';

function dom(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const KEY: GlyphSpec = { key: 'KEYSENTINEL', pad: 'south' };

/** Every component, rendered in one state, with sentinel text arguments (S_…). */
function renderAll(s: UiState, device?: GlyphDevice): Record<string, string> {
  return {
    card: card({ title: 'S_TITLE', icon: 'plane', id: 'c1', state: s, bodyHtml: '<i>S_BODY</i>' }),
    chip: chip({ label: 'S_LABEL', value: 'S_VALUE', icon: 'paper', tone: 'good', tip: 'S_TIP', state: s }),
    button: button({ label: 'S_LABEL', icon: 'plane', variant: 'primary', key: KEY, device, tip: 'S_TIP', state: s }),
    danger: button({ label: 'S_LABEL', variant: 'danger', key: KEY, device, state: s }),
    iconButton: iconButton({ icon: 'base', name: 'S_NAME', tip: 'S_TIP', key: KEY, device, badge: 'S_BADGE', state: s }),
    info: infoButton({ name: 'S_NAME', tip: 'S_TIP', state: s }),
    bar: bar({ value: 0.5, label: 'S_LABEL', valueText: 'S_VALUE', state: s }),
    stat: stat({ icon: 'paper', value: 'S_VALUE', label: 'S_LABEL', delta: 'S_DELTA', deltaTone: 'good', suffix: 'S_SUFFIX', state: s }),
    pips: pips({ filled: 2, total: 3, label: 'S_LABEL', tone: 'threat', state: s }),
    tooltip: tooltip({ id: 't1', text: 'S_TIP', open: true }),
    alert: alert({ title: 'S_TITLE', value: 'S_VALUE', icon: 'raid', severity: 'critical', count: 'S_COUNT', state: s }),
    list: list({ label: 'S_LABEL', itemsHtml: ['<b>S_ITEM</b>'], layout: 'grid', columns: 2, scroll: true, state: s }),
    tabs: tabs({ id: 'tb', label: 'S_LABEL', tabs: [{ id: 'a', label: 'S_TAB', selected: true }, { id: 'b', label: 'S_TAB', badge: 'S_BADGE', state: s }], prev: KEY, next: KEY, device }),
    tabPanel: tabPanel({ tabsId: 'tb', tab: 'a', bodyHtml: '<i>S_BODY</i>', selected: true }),
    dialog: dialog({ id: 'd1', title: 'S_TITLE', body: 'S_BODY', confirm: { label: 'S_CONFIRM', key: KEY }, cancel: { label: 'S_CANCEL', key: KEY }, danger: true, device, confirmState: s }),
    glyph: glyph(KEY, { device }),
    caption: caption({ text: 'S_TEXT', icon: 'launcher', direction: 0.8, directionLabel: 'S_DIR', state: s }),
  };
}

/** Text a player can see or hear: text nodes and the attributes screen readers and tooltips read. */
function userText(root: HTMLElement): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? '').trim();
    if (t) out.push(t);
  }
  for (const el of root.querySelectorAll('*')) {
    for (const a of ['aria-label', 'title', 'data-tip', 'placeholder', 'alt', 'aria-valuetext']) {
      const v = el.getAttribute(a);
      if (v) out.push(v.trim());
    }
  }
  return out;
}

describe('components: no literal user-facing text', () => {
  const glyphLabels = new Set<string>();
  for (const f of ['xbox', 'playstation', 'generic'] as PadFamily[]) for (const b of PAD_BUTTONS) glyphLabels.add(buttonLabel(b, f));

  for (const device of [undefined, ...GLYPH_DEVICES]) {
    it(`renders only its arguments (glyphs: ${device ?? 'live'})`, () => {
      for (const s of UI_STATES) {
        for (const [name, html] of Object.entries(renderAll(s, device))) {
          const root = dom(html);
          for (const t of userText(root)) {
            const fromArgs = /^(S_[A-Z]+|KEYSENTINEL)$/.test(t) || glyphLabels.has(t);
            expect(fromArgs, `${name} (${s}) shows "${t}", which is not from its arguments`).toBe(true);
          }
          root.remove();
        }
      }
    });
  }

  it('sees the text it checks (the check is not vacuous)', () => {
    const root = dom(renderAll('default').button + renderAll('default').iconButton + '<span>Launch</span>');
    const t = userText(root);
    expect(t).toContain('S_LABEL');
    expect(t).toContain('S_NAME');
    expect(t).toContain('Launch');
  });

  it('escapes text arguments', () => {
    const root = dom(chip({ label: '<img src=x onerror=alert(1)>' }));
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img');
    expect(attrs({ a: '"x"', b: true, c: false, d: undefined })).toBe(' a="&quot;x&quot;" b');
  });
});

describe('components: states, roles and names', () => {
  it('marks every state with data-state; disabled is the disabled attribute on controls', () => {
    for (const s of UI_STATES) {
      const root = dom(Object.values(renderAll(s)).join(''));
      const b = root.querySelector<HTMLButtonElement>('.ui-button')!;
      const ib = root.querySelector<HTMLButtonElement>('.ui-icon-button')!;
      const c = root.querySelector<HTMLElement>('.ui-card')!;
      if (s === 'default') {
        expect(b.hasAttribute('data-state')).toBe(false);
        expect(b.disabled).toBe(false);
      } else {
        expect(b.dataset.state).toBe(s);
        expect(ib.dataset.state).toBe(s);
        expect(c.dataset.state).toBe(s);
      }
      expect(b.disabled).toBe(s === 'disabled');
      expect(ib.disabled).toBe(s === 'disabled');
      if (s === 'disabled') expect(c.getAttribute('aria-disabled')).toBe('true');
      root.remove();
    }
  });

  it('gives each component its role and accessible name', () => {
    const root = dom(Object.values(renderAll('default')).join(''));
    const card1 = root.querySelector('.ui-card')!;
    expect(card1.getAttribute('role')).toBe('group');
    expect(card1.getAttribute('aria-labelledby')).toBe('c1-title');
    expect(root.querySelector('#c1-title')!.textContent).toBe('S_TITLE');

    const btn = root.querySelector<HTMLButtonElement>('.ui-button')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
    expect(btn.classList.contains('primary')).toBe(true); // the focus manager's default
    expect(btn.querySelector('kbd')!.dataset.pad).toBe('south');

    const ib = root.querySelector('.ui-icon-button')!;
    expect(ib.getAttribute('aria-label')).toBe('S_NAME');
    expect(ib.getAttribute('data-tip')).toBe('S_TIP');
    expect(root.querySelector('.ui-info')!.hasAttribute('data-info')).toBe(true);

    const meter = root.querySelector('.ui-bar')!;
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-label')).toBe('S_LABEL');
    expect(meter.getAttribute('aria-valuenow')).toBe('50');

    expect(root.querySelector('.ui-stat')!.getAttribute('aria-label')).toBe('S_LABEL');
    const p = root.querySelector('.ui-pips')!;
    expect(p.getAttribute('role')).toBe('img');
    expect(p.querySelectorAll('i').length).toBe(3);
    expect(p.querySelectorAll('i[data-on]').length).toBe(2);
    expect(root.querySelector('.ui-tooltip')!.getAttribute('role')).toBe('tooltip');
    expect(root.querySelector('.ui-alert')!.getAttribute('role')).toBe('alert');
    expect(dom(alert({ title: 'x', severity: 'warning' })).querySelector('.ui-alert')!.getAttribute('role')).toBe('status');

    const l = root.querySelector('.ui-list')!;
    expect(l.getAttribute('role')).toBe('list');
    expect(l.getAttribute('aria-label')).toBe('S_LABEL');
    expect(l.hasAttribute('data-nav-scroll')).toBe(true);

    const tl = root.querySelector('[role="tablist"]')!;
    expect(tl.getAttribute('aria-label')).toBe('S_LABEL');
    const tabEls = tl.querySelectorAll('[role="tab"]');
    expect(tabEls.length).toBe(2);
    expect(tabEls[0].getAttribute('aria-selected')).toBe('true');
    expect(tabEls[1].getAttribute('aria-selected')).toBe('false');
    expect(tabEls[0].getAttribute('aria-controls')).toBe('tb-panel-a');
    expect(root.querySelector('#tb-panel-a')!.getAttribute('role')).toBe('tabpanel');

    const d = root.querySelector('[role="dialog"]')!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-labelledby')).toBe('d1-title');
    expect(d.getAttribute('aria-describedby')).toBe('d1-body');
    expect(d.querySelector('[data-dialog-cancel]')).not.toBeNull();
    expect(d.querySelector('[data-dialog-confirm]')!.getAttribute('data-variant')).toBe('danger');
  });

  it('levels bars by format.level', () => {
    const lv = (v: number): string | undefined => dom(bar({ value: v, label: 'x' })).querySelector<HTMLElement>('.ui-bar')!.dataset.level;
    expect(lv(0.9)).toBe('ok');
    expect(lv(0.5)).toBe('worn');
    expect(lv(0.1)).toBe('critical');
    expect(lv(Number.NaN)).toBe('critical');
    expect(dom(bar({ value: 2, label: 'x' })).querySelector('.ui-bar')!.getAttribute('aria-valuenow')).toBe('100');
  });

  it('gives tooltip attributes for hover, focus and screen readers', () => {
    expect(tooltipAttrs('Hi', 'tip1')).toEqual({ 'data-tip': 'Hi', 'aria-describedby': 'tip1' });
  });

  it('switches tabs and their panels on click', () => {
    const root = dom(tabs({ id: 'lb', label: 'x', tabs: [{ id: 'a', label: 'A', selected: true }, { id: 'b', label: 'B' }] })
      + tabPanel({ tabsId: 'lb', tab: 'a', bodyHtml: 'a', selected: true }) + tabPanel({ tabsId: 'lb', tab: 'b', bodyHtml: 'b', selected: false }));
    const seen: string[] = [];
    bindTabs(root, (id, tab) => seen.push(`${id}:${tab}`));
    root.querySelector<HTMLElement>('[data-tab="b"]')!.click();
    expect(seen).toEqual(['lb:b']);
    expect(root.querySelector('[data-tab="b"]')!.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('[data-tab="a"]')!.getAttribute('aria-selected')).toBe('false');
    expect(root.querySelector<HTMLElement>('#lb-panel-a')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('#lb-panel-b')!.hidden).toBe(false);
  });
});

describe('glyphs', () => {
  it('picks the label for each device', () => {
    expect(glyphText({ key: 'Enter', pad: 'south' }, 'keyboard')).toBe('Enter');
    expect(glyphText({ key: 'Enter', pad: 'south' }, 'xbox')).toBe('A');
    expect(glyphText({ key: 'Enter', pad: 'south' }, 'playstation')).toBe('✕');
    expect(glyphText({ key: 'Enter', pad: 'south' }, 'generic')).toBe('A');
    expect(glyphText({ key: 'Esc' }, 'playstation')).toBe(padHint('Esc', 'playstation'));
    expect(glyphText({ key: 'Delete' }, 'xbox')).toBe('');
    expect(glyphText(DIALOG_KEYS.cancel, 'xbox')).toBe('B');
    expect(glyphDeviceFor('keyboard', 'playstation')).toBe('keyboard');
    expect(glyphDeviceFor('gamepad', 'playstation')).toBe('playstation');
    expect(glyphDeviceFor('gamepad', null)).toBe('xbox');
  });

  it('draws a fixed glyph for one device, and nothing where the pad has no equivalent', () => {
    const root = dom(glyph({ key: 'Q', pad: 'lb' }, { device: 'playstation' }) + glyph({ key: 'Delete' }, { device: 'xbox' }));
    const kbds = root.querySelectorAll('kbd');
    expect(kbds.length).toBe(1);
    expect(kbds[0].textContent).toBe('L1');
    expect(kbds[0].hasAttribute('data-glyph-fixed')).toBe(true);
  });

  it('switches live glyphs with the device, and leaves fixed ones alone', () => {
    const root = dom(button({ label: 'Go', key: { key: 'Enter', pad: 'south' } }) + glyph({ key: 'Esc' }) + glyph({ key: 'F', pad: 'south' }, { device: 'keyboard' }));
    const [live, esc, fixed] = [...root.querySelectorAll('kbd')];
    expect(live.textContent).toBe('Enter');
    applyGlyphs(root, 'playstation');
    expect(live.textContent).toBe('✕');
    expect(esc.textContent).toBe('○');
    expect(fixed.textContent).toBe('F');
    applyGlyphs(root, 'xbox');
    expect(live.textContent).toBe('A');
    expect(esc.textContent).toBe('B');
    applyGlyphs(root, null);
    expect(live.textContent).toBe('Enter');
    expect(esc.textContent).toBe('Esc');
  });
});

describe('ConfirmDialog', () => {
  const opts = { title: 'T', body: 'B', confirm: { label: 'Yes', key: DIALOG_KEYS.confirm }, cancel: { label: 'No', key: DIALOG_KEYS.cancel }, danger: true };
  const key = (k: string, extra: KeyboardEventInit = {}): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
    window.dispatchEvent(e);
    return e;
  };

  it('resolves true on Enter (confirm has focus), false on Esc, and restores focus', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const d = new ConfirmDialog(document.body);
    const p = d.open(opts);
    expect(d.isOpen).toBe(true);
    expect(d.element!.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.hasAttribute('data-dialog-confirm')).toBe(true);
    key('Enter');
    await expect(p).resolves.toBe(true);
    expect(d.isOpen).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);

    const q = d.open(opts);
    key('Escape');
    await expect(q).resolves.toBe(false);
  });

  it('traps Tab and arrows between its buttons; Enter on cancel cancels; keys never reach the game', async () => {
    const d = new ConfirmDialog(document.body);
    const seen: string[] = [];
    const game = (e: KeyboardEvent): void => { seen.push(e.key); };
    window.addEventListener('keydown', game);
    const p = d.open(opts);
    key('Tab');
    expect(document.activeElement?.hasAttribute('data-dialog-cancel')).toBe(true);
    key('Tab');
    expect(document.activeElement?.hasAttribute('data-dialog-confirm')).toBe(true);
    key('ArrowLeft');
    expect(document.activeElement?.hasAttribute('data-dialog-cancel')).toBe(true);
    key('KeyW');
    expect(seen).toEqual([]);
    key('Enter');
    await expect(p).resolves.toBe(false);
    key('x');
    expect(seen).toEqual(['x']);
    window.removeEventListener('keydown', game);
  });

  it('resolves with clicks: confirm, cancel, backdrop; a second open cancels the first', async () => {
    const d = new ConfirmDialog(document.body);
    const a = d.open(opts);
    document.querySelector<HTMLElement>('[data-dialog-confirm]')!.click();
    await expect(a).resolves.toBe(true);
    const b = d.open(opts);
    document.querySelector<HTMLElement>('[data-dialog-cancel]')!.click();
    await expect(b).resolves.toBe(false);
    const c = d.open(opts);
    document.querySelector<HTMLElement>('[data-dialog-backdrop]')!.click();
    await expect(c).resolves.toBe(false);
    const first = d.open(opts);
    const second = d.open(opts);
    await expect(first).resolves.toBe(false);
    d.close(true);
    await expect(second).resolves.toBe(true);
  });
});
