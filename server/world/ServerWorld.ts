import { Vec3 } from 'playcanvas';
import type { Collision } from '../../src/aircraft/FlightModel';
import { PLANE_SHAPES } from '../../src/aircraft/PlaneShapes';
import { assessSuitability } from '../../src/aircraft/Aircraft';
import type { ZoneRef } from '../../src/aircraft/Bomb';
import type { AiOrders, Contact } from '../../src/ai/AiAircraft';
import { AirTraffic, type AirEvent, type AirSpawn } from '../../src/ai/AirTraffic';
import { Base, STORE, type BaseEvent } from '../../src/base/Base';
import { chooseRaidTarget } from '../../src/base/Raids';
import { distanceToShape, footprint, type Collider } from '../../src/combat/Collision';
import { blastDamage, impactDamage, roughLandingDamage, type DamageSource } from '../../src/combat/Damage';
import { isRocket, Ordnance, type AircraftTarget, type FireEvent, type Shot } from '../../src/combat/Ordnance';
import { AI, AIRCRAFT, AIRCRAFT_ORDER, BASE, BOMB, DEFENSES, PLAYER_ID, PVP, RAIDS, THREAT, WEAPONS, type AircraftId, type Side } from '../../src/config';
import { MissionDirector, type Situation } from '../../src/director/MissionDirector';
import { DefenseNetwork, type DefenseEvent, type Installation, type Target } from '../../src/defenses/Installation';
import { overHome } from '../../src/defenses/Layout';
import { Mission, type MissionSpec, type Point3 } from '../../src/missions/Mission';
import type { MissionContext } from '../../src/missions/MissionGenerator';
import {
  NET,
  NEUTRAL_FRAME,
  planeOwner,
  type AttackDTO,
  type CardDTO,
  type Command,
  type Emote,
  type InputFrame,
  type MeDTO,
  type NetEvent,
  type OwnFlight,
  type Weapon,
} from '../../src/net/protocol';
import { ownerOfSide, sharedWorld, territoryName, type SharedWorld } from '../../src/net/World';
import type { GameEvent } from '../../src/systems/GameState';
import { GameState } from '../../src/systems/GameState';
import { seededRng, type Rng } from '../../src/systems/Random';
import { launchPoint } from '../../src/world/Grid';
import { Territory } from '../../src/world/Territory';
import { AttackBook, creditFor, KillBook, type Attack } from './Attacks';
import { FallingBombs, type Landing } from './FallingBombs';
import { History } from './History';
import { Pilot } from './Pilot';
import { PlayerGuns, type Hittable, type RoundImpact } from './PlayerGuns';
import { huntMission, interceptMission, raidMission, reconMission } from './PvpMissions';

export interface ServerWorldOptions {
  /** Seeds every random choice (missions, AI), for repeatable tests. */
  seed?: number;
  /** Ambient AI patrols over unclaimed territory (tests turn them off). */
  ambient?: boolean;
  /** Seconds of new-player protection (default PVP.newPlayerProtection; lower it to test raids alone). */
  newPlayerProtection?: number;
}

/** An event to send: to one player, to everyone but one, or to everyone. */
export interface Outgoing {
  to?: string;
  except?: string;
  e: NetEvent;
}

/** Player rounds get ids well clear of the AI ordnance's, so clients can keep both in one map. */
const ROUND_ID_OFFSET = 1_000_000;
/** The sortie report waits this long after a crash (as single-player). */
const CRASH_REPORT_DELAY = 1.2;
/** AI aircraft only appear and vanish this far from every player's plane. */
const SIGHT = 140;
/** PvP cards are reconsidered this often (seconds). */
const PVP_REFRESH = 1;
/** Without a radar, a base notices a raider this close (beyond its platform). */
const LOOKOUT_RANGE = 45;

/**
 * The authoritative classroom: every player's flight, every round, bomb and rocket, the AI in the
 * air and on the ground, every base and every mission. It has nothing to do with networking (the
 * Colyseus room in WorldRoom.ts feeds it frames and commands and sends out what it reports), so
 * tests drive it directly.
 *
 * Almost all of the rules are single-player's own classes: each player has a GameState, a Base, a
 * ResourceManager and a MissionDirector, exactly as single-player's T1 does; the defenses, the
 * ordnance and the AI pilots are shared by everyone. What this class adds is the multiplayer
 * part: whose plane is whose, who may shoot at whom, raids between players and what they cost,
 * kills and assists, and what each player is told.
 */
export class ServerWorld {
  time = 0;
  tick = 0;
  readonly shared: SharedWorld;
  readonly territories: Territory[];
  readonly network: DefenseNetwork;
  readonly air: AirTraffic;
  readonly ordnance = new Ordnance();
  readonly guns = new PlayerGuns();
  readonly bombs = new FallingBombs();
  readonly history = new History();
  readonly attacks = new AttackBook();
  readonly kills = new KillBook();
  readonly pilots = new Map<string, Pilot>();
  /** Territory id → the player who claimed it. */
  readonly owners = new Map<string, string>();
  readonly events: Outgoing[] = [];
  /** Timing of the last steps, for the load test and the server log. */
  readonly perf = { steps: 0, totalMs: 0, maxMs: 0 };
  private readonly rng: Rng;
  private readonly seed: number;
  /** Wrecked AI installations and when they stand up again. */
  private readonly aiWrecks = new Map<string, number>();
  private readonly missionKeys = new WeakMap<Mission, string>();
  private keySerial = 0;
  private solidsCache: Collider[] | null = null;
  private pvpTimer = 0;
  private readonly v1 = new Vec3();
  private readonly v2 = new Vec3();

  private readonly protection: number;

  constructor(options: ServerWorldOptions = {}) {
    this.protection = options.newPlayerProtection ?? PVP.newPlayerProtection;
    this.seed = options.seed ?? Math.floor(Math.random() * 1e9);
    this.rng = seededRng(this.seed);
    this.shared = sharedWorld();
    this.territories = this.shared.territories;
    this.network = new DefenseNetwork(this.shared.layout.installations, this.rng);
    // The traffic's own "home" is only used for single-player's raids, which multiplayer doesn't
    // send: give it one far outside the world, and the real homes through AirInput.homes.
    const nowhere = new Territory('none', 1e5, 1e5, 1, null);
    this.air = new AirTraffic(this.territories, nowhere, () => ({ territoryId: 'none', x: 1e5, y: 0, z: 1e5, radius: 1 }), this.rng, options.ambient ?? true);
    // Mission aircraft that get away count as escaped (AirTraffic only reports that while a mission is on).
    this.air.startMission([]);
  }

  // ---- Players ----------------------------------------------------------------------------------

  /** A player entered the session (they still have to claim a territory). */
  join(id: string, name: string): Pilot {
    const used = new Set([...this.pilots.values()].map((p) => p.colour));
    let colour = 0;
    while (used.has(colour)) colour++;
    const pilot = new Pilot(id, name, colour, this.time);
    this.pilots.set(id, pilot);
    this.news(`${name} joined`, 'info');
    return pilot;
  }

  /** Claims `territoryId` as `id`'s home. Returns null, or why it can't be claimed. */
  claim(id: string, territoryId: string): string | null {
    const p = this.pilots.get(id);
    if (!p) return 'unknown player';
    if (p.home) return 'already claimed';
    const t = this.territories.find((x) => x.id === territoryId);
    if (!t || !this.shared.claimable.includes(territoryId)) return 'not claimable';
    if (this.owners.has(territoryId)) return 'taken';
    this.owners.set(territoryId, id);
    p.home = t;
    // The AI's defenses make way for the player's base.
    t.threat = 0;
    for (const spec of this.shared.layout.installations) {
      if (spec.territoryId !== territoryId) continue;
      this.network.remove(spec.id);
      this.aiWrecks.delete(spec.id);
    }
    const base = new Base(t, this.network, p.resources, p.side);
    base.startFresh();
    p.base = base;
    p.resources.capacity = base.capacity;
    const director = new MissionDirector(() => this.missionContext(p), () => this.situation(p), seededRng(this.seed + this.pilots.size * 7919 + this.keySerial));
    p.director = director;
    director.deal();
    const state = new GameState(p.resources, () => p.cards());
    p.state = state;
    state.onEvent((e) => this.onGameEvent(p, e));
    base.onEvent((e) => this.onBaseEvent(p, e));
    p.protectUntil = this.time + this.protection;
    p.flight.model.hide();
    this.solidsCache = null;
    this.news(`${p.name} claimed ${territoryName(territoryId)}`, 'good');
    return null;
  }

  /** The player's connection dropped (their territory and plane wait for them) or came back. */
  setConnected(id: string, connected: boolean): void {
    const p = this.pilots.get(id);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    p.droppedAt = this.time;
    this.news(connected ? `${p.name} is back` : `${p.name} lost connection`, connected ? 'good' : 'bad');
    // A raid on someone who went offline is called off: nobody has to defend while away.
    if (!connected) {
      const attack = this.attacks.on(id);
      if (attack) this.endAttack(attack, 'abandoned');
    }
  }

