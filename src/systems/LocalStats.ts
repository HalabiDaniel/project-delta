import { AIRCRAFT, AIRCRAFT_ORDER, type AircraftId } from '../config';

/** The subset of the Web Storage API this needs, so tests can pass a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CareerStats {
  missionsCompleted: number;
  planesLost: number;
  targetsDestroyed: number;
  /** Turrets, launchers, radars and depots destroyed. */
  defensesDestroyed: number;
  /** Enemy aircraft shot down (or helped to), and how many of them were bombers. */
  aircraftDestroyed: number;
  bombersIntercepted: number;
  /** Sorties launched, per design. The most flown is the favourite. */
  sorties: Partial<Record<AircraftId, number>>;
  /** The design last chosen in the garage, restored next time. */
  lastAircraft: AircraftId | null;
}

const KEY = 'paperwars.career.v1';

/**
 * All-time numbers for this browser, kept in local storage (no accounts yet). Storage can be
 * missing, full or blocked, so every read and write is allowed to fail: the game then simply keeps
 * the numbers for this visit.
 */
export class LocalStats {
  readonly data: CareerStats;

  constructor(private readonly store: KeyValueStore | null) {
    this.data = load(store);
  }

  /** Uses the browser's local storage when it is available. */
  static browser(): LocalStats {
    let store: KeyValueStore | null = null;
    try {
      store = window.localStorage;
    } catch {
      // Blocked (private mode, sandboxed frame): keep stats for this visit only.
    }
    return new LocalStats(store);
  }

  /** The most flown design, or null before the first sortie. Ties go to the cheaper design. */
  get favorite(): AircraftId | null {
    let best: AircraftId | null = null;
    for (const id of AIRCRAFT_ORDER) {
      const n = this.data.sorties[id] ?? 0;
      if (n > 0 && (best === null || n > (this.data.sorties[best] ?? 0))) best = id;
    }
    return best;
  }

  recordSortie(aircraft: AircraftId): void {
    this.data.sorties[aircraft] = (this.data.sorties[aircraft] ?? 0) + 1;
    this.save();
  }

  recordMissionCompleted(): void {
    this.data.missionsCompleted++;
    this.save();
  }

  recordPlaneLost(): void {
    this.data.planesLost++;
    this.save();
  }

  recordTargetDestroyed(defense = false): void {
    this.data.targetsDestroyed++;
    if (defense) this.data.defensesDestroyed++;
    this.save();
  }

  recordAircraftDestroyed(bomber = false): void {
    this.data.aircraftDestroyed++;
    if (bomber) this.data.bombersIntercepted++;
    this.save();
  }

  rememberAircraft(aircraft: AircraftId): void {
    if (this.data.lastAircraft === aircraft) return;
    this.data.lastAircraft = aircraft;
    this.save();
  }

  /** Forgets everything (progress reset). */
  clear(): void {
    try {
      this.store?.setItem(KEY, '');
    } catch {
      // Blocked: nothing was kept anyway.
    }
  }

  private save(): void {
    try {
      this.store?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Full or blocked: the numbers still count for this visit.
    }
  }
}

function load(store: KeyValueStore | null): CareerStats {
  const empty: CareerStats = {
    missionsCompleted: 0, planesLost: 0, targetsDestroyed: 0, defensesDestroyed: 0, aircraftDestroyed: 0, bombersIntercepted: 0,
    sorties: {}, lastAircraft: null,
  };
  let raw: unknown;
  try {
    const text = store?.getItem(KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    return empty;
  }
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const sorties: CareerStats['sorties'] = {};
  if (r.sorties && typeof r.sorties === 'object') {
    for (const id of AIRCRAFT_ORDER) {
      const n = count((r.sorties as Record<string, unknown>)[id]);
      if (n > 0) sorties[id] = n;
    }
  }
  return {
    missionsCompleted: count(r.missionsCompleted),
    planesLost: count(r.planesLost),
    targetsDestroyed: count(r.targetsDestroyed),
    defensesDestroyed: count(r.defensesDestroyed),
    aircraftDestroyed: count(r.aircraftDestroyed),
    bombersIntercepted: count(r.bombersIntercepted),
    sorties,
    lastAircraft: typeof r.lastAircraft === 'string' && r.lastAircraft in AIRCRAFT ? (r.lastAircraft as AircraftId) : null,
  };
}
