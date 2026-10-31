/** Where something is and how it is turned. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

interface Sample extends Pose {
  time: number;
}

/** How far past the newest known state a pose may be extrapolated (seconds). */
const MAX_EXTRAPOLATION = 0.25;

/**
 * Snapshot interpolation for something another computer flies: the states the server sent, by
 * server time, and the pose at any moment between them. Remote aircraft are drawn a little in the
 * past (NET.interpolationDelay), so there are almost always two known states around the moment
 * drawn and the plane moves smoothly however unevenly the packets arrive. If the next state is
 * late, the pose is carried on along the last known velocity for a moment, then held.
 */
export class PoseBuffer {
  private readonly samples: Sample[] = [];

  constructor(private readonly capacity = 32) {}

  get size(): number {
    return this.samples.length;
  }

  get newest(): number {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1].time : -Infinity;
  }

  /** Adds the state at server time `time` (older or repeated times are ignored). */
  push(time: number, pose: Pose): void {
    if (time <= this.newest) return;
    this.samples.push({ time, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** The pose at server time `time`, written into `out`. False if nothing is known yet. */
  sample(time: number, out: Pose): boolean {
    const s = this.samples;
    if (s.length === 0) return false;
    if (s.length === 1 || time <= s[0].time) {
      copy(time <= s[0].time ? s[0] : s[s.length - 1], out);
      return true;
    }
    const last = s[s.length - 1];
    if (time >= last.time) {
      // Late: carry on along the last step's velocity for a moment, then hold.
      const prev = s[s.length - 2];
      const span = last.time - prev.time || 1e-3;
      const ahead = Math.min(time - last.time, MAX_EXTRAPOLATION) / span;
      out.x = last.x + (last.x - prev.x) * ahead;
      out.y = last.y + (last.y - prev.y) * ahead;
      out.z = last.z + (last.z - prev.z) * ahead;
      out.yaw = last.yaw + angleDiff(prev.yaw, last.yaw) * ahead;
      out.pitch = last.pitch;
      out.roll = last.roll;
      return true;
    }
    // Find the pair around `time` (searching from the newest end: the moment drawn is near it).
    let i = s.length - 1;
    while (i > 0 && s[i - 1].time > time) i--;
    const a = s[i - 1];
    const b = s[i];
    const k = (time - a.time) / (b.time - a.time || 1e-3);
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.yaw = a.yaw + angleDiff(a.yaw, b.yaw) * k;
    out.pitch = a.pitch + angleDiff(a.pitch, b.pitch) * k;
    out.roll = a.roll + angleDiff(a.roll, b.roll) * k;
    return true;
  }
}

/**
 * The server's clock as this computer estimates it: each patch says what time it was on the
 * server when it was sent. Packets that arrive late would drag the estimate back, so it follows
 * the earliest-arriving ones (the ones least delayed) and only drifts back slowly otherwise.
 */
export class ServerClock {
  private offset: number | null = null;
  /** How much the arrival times jitter, smoothed (seconds). */
  jitter = 0;

  /** A patch stamped `serverTime` arrived at local time `localTime` (both seconds). */
  observe(serverTime: number, localTime: number): void {
    const sample = serverTime - localTime;
    if (this.offset === null) {
      this.offset = sample;
      return;
    }
    const diff = sample - this.offset;
    this.jitter += (Math.abs(diff) - this.jitter) * 0.1;
    // A packet that came through faster than any before moves the estimate at once; slower ones
    // only pull it back gently (the network got slower, or this one was delayed).
    if (diff > 0) this.offset += diff * 0.5;
    else this.offset += diff * 0.02;
    // Way off (the tab slept, the server restarted): start again.
    if (Math.abs(diff) > 1) this.offset = sample;
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  /** The server's time now, as best known. */
  now(localTime: number): number {
    return localTime + (this.offset ?? 0);
  }
}

/** b − a, the short way round. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function copy(s: Pose, out: Pose): void {
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.yaw = s.yaw;
  out.pitch = s.pitch;
  out.roll = s.roll;
}