  /**
   * The player is gone for good: their plane vanishes, their base comes down and the AI's
   * defenses return to the territory, which can be claimed again.
   */
  remove(id: string): void {
    const p = this.pilots.get(id);
    if (!p) return;
    // Leaving mid-flight counts as going down: whoever hurt the plane lately gets the kill
    // (quitting can't save a lost fight), and a raid in progress fails.
    if (p.state?.phase === 'flying') p.state.crash(p.damageLog.length > 0 ? 'shot-down' : 'impact');
    for (const attack of [...this.attacks.active]) if (attack.attacker === id || attack.victim === id) this.endAttack(attack, 'abandoned');
    this.endMissionAi(p);
    this.guns.clear(id);
    this.bombs.clear(id);
    this.history.forget(p.plane);
    if (p.home && p.base) {
      const t = p.home;
      for (const key of [...p.base.buildings.keys()]) this.network.remove(p.base.idOf(key));
      this.network.remove(p.base.idOf(STORE));
      t.threat = THREAT.map[t.id] ?? 0;
      for (const spec of this.shared.layout.installations) if (spec.territoryId === t.id) this.network.add(spec);
      this.owners.delete(t.id);
      this.news(`${territoryName(t.id)} is free`, 'info');
    }
    this.pilots.delete(id);
    this.solidsCache = null;
    this.news(`${p.name} left`, 'info');
  }

  /** Input frames from the player's game. */
  input(id: string, frames: readonly InputFrame[]): void {
    this.pilots.get(id)?.inputs.receive(frames);
  }

  setRtt(id: string, seconds: number): void {
    const p = this.pilots.get(id);
    if (p) p.rtt = Math.max(0, Math.min(1, seconds));
  }

  emote(id: string, emote: Emote): boolean {
    const p = this.pilots.get(id);
    if (!p || this.time - p.emoteAt < NET.emoteCooldown) return false;
    const status = p.flight.model.status;
    if (status === 'hidden' || status === 'crashed') return false;
    p.emoteAt = this.time;
    this.emit({ t: 'emote', o: id, e: emote });
    return true;
  }

  // ---- Commands ---------------------------------------------------------------------------------

  /** A player's command. Returns whether the rules allowed it. */
  command(id: string, cmd: Command): boolean {
    const p = this.pilots.get(id);
    const st = p?.state;
    if (!p || !st || !p.base || !p.director || !p.home) return false;
    if (p.commandTokens <= 0) return false;
    p.commandTokens--;
    switch (cmd.a) {
      case 'select':
        return st.select(cmd.i);
      case 'aircraft':
        if (st.phase === 'building') return false;
        return st.selectAircraft(cmd.id);
      case 'build': {
        const emergency = st.emergencyAvailable() && !st.resources.canAfford(st.buildCost);
        return emergency ? st.buildEmergency() : st.build();
      }
      case 'launch': {
        const card = p.pvpCard(st.selectedMission);
        if (card && !this.pvpStillValid(p, card.tag)) {
          this.note(p, 'close', 'Card gone', null, 'bad');
          this.refreshPvp(p, true);
          return false;
        }
        return st.launch();
      }
      case 'rearm':
        if (st.phase !== 'landed' || !p.stopped) return false;
        if (!st.rearm()) {
          if (st.rearmProgress === null) this.note(p, 'rearm', 'Full', null, 'info');
          return false;
        }
        return true;
      case 'takeoff':
        if (st.phase !== 'landed' || !p.stopped) return false;
        return st.takeOff();
      case 'end':
        if (st.phase !== 'landed' || !p.stopped) return false;
        return st.endSortie();
      case 'continue':
        if (st.phase !== 'debrief' && st.phase !== 'crashed') return false;
        if (st.phase === 'crashed' && this.time - p.crashedAt < CRASH_REPORT_DELAY) return false;
        p.director.validate();
        this.refreshPvp(p, false);
        return st.continueToDesk();
      case 'swap': {
        if (st.phase !== 'desk' && st.phase !== 'building' && st.phase !== 'ready') return false;
        const director = p.director;
        if (st.selected >= director.offers.length || !director.canSwap(st.selected)) {
          this.note(p, 'swap', director.swaps <= 0 ? 'No swaps' : 'No swap', null, 'info');
          return false;
        }
        const mission = director.swap(st.selected);
        if (!mission) return false;
        st.updateOffers(p.cards());
        st.select(p.cards().indexOf(mission));
        this.note(p, 'swap', 'Swapped', `${director.swaps}`, 'info');
        return true;
      }
      case 'base-build':
      case 'base-upgrade':
      case 'base-repair':
      case 'base-repair-all':
      case 'base-remove': {
        if (!p.atHome) {
          this.note(p, 'home', 'Land first', null, 'info');
          return false;
        }
        const base = p.base;
        const ok =
          cmd.a === 'base-build' ? base.build(cmd.slot, cmd.kind)
          : cmd.a === 'base-upgrade' ? base.upgrade(cmd.slot)
          : cmd.a === 'base-repair' ? base.repair(cmd.key)
          : cmd.a === 'base-repair-all' ? base.repairAll()
          : base.remove(cmd.slot);
        this.solidsCache = null;
        return ok;
      }
    }
  }

  // ---- The step ---------------------------------------------------------------------------------

  /** One fixed step of the whole world (NET.step seconds of real time). */
  step(dt: number = NET.step): void {
    const started = performance.now();
    this.time += dt;
    this.tick++;
    this.solidsCache = null;
    for (const p of this.pilots.values()) {
      p.commandTokens = Math.min(NET.commandsPerSecond, p.commandTokens + NET.commandsPerSecond * dt);
      for (const frame of p.inputs.advance(dt)) this.stepPilot(p, frame);
      this.scheduleSpawns(p, dt);
    }
    this.updateAir(dt);
    this.updateDefenses(dt);
    this.recordHistory();
    this.updateOrdnance(dt);
    this.updateGuns(dt);
    this.updateBombs(dt);
    this.updateAttacks();
    this.rebuildAi();
    this.pvpTimer -= dt;
    if (this.pvpTimer <= 0) {
      this.pvpTimer = PVP_REFRESH;
      for (const p of this.pilots.values()) this.refreshPvp(p, false);
    }
    const ms = performance.now() - started;
    this.perf.steps++;
    this.perf.totalMs += ms;
    this.perf.maxMs = Math.max(this.perf.maxMs, ms);
  }

  /** Events since the last call. */
  drainEvents(): Outgoing[] {
    return this.events.splice(0);
  }

  // ---- A player's step --------------------------------------------------------------------------

  /** One step of a player's own clock: their economy, their plane on the pad, in the air or on the runway. */
  private stepPilot(p: Pilot, frame: InputFrame | null): void {
    const st = p.state;
    const base = p.base;
    const home = p.home;
    if (!st || !base || !home) return;
    const f = frame ?? NEUTRAL_FRAME;
    // Their buildings set how fast paper comes in and how much the store holds.
    st.income.perMinute = base.production;
    st.income.capacity = base.capacity;
    p.resources.capacity = base.capacity;
    st.tick(NET.step);
    base.recordIncome(st.income.lastPaid);
    const m = p.flight.model;
    if (st.phase === 'flying' && m.status === 'flying') {
      const result = p.flight.step(f, home, this.territories, this.solids(), st.outOfRange);
      if (!result) return;
      for (const c of result.collisions) {
        this.pilotCollision(p, c);
        if (st.phase !== 'flying') return;
      }
      switch (result.outcome) {
        case 'flying':
          st.updateFlight(m.prevPosition, m.position, NET.step);
          if (st.phase !== 'flying') return;
          if (f.fire) this.pilotFire(p);
          if (f.bomb) this.pilotBomb(p);
          break;
        case 'touchdown':
          p.stopped = false;
          st.land(home.id);
          break;
        case 'void':
          st.crash('void');
          break;
      }
    } else if (m.status === 'rolling') {
      p.flight.step(f, home, this.territories, this.solids(), false);
      if ((m.status as string) === 'stopped') p.stopped = true;
    }
  }

  /** Flew into something: what it costs depends on how hard (as single-player). */
  private pilotCollision(p: Pilot, c: Collision): void {
    const st = p.state!;
    let damage = c.kind === 'rough-landing' ? roughLandingDamage(c.state) : impactDamage(c.closing);
    if (c.kind === 'object') {
      const installation = this.network.get(c.id);
      damage = Math.round(damage * (installation ? DEFENSES.hardness[installation.spec.kind] : DEFENSES.hardness.barrier));
      const ram = Math.round(impactDamage(c.closing) * DAMAGE_RAM);
      if (installation && ram > 0 && this.mayDamage(p, installation)) this.damageInstallation(installation, ram, p, 'ram');
    }
    if (damage <= 0) return;
    this.hurtPilot(p, damage, c.kind === 'rough-landing' ? 'landing' : 'impact', 'crash', null, p.flight.model.position);
    if (st.phase === 'flying' && c.kind === 'rough-landing') this.note(p, 'land', 'Rough landing', null, 'bad');
  }

