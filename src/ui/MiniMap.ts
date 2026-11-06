import type { AiRole, Side, ThreatLevel } from '../config';
import type { InstallationKind } from '../defenses/Layout';
import { colour, FACES, onTokensChange, tokenOptions, withAlpha, type ColourName } from './tokens';

/**
 * A desk's place in the multiplayer lifecycle (v0.0.13, protocol DESK_STATES): the AI's, a
 * player's, draining (its player left; the base stays until a raid on it is settled), empty (bare,
 * closed for a while) or open (bare, a joining player may land here).
 */
export type MapDeskState = 'ai' | 'player' | 'draining' | 'empty' | 'open';
/** Where a desk's player is (src/mp/presence.ts). */
export type MapPresence = 'online' | 'away' | 'offline' | 'protected';

export interface MiniMapTerritory {
  id: string;
  x: number;
  z: number;
  half: number;
  role: 'home' | 'objective' | 'done' | 'neutral';
  threat: ThreatLevel;
  /** Multiplayer: the desk's lifecycle state (single-player leaves it out). */
  desk?: MapDeskState;
  /** Multiplayer: the player on it, in their tape colour (an identity colour, not a meaning). */
  owner?: { colour: string; presence: MapPresence } | null;
}

export interface MiniMapView {
  territories: MiniMapTerritory[];
  /** Every installation; weapons with `reach` set show how far (and which way) they can shoot. */
  defenses: Array<{
    x: number;
    z: number;
    kind: InstallationKind;
    alive: boolean;
    engaged: boolean;
    friendly: boolean;
    reach: { range: number; facing: number; arc: number | null } | null;
  }>;
  /** Precision spots and bullseyes still to hit. */
  zones: Array<{ x: number; z: number; precision: boolean }>;
  rings: Array<{ x: number; z: number; yaw: number; state: 'open' | 'waiting' }>;
  /** Practice planes the mission still wants shot down. */
  targets: Array<{ x: number; z: number }>;
  plane: { x: number; z: number; yaw: number; autopilot: boolean } | null;
  /** AI aircraft: enemies red, friends blue. Raiders pulse, with a line to what they are bombing. */
  aircraft: Array<{ x: number; z: number; yaw: number; side: Side; role: AiRole; raid: { x: number; z: number } | null; mission: boolean }>;
  /** The point the target marker is showing, for a guide line from the plane. */
  objective: { x: number; z: number } | null;
  /**
   * T1's early warning: how far out raiders are noticed (its radar's range, or close in without
   * one), and whether the radar is standing (a sweep turns) or wrecked.
   */
  radar: { x: number; z: number; range: number; state: 'none' | 'on' | 'off' } | null;
  boundaryRadius: number;
  /** Past the boundary: the edge flashes. */
  warning: boolean;
}

/**
 * How a desk is drawn: fill, pattern, edge and a mark, so every state differs in shape as well as
 * colour (plan v0.0.15 §8A). Meaning colours are tokens; a player's desk is filled with their tape
 * colour ('owner'), their identity.
 *
 *   home            friend blue, solid, a house in the corner
 *   player-held     owner colour, solid; presence adds: away a dashed ink edge, protected an inner
 *                   ring, offline a slash
 *   draining        owner colour with paper hatching (and the presence marks)
 *   empty           no fill, a dashed grey edge
 *   open            recessed paper with a dashed green edge and a plus
 *   AI-held         neutral grey, solid (with its threat edge)
 *   objective       objective orange (a mission's target; also a pulsing outline)
 *   done            good green with a tick
 */
export interface DeskStyle {
  fill: ColourName | 'owner' | null;
  pattern: 'solid' | 'hatch';
  edge: { colour: ColourName; dash: boolean } | null;
  /** An inner ring (protected). */
  ring: boolean;
  mark: 'none' | 'home' | 'tick' | 'plus' | 'slash';
  /** The desk id's colour. */
  label: ColourName;
}

export function deskStyle(t: Pick<MiniMapTerritory, 'role' | 'desk' | 'owner'>): DeskStyle {
  const base: DeskStyle = { fill: 'neutral', pattern: 'solid', edge: null, ring: false, mark: 'none', label: 'on-colour' };
  if (t.role === 'home') return { ...base, fill: 'friend', mark: 'home', ring: t.owner?.presence === 'protected' };
  if (t.role === 'done') return { ...base, fill: 'good', mark: 'tick' };
  const presence = t.owner?.presence;
  const marks = (): Partial<DeskStyle> => ({
    edge: presence === 'away' ? { colour: 'ink', dash: true } : null,
    ring: presence === 'protected',
    mark: presence === 'offline' ? 'slash' : 'none',
  });
  switch (t.desk) {
    case 'player':
      if (t.owner) return { ...base, fill: 'owner', ...marks() };
      break;
    case 'draining':
      return { ...base, fill: t.owner ? 'owner' : 'neutral', pattern: 'hatch', ...marks(), mark: 'slash' };
    case 'empty':
      return { ...base, fill: null, edge: { colour: 'ink-3', dash: true }, label: 'ink-3' };
    case 'open':
      return { ...base, fill: 'paper-2', edge: { colour: 'good', dash: true }, mark: 'plus', label: 'ink-2' };
    case 'ai':
    case undefined:
      break;
  }
  if (t.role === 'objective') return { ...base, fill: 'objective' };
  return base;
}

