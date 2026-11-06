import { alert, bar, button, card, chip, glyph, iconButton, stat, type Tone } from '../ui/components';
import { bindButton, esc, type ScreenPoint } from '../ui/dom';
import { metres } from '../ui/format';
import { icon, type IconName } from '../ui/icons';
import type { HudZone } from '../ui/HUD';
import { colourCss, type DeskState, type Emote, type Weapon } from '../net/protocol';
import type { ConnectionStatus } from './NetClient';
import { PRESENCE_ICONS, PRESENCE_LABELS, PRESENCE_TIPS, PRESENCE_TONES, type Presence } from './presence';

/**
 * A player's rank insignia (player ranks arrive in v0.0.17). The scoreboard rows, the name tags
 * over planes and the kill-feed entries keep a slot for it in front of the name: `insigniaSlot()`
 * renders nothing while the rank is absent (as today), so adding ranks fills the slot without a
 * layout change. v0.0.17 decides the insignia's look; the slot is an inline element sized by em.
 */
export interface InsigniaView {
  /** The rank's id (data attribute, for styling). */
  id: string;
  /** Its name, for the accessible name and the tooltip ("Sergeant"). */
  label: string;
  /** The insignia's markup (trusted: an icon from the shared set). */
  html: string;
}

/** The insignia slot: empty until a rank is given. */
export function insigniaSlot(rank: InsigniaView | null | undefined): string {
  if (!rank) return '';
  return `<span class="mp-insignia" role="img" data-rank="${esc(rank.id)}" aria-label="${esc(rank.label)}" data-tip="${esc(rank.label)}">${rank.html}</span>`;
}

export interface NameTagView extends ScreenPoint {
  id: string;
  name: string;
  /** Rank insignia (v0.0.17); absent today. */
  rank?: InsigniaView | null;
  colour: number;
  health: number;
  /** 0 near → 1 far: tags shrink and fade with distance. */
  far: number;
  hostile: boolean;
  plane: string;
  emote: Emote | null;
}

/** The tag over another player's desk: "{username}'s desk", where they are, and whether it is safe or under attack. */
export interface TerritoryTagView extends ScreenPoint {
  id: string;
  /** "Daniel's desk". */
  label: string;
  owner: string;
  colour: number;
  mine: boolean;
  /** Can't be raided now. */
  safe: boolean;
  /** A player is raiding it. */
  alert: boolean;
  presence: Presence;
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
  presence: Presence;
  /** Rank insignia (v0.0.17); absent today. */
  rank?: InsigniaView | null;
}

/** Another player raiding our base: who, how far, how long, and the one-press response. */
export interface IncomingView {
  attacker: string;
  colour: number;
  detected: boolean;
  /** Metres from our desk as the server reports it (when on radar). */
  distance: number | null;
  /** Seconds until they reach our desk, when known. */
  eta: number | null;
  /** Compass direction they come from, when known. */
  direction: string | null;
  /** Our weapons standing. */
  ready: number;
  total: number;
  reward: number;
  /** What one press does now: fold the interception card, launch, take off (null in flight). */
  response: { key: string; label: string } | null;
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
  /** The emote bar shows (in flight). */
  emoteKeys: boolean;
  /** Seconds of the session left (v0.0.13), and whether joining has closed (the end is near). */
  sessionLeft: number | null;
  closing: boolean;
}

export interface MpHudActions {
  emote(e: Emote): void;
  /** The raid card's one press: fold the interception card (or launch / take off). */
  intercept(): void;
}

/** Where the multiplayer panels go: the HUD's zones, so they scale with the HUD size and the window. */
export type MpHudZones = Pick<Record<HudZone, HTMLElement>, 'tl' | 'tc' | 'tr' | 'centre'>;

/** Who of the two in a kill-feed line is us. */
export type FeedSelf = 'killer' | 'victim' | null;