  /** One round from the next barrel, towards where the guns converge (as single-player). */
  private pilotFire(p: Pilot): void {
    const st = p.state!;
    const barrel = st.fire();
    if (barrel === null) return;
    const spec = st.plane!;
    const m = p.flight.model;
    const muzzles = PLANE_SHAPES[spec.id].muzzles;
    const [lx, ly, lz] = muzzles[barrel % muzzles.length];
    const muzzle = m.toWorld(lx, ly, lz, { x: 0, y: 0, z: 0 });
    const aim = m.getForward(this.v1).mulScalar(WEAPONS.convergence).add(m.position);
    const dir = this.v2.set(aim.x - muzzle.x, aim.y - muzzle.y, aim.z - muzzle.z).normalize().mulScalar(spec.gun.speed);
    const vel = m.getVelocity(this.v1).add(dir);
    const round = this.guns.fire({
      owner: p.id, side: p.side, x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: vel.x, vy: vel.y, vz: vel.z,
      damage: spec.gun.damage, range: spec.gun.range,
      rewind: Math.min(NET.maxRewind, p.rtt / 2 + NET.interpolationDelay),
    });
    this.emit({ t: 'shot', id: ROUND_ID_OFFSET + round.id, k: 'ink', p: v3(muzzle), v: v3(vel), side: p.side, tg: null, o: p.id, r: WEAPONS.projectileRadius, tr: spec.gun.range }, { except: p.id });
  }

  private pilotBomb(p: Pilot): void {
    const st = p.state!;
    if (!st.dropBomb()) return;
    const spec = st.plane!;
    const m = p.flight.model;
    const slots = PLANE_SHAPES[spec.id].bombSlots;
    const [lx, ly, lz] = slots[Math.min(st.bombsLoaded, slots.length - 1)];
    const at = m.toWorld(lx, ly, lz, { x: 0, y: 0, z: 0 });
    const v = m.getVelocity(this.v1);
    this.bombs.release({ owner: p.id, tag: null, strike: null, side: p.side, kind: spec.bombs.kind, clean: st.releaseClean, x: at.x, y: at.y, z: at.z, vx: v.x, vy: v.y, vz: v.z });
    this.emit({ t: 'drop', o: p.id, p: v3(at), v: v3(v), kind: spec.bombs.kind }, { except: p.id });
  }

  /**
   * Damage to a player's plane. `by`: the player behind it (their guns, their base's guns), for
   * kill credit. Nothing happens to a plane that has only just taken off.
   */
  private hurtPilot(p: Pilot, amount: number, source: DamageSource, weapon: Weapon, by: { player: string | null; name: string } | null, at: Point3): number {
    const st = p.state;
    if (!st || st.phase !== 'flying' || amount <= 0) return 0;
    if (by?.player && this.immune(p)) return 0;
    p.lastWeapon = weapon;
    if (by?.player) {
      p.damageLog.push({ by: by.player, amount: Math.round(amount), at: this.time });
      this.pilots.get(by.player)?.aggression.set(p.id, this.time);
    }
    const { dealt, destroyed } = st.damageAircraft(amount, source, by?.name ?? null);
    if (dealt <= 0) return 0;
    if (!destroyed && st.durability) p.flight.model.setHealth(st.durability.fraction);
    this.emit({ t: 'dmg', tg: p.plane, n: dealt, p: v3(at), by: by?.player ?? undefined, fatal: destroyed, k: weapon });
    return dealt;
  }

  /** Just took off: nobody can hurt the plane yet (no spawn camping). */
  private immune(p: Pilot): boolean {
    return this.time - p.launchedAt < AI.launchShield * 0.5;
  }

  /** Over its own home or just took off: the AI and AI defenses hold their fire (as single-player). */
  private shielded(p: Pilot): boolean {
    const pos = p.flight.model.position;
    return (!!p.home && overHome(p.home, pos.x, pos.z)) || p.flight.model.airborneFor < AI.launchShield;
  }

  // ---- Missions' aircraft -----------------------------------------------------------------------

  /** A mission's AI aircraft go up when their moment comes (each player's mission on its own clock). */
  private scheduleSpawns(p: Pilot, dt: number): void {
    const mission = p.state?.mission;
    if (p.spawns.length === 0 || !mission?.isActive) return;
    p.missionTime += dt;
    for (let i = p.spawns.length - 1; i >= 0; i--) {
      const s = p.spawns[i];
      const due = s.afterPatrol !== undefined ? mission.patrolProgress >= s.afterPatrol : p.missionTime >= (s.delay ?? 0);
      if (!due) continue;
      p.spawns.splice(i, 1);
      if (s.raid && s.orders.role === 'bomber') {
        const escorts = p.spawns.filter((e) => e.orders.escort === s.orders.id);
        for (const e of escorts) p.spawns.splice(p.spawns.indexOf(e), 1);
        const r0 = s.orders.route[0];
        const origin = this.territories.reduce((best, t) => (Math.hypot(t.x - r0.x, t.z - r0.z) < Math.hypot(best.x - r0.x, best.z - r0.z) ? t : best));
        this.air.startMissionRaid([s.orders, ...escorts.map((e) => e.orders)], origin.id);
        i = p.spawns.length;
      } else {
        this.air.spawn(s.orders);
      }
    }
  }

  /** The mission's aircraft head home (it is over), and none still to come go up. */
  private endMissionAi(p: Pilot): void {
    p.spawns = [];
    const prefix = `${p.id}/`;
    for (const a of this.air.aircraft) if (a.id.startsWith(prefix) && a.purpose === 'mission') a.leave();
  }

  /** A mission's aircraft orders, renamed so two players' missions never share an id. */
  private prefixed(p: Pilot, spawn: AirSpawn): AirSpawn {
    const id = (x: string) => (x === PLAYER_ID ? p.plane : `${p.id}/${x}`);
    const o = spawn.orders;
    const orders: AiOrders = {
      ...o,
      id: id(o.id),
      side: o.side === 'player' ? p.side : o.side,
      escort: o.escort ? id(o.escort) : undefined,
      prey: o.prey ? id(o.prey) : undefined,
    };
    return { ...spawn, orders };
  }

  /** The player whose mission an AI aircraft belongs to, and its id in that mission. */
  private missionOwner(aiId: string): { pilot: Pilot; id: string } | null {
    const slash = aiId.indexOf('/');
    if (slash < 0) return null;
    const pilot = this.pilots.get(aiId.slice(0, slash));
    return pilot ? { pilot, id: aiId.slice(slash + 1) } : null;
  }

  // ---- The air ------------------------------------------------------------------------------------

  private contacts(): Contact[] {
    const out: Contact[] = [];
    for (const p of this.pilots.values()) {
      if (!p.flying) continue;
      const m = p.flight.model;
      const v = m.getVelocity(this.v1);
      out.push({
        id: p.plane, side: p.side, x: m.position.x, y: m.position.y, z: m.position.z, vx: v.x, vy: v.y, vz: v.z,
        signature: m.spec.signature, radius: m.spec.hitRadius, shielded: this.shielded(p), role: 'player',
      });
    }
    return out;
  }

  private updateAir(dt: number): void {
    const homes = [...this.pilots.values()].map((p) => p.home).filter((h): h is Territory => !!h);
    const out = this.air.update(dt, {
      territories: this.territories,
      obstacles: this.solids(),
      player: null,
      players: this.contacts(),
      homes,
      visible: (q) => this.seen(q),
      raids: false,
      patrol: 0,
    });
    for (const shot of out.shots) this.spawnShot(this.ordnance.spawn(shot));
    for (const bomb of out.bombs) {
      this.bombs.release({ owner: null, tag: bomb.source, strike: bomb.strike, side: bomb.side, kind: 'standard', clean: true, x: bomb.x, y: bomb.y, z: bomb.z, vx: bomb.vx, vy: bomb.vy, vz: bomb.vz });
      this.emit({ t: 'drop', o: bomb.source, p: v3(bomb), v: [bomb.vx, bomb.vy, bomb.vz], kind: 'standard' });
    }
    for (const e of out.events) this.onAirEvent(e);
  }

  /** Could any player see this point? AI aircraft only appear and vanish where nobody can. */
  private seen(q: Point3): boolean {
    for (const p of this.pilots.values()) {
      const s = p.flight.model.status;
      if (s === 'hidden' || s === 'crashed') continue;
      const pos = p.flight.model.position;
      if (Math.hypot(q.x - pos.x, q.y - pos.y, q.z - pos.z) < SIGHT) return true;
    }
    return false;
  }

  private onAirEvent(e: AirEvent): void {
    switch (e.type) {
      case 'destroyed': {
        const a = e.aircraft;
        const v = a.model.getVelocity(this.v1);
        this.emit({ t: 'down', id: a.id, p: v3(a.position), v: v3(v), kind: a.spec.id, side: a.side });
        this.history.forget(a.id);
        const shooter = e.by ? (this.pilotOfPlane(e.by) ?? this.ownerOfInstallation(e.by)) : null;
        const owner = this.missionOwner(a.id);
        // The mission it belongs to counts it whoever finished it; the shooter gets the credit.
        if (owner && owner.pilot !== shooter) owner.pilot.state?.aircraftDestroyed(owner.id, a.role, false);
        if (shooter?.state) {
          shooter.state.aircraftDestroyed(owner?.pilot === shooter ? owner.id : a.id, a.role, true);
          if (a.side === 'enemy' && this.pilotOfPlane(e.by ?? '') === shooter) {
            this.emit({ t: 'kill', killer: shooter.id, killerName: shooter.name, victim: '', victimName: `${a.side === 'enemy' ? 'enemy' : 'friendly'} ${a.spec.name}`, weapon: 'ink', assists: [], bomber: a.role === 'bomber' });
          }
        }
        break;
      }
      case 'released': {
        const owner = this.missionOwner(e.aircraft.id);
        owner?.pilot.state?.bombReleased(owner.id);
        break;
      }
      case 'escaped': {
        const owner = this.missionOwner(e.aircraft.id);
        owner?.pilot.state?.aircraftEscaped(owner.id);
        break;
      }
      default:
        break;
    }
  }

