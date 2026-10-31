import { BASE, ECONOMY, type BuildingKind, type BuildingLevel, type Side, type SlotKind } from '../config';
import type { DefenseNetwork, Installation } from '../defenses/Installation';
import { buildingSpec, homeDefenses } from '../defenses/Layout';
import type { ResourceManager } from '../systems/ResourceManager';
import type { Territory } from '../world/Territory';

/** ok – full health. damaged – standing, but hurt. destroyed – a wreck: it does nothing until repaired. */
export type StructureStatus = 'ok' | 'damaged' | 'destroyed';

/** The paper store's key, where a slot id would go for a building. */
export const STORE = 'store';

/** A building the player put up in one of T1's slots. Its health lives in the defense network. */
export interface Building {
  slot: string;
  kind: BuildingKind;
  level: number;
  /** Paper put into it: its cost plus every upgrade. Repairs and refunds are worked out from it. */
  invested: number;
  /** Aircraft it shot down, how many of those were bombers, and damage it dealt to them. */
  kills: number;
  bombers: number;
  damage: number;
}

/** What the base has been through, for the logbook. */
export interface BaseStats {
  /** Raids on T1 that reached detection, and those beaten off without a bomb on target. */
  raids: number;
  repelled: number;
  /** Aircraft (and bombers among them) T1's defenses shot down or finished off. */
  aircraftDowned: number;
  bombersDowned: number;
  paperLost: number;
  /** Paper spent on new buildings and upgrades, and on repairs. */
  construction: number;
  repairCosts: number;
  /** Paper the workshops added on top of base production. */
  workshopPaper: number;
  /** Structures repaired (each building counts once per repair). */
  repairs: number;
  refunds: number;
}

export const emptyBaseStats = (): BaseStats => ({
  raids: 0, repelled: 0, aircraftDowned: 0, bombersDowned: 0, paperLost: 0, construction: 0, repairCosts: 0, workshopPaper: 0, repairs: 0, refunds: 0,
});

export interface BaseSave {
  buildings: Array<Building & { health: number }>;
  /** The paper store's health. */
  store: number;
  stats: BaseStats;
}

/**
 * Why an action can't be done. paper – not enough (see `missing`). slot – the building doesn't go
 * in that kind of slot, or the slot is taken/empty. unique – only one of these per territory.
 * max-level – fully upgraded. destroyed – repair it first. intact – nothing to repair.
 */
export type Refusal = 'paper' | 'slot' | 'unique' | 'max-level' | 'destroyed' | 'intact';

export interface Check {
  ok: boolean;
  reason: Refusal | null;
  cost: number;
  /** Paper still needed when the reason is `paper`. */
  missing: number;
}

export type BaseEvent =
  | { type: 'built'; slot: string; kind: BuildingKind; cost: number }
  | { type: 'upgraded'; slot: string; kind: BuildingKind; level: number; cost: number }
  /** Keys (slot ids or STORE) of what was repaired. */
  | { type: 'repaired'; keys: string[]; cost: number }
  | { type: 'removed'; slot: string; kind: BuildingKind; refund: number }
  | { type: 'refused'; reason: Refusal; missing: number };

/** Effects of one level of a building, for comparing before building or upgrading. */
export function levelOf(kind: BuildingKind, level: number): BuildingLevel {
  const levels = BASE.buildings[kind].levels;
  return levels[Math.max(1, Math.min(levels.length, level)) - 1];
}

/** Can `kind` go in a slot of this kind? */
export function fits(kind: BuildingKind, slot: SlotKind): boolean {
  return BASE.buildings[kind].slots.includes(slot);
}

/**
 * The player's home territory as a base: its construction slots, what stands in them, and what
 * that does for the economy (production, capacity, protected paper) and for defense (weapons,
 * radar). Buildings are installations in the defense network, so they shoot, get bombed and are
 * wrecked like any other; the base adds paying for them, upgrading, repairing and removing, and
 * remembers what each one has done. Nothing here renders: the game shows it.
 *
 * Damage stays until the player pays for repairs: a damaged workshop produces less, a damaged
 * storage box protects less, and a wreck does nothing at all.
 */
export class Base {
  readonly buildings = new Map<string, Building>();
  stats: BaseStats = emptyBaseStats();
  private readonly listeners: Array<(e: BaseEvent) => void> = [];

  constructor(
    readonly home: Territory,
    readonly network: DefenseNetwork,
    readonly resources: ResourceManager,
    /** Whose base it is: the player's in single-player, `p:<id>` in multiplayer. */
    readonly side: Side = 'player',
  ) {
    // The paper store always stands on T1 (it comes with the world's layout).
    if (!network.get(this.idOf(STORE))) for (const spec of homeDefenses(home, side)) network.add(spec);
  }

