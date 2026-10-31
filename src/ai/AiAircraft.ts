import { Vec3 } from 'playcanvas';
import { predictImpact } from '../aircraft/Bomb';
import { FlightModel, wrapAngle, type Collision, type FlightControls } from '../aircraft/FlightModel';
import { PLANE_SHAPES } from '../aircraft/PlaneShapes';
import type { Collider } from '../combat/Collision';
import { Durability } from '../combat/Damage';
import { Gun } from '../combat/Gun';
import type { ShotOrder } from '../combat/Ordnance';
import { AI, AIRCRAFT, BOMB, DEFENSES, WEAPONS, WORLD, type AircraftId, type AircraftSpec, type AiRole, type Difficulty, type PilotSkill, type Side } from '../config';
import type { Point3 } from '../missions/Mission';
import type { Rng } from '../systems/Random';
import type { Territory } from '../world/Territory';
import { aimSpread, angleBetween, leadPoint, scatter, TargetTrack, type Moving } from './Gunnery';
import { beyondEdge, headingTo, terrainAhead } from './Navigation';

/**
 * patrol     – following its route (or an escort slot, or heading for its prey).
 * alert      – has noticed something and is about to react (slow pilots take longer).
 * attack     – a fighter turning towards and shooting at its target.
 * reposition – overshot its target: extending away to come round again.
 * evade      – a scout running for it, or anyone breaking hard away from an attacker.
 * disengage  – broke off a fight (too far, too hurt, out of ink); ignores everything for a while.
 * bomb-run   – a bomber holding a steady line and height towards its target.
 * egress     – a bomber turning away after its release.
 * leave      – done: flying out of the world.
 */
export type AiState = 'patrol' | 'alert' | 'attack' | 'reposition' | 'evade' | 'disengage' | 'bomb-run' | 'egress' | 'leave';

/** Why it is in the air: background traffic, a mission's, or a raid on T1. */
export type AiPurpose = 'ambient' | 'mission' | 'raid';

/** What a bomber is after: a point on the ground, and how close its bomb must land. */
export interface Strike {
  territoryId: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Everything needed to put an AI aircraft in the air. Missions, raids and ambient patrols all describe theirs this way. */
export interface AiOrders {
  id: string;
  side: Side;
  role: AiRole;
  skill: Difficulty;
  /** The design it flies; the role's by default (AI.roles). */
  aircraft?: AircraftId;
  /** Waypoints: it appears at the first, heading for the second. */
  route: Point3[];
  /** Patrols fly their route round and round; otherwise it is flown once (then a bomber makes its run). */
  loop: boolean;
  /** Where it leaves the world: a scout's checkpoint, everyone's way home. */
  exit: Point3;
  /** Bombers: what to bomb at the end of the route. */
  strike?: Strike;
  /** Fighters: the bomber whose wing it flies on. */
  escort?: string;
  /** Fighters: the aircraft it was sent after. It knows where that one is. */
  prey?: string;
  /** Fighters: the area it defends; it won't chase further than AI.leash from it. */
  guard?: { x: number; z: number };
  purpose: AiPurpose;
  /** Seconds before an ambient patrol heads home. */
  lifetime?: number;
  /** Cruising speed, when it should be slower than the design's (raiders take their time). */
  speed?: number;
}

/** Another aircraft, as a pilot sees it. */
export interface Contact extends Moving {
  side: Side;
  /** Detection ranges are multiplied by this. */
  signature: number;
  /** How big a target it is. */
  radius: number;
  /** Not to be attacked now: the player over home, or just after take-off. */
  shielded: boolean;
  role: AiRole | 'player';
}

/** What a pilot knows about the world around it. */
export interface AiWorld {
  territories: readonly Territory[];
  /** Props and installations to fly into. */
  obstacles: readonly Collider[];
  /** Every aircraft in the air, AI and player, itself included. */
  contacts: readonly Contact[];
  home: Territory;
  rng: Rng;
}

/** A bomb leaving a bomber, aimed at its strike. */
export interface BombOrder {
  source: string;
  side: Side;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  strike: Strike;
}

/** What one step of an AI aircraft produced. */
export interface AiStep {
  shots: ShotOrder[];
  bomb: BombOrder | null;
  collisions: Collision[];
  /** It fell out of the world. */
  void: boolean;
}

/** Home is avoided by enemy aircraft by this much more than its own safe zone (raiders excepted). */
const HOME_AVOID = 25;

/**
 * One AI-controlled aircraft: a FlightModel (the same physics the player's plane flies), health,
 * guns, a bomb rack, and a pilot. The pilot is a finite-state machine that only decides where to
 * point (an aim direction, exactly like the mouse sets one), how fast to go (the throttle), when
 * to boost, shoot and drop. Basic and predictable on purpose: scouts follow their route and run
 * from trouble, fighters chase and shoot at what they find and give up when it gets too far,
 * bombers fly to their target and make a steady run at it. How well they do it is the skill level:
 * reactions, aim, trigger discipline, positioning, how hard they push and when they break off.
 */
export class AiAircraft {
  readonly spec: AircraftSpec;
  readonly skill: PilotSkill;
  readonly model: FlightModel;
  readonly durability: Durability;
  readonly gun: Gun;
  bombs: number;
  state: AiState = 'patrol';
  stateTime = 0;
  /** The aircraft it is attacking or running from. */
  targetId: string | null = null;
  readonly track = new TargetTrack();
  /** The route it is flying now (a bomber going round again gets a new one). */
  route: Point3[];
  /** Index of the next waypoint. */
  waypoint = 1;
  /** Seconds since it appeared. */
  age = 0;
  /** Damage the player has done to it: kill credit and raid participation. */
  playerDamage = 0;
  /** Who last hit it, and how long ago. */
  lastHitBy: string | null = null;
  sinceHit = Infinity;
  /** A bomber's last bomb: still falling, on target or a miss. */
  strike: 'none' | 'falling' | 'hit' | 'miss' = 'none';
  /** It released a bomb at some point. */
  released = false;
  /** Its job is done (or abandoned) and it is flying out of the world. */
  get leaving(): boolean {
    return this.state === 'leave';
  }

