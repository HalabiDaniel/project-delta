import { button, card, chip, stat } from '../ui/components';
import { icon } from '../ui/icons';
import { colourCss, type DeskState, type SessionResultsDTO } from '../net/protocol';
import { USERNAME, USERNAME_PROBLEMS, suggestUsername, usernameProblem } from '../net/Username';
import type { SessionListing } from './NetClient';
import { presenceOf, PRESENCE_ICONS, PRESENCE_LABELS } from './presence';

export interface LobbyActions {
  quick(name: string): void;
  join(name: string, sessionId: string): void;
  /** From the results card: a new session, on a new random desk. */
  next(name: string): void;
  refresh(): void;
  claim(territoryId: string): void;
  /** An invite code (first join) or a transfer code (from another computer), for the next join. */
  setCode(code: string | null): void;
  /** The username the player typed on the claim screen (they had none yet, or it was refused). */
  chooseUsername(name: string): void;
  leave(): void;
  singlePlayer(): void;
}

/** One square of the claim map. */
export interface ClaimCell {
  id: string;
  name: string;
  threat: number;
  owner: string | null;
  ownerName: string | null;
  colour: number;
  claimable: boolean;
  mine: boolean;
  connected: boolean;
  /** Its place in the territory lifecycle (v0.0.13). */
  state: DeskState;
}

export interface ClaimView {
  title: string;
  cells: ClaimCell[];
  players: Array<{ name: string; colour: number; territory: string | null; connected: boolean; me: boolean }>;
  error: string | null;
  /** Shown while the player still needs a username: what to fill in, and why the last one wasn't given. */
  username: { value: string; note: string | null } | null;
}

const NAME_KEY = 'paperwars.mp.name';

/**
 * The multiplayer menus, in the HUD's paper style: choose a name and a classroom (or start one),
 * then pick a desk on the classroom map. Shown over the 3D world, which keeps running behind it.
 */
export class Lobby {
  readonly root: HTMLElement;
  private readonly rooms: HTMLElement;
  private readonly claim: HTMLElement;
  private readonly status: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly results: HTMLElement;
  private screen: 'rooms' | 'claim' | 'results' | 'hidden' = 'rooms';
  private lastClaimKey = '';
  /** What the player has typed into the username prompt so far. */
  private typedUsername: string | null = null;