  // ---- Defenses -----------------------------------------------------------------------------------

  private updateDefenses(dt: number): void {
    const targets: Target[] = [];
    for (const p of this.pilots.values()) {
      if (!p.flying) continue;
      const m = p.flight.model;
      // Nothing shoots at a plane over its own home (as single-player).
      if (p.home && overHome(p.home, m.position.x, m.position.z)) continue;
      const v = m.getVelocity(this.v1);
      targets.push({ id: p.plane, side: p.side, x: m.position.x, y: m.position.y, z: m.position.z, vx: v.x, vy: v.y, vz: v.z, signature: m.spec.signature, role: 'player' });
    }
    for (const a of this.air.aircraft) {
      if (!a.alive) continue;
      const c = a.contact();
      targets.push({ id: c.id, side: c.side, x: c.x, y: c.y, z: c.z, vx: c.vx, vy: c.vy, vz: c.vz, signature: c.signature, role: a.role });
    }
    const { orders, events } = this.network.update(dt, targets, (i, t) => this.hostile(i, t));
    for (const order of orders) this.spawnShot(this.ordnance.spawn(order));
    for (const event of events) this.onDefenseEvent(event);
  }

  /**
   * May installation `i` engage aircraft `t`? The AI's engage everyone. A player's base engages
   * the AI's aircraft, and another player only if that player is raiding it, has hurt its owner
   * lately, or is flying over its territory.
   */
  hostile(i: Installation, t: Pick<Target, 'side' | 'x' | 'z'>): boolean {
    const owner = ownerOfSide(i.side);
    if (!owner) return true;
    const intruder = ownerOfSide(t.side);
    if (!intruder) return true;
    if (this.attacks.on(owner)?.attacker === intruder) return true;
    const hurt = this.pilots.get(intruder)?.aggression.get(owner);
    if (hurt !== undefined && this.time - hurt < PVP.aggression) return true;
    const home = this.pilots.get(owner)?.home;
    return !!home && home.containsXZ(t.x, t.z, PVP.airspace);
  }

  private onDefenseEvent(e: DefenseEvent): void {
    if (e.type === 'spotted') {
      const owner = this.owners.get(e.territoryId);
      const attack = owner ? this.attacks.on(owner) : undefined;
      if (attack && !attack.detected && this.pilotOfPlane(e.target)?.id === attack.attacker) this.detect(attack, e.by === 'radar' ? 'Radar' : 'Spotted');
      return;
    }
    const target = this.pilotOfPlane('target' in e ? e.target : '');
    if (!target) return;
    if (e.type === 'lock') this.note(target, 'launcher', 'Locked on', null, 'bad');
    else if (e.type === 'lock-broken') this.note(target, 'launcher', 'Lock broken', null, 'good');
  }

  // ---- Rounds and rockets -------------------------------------------------------------------------

  private spawnShot(shot: Shot): void {
    const target = shot.target ? this.pilotOfPlane(shot.target) : null;
    target?.state?.recordIncoming();
    this.emit({ t: 'shot', id: shot.id, k: shot.kind, p: v3(shot), v: [shot.vx, shot.vy, shot.vz], side: shot.side, tg: shot.target, r: shot.radius, tr: shot.travel });
  }

  private aircraftTargets(): AircraftTarget[] {
    const out: AircraftTarget[] = [];
    for (const p of this.pilots.values()) {
      if (!p.flying) continue;
      const m = p.flight.model;
      out.push({ id: p.plane, side: p.side, x: m.position.x, y: m.position.y, z: m.position.z, px: m.prevPosition.x, py: m.prevPosition.y, pz: m.prevPosition.z, radius: m.spec.hitRadius, shielded: this.shielded(p) });
    }
    for (const a of this.air.aircraft) {
      if (!a.alive) continue;
      const m = a.model;
      out.push({ id: a.id, side: a.side, x: m.position.x, y: m.position.y, z: m.position.z, px: m.prevPosition.x, py: m.prevPosition.y, pz: m.prevPosition.z, radius: a.spec.hitRadius });
    }
    return out;
  }

  private updateOrdnance(dt: number): void {
    for (const e of this.ordnance.update(dt, this.aircraftTargets(), this.territories)) this.onFire(e);
  }

  /** The AI's or a base's round or rocket landed. */
  private onFire(e: FireEvent): void {
    const rocket = e.shot.kind === 'rocket';
    const at = { x: e.x, y: e.y, z: e.z };
    if (e.type !== 'hit') {
      this.emit({ t: 'end', id: e.shot.id, p: v3(at), fx: e.type === 'ground' ? 'ground' : 'spent', k: e.shot.kind });
      return;
    }
    this.emit({ t: 'end', id: e.shot.id, p: v3(at), fx: 'hit', k: e.shot.kind });
    const victim = this.pilotOfPlane(e.target);
    const source = this.network.get(e.shot.source);
    // Kill credit for a base's guns goes to the base's owner; a player's friendly AI credits nobody.
    const sourceOwner = source ? this.ownerOfInstallation(source.id) : null;
    if (victim) {
      const by = { player: sourceOwner?.id ?? null, name: this.describe(e.shot.source) };
      this.hurtPilot(victim, e.shot.damage, rocket ? 'blast' : 'projectile', rocket ? 'rocket' : 'ink', by, at);
      return;
    }
    const { dealt, destroyed } = this.air.damage(e.target, e.shot.damage, e.shot.source, false);
    if (dealt > 0) {
      this.emit({ t: 'dmg', tg: e.target, n: dealt, p: v3(at), by: sourceOwner?.id, fatal: destroyed, k: rocket ? 'rocket' : 'ink' });
      if (source && sourceOwner?.base) sourceOwner.base.recordDamage(source.id, dealt);
      if (destroyed && source && sourceOwner?.base) {
        const a = this.air.get(e.target);
        sourceOwner.base.recordKill(source.id, a?.role === 'bomber');
      }
    }
  }

  /** "Ann's ink turret", "Ink turret on T8", "enemy veteran Falcon". */
  private describe(source: string): string {
    const i = this.network.get(source);
    if (i) {
      const owner = this.ownerOfInstallation(i.id);
      return owner ? `${owner.name}'s ${i.spec.name.toLowerCase()}` : `${i.spec.name} on ${i.spec.territoryId}`;
    }
    const a = this.air.get(source);
    if (a) return `${a.side === 'enemy' ? 'enemy' : 'friendly'} ${a.skill.label.toLowerCase()} ${a.spec.name}`;
    const p = this.pilotOfPlane(source);
    return p ? p.name : 'enemy fire';
  }

  // ---- Players' guns ------------------------------------------------------------------------------

  private updateGuns(dt: number): void {
    const hittable: Hittable[] = [];
    for (const p of this.pilots.values()) {
      if (!p.flying || this.immune(p)) continue;
      hittable.push({ id: p.plane, side: p.side, radius: p.flight.model.spec.hitRadius });
    }
    for (const a of this.air.aircraft) if (a.alive) hittable.push({ id: a.id, side: a.side, radius: a.spec.hitRadius });
    const objects = [...this.installationColliders(), ...this.ordnance.rocketColliders()];
    const past = (id: string, time: number, out: Point3) => this.history.at(id, time, out);
    for (const impact of this.guns.update(dt, this.time, hittable, past, objects, this.territories)) this.onRoundImpact(impact);
  }

  private onRoundImpact(impact: RoundImpact): void {
    const r = impact.round;
    const shooter = this.pilots.get(r.owner);
    const at = { x: impact.x, y: impact.y, z: impact.z };
    const id = ROUND_ID_OFFSET + r.id;
    if (impact.kind === 'platform' || !shooter?.state) {
      this.emit({ t: 'end', id, p: v3(at), fx: 'ground', k: 'ink' });
      return;
    }
    const st = shooter.state;
    if (isRocket(impact.id)) {
      const rocket = this.ordnance.shootDown(impact.id);
      if (!rocket) return;
      st.recordShotHit();
      this.emit({ t: 'end', id: rocket.id, p: v3(at), fx: 'pop', k: 'rocket' });
      this.emit({ t: 'end', id, p: v3(at), fx: 'hit', k: 'ink' }, { except: shooter.id });
      this.note(shooter, 'launcher', 'Pop!', null, 'good');
      return;
    }
    this.emit({ t: 'end', id, p: v3(at), fx: 'hit', k: 'ink' }, { except: shooter.id });
    const victim = this.pilotOfPlane(impact.id);
    if (victim) {
      st.recordShotHit();
      const dealt = this.hurtPilot(victim, r.damage, 'projectile', 'ink', { player: shooter.id, name: shooter.name }, at);
      if (dealt > 0) st.recordDamage(dealt, null);
      // Shooting at a raider over your base counts as defending it.
      const attack = this.attacks.by(victim.id);
      if (attack && attack.victim === shooter.id && dealt > 0) attack.defended = true;
      return;
    }
    const ai = this.air.get(impact.id);
    if (ai) {
      st.recordShotHit();
      const { dealt, destroyed } = this.air.damage(ai.id, r.damage, shooter.plane, true);
      if (dealt > 0) {
        st.recordDamage(dealt, null);
        this.emit({ t: 'dmg', tg: ai.id, n: dealt, p: v3(at), by: shooter.id, fatal: destroyed, k: 'ink' });
      }
      return;
    }
    const installation = this.network.get(impact.id);
    if (installation && this.mayDamage(shooter, installation)) {
      st.recordShotHit();
      // Cardboard depots shrug off most of the ink.
      const factor = installation.spec.kind === 'supply' ? DEFENSES.supply.inkFactor : 1;
      this.damageInstallation(installation, r.damage * factor, shooter, 'ink');
    }
  }

