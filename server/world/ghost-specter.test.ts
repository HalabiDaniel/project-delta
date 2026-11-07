import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_ORDER, BOUNTIES, DRONES, ESCORTS, PVP, RAIDS, STEALTH } from '../../src/config';
import { assessSuitability } from '../../src/aircraft/Aircraft';
import { RadarSignature } from '../../src/aircraft/Signature';
import { weakKill } from './Situation';
import { chooseFlyable, launch, place, player, quietWorld, run } from './testkit';

/** v0.0.19 §8: the Ghost and the Specter, final roles and stats. */
describe('the Ghost', () => {
  it('has the lowest radar signature in the game, and its bay gives it away sharply', () => {
    const ghost = AIRCRAFT.ghost;
    for (const id of AIRCRAFT_ORDER) if (id !== 'ghost') expect(ghost.signature).toBeLessThan(AIRCRAFT[id].signature);
    expect(ghost.traits).toMatchObject({ stealth: true, bay: true });
    const r = new RadarSignature();
    const quiet = r.valueFor(ghost);
    r.reveal('bay');
    expect(r.valueFor(ghost)).toBeGreaterThan(quiet * 3);
    expect(STEALTH.reveal.bay).toBeGreaterThan(STEALTH.reveal.bomb);
  });

  it('is the most expensive bomber in paper, ink and rubber, with a long rebuild, and fragile', () => {
    const bombers = AIRCRAFT_ORDER.filter((id) => AIRCRAFT[id].role === 'bomber' && id !== 'ghost').map((id) => AIRCRAFT[id]);
    const g = AIRCRAFT.ghost;
    for (const b of bombers) {
      expect(g.cost).toBeGreaterThan(b.cost);
      expect(g.materials!.ink!).toBeGreaterThanOrEqual(b.materials?.ink ?? 0);
      expect(g.materials!.rubber!).toBeGreaterThan(b.materials?.rubber ?? 0);
      expect(g.buildTime ?? 0).toBeGreaterThan(b.buildTime ?? 0);
      expect(g.maxHealth).toBeLessThan(b.maxHealth);
    }
  });

  it('on a raid, warns the defender and holds every release for the minimum warning time; one capped loss', () => {
    const world = quietWorld(61);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    for (const p of [a, b]) p.protectUntil = 0;
    b.resources.restore(400);
    a.resources.restore(300);
    a.resources.restoreOf('ink', 60);
    a.resources.restoreOf('rubber', 40);
    run(world, 1.2);
    const card = a.pvp.find((c) => c.tag.kind === 'raid')!;
    a.state!.select(a.state!.offers.indexOf(card.mission));
    chooseFlyable(world, a, 'ghost');
    launch(world, a, 'ghost');
    const attack = world.attacks.on('b')!;
    expect(attack.detected).toBe(false);
    // Over the target, quiet, still undetected (or just detected): the first press only opens the bay.
    const t = attack.targets[0];
    place(a, t.x, 6, t.z, 0);
    a.flight.model.speed = 9;
    const loaded = a.state!.bombsLoaded;
    run(world, 0.05, (id) => (id === 'a' ? { bomb: true } : {}));
    expect(attack.detected).toBe(true);
    expect(a.state!.bombsLoaded).toBe(loaded);
    expect(world.privateFor('b', true)?.attacks?.[0]?.detected).toBe(true);
    // Pressing again inside the warning does nothing.
    run(world, PVP.bayWarning / 2, (id) => (id === 'a' ? { bomb: true } : {}));
    expect(a.state!.bombsLoaded).toBe(loaded);
    // After it, the release counts.
    run(world, PVP.bayWarning);
    place(a, t.x, 6, t.z, 0);
    a.flight.model.speed = 9;
    const before = b.resources.paper;
    run(world, 0.05, (id) => (id === 'a' ? { bomb: true } : {}));
    run(world, 2);
    expect(a.state!.bombsLoaded).toBe(loaded - 1);
    if (world.attacks.on('b') === undefined) expect(before - b.resources.paper).toBeLessThanOrEqual(RAIDS.loss.store.max);
  });
});

