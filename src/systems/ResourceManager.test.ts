import { describe, expect, it } from 'vitest';
import { ResourceManager } from './ResourceManager';

describe('ResourceManager', () => {
  it('starts with 100 paper', () => {
    expect(new ResourceManager().paper).toBe(100);
  });

  it('spends and earns', () => {
    const r = new ResourceManager();
    expect(r.spend(20)).toBe(true);
    r.earn(50);
    expect(r.paper).toBe(130);
  });

  it('refuses a purchase it cannot afford and leaves the balance untouched', () => {
    const r = new ResourceManager(15);
    expect(r.canAfford(20)).toBe(false);
    expect(r.spend(20)).toBe(false);
    expect(r.paper).toBe(15);
  });

  it('rejects negative or fractional amounts', () => {
    const r = new ResourceManager();
    expect(() => r.spend(-5)).toThrow(RangeError);
    expect(() => r.earn(-5)).toThrow(RangeError);
    expect(() => r.earn(1.5)).toThrow(RangeError);
    expect(r.paper).toBe(100);
  });

  it('reset restores the starting balance', () => {
    const r = new ResourceManager();
    r.spend(100);
    r.reset();
    expect(r.paper).toBe(100);
  });

  it('notifies listeners with the change and where it came from', () => {
    const r = new ResourceManager();
    const changes: string[] = [];
    r.onChange((_paper, delta, source) => changes.push(`${delta}:${source}`));
    r.spend(20);
    r.earn(50);
    r.earn(1, 'income');
    r.spend(500); // refused: no notification
    r.reset();
    expect(changes).toEqual(['-20:spend', '50:reward', '1:income', '-31:reset']);
  });
});
