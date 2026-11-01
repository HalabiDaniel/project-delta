import { describe, expect, it } from 'vitest';
import { findSlot, inspectGlb } from '../../tools/validate-glb';

/** A minimal GLB: one quad (two triangles) of the given size, optionally under a scaled node. */
function glb(size: [number, number, number], extra: Record<string, unknown> = {}, nodeScale?: number): Buffer {
  const positions = new Float32Array([0, 0, 0, size[0], 0, 0, size[0], size[1], size[2], 0, size[1], size[2]]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, ...(nodeScale ? { scale: [nodeScale, nodeScale, nodeScale] } : {}) }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'Palette' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: size },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 12 },
    ],
    buffers: [{ byteLength: bin.length }],
    ...extra,
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const body = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
  const chunk = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, body)]);
}

describe('GLB validator (tools/validate-glb.ts)', () => {
  it('reports triangles, materials and bounds, with node transforms', () => {
    const r = inspectGlb('x.glb', glb([2, 4, 0]), () => null);
    expect(r.ok).toBe(true);
    expect(r.triangles).toBe(2);
    expect(r.materials).toEqual(['Palette']);
    expect(r.bounds?.size).toEqual([2, 4, 0]);
    expect(r.slot).toBeNull();
    expect(inspectGlb('x.glb', glb([2, 4, 0], {}, 3), () => null).bounds?.size).toEqual([6, 12, 0]);
  });

  it('matches a manifest slot by file name and works out the fit', () => {
    expect(findSlot('assets/licensed/Synty/Globe.glb')?.[0]).toBe('globe');
    expect(findSlot('assets/licensed/synty/nothing.glb')).toBeNull();
    const r = inspectGlb('assets/licensed/synty/globe.glb', glb([1, 2, 1]));
    expect(r.slot?.id).toBe('globe');
    expect(r.slot?.scale).toBeCloseTo(5.2 / 2, 3);
    expect(r.slot?.footprint).toEqual([2.6, 2.6]);
  });

  it('rejects files the game cannot read', () => {
    expect(inspectGlb('x.glb', Buffer.from('not a model at all, sorry')).ok).toBe(false);
    const draco = inspectGlb('x.glb', glb([1, 1, 1], { extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] }));
    expect(draco.ok).toBe(false);
    expect(draco.errors[0]).toMatch(/draco/);
  });
});