  /**
   * May player `p` damage installation `i`? The AI's: always. Their own: never. Another player's
   * base: only on a raid against that player (bases can't be ground down outside raids).
   */
  mayDamage(p: Pilot, i: Installation): boolean {
    if (i.side === 'enemy') return true;
    const owner = ownerOfSide(i.side);
    if (!owner || owner === p.id) return false;
    return this.attacks.by(p.id)?.victim === owner;
  }

  /** Damages an installation; credit to `by` (a player) if given. Returns the damage dealt. */
  private damageInstallation(i: Installation, amount: number, by: Pilot | null, weapon: Weapon): number {
    const { dealt, destroyed } = i.damage(Math.round(amount));
    if (dealt <= 0) return 0;
    const centre = { x: i.spec.x, y: i.spec.ground + i.spec.pivot * 0.6, z: i.spec.z };
    this.emit({ t: 'dmg', tg: i.id, n: dealt, p: v3(centre), by: by?.id, fatal: destroyed, k: weapon });
    if (by?.state) by.state.recordDamage(dealt, destroyed ? i.id : null, true, i.spec.kind === 'turret');
    const owner = this.ownerOfInstallation(i.id);
    if (owner) {
      const attack = this.attacks.on(owner.id);
      if (attack && by?.id === attack.attacker) {
        const name = owner.base!.nameOf(owner.base!.keyOf(i.id) ?? STORE);
        const known = attack.structures.find((s) => s.name === name);
        if (known) known.destroyed ||= destroyed;
        else attack.structures.push({ name, destroyed });
      }
      if (by) by.aggression.set(owner.id, this.time);
      if (destroyed) this.note(owner, 'wrecked', `${i.spec.name} wrecked`, null, 'bad');
    } else if (destroyed && i.side === 'enemy') {
      this.aiWrecks.set(i.id, this.time + PVP.aiRebuild);
    }
    if (destroyed) {
      this.solidsCache = null;
      this.emit({ t: 'inst', id: i.id, wrecked: true });
    }
    return dealt;
  }

  /** Wrecked AI installations stand up again after a while (the world is shared: it can't reset per sortie). */
  private rebuildAi(): void {
    for (const [id, at] of this.aiWrecks) {
      if (this.time < at) continue;
      this.aiWrecks.delete(id);
      const i = this.network.get(id);
      if (!i || i.alive) continue;
      i.restore();
      this.solidsCache = null;
      this.emit({ t: 'inst', id, wrecked: false });
    }
  }

  // ---- Bombs --------------------------------------------------------------------------------------

  private updateBombs(dt: number): void {
    const zones = (b: { owner: string | null }): ZoneRef[] => {
      const mission = b.owner ? this.pilots.get(b.owner)?.state?.mission : null;
      if (!mission?.isActive) return [];
      const out: ZoneRef[] = [];
      mission.objectives.forEach((o, i) => {
        if (o.kind === 'bomb' && mission.isOpen(i)) out.push({ objective: i, territoryId: o.territoryId, zone: o.zone });
      });
      return out;
    };
    for (const landing of this.bombs.update(dt, zones, this.territories, this.installationColliders())) {
      if (landing.bomb.owner) this.onPlayerBomb(landing);
      else this.onAiBomb(landing);
    }
  }

  private onPlayerBomb(landing: Landing): void {
    const p = this.pilots.get(landing.bomb.owner!);
    const kind = BOMB.kinds[landing.bomb.kind];
    const point = { x: landing.x, y: landing.y, z: landing.z };
    let struck = false;
    let objective: number | null = landing.kind === 'target' ? landing.objective : null;
    if (landing.kind !== 'void' && p) {
      const attack = this.attacks.by(p.id);
      let onTarget = false;
      for (const i of this.network.installations) {
        if (!i.alive || !this.mayDamage(p, i)) continue;
        const distance = Math.min(...i.spec.shapes.map((s) => distanceToShape(point, s)));
        const damage = blastDamage(kind.damage, kind.blastRadius, distance);
        if (damage > 0 && this.damageInstallation(i, damage, p, 'bomb') > 0) {
          struck = true;
          if (attack && i.id === attack.target.installationId) onTarget = true;
        }
      }
      // A raid's bomb counts when its blast reaches the marked structure (which stands in the way
      // of the bullseye), or it lands right next to it (a structure already wrecked).
      const mission = p.state?.mission;
      if (attack && objective === null && mission?.isActive) {
        const miss = Math.hypot(point.x - attack.target.x, point.z - attack.target.z);
        const index = mission.objectives.findIndex((o) => o.kind === 'bomb' && o.territoryId === attack.territoryId);
        if (index >= 0 && mission.isOpen(index) && (onTarget || miss <= RAIDS.hitRadius + kind.blastRadius / 2)) objective = index;
      }
    }
    this.emit({ t: 'boom', p: v3(point), on: objective !== null || struck, o: p?.id });
    p?.state?.resolveBomb(objective, struck, landing.bomb.clean);
  }

  /** An AI bomber's bomb (a mission raid on a player's base, or a friendly bomber's run). */
  private onAiBomb(landing: Landing): void {
    const b = landing.bomb;
    const s = b.strike;
    const point = { x: landing.x, y: landing.y, z: landing.z };
    const hostile = b.side === 'enemy';
    const miss = s ? Math.hypot(point.x - s.x, point.z - s.z) : Infinity;
    const hit = landing.kind !== 'void' && !!s && miss <= s.radius + (hostile ? BOMB.kinds.standard.blastRadius / 2 : 0.3);
    if (landing.kind !== 'void') {
      this.emit({ t: 'boom', p: v3(point), on: hit });
      const kind = BOMB.kinds.standard;
      for (const i of this.network.installations) {
        if (!i.alive || i.side === b.side) continue;
        const distance = Math.min(...i.spec.shapes.map((shape) => distanceToShape(point, shape)));
        const damage = blastDamage(kind.damage, kind.blastRadius, distance);
        if (damage > 0) this.damageInstallation(i, damage, null, 'bomb');
      }
    }
    if (hostile && hit && s) {
      const victim = this.pilots.get(this.owners.get(s.territoryId) ?? '');
      if (victim?.state && victim.base) {
        const store = victim.base.store.spec;
        const onStore = Math.hypot(s.x - store.x, s.z - store.z) < 1;
        const lost = victim.state.raidHit(this.attacks.loss(victim.base.vulnerable(), onStore), victim.base.protectedPaper, 'Raid hit your base');
        this.note(victim, 'raid', 'Base hit', lost > 0 ? `−${lost}` : null, 'bad');
      }
    }
    if (b.tag) {
      this.air.bombLanded(b.tag, hit);
      if (!hostile) {
        const owner = this.missionOwner(b.tag);
        owner?.pilot.state?.escortStrike(owner.id, hit);
      }
    }
  }

  // ---- Raids between players ----------------------------------------------------------------------

  /** Raids under way: lookouts notice raiders without a radar; the territory shows the alert. */
  private updateAttacks(): void {
    for (const attack of this.attacks.active) {
      if (attack.detected) continue;
      const raider = this.pilots.get(attack.attacker);
      const home = this.pilots.get(attack.victim)?.home;
      if (!raider?.flying || !home) continue;
      const pos = raider.flight.model.position;
      if (home.containsXZ(pos.x, pos.z, LOOKOUT_RANGE)) this.detect(attack, 'Lookouts');
    }
  }

  private detect(attack: Attack, how: string): void {
    attack.detected = true;
    const victim = this.pilots.get(attack.victim);
    const raider = this.pilots.get(attack.attacker);
    if (victim && raider) this.note(victim, 'raid', `${how}: ${raider.name}`, 'inbound', 'warn');
  }

