import * as pc from 'playcanvas';
import catalogJson from '../../assets/models/custom/catalog.json';

/**
 * The game's own models, exported from the asset labs (tools/labs/, `npm run export-models`) to
 * assets/models/custom/. They are clean low-poly (no pencil strokes): planes in the Paper skin,
 * buildings in cardboard, the classroom in its real colours. The catalog carries what a GLB
 * can't: joints, smoke points, beacon timings and flight-effect anchors.
 *
 * Everything here is optional at runtime: a model that is missing or fails to load leaves the
 * game on its code-built stand-ins, so a checkout without the files (or a slow connection) still
 * plays.
 */

export interface Joint {
  node: string;
  type: 'rotate' | 'translate' | 'scale';
  axis: 'x' | 'y' | 'z';
  min?: number;
  max?: number;
  label?: string;
  speed?: number;
  prop?: string;
}

export interface Beacon {
  material: string;
  period: number;
  phase: number;
  width: number;
  peak: number;
  idle: number;
  prop: string;
}

/** What the exporter recorded about one model (or one level/damage variant of a building). */
export interface ModelInfo {
  tris: number;
  min: [number, number, number];
  max: [number, number, number];
  joints: Joint[];
  smoke: string[];
  damageSmoke: string[];
  sockets: string[];
  inkLevels: string[];
  points: Record<string, [number, number, number]>;
  glass: string | null;
  interior: string | null;
  beacons: Beacon[];
}

export interface FxAnchor {
  at: [number, number, number];
  host: string | null;
}

export interface AircraftModelInfo extends ModelInfo {
  file: string;
  name: string;
  kicker: string;
  fx: { nozzles: Array<{ x: number; y: number; z: number; r: number; host: string | null }>; tips: FxAnchor[]; streaks: FxAnchor[] } | null;
  vtol: string[];
  sweep: Array<{ node: string; sign: number }>;
}

export interface BuildingModelInfo {
  file: string;
  lab: string;
  name: string;
  levels: number[];
  /** Keyed `L<level>_D<damage>`. */
  variants: Record<string, ModelInfo>;
  properties: string[];
}

export interface ClassroomInfo {
  layout: {
    unitsPerCm: number;
    floor: [number, number];
    wallHeight: number;
    deskTop: number;
    desk: { w: number; d: number };
    desks: Array<{ id: string; position: [number, number, number]; rotationY: number }>;
    chairs: Array<{ id: string; position: [number, number, number]; rotationY: number }>;
    doors: string[];
    cols: number[];
    rows: number[];
  };
  parts: Record<'room' | 'floor' | 'desk' | 'chair' | 'seats', ModelInfo & { file: string }>;
}

export interface Catalog {
  aircraft: Record<string, AircraftModelInfo>;
  buildings: Record<string, BuildingModelInfo>;
  classroom: ClassroomInfo;
}

export const CATALOG = catalogJson as unknown as Catalog;

/** Building model ids in the catalog. */
export type BuildingModelId = 'turret' | 'launcher' | 'radar' | 'workshop' | 'storage' | 'command' | 'hangar' | 'runway' | 'helipad' | 'ink';

/**
 * The building models the game places today (the runway and helipad are exported for later).
 * Only these are preloaded.
 */
export const IN_GAME_BUILDINGS: readonly BuildingModelId[] = ['turret', 'launcher', 'radar', 'workshop', 'storage', 'command', 'ink', 'hangar'];

/** Damage states the models show: 0 none, 1 minor, 2 medium, 3 critical. */
export type DamageState = 0 | 1 | 2 | 3;

/** The model's damage state for a share of health left (1 = untouched). Wrecks show as critical. */
export function damageState(fraction: number, alive = true): DamageState {
  if (!alive || fraction <= 0.3) return 3;
  if (fraction <= 0.6) return 2;
  if (fraction < 0.95) return 1;
  return 0;
}

/** Variant key inside a building file. */
export function variantKey(level: number, damage: DamageState): string {
  return `L${Math.max(1, Math.min(3, Math.round(level)))}_D${damage}`;
}

/** Material names that animate (lights, beacons, afterburners): each instance gets its own copy. */
const ANIMATED = /^(WindowGlass|Interior|Beacon|CentreLight|Afterburner)/;

const URLS: Record<string, string> = import.meta.glob('/assets/models/custom/**/*.glb', { query: '?url', import: 'default', eager: true });

function urlFor(file: string): string | undefined {
  return URLS[`/assets/${file}`];
}

/**
 * Loads custom model files once and hands out copies: a whole file, or one named child (a
 * building's level/damage variant). Copies share meshes and materials, except the materials that
 * animate, which each copy gets for itself.
 */
