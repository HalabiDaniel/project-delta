import { describe, expect, it } from 'vitest';
import { deskStyle, type DeskStyle, type MapDeskState, type MapPresence } from './MiniMap';

const owner = (presence: MapPresence) => ({ colour: 'rgb(1, 2, 3)', presence });
/** Everything that tells desks apart except the fill colour. */
const shape = (s: DeskStyle) => JSON.stringify([s.fill === null, s.pattern, s.edge?.dash ?? null, s.ring, s.mark]);

describe('mini-map desk states', () => {
  it('each desk state has its own shape, not just its own colour', () => {
    const states: Array<[MapDeskState, ReturnType<typeof owner> | null]> = [['player', owner('online')], ['draining', owner('away')], ['empty', null], ['open', null], ['ai', null]];
    const styles = states.map(([desk, o]) => deskStyle({ role: 'neutral', desk, owner: o }));
    expect(styles.map((s) => s.fill)).toEqual(['owner', 'owner', null, 'paper-2', 'neutral']);
    expect(styles[1].pattern).toBe('hatch');
    expect(styles[2].edge).toEqual({ colour: 'ink-3', dash: true });
    expect(styles[3].mark).toBe('plus');
    // Player-held and AI-held share a solid fill shape; they differ by owner colour and the AI's threat edge.
    const shapes = new Set([styles[1], styles[2], styles[3], styles[0]].map(shape));
    expect(shapes.size).toBe(4);
  });

  it('presence on a player desk: away dashed, protected ringed, offline slashed', () => {
    const p = (presence: MapPresence) => deskStyle({ role: 'neutral', desk: 'player', owner: owner(presence) });
    expect(p('online')).toMatchObject({ edge: null, ring: false, mark: 'none' });
    expect(p('away').edge).toEqual({ colour: 'ink', dash: true });
    expect(p('protected').ring).toBe(true);
    expect(p('offline').mark).toBe('slash');
    expect(new Set((['online', 'away', 'protected', 'offline'] as const).map((x) => shape(p(x)))).size).toBe(4);
  });

  it('single-player roles keep their meaning colours, with a shape for home and done', () => {
    expect(deskStyle({ role: 'home' })).toMatchObject({ fill: 'friend', mark: 'home' });
    expect(deskStyle({ role: 'done' })).toMatchObject({ fill: 'good', mark: 'tick' });
    expect(deskStyle({ role: 'objective' }).fill).toBe('objective');
    expect(deskStyle({ role: 'neutral' }).fill).toBe('neutral');
    // A rival's desk that is a mission's target keeps the owner's colour (the pulse marks the objective).
    expect(deskStyle({ role: 'objective', desk: 'player', owner: owner('online') }).fill).toBe('owner');
    expect(deskStyle({ role: 'home', desk: 'player', owner: owner('protected') }).ring).toBe(true);
  });
});
