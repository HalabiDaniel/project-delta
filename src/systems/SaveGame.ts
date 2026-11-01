import { parseTutorial, type TutorialRecord } from '../progress/Tutorial';
import { emptyBaseStats, type BaseSave, type BaseStats } from '../base/Base';
import { AIRCRAFT_ORDER, BASE, DEFENSES, DIRECTOR, ECONOMY, TIER_ORDER, type AircraftId, type BuildingKind, type Tier } from '../config';
import type { DirectorState, HistoryEntry, HistoryKind, OfferSource, Recipe, Slot } from '../director/MissionDirector';
import type { Operation, OperationStage, OperationTemplate, OptionalKind } from '../director/Operations';
import type { MissionRecord } from '../director/Performance';
import type { Escalation, Medal, MissionFailure, MissionType, Situational } from '../missions/Mission';
import { EVENT_TYPES, MISSION_TYPES } from '../missions/MissionGenerator';
import { ACHIEVEMENTS, emptyMastery, emptyProgress, type Mastery, type ProgressData, type SessionSummary } from '../progress/Progress';
import type { EconomyTotals, Efficiency, Transaction } from './Ledger';

/**
 * The save format's version. Bump it when the format changes, and add a step to MIGRATIONS that
 * turns the previous version into the new one; saves from an unknown future version are kept
 * aside, never overwritten.
 */
export const SAVE_VERSION = 2;

export interface HangarSave {
  id: AircraftId;
  condition: 'ready' | 'recovered';
  health: number;
  invested: number;
}

export interface SaveData {
  version: number;
  savedAt: number;
  paper: number;
  /** The design chosen in the garage. */
  aircraft: AircraftId;
  /** Planes waiting at home: the player's saved loadouts. */
  hangar: HangarSave[];
  /** A plane that was in the air when the page closed: it comes back to T1 as a recovered plane. */
  inFlight: { aircraft: AircraftId; health: number } | null;
  director: DirectorState | null;
  progress: ProgressData;
  ledger: {
    entries: Transaction[];
    totals: EconomyTotals;
    byAircraft: Array<[AircraftId, Efficiency]>;
    byType: Array<[MissionType, Efficiency]>;
  };
  settings: SaveSettings;
  /** The summary of the previous visit, shown on the next. */
  lastSession: SessionSummary | null;
  /** T1's buildings, their condition and records; null for a brand-new game. */
  base: BaseSave | null;
  /**
   * The interactive tutorial's progress (its own versioned record, see progress/Tutorial.ts);
   * null in saves from before it, which count as finished for a player who has already flown.
   */
  tutorial: TutorialRecord | null;
}

export interface SaveSettings {
  muted: boolean;
  dev: boolean;
  /** Key hints: for the first sorties (auto), always, or never. */
  hints: 'auto' | 'on' | 'off';
  /** HUD size. */
  uiScale: number;
  /** First-time tips already shown. */
  tips: string[];
}

export const UI_SCALES: readonly number[] = [0.9, 1, 1.15];

// ---- Storage --------------------------------------------------------------------------------