  /** A raid ended: the outcome for both sides, the paper, the shield, the reports. */
  private endAttack(attack: Attack, outcome: 'bombed' | 'repelled' | 'abandoned', defenseReward = 0): void {
    if (!this.attacks.active.includes(attack)) return;
    const attacker = this.pilots.get(attack.attacker);
    const victim = this.pilots.get(attack.victim);
    let lost = 0;
    if (outcome === 'bombed' && victim?.state && victim.base) {
      const onStore = attack.target.installationId === victim.base.idOf(STORE);
      lost = victim.state.raidHit(this.attacks.loss(victim.base.vulnerable(), onStore), victim.base.protectedPaper, `Raided by ${attacker?.name ?? 'a rival'}`);
      victim.shieldUntil = this.time + PVP.raidShield;
      if (attacker) {
        attacker.stats.raids++;
        attacker.addScore(PVP.score.raid);
      }
      this.news(`${attacker?.name ?? 'Someone'} raided ${victim.name}`, 'bad');
    }
    this.attacks.finish(attack, outcome === 'bombed', this.time);
    const reward = attacker?.state?.mission?.status === 'succeeded' ? attacker.state.mission.reward : 0;
    if (victim) {
      victim.report = {
        id: attack.id, role: 'defender', other: attacker?.name ?? '?', territoryId: attack.territoryId, outcome, paperLost: lost,
        reward: 0, structures: attack.structures, defenseReward,
      };
      if (outcome === 'bombed') this.note(victim, 'raid', `Raided by ${attacker?.name ?? '?'}`, lost > 0 ? `−${lost}` : null, 'bad');
      else if (outcome === 'repelled') this.note(victim, 'ok', 'Raid repelled', null, 'good');
    }
    if (attacker) {
      attacker.report = {
        id: attack.id, role: 'attacker', other: victim?.name ?? '?', territoryId: attack.territoryId, outcome, paperLost: lost,
        reward, structures: attack.structures, defenseReward: 0,
      };
    }
  }

  // ---- Cards against other players ---------------------------------------------------------------

  /** Keeps the PvP cards on `p`'s board up to date (at the desk only: a card in flight stays). */
  private refreshPvp(p: Pilot, force: boolean): void {
    const st = p.state;
    if (!st || !p.home || !p.base) return;
    if (st.phase !== 'desk' && st.phase !== 'building' && st.phase !== 'ready' && st.phase !== 'debrief' && st.phase !== 'crashed') return;
    const keep = (key: string) => p.pvp.find((c) => c.key.startsWith(`${key}#`));
    const next: Pilot['pvp'] = [];
    const add = (key: string, make: () => { spec: MissionSpec; tag: Pilot['pvp'][number]['tag'] } | null) => {
      const existing = keep(key);
      if (existing && !force) {
        next.push(existing);
        return;
      }
      const made = make();
      if (!made) return;
      const mission = new Mission(made.spec);
      next.push({ key: `${key}#${++this.keySerial}`, mission, tag: made.tag });
    };
    // Being raided: the interception card goes first.
    const raid = this.attacks.on(p.id);
    const raider = raid ? this.pilots.get(raid.attacker) : null;
    if (raid && raider?.flying) add(`intercept:${raider.id}:${raid.id}`, () => ({ spec: interceptMission(raider.id, raider.name, p.home!), tag: { kind: 'intercept', target: raider.id, name: raider.name, territoryId: p.home!.id } }));
    const others = [...this.pilots.values()].filter((o) => o !== p && o.home && o.base && o.state);
    const offered: Array<() => void> = [];
    // A raid: on a base that may be raided now, keeping the same target while it stays valid.
    const raidable = others.filter((o) => this.attacks.refusal(p, o, this.time) === null && this.attacks.repeatFactor(p.id, o.id, this.time) > 0);
    const current = p.pvp.find((c) => c.tag.kind === 'raid' && raidable.some((o) => o.id === c.tag.target));
    const victim = current ? this.pilots.get(current.tag.target)! : raidable.length > 0 ? raidable[Math.floor(this.rng() * raidable.length)] : null;
    if (victim) {
      offered.push(() =>
        add(`raid:${victim.id}`, () => {
          const t = chooseRaidTarget(victim.base!, this.rng);
          const weapons = victim.base!.network.on(victim.home!.id).filter((i) => i.isWeapon && i.alive).length;
          const reward = this.attacks.reward(weapons, victim.base!.vulnerable(), this.attacks.repeatFactor(p.id, victim.id, this.time));
          const spec = raidMission(victim.name, victim.home!, { installationId: t.installationId, name: t.name, x: t.strike.x, z: t.strike.z }, reward);
          return { spec, tag: { kind: 'raid', target: victim.id, name: victim.name, territoryId: victim.home!.id } };
        }),
      );
    }
    // A hunt: someone else is in the air.
    const airborne = others.filter((o) => o.flying);
    const currentHunt = p.pvp.find((c) => c.tag.kind === 'hunt' && airborne.some((o) => o.id === c.tag.target));
    const prey = currentHunt ? this.pilots.get(currentHunt.tag.target)! : airborne.length > 0 ? airborne[Math.floor(this.rng() * airborne.length)] : null;
    if (prey) {
      const role = prey.state?.plane?.role === 'bomber' ? 'bomber' : 'fighter';
      offered.push(() => add(`hunt:${prey.id}`, () => ({ spec: huntMission(prey.id, prey.name, prey.home, role), tag: { kind: 'hunt', target: prey.id, name: prey.name, territoryId: prey.home?.id ?? null } })));
    }
    // Recon: any other base.
    const currentRecon = p.pvp.find((c) => c.tag.kind === 'recon' && others.some((o) => o.id === c.tag.target));
    const scouted = currentRecon ? this.pilots.get(currentRecon.tag.target)! : others.length > 0 ? others[Math.floor(this.rng() * others.length)] : null;
    if (scouted) offered.push(() => add(`recon:${scouted.id}`, () => ({ spec: reconMission(scouted.name, scouted.home!), tag: { kind: 'recon', target: scouted.id, name: scouted.name, territoryId: scouted.home!.id } })));
    for (const make of offered.slice(0, PVP.cards)) make();
    // A card being flown or just flown stays until the player is back at the desk.
    const flown = p.pvpCard(st.mission);
    if (flown && st.phase !== 'desk' && !next.includes(flown)) next.push(flown);
    const changed = next.length !== p.pvp.length || next.some((c, i) => c !== p.pvp[i]);
    if (!changed) return;
    p.pvp = next;
    if (st.phase === 'desk' || st.phase === 'building' || st.phase === 'ready') st.updateOffers(p.cards());
  }

  /** Is the card against another player still good to launch? */
  private pvpStillValid(p: Pilot, tag: Pilot['pvp'][number]['tag']): boolean {
    const other = this.pilots.get(tag.target);
    if (!other?.home) return false;
    switch (tag.kind) {
      case 'raid':
        return this.attacks.refusal(p, other, this.time) === null;
      case 'hunt':
        return other.flying;
      case 'intercept':
        return this.attacks.on(p.id)?.attacker === other.id;
      case 'recon':
        return true;
    }
  }

  // ---- Game events ------------------------------------------------------------------------------

  private onGameEvent(p: Pilot, e: GameEvent): void {
    const st = p.state!;
    const m = p.flight.model;
    switch (e.type) {
      case 'built':
        m.setAircraft(st.plane!);
        m.setHealth(1);
        {
          const at = launchPoint(p.home!);
          m.park({ x: at.x, y: p.home!.top + PLANE_PARKED, z: at.z }, at.yaw, p.home!.id);
        }
        p.stopped = false;
        break;
      case 'build-refused':
        this.note(p, e.reason === 'paper' ? 'paper' : 'wrecked', e.reason === 'paper' ? 'Need paper' : 'Wrong plane', e.reason === 'paper' ? `−${Math.max(0, e.cost - p.resources.paper)}` : null, 'bad');
        break;
      case 'launch-refused':
        this.note(p, 'wrecked', 'Wrong plane', null, 'bad');
        break;
      case 'launched': {
        m.launch();
        p.flight.boundary.reset();
        p.launchedAt = this.time;
        p.damageLog.length = 0;
        const mission = st.mission!;
        p.director?.accepted(mission);
        p.spawns = (mission.spec.aircraft ?? []).map((s) => this.prefixed(p, s));
        p.missionTime = 0;
        const card = p.pvpCard(mission);
        if (card?.tag.kind === 'raid') this.startRaid(p, card.tag.target, mission);
        break;
      }
      case 'took-off':
        m.launch();
        p.launchedAt = this.time;
        p.stopped = false;
        break;
      case 'landed':
        this.note(p, 'land', st.mission?.status === 'succeeded' ? 'Complete' : 'Touchdown', st.mission?.status === 'succeeded' ? `+${st.mission.reward}` : null, 'good');
        break;
      case 'objective-complete':
        this.note(p, 'ok', 'Objective', null, 'good');
        break;
      case 'mission-succeeded':
        this.endMissionAi(p);
        p.stats.missions++;
        p.addScore(PVP.score.mission);
        this.note(p, 'ok', 'Complete', `+${e.reward}`, 'good');
        {
          const attack = this.attacks.by(p.id);
          if (attack) this.endAttack(attack, 'bombed');
        }
        break;
      case 'mission-failed':
        this.endMissionAi(p);
        if (e.reason !== 'aircraft-lost' && e.reason !== 'abandoned') this.note(p, 'close', failureWord(e.reason), null, 'bad');
        // A raider that crashes is dealt with with the crash (who shot it down matters).
        if (e.reason !== 'aircraft-lost') {
          const attack = this.attacks.by(p.id);
          if (attack) this.endAttack(attack, 'abandoned');
        }
        break;
      case 'crashed':
        this.onCrashed(p);
        this.sortieOver(p, false);
        break;
      case 'sortie-ended':
        this.sortieOver(p, true);
        break;
      case 'returned':
        m.hide();
        p.result = null;
        break;
      case 'out-of-ammo':
        this.note(p, 'ink', 'Out of ink', null, 'bad');
        break;
      case 'range-exhausted':
        this.note(p, 'range', 'Gliding', null, 'bad');
        break;
      case 'rearmed':
        this.note(p, 'rearm', 'Rearmed', null, 'good');
        break;
      case 'aircraft-destroyed':
        if (e.credit && !planeOwner(e.id)) this.note(p, e.role, 'Shot down', null, 'good');
        break;
      case 'raid-defended':
      case 'raid-hit':
      default:
        break;
    }
  }