  // ---- Queries ----------------------------------------------------------------------------------

  /** The installation id for a slot (or the store). */
  idOf(key: string): string {
    return `${this.home.id}-${key}`;
  }

  /** The slot (or STORE) an installation id belongs to, or null if it isn't one of the base's. */
  keyOf(installationId: string): string | null {
    const prefix = `${this.home.id}-`;
    if (!installationId.startsWith(prefix)) return null;
    const key = installationId.slice(prefix.length);
    return key === STORE || BASE.slots.some((s) => s.id === key) ? key : null;
  }

  slotKind(slot: string): SlotKind | null {
    return BASE.slots.find((s) => s.id === slot)?.kind ?? null;
  }

  at(slot: string): Building | null {
    return this.buildings.get(slot) ?? null;
  }

  installation(key: string): Installation | undefined {
    return this.network.get(this.idOf(key));
  }

  get store(): Installation {
    return this.installation(STORE)!;
  }

  status(key: string): StructureStatus {
    const i = this.installation(key);
    if (!i || !i.alive) return 'destroyed';
    return i.durability.health >= i.durability.max ? 'ok' : 'damaged';
  }

  /** 0 for a wreck, else its share of health. */
  strength(key: string): number {
    const i = this.installation(key);
    return i && i.alive ? i.durability.fraction : 0;
  }

  /** How many of `kind` stand (or lie wrecked) on the base. */
  count(kind: BuildingKind): number {
    return [...this.buildings.values()].filter((b) => b.kind === kind).length;
  }

  /** Paper put into it (the store counts at a fixed value). */
  valueOf(key: string): number {
    return key === STORE ? BASE.storeValue : (this.buildings.get(key)?.invested ?? 0);
  }

  // ---- Effects ----------------------------------------------------------------------------------

  /** Paper per minute before any low-balance boost: base production plus the workshops' share. */
  get production(): number {
    const base = BASE.production * (this.store.alive ? 1 : BASE.wreckedStore);
    return base + this.workshopProduction;
  }

  /** What the workshops add, each by its level and condition. */
  get workshopProduction(): number {
    let bonus = 0;
    for (const b of this.buildings.values()) if (b.kind === 'workshop') bonus += (levelOf('workshop', b.level).production ?? 0) * this.strength(b.slot);
    return Math.round(bonus * 10) / 10;
  }

  /** The most paper T1 holds: the base capacity plus every standing storage box. */
  get capacity(): number {
    let capacity = BASE.capacity;
    for (const b of this.buildings.values()) if (b.kind === 'storage' && this.status(b.slot) !== 'destroyed') capacity += levelOf('storage', b.level).capacity ?? 0;
    return capacity;
  }

  /**
   * Paper raids can never take: the guaranteed reserve (enough for a starter plane), plus what
   * the storage boxes protect, by their condition. Damage exposes it.
   */
  get protectedPaper(): number {
    let safe: number = ECONOMY.protectedPaper;
    for (const b of this.buildings.values()) if (b.kind === 'storage') safe += Math.floor((levelOf('storage', b.level).protection ?? 0) * this.strength(b.slot));
    return safe;
  }

  /** Paper above the protected reserve: what a raid can destroy. */
  vulnerable(paper = this.resources.paper): number {
    return Math.max(0, paper - this.protectedPaper);
  }

  /** The radar station, standing or not, if one is built. */
  get radar(): Installation | null {
    const b = [...this.buildings.values()].find((x) => x.kind === 'radar');
    return b ? (this.installation(b.slot) ?? null) : null;
  }

  /** How far from T1's middle raiders are noticed: the radar's range while it stands, else close in. */
  get detectionRange(): number {
    const radar = this.radar;
    return radar?.alive ? Math.max(BASE.detection, radar.spec.range) : BASE.detection;
  }

  /** Weapons that can fight (standing), out of all weapons built. */
  get readiness(): { ready: number; total: number; damaged: number; destroyed: number } {
    let ready = 0;
    let total = 0;
    let damaged = 0;
    let destroyed = 0;
    for (const b of this.buildings.values()) {
      if (b.kind !== 'turret' && b.kind !== 'launcher') continue;
      total++;
      const s = this.status(b.slot);
      if (s === 'destroyed') destroyed++;
      else ready++;
      if (s === 'damaged') damaged++;
    }
    return { ready, total, damaged, destroyed };
  }

  /** Every structure's health together, 0–1 (wrecks count as 0). */
  get integrity(): number {
    let health = 0;
    let max = 0;
    for (const key of [STORE, ...this.buildings.keys()]) {
      const i = this.installation(key);
      if (!i) continue;
      health += i.alive ? i.durability.health : 0;
      max += i.durability.max;
    }
    return max > 0 ? health / max : 1;
  }