/** Where saves live: IndexedDB when it works, else local storage, else (blocked storage) memory only. */
export interface SaveStore {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStore implements SaveStore {
  readonly kind = 'memory';
  readonly data = new Map<string, string>();
  async read(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async write(key: string, text: string): Promise<void> {
    this.data.set(key, text);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const PREFIX = 'paperwars.save.';

function localStore(): SaveStore | null {
  let ls: Storage;
  try {
    ls = window.localStorage;
    ls.setItem(`${PREFIX}probe`, '1');
    ls.removeItem(`${PREFIX}probe`);
  } catch {
    return null;
  }
  return {
    kind: 'localstorage',
    read: async (key) => ls.getItem(PREFIX + key),
    write: async (key, text) => ls.setItem(PREFIX + key, text),
    remove: async (key) => ls.removeItem(PREFIX + key),
  };
}

function idbStore(): Promise<SaveStore | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (store: SaveStore | null) => {
      if (settled) return;
      settled = true;
      resolve(store);
    };
    // Some browsers never answer (private windows): don't hold up the game.
    setTimeout(() => done(null), 1500);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open('paperwars', 1);
    } catch {
      done(null);
      return;
    }
    request.onupgradeneeded = () => request.result.createObjectStore('saves');
    request.onerror = () => done(null);
    request.onblocked = () => done(null);
    request.onsuccess = () => {
      const db = request.result;
      const run = <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) =>
        new Promise<T>((ok, fail) => {
          const tx = db.transaction('saves', mode);
          const r = op(tx.objectStore('saves'));
          tx.oncomplete = () => ok(r.result);
          tx.onerror = () => fail(tx.error);
          tx.onabort = () => fail(tx.error);
        });
      done({
        kind: 'indexeddb',
        read: async (key) => {
          const v = await run('readonly', (s) => s.get(key));
          return typeof v === 'string' ? v : null;
        },
        write: async (key, text) => {
          await run('readwrite', (s) => s.put(text, key));
        },
        remove: async (key) => {
          await run('readwrite', (s) => s.delete(key));
        },
      });
    };
  });
}

/** The best storage this browser offers. */
export async function openStore(): Promise<SaveStore> {
  return (await idbStore()) ?? localStore() ?? new MemoryStore();
}

/**
 * Reads, validates and writes the save. Writes are gathered: `schedule` asks for one, and it
 * happens a moment later (or at `flush`). Nothing here throws: storage that fails just means the
 * game is not saved.
 */
export class SaveManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private build: (() => SaveData) | null = null;
  /** Saving is off after a reset, so the page can reload clean. */
  private stopped = false;
  lastError: string | null = null;
  lastSaved = 0;

  constructor(readonly store: SaveStore) {}

  /**
   * The saved game, checked and repaired field by field (`problems` lists what was dropped), or
   * null if there is none, it can't be read, or it is from a newer version (then kept aside).
   */
  async load(): Promise<{ data: SaveData | null; problems: string[] }> {
    let text: string | null;
    try {
      text = await this.store.read('main');
    } catch (e) {
      return { data: null, problems: [`could not read the save: ${String(e)}`] };
    }
    if (!text) return { data: null, problems: [] };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await this.backup(text);
      return { data: null, problems: ['the save was not readable: starting fresh (a copy was kept)'] };
    }
    const version = isObject(raw) && typeof raw.version === 'number' ? raw.version : 0;
    if (version > SAVE_VERSION) {
      await this.backup(text);
      this.stopped = true;
      return { data: null, problems: [`the save is from a newer version (${version}): it was kept and not overwritten`] };
    }
    const problems: string[] = [];
    const data = validateSave(migrate(raw, problems), problems);
    return { data, problems };
  }

  /** Asks for a save soon; `build` makes it when it happens. */
  schedule(build: () => SaveData, delay = 800): void {
    if (this.stopped) return;
    this.build = build;
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || !this.build) return;
    try {
      await this.store.write('main', JSON.stringify(this.build()));
      this.lastSaved = Date.now();
      this.lastError = null;
    } catch (e) {
      this.lastError = String(e);
    }
  }

  /** Deletes the save for good (the player confirmed). Saving stops until the page reloads. */
  async reset(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      await this.store.remove('main');
    } catch (e) {
      this.lastError = String(e);
    }
  }

  private async backup(text: string): Promise<void> {
    try {
      await this.store.write('backup', text);
    } catch {
      // Nothing more to do.
    }
  }
}

// ---- Versions ---------------------------------------------------------------------------------

