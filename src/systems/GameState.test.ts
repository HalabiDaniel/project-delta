import { describe, expect, it } from 'vitest';
import { AIRCRAFT, BOMB, ECONOMY, PLANE, RAIDS } from '../config';
import { Mission, type MissionSpec } from '../missions/Mission';
import { GameState, type GameEvent } from './GameState';
import { HomeIncome } from './HomeIncome';
import { LocalStats, type KeyValueStore } from './LocalStats';
import { ResourceManager } from './ResourceManager';

const zone = (x: number) => ({ x, z: 0, radius: 5, top: 0.3 });

const SPECS: Record<string, MissionSpec> = {
  bomb: {
    type: 'bombing', difficulty: 'easy', title: 'Bomb T5', description: '', reward: 50, bombs: 3, timeLimit: null, ordered: false,
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
  practice: {
    type: 'practice', difficulty: 'medium', title: 'Practice', description: '', reward: 60, bombs: 0, timeLimit: null, ordered: false,
    objectives: [{ kind: 'destroy', territoryId: 'T4', targets: ['T4-d1', 'T4-d2', 'T4-d3'], count: 2 }],
  },
  suppression: {
    type: 'suppression', difficulty: 'medium', title: 'Suppress T6', description: '', reward: 80, bombs: 2, timeLimit: null, ordered: false,
    objectives: [{ kind: 'destroy', territoryId: 'T6', targets: ['T6-turret1', 'T6-turret2'], count: 2, what: 'defense' }],
  },
  multiStage: {
    type: 'multi-stage', difficulty: 'hard', title: 'Multi-stage', description: '', reward: 150, bombs: 1, timeLimit: null, ordered: true,
    objectives: [
      { kind: 'destroy', territoryId: 'T8', targets: ['T8-radar'], count: 1, what: 'radar' },
      { kind: 'destroy', territoryId: 'T8', targets: ['T8-supply'], count: 1, what: 'supply' },
      { kind: 'land', territoryId: 'T1' },
    ],
  },
  intercept: {
    type: 'bomber-intercept', difficulty: 'medium', title: 'Stop the raid', description: '', reward: 100, bombs: 0, timeLimit: null, ordered: false,
    objectives: [{ kind: 'intercept', territoryId: 'T1', targets: ['raider'], count: 1, what: 'bomber', before: 'release' }],
  },
  scout: {
    type: 'scout-intercept', difficulty: 'easy', title: 'Intercept the scout', description: '', reward: 60, bombs: 0, timeLimit: null, ordered: false,
    objectives: [{ kind: 'intercept', territoryId: 'T5', targets: ['scout'], count: 1, what: 'scout', before: 'escape' }],
  },
  escort: {
    type: 'escort', difficulty: 'medium', title: 'Escort', description: '', reward: 90, bombs: 0, timeLimit: null, ordered: false,
    objectives: [{ kind: 'escort', territoryId: 'T5', escort: 'friend', zone: zone(0) }],
  },
  low: {
    type: 'low-attack', difficulty: 'medium', title: 'Low-level strike', description: '', reward: 90, bombs: 2, timeLimit: null, ordered: false,
    objectives: [{ kind: 'bomb', territoryId: 'T5', zone: zone(0), precision: false, approach: { x: 0, z: 0, radius: 50, ceiling: 12 } }],
  },
};

const FALCON = AIRCRAFT.falcon.cost;

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

/** Builds the chosen plane (waiting out the fold) and launches. */
function sortie(state: GameState): void {
  expect(state.build()).toBe(true);
  state.tick(PLANE.buildTime);
  expect(state.phase).toBe('ready');
  expect(state.launch()).toBe(true);
}

/** Lands at home, then ends the sortie. */
function landAndEnd(state: GameState): void {
  expect(state.land('T1')).toBe(true);
  expect(state.endSortie()).toBe(true);
}

describe('GameState: garage', () => {
  it('starts at the desk with 100 paper, mission cards on offer and the Falcon chosen', () => {
    const { state, resources } = setup('bomb', 'double', 'delivery');
    expect(state.phase).toBe('desk');
    expect(resources.paper).toBe(ECONOMY.startingPaper);
    expect(state.offers.map((m) => m.title)).toEqual(['Bomb T5', 'Double', 'Deliver']);
    expect(state.selectedMission.title).toBe('Bomb T5');
    expect(state.aircraft).toBe('falcon');
    expect(state.hangar.size).toBe(0);
  });

  it('each design costs its own price and takes the fold time', () => {
    for (const id of ['dart', 'falcon', 'swift', 'widewing'] as const) {
      const { state, resources } = setup('delivery');
      state.selectAircraft(id);
      expect(state.buildCost).toBe(AIRCRAFT[id].cost);
      expect(state.build()).toBe(true);
      expect(resources.paper).toBe(100 - AIRCRAFT[id].cost);
      expect(state.phase).toBe('building');
      expect(state.launch()).toBe(false);
      state.tick(PLANE.buildTime / 2);
      expect(state.buildProgress).toBeCloseTo(0.5);
      state.tick(PLANE.buildTime / 2);
      expect(state.phase).toBe('ready');
      expect(state.plane?.id).toBe(id);
      expect(state.build()).toBe(false); // already have a plane
    }
  });

  it('cards can be chosen until launch, and the chosen one is flown', () => {
    const { state } = setup('bomb', 'double', 'delivery');
    expect(state.select(2)).toBe(true);
    state.build();
    expect(state.select(0)).toBe(true); // still allowed while folding
    state.tick(PLANE.buildTime);
    state.launch();
    expect(state.select(1)).toBe(false);
    expect(state.mission?.title).toBe('Bomb T5');
    expect(state.mission?.status).toBe('active');
  });

  it("a plane that can't carry a bomb per target can't be folded for that mission, at no charge", () => {
    const { state, resources, events } = setup('double', 'bomb');
    expect(state.suitability().level).toBe('unsuitable');
    expect(state.canBuild()).toBe(false);
    expect(state.build()).toBe(false);
    expect(resources.paper).toBe(100);
    expect(events).toContain('build-refused');
    state.selectAircraft('widewing');
    expect(state.canBuild()).toBe(true);
  });

  it('switching the card to an impossible mission after folding blocks the launch until it is switched back', () => {
    const { state, events } = setup('bomb', 'double');
    state.build();
    state.tick(PLANE.buildTime);
    state.select(1);
    expect(state.launch()).toBe(false);
    expect(events).toContain('launch-refused');
    state.select(0);
    expect(state.launch()).toBe(true);
  });

  it('switching designs with a plane on the pad stows it; rolling it out later is free and its cost goes to that sortie', () => {
    const { state, resources } = setup('bomb');
    state.build();
    expect(state.selectAircraft('dart')).toBe(false); // not while folding
    state.tick(PLANE.buildTime);
    expect(state.selectAircraft('dart')).toBe(true);
    expect(state.phase).toBe('desk');
    expect(state.hangar.get('falcon')).toMatchObject({ condition: 'ready', invested: FALCON });
    expect(state.buildCostFor('falcon')).toBe(0);
    state.selectAircraft('falcon');
    expect(state.buildKindFor('falcon')).toBe('rollout');
    expect(state.build()).toBe(true);
    expect(resources.paper).toBe(100 - FALCON);
    state.tick(PLANE.rolloutTime);
    expect(state.phase).toBe('ready');
    expect(state.sortie?.paperSpent).toBe(FALCON);
    expect(state.stats.planesBuilt).toBe(1);
  });
});

describe('GameState: weapons', () => {
  it('a hit pays the reward exactly once', () => {
    const { state, resources, events } = setup();
    sortie(state);
    expect(state.dropBomb()).toBe(true);
    state.resolveBomb(0);
    expect(state.mission?.status).toBe('succeeded');
    expect(resources.paper).toBe(100 - FALCON + 50);
    state.resolveBomb(0);
    state.resolveBomb(null);
    expect(resources.paper).toBe(100 - FALCON + 50);
    expect(events.filter((e) => e === 'mission-succeeded')).toHaveLength(1);
  });

  it('a plane carries as many of the offered bombs as its rack holds', () => {
    for (const [id, load] of [['falcon', 1], ['swift', 2], ['widewing', 3]] as const) {
      const { state } = setup('bomb');
      state.selectAircraft(id);
      sortie(state);
      expect(state.bombsLoaded).toBe(load);
    }
  });

  it('bombs are limited by the load and spaced by a cooldown', () => {
    const { state } = setup('double');
    state.selectAircraft('widewing');
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
    state.selectAircraft('widewing');
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
    expect(resources.paper).toBe(100 - AIRCRAFT.widewing.cost);
    expect(state.sortie).toMatchObject({ bombsDropped: 3, bombHits: 1 });
  });

  it('ink guns fire at their rate until the ammunition runs out', () => {
    const { state, events } = setup('delivery');
    sortie(state);
    const gun = AIRCRAFT.falcon.gun;
    expect(state.gun?.ammo).toBe(gun.ammo);
    expect(state.fire()).toBe(0);
    expect(state.fire()).toBeNull();
    state.tick(gun.interval);
    expect(state.fire()).toBe(1); // the other wing
    for (let i = 0; i < gun.ammo * 2; i++) {
      state.tick(gun.interval);
      state.fire();
    }
    expect(state.gun?.ammo).toBe(0);
    expect(state.canFire()).toBe(false);
    expect(events).toContain('out-of-ammo');
    expect(state.sortie?.shotsFired).toBe(gun.ammo);
  });

  it('shooting down practice planes completes target practice, each counted once', () => {
    const { state, resources, events } = setup('practice');
    sortie(state);
    state.recordShotHit();
    state.recordDamage(20, null);
    state.recordDamage(20, 'T4-d1');
    expect(state.mission?.status).toBe('active');
    state.recordDamage(40, 'T5-d1'); // not on the mission's territory
    expect(state.mission?.status).toBe('active');
    state.recordDamage(40, 'T4-d2');
    expect(state.mission?.status).toBe('succeeded');
    expect(resources.paper).toBe(100 - FALCON + 60);
    expect(state.sortie).toMatchObject({ damageDealt: 120, targetsDestroyed: 3, shotsHit: 1 });
    expect(state.stats.targetsDestroyed).toBe(3);
    expect(events.filter((e) => e === 'target-destroyed')).toHaveLength(3);
  });
});

describe('GameState: damage and range', () => {
  it('damage wears the plane down; at zero health it is destroyed by whatever did it', () => {
    const { state, events } = setup('delivery');
    sortie(state);
    expect(state.damageAircraft(30, 'impact')).toEqual({ dealt: 30, destroyed: false });
    expect(state.durability?.health).toBe(AIRCRAFT.falcon.maxHealth - 30);
    expect(events).toContain('damaged');
    expect(state.damageAircraft(500, 'landing')).toEqual({ dealt: 70, destroyed: true });
    expect(state.phase).toBe('crashed');
    expect(state.sortie).toMatchObject({ damageTaken: 100, outcome: 'lost' });
    expect(state.stats.planesLost).toBe(1);
    expect(state.mission?.failure).toBe('aircraft-lost');
  });

  it('flying uses up range; once it is gone the plane can only glide', () => {
    const { state, events } = setup('delivery');
    state.selectAircraft('widewing');
    sortie(state);
    expect(state.rangeLeft).toBe(AIRCRAFT.widewing.range);
    state.updateFlight({ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: -300 }, 0.1);
    expect(state.rangeLeft).toBe(AIRCRAFT.widewing.range - 300);
    expect(state.outOfRange).toBe(false);
    state.updateFlight({ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: -5000 }, 0.1);
    expect(state.outOfRange).toBe(true);
    expect(events.filter((e) => e === 'range-exhausted')).toHaveLength(1);
  });
});

describe('GameState: landing, rearming and the end of a sortie', () => {
  it('landing keeps the sortie going: rearm (free) restores ink and range, then take off again', () => {
    const { state, resources, events } = setup('practice');
    sortie(state);
    for (let i = 0; i < 10; i++) {
      state.fire();
      state.tick(1);
    }
    state.updateFlight({ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: -200 }, 0.1);
    expect(state.rearm()).toBe(false); // only on the ground
    expect(state.land('T1')).toBe(true);
    expect(state.phase).toBe('landed');
    expect(state.mission?.status).toBe('active');
    const paper = resources.paper;
    expect(state.rearm()).toBe(true);
    expect(state.takeOff()).toBe(false); // the ground crew is still at it
    state.tick(PLANE.rearmTime);
    expect(events).toContain('rearmed');
    expect(state.gun?.ammo).toBe(AIRCRAFT.falcon.gun.ammo);
    expect(state.rangeLeft).toBe(AIRCRAFT.falcon.range);
    expect(resources.paper).toBe(paper);
    expect(state.canRearm()).toBe(false); // nothing left to top up
    expect(state.takeOff()).toBe(true);
    expect(state.phase).toBe('flying');
    expect(state.sortie?.rearms).toBe(1);
  });

  it('the mission clock keeps running on the ground', () => {
    const { state } = setup('delivery');
    sortie(state);
    state.land('T1');
    state.tick(11);
    expect(state.mission?.failure).toBe('out-of-time');
  });

  it('ending the sortie recovers the plane, abandons an unfinished mission, and the next one is a cheap refit', () => {
    const { state, resources, events } = setup();
    sortie(state);
    landAndEnd(state);
    expect(state.phase).toBe('debrief');
    expect(state.mission?.failure).toBe('abandoned');
    expect(state.hangar.get('falcon')?.condition).toBe('recovered');
    expect(state.stats.planesRecovered).toBe(1);
    expect(state.sortie?.outcome).toBe('recovered');
    expect(events).toContain('sortie-ended');

    expect(state.continueToDesk()).toBe(true);
    expect(state.buildCost).toBe(AIRCRAFT.falcon.refitCost);
    const before = resources.paper;
    state.build();
    expect(resources.paper).toBe(before - AIRCRAFT.falcon.refitCost);
    expect(state.buildKind).toBe('refit');
    expect(state.stats.planesBuilt).toBe(1); // a refit isn't a new plane
    state.tick(PLANE.refitTime);
    expect(state.phase).toBe('ready');
    expect(state.durability?.health).toBe(AIRCRAFT.falcon.maxHealth); // repaired
    expect(state.buildCostFor('falcon')).toBe(FALCON); // the hangar is empty again
  });

  it('a strike & return mission only pays once the plane lands', () => {
    const { state, resources } = setup('return');
    sortie(state);
    state.dropBomb();
    state.resolveBomb(0);
    expect(state.mission?.status).toBe('active');
    expect(resources.paper).toBe(100 - FALCON);
    state.land('T1');
    expect(state.mission?.status).toBe('succeeded');
    expect(resources.paper).toBe(100 - FALCON + 120);
    expect(state.sortie).toMatchObject({ paperSpent: FALCON, paperEarned: 120 });
  });

  it('crashing loses the plane without a reward, and a late bomb cannot score', () => {
    const { state, resources } = setup();
    sortie(state);
    state.dropBomb();
    state.crash('void');
    expect(state.phase).toBe('crashed');
    expect(state.hangar.size).toBe(0);
    expect(state.mission?.failure).toBe('aircraft-lost');
    state.resolveBomb(0); // the bomb released before the crash lands afterwards
    expect(resources.paper).toBe(100 - FALCON);
    expect(state.bombsFalling).toBe(0);
  });

  it('crashing after success keeps the reward, but the next plane costs full price', () => {
    const { state, resources } = setup();
    sortie(state);
    state.dropBomb();
    state.resolveBomb(0);
    state.crash('hard-landing');
    expect(resources.paper).toBe(100 - FALCON + 50);
    expect(state.stats.failures).toBe(0);
    state.continueToDesk();
    expect(state.buildCost).toBe(FALCON);
  });

  it('continuing deals fresh cards; the loop repeats without reloading', () => {
    const { state, resources, deals } = setup();
    for (let i = 0; i < 3; i++) {
      sortie(state);
      state.dropBomb();
      state.resolveBomb(0);
      landAndEnd(state);
      expect(state.continueToDesk()).toBe(true);
      expect(state.phase).toBe('desk');
      expect(state.mission).toBeNull();
    }
    expect(deals()).toBe(4);
    const refit = AIRCRAFT.falcon.refitCost;
    expect(resources.paper).toBe(100 - FALCON - refit - refit + 3 * 50);
    expect(state.stats).toMatchObject({ planesBuilt: 1, planesRecovered: 3, successes: 3, failures: 0 });
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
    expect(builds).toBe(4);
    expect(state.canBuild()).toBe(false);
    expect(events).toContain('build-refused');
    const wait = state.income.timeToAfford(resources.paper, state.buildCost)!;
    expect(wait).toBeGreaterThan(0);
    state.tick(wait);
    expect(state.canBuild()).toBe(true);
  });
});

describe('GameState: defenses', () => {
  it('destroying defenses counts in the sortie and completes suppression', () => {
    const { state, resources, events } = setup('suppression');
    sortie(state);
    state.recordDamage(50, null, true);
    state.recordDamage(30, 'T6-turret1', true);
    expect(state.mission?.status).toBe('active');
    state.recordDamage(80, 'T6-turret2', true);
    expect(state.mission?.status).toBe('succeeded');
    expect(resources.paper).toBe(100 - FALCON + 80);
    expect(state.sortie).toMatchObject({ damageDealt: 160, targetsDestroyed: 2, defensesDestroyed: 2 });
    expect(state.stats.defensesDestroyed).toBe(2);
    expect(events.filter((e) => e === 'target-destroyed')).toHaveLength(2);
  });

  it('a multi-stage strike done out of order still counts each stage, and pays on landing', () => {
    const { state, resources } = setup('multiStage');
    sortie(state);
    state.recordDamage(90, 'T8-supply', true);
    expect(state.mission?.isDone(1)).toBe(false);
    state.recordDamage(70, 'T8-radar', true);
    expect(state.mission?.isDone(0)).toBe(true);
    expect(state.mission?.isDone(1)).toBe(true);
    expect(state.mission?.status).toBe('active');
    state.land('T1');
    expect(state.mission?.status).toBe('succeeded');
    expect(resources.paper).toBe(100 - FALCON + 150);
  });

  it('records incoming fire, hits taken and what shot the plane down', () => {
    const { state } = setup('delivery');
    sortie(state);
    for (let i = 0; i < 5; i++) state.recordIncoming();
    state.damageAircraft(4, 'projectile', 'Ink turret on T5');
    state.damageAircraft(10, 'impact');
    expect(state.sortie).toMatchObject({ enemyShots: 5, enemyHits: 1, damageTaken: 14, killedBy: null });
    expect(state.damageAircraft(500, 'blast', 'Paper rocket launcher on T8').destroyed).toBe(true);
    expect(state.phase).toBe('crashed');
    expect(state.sortie).toMatchObject({ enemyHits: 2, killedBy: 'Paper rocket launcher on T8', outcome: 'lost' });
  });

  it('a low-level strike only counts a bomb released on a clean approach', () => {
    const { state } = setup('low');
    const seen: GameEvent[] = [];
    state.onEvent((e) => seen.push(e));
    state.selectAircraft('swift');
    sortie(state);
    expect(state.releaseClean).toBe(false); // not in the zone yet
    state.updateFlight({ x: -60, y: 10, z: 0 }, { x: -40, y: 10, z: 0 }, 0.1);
    expect(state.releaseClean).toBe(true);
    state.updateFlight({ x: -40, y: 10, z: 0 }, { x: -30, y: 20, z: 0 }, 0.1);
    expect(seen.map((e) => e.type)).toContain('approach-blown');
    expect(state.releaseClean).toBe(false);
    state.dropBomb();
    state.resolveBomb(0, false, false);
    expect(seen).toContainEqual({ type: 'bomb-missed', remaining: 1, tooHigh: true });
    expect(state.mission?.status).toBe('active');
    state.updateFlight({ x: -30, y: 8, z: 0 }, { x: -80, y: 8, z: 0 }, 0.1);
    state.updateFlight({ x: -80, y: 8, z: 0 }, { x: -40, y: 8, z: 0 }, 0.1);
    state.tick(BOMB.dropCooldown);
    state.dropBomb();
    state.resolveBomb(0, false, state.releaseClean);
    expect(state.mission?.status).toBe('succeeded');
  });
});

describe('GameState: aircraft and raids', () => {
  it('shooting down the bomber completes an interception; its bomb release first fails it', () => {
    const { state, resources } = setup('intercept');
    sortie(state);
    const before = resources.paper;
    state.aircraftDestroyed('raider', 'bomber', true);
    expect(state.mission!.status).toBe('succeeded');
    expect(resources.paper).toBe(before + 100);
    expect(state.sortie).toMatchObject({ aircraftDestroyed: 1, bombersIntercepted: 1 });
    expect(state.stats.bombersIntercepted).toBe(1);

    landAndEnd(state);
    state.continueToDesk();
    sortie(state);
    state.bombReleased('someone-else');
    expect(state.mission!.isActive).toBe(true);
    state.bombReleased('raider');
    expect(state.mission).toMatchObject({ status: 'failed', failure: 'target-bombed' });
  });

  it("a mission target counts whoever brings it down, but the player's numbers only count their own kills", () => {
    const { state } = setup('intercept');
    sortie(state);
    state.aircraftDestroyed('raider', 'bomber', false);
    expect(state.mission!.status).toBe('succeeded');
    expect(state.sortie!.aircraftDestroyed).toBe(0);
  });

  it('a scout that gets away loses the mission; one shot down first does not', () => {
    const { state } = setup('scout');
    sortie(state);
    state.aircraftEscaped('scout');
    expect(state.mission).toMatchObject({ status: 'failed', failure: 'target-escaped' });
  });

  it('an escort succeeds when the bomber hits, and fails if it is shot down', () => {
    const { state } = setup('escort');
    sortie(state);
    state.escortStrike('friend', false);
    expect(state.mission!.isActive).toBe(true);
    state.escortStrike('friend', true);
    expect(state.mission!.status).toBe('succeeded');
    expect(state.sortie!.objectivesProtected).toBe(1);

    landAndEnd(state);
    state.continueToDesk();
    sortie(state);
    state.aircraftDestroyed('friend', 'bomber', false);
    expect(state.mission).toMatchObject({ status: 'failed', failure: 'escort-lost' });
  });

  it('a raid beaten off pays the defense reward only to a player who took part', () => {
    const { state, resources } = setup();
    const start = resources.paper;
    state.raidDefended(false);
    expect(resources.paper).toBe(start);
    state.raidDefended(true);
    expect(resources.paper).toBe(start + RAIDS.reward);
    // A raid a mission sent pays through the mission instead.
    state.raidDefended(true, true);
    expect(resources.paper).toBe(start + RAIDS.reward);
  });

  it('a raid that hits costs paper, but never below the protected minimum', () => {
    const { state, resources } = setup();
    expect(state.raidHit()).toBe(RAIDS.penalty);
    expect(resources.paper).toBe(ECONOMY.startingPaper - RAIDS.penalty);
    resources.spend(resources.paper - ECONOMY.protectedPaper - 5);
    expect(state.raidHit()).toBe(5);
    expect(state.raidHit()).toBe(0);
    expect(resources.paper).toBe(ECONOMY.protectedPaper);
    // Enough left to fold a fighter and go hunting.
    expect(ECONOMY.protectedPaper).toBeGreaterThanOrEqual(AIRCRAFT.falcon.cost);
  });

  it('raid losses during a sortie show in its report', () => {
    const { state } = setup();
    sortie(state);
    state.raidHit();
    expect(state.sortie!.paperLost).toBe(RAIDS.penalty);
  });
});

describe('LocalStats', () => {
  const memory = (): KeyValueStore & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };

  it('keeps career numbers across visits and works out the favourite plane', () => {
    const store = memory();
    const first = new LocalStats(store);
    expect(first.favorite).toBeNull();
    first.recordSortie('dart');
    first.recordSortie('widewing');
    first.recordSortie('widewing');
    first.recordMissionCompleted();
    first.recordPlaneLost();
    first.recordTargetDestroyed();
    first.recordTargetDestroyed(true);
    first.rememberAircraft('swift');
    const second = new LocalStats(store);
    expect(second.data).toMatchObject({ missionsCompleted: 1, planesLost: 1, targetsDestroyed: 2, defensesDestroyed: 1, lastAircraft: 'swift' });
    expect(second.favorite).toBe('widewing');
  });

  it('survives missing, broken or blocked storage', () => {
    expect(new LocalStats(null).data.missionsCompleted).toBe(0);
    const broken = memory();
    broken.data['paperwars.career.v1'] = '{not json';
    expect(new LocalStats(broken).data.planesLost).toBe(0);
    const junk = memory();
    junk.data['paperwars.career.v1'] = JSON.stringify({ missionsCompleted: -4, planesLost: 'x', sorties: { falcon: 2, jet: 9 }, lastAircraft: 'jet' });
    expect(new LocalStats(junk).data).toEqual({
      missionsCompleted: 0, planesLost: 0, targetsDestroyed: 0, defensesDestroyed: 0, aircraftDestroyed: 0, bombersIntercepted: 0,
      sorties: { falcon: 2 }, lastAircraft: null,
    });
    const blocked: KeyValueStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const stats = new LocalStats(blocked);
    stats.recordMissionCompleted();
    expect(stats.data.missionsCompleted).toBe(1);
  });
});