  private reactLeft = 0;
  private burstLeft = 0;
  private pauseLeft = 0;
  private jinkLeft = 0;
  private jinkDir = 1;
  private jinkPitch = 0;
  private resume: AiState = 'patrol';
  private positioning = false;
  private readonly chaseFrom = { x: 0, y: 0, z: 0 };
  /** Where a bomber thinks the release point puts its bomb, off by its skill's error. */
  private bombAim = { x: 0, z: 0 };
  private readonly v = new Vec3();
  private readonly f = new Vec3();
  private readonly muzzle = { x: 0, y: 0, z: 0 };
  private readonly lifetime: number;
  /** The heading it wanted last step, and how fast that is swinging round (rad/s), for anticipating turns. */
  private lastWant: number | null = null;
  private swing = 0;

  constructor(
    readonly orders: AiOrders,
    private readonly rng: Rng,
  ) {
    this.spec = AIRCRAFT[orders.aircraft ?? AI.roles[orders.role]];
    this.skill = AI.skill[orders.skill];
    this.model = new FlightModel(this.spec);
    this.durability = new Durability(this.spec.maxHealth);
    this.gun = new Gun(this.spec.gun);
    this.bombs = orders.strike ? this.spec.bombs.capacity : 0;
    this.route = orders.route.map((p) => ({ ...p }));
    this.lifetime = orders.lifetime ?? Infinity;
    const [start, next] = [this.route[0], this.route[1] ?? orders.exit];
    this.model.spawn(start, headingTo(start, next).yaw, this.cruise());
    this.pauseLeft = rng() * this.skill.pause;
  }

  get id(): string {
    return this.orders.id;
  }

  get side(): Side {
    return this.orders.side;
  }

  get role(): AiRole {
    return this.orders.role;
  }

  get purpose(): AiPurpose {
    return this.orders.purpose;
  }

  get alive(): boolean {
    return !this.durability.destroyed;
  }

  get position(): Vec3 {
    return this.model.position;
  }

  /** It is shooting, or about to: for warnings. */
  get attacking(): boolean {
    return this.state === 'attack' || (this.state === 'alert' && this.role === 'fighter');
  }

  /** How others see it. */
  contact(): Contact {
    const p = this.model.position;
    const v = this.model.getVelocity(this.v);
    return {
      id: this.id, side: this.side, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z,
      signature: this.spec.signature, radius: this.spec.hitRadius, shielded: false, role: this.role,
    };
  }

  /**
   * Takes a hit. `by` names the shooter (an aircraft or installation id), `byPlayer` says whether
   * it was the player. It reacts: fighters turn on whoever hit them, others jink.
   */
  damage(amount: number, by: string | null, byPlayer: boolean): { dealt: number; destroyed: boolean } {
    if (!this.alive) return { dealt: 0, destroyed: false };
    const dealt = this.durability.damage(Math.round(amount));
    if (dealt <= 0) return { dealt: 0, destroyed: false };
    if (byPlayer) this.playerDamage += dealt;
    this.lastHitBy = by;
    this.sinceHit = 0;
    this.model.setHealth(this.durability.fraction);
    return { dealt, destroyed: !this.alive };
  }

  /** Done here: fly out of the world. */
  leave(): void {
    if (this.state !== 'leave') this.enter('leave');
  }

  /** A bomb it dropped has landed: on target or not. A miss with bombs left means going round again. */
  bombLanded(hit: boolean): void {
    this.strike = hit ? 'hit' : 'miss';
  }

