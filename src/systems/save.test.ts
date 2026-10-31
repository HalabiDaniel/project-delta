import { describe, expect, it } from 'vitest';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { AIRCRAFT, AIRCRAFT_ORDER, type AircraftId } from '../config';
import { layoutDefenses } from '../defenses/Layout';
import { MissionDirector } from '../director/MissionDirector';
import { planOperation } from '../director/Operations';
import type { MissionContext } from '../missions/MissionGenerator';
import { emptyProgress, emptySession } from '../progress/Progress';
import { seededRng } from './Random';
import { MemoryStore, migrate, SAVE_VERSION, SaveManager, validateSave, type SaveData } from './SaveGame';
import { generateTerritories } from '../world/WorldGenerator';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const layout = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint)));
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x, z: home.z }, dummies: range.filter((s) => s.kind === 'dummy'), obstacles: [], installations: layout.installations };
const costs = Object.fromEntries(AIRCRAFT_ORDER.map((id) => [id, AIRCRAFT[id].cost])) as Record<AircraftId, number>;

function sample(): SaveData {
  const d = new MissionDirector(() => ctx, () => ({ paper: 100, costs, airRoom: 4, raidActive: false }), seededRng(4), () => 0);
  d.deal();
  d.operation = planOperation(ctx, 'medium', seededRng(2), () => 50);
  const progress = emptyProgress();
  progress.streak = { current: 2, best: 4 };
  progress.achievements['gold'] = 123;
  progress.mastery.falcon = { flights: 3, missions: 2, lost: 1, bombsDropped: 1, bombHits: 1, shotsFired: 90, shotsHit: 20, kills: 2, distance: 1500, byCategory: { dogfight: 2 } };
  return {
    version: SAVE_VERSION,
    savedAt: 1000,
    paper: 137,
    aircraft: 'swift',
    hangar: [{ id: 'falcon', condition: 'recovered', health: 64, invested: 0 }],
    inFlight: { aircraft: 'swift', health: 80 },
    director: d.save(),
    progress,
    ledger: {
      entries: [{ at: 5, delta: -25, balance: 75, source: 'spend', label: 'Folded Falcon', count: 1 }],
      totals: { earned: 80, spent: 25, income: 10, bonuses: 0, raids: 0 },
      byAircraft: [['falcon', { sorties: 1, successes: 1, lost: 0, spent: 25, earned: 80 }]],
      byType: [['dogfight', { sorties: 1, successes: 1, lost: 0, spent: 25, earned: 80 }]],
    },
    settings: { muted: true, dev: false },
    lastSession: { ...emptySession(9), missionsCompleted: 3 },
  };
}

describe('SaveManager', () => {
  it('saves and restores everything', async () => {
    const store = new MemoryStore();
    const saves = new SaveManager(store);
    const data = sample();
    saves.schedule(() => data, 10_000);
    await saves.flush();
    const { data: back, problems } = await new SaveManager(store).load();
    expect(problems).toEqual([]);
    expect(back).toEqual(JSON.parse(JSON.stringify(data)));
  });

  it('a restored director deals the same cards and keeps its operation', async () => {
    const store = new MemoryStore();
    const data = sample();
    await store.write('main', JSON.stringify(data));
    const { data: back } = await new SaveManager(store).load();
    const d = new MissionDirector(() => ctx, () => ({ paper: 100, costs, airRoom: 4, raidActive: false }), seededRng(77), () => 0);
    d.load(back!.director!);
    expect(d.operation?.codename).toBe(data.director!.operation!.codename);
    expect(d.offers[0].mission.title).toBeTruthy();
  });

  it('with no save there is nothing to restore', async () => {
    expect(await new SaveManager(new MemoryStore()).load()).toEqual({ data: null, problems: [] });
  });

  it("keeps an unreadable save aside instead of crashing", async () => {
    const store = new MemoryStore();
    await store.write('main', '{not json');
    const { data, problems } = await new SaveManager(store).load();
    expect(data).toBeNull();
    expect(problems[0]).toMatch(/not readable/);
    expect(await store.read('backup')).toBe('{not json');
  });

  it('never overwrites a save from a newer version', async () => {
    const store = new MemoryStore();
    const future = JSON.stringify({ ...sample(), version: SAVE_VERSION + 1 });
    await store.write('main', future);
    const saves = new SaveManager(store);
    const { data, problems } = await saves.load();
    expect(data).toBeNull();
    expect(problems[0]).toMatch(/newer version/);
    saves.schedule(() => sample(), 0);
    await saves.flush();
    expect(await store.read('main')).toBe(future);
  });

  it('reset deletes the save and stops saving', async () => {
    const store = new MemoryStore();
    const saves = new SaveManager(store);
    saves.schedule(() => sample(), 10_000);
    await saves.flush();
    await saves.reset();
    expect(await store.read('main')).toBeNull();
    saves.schedule(() => sample(), 0);
    await saves.flush();
    expect(await store.read('main')).toBeNull();
  });
});