export class ModelStore {
  private readonly templates = new Map<string, pc.Entity>();
  private readonly loading = new Map<string, Promise<pc.Entity | null>>();
  private readonly holder: pc.Entity;
  readonly errors = new Map<string, string>();

  constructor(private readonly app: pc.AppBase) {
    this.holder = new pc.Entity('custom-model-templates');
    this.holder.enabled = false;
    app.root.addChild(this.holder);
  }

  get device(): pc.GraphicsDevice {
    return this.app.graphicsDevice;
  }

  /** Is the file part of this build? */
  has(file: string): boolean {
    return !!urlFor(file);
  }

  ready(file: string): boolean {
    return this.templates.has(file);
  }

  load(file: string, timeoutMs = 30000): Promise<pc.Entity | null> {
    const known = this.loading.get(file);
    if (known) return known;
    const url = urlFor(file);
    const p = new Promise<pc.Entity | null>((resolve) => {
      if (!url) {
        this.errors.set(file, 'not in this build');
        resolve(null);
        return;
      }
      const timer = setTimeout(() => {
        this.errors.set(file, 'timed out');
        resolve(null);
      }, timeoutMs);
      this.app.assets.loadFromUrlAndFilename(url, file.split('/').pop()!, 'container', (err, asset) => {
        clearTimeout(timer);
        if (err || !asset?.resource) {
          this.errors.set(file, String(err ?? 'no resource'));
          console.warn(`paperwars: couldn't load ${file}; using the built-in stand-in`, err);
          resolve(null);
          return;
        }
        const root = (asset.resource as pc.ContainerResource).instantiateRenderEntity();
        adaptMaterials(root);
        this.holder.addChild(root);
        this.templates.set(file, root);
        resolve(root);
      });
    });
    this.loading.set(file, p);
    return p;
  }

  /** A fresh copy of the file's model (or of its child named `child`), or null if not loaded. */
  instance(file: string, child?: string): pc.Entity | null {
    const template = this.templates.get(file);
    if (!template) return null;
    const source = child ? (template.findByName(child) as pc.Entity | null) : template;
    if (!source) return null;
    const copy = source.clone() as pc.Entity;
    copy.enabled = true;
    ownAnimatedMaterials(copy);
    return copy;
  }

  report(): Array<{ file: string; state: 'loaded' | 'loading' | 'failed' | 'missing' }> {
    return Object.keys(URLS).map((k) => {
      const file = k.replace(/^\/assets\//, '');
      return { file, state: this.templates.has(file) ? 'loaded' : this.errors.has(file) ? 'failed' : this.loading.has(file) ? 'loading' : 'missing' };
    });
  }
}

const adapted = new WeakSet<pc.Material>();

/** Matte paper and card: no metal, little shine, both sides of thin sheets lit. */
function adaptMaterials(root: pc.Entity): void {
  for (const render of root.findComponents('render') as pc.RenderComponent[]) {
    render.castShadows = true;
    render.receiveShadows = true;
    for (const mi of render.meshInstances) {
      const m = mi.material;
      if (!(m instanceof pc.StandardMaterial) || adapted.has(m)) continue;
      adapted.add(m);
      m.useMetalness = true;
      m.metalness = Math.min(m.metalness, 0.2);
      m.gloss = Math.min(m.gloss, 0.35);
      m.specularityFactor = 0.4;
      m.metalnessMap = null;
      m.glossMap = null;
      m.normalMap = null;
      m.update();
    }
  }
}

function ownAnimatedMaterials(root: pc.Entity): void {
  const copies = new Map<pc.Material, pc.Material>();
  for (const render of root.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of render.meshInstances) {
      const m = mi.material;
      if (!m || !ANIMATED.test(m.name)) continue;
      let c = copies.get(m);
      if (!c) {
        c = m.clone();
        c.name = m.name;
        copies.set(m, c);
      }
      mi.material = c;
    }
  }
}

/** Every material of `root` with this name (an instance's own copies). */
export function materialsNamed(root: pc.Entity, name: string | RegExp): pc.StandardMaterial[] {
  const out = new Set<pc.StandardMaterial>();
  for (const render of root.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of render.meshInstances) {
      const m = mi.material;
      if (m instanceof pc.StandardMaterial && (typeof name === 'string' ? m.name === name : name.test(m.name))) out.add(m);
    }
  }
  return [...out];
}

/** Sets a self-lit material's glow (the GLB exports lights off, emissive colour kept). */
export function setGlow(m: pc.StandardMaterial, intensity: number): void {
  if (Math.abs(m.emissiveIntensity - intensity) < 1e-3) return;
  m.emissiveIntensity = intensity;
  m.update();
}