  /** One step: the pilot decides, the flight model flies, the guns and the bomb rack do what was decided. */
  update(dt: number, world: AiWorld): AiStep {
    const step: AiStep = { shots: [], bomb: null, collisions: [], void: false };
    if (!this.alive) return step;
    this.age += dt;
    this.sinceHit += dt;
    this.stateTime += dt;
    this.gun.update(dt);
    this.burstLeft = Math.max(0, this.burstLeft - dt);
    this.pauseLeft = Math.max(0, this.pauseLeft - dt);

    const decision = this.think(dt, world);
    const controls: FlightControls = {
      mouseDX: 0, mouseDY: 0, bank: 0, autoLevel: false, autopilot: null, gliding: false,
      throttle: this.throttleFor(decision.speed),
      boost: decision.boost,
      aim: this.avoid(decision.yaw, decision.pitch, world),
    };
    const result = this.model.fly(dt, controls, world.territories, world.obstacles);
    step.collisions = result.collisions;
    step.void = result.outcome === 'void';

    if (decision.fire) step.shots.push(...this.shoot(world));
    if (decision.drop) step.bomb = this.drop();
    return step;
  }

  // ---- The pilot ------------------------------------------------------------------------------

  private think(dt: number, world: AiWorld): Decision {
    const own = this.contact();
    if (this.lifetime < this.age && this.purpose === 'ambient' && this.state !== 'attack') this.leave();
    // A bomber that has taken too much gives up its run (a raid driven off).
    if (this.role === 'bomber' && !this.released && this.skill.disengageHealth > 0 && this.durability.fraction < AI.abortHealth && this.state !== 'leave') {
      this.leave();
    }
    switch (this.state) {
      case 'patrol':
      case 'alert':
        return this.patrol(dt, world, own);
      case 'attack':
        return this.attack(dt, world, own);
      case 'reposition':
        return this.reposition(dt, world);
      case 'evade':
        return this.evade(dt, world, own);
      case 'disengage':
        return this.disengage(world);
      case 'bomb-run':
        return this.bombRun(world);
      case 'egress':
        return this.egress(world, own);
      case 'leave':
        return this.flyOut(dt, world);
    }
  }

  /** Following the route (or the escort slot, or the prey), watching for trouble. */
  private patrol(dt: number, world: AiWorld, own: Contact): Decision {
    const p = this.model.position;
    let decision = this.followRoute(world);
    if (this.state === 'patrol' && decision.done) {
      if (this.orders.strike && this.bombs > 0 && !this.released) this.enter('bomb-run');
      else if (!this.orders.loop) this.leave();
    }

    const escorted = this.orders.escort ? find(world, this.orders.escort) : null;
    if (this.orders.escort && !escorted && this.state === 'patrol') this.leave();
    if (escorted) decision = this.holdFormation(escorted);
    const prey = this.orders.prey ? find(world, this.orders.prey) : null;
    if (prey && this.role === 'fighter') decision = { ...decision, ...headingTo(p, { x: prey.x, y: prey.y + 4, z: prey.z }, 0.6), speed: this.top() };

    // Noticing someone: fighters turn on them, scouts get ready to run, bombers carry on.
    if (this.state === 'patrol') {
      if (this.role === 'fighter') {
        const target = this.pickTarget(world, own);
        if (target) {
          this.targetId = target.id;
          this.reactLeft = this.lastHitBy === target.id && this.sinceHit < 1 ? this.skill.reaction * 0.5 : this.skill.reaction;
          this.enter('alert');
        }
      } else if (this.role === 'scout') {
        const threat = this.nearestHostile(world, own, AI.flee);
        if (threat || this.sinceHit < 0.5) {
          this.targetId = threat?.id ?? this.lastHitBy;
          this.reactLeft = this.skill.reaction;
          this.enter('alert');
        }
      }
    } else if (this.state === 'alert') {
      this.reactLeft -= dt;
      if (this.reactLeft <= 0) {
        if (this.role === 'scout') this.enter('evade');
        else if (this.targetId && find(world, this.targetId)) this.startAttack();
        else this.enter('patrol');
      }
    }

    // Bombers jink when attacked on the way in, then carry on.
    if (this.role === 'bomber' && this.state === 'patrol') {
      if (this.jinkLeft <= 0 && (this.sinceHit < 0.3 || this.onMyTail(world, own)) && this.skill.evasive > 0) this.startJink(world.rng, 'patrol');
      if (this.jinkLeft > 0) decision = this.jink(dt, decision);
      decision.fire = this.opportunisticFire(world, own);
    }
    return decision;
  }

  /** A fresh attack: the pursuit limit is measured from here. */
  private startAttack(): void {
    this.lastWant = null;
    this.swing = 0;
    this.chaseFrom.x = this.model.position.x;
    this.chaseFrom.y = this.model.position.y;
    this.chaseFrom.z = this.model.position.z;
    this.resumeAttack();
  }

  /** Back to the same attack (after a break or an overshoot): only the approach is chosen again. */
  private resumeAttack(): void {
    this.enter('attack');
    this.positioning = this.rng() < this.skill.positioning;
  }