export const WEAPON_ICONS: Readonly<Record<Weapon, IconName>> = { ink: 'ink', rocket: 'rocket', bomb: 'bomb', ram: 'damage', crash: 'crumple' };
export const WEAPON_NAMES: Readonly<Record<Weapon, string>> = { ink: 'Ink', rocket: 'Rocket', bomb: 'Bomb', ram: 'Collision', crash: 'Crashed' };
/** Emotes as icons (not text glyphs), their names and their keys (Z / C / V, D-pad ↑ ← →). */
export const EMOTES: ReadonlyArray<{ id: Emote; icon: IconName; name: string; key: string; pad: 'up' | 'left' | 'right' }> = [
  { id: 'waggle', icon: 'plane', name: 'Waggle', key: 'Z', pad: 'up' },
  { id: 'confetti', icon: 'level', name: 'Confetti', key: 'C', pad: 'left' },
  { id: 'heart', icon: 'health', name: 'Heart', key: 'V', pad: 'right' },
];
const EMOTE_ICON: Record<Emote, IconName> = { waggle: 'plane', confetti: 'level', heart: 'health' };
const FEED_LINES = 5;
const FEED_SECONDS = 6;

/** A player in their tape colour: a swatch shape (a plane for a pilot, a crumple for one shot down) and the name. */
function who(name: string, colour: number | null, shape: IconName, rank?: InsigniaView | null): string {
  const style = colour !== null ? ` style="--owner:${colourCss(colour)}"` : '';
  return `<span class="mp-who"${style}${colour === null ? ' data-ai' : ''}>${icon(shape, 'icon mp-swatch')}${insigniaSlot(rank)}<b>${esc(name)}</b></span>`;
}

/** One kill-feed line: killer (plane) + assists, the weapon, the victim (crumpled). Icon-led, short. */
export function killLine(
  killer: string | null, killerColour: number | null, victim: string, victimColour: number | null, weapon: Weapon, assists: readonly string[],
  ranks: { killer?: InsigniaView | null; victim?: InsigniaView | null } = {},
): string {
  const weaponIcon = icon(WEAPON_ICONS[weapon], 'icon mp-weapon', WEAPON_NAMES[weapon]);
  const helpers = assists.length ? `<small class="mp-assist">+${assists.map(esc).join(', ')}</small>` : '';
  const lost = who(victim, victimColour, 'crumple', ranks.victim);
  return killer ? `${who(killer, killerColour, 'fighter', ranks.killer)}${helpers}${weaponIcon}${lost}` : `${weaponIcon}${lost}`;
}

/** A presence as a chip: icon, word and tone (never colour alone). */
export function presenceChip(p: Presence, value?: string): string {
  return chip({ label: PRESENCE_LABELS[p], icon: PRESENCE_ICONS[p], tone: PRESENCE_TONES[p], tip: PRESENCE_TIPS[p], value, attrs: { 'data-presence': p } });
}

/** The scoreboard table (held Tab / View): every player, their desk, score, combat, state and ping. */
export function scoreboardHtml(rows: readonly ScoreRow[]): string {
  const head = (iconName: IconName | null, label: string, text = ''): string =>
    `<th scope="col" data-tip="${esc(label)}" aria-label="${esc(label)}">${iconName ? icon(iconName) : ''}${esc(text)}</th>`;
  const body = rows
    .map((r) => {
      const left = r.protect > 0 ? r.protect : r.shield;
      return `<tr data-id="${esc(r.id)}" data-presence="${r.presence}"${r.me ? ' data-me' : ''}>
        <th scope="row" class="mp-pilot" style="--owner:${colourCss(r.colour)}">${icon('fighter', 'icon mp-swatch')}${insigniaSlot(r.rank)}<b>${esc(r.name)}</b>${r.me ? chip({ label: 'You', tone: 'friend' }) : ''}</th>
        <td>${esc(r.territory || '—')}</td><td class="num mp-score">${r.score}</td><td class="num">${r.kills}</td><td class="num">${r.assists}</td><td class="num">${r.deaths}</td>
        <td class="num">${r.raids}</td><td class="num">${r.defends}</td><td class="num">${r.missions}</td>
        <td class="mp-phase">${esc(r.status)}</td>
        <td>${presenceChip(r.presence, r.presence === 'protected' && left > 0 ? fmtTime(left) : undefined)}</td>
        <td class="num mp-ping" data-level="${pingLevel(r)}">${r.connected ? `${r.ping}` : '—'}</td></tr>`;
    })
    .join('');
  return `<table class="mp-table"><thead><tr>${head(null, 'Pilot', 'Pilot')}${head('home', 'Desk')}${head('medal', 'Score')}${head('kills', 'Shot down')}${head(null, 'Assists', '+')}${head('crumple', 'Times shot down')}${head('bomb', 'Raids that got through')}${head('shield', 'Raiders stopped')}${head('ok', 'Missions done')}${head('plane', 'Doing now')}${head('info', 'Presence')}${head('radar', 'Ping (ms)')}</tr></thead><tbody>${body}</tbody></table>`;
}

