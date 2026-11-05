import { icon } from '../ui/icons';
import { colourCss, type DeskState, type SessionResultsDTO } from '../net/protocol';
import { USERNAME, USERNAME_PROBLEMS, suggestUsername, usernameProblem } from '../net/Username';
import type { SessionListing } from './NetClient';

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
    this.root.className = 'mp-lobby';
    this.root.innerHTML = /* html */ `
      <div class="mp-card card" data-u="rooms">
        <div class="mp-head"><b class="brand">paperwars<span>.io</span></b><h2>Multiplayer</h2></div>
        <label class="mp-field" title="What everyone sees you as: ${USERNAME.min} to ${USERNAME.max} letters, digits or _. You can change it once a week."><span>${icon('pencil')}Username</span><input data-u="name" maxlength="${USERNAME.max}" autocomplete="nickname" spellcheck="false" placeholder="${USERNAME.min} to ${USERNAME.max} letters, digits or _" /></label>
        <label class="mp-field" title="Only needed the first time on this computer: the invite you were sent, or a transfer code from your other computer"><span>${icon('swap')}Code</span><input data-u="code" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Invite or transfer code (first time only)" /></label>
        <div class="mp-row">
          <button class="btn primary" data-u="quick" title="Join the busiest session with a free desk (a new one opens if every session is full)">${icon('plane')}<span>Quick join</span></button>
          <span class="mp-or">or pick a session below. Each lasts an hour; your base comes with you.</span>
        </div>
        <div class="mp-list" data-u="list"></div>
        <div class="mp-foot"><span class="mp-status" data-u="status"></span><button class="btn ghost small" data-u="refresh">${icon('swap')}<span>Refresh</span></button><button class="btn ghost small" data-u="single">${icon('home')}<span>Single-player</span></button></div>
      </div>
      <div class="mp-card card mp-claim" data-u="claim" hidden></div>
      <div class="mp-card card mp-results" data-u="results" hidden></div>`;
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
          <span class="stat" title="Players">${icon('fighter')}<b>${r.players}/${r.capacity}</b></span>
          <span class="stat" title="Time left">${icon('clock')}<b>${clockText(r.left)}</b></span>
          ${ping !== null ? `<span class="stat" title="Round trip to the server">${icon('radar')}<b>${ping} ms</b></span>` : ''}
          <button class="btn small${r.joinable ? ' primary' : ''}" data-room="${esc(r.id)}" ${r.joinable ? '' : `disabled title="${full ? 'Every desk is taken' : 'Joining has closed: the session ends soon'}"`}>${r.joinable ? 'Join' : why}</button>
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
          ? `<span class="mp-owner">${esc(c.ownerName ?? '?')}${c.state === 'draining' ? ' (leaving)' : c.connected ? '' : ' (away)'}</span>`
          : c.state === 'empty'
            ? `<span class="mp-ai">Empty · opens soon</span>`
            : c.state === 'open'
              ? `<span class="mp-free">Free desk</span>`
              : `<span class="mp-free">AI desk${c.threat > 0 ? ` · defenses ${'▮'.repeat(c.threat)}` : ''}</span>`;
        return `<button class="mp-cell${free ? ' free' : ''}${c.owner ? ' owned' : ''}${c.mine ? ' mine' : ''}" data-t="${c.id}" disabled ${tone}>
          <span class="mp-cell-id">${c.id}</span><span class="mp-cell-name">${esc(c.name)}</span>${body}</button>`;
      })
      .join('');
    const username = view.username
      ? `<div class="mp-username"><label class="mp-field" title="What everyone sees you as. You can change it once a week."><span>${icon('pencil')}Choose a username</span><input data-u="uname" maxlength="${USERNAME.max}" spellcheck="false" autocomplete="nickname" value="${esc(view.username.value)}" placeholder="${USERNAME.min} to ${USERNAME.max} letters, digits or _" /></label><button class="btn primary small" data-u="usename">${icon('ok')}<span>Use this name</span></button>${view.username.note ? `<div class="mp-error">${esc(view.username.note)}</div>` : ''}</div>`
      : '';
    const players = view.players
      .map((p) => `<span class="mp-player${p.me ? ' me' : ''}${p.connected ? '' : ' away'}"><i style="background:${colourCss(p.colour)}"></i>${esc(p.name)}${p.territory ? ` · ${p.territory}` : ''}</span>`)
      .join('');
    this.claim.innerHTML = /* html */ `
      <div class="mp-head"><b class="brand">paperwars<span>.io</span></b><h2>${esc(view.title)}</h2></div>
      <p class="mp-hint">${view.username ? 'Pick the name everyone will see you as, and your base is placed.' : view.error ? 'Your base is waiting.' : 'Landing your base on a random free desk…'} Your base is yours: it comes with you to whichever desk you get, exactly as you left it.</p>
      ${username}
      <div class="mp-map">${cells}</div>
      <div class="mp-players">${players}</div>
      ${view.error ? `<div class="mp-error">${esc(view.error)}</div>` : ''}
      <div class="mp-foot">${view.error ? `<button class="btn small" data-u="retry">${icon('swap')}<span>Try again</span></button>` : '<span></span>'}<button class="btn ghost small" data-u="leave">${icon('close')}<span>Leave</span></button></div>`;
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
          uname.closest('.mp-username')!.insertAdjacentHTML('beforeend', `<div class="mp-error">${esc(USERNAME_PROBLEMS[problem])}</div>`);
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
        (l) => `<tr class="${l.id === me ? 'me' : ''}${l.present ? '' : ' away'}"><td class="mp-place">${l.placing}</td>
          <td><i class="mp-dot" style="background:${colourCss(l.colour)}"></i>${esc(l.name)}${l.present ? '' : ' <span class="muted">(left)</span>'}</td>
          <td>${l.score}</td><td>${l.kills}</td><td>${l.raids}</td><td>${l.missions}</td><td>+${l.paper}</td></tr>`,
      )
      .join('');
    const mine = results.lines.find((l) => l.id === me);
    this.results.innerHTML = /* html */ `
      <div class="mp-head"><b class="brand">paperwars<span>.io</span></b><h2>${esc(results.title)}: results</h2></div>
      <p class="mp-hint">${results.reason ? esc(results.reason) : `The session is over after ${clockText(results.played)}.`}${mine ? ` You placed <b>${ordinal(mine.placing)}</b> of ${results.lines.length}.` : ''} Your base, paper and planes are saved and come with you.</p>
      <table class="mp-results-table">
        <thead><tr><th title="Placing">#</th><th>Player</th><th title="Score">${icon('medal')}</th><th title="Kills">${icon('crumple')}</th><th title="Raids">${icon('raid')}</th><th title="Missions">${icon('ok')}</th><th title="Paper earned">${icon('paper')}</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="muted">Nobody played in this session.</td></tr>'}</tbody>
      </table>
      <div class="mp-foot"><button class="btn primary" data-u="next">${icon('plane')}<span>Join next session</span></button><button class="btn ghost small" data-u="leave">${icon('close')}<span>Back to the list</span></button></div>`;
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
