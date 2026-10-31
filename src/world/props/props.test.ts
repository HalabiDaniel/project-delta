import { describe, expect, it } from 'vitest';
import { MeshBuilder, transformPoint, type Vec3 } from './MeshBuilder';

/** Every triangle's winding agrees with its stored normal, and points away from the shape's centre. */
function outward(b: MeshBuilder, centre: Vec3): boolean {
  const p = b.positions, n = b.normals;
  for (let i = 0; i < b.indices.length; i += 3) {
    const [a, c, d] = [b.indices[i] * 3, b.indices[i + 1] * 3, b.indices[i + 2] * 3];
    const u = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const v = [p[d] - p[a], p[d + 1] - p[a + 1], p[d + 2] - p[a + 2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const mid = [(p[a] + p[c] + p[d]) / 3 - centre[0], (p[a + 1] + p[c + 1] + p[d + 1]) / 3 - centre[1], (p[a + 2] + p[c + 2] + p[d + 2]) / 3 - centre[2]];
    const agree = cross[0] * n[a] + cross[1] * n[a + 1] + cross[2] * n[a + 2];
    const out = mid[0] * n[a] + mid[1] * n[a + 1] + mid[2] * n[a + 2];
    if (agree <= 0 || out <= 0) return false;
  }
  return true;
}

describe('mesh builder', () => {
  it('builds a flat-shaded box with outward faces and UVs in metres', () => {
    const b = new MeshBuilder().box([4, 1, 2]);
    expect(b.vertexCount).toBe(24);
    expect(b.indices).toHaveLength(36);
    expect(outward(b, [0, 0, 0])).toBe(true);
    const us = b.uvs.filter((_, i) => i % 2 === 0);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(4);
    expect(b.bounds()).toEqual([[-2, -0.5, -1], [2, 0.5, 1]]);
  });

  it('builds prisms, frustums and cones standing on their base', () => {
    const pencil = new MeshBuilder().cylinder(0.5, 3, { sides: 6 });
    expect(pencil.vertexCount).toBe(6 * 4 + 6 + 6);
    expect(outward(pencil, [0, 1.5, 0])).toBe(true);
    const cone = new MeshBuilder().cylinder(0.5, 1, { sides: 8, topRadius: 0 });
    expect(cone.indices).toHaveLength(8 * 3 + 6 * 3);
    expect(outward(cone, [0, 0.3, 0])).toBe(true);
    const can = new MeshBuilder().cylinder(1, 2, { sides: 12, smooth: true });
    expect(outward(can, [0, 1, 0])).toBe(true);
  });

  it('builds a wedge with outward faces', () => {
    const w = new MeshBuilder().wedge([2, 1, 2]);
    expect(outward(w, [0, 0.35, 0.3])).toBe(true);
  });

  it('places parts: rotation then translation, normals turned with them', () => {
    expect(transformPoint([1, 0, 0], { rot: [0, 90, 0], at: [0, 5, 0] }).map((v) => +v.toFixed(6))).toEqual([0, 5, -1]);
    const b = new MeshBuilder().add(new MeshBuilder().box([1, 1, 1]), { at: [10, 0, 0], rot: [0, 45, 0] });
    expect(outward(b, [10, 0, 0])).toBe(true);
    const [min, max] = b.bounds();
    expect((min[0] + max[0]) / 2).toBeCloseTo(10);
    for (let i = 0; i < b.normals.length; i += 3) expect(Math.hypot(b.normals[i], b.normals[i + 1], b.normals[i + 2])).toBeCloseTo(1);
  });
});

describe('mesh builder: tubes and paper balls', () => {
  it('builds a tube with outward outer walls and inward inner walls', () => {
    const roll = new MeshBuilder().tube(1, 0.6, 0.5, { sides: 10 });
    expect(roll.indices).toHaveLength(10 * 4 * 6);
    // Outer wall normals point away from the axis, inner ones towards it.
    let outer = 0, inner = 0;
    for (let i = 0; i < roll.vertexCount; i++) {
      const [x, y, z] = [roll.positions[i * 3], roll.positions[i * 3 + 1], roll.positions[i * 3 + 2]];
      const [nx, , nz] = [roll.normals[i * 3], roll.normals[i * 3 + 1], roll.normals[i * 3 + 2]];
      const r = Math.hypot(x, z);
      if (Math.abs(roll.normals[i * 3 + 1]) > 0.5 || y < -1) continue;
      const radial = (x * nx + z * nz) / r;
      if (r > 0.95) outer += radial > 0.9 ? 1 : 0;
      else inner += radial < -0.9 ? 1 : 0;
    }
    expect(outer).toBe(40);
    expect(inner).toBe(40);
  });

  it('crumples a closed paper ball the same way every time', () => {
    const a = new MeshBuilder().crumpled(1, 3);
    const b = new MeshBuilder().crumpled(1, 3);
    expect(a.indices).toHaveLength(80 * 3);
    expect(a.positions).toEqual(b.positions);
    expect(outward(a, [0, 0, 0])).toBe(true);
  });
});
