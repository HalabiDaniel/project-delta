import { describe, expect, it } from 'vitest';
import { BASE } from '../config';
import { DefenseNetwork } from '../defenses/Installation';
import { homeDefenses } from '../defenses/Layout';
import { ResourceManager } from '../systems/ResourceManager';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { Base, STORE } from './Base';
import { BaseMode, levelStats } from './BaseMode';

const home = generateTerritories().find((t) => t.isHome)!;

function setup(paper = 1000) {
  const base = new Base(home, new DefenseNetwork(homeDefenses(home), seededRng(1)), new ResourceManager(paper));
  base.startFresh();
  const mode = new BaseMode(base);
  mode.enter();
  return { base, mode };
}

const project = () => ({ x: 100, y: 100 });

describe('BaseMode', () => {
  it('opens on a slot that needs attention, and picking a building jumps to a free slot that takes it', () => {
    const { mode, base } = setup();
    expect(mode.selected).toBe('D2'); // D1 has the starter turret
    mode.choose('radar');
    expect(mode.selected).toBe('R1');
    expect(mode.preview()).toMatchObject({ valid: true, spec: { kind: 'radar', slot: 'R1' } });
    expect(mode.build()).toBe(true);
    expect(base.at('R1')?.kind).toBe('radar');
    expect(mode.chosen).toBeNull();
    // Choosing the same building again drops it.
    mode.choose('workshop');
    mode.choose('workshop');
    expect(mode.chosen).toBeNull();
  });

  it('shows a red preview when the building cannot be afforded', () => {
    const { mode } = setup(20);
    mode.choose('launcher');
    expect(mode.preview()?.valid).toBe(false);
    expect(mode.build()).toBe(false);
  });

  it('removing asks twice', () => {
    const { mode, base } = setup();
    mode.selectSlot('D1');
    expect(mode.remove()).toBe(false);
    expect(base.at('D1')).not.toBeNull();
    expect(mode.view(project, false, null).inspector).toMatchObject({ type: 'building', confirmingRemove: true });
    expect(mode.remove()).toBe(true);
    expect(base.at('D1')).toBeNull();
  });

  it('builds the view: a marker per slot and the store, the tray with prices, and the inspector', () => {
    const { mode, base } = setup(100);
    base.installation('D1')!.damage(30);
    const v = mode.view(project, true, null);
    expect(v.slots.map((s) => s.id)).toEqual([STORE, ...BASE.slots.map((s) => s.id)]);
    expect(v.slots.find((s) => s.id === 'D1')).toMatchObject({ building: 'turret', status: 'damaged' });
    expect(v.tray.find((t) => t.kind === 'launcher')).toMatchObject({ cost: 110, missing: 10 });
    expect(v.overview).toMatchObject({ ready: 1, total: 1, radar: 'none' });
    expect(v.repairAll.count).toBe(1);
    mode.selectSlot('D1');
    const insp = mode.view(project, true, null).inspector;
    expect(insp).toMatchObject({ type: 'building', kind: 'turret', level: 1, repair: { cost: base.repairCost('D1') } });
    mode.selectSlot('U1');
    mode.choose('storage');
    expect(mode.view(project, true, null).inspector).toMatchObject({ type: 'empty', slot: 'U1', chosen: { kind: 'storage', fits: true } });
  });

  it('upgrade stats say what changes', () => {
    const next = levelStats('workshop', 2, 1);
    expect(next[0]).toMatchObject({ value: '+5/m', delta: '+3/m' });
    expect(levelStats('storage', 1)[0].value).toBe('+200');
  });
});