  private startRaid(p: Pilot, victimId: string, mission: Mission): void {
    const victim = this.pilots.get(victimId);
    if (!victim?.home || !victim.base) return;
    const objective = mission.objectives.find((o) => o.kind === 'bomb');
    if (!objective || objective.kind !== 'bomb') return;
    const target = { installationId: '', name: 'structure', x: objective.zone.x, z: objective.zone.z };
    for (const i of this.network.on(victim.home.id)) {
      if (Math.hypot(i.spec.x - target.x, i.spec.z - target.z) < 0.5) {
        target.installationId = i.id;
        target.name = i.spec.name;
      }
    }
    this.attacks.start(p.id, victim.id, victim.home.id, target, this.time);
    // Raiding someone ends your own new-player protection.
    p.protectUntil = 0;
    this.note(victim, 'raid', `${p.name} is coming`, territoryName(victim.home.id), 'warn');
    this.refreshPvp(victim, false);
  }

  /** The plane went down: kill and assist credit, bounties, the kill feed. */
  private onCrashed(p: Pilot): void {
    const st = p.state!;
    const m = p.flight.model;
    const v = m.getVelocity(this.v1);
    this.emit({ t: 'down', id: p.plane, p: v3(m.position), v: v3(v), kind: m.spec.id, side: p.side });
    m.crash();
    p.crashedAt = this.time;
    p.stopped = false;
    p.stats.deaths++;
    this.history.forget(p.plane);
    const { killer, assists } = creditFor(p.damageLog, this.time);
    const k = killer ? this.pilots.get(killer) : undefined;
    const plane = st.plane!;
    const role = plane.role === 'bomber' ? 'bomber' : 'fighter';
    if (k?.state) {
      k.stats.kills++;
      k.addScore(PVP.score.kill);
      const cost = st.emergency ? 0 : plane.cost;
      const bounty = this.kills.record(k.id, p.id, cost, st.emergency, this.time);
      if (bounty > 0) k.state.payBonus(bounty, `Shot down ${p.name}`);
      k.state.aircraftDestroyed(p.plane, role, true);
      this.note(k, 'crumple', `Shot down ${p.name}`, bounty > 0 ? `+${bounty}` : null, 'good');
    }
    // A raider down: a defense if the player being raided brought it down (their plane or their guns).
    const attack = this.attacks.by(p.id);
    if (attack) {
      const defender = this.pilots.get(attack.victim);
      const byDefender = !!defender && killer === defender.id;
      if (byDefender && defender.state) {
        defender.stats.defends++;
        defender.addScore(PVP.score.defend);
        // Paid for flying up to meet the raider, not for the base's guns alone (as single-player's raids).
        const flew = defender.state.phase === 'flying' || defender.state.phase === 'landed';
        if (flew) defender.state.payBonus(PVP.defenseReward, `Defended against ${p.name}`);
        this.endAttack(attack, 'repelled', flew ? PVP.defenseReward : 0);
      } else {
        this.endAttack(attack, 'repelled');
      }
    }
    for (const id of assists) {
      const a = this.pilots.get(id);
      if (!a?.state) continue;
      a.stats.assists++;
      a.addScore(PVP.score.assist);
      const share = Math.round(PVP.killBase * PVP.assistShare);
      if (!st.emergency && share > 0) a.state.payBonus(share, `Assist on ${p.name}`);
      this.note(a, 'crumple', 'Assist', share > 0 && !st.emergency ? `+${share}` : null, 'good');
    }
    // Missions after this plane count it whoever brought it down.
    for (const other of this.pilots.values()) if (other !== k && other !== p && other.state?.mission?.isActive) other.state.aircraftDestroyed(p.plane, role, false);
    const weapon: Weapon = killer ? (p.lastWeapon ?? 'ink') : 'crash';
    this.emit({ t: 'kill', killer: k?.id ?? null, killerName: k?.name ?? (st.sortie?.killedBy ?? ''), victim: p.id, victimName: p.name, weapon, assists, bomber: plane.role === 'bomber' });
    if (k) this.note(p, 'crumple', `Shot down by ${k.name}`, null, 'bad');
    else if (st.sortie?.killedBy) this.note(p, 'crumple', 'Shot down', st.sortie.killedBy, 'bad');
    else this.note(p, 'crumple', 'Crumpled', null, 'bad');
    this.guns.clear(p.id);
  }

  /** The sortie is over: the director learns from it and deals the replacement card; the report is made. */
  private sortieOver(p: Pilot, recovered: boolean): void {
    const st = p.state!;
    const mission = st.mission;
    const sortie = st.sortie;
    const plane = st.plane;
    this.endMissionAi(p);
    if (!mission || !sortie || !plane) return;
    const success = mission.status === 'succeeded';
    const damageTaken = Math.min(1, sortie.damageTaken / plane.maxHealth);
    const card = p.pvpCard(mission);
    p.director?.afterSortie(
      mission,
      {
        type: mission.spec.type, tier: mission.tier, success, failure: mission.failure, lost: !recovered, landed: recovered,
        damageDealt: sortie.damageDealt, damageTaken, time: mission.elapsed, par: mission.spec.par ?? 0,
        shotsFired: sortie.shotsFired, shotsHit: sortie.shotsHit, aircraft: plane.id, reward: success ? mission.reward : 0, medal: null,
      },
      { success, recovered, damageTaken, time: mission.elapsed, par: mission.spec.par ?? 0, reward: success ? mission.reward : 0 },
    );
    for (const payout of p.director?.takePayouts() ?? []) st.payBonus(payout.amount, payout.label);
    p.result = {
      recovered, missionTitle: mission.title, status: mission.status, failure: mission.failure, reward: success ? mission.reward : 0,
      elapsed: mission.elapsed, sortie: { ...sortie }, pvp: card?.tag ?? null,
    };
    if (card) p.pvp = p.pvp.filter((c) => c !== card);
  }

  private onBaseEvent(p: Pilot, e: BaseEvent): void {
    this.solidsCache = null;
    if (p.base) p.resources.capacity = p.base.capacity;
    switch (e.type) {
      case 'built':
        this.note(p, 'build', `${BASE.buildings[e.kind].short}`, `−${e.cost}`, 'good');
        break;
      case 'upgraded':
        this.note(p, 'upgrade', `${BASE.buildings[e.kind].short} ${'★'.repeat(e.level - 1)}`, `−${e.cost}`, 'good');
        break;
      case 'repaired':
        this.note(p, 'repair', e.keys.length > 1 ? `${e.keys.length} repaired` : 'Repaired', `−${e.cost}`, 'good');
        break;
      case 'removed':
        this.note(p, 'remove', `${BASE.buildings[e.kind].short} removed`, e.refund > 0 ? `+${e.refund}` : null, 'info');
        break;
      case 'refused': {
        const what = { paper: 'Need paper', slot: 'Wrong slot', unique: 'Only one', 'max-level': 'Max level', destroyed: 'Repair first', intact: 'Intact' }[e.reason];
        this.note(p, e.reason === 'paper' ? 'paper' : 'warn', what, e.reason === 'paper' ? `−${e.missing}` : null, 'bad');
        break;
      }
    }
  }

  // ---- What missions and the director see -------------------------------------------------------

  missionContext(p: Pilot): MissionContext {
    const home = p.home!;
    const launch = launchPoint(home);
    const installations = this.network.installations
      .filter((i) => i.alive && (i.side === 'enemy' || i.side === p.side))
      .map((i) => ({ id: i.id, kind: i.spec.kind, territoryId: i.spec.territoryId, side: (i.side === p.side ? 'player' : 'enemy') as Side, x: i.spec.x, z: i.spec.z, range: i.spec.range }));
    const excluded = new Set([...this.owners.keys()].filter((t) => t !== home.id));
    return {
      territories: this.territories,
      homeId: home.id,
      launch,
      dummies: [],
      obstacles: [
        ...this.shared.decorGround,
        ...this.network.installations.map((i) => ({ x: i.spec.x, z: i.spec.z, r: i.spec.footprint })),
        ...this.shared.layout.barriers.filter((b) => !this.owners.has(b.territoryId)).flatMap((b) => b.solids.map(footprint)),
      ],
      installations,
      excluded,
    };
  }

