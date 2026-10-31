import type { AiRole, Side, ThreatLevel } from '../config';
import type { InstallationKind } from '../defenses/Layout';

export interface MiniMapView {
  territories: Array<{ id: string; x: number; z: number; half: number; role: 'home' | 'objective' | 'done' | 'neutral'; threat: ThreatLevel }>;
  /** Every installation; weapons with `reach` set show how far (and which way) they can shoot. */
  defenses: Array<{
    x: number;
    z: number;
    kind: InstallationKind;
    alive: boolean;
    engaged: boolean;
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
  boundaryRadius: number;
  /** Past the boundary: the edge flashes. */
  warning: boolean;
}

const COLORS = {
  bg: 'rgba(255, 255, 255, 0.86)',
  boundary: 'rgba(31, 41, 55, 0.35)',
  warning: '#dc2626',
  home: '#2563eb',
  objective: '#ea580c',
  done: '#4ade80',
  neutral: '#9ca3af',
  label: '#ffffff',
  ring: '#f97316',
  ringWaiting: '#9ca3af',
  zone: '#dc2626',
  precision: '#3730a3',
  plane: '#111827',
  guide: 'rgba(220, 38, 38, 0.6)',
  threat: ['', '#eab308', '#f97316', '#dc2626'],
  defense: '#4d5530',
  engaged: '#dc2626',
  wreck: '#9ca3af',
  reachTurret: 'rgba(220, 38, 38, 0.5)',
  reachLauncher: 'rgba(147, 51, 234, 0.5)',
  enemy: '#b91c1c',
  friend: '#2563eb',
  raidLine: 'rgba(185, 28, 28, 0.55)',
};

/**
 * Compact top-down diagram for navigation. It is a fixed diagram, not a camera: home sits bottom
 * left and the runway points up and to the right, and it is a rotation (not a mirror) of the world,
 * so left and right on the map match left and right in the 3D view.
 */
export class MiniMap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private time = 0;

  constructor(canvas: HTMLCanvasElement, size = 176) {
    this.size = size;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(ratio, ratio);
  }

  render(v: MiniMapView, dt: number): void {
    this.time += dt;
    const { ctx, size } = this;
    const c = size / 2;
    const scale = (c - 8) / v.boundaryRadius;
    // World (x, z) → map: x' = z, y' = -x. Home (−x, −z) lands bottom left.
    const sx = (_x: number, z: number) => c + z * scale;
    const sy = (x: number, _z: number) => c - x * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.bg;
    ctx.fill();
    ctx.clip();

    // The edge of the airspace.
    const flash = v.warning && Math.sin(this.time * 10) > 0;
    ctx.beginPath();
    ctx.arc(c, c, v.boundaryRadius * scale, 0, Math.PI * 2);
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = flash ? 3 : 1.5;
    ctx.strokeStyle = v.warning ? COLORS.warning : COLORS.boundary;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '700 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of v.territories) {
      const half = t.half * scale;
      const x = sx(t.x, t.z);
      const y = sy(t.x, t.z);
      ctx.fillStyle = COLORS[t.role];
      ctx.fillRect(x - half, y - half, half * 2, half * 2);
      if (t.threat > 0) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.threat[t.threat];
        ctx.strokeRect(x - half + 0.75, y - half + 0.75, half * 2 - 1.5, half * 2 - 1.5);
      }
      if (t.role === 'objective') {
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(234, 88, 12, ${0.5 + 0.5 * Math.sin(this.time * 4)})`;
        ctx.strokeRect(x - half - 2, y - half - 2, half * 2 + 4, half * 2 + 4);
      }
      ctx.fillStyle = COLORS.label;
      ctx.fillText(t.id, x, y);
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
      ctx.strokeStyle = d.kind === 'launcher' ? COLORS.reachLauncher : COLORS.reachTurret;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const d of v.defenses) {
      const x = sx(d.x, d.z);
      const y = sy(d.x, d.z);
      ctx.fillStyle = !d.alive ? COLORS.wreck : d.engaged && Math.sin(this.time * 12) > -0.3 ? COLORS.engaged : COLORS.defense;
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
          ctx.rect(x - 1.4, y - 1.4, 2.8, 2.8);
          break;
      }
      ctx.fill();
    }

    for (const z of v.zones) {
      ctx.beginPath();
      ctx.arc(sx(z.x, z.z), sy(z.x, z.z), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = z.precision ? COLORS.precision : COLORS.zone;
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
      ctx.fillStyle = COLORS.zone;
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
      ctx.fillStyle = r.state === 'open' ? COLORS.ring : COLORS.ringWaiting;
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
        ctx.strokeStyle = COLORS.raidLine;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, y, 6 + 2 * Math.sin(this.time * 6), 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.enemy;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const size = a.role === 'bomber' ? 1.3 : a.role === 'scout' ? 0.85 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(Math.sin(a.yaw), -Math.cos(a.yaw)));
      ctx.scale(size, size);
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-3.5, -3.5);
      ctx.lineTo(-1.5, 0);
      ctx.lineTo(-3.5, 3.5);
      ctx.closePath();
      ctx.fillStyle = a.side === 'enemy' ? COLORS.enemy : COLORS.friend;
      ctx.fill();
      if (a.mission) {
        ctx.strokeStyle = '#fff';
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
      ctx.strokeStyle = COLORS.guide;
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
      ctx.fillStyle = p.autopilot ? COLORS.warning : COLORS.plane;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(31, 41, 55, 0.18)';
    ctx.stroke();
  }
}