  /** Keys of everything damaged or wrecked, the store included. */
  get needsRepair(): string[] {
    return [STORE, ...this.buildings.keys()].filter((k) => this.status(k) !== 'ok');
  }

  // ---- Prices -----------------------------------------------------------------------------------

  canBuild(slot: string, kind: BuildingKind): Check {
    const slotKind = this.slotKind(slot);
    const cost = levelOf(kind, 1).cost;
    if (!slotKind || this.buildings.has(slot) || !fits(kind, slotKind)) return refuse('slot', cost);
    if (BASE.unique.includes(kind) && this.count(kind) > 0) return refuse('unique', cost);
    return this.afford(cost);
  }

  canUpgrade(slot: string): Check {
    const b = this.buildings.get(slot);
    if (!b) return refuse('slot', 0);
    if (b.level >= BASE.buildings[b.kind].levels.length) return refuse('max-level', 0);
    const cost = levelOf(b.kind, b.level + 1).cost;
    if (this.status(slot) === 'destroyed') return refuse('destroyed', cost);
    return this.afford(cost);
  }

  /**
   * What repairing costs: a share of the building's value for the share of health missing, or a
   * larger share to bring a wreck back (still cheaper than building it again). 0 when intact.
   */
  repairCost(key: string): number {
    const i = this.installation(key);
    if (!i) return 0;
    const value = this.valueOf(key);
    if (!i.alive) return Math.max(1, Math.ceil(value * BASE.rebuildShare));
    const missing = 1 - i.durability.fraction;
    return missing <= 0 ? 0 : Math.max(1, Math.ceil(value * BASE.repairShare * missing));
  }

  canRepair(key: string): Check {
    const cost = this.repairCost(key);
    if (cost <= 0) return refuse('intact', 0);
    return this.afford(cost);
  }

  get repairAllCost(): number {
    return this.needsRepair.reduce((sum, k) => sum + this.repairCost(k), 0);
  }

  /** Paper given back for removing what stands in `slot`: a share of what was put in, by its condition. */
  refundFor(slot: string): number {
    const b = this.buildings.get(slot);
    if (!b) return 0;
    return Math.floor(b.invested * BASE.refund * this.strength(slot));
  }

  // ---- Actions ----------------------------------------------------------------------------------

  /** Builds `kind` in an empty slot that takes it, for its cost. */
  build(slot: string, kind: BuildingKind): boolean {
    const check = this.canBuild(slot, kind);
    if (!check.ok) return this.refused(check);
    this.resources.spend(check.cost, `Built ${BASE.buildings[kind].name}`);
    this.stats.construction += check.cost;
    this.put({ slot, kind, level: 1, invested: check.cost, kills: 0, bombers: 0, damage: 0 });
    this.emit({ type: 'built', slot, kind, cost: check.cost });
    return true;
  }

  /** One level up, keeping its share of health. */
  upgrade(slot: string): boolean {
    const check = this.canUpgrade(slot);
    if (!check.ok) return this.refused(check);
    const b = this.buildings.get(slot)!;
    this.resources.spend(check.cost, `Upgraded ${BASE.buildings[b.kind].name}`);
    this.stats.construction += check.cost;
    b.level++;
    b.invested += check.cost;
    this.network.replace(buildingSpec(this.home, slot, b.kind, b.level, this.side));
    this.emit({ type: 'upgraded', slot, kind: b.kind, level: b.level, cost: check.cost });
    return true;
  }

  /** Back to full health (a wreck comes back standing). */
  repair(key: string): boolean {
    const check = this.canRepair(key);
    if (!check.ok) return this.refused(check);
    this.resources.spend(check.cost, `Repaired ${this.nameOf(key)}`);
    this.restore(key);
    this.stats.repairCosts += check.cost;
    this.stats.repairs++;
    this.emit({ type: 'repaired', keys: [key], cost: check.cost });
    return true;
  }

  /** Repairs everything that needs it, if the paper covers all of it. */
  repairAll(): boolean {
    const keys = this.needsRepair;
    const cost = keys.reduce((sum, k) => sum + this.repairCost(k), 0);
    if (keys.length === 0) return this.refused(refuse('intact', 0));
    const check = this.afford(cost);
    if (!check.ok) return this.refused(check);
    this.resources.spend(cost, keys.length === 1 ? `Repaired ${this.nameOf(keys[0])}` : `Repaired ${keys.length} structures`);
    for (const k of keys) this.restore(k);
    this.stats.repairCosts += cost;
    this.stats.repairs += keys.length;
    this.emit({ type: 'repaired', keys, cost });
    return true;
  }