/** The canvas colours, read from the tokens (and again whenever the tokens change). */
function readColours() {
  return {
    bg: colour('paper'),
    boundary: withAlpha('ink', 0.35),
    warning: colour('hostile'),
    home: colour('friend'),
    objective: colour('objective'),
    objectivePulse: (a: number) => withAlpha('objective', a),
    label: colour('on-colour'),
    ring: colour('objective'),
    ringWaiting: colour('neutral'),
    zone: colour('hostile'),
    precision: colour('ink-2'),
    plane: colour('ink'),
    outline: colour('paper-solid'),
    guide: withAlpha('hostile', 0.6),
    threat: ['', colour('threat-1'), colour('threat-2'), colour('threat-3')],
    defense: colour('ink-2'),
    engaged: colour('hostile'),
    wreck: colour('off'),
    reachTurret: withAlpha('hostile', 0.5),
    reachLauncher: withAlpha('locking', 0.5),
    enemy: colour('hostile'),
    friend: colour('friend'),
    raidLine: withAlpha('hostile', 0.55),
    radar: withAlpha('friend', 0.5),
    radarFill: withAlpha('friend', 0.07),
    radarOff: withAlpha('hostile', 0.45),
    sweep: withAlpha('friend', 0.35),
    friendlyDefense: colour('friend'),
    hatch: withAlpha('paper-solid', 0.75),
    rim: withAlpha('ink', 0.18),
    named: (name: ColourName) => colour(name),
  };
}


/**
 * Compact top-down diagram for navigation. It is a fixed diagram, not a camera: home sits bottom
 * left and the runway points up and to the right, and it is a rotation (not a mirror) of the world,
 * so left and right on the map match left and right in the 3D view.
 */
