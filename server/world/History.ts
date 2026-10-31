import type { Point3 } from '../../src/missions/Mission';

interface Sample {
  time: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Where every aircraft has been over the last moments, for lag compensation: a player aims at
 * other aircraft as their screen shows them, a little in the past (their round trip plus the
 * interpolation delay), so their rounds are tested against the targets where they were then.
 */
export class History {
  private readonly tracks = new Map<string, Sample[]>();

  constructor(private readonly keep = 0.6) {}

  record(time: number, id: string, p: Point3): void {
    let track = this.tracks.get(id);
    if (!track) {
      track = [];
      this.tracks.set(id, track);
    }
    track.push({ time, x: p.x, y: p.y, z: p.z });
    while (track.length > 2 && track[0].time < time - this.keep) track.shift();
  }

  forget(id: string): void {
    this.tracks.delete(id);
  }

  /** Drops aircraft not in `alive`. */
  retain(alive: ReadonlySet<string>): void {
    for (const id of this.tracks.keys()) if (!alive.has(id)) this.tracks.delete(id);
  }

  /** Where `id` was at `time` (interpolated; clamped to what is remembered). False if unknown. */
  at(id: string, time: number, out: Point3): boolean {
    const track = this.tracks.get(id);
    if (!track || track.length === 0) return false;
    if (time <= track[0].time) return copy(track[0], out);
    const last = track[track.length - 1];
    if (time >= last.time) return copy(last, out);
    let i = track.length - 1;
    while (i > 0 && track[i - 1].time > time) i--;
    const a = track[i - 1];
    const b = track[i];
    const k = (time - a.time) / (b.time - a.time || 1e-6);
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    return true;
  }
}

function copy(s: Sample, out: Point3): true {
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  return true;
}