  /** Turning on the target and shooting, until it gets too far, too dangerous, or the ink runs out. */
  private attack(dt: number, world: AiWorld, own: Contact): Decision {
    const p = this.model.position;
    const t = this.targetId ? find(world, this.targetId) : null;
    if (!t || t.shielded || !this.mayChase(world, t)) return this.breakOff(world);
    this.track.update(dt, t, this.skill.trackingLag);
    const d = dist(p, t);
    const fwd = this.model.getForward(this.f);
    const toward = { x: t.x - p.x, y: t.y - p.y, z: t.z - p.z };
    // Overshot: it is right here and behind us. Extend away and come round again.
    if (d < AI.overshoot && dot(fwd, toward) < 0) {
      this.enter('reposition');
      this.jinkDir = world.rng() < 0.5 ? -1 : 1;
      return this.reposition(dt, world);
    }
    // Something on our own tail: a pilot who knows how breaks hard.
    if (this.onMyTail(world, own) && world.rng() < this.skill.evasive * dt) {
      this.startJink(world.rng, 'attack');
      this.enter('evade');
      return this.evade(dt, world, own);
    }

    const speed = Math.hypot(t.vx, t.vy, t.vz);
    const tail = speed > 1 ? dot({ x: t.vx / speed, y: t.vy / speed, z: t.vz / speed }, { x: (p.x - t.x) / d, y: (p.y - t.y) / d, z: (p.z - t.z) / d }) : -1;
    const ownVelocity = this.model.getVelocity(this.v);
    const lead = leadPoint(p, ownVelocity, t, this.track.velocity, this.gun.spec.speed, this.skill.lead);
    let aim: Point3 = lead;
    // Working round behind it first, rather than turning straight at it.
    if (this.positioning && tail > -0.35 && d > 24 && speed > 1) aim = { x: t.x - (t.vx / speed) * 22, y: t.y + 2, z: t.z - (t.vz / speed) * 22 };
    const heading = this.anticipate(dt, headingTo(p, aim, 0.9));

    // Close in fast, then sit at gun distance behind it.
    let want = this.top();
    if (d < AI.gunDistance + 12 && dot(fwd, toward) > 0) want = Math.max(this.spec.flight.minSpeed, Math.min(want, speed + (d - AI.gunDistance) * 0.5));
    const boost = this.skill.boost && d > 70 && this.boostable;

    const toLead = { x: lead.x - p.x, y: lead.y - p.y, z: lead.z - p.z };
    const cone = this.skill.fireCone + Math.atan2(t.radius, d);
    const inReach = d < this.gun.spec.range * AI.gunReach;
    const fire = inReach && angleBetween(fwd, toLead) < cone && this.trigger();
    return { ...heading, speed: want, boost, fire, drop: false, done: false };
  }

  /**
   * The nose follows the aim with a lag, so in a turn it trails a point that is moving round. A
   * good pilot leads the aim by the turn it sees coming, as a player leads the mouse; how much is
   * part of its skill.
   */
  private anticipate(dt: number, heading: { yaw: number; pitch: number }): { yaw: number; pitch: number } {
    if (this.lastWant !== null && dt > 0) {
      const rate = wrapAngle(heading.yaw - this.lastWant) / dt;
      this.swing += (rate - this.swing) * (1 - Math.exp(-dt / 0.25));
    }
    this.lastWant = heading.yaw;
    const ahead = Math.max(-0.6, Math.min(0.6, (this.swing / this.spec.flight.aimGain) * this.skill.lead));
    return { yaw: heading.yaw + ahead, pitch: heading.pitch };
  }

  /** Overshot: extend straight out for a moment, a little off to one side, then come round again. */
  private reposition(_dt: number, world: AiWorld): Decision {
    const time = 1.4 + (this.skill.reaction > 0.5 ? 0.8 : 0);
    if (this.stateTime > time) {
      this.resumeAttack();
      return this.attack(0, world, this.contact());
    }
    return { yaw: this.model.yaw + 0.25 * this.jinkDir, pitch: 0.12, speed: this.top(), boost: this.skill.boost, fire: false, drop: false, done: false };
  }

  /** Scouts run for it (to their exit if they have a job to finish); others break hard for a moment. */
  private evade(dt: number, world: AiWorld, own: Contact): Decision {
    const p = this.model.position;
    if (this.role !== 'scout') {
      if (this.jinkLeft <= 0) {
        if (this.resume === 'attack') {
          this.resumeAttack();
          return this.attack(dt, world, own);
        }
        this.enter(this.resume);
        return this.patrol(0, world, own);
      }
      return this.jink(dt, { yaw: this.model.yaw, pitch: 0, speed: this.top(), boost: this.skill.boost, fire: false, drop: false, done: false });
    }
    // Spotted on a mission, a scout runs for its exit; one that can't shake a pursuer leaves too.
    if (this.purpose === 'mission' || this.stateTime > 8) {
      this.leave();
      return this.flyOut(dt, world);
    }
    const threat = this.nearestHostile(world, own, AI.safe) ?? (this.targetId ? find(world, this.targetId) : null);
    if (!threat || dist(p, threat) > AI.safe) {
      this.enter('patrol');
      return this.followRoute(world);
    }
    // Away from the threat, bent a little towards the way out.
    const away = { x: p.x - threat.x, z: p.z - threat.z };
    const awayLen = Math.hypot(away.x, away.z) || 1;
    const out = { x: this.orders.exit.x - p.x, z: this.orders.exit.z - p.z };
    const outLen = Math.hypot(out.x, out.z) || 1;
    const k = 0.35;
    const dir = { x: (away.x / awayLen) * (1 - k) + (out.x / outLen) * k, z: (away.z / awayLen) * (1 - k) + (out.z / outLen) * k };
    let decision: Decision = {
      yaw: Math.atan2(-dir.x, -dir.z),
      pitch: Math.max(-0.25, Math.min(0.25, (this.orders.route[0].y - p.y) * 0.05)),
      speed: this.top(),
      boost: this.skill.boost && this.boostable,
      fire: false,
      drop: false,
      done: false,
    };
    if (this.jinkLeft <= 0 && world.rng() < this.skill.evasive * dt * 1.5) this.startJink(world.rng, 'evade');
    if (this.jinkLeft > 0) decision = this.jink(dt, decision);
    return decision;
  }

