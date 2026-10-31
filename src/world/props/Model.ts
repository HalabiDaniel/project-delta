import * as pc from 'playcanvas';
import { materials } from '../../render/materials/MaterialLibrary';
import type { MaterialId } from '../../render/style';
import { MeshBuilder, type Place } from './MeshBuilder';

/**
 * A model made of library materials: one MeshBuilder per material. Models can be merged (a whole
 * territory's decorations become a handful of meshes and draw calls) and turned into an entity
 * with one child per material, so code that swaps a part's material (damage, wrecks, previews)
 * keeps working.
 */
export class Model {
  readonly parts = new Map<MaterialId | string, MeshBuilder>();
  /** Materials not in the library, e.g. a building's own paint that darkens with damage. */
  private readonly custom = new Map<string, pc.Material>();

  /** The geometry drawn in `material`. */
  part(material: MaterialId): MeshBuilder {
    let b = this.parts.get(material);
    if (!b) {
      b = new MeshBuilder();
      this.parts.set(material, b);
    }
    return b;
  }

  /** Geometry in a material of its own (registered under `key`). */
  own(key: string, material: pc.Material): MeshBuilder {
    this.custom.set(key, material);
    let b = this.parts.get(key);
    if (!b) {
      b = new MeshBuilder();
      this.parts.set(key, b);
    }
    return b;
  }

  /** Adds another model, placed. */
  add(other: Model, place?: Place): this {
    for (const [id, builder] of other.parts) {
      const target = this.parts.get(id) ?? new MeshBuilder();
      this.parts.set(id, target.add(builder, place));
    }
    for (const [key, material] of other.custom) this.custom.set(key, material);
    return this;
  }

  get isEmpty(): boolean {
    return [...this.parts.values()].every((b) => b.isEmpty);
  }

  /** An entity with one child per material. */
  toEntity(device: pc.GraphicsDevice, name: string, options: { castShadows?: boolean; receiveShadows?: boolean } = {}): pc.Entity {
    const root = new pc.Entity(name);
    for (const [id, builder] of this.parts) {
      if (builder.isEmpty) continue;
      const material = this.custom.get(id) ?? materials().get(id as MaterialId);
      const child = new pc.Entity(`${name}:${id}`);
      child.addComponent('render', {
        meshInstances: [new pc.MeshInstance(toMesh(device, builder), material)],
        castShadows: options.castShadows ?? true,
        receiveShadows: options.receiveShadows ?? true,
      });
      root.addChild(child);
    }
    return root;
  }
}

export function toMesh(device: pc.GraphicsDevice, b: MeshBuilder): pc.Mesh {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(b.positions);
  mesh.setNormals(b.normals);
  mesh.setUvs(0, b.uvs);
  mesh.setIndices(b.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}