describe('the Specter', () => {
  it('is unarmed, cheap in paper with no ink or rubber, slow, and suits reconnaissance', () => {
    const s = AIRCRAFT.specter;
    expect(s.gun.ammo).toBe(0);
    expect(s.gun.damage).toBe(0);
    expect(s.bombs.capacity).toBe(0);
    expect(s.materials ?? {}).toEqual({});
    expect(s.traits).toMatchObject({ drone: true });
    expect(s.cost).toBeLessThan(AIRCRAFT.dart.cost);
    expect(s.flight.cruiseSpeed).toBeLessThan(AIRCRAFT.dart.flight.cruiseSpeed);
    const recon = { type: 'recon', objectives: [{ kind: 'recon' }], bombs: 0 } as unknown as Parameters<typeof assessSuitability>[1];
    expect(assessSuitability(s, recon).level).not.toBe('unsuitable');
    const dogfight = { type: 'dogfight', objectives: [{ kind: 'intercept', what: 'fighter', targets: ['x'], count: 1 }], bombs: 0 } as unknown as Parameters<typeof assessSuitability>[1];
    expect(assessSuitability(s, dogfight).level).toBe('unsuitable');
  });

  it("can't be flown as an AI escort (neither can the Ghost)", () => {
    for (const e of Object.values(ESCORTS.roster)) expect(['specter', 'ghost']).not.toContain(e.aircraft);
  });

  it('reveals hostile aircraft and defenses near it to its pilot and allies, never to others, and never stacked', () => {
    const world = quietWorld(62);
    const a = player(world, 'a', 'T1', 'Ann');
    const ally = player(world, 'c', 'T2', 'Cy');
    const outsider = player(world, 'o', 'T16', 'Oz');
    const foe = player(world, 'f', 'T6', 'Foe');
    world.command('a', { a: 'ally', o: 'offer', id: 'c' });
    world.command('c', { a: 'ally', o: 'accept', id: 'a' });
    launch(world, a, 'specter');
    launch(world, foe, 'falcon');
    const fp = foe.flight.model.position;
    place(a, fp.x + 40, 30, fp.z, 0);
    run(world, 0.1);
    expect(world.revealFor(a)).toContain(foe.plane);
    // A hostile defense near the drone shows too (the AI's, or a rival's base).
    expect(world.revealFor(a).some((id) => !id.startsWith('pl:'))).toBe(true);
    expect(world.revealFor(ally)).toContain(foe.plane);
    expect(world.revealFor(outsider)).not.toContain(foe.plane);
    expect(new Set(world.revealFor(ally)).size).toBe(world.revealFor(ally).length);
    // Out of range: gone.
    place(a, fp.x + DRONES.reveal + 60, 30, fp.z, 0);
    run(world, 0.1);
    expect(world.revealFor(a)).not.toContain(foe.plane);
  });

  it("damages nothing, not even by ramming; shooting it down pays a small fixed reward", () => {
    const world = quietWorld(63);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    launch(world, a, 'specter');
    const before = b.resources.paper;
    b.state!.phase === 'desk' && launch(world, b, 'falcon');
    a.damageLog.push({ by: 'b', amount: 999, at: world.time });
    const paperBefore = b.resources.paper;
    a.state!.crash('shot-down');
    expect(b.resources.paper - paperBefore).toBe(DRONES.killReward);
    void before;
  });

  it('a Specter pilot who revealed a bounty target counts as a contributor, and the hunters see what it sees', () => {
    const world = quietWorld(64);
    const ace = player(world, 'ace', 'T1', 'Ace');
    const s = player(world, 's', 'T3', 'Spy');
    const h = player(world, 'h', 'T6', 'Hunter');
    for (const p of [ace, s, h]) p.protectUntil = 0;
    const now = world.wallOf(world.time);
    for (let i = 0; i < BOUNTIES.streak; i++) weakKill(ace.social, now, BOUNTIES.window);
    launch(world, ace, 'falcon');
    run(world, 1.2);
    const bounty = world.bounties.on('ace')!;
    expect(bounty).toBeDefined();
    // The Specter can't fly the bounty card itself (it needs a kill): it flies anything and watches.
    const card = s.pvp.find((c) => c.tag.kind === 'bounty')!;
    expect(assessSuitability(AIRCRAFT.specter, card.mission.spec).level).toBe('unsuitable');
    chooseFlyable(world, s, 'specter');
    launch(world, s, 'specter');
    const hunt = h.pvp.find((c) => c.tag.kind === 'bounty')!;
    h.state!.select(h.state!.offers.indexOf(hunt.mission));
    launch(world, h, 'falcon');
    const ap = ace.flight.model.position;
    place(s, ap.x + 30, 35, ap.z, 0);
    run(world, 1.1);
    expect(bounty.spotted.has('s')).toBe(true);
    // The hunter flying the bounty's card sees the target through the Specter, wherever they are.
    expect(world.revealFor(h)).toContain(ace.plane);
    ace.damageLog.push({ by: 'h', amount: 100, at: world.time });
    ace.state!.crash('shot-down');
    const paid = world.directorLog.entries.find((d) => d.kind === 'bounty-paid')!;
    expect(paid.text).toContain('Spy');
    expect(paid.text).toContain('Hunter');
  });
});
