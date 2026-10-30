import { describe, expect, it } from 'vitest';
import { BombingMission } from '../missions/BombingMission';
import { GameState, type GameEvent } from './GameState';
import { ResourceManager } from './ResourceManager';

function setup() {
  const resources = new ResourceManager();
  const mission = new BombingMission();
  const state = new GameState(resources, mission);
  const events: GameEvent['type'][] = [];
  state.onEvent((e) => events.push(e.type));
  return { resources, mission, state, events };
}

describe('GameState', () => {
  it('starts at the desk with 100 paper and the T5 mission on offer', () => {
    const { state, resources, mission } = setup();
    expect(state.phase).toBe('desk');
    expect(resources.paper).toBe(100);
    expect(mission.title).toBe('Bomb Territory T5');
    expect(mission.reward).toBe(50);
    expect(mission.status).toBe('available');
  });

  it('folding costs 20 paper and only works at the desk', () => {
    const { state, resources } = setup();
    expect(state.foldPlane()).toBe(true);
    expect(resources.paper).toBe(80);
    expect(state.phase).toBe('ready');
    expect(state.foldPlane()).toBe(false); // already have a plane
    state.launch();
    expect(state.foldPlane()).toBe(false); // can't fold in the air
    expect(resources.paper).toBe(80);
    expect(state.stats.planesBuilt).toBe(1);
  });

  it('launching requires a folded plane and activates the mission', () => {
    const { state, mission } = setup();
    expect(state.launch()).toBe(false);
    state.foldPlane();
    expect(state.launch()).toBe(true);
    expect(state.phase).toBe('flying');
    expect(mission.status).toBe('active');
  });

  it('a hit on the target pays +50 exactly once (net +30 per successful sortie)', () => {
    const { state, resources, mission, events } = setup();
    state.foldPlane();
    state.launch();
    state.resolveBomb(true);
    expect(mission.status).toBe('succeeded');
    expect(resources.paper).toBe(130);
    state.resolveBomb(true);
    state.resolveBomb(false);
    expect(resources.paper).toBe(130);
    expect(mission.status).toBe('succeeded');
    expect(state.stats).toEqual({ planesBuilt: 1, successes: 1, failures: 0 });
    expect(events.filter((e) => e === 'mission-succeeded')).toHaveLength(1);
  });

  it('the player can keep flying after success, and crashing then keeps the reward', () => {
    const { state, resources, mission } = setup();
    state.foldPlane();
    state.launch();
    state.resolveBomb(true);
    expect(state.phase).toBe('flying');
    state.crash('impact');
    expect(state.phase).toBe('crashed');
    expect(mission.status).toBe('succeeded');
    expect(resources.paper).toBe(130);
    expect(state.stats.failures).toBe(0);
  });

  it('a miss fails the mission with no reward', () => {
    const { state, resources, mission } = setup();
    state.foldPlane();
    state.launch();
    state.resolveBomb(false);
    expect(mission.status).toBe('failed');
    expect(mission.failure).toBe('missed');
    expect(resources.paper).toBe(80);
    expect(state.stats.failures).toBe(1);
  });

  it('crashing loses the aircraft without a reward, and a late bomb cannot score', () => {
    const { state, resources, mission } = setup();
    state.foldPlane();
    state.launch();
    state.crash('void');
    expect(state.phase).toBe('crashed');
    expect(mission.status).toBe('failed');
    expect(mission.failure).toBe('aircraft-lost');
    state.resolveBomb(true); // a bomb released before the crash lands afterwards
    expect(resources.paper).toBe(80);
  });

  it('returning before success is a failure with +0, and the mission is offered again', () => {
    const { state, resources, mission } = setup();
    state.foldPlane();
    state.launch();
    expect(state.returnHome()).toBe(true);
    expect(state.phase).toBe('desk');
    expect(resources.paper).toBe(80);
    expect(mission.status).toBe('available');
    expect(state.stats.failures).toBe(1);
  });

  it('R after a crash returns to the desk without counting a second failure', () => {
    const { state } = setup();
    state.foldPlane();
    state.launch();
    state.crash('impact');
    expect(state.returnHome()).toBe(true);
    expect(state.phase).toBe('desk');
    expect(state.stats.failures).toBe(1);
  });

  it('the loop repeats without reloading', () => {
    const { state, resources } = setup();
    for (let i = 0; i < 3; i++) {
      expect(state.foldPlane()).toBe(true);
      state.launch();
      state.resolveBomb(true);
      state.returnHome();
    }
    expect(resources.paper).toBe(100 + 3 * 30);
    expect(state.stats).toEqual({ planesBuilt: 3, successes: 3, failures: 0 });
  });

  it('paper never goes negative: folding is refused below 20, and reset restores 100', () => {
    const { state, resources, events } = setup();
    let folds = 0;
    for (let i = 0; i < 10; i++) {
      if (state.foldPlane()) {
        folds++;
        state.launch();
        state.crash('void');
        state.returnHome();
      }
      expect(resources.paper).toBeGreaterThanOrEqual(0);
    }
    expect(folds).toBe(5);
    expect(resources.paper).toBe(0);
    expect(state.canFold()).toBe(false);
    expect(events).toContain('fold-refused');
    state.resetPaper();
    expect(resources.paper).toBe(100);
    expect(state.canFold()).toBe(true);
  });
});
