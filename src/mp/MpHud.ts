import { icon, type IconName } from '../ui/icons';
import type { ScreenPoint } from '../ui/dom';
import { colourCss, type Emote, type Weapon } from '../net/protocol';
import type { ConnectionStatus } from './NetClient';

export interface NameTagView extends ScreenPoint {
  id: string;
  name: string;
  colour: number;
  health: number;
  /** 0 near → 1 far: tags shrink and fade with distance. */
  far: number;
  hostile: boolean;
  plane: string;
  emote: Emote | null;
}

export interface TerritoryTagView extends ScreenPoint {
  id: string;
  owner: string;
  colour: number;
  mine: boolean;
  safe: boolean;
  alert: boolean;
  away: boolean;
}

export interface ScoreRow {
  id: string;
  name: string;
  colour: number;
  territory: string;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  raids: number;
  defends: number;
  missions: number;
  ping: number;
  connected: boolean;
  me: boolean;
  status: string;
  protect: number;
  shield: number;
}

export interface IncomingView {
  attacker: string;
  colour: number;
  detected: boolean;
  distance: number | null;
}

export interface MpHudView {
  status: ConnectionStatus;
  ping: number;
  players: number;
  maxPlayers: number;
  room: string;
  tags: NameTagView[];
  territories: TerritoryTagView[];
  scoreboard: ScoreRow[] | null;
  incoming: IncomingView | null;
  outgoing: { victim: string; colour: number } | null;
  protection: { newPlayer: number; shield: number } | null;
  emoteKeys: boolean;
}

const WEAPON_ICONS: Record<Weapon, IconName> = { ink: 'ink', rocket: 'rocket', bomb: 'bomb', ram: 'damage', crash: 'crumple' };
const EMOTE_TEXT: Record<Emote, string> = { waggle: '〰', confetti: '✶', heart: '♥' };

/**
 * What multiplayer adds to the HUD, in the same paper style: the connection (status, round trip,
 * players), the kill feed and session news, the scoreboard (Tab), the warning when another player
 * raids your base, name tags over other players' planes and owner tags on their territories, and
 * emote bubbles.
 */
export class MpHud {
  private readonly net: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly board: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly tagLayer: HTMLElement;
  private readonly banner2: HTMLElement;
  private readonly tags = new Map<string, HTMLElement>();
  private readonly terr = new Map<string, HTMLElement>();
  private lastBoard = '';
  private lastBanner = '';
  private lastNet = '';

  constructor(root: HTMLElement) {
    const layer = document.createElement('div');
    layer.className = 'mp-layer';
    root.appendChild(layer);
    this.tagLayer = div(layer, 'mp-tags');
    this.net = div(layer, 'mp-net card');
    this.feed = div(layer, 'mp-feed');
    this.board = div(layer, 'mp-board card');
    this.banner = div(layer, 'mp-banner');
    this.banner2 = div(layer, 'mp-connection');
    this.board.hidden = true;
  }

  render(v: MpHudView): void {
    this.renderNet(v);
    this.renderTags(v.tags);
    this.renderTerritories(v.territories);
    this.renderBoard(v.scoreboard);
    this.renderBanner(v);
    const reconnecting = v.status === 'reconnecting';
    this.banner2.hidden = !reconnecting;
    if (reconnecting) this.banner2.innerHTML = `${icon('offline')}<span>Connection lost · reconnecting… your plane and desk are kept for a minute</span>`;
  }

  /** A line in the kill feed. */
  kill(killer: string | null, killerColour: number | null, victim: string, victimColour: number | null, weapon: Weapon, assists: string[], mine: boolean): void {
    const who = (name: string, colour: number | null) => `<b style="${colour !== null ? `color:${colourCss(colour)}` : ''}">${esc(name)}</b>`;
    const line = killer
      ? `${who(killer, killerColour)}${assists.length ? `<small> + ${assists.map(esc).join(', ')}</small>` : ''} ${icon(WEAPON_ICONS[weapon])} ${who(victim, victimColour)}`
      : `${icon(WEAPON_ICONS[weapon])} ${who(victim, victimColour)}`;
    this.push(line, mine ? 'mine' : 'kill');
  }

  news(text: string, tone: 'good' | 'bad' | 'info'): void {
    this.push(esc(text), `news ${tone}`);
  }

  private push(html: string, kind: string): void {
    const el = document.createElement('div');
    el.className = `mp-line ${kind}`;
    el.innerHTML = html;
    this.feed.appendChild(el);
    while (this.feed.children.length > 6) this.feed.firstElementChild!.remove();
    setTimeout(() => el.classList.add('fade'), 6000);
    setTimeout(() => el.remove(), 7000);
  }

  private renderNet(v: MpHudView): void {
    const key = `${v.status}|${Math.round(v.ping / 5)}|${v.players}|${v.room}|${v.protection?.newPlayer ?? 0}|${v.protection?.shield ?? 0}|${v.emoteKeys}`;
    if (key === this.lastNet) return;
    this.lastNet = key;
    const tone = v.status === 'connected' ? (v.ping > 200 ? 'warn' : 'good') : v.status === 'reconnecting' || v.status === 'connecting' ? 'warn' : 'bad';
    const shield = v.protection && (v.protection.newPlayer > 0 || v.protection.shield > 0)
      ? `<span class="stat" title="${v.protection.newPlayer > 0 ? 'New-player protection: nobody can raid your base yet' : 'Raid shield: your base was just raided, nobody can raid it again yet'}">${icon('shield')}<b>${fmtTime(Math.max(v.protection.newPlayer, v.protection.shield))}</b></span>`
      : '';
    this.net.innerHTML = `<span class="mp-dot" data-tone="${tone}" title="${v.status}"></span>
      <span class="stat" title="Round trip to the server">${icon('clock')}<b>${v.status === 'connected' ? Math.round(v.ping) : '—'}</b><small>ms</small></span>
      <span class="stat" title="Players in this classroom">${icon('fighter')}<b>${v.players}/${v.maxPlayers}</b></span>${shield}
      <span class="mp-room-name" title="Classroom">${esc(v.room)}</span>
      ${v.emoteKeys ? `<span class="mp-keys" title="Emotes"><kbd>Z</kbd>${EMOTE_TEXT.waggle}<kbd>C</kbd>${EMOTE_TEXT.confetti}<kbd>V</kbd>${EMOTE_TEXT.heart}<kbd>Tab</kbd>${icon('kills')}</span>` : `<span class="mp-keys"><kbd>Tab</kbd>${icon('kills')}</span>`}`;
  }