/**
 * Steps from each old version to the next.
 * 1 → 2 (v0.0.7): T1 became a base the player builds. Before, it had two ink turrets for free;
 * a save from then keeps them, as built turrets in the two defense slots.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  1: (raw) => ({
    ...raw,
    version: 2,
    base: {
      buildings: ['D1', 'D2'].map((slot) => ({ slot, kind: 'turret', level: 1, invested: BASE.buildings.turret.levels[0].cost, kills: 0, bombers: 0, damage: 0, health: BASE.buildings.turret.levels[0].health })),
      store: DEFENSES.home.storeHealth,
      stats: emptyBaseStats(),
    },
  }),
};

export function migrate(raw: unknown, problems: string[]): unknown {
  if (!isObject(raw)) return raw;
  let data = raw;
  let version = typeof data.version === 'number' ? data.version : SAVE_VERSION;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      problems.push(`no way to upgrade a version ${version} save: starting fresh`);
      return null;
    }
    data = step(data);
    version++;
  }
  return data;
}

// ---- Validation -------------------------------------------------------------------------------

/**
 * Checks every field of a saved game. Anything missing or wrong is replaced by its default (and
 * noted in `problems`) rather than breaking the game; nothing outside the expected shape is kept.
 */
export function validateSave(raw: unknown, problems: string[] = []): SaveData | null {
  if (!isObject(raw)) {
    if (raw !== null) problems.push('the save was not an object');
    return null;
  }
  const check = new Checker(problems);
  const settings = isObject(raw.settings) ? raw.settings : {};
  const ledger = isObject(raw.ledger) ? raw.ledger : {};
  return {
    version: SAVE_VERSION,
    savedAt: check.num(raw.savedAt, 'savedAt', 0, Number.MAX_SAFE_INTEGER, 0),
    paper: check.int(raw.paper, 'paper', 0, 1_000_000, ECONOMY.startingPaper),
    aircraft: check.oneOf(raw.aircraft, 'aircraft', AIRCRAFT_ORDER, 'falcon'),
    hangar: check.list(raw.hangar, 'hangar', (h, i) => {
      if (!isObject(h)) return null;
      return {
        id: check.oneOf(h.id, `hangar[${i}].id`, AIRCRAFT_ORDER, null),
        condition: check.oneOf(h.condition, `hangar[${i}].condition`, ['ready', 'recovered'] as const, 'recovered'),
        health: check.num(h.health, `hangar[${i}].health`, 1, 1000, 1),
        invested: check.int(h.invested, `hangar[${i}].invested`, 0, 1000, 0),
      };
    }).filter((h): h is HangarSave => h !== null && h.id !== null).filter((h, i, all) => all.findIndex((x) => x.id === h.id) === i),
    inFlight: isObject(raw.inFlight)
      ? (() => {
          const id = check.oneOf(raw.inFlight.aircraft, 'inFlight.aircraft', AIRCRAFT_ORDER, null);
          return id ? { aircraft: id, health: check.num(raw.inFlight.health, 'inFlight.health', 0, 1000, 0) } : null;
        })()
      : null,
    director: raw.director === null || raw.director === undefined ? null : validateDirector(raw.director, check),
    progress: validateProgress(raw.progress, check),
    ledger: {
      entries: check.list(ledger.entries, 'ledger.entries', (e) => {
        if (!isObject(e)) return null;
        const source = check.oneOf(e.source, 'ledger source', ['spend', 'reward', 'bonus', 'income', 'refund', 'raid', 'reset'] as const, null);
        if (!source) return null;
        return {
          at: check.num(e.at, 'ledger at', 0, Number.MAX_SAFE_INTEGER, 0),
          delta: check.int(e.delta, 'ledger delta', -1_000_000, 1_000_000, 0),
          balance: check.int(e.balance, 'ledger balance', 0, 1_000_000, 0),
          source,
          label: check.str(e.label, 'ledger label', ''),
          count: check.int(e.count, 'ledger count', 1, 1_000_000, 1),
        };
      }).filter((e): e is Transaction => e !== null).slice(-ECONOMY.ledgerSize),
      totals: (() => {
        const t = isObject(ledger.totals) ? ledger.totals : {};
        const n = (k: string) => check.int(t[k], `ledger.totals.${k}`, 0, 100_000_000, 0);
        return { earned: n('earned'), spent: n('spent'), income: n('income'), bonuses: n('bonuses'), raids: n('raids') };
      })(),
      byAircraft: check.pairs(ledger.byAircraft, 'ledger.byAircraft', AIRCRAFT_ORDER, (v) => validateEfficiency(v, check)),
      byType: check.pairs(ledger.byType, 'ledger.byType', ALL_TYPES, (v) => validateEfficiency(v, check)),
    },
    settings: {
      muted: settings.muted === true,
      dev: settings.dev === true,
      hints: check.oneOf(settings.hints, 'settings.hints', ['auto', 'on', 'off'] as const, 'auto'),
      uiScale: UI_SCALES.includes(settings.uiScale as number) ? (settings.uiScale as number) : 1,
      tips: Array.isArray(settings.tips) ? settings.tips.filter((t): t is string => typeof t === 'string').slice(0, 50) : [],
    },
    lastSession: validateSession(raw.lastSession, check),
    base: raw.base === null || raw.base === undefined ? null : validateBase(raw.base, check),
    tutorial: parseTutorial(raw.tutorial),
  };
}

