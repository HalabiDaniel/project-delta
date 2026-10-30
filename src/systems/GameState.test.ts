import { describe, expect, it } from 'vitest';
import { BOMB, ECONOMY, PLANE } from '../config';
import { Mission, type MissionSpec } from '../missions/Mission';
import { GameState, type GameEvent } from './GameState';
import { HomeIncome } from './HomeIncome';
import { ResourceManager } from './ResourceManager';

const zone = (x: number) => ({ x, z: 0, radius: 5, top: 0.3 });

const SPECS: Record<string, MissionSpec> = {
  bomb: {
    type: 'bombing', difficulty: 'easy', title: 'Bomb T5', description: '', reward: 50, bombs: 1, timeLimit: null, ordered: false,
    objectives: [{ kind: 'bomb', territoryId: 'T5', zone: zone(0), precision: false }],
  },
  double: {
    type: 'multi-bomb', difficulty: 'medium', title: 'Double', description: '', reward: 90, bombs: 3, timeLimit: null, ordered: false,
    objectives: [
      { kind: 'bomb', territoryId: 'T5', zone: zone(0), precision: false },
      { kind: 'bomb', territoryId: 'T6', zone: zone(70), precision: false },
    ],
  },
  return: {
    type: 'return', difficulty: 'hard', title: 'Strike & return', description: '', reward: 120, bombs: 1, timeLimit: null, ordered: true,
    objectives: [
      { kind: 'bomb', territoryId: 'T5', zone: zone(0), precision: false },
      { kind: 'land', territoryId: 'T1' },
    ],
  },
  delivery: {
    type: 'delivery', difficulty: 'easy', title: 'Deliver', description: '', reward: 40, bombs: 0, timeLimit: 10, ordered: false,
    objectives: [{ kind: 'reach', territoryId: 'T6', airspace: { x: 70, z: 0, half: 20, ceiling: 35 } }],
  },
};

/**
 * Offers the given missions, freshly, every time the cards are dealt. Home income is switched off
 * so paper totals are exact; the last test covers it.
 */
function setup(...kinds: string[]) {
  return setupWith(new HomeIncome(1, Infinity), ...kinds);
}

function setupWith(income: HomeIncome, ...kinds: string[]) {
  const resources = new ResourceManager();
  let deals = 0;
  const offers = () => {
    deals++;
    return (kinds.length ? kinds : ['bomb']).map((k) => new Mission(SPECS[k]));
  };
  const state = new GameState(resources, offers, income);
  const events: GameEvent['type'][] = [];
  state.onEvent((e) => events.push(e.type));
  return { resources, state, events, deals: () => deals };
}

/** Builds (waiting out the fold) and launches. */
function sortie(state: GameState): void {
  expect(state.build()).toBe(true);
  state.tick(PLANE.buildTime);
  expect(state.phase).toBe('ready');
  expect(state.launch()).toBe(true);
}

