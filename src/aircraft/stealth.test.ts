import { describe, expect, it } from 'vitest';
import { AIRCRAFT, DEFENSES, STEALTH } from '../config';
import { DefenseNetwork, type Target } from '../defenses/Installation';
import { layoutDefenses } from '../defenses/Layout';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { lockFactor, RadarSignature } from './Signature';

/** v0.0.18 §8: the radar signature and stealth system. */
describe('radar signature', () => {
  it('a stealth design is quieter while quiet; firing, bombing and boosting give it away, then fade', () => {
    const s = new RadarSignature();
    const lightning = AIRCRAFT.lightning;
    expect(lightning.traits?.stealth).toBe(true);
    expect(AIRCRAFT.falcon.traits?.stealth).toBe(true);
    const quiet = s.valueFor(lightning);
    expect(quiet).toBeCloseTo(lightning.signature * STEALTH.quiet);
    s.reveal('bomb');
    expect(s.valueFor(lightning)).toBeCloseTo(lightning.signature + STEALTH.reveal.bomb);
    s.update(STEALTH.revealTime / 2);
    expect(s.valueFor(lightning)).toBeLessThan(lightning.signature + STEALTH.reveal.bomb);
    s.update(STEALTH.revealTime);
    expect(s.valueFor(lightning)).toBeCloseTo(quiet);
    // An ordinary design has no quiet bonus.
    expect(s.valueFor(AIRCRAFT.swift)).toBe(AIRCRAFT.swift.signature);
  });

  it('rocket locks take longer on low signatures, but never more than the floor allows', () => {
    expect(lockFactor(1.2)).toBe(1);
    expect(lockFactor(0.8)).toBeCloseTo(1.25);
    expect(lockFactor(0.1)).toBe(STEALTH.maxLock);
  });
});

describe('defenses and stealth', () => {
  const territories = generateTerritories();
  const layout = layoutDefenses(territories, []);
  const radarTerritory = layout.installations.find((i) => i.kind === 'radar')!.territoryId;
  const specs = layout.installations.filter((i) => i.territoryId === radarTerritory);
  const t = territories.find((x) => x.id === radarTerritory)!;

  /** How close (m from the territory's centre) a plane flying straight in gets before anything notices it. */
  const noticedAt = (signature: number): number | null => {
    const net = new DefenseNetwork(specs, seededRng(1));
    for (let d = 260; d >= 0; d -= 2) {
      const target: Target = { id: 'p', side: 'player', x: t.x, y: 20, z: t.z - d, vx: 0, vy: 0, vz: 20, signature };
      const { events } = net.update(0.1, [target]);
      if (events.some((e) => e.type === 'spotted')) return d;
    }
    return null;
  };

  it('a Lightning is noticed later than a Swift on the same path, and still noticed', () => {
    const quietLightning = AIRCRAFT.lightning.signature * STEALTH.quiet;
    const swift = noticedAt(AIRCRAFT.swift.signature);
    const lightning = noticedAt(quietLightning);
    expect(swift).not.toBeNull();
    expect(lightning).not.toBeNull();
    expect(lightning!).toBeLessThan(swift!);
  });

  it('even a near-invisible signature is noticed within visual range', () => {
    const at = noticedAt(0.01);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThan(0);
  });

  it('a launcher takes longer to lock on to a stealthy plane, and still locks', () => {
    const launcherSpec = layout.installations.find((i) => i.kind === 'launcher')!;
    const lockTime = (signature: number) => {
      const net = new DefenseNetwork([launcherSpec], seededRng(1));
      const target: Target = { id: 'p', side: 'player', x: launcherSpec.x, y: 18, z: launcherSpec.z - 22, vx: 0, vy: 0, vz: 0, signature };
      for (let s = 0; s < 30; s += 0.05) if (net.update(0.05, [target]).orders.length > 0) return s;
      return null;
    };
    const normal = lockTime(1);
    const stealthy = lockTime(0.5);
    expect(normal).not.toBeNull();
    expect(stealthy).not.toBeNull();
    expect(stealthy!).toBeGreaterThan(normal! + DEFENSES.launcher.lockTime * 0.5);
  });

  it('the defenses tell a stealth pilot whether they are hidden, detected or locked', () => {
    const launcherSpec = layout.installations.find((i) => i.kind === 'launcher')!;
    const net = new DefenseNetwork([launcherSpec], seededRng(1));
    expect(net.detectionOf('p')).toBe('hidden');
    const target: Target = { id: 'p', side: 'player', x: launcherSpec.x, y: 25, z: launcherSpec.z - 30, vx: 0, vy: 0, vz: 0, signature: 1 };
    const seen: string[] = [];
    for (let s = 0; s < 6; s += 0.05) {
      net.update(0.05, [target]);
      seen.push(net.detectionOf('p'));
    }
    expect(seen).toContain('locked');
  });
});