  private renderTags(tags: NameTagView[]): void {
    const seen = new Set<string>();
    for (const t of tags) {
      seen.add(t.id);
      let el = this.tags.get(t.id);
      if (!el) {
        el = div(this.tagLayer, 'mp-tag');
        el.innerHTML = `<span class="mp-tag-name"></span><span class="mp-tag-bar"><i></i></span><span class="mp-tag-emote"></span>`;
        this.tags.set(t.id, el);
      }
      el.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -100%) scale(${1 - t.far * 0.35})`;
      el.style.opacity = String(1 - t.far * 0.5);
      el.style.setProperty('--owner', colourCss(t.colour));
      el.classList.toggle('hostile', t.hostile);
      const name = el.children[0] as HTMLElement;
      const label = `${t.name} · ${t.plane}`;
      if (name.textContent !== label) name.textContent = label;
      (el.children[1].firstElementChild as HTMLElement).style.width = `${Math.round(t.health * 100)}%`;
      const emote = el.children[2] as HTMLElement;
      const text = t.emote ? EMOTE_TEXT[t.emote] : '';
      if (emote.textContent !== text) {
        emote.textContent = text;
        emote.classList.remove('pop');
        void emote.offsetWidth;
        if (text) emote.classList.add('pop');
      }
    }
    for (const [id, el] of this.tags) {
      if (seen.has(id)) continue;
      el.remove();
      this.tags.delete(id);
    }
  }

  private renderTerritories(views: TerritoryTagView[]): void {
    const seen = new Set<string>();
    for (const t of views) {
      seen.add(t.id);
      let el = this.terr.get(t.id);
      if (!el) {
        el = div(this.tagLayer, 'mp-terr');
        this.terr.set(t.id, el);
      }
      el.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -50%)`;
      el.style.setProperty('--owner', colourCss(t.colour));
      const html = `${t.mine ? icon('home') : ''}<b>${esc(t.owner)}</b>${t.away ? '<small>away</small>' : ''}${t.safe ? icon('shield') : ''}${t.alert ? icon('raid') : ''}`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.classList.toggle('alert', t.alert);
    }
    for (const [id, el] of this.terr) {
      if (seen.has(id)) continue;
      el.remove();
      this.terr.delete(id);
    }
  }

  private renderBoard(rows: ScoreRow[] | null): void {
    this.board.hidden = !rows;
    if (!rows) return;
    const key = JSON.stringify(rows);
    if (key === this.lastBoard) return;
    this.lastBoard = key;
    const body = rows
      .map(
        (r) => `<tr class="${r.me ? 'me' : ''}${r.connected ? '' : ' away'}">
          <td><i style="background:${colourCss(r.colour)}"></i>${esc(r.name)}${r.protect > 0 ? ` ${icon('shield', 'icon', 'New-player protection')}` : r.shield > 0 ? ` ${icon('shield', 'icon', 'Raid shield')}` : ''}</td>
          <td>${r.territory || '—'}</td><td><b>${r.score}</b></td><td>${r.kills}</td><td>${r.assists}</td><td>${r.deaths}</td><td>${r.raids}</td><td>${r.defends}</td><td>${r.missions}</td>
          <td class="mp-status-cell">${esc(r.status)}</td><td>${r.connected ? `${r.ping}` : 'away'}</td></tr>`,
      )
      .join('');
    this.board.innerHTML = `<table><thead><tr><th>Pilot</th><th>Desk</th><th title="Score">${icon('medal')}</th><th title="Kills">${icon('kills')}</th><th title="Assists">+</th><th title="Times shot down">${icon('crumple')}</th><th title="Raids that got through">${icon('bomb')}</th><th title="Raiders stopped">${icon('shield')}</th><th title="Missions done">${icon('ok')}</th><th></th><th title="Ping (ms)">${icon('clock')}</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  private renderBanner(v: MpHudView): void {
    let html = '';
    let tone = '';
    if (v.incoming) {
      tone = 'bad';
      html = `${icon('raid')}<b style="color:${colourCss(v.incoming.colour)}">${esc(v.incoming.attacker)}</b><span>is raiding your base${v.incoming.detected && v.incoming.distance !== null ? ` · ${v.incoming.distance} m out` : v.incoming.detected ? '' : ' · not on radar yet'}</span>`;
    } else if (v.outgoing) {
      tone = 'warn';
      html = `${icon('bomb')}<span>Raid on</span><b style="color:${colourCss(v.outgoing.colour)}">${esc(v.outgoing.victim)}</b>`;
    }
    const key = `${tone}|${html}`;
    if (key === this.lastBanner) return;
    this.lastBanner = key;
    this.banner.hidden = !html;
    this.banner.dataset.tone = tone;
    this.banner.innerHTML = html;
  }
}

function div(parent: HTMLElement, className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  parent.appendChild(el);
  return el;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${Math.ceil(s)}s`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
