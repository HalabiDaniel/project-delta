import { BASE, ECONOMY, type BuildingKind } from '../config';
import { buildingSpec, type InstallationSpec } from '../defenses/Layout';
import type { RaidReport } from './Raids';
import type { SlotHighlight } from '../world/DefenseModels';
import type { BaseInspectorView, BaseView, SlotMarkerView, Stat, TrayItemView } from '../ui/views';
import { Base, fits, levelOf, STORE } from './Base';

/** A slot's (or the store's) position on screen, or null when off screen. */
export type Projector = (x: number, z: number) => { x: number; y: number } | null;

/** What one building of `kind` at `level` gives, as icon stats (with what changed from `from`). */
export function levelStats(kind: BuildingKind, level: number, from?: number): Stat[] {
  const lv = levelOf(kind, level);
  const prev = from !== undefined ? levelOf(kind, from) : null;
  const delta = (now: number | undefined, before: number | undefined, unit = '') => (prev && now !== undefined && before !== undefined && now !== before ? `${now > before ? '+' : ''}${Math.round((now - before) * 10) / 10}${unit}` : undefined);
  switch (kind) {
    case 'turret':
      return [
        { icon: 'distance', value: `${lv.range} m`, label: 'Range', delta: delta(lv.range, prev?.range, ' m') },
        { icon: 'damage', value: String(lv.damage), label: 'Damage per round', delta: delta(lv.damage, prev?.damage) },
        { icon: 'rate', value: `${(1 / lv.interval!).toFixed(1)}/s`, label: 'Rounds per second', delta: prev ? delta(Math.round(10 / lv.interval!) / 10, Math.round(10 / prev.interval!) / 10, '/s') : undefined },
        { icon: 'ink', value: String(lv.magazine), label: `Magazine (reload ${lv.reloadTime} s)`, delta: delta(lv.magazine, prev?.magazine) },
      ];
    case 'launcher':
      return [
        { icon: 'distance', value: `${lv.range} m`, label: 'Range', delta: delta(lv.range, prev?.range, ' m') },
        { icon: 'damage', value: String(lv.damage), label: 'Damage per rocket', delta: delta(lv.damage, prev?.damage) },
        { icon: 'clock', value: `${lv.reload}s`, label: 'Reload', delta: delta(lv.reload, prev?.reload, 's') },
        { icon: 'bomber', value: '1st', label: 'Bombers first' },
      ];
    case 'radar':
      return [{ icon: 'radar', value: `${lv.range} m`, label: 'Early warning range', delta: delta(lv.range, prev?.range, ' m') }];
    case 'workshop':
      return [{ icon: 'rate', value: `+${lv.production}/m`, label: 'Extra paper per minute', delta: delta(lv.production, prev?.production, '/m') }];
    case 'storage':
      return [
        { icon: 'capacity', value: `+${lv.capacity}`, label: 'Extra capacity', delta: delta(lv.capacity, prev?.capacity) },
        { icon: 'lock', value: `+${lv.protection}`, label: 'Extra paper protected from raids', delta: delta(lv.protection, prev?.protection) },
      ];
  }
}

/**
 * Base management mode on T1: which slot is selected, which building is chosen in the tray, and
 * the actions on them. Builds the base part of the HUD view and tells the 3D models which slots
 * to light up and where to show a building's preview.
 */
export class BaseMode {
  open = false;
  selected: string | null = null;
  chosen: BuildingKind | null = null;
  private confirmRemove: { slot: string; until: number } | null = null;

  constructor(private readonly base: Base) {}

  enter(): void {
    this.open = true;
    if (!this.selected) this.selected = this.base.needsRepair[0] ?? BASE.slots.find((s) => !this.base.at(s.id))?.id ?? BASE.slots[0].id;
  }

  exit(): void {
    this.open = false;
    this.chosen = null;
    this.confirmRemove = null;
  }

  selectSlot(id: string): void {
    this.selected = id;
    this.confirmRemove = null;
  }

  /** Picks a building in the tray (again to drop it); jumps to a free slot that takes it. */
  choose(kind: BuildingKind): void {
    this.confirmRemove = null;
    if (this.chosen === kind) {
      this.chosen = null;
      return;
    }
    this.chosen = kind;
    if (!this.fitsSelected(kind)) {
      const free = BASE.slots.find((s) => !this.base.at(s.id) && fits(kind, s.kind));
      if (free) this.selected = free.id;
    }
  }

  build(): boolean {
    if (!this.selected || !this.chosen || this.selected === STORE) return false;
    const ok = this.base.build(this.selected, this.chosen);
    if (ok) this.chosen = null;
    return ok;
  }

  upgrade(): boolean {
    return !!this.selected && this.selected !== STORE && this.base.upgrade(this.selected);
  }

  repair(): boolean {
    return !!this.selected && this.base.repair(this.selected);
  }

  repairAll(): boolean {
    return this.base.repairAll();
  }

  /** Asks twice: the first press arms it. Returns true once removed. */
  remove(): boolean {
    const slot = this.selected;
    if (!slot || slot === STORE || !this.base.at(slot)) return false;
    if (this.confirmRemove?.slot === slot && performance.now() < this.confirmRemove.until) {
      this.confirmRemove = null;
      return this.base.remove(slot);
    }
    this.confirmRemove = { slot, until: performance.now() + 4000 };
    return false;
  }

  /** The see-through building to show at the selected slot, and whether it can be built there. */
  preview(): { spec: InstallationSpec; valid: boolean } | null {
    if (!this.open || !this.chosen || !this.selected || this.selected === STORE || this.base.at(this.selected)) return null;
    const check = this.base.canBuild(this.selected, this.chosen);
    return { spec: buildingSpec(this.base.home, this.selected, this.chosen, 1), valid: check.ok };
  }