describe('validateSave', () => {
  it('repairs damaged fields with defaults and says what it dropped', () => {
    const raw = JSON.parse(JSON.stringify(sample()));
    raw.paper = -50;
    raw.aircraft = 'zeppelin';
    raw.hangar.push({ id: 'falcon', condition: 'ready', health: 10, invested: 0 }, { id: 'nope' }, 'junk');
    raw.director.skill = 'high';
    raw.director.offers[1].recipe.type = 'teleport';
    raw.director.operation.stages[0].status = 'banana';
    raw.progress.achievements.fake = 1;
    raw.progress.streak = 'long';
    raw.ledger.entries.push({ source: 'theft', delta: 5 });
    const problems: string[] = [];
    const data = validateSave(raw, problems)!;
    expect(data.paper).toBe(0);
    expect(data.aircraft).toBe('falcon');
    expect(data.hangar).toEqual([{ id: 'falcon', condition: 'recovered', health: 64, invested: 0 }]);
    expect(data.director!.skill).toBeGreaterThan(0);
    expect(data.director!.offers[1].recipe).toBeNull();
    expect(data.director!.operation).toBeNull();
    expect(data.progress.achievements).toEqual({ gold: 123 });
    expect(data.progress.streak).toEqual({ current: 0, best: 0 });
    expect(data.ledger.entries).toHaveLength(1);
    expect(problems.length).toBeGreaterThan(4);
  });

  it("keeps world events' missions in the history and records", () => {
    const raw = JSON.parse(JSON.stringify(sample()));
    raw.director.history.push({ at: 1, kind: 'offered', type: 'shipment', tier: 'medium', title: 'Paper shipment on T3', slot: 'event', source: 'event' });
    raw.director.records.push({ type: 'convoy', tier: 'easy', aircraft: 'falcon', success: true });
    const problems: string[] = [];
    const data = validateSave(raw, problems)!;
    expect(problems).toEqual([]);
    expect(data.director!.history.at(-1)?.type).toBe('shipment');
    expect(data.director!.records.at(-1)?.type).toBe('convoy');
  });

  it('an empty object gives a fresh game, and junk gives none', () => {
    const fresh = validateSave({})!;
    expect(fresh.paper).toBe(100);
    expect(fresh.director).toBeNull();
    expect(fresh.progress.streak.current).toBe(0);
    expect(validateSave('hello')).toBeNull();
    expect(validateSave(null)).toBeNull();
  });

  it('migration leaves current saves alone and refuses unknown old ones', () => {
    const problems: string[] = [];
    expect(migrate({ version: SAVE_VERSION, paper: 5 }, problems)).toEqual({ version: SAVE_VERSION, paper: 5 });
    expect(migrate({ version: 0 }, problems)).toBeNull();
    expect(problems[0]).toMatch(/upgrade/);
  });
});
