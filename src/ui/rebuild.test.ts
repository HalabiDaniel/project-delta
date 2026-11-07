// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Flow } from './flow';
import { avatar, coach, dockButton, drawer, field, kbadge, kbutton, kchip, kiconButton, kmeter, kseg, ktoggle, resultCard, selectCard, setMeter, settingRow, statusBar } from './kit';
import { shortTip } from './hud/Overlays';
import { fitTone } from './hud/DeskHud';
import { emailProblem, LocalAccountService, passwordStrength, roomCode } from '../net/services';

const host = (html: string): HTMLElement => {
  const d = document.createElement('div');
  d.innerHTML = html;
  document.body.appendChild(d);
  return d;
};

describe('screen flow (v0.0.16)', () => {
  it('boots to Login, or to the main menu with a profile', () => {
    const a = new Flow();
    a.booted(false);
    expect(a.screen).toBe('login');
    const b = new Flow();
    b.booted(true);
    expect(b.screen).toBe('menu');
  });

  it('goes back one level on menu screens and nowhere from the main menu or a match', () => {
    const f = new Flow();
    f.booted(true);
    f.go('solo');
    expect(f.back()).toBe(true);
    expect(f.screen).toBe('menu');
    expect(f.back()).toBe(false);
    f.go('login');
    f.go('signup');
    f.back();
    expect(f.screen).toBe('login');
    f.go('match');
    expect(f.inMatch).toBe(true);
    expect(f.back()).toBe(false);
  });

  it('settings and achievements return where they were opened from', () => {
    const f = new Flow();
    f.go('match');
    f.openSettings('controls', 'pause');
    expect(f.screen).toBe('settings');
    expect(f.state.settingsTab).toBe('controls');
    f.back();
    expect(f.screen).toBe('match');
    f.go('achievements', 'match');
    f.back();
    expect(f.screen).toBe('match');
    f.go('menu');
    f.openSettings('game', 'menu');
    f.back();
    expect(f.screen).toBe('menu');
  });
});