export class MiniMap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private time = 0;
  private c = readColours();
  private last: MiniMapView | null = null;

  constructor(canvas: HTMLCanvasElement, size = 176) {
    this.size = size;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(ratio, ratio);
    // A palette swap (colour-blind, high contrast) redraws at once in the new colours.
    onTokensChange(() => {
      this.c = readColours();
      if (this.last) this.render(this.last, 0);
    });
  }

  render(v: MiniMapView, dt: number): void {
    this.last = v;
    this.time += dt;
    const { ctx, size } = this;
    const c = size / 2;
    const scale = (c - 8) / (v.boundaryRadius * 1.12);
    // World (x, z) → map: x' = z, y' = -x. Home (−x, −z) lands bottom left.
    const sx = (_x: number, z: number) => c + z * scale;
    const sy = (x: number, _z: number) => c - x * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.fillStyle = this.c.bg;
    ctx.fill();
    ctx.clip();

    // Reduced motion: nothing blinks or pulses; the states keep their shapes.
    const still = tokenOptions().reducedMotion;
    // The edge of the airspace.
    const flash = v.warning && (still || Math.sin(this.time * 10) > 0);
    ctx.beginPath();
    const edge = v.boundaryRadius * scale;
    ctx.rect(c - edge, c - edge, edge * 2, edge * 2);
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = flash ? 3 : 1.5;
    ctx.strokeStyle = v.warning ? this.c.warning : this.c.boundary;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = `700 9px ${FACES.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of v.territories) this.drawDesk(t, sx(t.x, t.z), sy(t.x, t.z), t.half * scale);

    // T1's early-warning radius, with a turning sweep while the radar stands.
    if (v.radar) {
      const x = sx(v.radar.x, v.radar.z);
      const y = sy(v.radar.x, v.radar.z);
      const r = v.radar.range * scale;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.c.radarFill;
      ctx.fill();
      ctx.setLineDash(v.radar.state === 'on' ? [] : [3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = v.radar.state === 'off' ? this.c.radarOff : this.c.radar;
      ctx.stroke();
      ctx.setLineDash([]);
      if (v.radar.state === 'on') {
        const a = this.time * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, a - 0.5, a);
        ctx.closePath();
        ctx.fillStyle = this.c.sweep;
        ctx.fill();
      }
    }

    // How far each nearby weapon reaches, with the blind spot behind a turret left open.
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    for (const d of v.defenses) {
      if (!d.reach || !d.alive) continue;
      const x = sx(d.x, d.z);
      const y = sy(d.x, d.z);
      const facing = Math.atan2(Math.sin(d.reach.facing), -Math.cos(d.reach.facing));
      const arc = d.reach.arc ?? Math.PI;
      ctx.beginPath();
      if (d.reach.arc !== null) ctx.moveTo(x, y);
      ctx.arc(x, y, d.reach.range * scale, facing - arc, facing + arc);
      if (d.reach.arc !== null) ctx.closePath();
      ctx.strokeStyle = d.kind === 'launcher' ? this.c.reachLauncher : this.c.reachTurret;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const d of v.defenses) {
      const x = sx(d.x, d.z);
      const y = sy(d.x, d.z);
      ctx.fillStyle = !d.alive ? this.c.wreck : d.engaged && (still || Math.sin(this.time * 12) > -0.3) ? this.c.engaged : d.friendly ? this.c.friendlyDefense : this.c.defense;
      ctx.beginPath();
      switch (d.kind) {
        case 'turret':
          ctx.rect(x - 1.8, y - 1.8, 3.6, 3.6);
          break;
        case 'launcher':
          ctx.moveTo(x, y - 2.6);
          ctx.lineTo(x + 2.4, y + 2);
          ctx.lineTo(x - 2.4, y + 2);
          ctx.closePath();
          break;
        case 'radar':
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          break;
        case 'supply':
        case 'storage':
          ctx.rect(x - 1.4, y - 1.4, 2.8, 2.8);
          break;
        case 'workshop':
          ctx.moveTo(x - 2, y + 1.6);
          ctx.lineTo(x - 2, y - 1);
          ctx.lineTo(x, y - 2.2);
          ctx.lineTo(x + 2, y - 1);
          ctx.lineTo(x + 2, y + 1.6);
          ctx.closePath();
          break;
      }
      ctx.fill();
      // Never colour alone: a wreck is crossed out, an engaged weapon ringed, ours underlined.
      if (!d.alive) {
        ctx.beginPath();
        ctx.moveTo(x - 2.6, y - 2.6);
        ctx.lineTo(x + 2.6, y + 2.6);
        ctx.moveTo(x + 2.6, y - 2.6);
        ctx.lineTo(x - 2.6, y + 2.6);
        ctx.lineWidth = 1;
        ctx.strokeStyle = this.c.defense;
        ctx.stroke();
      } else if (d.engaged) {
        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = this.c.engaged;
        ctx.stroke();
      } else if (d.friendly) {
        ctx.fillRect(x - 2.4, y + 3, 4.8, 1);
      }
    }

    for (const z of v.zones) {
      ctx.beginPath();
      ctx.arc(sx(z.x, z.z), sy(z.x, z.z), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = z.precision ? this.c.precision : this.c.zone;
      ctx.fill();
    }

    for (const t of v.targets) {
      const x = sx(t.x, t.z);
      const y = sy(t.x, t.z);
      ctx.beginPath();
      ctx.moveTo(x, y - 3.5);
      ctx.lineTo(x + 3.5, y);
      ctx.lineTo(x, y + 3.5);
      ctx.lineTo(x - 3.5, y);
      ctx.closePath();
      ctx.fillStyle = this.c.zone;
      ctx.fill();
    }

    for (const r of v.rings) {
      const x = sx(r.x, r.z);
      const y = sy(r.x, r.z);
      // Draw the hoop edge-on, as a short bar across the flight path.
      const a = Math.atan2(Math.sin(r.yaw), -Math.cos(r.yaw)); // heading on the map
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = r.state === 'open' ? this.c.ring : this.c.ringWaiting;
      ctx.fillRect(-4, -1.5, 8, 3);
      ctx.restore();
    }

    for (const a of v.aircraft) {
      const x = sx(a.x, a.z);
      const y = sy(a.x, a.z);
      if (a.raid) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(sx(a.raid.x, a.raid.z), sy(a.raid.x, a.raid.z));
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = this.c.raidLine;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, y, 6 + (still ? 1 : 2 * Math.sin(this.time * 6)), 0, Math.PI * 2);
        ctx.strokeStyle = this.c.enemy;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const size = a.role === 'bomber' ? 1.3 : a.role === 'scout' ? 0.85 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(Math.sin(a.yaw), -Math.cos(a.yaw)));
      ctx.scale(size, size);
      ctx.beginPath();
      if (a.side === 'enemy') {
        // Hostile: a sharp dart.
        ctx.moveTo(5, 0);
        ctx.lineTo(-3.5, -3.5);
        ctx.lineTo(-1.5, 0);
        ctx.lineTo(-3.5, 3.5);
        ctx.closePath();
      } else {
        // Friendly: a round body with a nose, so side never depends on colour alone.
        ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
        ctx.moveTo(1.5, -1.2);
        ctx.lineTo(5, 0);
        ctx.lineTo(1.5, 1.2);
        ctx.closePath();
      }
      ctx.fillStyle = a.side === 'enemy' ? this.c.enemy : this.c.friend;
      ctx.fill();
      if (a.mission) {
        ctx.strokeStyle = this.c.outline;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    if (v.plane && v.objective) {
      ctx.beginPath();
      ctx.moveTo(sx(v.plane.x, v.plane.z), sy(v.plane.x, v.plane.z));
      ctx.lineTo(sx(v.objective.x, v.objective.z), sy(v.objective.x, v.objective.z));
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = this.c.guide;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (v.plane) {
      const p = v.plane;
      // Heading: forward is (−sin yaw, −cos yaw) in (x, z) → (−cos yaw, sin yaw) on the map.
      const angle = Math.atan2(Math.sin(p.yaw), -Math.cos(p.yaw));
      ctx.save();
      ctx.translate(sx(p.x, p.z), sy(p.x, p.z));
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-5, -4.5);
      ctx.lineTo(-2.5, 0);
      ctx.lineTo(-5, 4.5);
      ctx.closePath();
      ctx.fillStyle = p.autopilot ? this.c.warning : this.c.plane;
      ctx.strokeStyle = this.c.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.c.rim;
    ctx.stroke();
  }

  /** One desk: its fill, pattern, edge and mark (deskStyle), the threat edge, the objective pulse and its id. */
  private drawDesk(t: MiniMapTerritory, x: number, y: number, half: number): void {
    const { ctx } = this;
    const st = deskStyle(t);
    const fill = st.fill === 'owner' ? (t.owner?.colour ?? this.c.named('neutral')) : st.fill ? this.c.named(st.fill) : null;
    const l = x - half;
    const top = y - half;
    const w = half * 2;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(l, top, w, w);
    }
    if (st.pattern === 'hatch') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(l, top, w, w);
      ctx.clip();
      ctx.strokeStyle = this.c.hatch;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let d = -w; d < w; d += 3.5) {
        ctx.moveTo(l + d, top + w);
        ctx.lineTo(l + d + w, top);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (t.threat > 0 && !t.owner) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = this.c.threat[t.threat];
      ctx.strokeRect(l + 0.75, top + 0.75, w - 1.5, w - 1.5);
    }
    if (st.edge) {
      ctx.setLineDash(st.edge.dash ? [2, 2] : []);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = this.c.named(st.edge.colour);
      ctx.strokeRect(l + 0.6, top + 0.6, w - 1.2, w - 1.2);
      ctx.setLineDash([]);
    }
    if (st.ring) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = this.c.outline;
      ctx.strokeRect(l + 2, top + 2, w - 4, w - 4);
    }
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = st.label === 'on-colour' ? this.c.outline : this.c.named(st.label);
    switch (st.mark) {
      case 'slash':
        ctx.beginPath();
        ctx.moveTo(l + 1.5, top + w - 1.5);
        ctx.lineTo(l + w - 1.5, top + 1.5);
        ctx.stroke();
        break;
      case 'plus': {
        const r = Math.max(2, half * 0.35);
        ctx.beginPath();
        ctx.moveTo(l + w - r - 2, top + 2);
        ctx.lineTo(l + w - r - 2, top + 2 + r * 2);
        ctx.moveTo(l + w - 2 * r - 2, top + 2 + r);
        ctx.lineTo(l + w - 2, top + 2 + r);
        ctx.stroke();
        break;
      }
      case 'home': {
        // A roof over the corner: home reads as a shape too.
        ctx.beginPath();
        ctx.moveTo(l - 1, top + 2);
        ctx.lineTo(x, top - 3);
        ctx.lineTo(l + w + 1, top + 2);
        ctx.strokeStyle = this.c.home;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        break;
      }
      case 'tick':
        ctx.beginPath();
        ctx.moveTo(l + w - 7, top + 4);
        ctx.lineTo(l + w - 5, top + 6);
        ctx.lineTo(l + w - 2, top + 2);
        ctx.stroke();
        break;
      case 'none':
        break;
    }
    if (t.role === 'objective') {
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.c.objectivePulse(tokenOptions().reducedMotion ? 0.85 : 0.5 + 0.5 * Math.sin(this.time * 4));
      ctx.strokeRect(l - 2, top - 2, w + 4, w + 4);
    }
    ctx.fillStyle = this.c.named(st.label);
    ctx.fillText(t.id, x, y);
  }
}