function pingLevel(r: Pick<ScoreRow, 'connected' | 'ping'>): 'ok' | 'worn' | 'critical' {
  if (!r.connected) return 'critical';
  return r.ping > 250 ? 'critical' : r.ping > 120 ? 'worn' : 'ok';
}

/** The connection line's state: a word, an icon and a tone. */
export function connectionState(status: ConnectionStatus, ping: number): { label: string; icon: IconName; tone: Tone } {
  switch (status) {
    case 'connected':
      return ping > 200 ? { label: 'Slow', icon: 'warn', tone: 'warn' } : { label: 'Online', icon: 'ok', tone: 'good' };
    case 'connecting':
      return { label: 'Connecting', icon: 'clock', tone: 'warn' };
    case 'reconnecting':
      return { label: 'Reconnecting', icon: 'offline', tone: 'warn' };
    default:
      return { label: 'Offline', icon: 'offline', tone: 'hostile' };
  }
}

/**
 * What multiplayer adds to the HUD, on the shared components and tokens, in the HUD's zones:
 *   top left      the connection line (state, ping, players, session clock, protection, room)
 *                 and the kill feed / session news under it
 *   top centre    reconnecting, the raid card (incoming, with the one-press interception), the
 *                 outgoing raid and "You landed on…"
 *   top right     the emote bar under the mini-map (in flight)
 *   centre        the scoreboard (held Tab / View)
 * plus name tags over other players' planes and "{username}'s desk" tags on their desks, which
 * follow the 3D world.
 */
export class MpHud {
  private readonly net: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly board: HTMLElement;
  private readonly raid: HTMLElement;
  private readonly connection: HTMLElement;
  private readonly emotes: HTMLElement;
  private readonly tagLayer: HTMLElement;
  private readonly tags = new Map<string, HTMLElement>();
  private readonly terr = new Map<string, HTMLElement>();
  private readonly landing: HTMLElement;
  private landingTimer: ReturnType<typeof setTimeout> | undefined;
  private lastBoard = '';
  private lastRaid = '';
  private lastNet = '';
  private lastConnection = '';

