import * as pc from 'playcanvas';
import { MATERIALS, type MaterialDef, type MaterialId, type Rgb } from '../style';
import type { TextureBank } from '../shading/textures';

/**
 * The unified material library: every surface in the game should come from here, so paper,
 * cardboard, ink, wood and plastic look the same wherever they appear. Definitions are data
 * (MATERIALS in ../style.ts); this turns them into engine materials and shares them.
 *
 * Geometry built for the library has UVs in metres, so a material's `tiling` is "repeats per
 * metre" and textures keep one scale across objects of any size.
 */
export class MaterialLibrary {
  private readonly shared = new Map<string, pc.StandardMaterial>();

  constructor(private readonly textures: TextureBank) {}

  /** The shared material for an id. Don't change it: use `create` for one to recolour or darken. */
  get(id: MaterialId): pc.StandardMaterial {
    let m = this.shared.get(id);
    if (!m) {
      m = this.create(MATERIALS[id]);
      m.name = id;
      this.shared.set(id, m);
    }
    return m;
  }

  /** A new material of its own, from a library entry with an optional different colour. */
  create(def: MaterialDef, color: Rgb = def.color): pc.StandardMaterial {
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(color[0], color[1], color[2]);
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = def.gloss ?? 0.12;
    m.specularityFactor = def.gloss ? 1 : 0.4;
    if (def.texture) {
      m.diffuseMap = this.textures.get(def.texture);
      const t = def.tiling ?? 1;
      m.diffuseMapTiling = new pc.Vec2(t, t);
    }
    if (def.doubleSided) {
      m.cull = pc.CULLFACE_NONE;
      m.twoSidedLighting = true;
    }
    if (def.grain === false) m.setDefine('PAPER_NO_GRAIN', true);
    m.update();
    return m;
  }

  /** A library material in another colour (shared per colour). */
  tinted(id: MaterialId, color: Rgb): pc.StandardMaterial {
    const key = `${id}#${color.map((c) => c.toFixed(3)).join(',')}`;
    let m = this.shared.get(key);
    if (!m) {
      m = this.create(MATERIALS[id], color);
      m.name = key;
      this.shared.set(key, m);
    }
    return m;
  }
}

let active: MaterialLibrary | null = null;

export function installMaterials(library: MaterialLibrary): void {
  active = library;
}

/** The game's material library (installed at start-up). */
export function materials(): MaterialLibrary {
  if (!active) throw new Error('The material library is not installed');
  return active;
}
