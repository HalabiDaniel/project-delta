import { describe, expect, it } from 'vitest';
import { BombingMission } from './BombingMission';

describe('BombingMission', () => {
  it('moves available → active → succeeded, once', () => {
    const m = new BombingMission();
    expect(m.succeed()).toBe(false); // not started
    expect(m.start()).toBe(true);
    expect(m.start()).toBe(false);
    expect(m.succeed()).toBe(true);
    expect(m.succeed()).toBe(false);
    expect(m.fail('missed')).toBe(false);
    expect(m.status).toBe('succeeded');
  });

  it('records why it failed and resets for the next sortie', () => {
    const m = new BombingMission();
    m.start();
    expect(m.fail('aircraft-lost')).toBe(true);
    expect(m.failure).toBe('aircraft-lost');
    m.reset();
    expect(m.status).toBe('available');
    expect(m.failure).toBeNull();
  });
});