  /** Breaking off: back towards what it guards or its route, ignoring everything for a while. */
  private disengage(world: AiWorld): Decision {
    if (this.stateTime > AI.disengageTime) {
      if (this.gun.empty && this.purpose !== 'mission') this.leave();
      else this.enter('patrol');
    }
    const decision = this.homeward(world);
    if (this.skill.cleanBreak) {
      decision.boost = this.boostable;
      decision.yaw += 0.35 * Math.sin(this.stateTime * 2.4);
    }
    return decision;
  }

  /** Lined up on the target at bombing height; releases when the bomb would land on it. */
  private bombRun(world: AiWorld): Decision {
    const s = this.orders.strike!;
    const p = this.model.position;
    const v = this.model.getVelocity(this.v);
    const aim = { x: s.x + this.bombAim.x, z: s.z + this.bombAim.z };
    const altitude = s.y + AI.bombingAltitude;
    const heading = headingTo(p, { x: aim.x, y: altitude, z: aim.z });
    const pitch = Math.max(-0.3, Math.min(0.3, (altitude - p.y) * 0.08));
    const hang = { x: p.x, y: p.y - BOMB.hangOffset, z: p.z };
    const impact = predictImpact(hang, v, s.y);
    const speed = Math.hypot(v.x, v.z) || 1;
    const fx = v.x / speed;
    const fz = v.z / speed;
    const along = (aim.x - impact.x) * fx + (aim.z - impact.z) * fz;
    const cross = Math.abs((aim.x - impact.x) * -fz + (aim.z - impact.z) * fx);
    let drop = false;
    if (along <= 0.6 && cross <= s.radius * 0.7 + 0.8 && this.bombs > 0) {
      drop = true;
      this.enter('egress');
    } else if (along < -s.radius * 2) {
      this.goAround(world);
    }
    return { yaw: heading.yaw, pitch, speed: this.cruise(), boost: false, fire: false, drop, done: false };
  }

  /** After the release: away from the target, then home, or round again after a miss with bombs left. */
  private egress(world: AiWorld, own: Contact): Decision {
    if (this.strike === 'miss' && this.bombs > 0) {
      this.goAround(world);
      return this.followRoute(world);
    }
    if (this.strike === 'hit' || this.bombs === 0 || this.side === 'enemy' || this.stateTime > 8) this.leave();
    const decision: Decision = { yaw: this.model.yaw, pitch: 0.15, speed: this.cruise(), boost: false, fire: false, drop: false, done: false };
    decision.fire = this.opportunisticFire(world, own);
    return decision;
  }

  /** Heading out of the world through its exit; a scout with someone after it runs flat out and jinks. */
  private flyOut(dt: number, world: AiWorld): Decision {
    const p = this.model.position;
    let decision: Decision = { ...headingTo(p, this.orders.exit, 0.35), speed: this.cruise(), boost: false, fire: false, drop: false, done: false };
    if (this.role === 'bomber') decision.fire = this.opportunisticFire(world, this.contact());
    if (this.role === 'scout' && this.nearestHostile(world, this.contact(), AI.safe)) {
      decision.speed = this.top();
      decision.boost = this.skill.boost && this.boostable;
      if (this.jinkLeft <= 0 && world.rng() < this.skill.evasive * dt) this.startJink(world.rng, 'leave');
      if (this.jinkLeft > 0) decision = this.jink(dt, decision);
    }
    return decision;
  }

  // ---- Pilot helpers --------------------------------------------------------------------------

  private enter(state: AiState): void {
    this.state = state;
    this.stateTime = 0;
    if (state === 'bomb-run') {
      // A steady run: no jinking, and the pilot's idea of the release point is only so good.
      const e = this.skill.bombError;
      this.jinkLeft = 0;
      this.bombAim = { x: (this.rng() + this.rng() - 1) * e, z: (this.rng() + this.rng() - 1) * e };
    }
    if (state === 'egress') this.strike = 'falling';
    if (state === 'patrol' || state === 'disengage' || state === 'bomb-run') this.targetId = null;
  }