  /** Takes a building down, for a partial refund. The slot is free again. */
  remove(slot: string): boolean {
    const b = this.buildings.get(slot);
    if (!b) return this.refused(refuse('slot', 0));
    const refund = this.refundFor(slot);
    this.buildings.delete(slot);
    this.network.remove(this.idOf(slot));
    if (refund > 0) this.resources.earn(refund, 'refund', `Removed ${BASE.buildings[b.kind].name}`);
    this.stats.refunds += refund;
    this.emit({ type: 'removed', slot, kind: b.kind, refund });
    return true;
  }

  // ---- Bookkeeping --------------------------------------------------------------------------------

  /** One of the base's weapons shot down (or finished off) an aircraft. */
  recordKill(installationId: string, bomber: boolean): void {
    const key = this.keyOf(installationId);
    const b = key ? this.buildings.get(key) : undefined;
    if (!b) return;
    b.kills++;
    if (bomber) b.bombers++;
    this.stats.aircraftDowned++;
    if (bomber) this.stats.bombersDowned++;
  }

  recordDamage(installationId: string, amount: number): void {
    const key = this.keyOf(installationId);
    const b = key ? this.buildings.get(key) : undefined;
    if (b) b.damage += Math.round(amount);
  }

  /** The production that came from workshops, as paper is paid out (`paid` this frame). */
  recordIncome(paid: number): void {
    if (paid <= 0) return;
    const total = this.production;
    if (total > 0) this.stats.workshopPaper += (paid * this.workshopProduction) / total;
  }

  onEvent(listener: (e: BaseEvent) => void): void {
    this.listeners.push(listener);
  }

  nameOf(key: string): string {
    if (key === STORE) return this.store.spec.name;
    const b = this.buildings.get(key);
    return b ? BASE.buildings[b.kind].name : key;
  }

  // ---- Saving -------------------------------------------------------------------------------------

  save(): BaseSave {
    return {
      buildings: [...this.buildings.values()].map((b) => ({ ...b, health: this.installation(b.slot)?.durability.health ?? 0 })),
      store: this.store.durability.health,
      stats: { ...this.stats, workshopPaper: Math.round(this.stats.workshopPaper) },
    };
  }

  /** Puts a saved base back up (replacing whatever stands now). */
  load(save: BaseSave): void {
    for (const slot of [...this.buildings.keys()]) {
      this.buildings.delete(slot);
      this.network.remove(this.idOf(slot));
    }
    for (const b of save.buildings) {
      const slotKind = this.slotKind(b.slot);
      if (!slotKind || !fits(b.kind, slotKind) || this.buildings.has(b.slot)) continue;
      if (BASE.unique.includes(b.kind) && this.count(b.kind) > 0) continue;
      this.put({ slot: b.slot, kind: b.kind, level: b.level, invested: b.invested, kills: b.kills, bombers: b.bombers, damage: b.damage }, b.health);
    }
    this.setHealth(this.store, save.store);
    this.stats = { ...emptyBaseStats(), ...save.stats };
  }

  /** A new game: the starter buildings, for free. */
  startFresh(): void {
    for (const s of BASE.starter) {
      if (this.buildings.has(s.slot)) continue;
      this.put({ slot: s.slot, kind: s.kind, level: 1, invested: levelOf(s.kind, 1).cost, kills: 0, bombers: 0, damage: 0 });
    }
  }

  // ---- Internals ----------------------------------------------------------------------------------

  private put(b: Building, health?: number): void {
    this.buildings.set(b.slot, b);
    const spec = buildingSpec(this.home, b.slot, b.kind, b.level, this.side);
    this.network.add(spec, health ?? spec.maxHealth);
  }

  private restore(key: string): void {
    const i = this.installation(key);
    if (i) i.restore();
  }

  private setHealth(i: Installation, health: number): void {
    i.durability.health = Math.max(0, Math.min(i.durability.max, health));
    if (!i.alive) i.state = 'destroyed';
  }

  private afford(cost: number): Check {
    const missing = Math.max(0, cost - this.resources.paper);
    return missing > 0 ? { ok: false, reason: 'paper', cost, missing } : { ok: true, reason: null, cost, missing: 0 };
  }

  private refused(check: Check): false {
    this.emit({ type: 'refused', reason: check.reason ?? 'slot', missing: check.missing });
    return false;
  }

  private emit(e: BaseEvent): void {
    for (const l of this.listeners) l(e);
  }
}

function refuse(reason: Refusal, cost: number): Check {
  return { ok: false, reason, cost, missing: 0 };
}