describe('component kit', () => {
  it('interactive pieces are real buttons with names; icon buttons have an aria-label and a tooltip', () => {
    const root = host([
      kbutton({ label: 'Go', variant: 'primary', size: 'xl' }),
      kiconButton({ icon: 'menu', name: 'Menu' }),
      dockButton({ id: 'build', icon: 'build', label: 'Build', active: true, pip: '3' }),
      ktoggle({ id: 't', label: 'Fill', checked: true }),
      kseg({ id: 's', label: 'Pick', items: [{ value: 'a', label: 'A', pressed: true }, { value: 'b', label: 'B' }] }),
      selectCard({ title: 'Swift', tag: 'Fighter', selected: true, artHtml: '' }),
      selectCard({ title: 'Ghost', locked: 'Lv 4', artHtml: '' }),
    ].join(''));
    const buttons = [...root.querySelectorAll('button')];
    expect(buttons.length).toBe(8);
    const icon = root.querySelector('.pw-iconbtn')!;
    expect(icon.getAttribute('aria-label')).toBe('Menu');
    expect(icon.getAttribute('data-tip')).toBe('Menu');
    expect(root.querySelector('.pw-btn.primary')!.getAttribute('data-size')).toBe('xl');
    expect(root.querySelector('[data-dock="build"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('.pw-seg [aria-pressed="true"]')!.textContent).toBe('A');
    expect(root.querySelector('.pw-card[aria-pressed="true"] .pw-card-title')!.textContent).toBe('Swift');
    expect(root.querySelector('.pw-card[data-locked]')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('escapes text and keeps markup arguments as given', () => {
    const root = host(kchip({ label: '<b>x</b>', value: '1' }) + kbadge({ label: '&' }) + settingRow({ label: 'L', desc: 'D', controlHtml: '<i id="ctl"></i>' }));
    expect(root.querySelector('.pw-chip-label')!.textContent).toBe('<b>x</b>');
    expect(root.querySelector('.pw-badge')!.textContent).toBe('&');
    expect(root.querySelector('#ctl')).not.toBeNull();
  });

  it('meters are segmented with a role, and update in place', () => {
    const root = host(kmeter({ label: 'Hull', value: 0.5, valueText: '50%', segments: 10 }));
    const m = root.querySelector('.pw-meter')!;
    expect(m.querySelectorAll('i[data-on]').length).toBe(5);
    expect(m.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('50');
    setMeter(m, 0.2, '20%', 'hostile');
    expect(m.querySelectorAll('i[data-on]').length).toBe(2);
    expect(m.querySelector('.pw-meter-value')!.textContent).toBe('20%');
    expect((m as HTMLElement).dataset.tone).toBe('hostile');
  });

  it('the drawer has a head, a scrolling body and a foot; the status bar is cells', () => {
    const root = host(drawer({ id: 'd', title: 'Missions', bodyHtml: '<p>x</p>', footHtml: '<b>f</b>', closeName: 'Close' }) + statusBar({ label: 'S', cellsHtml: ['a', 'b', 'c'] }));
    expect(root.querySelector('.pw-drawer')!.getAttribute('aria-labelledby')).toBe('d-title');
    expect(root.querySelector('.pw-drawer-body')!.hasAttribute('data-nav-scroll')).toBe(true);
    expect(root.querySelector('.pw-drawer-foot b')).not.toBeNull();
    expect(root.querySelectorAll('.pw-status-cell').length).toBe(3);
  });

  it('fields carry their label, help and error; the coach mark and result card hold one line each', () => {
    const root = host(
      field({ id: 'e', label: 'Email', error: 'Missing a domain' }) +
      coach({ step: '3 / 10', text: 'Pick a mission card.', skipLabel: 'Skip tutorial', arrow: 'down', name: 'Tutorial' }) +
      resultCard({ icon: 'ok', tone: 'good', status: 'Home safe', title: 'Mission complete', meta: 'm', tiles: [['paper', '+1', 'Paper']], tip: 'Tip', detailsOpen: false, detailsHtml: '<p id="det"></p>', detailsLabel: 'Details', continueLabel: 'Continue' }),
    );
    const input = root.querySelector('input#e')!;
    expect(root.querySelector('label[for="e"]')!.textContent).toBe('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector(`#${input.getAttribute('aria-describedby')}`)!.textContent).toBe('Missing a domain');
    expect(root.querySelector('.pw-coach-text')!.textContent).toBe('Pick a mission card.');
    expect(root.querySelector('#det')).toBeNull();
    expect(root.querySelector('.pw-result-tip')!.textContent).toBe('Tip');
    expect(avatar({ name: 'mira', colour: 'red' })).toContain('>M<');
  });
});

describe('desk and result rules', () => {
  it('one fit badge per card for the selected plane', () => {
    expect(fitTone('recommended').tone).toBe('good');
    expect(fitTone('good').tone).toBe('good');
    expect(fitTone('possible').tone).toBe('warn');
    expect(fitTone('unsuitable').tone).toBe('hostile');
  });

  it('the result shows one short tip line (70 characters at most) when Details is closed', () => {
    expect(shortTip('Release a little early. Then pull up.')).toBe('Release a little early.');
    expect(shortTip('x'.repeat(71))).toBeNull();
    expect(shortTip('')).toBeNull();
  });
});

describe('account and room stubs', () => {
  it('checks emails and passwords the way the form shows them', () => {
    expect(emailProblem('')).toBe('empty');
    expect(emailProblem('dan')).toBe('at');
    expect(emailProblem('dan@')).toBe('domain');
    expect(emailProblem('dan@example.com')).toBeNull();
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abcdefgh')).toBe(1);
    expect(passwordStrength('Abcdefg1!')).toBe(4);
  });

  it('keeps a guest or a signed-up profile in this browser, and signs in with it', async () => {
    localStorage.clear();
    const a = new LocalAccountService();
    expect(a.current()).toBeNull();
    expect(a.continueAsGuest().guest).toBe(true);
    const up = await a.signUp('PaperAce', 'ace@example.com', 'longenough');
    expect(up.ok).toBe(true);
    a.signOut();
    expect(a.current()).toBeNull();
    expect((await a.signIn('ace@example.com', 'wrong', true)).ok).toBe(false);
    const r = await a.signIn('ace@example.com', 'longenough', true);
    expect(r.ok && r.profile.callsign).toBe('PaperAce');
    expect(new LocalAccountService().current()?.callsign).toBe('PaperAce');
    expect((await a.signUp('no', 'x@y.z', 'longenough')).ok).toBe(false);
  });

  it('room codes look like the design', () => {
    expect(roomCode()).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  });
});