  constructor(parent: HTMLElement, private readonly actions: LobbyActions) {
    this.root = document.createElement('div');
    this.root.className = 'mp-lobby mp-overlay';
    const brand = '<b class="mp-brand">paperwars<span>.io</span></b>';
    const rooms = /* html */ `
        <div class="mp-head">${brand}<h2>Multiplayer</h2></div>
        <label class="mp-field" data-tip="What everyone sees you as: ${USERNAME.min} to ${USERNAME.max} letters, digits or _. You can change it once a week."><span>${icon('pencil')}Username</span><input class="mp-input" data-u="name" maxlength="${USERNAME.max}" autocomplete="nickname" spellcheck="false" placeholder="${USERNAME.min} to ${USERNAME.max} letters, digits or _" /></label>
        <label class="mp-field" data-tip="Only needed the first time on this computer: the invite you were sent, or a transfer code from your other computer"><span>${icon('swap')}Code</span><input class="mp-input" data-u="code" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Invite or transfer code (first time only)" /></label>
        <div class="mp-row">
          ${button({ label: 'Quick join', icon: 'plane', variant: 'primary', size: 'big', tip: 'Join the busiest session with a free desk (a new one opens if every session is full)', attrs: { 'data-u': 'quick' } })}
          <span class="mp-or">or pick a session below. Each lasts an hour; your base comes with you.</span>
        </div>
        <div class="mp-list" data-u="list" data-nav-scroll></div>
        <div class="mp-foot"><span class="mp-status" data-u="status" role="status"></span>${button({ label: 'Refresh', icon: 'swap', size: 'small', attrs: { 'data-u': 'refresh' } })}${button({ label: 'Single-player', icon: 'home', size: 'small', attrs: { 'data-u': 'single' } })}</div>`;
    this.root.innerHTML =
      card({ label: 'Multiplayer', bodyHtml: rooms, elevation: 'floating', className: 'mp-card', attrs: { 'data-u': 'rooms' } }) +
      card({ label: 'Your desk', bodyHtml: '', elevation: 'floating', className: 'mp-card mp-claim', attrs: { 'data-u': 'claim', hidden: true } }) +
      card({ label: 'Session results', bodyHtml: '', elevation: 'floating', className: 'mp-card mp-results', attrs: { 'data-u': 'results', hidden: true } });
    parent.appendChild(this.root);
    const el = (u: string) => this.root.querySelector<HTMLElement>(`[data-u="${u}"]`)!;
    this.rooms = el('rooms');
    this.claim = el('claim');
    this.results = el('results');
    this.status = el('status');
    this.nameInput = el('name') as HTMLInputElement;
    // A name from before usernames (v0.0.12) is offered as the username, if it would do.
    const saved = loadName();
    this.nameInput.value = suggestUsername(saved) ?? saved;
    this.nameInput.addEventListener('change', () => saveName(this.name));
    const codeInput = el('code') as HTMLInputElement;
    codeInput.value = new URLSearchParams(window.location.search).get('invite') ?? '';
    codeInput.addEventListener('input', () => this.actions.setCode(codeInput.value.trim() || null));
    this.codeInput = codeInput;
    el('quick').addEventListener('click', () => this.actions.quick(this.name));
    el('refresh').addEventListener('click', () => this.actions.refresh());
    el('single').addEventListener('click', () => this.actions.singlePlayer());
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get name(): string {
    const value = this.nameInput.value.trim().slice(0, USERNAME.max);
    return value || 'Pilot';
  }

  /** The server confirmed our username: it is what the field shows (and remembers) from now on. */
  setName(name: string): void {
    this.nameInput.value = name;
    saveName(name);
  }

  get open(): boolean {
    return this.screen !== 'hidden';
  }

  /** Empties the code field once a join has used it. */
  clearCode(): void {
    this.codeInput.value = '';
  }

  /** The session list. `ping`: the round trip to the server (ms), when measured. */
  showRooms(rooms: SessionListing[] | null, note: string | null, tone: 'info' | 'bad' = 'info', ping: number | null = null): void {
    this.screen = 'rooms';
    this.root.hidden = false;
    this.rooms.hidden = false;
    this.claim.hidden = true;
    this.results.hidden = true;
    this.status.textContent = note ?? '';
    this.status.dataset.tone = tone;
    const list = this.rooms.querySelector<HTMLElement>('[data-u="list"]')!;
    if (rooms === null) return;
    if (rooms.length === 0) {
      list.innerHTML = `<div class="mp-empty">No sessions running. Quick join starts one.</div>`;
      return;
    }
    list.innerHTML = rooms
      .map((r) => {
        const full = r.players >= r.capacity;
        const why = r.joinable ? '' : full ? 'Full' : 'Ending';
        return `<div class="mp-room${r.joinable ? '' : ' full'}">
          <span class="mp-room-title">${esc(r.title)}</span>
          ${stat({ icon: 'fighter', value: `${r.players}/${r.capacity}`, label: 'Players' })}
          ${stat({ icon: 'clock', value: clockText(r.left), label: 'Time left' })}
          ${ping !== null ? stat({ icon: 'radar', value: String(ping), suffix: 'ms', label: 'Round trip to the server' }) : '<span></span>'}
          ${button({ label: r.joinable ? 'Join' : why, variant: r.joinable ? 'primary' : 'secondary', size: 'small', disabled: !r.joinable, tip: r.joinable ? undefined : full ? 'Every desk is taken' : 'Joining has closed: the session ends soon', attrs: { 'data-room': r.id } })}
        </div>`;
      })
      .join('');
    for (const b of list.querySelectorAll<HTMLButtonElement>('button[data-room]')) b.addEventListener('click', () => this.actions.join(this.name, b.dataset.room!));
  }

  /** The classroom map while our base is placed on a free desk (v0.0.12: the server picks it). */
  showClaim(view: ClaimView): void {
    this.screen = 'claim';
    this.root.hidden = false;
    this.rooms.hidden = true;
    this.claim.hidden = false;
    this.results.hidden = true;
    const key = JSON.stringify(view);
    if (key === this.lastClaimKey) return;
    this.lastClaimKey = key;
    const cells = view.cells
      .map((c) => {
        const free = c.claimable && !c.owner && c.state !== 'empty';
        const tone = c.owner ? `style="--owner: ${colourCss(c.colour)}"` : '';
        const body = c.owner
          ? `<span class="mp-owner">${icon('home', 'icon mp-swatch')}${esc(c.ownerName ?? '?')}${c.state === 'draining' ? ' (leaving)' : c.connected ? '' : ' (away)'}</span>`
          : c.state === 'empty'
            ? `<span class="mp-ai">${icon('clock')}Empty · opens soon</span>`
            : c.state === 'open'
              ? `<span class="mp-free">${icon('slot')}Free desk</span>`
              : `<span class="mp-free">${icon('turret')}AI desk${c.threat > 0 ? ` · defenses ${'▮'.repeat(c.threat)}` : ''}</span>`;
        return `<button class="mp-cell${free ? ' free' : ''}${c.owner ? ' owned' : ''}${c.mine ? ' mine' : ''}" data-t="${c.id}" data-desk="${c.state}" disabled ${tone}>
          <span class="mp-cell-id">${c.id}</span><span class="mp-cell-name">${esc(c.name)}</span>${body}</button>`;
      })
      .join('');
    const username = view.username
      ? `<div class="mp-username"><label class="mp-field" data-tip="What everyone sees you as. You can change it once a week."><span>${icon('pencil')}Choose a username</span><input class="mp-input" data-u="uname" maxlength="${USERNAME.max}" spellcheck="false" autocomplete="nickname" value="${esc(view.username.value)}" placeholder="${USERNAME.min} to ${USERNAME.max} letters, digits or _" /></label>${button({ label: 'Use this name', icon: 'ok', variant: 'primary', attrs: { 'data-u': 'usename' } })}${view.username.note ? errorHtml(view.username.note) : ''}</div>`
      : '';
    const players = view.players
      .map((p) => {
        const presence = presenceOf({ present: true, connected: p.connected, protect: 0, shield: 0 });
        return `<span class="mp-player${p.me ? ' me' : ''}" data-presence="${presence}" style="--owner:${colourCss(p.colour)}">${icon('fighter', 'icon mp-swatch')}<b>${esc(p.name)}</b>${p.territory ? `<small>${esc(p.territory)}</small>` : ''}${presence === 'online' ? '' : `${icon(PRESENCE_ICONS[presence])}<small>${PRESENCE_LABELS[presence]}</small>`}</span>`;
      })
      .join('');
    this.claim.innerHTML = /* html */ `<div class="ui-card-body">
      <div class="mp-head"><b class="mp-brand">paperwars<span>.io</span></b><h2>${esc(view.title)}</h2></div>
      <p class="mp-hint">${view.username ? 'Pick the name everyone will see you as, and your base is placed.' : view.error ? 'Your base is waiting.' : 'Landing your base on a random free desk…'} Your base is yours: it comes with you to whichever desk you get, exactly as you left it.</p>
      ${username}
      <div class="mp-map">${cells}</div>
      <div class="mp-players">${players}</div>
      ${view.error ? errorHtml(view.error) : ''}
      <div class="mp-foot">${view.error ? button({ label: 'Try again', icon: 'swap', size: 'small', variant: 'primary', attrs: { 'data-u': 'retry' } }) : '<span></span>'}${button({ label: 'Leave', icon: 'close', size: 'small', attrs: { 'data-u': 'leave' } })}</div></div>`;
    this.claim.querySelector('[data-u="retry"]')?.addEventListener('click', () => this.actions.claim(''));
    const uname = this.claim.querySelector<HTMLInputElement>('[data-u="uname"]');
    if (uname) {
      // Whatever is typed is kept across redraws until it is sent.
      uname.value = this.typedUsername ?? uname.value;
      uname.addEventListener('input', () => (this.typedUsername = uname.value));
      const send = () => {
        const problem = usernameProblem(uname.value.trim());
        if (problem) {
          this.claim.querySelector('.mp-username .mp-error')?.remove();
          uname.closest('.mp-username')!.insertAdjacentHTML('beforeend', errorHtml(USERNAME_PROBLEMS[problem]));
          return;
        }
        this.actions.chooseUsername(uname.value.trim());
      };
      this.claim.querySelector('[data-u="usename"]')!.addEventListener('click', send);
      uname.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') send();
      });
    } else {
      this.typedUsername = null;
    }
    this.claim.querySelector('[data-u="leave"]')!.addEventListener('click', () => this.actions.leave());
  }

  /** The end of a session: placings, kills, raids, missions and paper, and "Join next session". */
  showResults(results: SessionResultsDTO, me: string | null): void {
    this.screen = 'results';
    this.root.hidden = false;
    this.rooms.hidden = true;
    this.claim.hidden = true;
    this.results.hidden = false;
    this.lastClaimKey = '';
    const rows = results.lines
      .map(
        (l) => `<tr data-presence="${l.present ? 'online' : 'offline'}"${l.id === me ? ' data-me' : ''}><td class="num mp-place">${l.placing <= 3 ? icon('medal', `icon mp-medal-${l.placing}`) : ''}${l.placing}</td>
          <th scope="row" class="mp-pilot" style="--owner:${colourCss(l.colour)}">${icon('fighter', 'icon mp-swatch')}<b>${esc(l.name)}</b>${l.id === me ? chip({ label: 'You', tone: 'friend' }) : ''}${l.present ? '' : chip({ label: 'Left', icon: 'offline' })}</th>
          <td class="num mp-score">${l.score}</td><td class="num">${l.kills}</td><td class="num">${l.raids}</td><td class="num">${l.missions}</td><td class="num">+${l.paper}</td></tr>`,
      )
      .join('');
    const mine = results.lines.find((l) => l.id === me);
    this.results.innerHTML = /* html */ `<div class="ui-card-body"><div class="mp-head"><b class="mp-brand">paperwars<span>.io</span></b><h2>${esc(results.title)}: results</h2></div>
      <p class="mp-hint">${results.reason ? esc(results.reason) : `The session is over after ${clockText(results.played)}.`}${mine ? ` You placed <b>${ordinal(mine.placing)}</b> of ${results.lines.length}.` : ''} Your base, paper and planes are saved and come with you.</p>
      <table class="mp-table mp-results-table">
        <thead><tr><th scope="col" data-tip="Placing">#</th><th scope="col">Player</th><th scope="col" data-tip="Score" aria-label="Score">${icon('medal')}</th><th scope="col" data-tip="Kills" aria-label="Kills">${icon('kills')}</th><th scope="col" data-tip="Raids" aria-label="Raids">${icon('raid')}</th><th scope="col" data-tip="Missions" aria-label="Missions">${icon('ok')}</th><th scope="col" data-tip="Paper earned" aria-label="Paper earned">${icon('paper')}</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="mp-muted">Nobody played in this session.</td></tr>'}</tbody>
      </table>
      <div class="mp-foot">${button({ label: 'Join next session', icon: 'plane', variant: 'primary', size: 'big', attrs: { 'data-u': 'next' } })}${button({ label: 'Back to the list', icon: 'close', size: 'small', attrs: { 'data-u': 'leave' } })}</div></div>`;
    this.results.querySelector('[data-u="next"]')!.addEventListener('click', () => this.actions.next(this.name));
    this.results.querySelector('[data-u="leave"]')!.addEventListener('click', () => this.actions.leave());
  }

  get showingResults(): boolean {
    return this.screen === 'results';
  }

  hide(): void {
    this.screen = 'hidden';
    this.root.hidden = true;
    this.lastClaimKey = '';
  }
}

/** A problem the player must fix: an icon and the words, read out at once. */
function errorHtml(text: string): string {
  return `<p class="mp-error" role="alert">${icon('warn')}<span>${esc(text)}</span></p>`;
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignore
  }
}

/** 42:05, or 1:02:00 for an hour or more. */
export function clockText(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

function ordinal(n: number): string {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