  /** How each slot's pad looks. */
  highlights(): Array<{ id: string; highlight: SlotHighlight }> {
    return BASE.slots.map((s) => {
      const built = !!this.base.at(s.id);
      let highlight: SlotHighlight = built ? 'built' : 'none';
      if (this.open) {
        if (s.id === this.selected) highlight = 'selected';
        else if (this.chosen && !built) highlight = fits(this.chosen, s.kind) ? 'fit' : 'no';
        else if (!built) highlight = 'fit';
      }
      return { id: s.id, highlight };
    });
  }

  view(project: Projector, canFly: boolean, lastRaid: RaidReport | null): BaseView {
    const base = this.base;
    const paper = base.resources.paper;
    const slots: SlotMarkerView[] = [];
    const marker = (id: string, kind: SlotMarkerView['kind'], building: SlotMarkerView['building'], level: number, x: number, z: number, fitsChosen: boolean | null) => {
      const at = project(x, z);
      const key = id;
      slots.push({
        id, kind, building, level, x: at?.x ?? 0, y: at?.y ?? 0, onScreen: at !== null,
        status: building ? base.status(key) : null,
        health: building ? base.strength(key) : 1,
        fits: fitsChosen,
        selected: this.selected === id,
      });
    };
    const store = base.store.spec;
    marker(STORE, 'economy', 'store', 1, store.x, store.z, null);
    for (const s of BASE.slots) {
      const b = base.at(s.id);
      const i = base.installation(s.id);
      const p = i ? i.spec : buildingSpec(base.home, s.id, 'storage', 1);
      marker(s.id, s.kind, b?.kind ?? null, b?.level ?? 0, p.x, p.z, this.chosen && !b ? fits(this.chosen, s.kind) && base.canBuild(s.id, this.chosen).reason !== 'unique' : null);
    }

    const tray: TrayItemView[] = BASE.order.map((kind) => {
      const spec = BASE.buildings[kind];
      const cost = levelOf(kind, 1).cost;
      const placeable = BASE.slots.some((s) => !base.at(s.id) && fits(kind, s.kind)) && !(BASE.unique.includes(kind) && base.count(kind) > 0);
      return { kind, name: spec.name, short: spec.short, purpose: spec.purpose, cost, missing: Math.max(0, cost - paper), placeable, chosen: this.chosen === kind, effects: levelStats(kind, 1) };
    });

    const radar = base.radar;
    const r = base.readiness;
    return {
      slots,
      selected: this.selected,
      tray,
      inspector: this.inspector(),
      overview: { ready: r.ready, total: r.total, radar: !radar ? 'none' : radar.alive ? 'on' : 'off', detection: base.detectionRange, integrity: base.integrity },
      repairAll: { cost: base.repairAllCost, missing: Math.max(0, base.repairAllCost - paper), count: base.needsRepair.length },
      canFly,
      lastRaid,
    };
  }

  private fitsSelected(kind: BuildingKind): boolean {
    const slot = this.selected ? this.base.slotKind(this.selected) : null;
    return !!slot && !this.base.at(this.selected!) && fits(kind, slot);
  }

  private inspector(): BaseInspectorView | null {
    const base = this.base;
    const key = this.selected;
    if (!key) return null;
    const paper = base.resources.paper;
    const price = (cost: number) => ({ cost, missing: Math.max(0, cost - paper) });
    const repairCost = base.repairCost(key);
    const repair = repairCost > 0 ? price(repairCost) : null;
    if (key === STORE) {
      const i = base.store;
      return {
        type: 'building', slot: STORE, kind: 'store', name: i.spec.name, level: 1, maxLevel: 1,
        health: i.alive ? i.durability.health : 0, maxHealth: i.durability.max, status: base.status(STORE),
        stats: [
          { icon: 'capacity', value: String(base.capacity), label: 'Capacity' },
          { icon: 'lock', value: String(base.protectedPaper), label: `Protected from raids (always at least ${ECONOMY.protectedPaper})` },
          { icon: 'rate', value: `${Math.round(base.production * 10) / 10}/m`, label: 'Paper per minute' },
        ],
        upgrade: null, repair, refund: null, confirmingRemove: false,
      };
    }
    const slotKind = base.slotKind(key);
    if (!slotKind) return null;
    const b = base.at(key);
    if (!b) {
      const chosen = this.chosen;
      return {
        type: 'empty', slot: key, slotKind,
        takes: BASE.order.filter((k) => fits(k, slotKind)),
        chosen: chosen
          ? { kind: chosen, name: BASE.buildings[chosen].name, price: price(levelOf(chosen, 1).cost), effects: levelStats(chosen, 1), fits: base.canBuild(key, chosen).reason !== 'slot' && base.canBuild(key, chosen).reason !== 'unique' }
          : null,
      };
    }
    const i = base.installation(key)!;
    const maxLevel = BASE.buildings[b.kind].levels.length;
    const stats = levelStats(b.kind, b.level);
    if (b.kind === 'turret' || b.kind === 'launcher') stats.push({ icon: 'kills', value: String(b.kills), label: `Shot down (${b.bombers} bombers) · ${b.damage} damage dealt` });
    const status = base.status(key);
    return {
      type: 'building', slot: key, kind: b.kind, name: BASE.buildings[b.kind].name, level: b.level, maxLevel,
      health: i.alive ? i.durability.health : 0, maxHealth: i.durability.max, status, stats,
      upgrade: b.level < maxLevel ? { ...price(levelOf(b.kind, b.level + 1).cost), next: levelStats(b.kind, b.level + 1, b.level) } : null,
      repair,
      refund: base.refundFor(key),
      confirmingRemove: this.confirmRemove?.slot === key && performance.now() < this.confirmRemove.until,
    };
  }
}
