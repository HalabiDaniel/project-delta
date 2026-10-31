import { icon } from '../ui/icons';
import { colourCss, NET } from '../net/protocol';
import type { RoomListing } from './NetClient';

export interface LobbyActions {
  quick(name: string): void;
  create(name: string, title: string): void;
  join(name: string, roomId: string): void;
  refresh(): void;
  claim(territoryId: string): void;
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
}

export interface ClaimView {
  title: string;
  cells: ClaimCell[];
  players: Array<{ name: string; colour: number; territory: string | null; connected: boolean; me: boolean }>;
  error: string | null;
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
  private readonly titleInput: HTMLInputElement;
  private screen: 'rooms' | 'claim' | 'hidden' = 'rooms';
  private lastClaimKey = '';

  constructor(parent: HTMLElement, private readonly actions: LobbyActions) {
    this.root = document.createElement('div');
    this.root.className = 'mp-lobby';
    this.root.innerHTML = /* html */ `
      <div class="mp-card card" data-u="rooms">
        <div class="mp-head"><b class="brand">paperwars<span>.io</span></b><h2>Multiplayer</h2></div>
        <label class="mp-field"><span>${icon('pencil')}Your name</span><input data-u="name" maxlength="${NET.nameMax}" autocomplete="nickname" spellcheck="false" /></label>
        <div class="mp-row">
          <button class="btn primary" data-u="quick">${icon('plane')}<span>Quick join</span></button>
          <span class="mp-or">or</span>
          <input class="mp-title" data-u="title" maxlength="${NET.nameMax}" placeholder="Classroom name" spellcheck="false" />
          <button class="btn" data-u="create">${icon('build')}<span>New classroom</span></button>
        </div>
        <div class="mp-list" data-u="list"></div>
        <div class="mp-foot"><span class="mp-status" data-u="status"></span><button class="btn ghost small" data-u="refresh">${icon('swap')}<span>Refresh</span></button><button class="btn ghost small" data-u="single">${icon('home')}<span>Single-player</span></button></div>
      </div>
      <div class="mp-card card mp-claim" data-u="claim" hidden></div>`;
    parent.appendChild(this.root);
    const el = (u: string) => this.root.querySelector<HTMLElement>(`[data-u="${u}"]`)!;
    this.rooms = el('rooms');
    this.claim = el('claim');
    this.status = el('status');
    this.nameInput = el('name') as HTMLInputElement;
    this.titleInput = el('title') as HTMLInputElement;
    this.nameInput.value = loadName();
    this.nameInput.addEventListener('change', () => saveName(this.name));
    el('quick').addEventListener('click', () => this.actions.quick(this.name));
    el('create').addEventListener('click', () => this.actions.create(this.name, this.titleInput.value.trim() || `${this.name}'s classroom`));
    el('refresh').addEventListener('click', () => this.actions.refresh());
    el('single').addEventListener('click', () => this.actions.singlePlayer());
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get name(): string {
    const value = this.nameInput.value.trim().slice(0, NET.nameMax);
    return value || 'Pilot';
  }

  get open(): boolean {
    return this.screen !== 'hidden';
  }

  showRooms(rooms: RoomListing[] | null, note: string | null, tone: 'info' | 'bad' = 'info'): void {
    this.screen = 'rooms';
    this.root.hidden = false;
    this.rooms.hidden = false;
    this.claim.hidden = true;
    this.status.textContent = note ?? '';
    this.status.dataset.tone = tone;
    const list = this.rooms.querySelector<HTMLElement>('[data-u="list"]')!;
    if (rooms === null) return;
    if (rooms.length === 0) {
      list.innerHTML = `<div class="mp-empty">No classrooms yet. Start one, or Quick join.</div>`;
      return;
    }
    list.innerHTML = rooms
      .map((r) => {
        const full = r.clients >= r.maxClients || r.locked;
        return `<div class="mp-room${full ? ' full' : ''}">
          <span class="mp-room-title">${esc(r.metadata?.title ?? 'Classroom')}</span>
          <span class="stat" title="Players">${icon('fighter')}<b>${r.clients}/${r.maxClients}</b></span>
          <span class="stat" title="Free desks">${icon('home')}<b>${r.metadata?.free ?? '?'}</b></span>
          <button class="btn small${full ? '' : ' primary'}" data-room="${esc(r.roomId)}" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button>
        </div>`;
      })
      .join('');
    for (const b of list.querySelectorAll<HTMLButtonElement>('button[data-room]')) b.addEventListener('click', () => this.actions.join(this.name, b.dataset.room!));
  }

  /** The classroom map: pick a free desk. */
  showClaim(view: ClaimView): void {
    this.screen = 'claim';
    this.root.hidden = false;
    this.rooms.hidden = true;
    this.claim.hidden = false;
    const key = JSON.stringify(view);
    if (key === this.lastClaimKey) return;
    this.lastClaimKey = key;
    const cells = view.cells
      .map((c) => {
        const free = c.claimable && !c.owner;
        const tone = c.owner ? `style="--owner: ${colourCss(c.colour)}"` : '';
        const body = c.owner
          ? `<span class="mp-owner">${esc(c.ownerName ?? '?')}${c.connected ? '' : ' (away)'}</span>`
          : c.claimable
            ? `<span class="mp-free">Free${c.threat > 0 ? ` · AI defenses ${'▮'.repeat(c.threat)}` : ''}</span>`
            : `<span class="mp-ai">AI stronghold</span>`;
        return `<button class="mp-cell${free ? ' free' : ''}${c.owner ? ' owned' : ''}${c.mine ? ' mine' : ''}" data-t="${c.id}" ${free ? '' : 'disabled'} ${tone}>
          <span class="mp-cell-id">${c.id}</span><span class="mp-cell-name">${esc(c.name)}</span>${body}</button>`;
      })
      .join('');
    const players = view.players
      .map((p) => `<span class="mp-player${p.me ? ' me' : ''}${p.connected ? '' : ' away'}"><i style="background:${colourCss(p.colour)}"></i>${esc(p.name)}${p.territory ? ` · ${p.territory}` : ''}</span>`)
      .join('');
    this.claim.innerHTML = /* html */ `
      <div class="mp-head"><b class="brand">paperwars<span>.io</span></b><h2>${esc(view.title)}</h2></div>
      <p class="mp-hint">Pick your desk. It becomes your base: your planes fold and land there, your paper is stored there, and your guns defend it.</p>
      <div class="mp-map">${cells}</div>
      <div class="mp-players">${players}</div>
      ${view.error ? `<div class="mp-error">${esc(view.error)}</div>` : ''}
      <div class="mp-foot"><span></span><button class="btn ghost small" data-u="leave">${icon('close')}<span>Leave</span></button></div>`;
    for (const b of this.claim.querySelectorAll<HTMLButtonElement>('button[data-t]')) b.addEventListener('click', () => this.actions.claim(b.dataset.t!));
    this.claim.querySelector('[data-u="leave"]')!.addEventListener('click', () => this.actions.leave());
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

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