describe('GameState', () => {
  it('starts at the desk with 100 paper and mission cards on offer', () => {
    const { state, resources } = setup('bomb', 'double', 'delivery');
    expect(state.phase).toBe('desk');
    expect(resources.paper).toBe(ECONOMY.startingPaper);
    expect(state.offers.map((m) => m.title)).toEqual(['Bomb T5', 'Double', 'Deliver']);
    expect(state.selectedMission.title).toBe('Bomb T5');
  });

  it('cards can be chosen until launch, and the chosen one is flown', () => {
    const { state } = setup('bomb', 'double', 'delivery');
    expect(state.select(1)).toBe(true);
    state.build();
    expect(state.select(2)).toBe(true); // still allowed while folding
    state.tick(PLANE.buildTime);
    state.launch();
    expect(state.select(0)).toBe(false);
    expect(state.mission?.title).toBe('Deliver');
    expect(state.mission?.status).toBe('active');
  });

  it('folding costs 20 paper and takes the build time before the plane is ready', () => {
    const { state, resources } = setup();
    expect(state.build()).toBe(true);
    expect(resources.paper).toBe(80);
    expect(state.phase).toBe('building');
    expect(state.launch()).toBe(false);
    state.tick(PLANE.buildTime / 2);
    expect(state.buildProgress).toBeCloseTo(0.5);
    expect(state.phase).toBe('building');
    state.tick(PLANE.buildTime / 2);
    expect(state.phase).toBe('ready');
    expect(state.build()).toBe(false); // already have a plane
    expect(state.stats.planesBuilt).toBe(1);
  });

  it('a hit pays the reward exactly once', () => {
    const { state, resources, events } = setup();
    sortie(state);
    expect(state.dropBomb()).toBe(true);
    state.resolveBomb(0);
    expect(state.mission?.status).toBe('succeeded');
    expect(resources.paper).toBe(80 + 50);
    state.resolveBomb(0);
    state.resolveBomb(null);
    expect(resources.paper).toBe(130);
    expect(events.filter((e) => e === 'mission-succeeded')).toHaveLength(1);
  });

  it('bombs are limited by the load and spaced by a cooldown', () => {
    const { state } = setup('double');
    sortie(state);
    expect(state.bombsLoaded).toBe(3);
    expect(state.dropBomb()).toBe(true);
    expect(state.dropBomb()).toBe(false); // cooling down
    state.tick(BOMB.dropCooldown);
    expect(state.dropBomb()).toBe(true);
    state.tick(BOMB.dropCooldown);
    expect(state.dropBomb()).toBe(true);
    state.tick(BOMB.dropCooldown);
    expect(state.dropBomb()).toBe(false); // empty
    expect(state.bombsFalling).toBe(3);
  });

  it('a miss with bombs left keeps the mission going; the last miss fails it', () => {
    const { state, resources, events } = setup('double');
    sortie(state);
    for (let i = 0; i < 3; i++) {
      state.dropBomb();
      state.tick(BOMB.dropCooldown);
    }
    state.resolveBomb(0);
    state.resolveBomb(null);
    expect(state.mission?.status).toBe('active');
    expect(events).toContain('bomb-missed');
    state.resolveBomb(null);
    expect(state.mission?.status).toBe('failed');
    expect(state.mission?.failure).toBe('missed');
    expect(resources.paper).toBe(80);
  });

  it('both targets on a double strike pays once both are hit', () => {
    const { state, resources } = setup('double');
    sortie(state);
    state.dropBomb();
    state.resolveBomb(1);
    expect(state.mission?.status).toBe('active');
    state.tick(BOMB.dropCooldown);
    state.dropBomb();
    state.resolveBomb(0);
    expect(state.mission?.status).toBe('succeeded');
    expect(resources.paper).toBe(80 + 90);
  });

  it('flying objectives complete from flight steps, and timed missions run out', () => {
    const { state } = setup('delivery', 'delivery');
    sortie(state);
    expect(state.bombsLoaded).toBe(0);
    expect(state.dropBomb()).toBe(false);
    state.updateFlight({ x: 40, y: 10, z: 0 }, { x: 52, y: 10, z: 0 }, 0.1);
    expect(state.mission?.status).toBe('succeeded');

    const late = setup('delivery');
    sortie(late.state);
    late.state.tick(11);
    expect(late.state.mission?.status).toBe('failed');
    expect(late.state.mission?.failure).toBe('out-of-time');
  });

  it('landing recovers the plane, and the next one is a cheap refit', () => {
    const { state, resources, events } = setup();
    sortie(state);
    state.dropBomb();
    state.resolveBomb(0);
    expect(state.land('T1')).toBe(true);
    expect(state.phase).toBe('landed');
    expect(state.hangarPlane).toBe(true);
    expect(state.stats.planesRecovered).toBe(1);
    expect(state.mission?.status).toBe('succeeded'); // the reward stays
    expect(events).toContain('landed');

    expect(state.continueToDesk()).toBe(true);
    expect(state.buildCost).toBe(ECONOMY.refitCost);
    const before = resources.paper;
    state.build();
    expect(resources.paper).toBe(before - ECONOMY.refitCost);
    expect(state.refitting).toBe(true);
    expect(state.stats.planesBuilt).toBe(1); // a refit isn't a new plane
    state.tick(PLANE.refitTime);
    expect(state.phase).toBe('ready');
    expect(state.buildCost).toBe(ECONOMY.planeCost); // the hangar is empty again
  });

  it('landing before the mission is done abandons it', () => {
    const { state, resources } = setup();
    sortie(state);
    state.land('T1');
    expect(state.mission?.status).toBe('failed');
    expect(state.mission?.failure).toBe('abandoned');
    expect(resources.paper).toBe(80);
    expect(state.stats.failures).toBe(1);
  });

  it('a strike & return mission only pays once the plane lands', () => {
    const { state, resources } = setup('return');
    sortie(state);
    state.dropBomb();
    state.resolveBomb(0);
    expect(state.mission?.status).toBe('active');
    expect(resources.paper).toBe(80);
    // The landing ends the sortie before it completes the mission, so listeners see it as landed.
    let phaseAtSuccess = '';
    state.onEvent((e) => {
      if (e.type === 'mission-succeeded') phaseAtSuccess = state.phase;
    });
    state.land('T1');
    expect(state.mission?.status).toBe('succeeded');
    expect(phaseAtSuccess).toBe('landed');
    expect(resources.paper).toBe(80 + 120);
  });

  it('crashing loses the plane without a reward, and a late bomb cannot score', () => {
    const { state, resources } = setup();
    sortie(state);
    state.dropBomb();
    state.crash('void');
    expect(state.phase).toBe('crashed');
    expect(state.hangarPlane).toBe(false);
    expect(state.mission?.failure).toBe('aircraft-lost');
    state.resolveBomb(0); // the bomb released before the crash lands afterwards
    expect(resources.paper).toBe(80);
    expect(state.bombsFalling).toBe(0);
  });

  it('crashing after success keeps the reward, but the next plane costs full price', () => {
    const { state, resources } = setup();
    sortie(state);
    state.dropBomb();
    state.resolveBomb(0);
    state.crash('hard-landing');
    expect(resources.paper).toBe(130);
    expect(state.stats.failures).toBe(0);
    state.continueToDesk();
    expect(state.buildCost).toBe(ECONOMY.planeCost);
  });

  it('continuing deals fresh cards; the loop repeats without reloading', () => {
    const { state, resources, deals } = setup();
    for (let i = 0; i < 3; i++) {
      sortie(state);
      state.dropBomb();
      state.resolveBomb(0);
      state.land('T1');
      expect(state.continueToDesk()).toBe(true);
      expect(state.phase).toBe('desk');
      expect(state.mission).toBeNull();
    }
    expect(deals()).toBe(4);
    // One new plane, then two refits; three rewards.
    expect(resources.paper).toBe(100 - 20 - 5 - 5 + 3 * 50);
    expect(state.stats).toEqual({ planesBuilt: 1, planesRecovered: 3, successes: 3, failures: 0 });
  });

  it('paper never goes negative: building is refused, and home income gets the player going again', () => {
    const { state, resources, events } = setupWith(new HomeIncome());
    let builds = 0;
    for (let i = 0; i < 10; i++) {
      if (state.build()) {
        builds++;
        state.tick(PLANE.buildTime); // home income trickles in while folding
        state.launch();
        state.crash('void');
        state.continueToDesk();
      }
      expect(resources.paper).toBeGreaterThanOrEqual(0);
    }
    expect(builds).toBe(5);
    expect(state.canBuild()).toBe(false);
    expect(events).toContain('build-refused');
    const wait = state.income.timeToAfford(resources.paper, state.buildCost)!;
    expect(wait).toBeGreaterThan(0);
    state.tick(wait);
    expect(state.canBuild()).toBe(true);
  });
});