const BASE_SLOT_IDS = BASE.slots.map((s) => s.id);

/** T1's buildings: unknown slots or kinds are dropped, levels and health kept in range. */
function validateBase(b: unknown, check: Checker): BaseSave | null {
  if (!isObject(b)) {
    check.note('base was not an object');
    return null;
  }
  const buildings = check.list(b.buildings, 'base.buildings', (x, i) => {
    if (!isObject(x)) return null;
    const slot = check.oneOf(x.slot, `base.buildings[${i}].slot`, BASE_SLOT_IDS, null);
    const kind = check.oneOf(x.kind, `base.buildings[${i}].kind`, BASE.order, null) as BuildingKind | null;
    if (!slot || !kind) return null;
    const levels = BASE.buildings[kind].levels;
    const level = check.int(x.level, `base.buildings[${i}].level`, 1, levels.length, 1);
    return {
      slot, kind, level,
      invested: check.int(x.invested, `base.buildings[${i}].invested`, 0, 100_000, levels[0].cost),
      kills: check.int(x.kills, `base.buildings[${i}].kills`, 0, 1_000_000, 0),
      bombers: check.int(x.bombers, `base.buildings[${i}].bombers`, 0, 1_000_000, 0),
      damage: check.int(x.damage, `base.buildings[${i}].damage`, 0, 100_000_000, 0),
      health: check.num(x.health, `base.buildings[${i}].health`, 0, levels[level - 1].health, levels[level - 1].health),
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null).filter((x, i, all) => all.findIndex((y) => y.slot === x.slot) === i);
  const s = isObject(b.stats) ? b.stats : {};
  const empty = emptyBaseStats();
  const stats = Object.fromEntries((Object.keys(empty) as Array<keyof BaseStats>).map((k) => [k, check.int(s[k], `base.stats.${k}`, 0, 100_000_000, 0)])) as unknown as BaseStats;
  return { buildings, store: check.num(b.store, 'base.store', 0, DEFENSES.home.storeHealth, DEFENSES.home.storeHealth), stats };
}

function validateEfficiency(v: unknown, check: Checker): Efficiency | null {
  if (!isObject(v)) return null;
  const n = (k: string) => check.int(v[k], `efficiency.${k}`, 0, 100_000_000, 0);
  return { sorties: n('sorties'), successes: n('successes'), lost: n('lost'), spent: n('spent'), earned: n('earned') };
}

const ESCALATIONS: readonly Escalation[] = ['wingman', 'escorted', 'extra-target', 'return', 'tight-clock'];
const SITUATIONAL: readonly Situational[] = ['high-value', 'alert', 'recovery', 'emergency'];
const REGULAR_TYPES = MISSION_TYPES.filter((t) => !EVENT_TYPES.includes(t));
/** History and records can also hold world events' missions. */
const ALL_TYPES: readonly MissionType[] = [...MISSION_TYPES, ...EVENT_TYPES];
const FAILURES: readonly MissionFailure[] = ['missed', 'out-of-time', 'aircraft-lost', 'abandoned', 'target-escaped', 'target-bombed', 'escort-lost'];

function validateRecipe(r: unknown, check: Checker, where: string): Recipe | null {
  if (!isObject(r)) return null;
  const type = check.oneOf(r.type, `${where}.type`, REGULAR_TYPES, null);
  const tier = check.oneOf(r.tier, `${where}.tier`, TIER_ORDER, null);
  if (!type || !tier) return null;
  const recipe: Recipe = { type, tier, seed: check.int(r.seed, `${where}.seed`, 0, 2 ** 31, 1) };
  if (typeof r.target === 'string' && /^T\d+$/.test(r.target)) recipe.target = r.target;
  if (Array.isArray(r.escalations)) recipe.escalations = r.escalations.filter((e): e is Escalation => ESCALATIONS.includes(e as Escalation));
  if (Array.isArray(r.modifiers)) recipe.modifiers = r.modifiers.filter((m): m is Situational => SITUATIONAL.includes(m as Situational));
  if (r.focus === 'radar' || r.focus === 'supply') recipe.focus = r.focus;
  if (typeof r.count === 'number' && Number.isInteger(r.count) && r.count > 0 && r.count < 10) recipe.count = r.count;
  return recipe;
}

function validateRecord(r: unknown, check: Checker): MissionRecord | null {
  if (!isObject(r)) return null;
  const type = check.oneOf(r.type, 'record.type', ALL_TYPES, null);
  const tier = check.oneOf(r.tier, 'record.tier', TIER_ORDER, null);
  const aircraft = check.oneOf(r.aircraft, 'record.aircraft', AIRCRAFT_ORDER, null);
  if (!type || !tier || !aircraft) return null;
  return {
    type,
    tier,
    aircraft,
    success: r.success === true,
    failure: check.oneOf(r.failure, 'record.failure', FAILURES, null),
    lost: r.lost === true,
    landed: r.landed === true,
    damageDealt: check.num(r.damageDealt, 'record.damageDealt', 0, 1e6, 0),
    damageTaken: check.num(r.damageTaken, 'record.damageTaken', 0, 1, 0),
    time: check.num(r.time, 'record.time', 0, 1e6, 0),
    par: check.num(r.par, 'record.par', 0, 1e6, 0),
    shotsFired: check.int(r.shotsFired, 'record.shotsFired', 0, 1e6, 0),
    shotsHit: check.int(r.shotsHit, 'record.shotsHit', 0, 1e6, 0),
    reward: check.int(r.reward, 'record.reward', 0, 1e6, 0),
    medal: check.oneOf(r.medal, 'record.medal', ['bronze', 'silver', 'gold'] as const, null),
  };
}

function validateOperation(o: unknown, check: Checker): Operation | null {
  if (!isObject(o) || !Array.isArray(o.stages) || o.stages.length === 0 || o.stages.length > 6) return null;
  const template = check.oneOf(o.template, 'operation.template', ['strike', 'light', 'air'] as readonly OperationTemplate[], null);
  const tier = check.oneOf(o.tier, 'operation.tier', TIER_ORDER, null);
  const status = check.oneOf(o.status, 'operation.status', ['offered', 'active'] as const, null);
  if (!template || !tier || !status || typeof o.id !== 'string' || typeof o.codename !== 'string' || typeof o.territoryId !== 'string') return null;
  const stages: OperationStage[] = [];
  for (const [i, s] of o.stages.entries()) {
    if (!isObject(s)) return null;
    const recipe = validateRecipe({ ...(isObject(s.recipe) ? s.recipe : {}), seed: 1 }, check, `operation.stages[${i}].recipe`);
    const st = check.oneOf(s.status, 'stage.status', ['locked', 'open', 'done'] as const, null);
    const opt = isObject(s.optional) ? s.optional : {};
    const kind = check.oneOf(opt.kind, 'stage.optional.kind', ['no-loss', 'light-damage', 'fast'] as readonly OptionalKind[], null);
    if (!recipe || !recipe.target || !st || !kind) return null;
    stages.push({
      label: check.str(s.label, 'stage.label', `Stage ${i + 1}`),
      recipe: { type: recipe.type, tier: recipe.tier, target: recipe.target, escalations: recipe.escalations, focus: recipe.focus },
      status: st,
      earned: check.int(s.earned, 'stage.earned', 0, 1e6, 0),
      estimate: check.int(s.estimate, 'stage.estimate', 0, 1e6, 0),
      attempts: check.int(s.attempts, 'stage.attempts', 0, 1e6, 0),
      optional: { kind, bonus: check.int(opt.bonus, 'stage.optional.bonus', 0, 1000, 0), met: typeof opt.met === 'boolean' ? opt.met : null },
      skipped: s.skipped === true || undefined,
    });
  }
  // Exactly one stage open, everything before it done, everything after locked.
  const open = stages.findIndex((s) => s.status === 'open');
  if (open < 0 || stages.some((s, i) => (i < open && s.status !== 'done') || (i > open && s.status !== 'locked'))) return null;
  return {
    id: o.id,
    codename: check.str(o.codename, 'operation.codename', 'Operation'),
    territoryId: o.territoryId,
    template,
    tier,
    stages,
    status,
    bonus: check.int(o.bonus, 'operation.bonus', 0, 10000, 0),
    earned: check.int(o.earned, 'operation.earned', 0, 1e6, 0),
  };
}

const HISTORY_KINDS: readonly HistoryKind[] = ['offered', 'accepted', 'completed', 'failed', 'swapped', 'invalid', 'expired', 'abandoned'];
const SOURCES: readonly OfferSource[] = ['director', 'recovery', 'operation', 'event', 'forced'];
const SLOT_IDS: readonly Slot[] = ['safe', 'balanced', 'risky'];

function validateDirector(d: unknown, check: Checker): DirectorState | null {
  if (!isObject(d)) {
    check.note('director state was not an object');
    return null;
  }
  return {
    offers: check.list(d.offers, 'director.offers', (o, i) => {
      if (!isObject(o)) return null;
      const slot = check.oneOf(o.slot, `director.offers[${i}].slot`, SLOT_IDS, null);
      if (!slot) return null;
      return { slot, source: check.oneOf(o.source, 'offer.source', SOURCES, 'director'), recipe: validateRecipe(o.recipe, check, `director.offers[${i}].recipe`) };
    }).filter((o): o is DirectorState['offers'][number] => o !== null),
    swaps: check.int(d.swaps, 'director.swaps', 0, DIRECTOR.swaps.max, DIRECTOR.swaps.start),
    recent: check.list(d.recent, 'director.recent', (r) => {
      if (!isObject(r)) return null;
      const type = check.oneOf(r.type, 'recent.type', ALL_TYPES, null);
      return type ? { type, target: typeof r.target === 'string' ? r.target : null } : null;
    }).filter((r): r is { type: MissionType; target: string | null } => r !== null),
    history: check.list(d.history, 'director.history', (h) => {
      if (!isObject(h)) return null;
      const kind = check.oneOf(h.kind, 'history.kind', HISTORY_KINDS, null);
      const type = check.oneOf(h.type, 'history.type', ALL_TYPES, null);
      const tier = check.oneOf(h.tier, 'history.tier', TIER_ORDER, null);
      if (!kind || !type || !tier) return null;
      const entry: HistoryEntry = {
        at: check.num(h.at, 'history.at', 0, Number.MAX_SAFE_INTEGER, 0),
        kind, type, tier: tier as Tier,
        title: check.str(h.title, 'history.title', type),
        slot: check.oneOf(h.slot, 'history.slot', [...SLOT_IDS, 'event'] as const, 'safe'),
        source: check.oneOf(h.source, 'history.source', SOURCES, 'director'),
      };
      if (typeof h.detail === 'string') entry.detail = h.detail;
      return entry;
    }).filter((h): h is HistoryEntry => h !== null).slice(-DIRECTOR.historySize),
    records: check.list(d.records, 'director.records', (r) => validateRecord(r, check)).filter((r): r is MissionRecord => r !== null).slice(-DIRECTOR.window * 2),
    skill: check.num(d.skill, 'director.skill', 0, 1, DIRECTOR.skill.start),
    operation: d.operation === null || d.operation === undefined ? null : (validateOperation(d.operation, check) ?? (check.note('the saved operation was damaged and was dropped'), null)),
    completedMissions: check.int(d.completedMissions, 'director.completedMissions', 0, 1e7, 0),
    sinceOperation: check.int(d.sinceOperation, 'director.sinceOperation', 0, 1e7, 0),
  };
}

function validateProgress(p: unknown, check: Checker): ProgressData {
  const out = emptyProgress();
  if (!isObject(p)) {
    if (p !== undefined) check.note('progress was not an object');
    return out;
  }
  const b = isObject(p.bests) ? p.bests : {};
  if (isObject(b.fastestBombing)) out.bests.fastestBombing = { time: check.num(b.fastestBombing.time, 'fastestBombing', 0, 1e6, 0), title: check.str(b.fastestBombing.title, 'fastestBombing.title', '') };
  if (isObject(b.bestBombAccuracy)) {
    out.bests.bestBombAccuracy = {
      accuracy: check.num(b.bestBombAccuracy.accuracy, 'bestBombAccuracy', 0, 1, 0),
      bombs: check.int(b.bestBombAccuracy.bombs, 'bestBombAccuracy.bombs', 0, 100, 0),
      title: check.str(b.bestBombAccuracy.title, 'bestBombAccuracy.title', ''),
    };
  }
  if (isObject(b.longestFlight)) {
    const aircraft = check.oneOf(b.longestFlight.aircraft, 'longestFlight.aircraft', AIRCRAFT_ORDER, null);
    if (aircraft) out.bests.longestFlight = { distance: check.num(b.longestFlight.distance, 'longestFlight', 0, 1e8, 0), aircraft };
  }
  if (isObject(b.mostKills)) out.bests.mostKills = { count: check.int(b.mostKills.count, 'mostKills', 0, 1000, 0), title: check.str(b.mostKills.title, 'mostKills.title', '') };
  out.bests.cleanRun = check.int(b.cleanRun, 'cleanRun', 0, 1e6, 0);
  const streak = isObject(p.streak) ? p.streak : {};
  out.streak = { current: check.int(streak.current, 'streak.current', 0, 1e6, 0), best: check.int(streak.best, 'streak.best', 0, 1e6, 0) };
  out.clean = check.int(p.clean, 'clean', 0, 1e6, 0);
  if (isObject(p.mastery)) {
    for (const id of AIRCRAFT_ORDER) {
      const m = p.mastery[id];
      if (!isObject(m)) continue;
      const n = (k: keyof Mastery) => check.num(m[k], `mastery.${id}.${k}`, 0, 1e9, 0);
      const byCategory: Mastery['byCategory'] = {};
      if (isObject(m.byCategory)) {
        for (const c of ['bombing', 'recon', 'flight', 'dogfight', 'interception', 'escort', 'assault'] as const) {
          const v = m.byCategory[c];
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) byCategory[c] = Math.floor(v);
        }
      }
      out.mastery[id] = { ...emptyMastery(), flights: n('flights'), missions: n('missions'), lost: n('lost'), bombsDropped: n('bombsDropped'), bombHits: n('bombHits'), shotsFired: n('shotsFired'), shotsHit: n('shotsHit'), kills: n('kills'), distance: n('distance'), byCategory };
    }
  }
  if (isObject(p.achievements)) {
    for (const a of ACHIEVEMENTS) {
      const at = p.achievements[a.id];
      if (typeof at === 'number' && Number.isFinite(at) && at >= 0) out.achievements[a.id] = at;
    }
  }
  out.landings = check.int(p.landings, 'landings', 0, 1e7, 0);
  const medals = isObject(p.medals) ? p.medals : {};
  for (const m of ['bronze', 'silver', 'gold'] as Medal[]) out.medals[m] = check.int(medals[m], `medals.${m}`, 0, 1e7, 0);
  out.completedIn = Array.isArray(p.completedIn) ? AIRCRAFT_ORDER.filter((id) => (p.completedIn as unknown[]).includes(id)) : [];
  return out;
}

function validateSession(s: unknown, check: Checker): SessionSummary | null {
  if (!isObject(s)) return null;
  const n = (k: string) => check.int(s[k], `lastSession.${k}`, 0, 1e9, 0);
  const medal = check.oneOf(s.bestMedal, 'lastSession.bestMedal', ['bronze', 'silver', 'gold'] as const, null);
  const best = isObject(s.bestReward) ? { amount: check.int(s.bestReward.amount, 'bestReward', 0, 1e6, 0), title: check.str(s.bestReward.title, 'bestReward.title', '') } : null;
  return {
    startedAt: check.num(s.startedAt, 'lastSession.startedAt', 0, Number.MAX_SAFE_INTEGER, 0),
    seconds: check.num(s.seconds, 'lastSession.seconds', 0, 1e9, 0),
    sorties: n('sorties'),
    missionsCompleted: n('missionsCompleted'),
    missionsFailed: n('missionsFailed'),
    paperEarned: n('paperEarned'),
    paperSpent: n('paperSpent'),
    aircraftLost: n('aircraftLost'),
    enemiesDestroyed: n('enemiesDestroyed'),
    bestMedal: medal,
    bestReward: best,
    bestStreak: n('bestStreak'),
    achievements: Array.isArray(s.achievements) ? s.achievements.filter((a): a is string => typeof a === 'string').slice(0, 20) : [],
  };
}

/** Small validators that fall back to a default and note what was wrong. */
class Checker {
  constructor(private readonly problems: string[]) {}

  note(problem: string): void {
    if (this.problems.length < 30) this.problems.push(problem);
  }

  num(v: unknown, what: string, min: number, max: number, fallback: number): number {
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.note(`${what} was not a number`);
      return fallback;
    }
    if (v < min || v > max) this.note(`${what} was out of range`);
    return Math.min(max, Math.max(min, v));
  }

  int(v: unknown, what: string, min: number, max: number, fallback: number): number {
    return Math.round(this.num(v, what, min, max, fallback));
  }

  str(v: unknown, what: string, fallback: string): string {
    if (typeof v === 'string') return v.slice(0, 200);
    if (v !== undefined) this.note(`${what} was not text`);
    return fallback;
  }

  oneOf<T extends string, F>(v: unknown, what: string, options: readonly T[], fallback: F): T | F {
    if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
    if (v !== undefined && v !== null) this.note(`${what} was not a known value`);
    return fallback;
  }

  list<T>(v: unknown, what: string, item: (x: unknown, i: number) => T | null): Array<T | null> {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      this.note(`${what} was not a list`);
      return [];
    }
    const out = v.slice(0, 500).map(item);
    const dropped = out.filter((x) => x === null).length;
    if (dropped > 0) this.note(`${dropped} damaged ${what} entr${dropped === 1 ? 'y was' : 'ies were'} dropped`);
    return out;
  }

  pairs<K extends string, V>(v: unknown, what: string, keys: readonly K[], value: (x: unknown) => V | null): Array<[K, V]> {
    if (!Array.isArray(v)) return [];
    const out: Array<[K, V]> = [];
    for (const p of v) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const k = this.oneOf(p[0], what, keys, null);
      const val = value(p[1]);
      if (k && val && !out.some(([x]) => x === k)) out.push([k, val]);
    }
    return out;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