  private breakOff(world: AiWorld): Decision {
    this.track.reset();
    this.enter('disengage');
    return this.disengage(world);
  }

  /** Flies towards the next waypoint; `done` once the last one of a one-way route is reached. */
  private followRoute(_world: AiWorld): Decision {
    const p = this.model.position;
    const route = this.route;
    let target = route[this.waypoint] ?? this.orders.exit;
    if (this.waypoint < route.length && Math.hypot(target.x - p.x, target.z - p.z) < AI.waypointReach) {
      this.waypoint++;
      // Round again, without going back out to where it came in.
      if (this.waypoint >= route.length && this.orders.loop) this.waypoint = route.length > 2 ? 1 : 0;
      target = route[this.waypoint] ?? this.orders.exit;
    }
    const done = this.waypoint >= route.length;
    return { ...headingTo(p, target, 0.4), speed: this.cruise(), boost: false, fire: false, drop: false, done };
  }

  /** Off the bomber's wing: right, a little above and behind, matching its speed. */
  private holdFormation(bomber: Contact): Decision {
    const p = this.model.position;
    const speed = Math.hypot(bomber.vx, bomber.vz) || 1;
    const fx = bomber.vx / speed;
    const fz = bomber.vz / speed;
    const [right, up, back] = AI.formation;
    const slot = { x: bomber.x - fz * right - fx * back, y: bomber.y + up, z: bomber.z + fx * right - fz * back };
    const gap = (slot.x - p.x) * fx + (slot.z - p.z) * fz;
    return { ...headingTo(p, { x: slot.x + fx * 20, y: slot.y, z: slot.z + fz * 20 }, 0.4), speed: Math.max(this.spec.flight.minSpeed, speed + gap * 0.4), boost: false, fire: false, drop: false, done: false };
  }

  /** Where to go when not fighting: its guard area, its bomber's wing, or back along its route. */
  private homeward(world: AiWorld): Decision {
    const p = this.model.position;
    const bomber = this.orders.escort ? find(world, this.orders.escort) : null;
    if (bomber) return this.holdFormation(bomber);
    const guard = this.orders.guard;
    if (guard) return { ...headingTo(p, { x: guard.x, y: AI.patrolAltitude[1], z: guard.z }, 0.4), speed: this.top(), boost: false, fire: false, drop: false, done: false };
    return this.followRoute(world);
  }

