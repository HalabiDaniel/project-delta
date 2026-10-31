import { describe, expect, it } from 'vitest';
import {
  buildEdgeTopology,
  EDGE_ALWAYS,
  EDGE_CLOSED,
  EDGE_SHEET,
  STROKE_FLOATS,
  STROKE_INDICES,
  STROKE_LAYOUT,
  STROKE_VERTICES,
  writeStrokeIndices,
  writeStrokes,
} from './EdgeTopology';

/** A flat-shaded unit box like the engine's: 6 faces × 4 corners, so every corner exists 3 times. */
function box(): { positions: number[]; indices: number[] } {
  const faces: Array<[number[], number[], number[]]> = [
    // normal, u, v
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [n, u, v] of faces) {
    const base = positions.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) positions.push(0.5 * (n[k] + su * u[k] + sv * v[k]));
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, indices };
}

/** A flat square sheet of two triangles, as a triangle soup. */
const sheet = [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1];

describe('edge topology', () => {
  it('welds a flat-shaded box into 8 corners and 18 edges, all closed', () => {
    const t = buildEdgeTopology(box());
    expect(t.triangles.length / 3).toBe(12);
    expect(t.edgeCount).toBe(18);
    expect([...t.kind].every((k) => k === EDGE_CLOSED)).toBe(true);
    // Every edge has a triangle on both sides.
    expect([...t.faceB].every((f) => f >= 0)).toBe(true);
  });

  it('drops the coplanar face diagonals of a box when asked, keeping its 12 real edges', () => {
    const t = buildEdgeTopology(box(), { dropCoplanar: 0.999 });
    expect(t.edgeCount).toBe(12);
  });

  it('marks the rim of an open sheet as always drawn and its inner diagonal by its surface type', () => {
    const closed = buildEdgeTopology({ positions: sheet });
    expect(closed.edgeCount).toBe(5);
    expect([...closed.kind].filter((k) => k === EDGE_ALWAYS)).toHaveLength(4);
    expect([...closed.kind].filter((k) => k === EDGE_CLOSED)).toHaveLength(1);
    const paper = buildEdgeTopology({ positions: sheet, doubleSided: true });
    expect([...paper.kind].filter((k) => k === EDGE_SHEET)).toHaveLength(1);
    expect([...paper.faceB].filter((f) => f === -1)).toHaveLength(4);
  });

  it('treats an edge shared by three or more triangles as always drawn', () => {
    // Three fins meeting on the X axis.
    const fins = [0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 0, 0.5, -1, 0, 0, 0, 0, 1, 0, 0, 0.5, 0, 1];
    const t = buildEdgeTopology({ positions: fins });
    const spine = [...Array(t.edgeCount).keys()].filter((e) => t.faceB[e] === -1 && t.kind[e] === EDGE_ALWAYS);
    // 6 outer rim edges plus the shared spine.
    expect(spine).toHaveLength(7);
  });

  it('skips degenerate triangles', () => {
    const t = buildEdgeTopology({ positions: [...sheet, 0, 0, 0, 0, 0, 0, 1, 0, 0] });
    expect(t.triangles.length / 3).toBe(2);
  });

  it('gives the same edge the same seed every time', () => {
    const a = buildEdgeTopology(box());
    const b = buildEdgeTopology(box());
    expect([...a.seed]).toEqual([...b.seed]);
    expect([...a.seed].every((s) => s >= 0 && s < 1)).toBe(true);
  });
});

describe('stroke vertices', () => {
  it('writes a quad per edge with both ends, both normals and the side/end/kind/seed info', () => {
    const t = buildEdgeTopology({ positions: sheet });
    const out = new Float32Array(t.edgeCount * STROKE_VERTICES * STROKE_FLOATS);
    writeStrokes(t, sheet, out);
    for (let e = 0; e < t.edgeCount; e++) {
      const v = (k: number) => out.subarray((e * STROKE_VERTICES + k) * STROKE_FLOATS, (e * STROKE_VERTICES + k + 1) * STROKE_FLOATS);
      const [v0, v1, v2, v3] = [v(0), v(1), v(2), v(3)];
      // Vertices 0/1 sit at end A, 2/3 at end B, and point at each other.
      expect([...v0.slice(0, 3)]).toEqual([...v1.slice(0, 3)]);
      expect([...v0.slice(0, 3)]).toEqual([...v2.slice(STROKE_LAYOUT.other, STROKE_LAYOUT.other + 3)]);
      expect([...v2.slice(0, 3)]).toEqual([...v0.slice(STROKE_LAYOUT.other, STROKE_LAYOUT.other + 3)]);
      const info = (x: Float32Array) => [...x.slice(STROKE_LAYOUT.info, STROKE_LAYOUT.info + 2)];
      expect([info(v0), info(v1), info(v2), info(v3)]).toEqual([[-1, 0], [1, 0], [1, 1], [-1, 1]]);
      // The sheet faces +Y or -Y, depending on the winding.
      expect(Math.abs(v0[STROKE_LAYOUT.normalA + 1])).toBeCloseTo(1);
    }
  });

  it('applies a transform to positions and the normal matrix to normals when merging', () => {
    const t = buildEdgeTopology({ positions: sheet });
    const out = new Float32Array(t.edgeCount * STROKE_VERTICES * STROKE_FLOATS);
    // Scale x2 and move up 3; the sheet stays horizontal.
    const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 3, 0, 1];
    const nm = [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5];
    writeStrokes(t, sheet, out, 0, m, nm);
    for (let v = 0; v < t.edgeCount * STROKE_VERTICES; v++) {
      expect(out[v * STROKE_FLOATS + 1]).toBe(3);
      expect(Math.abs(out[v * STROKE_FLOATS + STROKE_LAYOUT.normalA + 1])).toBeCloseTo(1);
    }
  });

  it('indexes two triangles per quad', () => {
    const idx = new Uint32Array(2 * STROKE_INDICES);
    writeStrokeIndices(2, idx, 0, 10);
    expect([...idx]).toEqual([10, 11, 12, 10, 12, 13, 14, 15, 16, 14, 16, 17]);
  });
});