  private situation(p: Pilot): Situation {
    const costs = Object.fromEntries(AIRCRAFT_ORDER.map((id) => [id, p.state?.buildCostFor(id) ?? AIRCRAFT[id].cost])) as Record<AircraftId, number>;
    return { paper: p.resources.paper, costs, airRoom: this.air.room, raidActive: false };
  }

  // ---- Geometry -----------------------------------------------------------------------------------

  /**
   * Everything a plane can fly into besides the platforms: every desk's landmark and tall props
   * (the shapes the clients predict with), standing installations and the AI's walls.
   */
  solids(): Collider[] {
    if (this.solidsCache) return this.solidsCache;
    const solids: Collider[] = [...this.shared.decor, ...this.network.installations.filter((i) => i.alive).map((i) => ({ id: i.id, shapes: i.spec.solids }))];
    for (const b of this.shared.layout.barriers) if (!this.owners.has(b.territoryId)) solids.push({ id: b.id, shapes: b.solids });
    this.solidsCache = solids;
    return solids;
  }

  private installationColliders(): Collider[] {
    return this.network.installations.filter((i) => i.alive).map((i) => ({ id: i.id, shapes: i.spec.shapes }));
  }

  private recordHistory(): void {
    const alive = new Set<string>();
    for (const p of this.pilots.values()) {
      if (!p.flying) continue;
      alive.add(p.plane);
      this.history.record(this.time, p.plane, p.flight.model.position);
    }
    for (const a of this.air.aircraft) {
      if (!a.alive) continue;
      alive.add(a.id);
      this.history.record(this.time, a.id, a.position);
    }
    if (this.tick % 60 === 0) this.history.retain(alive);
  }

  pilotOfPlane(id: string): Pilot | null {
    const owner = planeOwner(id);
    return owner ? (this.pilots.get(owner) ?? null) : null;
  }

  /** The player whose base installation `id` is part of. */
  ownerOfInstallation(id: string): Pilot | null {
    const i = this.network.get(id);
    const owner = i ? ownerOfSide(i.side) : null;
    return owner ? (this.pilots.get(owner) ?? null) : null;
  }

  // ---- Telling the players ------------------------------------------------------------------------

  emit(e: NetEvent, opts: { to?: string; except?: string } = {}): void {
    this.events.push({ ...opts, e });
  }

  note(p: Pilot, icon: string, title: string, value: string | null, tone: 'good' | 'bad' | 'warn' | 'info'): void {
    this.emit({ t: 'note', icon, title, value, tone }, { to: p.id });
  }

  private news(text: string, tone: 'good' | 'bad' | 'info'): void {
    this.emit({ t: 'news', text, tone });
  }

  missionKey(m: Mission): string {
    let key = this.missionKeys.get(m);
    if (!key) {
      key = `m${++this.keySerial}`;
      this.missionKeys.set(m, key);
    }
    return key;
  }

  /** The pilot's own flight state, for reconciliation, while the plane moves. */
  ownFor(id: string): OwnFlight | null {
    const p = this.pilots.get(id);
    const m = p?.flight.model;
    if (!p?.state || !m || (m.status !== 'flying' && m.status !== 'rolling')) return null;
    const i = p.inputs;
    return {
      seq: i.lastSeq, flight: m.saveState(), range: p.state.rangeLeft, boundary: p.flight.boundary.state, countdown: p.flight.boundary.countdown,
      inputs: [i.applied, i.autoSteps, i.dropped, i.queue.length],
    };
  }

  /**
   * The private state sections that changed since they were last sent (all of them with `full`),
   * or null if nothing did.
   */
  privateFor(id: string, full = false): MeDTO | null {
    const p = this.pilots.get(id);
    if (!p) return null;
    const all = this.sections(p);
    const out: MeDTO = {};
    let any = false;
    for (const key of Object.keys(all) as Array<keyof MeDTO>) {
      const json = JSON.stringify(all[key] ?? null);
      if (!full && p.sent.get(key) === json) continue;
      p.sent.set(key, json);
      (out as Record<string, unknown>)[key] = all[key];
      any = true;
    }
    return any ? out : null;
  }

  private card(p: Pilot, m: Mission, index: number): CardDTO {
    const pvp = p.pvpCard(m);
    const offer = p.director?.offerFor(m);
    const slot = pvp ? 'pvp' : offer?.eventId ? 'event' : ((offer?.slot ?? 'balanced') as CardDTO['slot']);
    const { aircraft: _spawns, ...spec } = m.spec;
    void _spawns;
    void index;
    return {
      key: this.missionKey(m),
      spec: spec as MissionSpec,
      slot,
      slotLabel: pvp ? 'Rival' : slot === 'safe' ? 'Safe' : slot === 'risky' ? 'High risk' : slot === 'event' ? 'World event' : 'Balanced',
      pvp: pvp?.tag ?? null,
    };
  }

  private sections(p: Pilot): Required<Pick<MeDTO, 'territory' | 'protection'>> & MeDTO {
    const st = p.state;
    const base = p.base;
    const protection = { newPlayer: Math.max(0, Math.ceil(p.protectUntil - this.time)), shield: Math.max(0, Math.ceil(p.shieldUntil - this.time)) };
    if (!st || !base || !p.home) return { territory: null, protection };
    const income = st.income;
    const paper = p.resources.paper;
    const plane = st.plane;
    const mission = st.mission;
    const attacks: AttackDTO[] = this.attacks.active
      .filter((a) => a.attacker === p.id || a.victim === p.id)
      .map((a) => {
        const raider = this.pilots.get(a.attacker);
        const pos = raider?.flying ? raider.flight.model.position : null;
        const home = this.pilots.get(a.victim)?.home;
        return {
          id: a.id, attacker: a.attacker, attackerName: raider?.name ?? '?', victim: a.victim, victimName: this.pilots.get(a.victim)?.name ?? '?',
          territoryId: a.territoryId, detected: a.detected || a.attacker === p.id, age: Math.round(this.time - a.started),
          distance: pos && home ? Math.round(Math.hypot(pos.x - home.x, pos.z - home.z)) : null,
        };
      });
    return {
      phase: st.phase,
      territory: p.home.id,
      selected: st.selected,
      swaps: p.director?.swaps ?? 0,
      economy: {
        paper, capacity: base.capacity, rate: Math.round(income.ratePerMinute(paper) * 10) / 10, state: income.stateFor(paper),
        progress: Math.round(income.progress * 100) / 100, protectedPaper: base.protectedPaper, vulnerable: base.vulnerable(), production: base.production,
      },
      garage: {
        chosen: st.aircraft,
        hangar: [...st.hangar].map(([id, h]) => ({ id, condition: h.condition, health: h.health })),
        costs: Object.fromEntries(AIRCRAFT_ORDER.map((id) => [id, { kind: st.buildKindFor(id), cost: st.buildCostFor(id) }])) as Record<AircraftId, { kind: 'fold' | 'refit' | 'rollout'; cost: number }>,
        emergency: st.emergencyAvailable(),
      },
      plane: plane
        ? {
            id: plane.id, emergency: st.emergency, health: Math.round(st.durability?.health ?? plane.maxHealth), maxHealth: plane.maxHealth,
            ammo: st.gun?.ammo ?? plane.gun.ammo, ammoMax: plane.gun.ammo, gunReady: st.gun?.canFire() ?? false,
            bombs: st.bombsLoaded, bombsMax: plane.bombs.capacity, falling: st.bombsFalling, cooldown: Math.round(st.bombCooldown * 10) / 10,
            range: Math.round(st.rangeLeft), rangeMax: plane.range, rearm: st.rearmProgress === null ? null : Math.round(st.rearmProgress * 100) / 100,
            build: Math.round(st.buildProgress * 100) / 100, buildKind: st.buildKind, stopped: p.stopped,
          }
        : null,
      offers: st.offers.map((m, i) => this.card(p, m, i)),
      mission: mission ? this.card(p, mission, -1) : null,
      progress: mission
        ? { key: this.missionKey(mission), status: mission.status, failure: mission.failure, elapsed: Math.round(mission.elapsed * 10) / 10, progress: mission.progress.map((x) => Math.round(x * 100) / 100) }
        : null,
      base: { ...base.save(), capacity: base.capacity, production: base.production, protectedPaper: base.protectedPaper },
      protection,
      attacks,
      result: p.result,
      report: p.report,
      raid: p.raidReport,
    };
  }

  /** Suitability of the selected card for every design, for refusing a launch early. */
  suits(p: Pilot, id: AircraftId): boolean {
    const m = p.state?.selectedMission;
    return !m || assessSuitability(AIRCRAFT[id], m.spec).level !== 'unsuitable';
  }
}

/** Ram damage multiplier for installations a plane flies into. */
const DAMAGE_RAM = 1.5;
/** Height of a parked plane's centre above the platform. */
const PLANE_PARKED = 0.35;

function v3(p: Point3): number[] {
  return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100];
}

function failureWord(reason: string): string {
  switch (reason) {
    case 'missed':
      return 'Out of bombs';
    case 'out-of-time':
      return 'Out of time';
    case 'target-escaped':
      return 'It got away';
    case 'target-bombed':
      return 'Too late';
    case 'escort-lost':
      return 'Bomber lost';
    default:
      return 'Failed';
  }
}

