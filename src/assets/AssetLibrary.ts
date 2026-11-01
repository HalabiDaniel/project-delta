import * as pc from 'playcanvas';
import { materials } from '../render/materials/MaterialLibrary';
import { outline } from '../render/outline/OutlineRenderer';
import { CATALOG, IN_GAME_BUILDINGS, ModelStore, SCENERY_MODELS } from './CustomModels';
import { classroomFiles } from '../world/Classroom';
import { assetPaths, PROPS, resolveProp, type PropBuild, type PropId, type PropSource } from './manifest';

/**
 * Model files present when the game was built (or the dev server started): licensed ones in
 * assets/licensed/ (git-ignored: purchased models never go into the public repository, and a
 * checkout without them simply uses the placeholders) and the game's own in assets/models/.
 */
const MODEL_URLS: Record<string, string> = import.meta.glob(['/assets/licensed/**/*.{glb,gltf}', '/assets/models/**/*.{glb,gltf}'], {
  query: '?url',
  import: 'default',
  eager: true,
});

/** Where one prop came from, for the developer's report. */
export interface PropReport {
  id: PropId;
  name: string;
  source: PropSource['kind'];
  file?: string;
  error?: string;
}

/** A prop ready to place: geometry to merge into a territory's batch, or an imported entity. */
export type PropInstance = { kind: 'built'; build: PropBuild } | { kind: 'imported'; entity: pc.Entity };

/**
 * Loads the licensed models the manifest asks for and hands out props: imported ones adapted to
 * the game's look (paper shading, matte surfaces, pencil outlines, fitted to size), or the
 * game's own builds. A model that fails to load falls back to its placeholder.
 */
export class AssetLibrary {
  private readonly urls = new Map<string, string>();
  private readonly containers = new Map<string, pc.ContainerResource>();
  private readonly errors = new Map<string, string>();
  /** The game's own models from the asset labs: classroom, aircraft, buildings. */
  readonly models: ModelStore;

  constructor(private readonly app: pc.AppBase, urls: Record<string, string> = MODEL_URLS) {
    this.models = new ModelStore(app);
    const keys = Object.keys(urls);
    assetPaths(keys).forEach((path, i) => this.urls.set(path, urls[keys[i]]));
  }

  get available(): ReadonlySet<string> {
    return new Set(this.urls.keys());
  }

  /** Loads every model file the manifest can use (none, if none were supplied). */
  async preload(timeoutMs = 15000): Promise<void> {
    const wanted = new Set<string>();
    for (const def of Object.values(PROPS)) {
      const source = resolveProp(def, this.available);
      if (source.kind === 'licensed' || source.kind === 'model') wanted.add(source.file);
    }
    const custom = [...classroomFiles(), ...Object.values(CATALOG.aircraft).map((a) => a.file), ...[...IN_GAME_BUILDINGS, ...SCENERY_MODELS].map((id) => CATALOG.buildings[id].file)];
    await Promise.all([...[...wanted].map((file) => this.load(file, timeoutMs)), ...custom.map((file) => this.models.load(file, timeoutMs * 2))]);
  }

  /** A prop to place. Imported ones come as a fresh entity each time. */
  instance(id: PropId): PropInstance {
    const def = PROPS[id];
    const source = resolveProp(def, this.available);
    if (source.kind === 'licensed' || source.kind === 'model') {
      const container = this.containers.get(source.file);
      if (container) return { kind: 'imported', entity: this.adapt(id, container) };
    }
    return { kind: 'built', build: def.build() };
  }

  /** What each prop is using right now. */
  report(): PropReport[] {
    return (Object.keys(PROPS) as PropId[]).map((id) => {
      const def = PROPS[id];
      const source = resolveProp(def, this.available);
      if (source.kind !== 'licensed' && source.kind !== 'model') return { id, name: def.name, source: source.kind };
      const error = this.errors.get(source.file);
      return error ? { id, name: def.name, source: def.licensed?.length ? 'placeholder' : 'custom', file: source.file, error } : { id, name: def.name, source: source.kind, file: source.file };
    });
  }

  private load(file: string, timeoutMs: number): Promise<void> {
    const url = this.urls.get(file)!;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.errors.set(file, 'timed out');
        resolve();
      }, timeoutMs);
      this.app.assets.loadFromUrlAndFilename(url, file.split('/').pop()!, 'container', (err, asset) => {
        clearTimeout(timer);
        if (err || !asset?.resource) {
          this.errors.set(file, String(err ?? 'no resource'));
          console.warn(`paperwars: couldn't load model ${file}, building the prop in code instead`, err);
        } else {
          this.containers.set(file, asset.resource as pc.ContainerResource);
        }
        resolve();
      });
    });
  }

  /**
   * An imported model brought into the game's look: matte, non-metallic surfaces under the paper
   * shading (or one library material throughout), scaled to the manifest's height, standing
   * centred on its base, and outlined in pencil.
   */
  private adapt(id: PropId, container: pc.ContainerResource): pc.Entity {
    const def = PROPS[id];
    const inner = container.instantiateRenderEntity();
    const replacement = def.materials && def.materials !== 'keep' ? materials().get(def.materials) : null;
    for (const render of inner.findComponents('render') as pc.RenderComponent[]) {
      render.castShadows = true;
      render.receiveShadows = true;
      for (const mi of render.meshInstances) {
        if (replacement) {
          mi.material = replacement;
          continue;
        }
        const m = mi.material;
        if (m instanceof pc.StandardMaterial && !adapted.has(m)) {
          adapted.add(m);
          m.useMetalness = true;
          m.metalness = 0;
          m.gloss = Math.min(m.gloss, 0.25);
          m.specularityFactor = 0.4;
          m.metalnessMap = null;
          m.glossMap = null;
          m.normalMap = null;
          m.update();
        }
      }
    }
    // Fit: uniform scale to the target height, base on y = 0, centred.
    const root = new pc.Entity(`prop-${id}`);
    root.addChild(inner);
    const box = boundsOf(inner);
    if (box && def.fitHeight) {
      const height = box.halfExtents.y * 2;
      const k = height > 1e-4 ? def.fitHeight / height : 1;
      inner.setLocalScale(k, k, k);
      inner.setLocalPosition(-box.center.x * k, -(box.center.y - box.halfExtents.y) * k, -box.center.z * k);
    }
    outline(root, def.tier, { merge: true });
    return root;
  }
}

/** Imported materials already adapted (several instances share them). */
const adapted = new WeakSet<pc.Material>();

function boundsOf(entity: pc.Entity): pc.BoundingBox | null {
  let box: pc.BoundingBox | null = null;
  for (const render of entity.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of render.meshInstances) {
      if (!box) {
        box = new pc.BoundingBox();
        box.copy(mi.aabb);
      } else {
        box.add(mi.aabb);
      }
    }
  }
  return box;
}