  /** Fighters: the aircraft to go after, if any. */
  private pickTarget(world: AiWorld, own: Contact): Contact | null {
    if (this.gun.empty) return null;
    const p = this.model.position;
    const prey = this.orders.prey ? find(world, this.orders.prey) : null;
    // Whoever just shot at us comes first.
    if (this.lastHitBy && this.sinceHit < 3) {
      const shooter = find(world, this.lastHitBy);
      if (shooter && shooter.side !== this.side && !shooter.shielded && this.mayChase(world, shooter)) return shooter;
    }
    let best: Contact | null = null;
    let bestScore = Infinity;
    const bomber = this.orders.escort ? find(world, this.orders.escort) : null;
    for (const c of world.contacts) {
      if (c.side === this.side || c.shielded || c.id === own.id) continue;
      if (!this.mayChase(world, c)) continue;
      const range = AI.detection * c.signature;
      const near = dist(p, c) <= range || (bomber !== null && dist(bomber, c) <= range * 0.8);
      if (!near && c !== prey) continue;
      // The prey is wanted most; otherwise the nearest.
      const score = dist(p, c) * (c === prey ? 0.4 : 1);
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  /** May it chase `c` (or keep chasing)? Not too far from where it started, from what it guards, or into home. */
  private mayChase(world: AiWorld, c: Contact): boolean {
    const p = this.model.position;
    if (this.state === 'attack' && dist(p, this.chaseFrom) > AI.maxPursuit) return false;
    if (this.state === 'attack' && this.skill.disengageHealth > 0 && this.durability.fraction < this.skill.disengageHealth) return false;
    if (this.gun.empty) return false;
    const guard = this.orders.guard;
    if (guard && Math.hypot(c.x - guard.x, c.z - guard.z) > AI.leash) return false;
    const bomber = this.orders.escort ? find(world, this.orders.escort) : null;
    if (bomber && dist(bomber, c) > AI.leash) return false;
    if (this.side === 'enemy' && this.purpose !== 'raid' && world.home.containsXZ(c.x, c.z, DEFENSES.homeSafeMargin + HOME_AVOID)) return false;
    return true;
  }

  /** The nearest aircraft of the other side within `range` (times its signature). */
  private nearestHostile(world: AiWorld, own: Contact, range: number): Contact | null {
    let best: Contact | null = null;
    let bestDistance = Infinity;
    for (const c of world.contacts) {
      if (c.side === this.side || c.id === own.id) continue;
      const d = dist(own, c);
      if (d <= range * c.signature && d < bestDistance) {
        best = c;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Is an aircraft of the other side close behind, pointing at us? */
  private onMyTail(world: AiWorld, own: Contact): boolean {
    const fwd = this.model.getForward(this.f);
    for (const c of world.contacts) {
      if (c.side === this.side || c.id === own.id) continue;
      const d = dist(own, c);
      if (d > 40) continue;
      const toThem = { x: c.x - own.x, y: c.y - own.y, z: c.z - own.z };
      const speed = Math.hypot(c.vx, c.vy, c.vz) || 1;
      const theirFwd = { x: c.vx / speed, y: c.vy / speed, z: c.vz / speed };
      if (dot(fwd, toThem) < -0.3 * d && dot(theirFwd, { x: -toThem.x / d, y: -toThem.y / d, z: -toThem.z / d }) > 0.9) return true;
    }
    return false;
  }

  /** Bombers' nose guns: a burst at anything hostile that happens to be in front, without turning for it. */
  private opportunisticFire(world: AiWorld, own: Contact): boolean {
    if (this.gun.empty) return false;
    const p = this.model.position;
    const fwd = this.model.getForward(this.f);
    for (const c of world.contacts) {
      if (c.side === this.side || c.shielded || c.id === own.id) continue;
      const d = dist(p, c);
      if (d > this.gun.spec.range * AI.gunReach) continue;
      if (angleBetween(fwd, { x: c.x - p.x, y: c.y - p.y, z: c.z - p.z }) > this.skill.fireCone * 2 + Math.atan2(c.radius, d)) continue;
      if (this.targetId !== c.id) {
        this.targetId = c.id;
        this.track.reset();
      }
      return this.trigger();
    }
    return false;
  }

  private startJink(rng: Rng, resume: AiState): void {
    this.jinkLeft = AI.jink * (0.7 + 0.6 * rng());
    this.jinkDir = rng() < 0.5 ? -1 : 1;
    this.jinkPitch = (rng() - 0.4) * 0.5;
    this.resume = resume;
  }

  /** A hard turn to one side (and a little up or down), on top of whatever it was doing. */
  private jink(dt: number, d: Decision): Decision {
    this.jinkLeft -= dt;
    return { ...d, yaw: this.model.yaw + 1.2 * this.jinkDir, pitch: this.jinkPitch, boost: this.skill.boost && this.boostable };
  }

  /** Trigger discipline: short bursts with pauses in between. */
  private trigger(): boolean {
    if (this.burstLeft > 0) return true;
    if (this.pauseLeft > 0) return false;
    this.burstLeft = this.skill.burst;
    this.pauseLeft = this.skill.burst + this.skill.pause;
    return true;
  }

  /** A new route: out past the target and back round for another run. */
  private goAround(world: AiWorld): void {
    const s = this.orders.strike!;
    const p = this.model.position;
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const side = world.rng() < 0.5 ? -1 : 1;
    const altitude = s.y + AI.bombingAltitude + 4;
    this.route = [
      { x: p.x, y: p.y, z: p.z },
      { x: s.x + fx * 45 - fz * 30 * side, y: altitude, z: s.z + fz * 45 + fx * 30 * side },
      { x: s.x + fx * 20 - fz * 60 * side, y: altitude, z: s.z + fz * 20 + fx * 60 * side },
      { x: s.x - fx * 10 - fz * AI.runIn * side, y: altitude, z: s.z - fz * 10 + fx * AI.runIn * side },
    ];
    this.waypoint = 1;
    this.strike = 'none';
    this.enter('patrol');
  }

  // ---- Flying ---------------------------------------------------------------------------------

  /** The boost can be used (or kept going): holding it is what keeps a burst going. */
  private get boostable(): boolean {
    return this.model.boost.state !== 'cooldown';
  }

  private cruise(): number {
    return this.orders.speed ?? this.spec.flight.cruiseSpeed;
  }

  /** As fast as this pilot pushes it. */
  private top(): number {
    const f = this.spec.flight;
    return f.cruiseSpeed + (f.maxSpeed - f.cruiseSpeed) * this.skill.throttle;
  }

  private throttleFor(speed: number): number {
    return Math.max(-1, Math.min(1, (speed - this.model.throttleSpeed) / 3));
  }

  /**
   * Collision avoidance on top of what the pilot wants: climb away from platforms ahead, keep
   * clear of other aircraft, keep enemy aircraft off home (raiders excepted), and stay in the
   * world unless leaving it.
   */
  private avoid(yaw: number, pitch: number, world: AiWorld): { yaw: number; pitch: number } {
    const p = this.model.position;
    const v = this.model.getVelocity(this.v);
    let dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };

    // Other aircraft: look a moment ahead for how close each will come, and steer away from that
    // point, harder the closer it is. Head-on meetings split up and down as well as sideways.
    for (const c of world.contacts) {
      if (c.id === this.id) continue;
      const keep = c.id === this.targetId ? AI.separation * 0.6 : AI.separation;
      const r = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
      if (Math.hypot(r.x, r.y, r.z) > keep + 40) continue;
      const w = { x: v.x - c.vx, y: v.y - c.vy, z: v.z - c.vz };
      const ww = dot(w, w);
      const t = ww > 1e-6 ? Math.max(0, Math.min(1.2, -dot(r, w) / ww)) : 0;
      const near = { x: r.x + w.x * t, y: r.y + w.y * t, z: r.z + w.z * t };
      const d = Math.hypot(near.x, near.y, near.z);
      if (d >= keep) continue;
      const push = ((keep - d) / keep) * 2.5;
      const n = d > 1e-3 ? { x: near.x / d, y: near.y / d, z: near.z / d } : { x: 0, y: this.id < c.id ? 1 : -1, z: 0 };
      const up = Math.abs(n.y) < 0.3 ? (this.id < c.id ? 0.6 : -0.6) : 0;
      dir = { x: dir.x + n.x * push, y: dir.y + (n.y + up) * push, z: dir.z + n.z * push };
    }
    // Enemy patrols keep off home.
    if (this.side === 'enemy' && this.purpose !== 'raid' && world.home.containsXZ(p.x, p.z, DEFENSES.homeSafeMargin + HOME_AVOID)) {
      const len = Math.hypot(world.home.x, world.home.z) || 1;
      dir = { x: dir.x - (world.home.x / len) * 1.5, y: dir.y, z: dir.z - (world.home.z / len) * 1.5 };
    }
    // Back into the world, unless leaving it.
    const r = Math.hypot(p.x, p.z);
    if (this.state !== 'leave' && r > WORLD.boundaryRadius - 10 && this.age > 6) {
      dir = { x: dir.x - (p.x / r) * 1.2, y: dir.y, z: dir.z - (p.z / r) * 1.2 };
    }
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const outYaw = Math.atan2(-dir.x, -dir.z);
    let outPitch = Math.asin(Math.max(-1, Math.min(1, dir.y / len)));

    // Platforms ahead: climb, harder the deeper the trouble. Fighters follow a target lower.
    const floor = this.state === 'attack' ? this.skill.floor : this.state === 'bomb-run' ? Math.min(AI.clearance, AI.bombingAltitude - 2) : AI.clearance;
    const below = terrainAhead(world.territories, p, v, floor);
    if (below > 0) outPitch = Math.max(outPitch, Math.min(0.9, 0.2 + below * 0.1));
    return { yaw: outYaw, pitch: outPitch };
  }

  /** Fires one round along the nose, scattered by the pilot's aim. */
  private shoot(world: AiWorld): ShotOrder[] {
    const barrel = this.gun.fire();
    if (barrel === null) return [];
    const m = this.model;
    const [lx, ly, lz] = PLANE_SHAPES[this.spec.id].muzzles[barrel % PLANE_SHAPES[this.spec.id].muzzles.length];
    const muzzle = m.toWorld(lx, ly, lz, this.muzzle);
    const fwd = m.getForward(this.f);
    // Towards where the guns converge, like the player's.
    const aim = { x: m.position.x + fwd.x * WEAPONS.convergence - muzzle.x, y: m.position.y + fwd.y * WEAPONS.convergence - muzzle.y, z: m.position.z + fwd.z * WEAPONS.convergence - muzzle.z };
    const len = Math.hypot(aim.x, aim.y, aim.z) || 1;
    const t = this.targetId ? find(world, this.targetId) : null;
    const v = m.getVelocity(this.v);
    const spread = t
      ? aimSpread(this.skill, dist(m.position, t), Math.hypot(t.vx - v.x, t.vy - v.y, t.vz - v.z), this.track.turnRate, this.track.time)
      : this.skill.aimError * 3;
    const dir = scatter({ x: aim.x / len, y: aim.y / len, z: aim.z / len }, spread, world.rng);
    const g = this.gun.spec;
    return [{
      kind: 'ink', source: this.id, side: this.side, target: this.targetId,
      x: muzzle.x, y: muzzle.y, z: muzzle.z,
      vx: dir.x * g.speed + v.x, vy: dir.y * g.speed + v.y, vz: dir.z * g.speed + v.z,
      damage: g.damage, travel: g.range, radius: WEAPONS.projectileRadius,
    }];
  }

  private drop(): BombOrder | null {
    if (this.bombs <= 0 || !this.orders.strike) return null;
    this.bombs--;
    this.released = true;
    const p = this.model.position;
    const v = this.model.getVelocity(this.v);
    return { source: this.id, side: this.side, x: p.x, y: p.y - BOMB.hangOffset, z: p.z, vx: v.x, vy: v.y, vz: v.z, strike: this.orders.strike };
  }

  /** Has it flown out of the world? */
  get gone(): boolean {
    return this.state === 'leave' && beyondEdge(this.model.position.x, this.model.position.z);
  }
}

interface Decision {
  yaw: number;
  pitch: number;
  speed: number;
  boost: boolean;
  fire: boolean;
  drop: boolean;
  /** The end of a one-way route was reached. */
  done: boolean;
}

function find(world: AiWorld, id: string): Contact | null {
  return world.contacts.find((c) => c.id === id) ?? null;
}

function dist(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
