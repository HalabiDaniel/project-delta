import { randomUUID } from 'node:crypto';
import { COOP } from '../../src/config';

/** v0.0.19: who may fly escort on a player's bombing missions: their allies (the default), anyone, or nobody. */
export type EscortWelcome = 'allies' | 'anyone' | 'none';
export const ESCORT_WELCOMES: readonly EscortWelcome[] = ['allies', 'anyone', 'none'];

/** A joint attack: two players offered the same target on a powerful player (plan §3A). */
export interface JointAttack {
  id: number;
  uid: string;
  target: string;
  targetName: string;
  /** Their bomber in the air, or one of their exposed installations. */
  kind: 'bomber' | 'installation';
  installation?: { id: string; name: string; territoryId: string };
  members: string[];
  pot: number;
  placedAt: number;
  expires: number;
  readonly damage: Map<string, number>;
  status: 'open' | 'paid' | 'expired' | 'cancelled';
}

/**
 * The books for cooperation between players (plan v0.0.19 §3, GDD §11.7): who welcomes escorts on
 * their missions, how much of a bomber's flight each escort spent close to it, and the joint attacks
 * the director has offered. The world decides who is offered what (it knows the players and the
 * protections); this class keeps the numbers that decide what each one is paid.
 */
export class CoopBook {
  private readonly welcome = new Map<string, EscortWelcome>();
  /** "escort>bomber" → seconds the escort has flown its card, and seconds of it within COOP.escortRange. */
  private readonly presence = new Map<string, { flown: number; near: number }>();
  readonly joints: JointAttack[] = [];
  private readonly ended = new Map<string, number>();
  private nextId = 1;

  welcomes(id: string): EscortWelcome {
    return this.welcome.get(id) ?? 'allies';
  }

  setWelcome(id: string, w: EscortWelcome): void {
    this.welcome.set(id, w);
  }

  /** One more `dt` of an escort's flight next to (or away from) the bomber it escorts. */
  fly(escort: string, bomber: string, near: boolean, dt: number): void {
    const key = `${escort}>${bomber}`;
    const p = this.presence.get(key) ?? { flown: 0, near: 0 };
    p.flown += dt;
    if (near) p.near += dt;
    this.presence.set(key, p);
  }

  /** The share of the escort's flight spent next to the bomber (0–1). */
  presenceOf(escort: string, bomber: string): number {
    const p = this.presence.get(`${escort}>${bomber}`);
    return p && p.flown > 0 ? p.near / p.flown : 0;
  }

  /** What escorting paid: COOP.escortReward scaled by presence, nothing below COOP.minPresence. */
  static escortPay(presence: number): number {
    if (presence < COOP.minPresence) return 0;
    return Math.round(COOP.escortReward * Math.min(1, presence));
  }

  /** Forgets an escort's record (paid, or the sortie is over). */
  clearPresence(escort: string, bomber?: string): void {
    for (const k of [...this.presence.keys()]) if (k.startsWith(`${escort}>`) && (!bomber || k === `${escort}>${bomber}`)) this.presence.delete(k);
  }

  /** Why a joint attack on `target` can't be offered now, or null. */
  jointRefusal(target: string, now: number): 'open' | 'cooldown' | 'full' | null {
    if (this.joints.some((j) => j.target === target)) return 'open';
    const last = this.ended.get(target);
    if (last !== undefined && now - last < COOP.jointCooldown) return 'cooldown';
    if (this.joints.length >= COOP.maxJoint) return 'full';
    return null;
  }

  offerJoint(target: string, targetName: string, kind: JointAttack['kind'], members: string[], now: number, installation?: JointAttack['installation']): JointAttack | null {
    if (this.jointRefusal(target, now) || members.length < 2) return null;
    const j: JointAttack = {
      id: this.nextId++, uid: randomUUID(), target, targetName, kind, installation, members: [...members], pot: COOP.jointPot,
      placedAt: now, expires: now + COOP.jointTime, damage: new Map(), status: 'open',
    };
    this.joints.push(j);
    return j;
  }

  joint(id: number): JointAttack | undefined {
    return this.joints.find((j) => j.id === id);
  }

  jointOn(target: string): JointAttack | undefined {
    return this.joints.find((j) => j.target === target);
  }

  jointOnInstallation(id: string): JointAttack | undefined {
    return this.joints.find((j) => j.installation?.id === id);
  }

  contribute(j: JointAttack, player: string, amount: number): void {
    if (amount > 0 && j.members.includes(player)) j.damage.set(player, (j.damage.get(player) ?? 0) + amount);
  }

  closeJoint(j: JointAttack, status: Exclude<JointAttack['status'], 'open'>, now: number): void {
    const i = this.joints.indexOf(j);
    if (i < 0) return;
    this.joints.splice(i, 1);
    j.status = status;
    this.ended.set(j.target, now);
  }

  /** The player left: their preferences and records go with them. */
  remove(id: string): void {
    this.welcome.delete(id);
    this.clearPresence(id);
    for (const k of [...this.presence.keys()]) if (k.endsWith(`>${id}`)) this.presence.delete(k);
  }
}
