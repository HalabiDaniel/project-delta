import { insigniaSlot } from './MpHud';
import { insigniaView } from '../ranks/insignia';
import { stepAt } from '../ranks/Ranks';
import { profileCardHtml } from './RankUi';
import { button, card, chip, stat } from '../ui/components';
import { icon } from '../ui/icons';
import { colourCss, type DeskState, type SessionResultsDTO } from '../net/protocol';
import { USERNAME, USERNAME_PROBLEMS, suggestUsername, usernameProblem } from '../net/Username';
import type { SessionListing } from './NetClient';
import { presenceOf, PRESENCE_ICONS, PRESENCE_LABELS } from './presence';
import { count, longClock, paper } from '../ui/format';
import { T } from '../ui/strings';

const L = T.lobby;

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
        <div class="mp-head">${brand}<h2>${esc(L.title)}</h2></div>
        <label class="mp-field" data-tip="${esc(L.usernameTip(USERNAME.min, USERNAME.max))}"><span>${icon('pencil')}${esc(L.username)}</span><input class="mp-input" data-u="name" maxlength="${USERNAME.max}" autocomplete="nickname" spellcheck="false" placeholder="${esc(L.usernamePlaceholder(USERNAME.min, USERNAME.max))}" /></label>
        <label class="mp-field" data-tip="${esc(L.codeTip)}"><span>${icon('swap')}${esc(L.code)}</span><input class="mp-input" data-u="code" maxlength="16" autocomplete="off" spellcheck="false" placeholder="${esc(L.codePlaceholder)}" /></label>
        <div class="mp-row">
          ${button({ label: L.quickJoin, icon: 'plane', variant: 'primary', size: 'big', tip: L.quickJoinTip, attrs: { 'data-u': 'quick' } })}
          <span class="mp-or">${esc(L.orPick)}</span>
        </div>
        <div class="mp-list" data-u="list" data-nav-scroll></div>
        <div class="mp-foot"><span class="mp-status" data-u="status" role="status"></span>${button({ label: L.refresh, icon: 'swap', size: 'small', attrs: { 'data-u': 'refresh' } })}${button({ label: L.singlePlayer, icon: 'home', size: 'small', attrs: { 'data-u': 'single' } })}</div>`;
    this.root.innerHTML =
      card({ label: L.title, bodyHtml: rooms, elevation: 'floating', className: 'mp-card', attrs: { 'data-u': 'rooms' } }) +
      card({ label: L.yourDesk, bodyHtml: '', elevation: 'floating', className: 'mp-card mp-claim', attrs: { 'data-u': 'claim', hidden: true } }) +
      card({ label: L.sessionResults, bodyHtml: '', elevation: 'floating', className: 'mp-card mp-results', attrs: { 'data-u': 'results', hidden: true } });
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
    // A code from the main menu's Join tab (?invite=) goes with the first join.
    if (codeInput.value.trim()) this.actions.setCode(codeInput.value.trim());
    this.codeInput = codeInput;
    el('quick').addEventListener('click', () => this.actions.quick(this.name));
    el('refresh').addEventListener('click', () => this.actions.refresh());
    el('single').addEventListener('click', () => this.actions.singlePlayer());
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get name(): string {
    const value = this.nameInput.value.trim().slice(0, USERNAME.max);
    return value || L.defaultName;
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
      list.innerHTML = `<div class="mp-empty">${esc(L.noSessions)}</div>`;
      return;
    }
    list.innerHTML = rooms
      .map((r) => {
        const full = r.players >= r.capacity;
        const why = r.joinable ? '' : full ? L.full : L.ending;
        return `<div class="mp-room${r.joinable ? '' : ' full'}">
          <span class="mp-room-title">${esc(r.title)}</span>
          ${stat({ icon: 'fighter', value: `${count(r.players)}/${count(r.capacity)}`, label: L.players })}
          ${stat({ icon: 'clock', value: clockText(r.left), label: L.timeLeft })}
          ${ping !== null ? stat({ icon: 'radar', value: count(ping), suffix: L.ms, label: L.roundTrip }) : '<span></span>'}
          ${button({ label: r.joinable ? L.join : why, variant: r.joinable ? 'primary' : 'secondary', size: 'small', disabled: !r.joinable, tip: r.joinable ? undefined : full ? L.fullTip : L.endingTip, attrs: { 'data-room': r.id } })}
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
          ? `<span class="mp-owner">${icon('home', 'icon mp-swatch')}${esc(c.ownerName ?? '?')}${c.state === 'draining' ? esc(L.leaving) : c.connected ? '' : esc(L.away)}</span>`
          : c.state === 'empty'
            ? `<span class="mp-ai">${icon('clock')}${esc(L.emptyDesk)}</span>`
            : c.state === 'open'
              ? `<span class="mp-free">${icon('slot')}${esc(L.freeDesk)}</span>`
              : `<span class="mp-free">${icon('turret')}${esc(L.aiDesk)}${c.threat > 0 ? esc(L.aiDefenses('▮'.repeat(c.threat))) : ''}</span>`;
        return `<button class="mp-cell${free ? ' free' : ''}${c.owner ? ' owned' : ''}${c.mine ? ' mine' : ''}" data-t="${c.id}" data-desk="${c.state}" disabled ${tone}>
          <span class="mp-cell-id">${esc(c.id)}</span><span class="mp-cell-name">${esc(c.name)}</span>${body}</button>`;
      })
      .join('');
    const username = view.username
      ? `<div class="mp-username"><label class="mp-field" data-tip="${esc(L.usernameTipShort)}"><span>${icon('pencil')}${esc(L.chooseUsername)}</span><input class="mp-input" data-u="uname" maxlength="${USERNAME.max}" spellcheck="false" autocomplete="nickname" value="${esc(view.username.value)}" placeholder="${esc(L.usernamePlaceholder(USERNAME.min, USERNAME.max))}" /></label>${button({ label: L.useName, icon: 'ok', variant: 'primary', attrs: { 'data-u': 'usename' } })}${view.username.note ? errorHtml(view.username.note) : ''}</div>`
      : '';
    const players = view.players
      .map((p) => {
        const presence = presenceOf({ present: true, connected: p.connected, protect: 0, shield: 0 });
        return `<span class="mp-player${p.me ? ' me' : ''}" data-presence="${presence}" style="--owner:${colourCss(p.colour)}">${icon('fighter', 'icon mp-swatch')}<b>${esc(p.name)}</b>${p.territory ? `<small>${esc(p.territory)}</small>` : ''}${presence === 'online' ? '' : `${icon(PRESENCE_ICONS[presence])}<small>${esc(PRESENCE_LABELS[presence])}</small>`}</span>`;
      })
      .join('');
    this.claim.innerHTML = /* html */ `<div class="ui-card-body">
      <div class="mp-head"><b class="mp-brand">paperwars<span>.io</span></b><h2>${esc(view.title)}</h2></div>
      <p class="mp-hint">${esc(view.username ? L.hintUsername : view.error ? L.hintWaiting : L.hintLanding)} ${esc(L.hintYours)}</p>
      ${username}
      <div class="mp-map">${cells}</div>
      <div class="mp-players">${players}</div>
      ${view.error ? errorHtml(view.error) : ''}
      <div class="mp-foot">${view.error ? button({ label: L.tryAgain, icon: 'swap', size: 'small', variant: 'primary', attrs: { 'data-u': 'retry' } }) : '<span></span>'}${button({ label: L.leave, icon: 'close', size: 'small', attrs: { 'data-u': 'leave' } })}</div></div>`;
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
        (l) => `<tr data-presence="${l.present ? 'online' : 'offline'}"${l.id === me ? ' data-me' : ''}><td class="num mp-place">${l.placing <= 3 ? icon('medal', `icon mp-medal-${l.placing}`) : ''}${count(l.placing)}</td>
          <th scope="row" class="mp-pilot" style="--owner:${colourCss(l.colour)}">${icon('fighter', 'icon mp-swatch')}${l.rank !== undefined ? insigniaSlot(insigniaView(l.rank)) : ''}<b>${esc(l.name)}</b>${l.id === me ? chip({ label: L.you, tone: 'friend' }) : ''}${l.present ? '' : chip({ label: L.left, icon: 'offline' })}</th>
          <td class="num mp-score">${count(l.score)}</td><td class="num">${count(l.kills)}</td><td class="num">${count(l.raids)}</td><td class="num">${count(l.missions)}</td><td class="num">+${paper(l.paper)}</td></tr>`,
      )
      .join('');
    const mine = results.lines.find((l) => l.id === me);
    this.results.innerHTML = /* html */ `<div class="ui-card-body"><div class="mp-head"><b class="mp-brand">paperwars<span>.io</span></b><h2>${esc(L.resultsTitle(results.title))}</h2></div>
      <p class="mp-hint">${results.reason ? esc(results.reason) : esc(L.over(clockText(results.played)))}${mine ? bold(L.placed(PLACE, results.lines.length), PLACE, L.ordinal(mine.placing)) : ''}${esc(L.saved)}</p>
      <table class="mp-table mp-results-table">
        <thead><tr><th scope="col" data-tip="${esc(L.placing)}">${esc(L.placingHead)}</th><th scope="col">${esc(L.player)}</th>${([['score', 'medal'], ['kills', 'kills'], ['raids', 'raid'], ['missions', 'ok'], ['paperEarned', 'paper']] as const).map(([k, i]) => `<th scope="col" data-tip="${esc(L[k])}" aria-label="${esc(L[k])}">${icon(i)}</th>`).join('')}</tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="mp-muted">${esc(L.nobody)}</td></tr>`}</tbody>
      </table>
      ${topCards(results.lines)}
      <div class="mp-foot">${button({ label: L.joinNext, icon: 'plane', variant: 'primary', size: 'big', attrs: { 'data-u': 'next' } })}${button({ label: L.backToList, icon: 'close', size: 'small', attrs: { 'data-u': 'leave' } })}</div></div>`;
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

/** v0.0.17: the top players' profile cards on the results. */
function topCards(lines: SessionResultsDTO['lines']): string {
  const top = lines.filter((l) => l.placing <= 3 && l.rank !== undefined).slice(0, 3);
  if (top.length === 0) return '';
  const R = T.ranks;
  const cards = top.map((l) => profileCardHtml({ name: l.name, step: stepAt(l.rank!), title: l.title ?? null, card: null, stats: [{ label: R.shotDown, value: l.kills }, { label: R.missions, value: l.missions }, { label: R.raids, value: l.raids }] }, 'rank-card-small')).join('');
  return `<div class="mp-result-cards">${cards}</div>`;
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

/** 42:05, or 1:02:00 for an hour or more (src/ui/format.ts `longClock`). */
export const clockText = (seconds: number): string => longClock(seconds);

/** A stand-in for a bold word inside a dictionary sentence (the sentence is escaped, the word put back in bold). */
const PLACE = '\u0001';
function bold(sentence: string, token: string, word: string): string {
  return esc(sentence).replace(token, `<b>${esc(word)}</b>`);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