  constructor(root: HTMLElement, zones: MpHudZones, actions: MpHudActions) {
    // Under the zones, like the HUD's world layer: tags follow the 3D world, panels sit on top.
    const layer = div(root, 'mp-layer');
    root.prepend(layer);
    this.tagLayer = div(layer, 'mp-tags');
    this.net = div(zones.tl, 'mp-net');
    this.feed = div(zones.tl, 'mp-feed');
    this.feed.setAttribute('role', 'log');
    this.feed.setAttribute('aria-label', 'Kill feed');
    this.connection = div(zones.tc, 'mp-connection');
    this.connection.hidden = true;
    this.raid = div(zones.tc, 'mp-raid');
    this.raid.hidden = true;
    this.landing = div(zones.tc, 'mp-landed');
    this.landing.hidden = true;
    this.emotes = div(zones.tr, 'mp-emotes');
    this.emotes.setAttribute('role', 'group');
    this.emotes.setAttribute('aria-label', 'Emotes');
    this.emotes.hidden = true;
    this.emotes.innerHTML =
      EMOTES.map((e) => iconButton({ icon: e.icon, name: e.name, key: { key: e.key, pad: e.pad }, attrs: { 'data-act': `emote-${e.id}` } })).join('') +
      `<span class="mp-board-key" data-tip="Scoreboard (hold)">${glyph({ key: 'Tab', pad: 'view' })}${icon('kills', 'icon', 'Scoreboard')}</span>`;
    for (const e of EMOTES) bindButton(this.emotes.querySelector<HTMLElement>(`[data-act="emote-${e.id}"]`)!, () => actions.emote(e.id));
    this.board = div(zones.centre, 'mp-board');
    this.board.hidden = true;
    this.raid.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-act="intercept"]')) actions.intercept();
    });
    this.raid.addEventListener('mousedown', (e) => e.preventDefault());
  }

  render(v: MpHudView): void {
    this.renderNet(v);
    this.renderConnection(v.status);
    this.renderTags(v.tags);
    this.renderTerritories(v.territories);
    this.renderBoard(v.scoreboard);
    this.renderRaid(v);
    if (this.emotes.hidden === v.emoteKeys) this.emotes.hidden = !v.emoteKeys;
  }

  /** A line in the kill feed. `self`: whether we are the killer or the victim (the line stands out). */
  kill(killer: string | null, killerColour: number | null, victim: string, victimColour: number | null, weapon: Weapon, assists: string[], self: FeedSelf): void {
    this.push(killLine(killer, killerColour, victim, victimColour, weapon, assists), 'kill', self);
  }

  /** Session news (a raid got through, someone joined): an icon for its tone, then the words. */
  news(text: string, tone: 'good' | 'bad' | 'info'): void {
    const iconName: IconName = tone === 'good' ? 'ok' : tone === 'bad' ? 'warn' : 'info';
    this.push(`${icon(iconName, 'icon mp-news-icon')}<span>${esc(text)}</span>`, 'news', null, tone);
  }

  /** "You landed on…" (v0.0.13): where the server placed our base, on a little map of the classroom. */
  landed(v: { label: string; id: string; cells: Array<{ id: string; x: number; z: number; mine: boolean; taken: boolean; state?: DeskState }> }): void {
    const xs = [...new Set(v.cells.map((c) => Math.round(c.x)))].sort((a, b) => a - b);
    const zs = [...new Set(v.cells.map((c) => Math.round(c.z)))].sort((a, b) => a - b);
    const grid = v.cells
      .map((c) => `<i data-desk="${c.mine ? 'mine' : c.taken ? 'taken' : (c.state ?? 'ai')}" style="grid-column:${xs.indexOf(Math.round(c.x)) + 1};grid-row:${zs.indexOf(Math.round(c.z)) + 1}"></i>`)
      .join('');
    const map = `<div class="mp-landed-map" role="img" aria-label="Classroom map" style="grid-template-columns:repeat(${xs.length},1fr)">${grid}</div>`;
    const text = `<div class="mp-landed-text"><small>You landed on</small><b>${esc(v.label)}</b>${chip({ label: v.id, icon: 'home', tone: 'friend' })}<span>Your base, as you left it</span></div>`;
    this.landing.innerHTML = card({ label: 'You landed on', bodyHtml: `<div class="mp-landed-body">${map}${text}</div>`, elevation: 'floating' });
    this.landing.hidden = false;
    this.landing.classList.remove('fade');
    clearTimeout(this.landingTimer);
    this.landingTimer = setTimeout(() => {
      this.landing.classList.add('fade');
      this.landingTimer = setTimeout(() => (this.landing.hidden = true), 600);
    }, 4500);
  }

  private push(html: string, kind: 'kill' | 'news', self: FeedSelf, tone?: string): void {
    const el = document.createElement('div');
    el.className = 'mp-line';
    el.dataset.kind = kind;
    if (self) el.dataset.self = self;
    if (tone) el.dataset.tone = tone;
    el.innerHTML = html;
    this.feed.appendChild(el);
    while (this.feed.children.length > FEED_LINES) this.feed.firstElementChild!.remove();
    setTimeout(() => el.classList.add('fade'), FEED_SECONDS * 1000);
    setTimeout(() => el.remove(), FEED_SECONDS * 1000 + 800);
  }

  private renderNet(v: MpHudView): void {
    const key = `${v.status}|${Math.round(v.ping / 5)}|${v.players}|${v.room}|${v.protection?.newPlayer ?? 0}|${v.protection?.shield ?? 0}|${v.sessionLeft}|${v.closing}`;
    if (key === this.lastNet) return;
    this.lastNet = key;
    const c = connectionState(v.status, v.ping);
    const protect = v.protection && (v.protection.newPlayer > 0 || v.protection.shield > 0)
      ? chip({
          label: 'Safe', icon: 'shield', tone: 'friend', value: fmtTime(Math.max(v.protection.newPlayer, v.protection.shield)),
          tip: v.protection.newPlayer > 0 ? 'New-player protection: nobody can raid your base yet' : 'Raid shield: your base was just raided, nobody can raid it again yet',
        })
      : '';
    const left = v.sessionLeft;
    const session = left !== null
      ? stat({
          icon: 'clock', value: fmtTime(left), label: v.closing ? 'The session ends soon (nobody new can join)' : 'Time left in this session',
          state: left <= 60 ? 'critical' : v.closing ? 'warning' : undefined, className: 'mp-session',
        })
      : '';
    const body = `<div class="mp-net-row">${chip({ label: c.label, icon: c.icon, tone: c.tone, tip: 'Connection', attrs: { 'data-status': v.status } })}
      ${stat({ icon: 'radar', value: v.status === 'connected' ? String(Math.round(v.ping)) : '—', suffix: 'ms', label: 'Round trip to the server' })}
      ${stat({ icon: 'fighter', value: `${v.players}/${v.maxPlayers}`, label: 'Players in this session' })}
      ${session}${protect}<span class="mp-room-name" data-tip="Classroom">${esc(v.room)}</span></div>`;
    this.net.innerHTML = card({ label: 'Connection', bodyHtml: body, fold: false, className: 'mp-net-card' });
  }

  private renderConnection(status: ConnectionStatus): void {
    const show = status === 'reconnecting';
    if (this.connection.hidden === show) this.connection.hidden = !show;
    if (!show || this.lastConnection === status) return;
    this.lastConnection = status;
    this.connection.innerHTML = `${alert({ title: 'Connection lost', value: 'reconnecting…', icon: 'offline', severity: 'critical' })}<small class="mp-connection-note">Your plane and desk are kept for a minute</small>`;
  }

  private renderTags(tags: NameTagView[]): void {
    const seen = new Set<string>();
    for (const t of tags) {
      seen.add(t.id);
      let el = this.tags.get(t.id);
      if (!el) {
        el = div(this.tagLayer, 'mp-tag');
        el.innerHTML = `<span class="mp-tag-name">${icon('fighter', 'icon mp-swatch')}<span class="mp-insignia-slot"></span><b></b></span><span class="mp-tag-bar"></span><span class="mp-tag-emote"></span>`;
        this.tags.set(t.id, el);
      }
      el.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -100%) scale(${1 - t.far * 0.35})`;
      el.style.opacity = String(1 - t.far * 0.5);
      el.style.setProperty('--owner', colourCss(t.colour));
      el.dataset.side = t.hostile ? 'hostile' : 'friend';
      const slot = el.querySelector<HTMLElement>('.mp-insignia-slot')!;
      const rankHtml = insigniaSlot(t.rank);
      if (slot.innerHTML !== rankHtml) slot.innerHTML = rankHtml;
      const name = el.querySelector('b')!;
      const label = `${t.name} · ${t.plane}`;
      if (name.textContent !== label) name.textContent = label;
      const hp = Math.round(t.health * 20);
      const barEl = el.children[1] as HTMLElement;
      if (barEl.dataset.hp !== String(hp)) {
        barEl.dataset.hp = String(hp);
        barEl.innerHTML = bar({ value: t.health, label: 'Health', size: 'mini' });
      }
      const emote = el.children[2] as HTMLElement;
      const id = t.emote ?? '';
      if (emote.dataset.emote !== id) {
        emote.dataset.emote = id;
        emote.innerHTML = t.emote ? icon(EMOTE_ICON[t.emote], 'icon', EMOTES.find((e) => e.id === t.emote)?.name) : '';
        emote.classList.remove('pop');
        void emote.offsetWidth;
        if (id) emote.classList.add('pop');
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
      const html = territoryTagHtml(t);
      if (el.dataset.html !== html) {
        el.dataset.html = html;
        el.innerHTML = html;
      }
      el.dataset.presence = t.presence;
      if (t.alert) el.dataset.alert = '';
      else delete el.dataset.alert;
    }
    for (const [id, el] of this.terr) {
      if (seen.has(id)) continue;
      el.remove();
      this.terr.delete(id);
    }
  }

  private renderBoard(rows: ScoreRow[] | null): void {
    if (this.board.hidden === !!rows) this.board.hidden = !rows;
    if (!rows) return;
    const key = JSON.stringify(rows);
    if (key === this.lastBoard) return;
    this.lastBoard = key;
    this.board.innerHTML = card({ title: 'Scoreboard', icon: 'kills', bodyHtml: scoreboardHtml(rows), elevation: 'floating', className: 'mp-board-card' });
  }

  private renderRaid(v: MpHudView): void {
    const html = v.incoming ? incomingHtml(v.incoming) : v.outgoing ? outgoingHtml(v.outgoing) : '';
    if (html === this.lastRaid) return;
    this.lastRaid = html;
    this.raid.hidden = !html;
    this.raid.innerHTML = html;
  }
}

/** The tag on another player's desk: "{username}'s desk" with their colour, presence and alerts. */
export function territoryTagHtml(t: TerritoryTagView): string {
  const p = t.presence;
  const presence = p === 'online' ? '' : `<span class="mp-terr-presence" data-presence="${p}" data-tip="${esc(PRESENCE_TIPS[p])}">${icon(PRESENCE_ICONS[p])}<small>${esc(PRESENCE_LABELS[p])}</small></span>`;
  const safe = t.safe && p === 'online' ? `<span data-tip="Can't be raided now">${icon('shield', 'icon', 'Protected')}</span>` : '';
  const raid = t.alert ? `<span class="mp-terr-raid" data-tip="Under attack">${icon('raid', 'icon', 'Raid')}</span>` : '';
  return `${icon('home', 'icon mp-swatch')}<b>${esc(t.label)}</b>${presence}${safe}${raid}`;
}

/** The raid card: the attacker, ETA, direction, distance, our guns, the reward, and the one-press interception. */
export function incomingHtml(r: IncomingView): string {
  const facts = [
    r.eta !== null && r.detected ? stat({ icon: 'clock', value: `${Math.max(0, Math.ceil(r.eta))}s`, label: 'Time to your desk' }) : '',
    r.direction && r.detected ? stat({ icon: 'heading', value: r.direction, label: 'Coming from' }) : '',
    r.distance !== null && r.detected ? stat({ icon: 'distance', value: metres(r.distance), label: 'Distance from your desk' }) : '',
    r.total > 0 ? stat({ icon: 'shield', value: `${r.ready}/${r.total}`, label: 'Weapons ready', tone: r.ready < r.total ? 'hostile' : 'good' }) : chip({ label: 'No guns', icon: 'warn', tone: 'warn' }),
    stat({ icon: 'paper', value: `+${r.reward}`, label: 'Defense reward' }),
  ].join('');
  const radar = r.detected ? '' : chip({ label: 'Not on radar yet', icon: 'radar', tone: 'warn' });
  const action = r.response
    ? button({ label: r.response.label, icon: 'fighter', variant: 'primary', key: { key: r.response.key }, attrs: { 'data-act': 'intercept' }, tip: 'Go and shoot them down' })
    : '';
  const body = `<div class="mp-raid-who">${who(r.attacker, r.colour, 'bomber')}<span>is raiding your desk</span>${radar}</div><div class="mp-raid-facts">${facts}</div>${action ? `<div class="mp-raid-act">${action}</div>` : ''}`;
  return card({ title: 'Raid incoming', icon: 'raid', tone: 'hostile', state: 'critical', bodyHtml: body, elevation: 'floating', className: 'mp-raid-card', attrs: { 'data-raid': 'incoming' } });
}

export function outgoingHtml(o: { victim: string; colour: number }): string {
  return card({ label: 'Your raid', bodyHtml: `<div class="mp-raid-who">${icon('bomb')}<span>Raid on</span>${who(o.victim, o.colour, 'home')}</div>`, tone: 'warn', fold: false, className: 'mp-raid-card', attrs: { 'data-raid': 'outgoing' } });
}

function div(parent: HTMLElement, className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  parent.appendChild(el);
  return el;
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${Math.ceil(s)}s`;
}
