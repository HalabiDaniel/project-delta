import type { Shape } from '../combat/Collision';
import type { MaterialId, OutlineTier } from '../render/style';
import { MeshBuilder } from '../world/props/MeshBuilder';
import { Model } from '../world/props/Model';
import { SYNTY_PROPS, type SyntyCategory, type SyntyPropId } from './synty';
import { bookStack, eraser, lyingPencil, paperBall, paperFlag, paperStack, ruler, stickyNote, tapeRoll } from '../world/props/stationery';

/**
 * Every decorative prop the world can place, by logical id. A prop is either one of the game's own
 * designs (built in code), or a slot for a licensed model (Synty, or anything else bought) that
 * the developer drops into `assets/licensed/`. Until that file exists, an original low-poly
 * placeholder stands in, so nothing else waits for it.
 *
 * See assets/licensed/README.md for where files go and docs/ART_DIRECTION.md for adding props.
 */

export type PropId =
  | 'pencil.yellow'
  | 'pencil.red'
  | 'pencil.blue'
  | 'eraser'
  | 'ruler'
  | 'paperStack'
  | 'paperBall'
  | 'stickyNote.yellow'
  | 'stickyNote.pink'
  | 'tapeRoll'
  | 'flag.player'
  | 'bookStack'
  | 'globe'
  // The environment slots for licensed models (v0.0.11): src/assets/synty.ts.
  | SyntyPropId;

export interface PropBuild {
  model: Model;
  /** Flat markings: no outlines, no shadows. */
  decals?: Model;
}

export interface PropDef {
  /** Shown in reports and docs. */
  name: string;
  /** Built in code: the game's own design, or the stand-in for a licensed model. */
  build: () => PropBuild;
  /**
   * Licensed model files that replace `build`, relative to assets/licensed/, first found wins. A
   * prop without any is one of the game's own designs.
   */
  licensed?: readonly string[];
  /**
   * One of the game's own models made in Blender (committed under assets/models/), used instead
   * of `build` when the file is there. For shapes too fiddly to build in code.
   */
  model?: string;
  /** An imported model is scaled to this height (m) and stood on its base, centred. */
  fitHeight?: number;
  /**
   * How an imported model's materials are adapted: 'keep' its colours (Synty's palette texture)
   * under the paper shading, or replace them all with one library material.
   */
  materials?: 'keep' | MaterialId;
  tier: OutlineTier;
  /** Simple collision shapes in the prop's own space, for props tall enough to fly into. */
  colliders?: readonly Shape[];
  /** What a licensed slot is for (classroom furniture, architecture, props, obstacles). */
  category?: SyntyCategory;
}

export const PROPS: Record<PropId, PropDef> = {
  'pencil.yellow': { name: 'Pencil', build: () => ({ model: lyingPencil(4.4, 0.18, 'pencil/yellow') }), tier: 'prop' },
  'pencil.red': { name: 'Red pencil', build: () => ({ model: lyingPencil(3.8, 0.18, 'paper/red') }), tier: 'prop' },
  'pencil.blue': { name: 'Blue pencil', build: () => ({ model: lyingPencil(4, 0.18, 'paper/blue') }), tier: 'prop' },
  eraser: { name: 'Eraser', build: () => ({ model: eraser() }), tier: 'prop' },
  ruler: {
    name: 'Ruler',
    build: () => {
      const r = ruler(12, 1.1);
      return { model: r.body, decals: r.marks };
    },
    tier: 'prop',
  },
  paperStack: { name: 'Stack of paper', build: () => ({ model: paperStack(7, 3, 2.2, 2) }), tier: 'prop' },
  paperBall: { name: 'Crumpled paper', build: () => ({ model: paperBall(0.85, 4) }), tier: 'prop' },
  'stickyNote.yellow': { name: 'Sticky note', build: () => ({ model: stickyNote(2, 'paper/sticky') }), tier: 'prop' },
  'stickyNote.pink': { name: 'Pink sticky note', build: () => ({ model: stickyNote(1.8, 'paper/pink') }), tier: 'prop' },
  tapeRoll: { name: 'Tape roll', build: () => ({ model: tapeRoll() }), tier: 'prop' },
  'flag.player': { name: 'Player flag', build: () => ({ model: paperFlag('paper/blue', 5.5) }), tier: 'structure' },
  // ---- Licensed slots (placeholders until the files are supplied) ----
  bookStack: {
    name: 'Stack of books',
    build: () => ({ model: bookStack(3) }),
    licensed: ['synty/books_stack.glb'],
    fitHeight: 2.2,
    materials: 'keep',
    tier: 'prop',
    colliders: [{ kind: 'box', x: 0, y: 1.1, z: 0, hx: 2.3, hy: 1.1, hz: 1.8, yaw: 0 }],
  },
  globe: {
    name: 'Classroom globe',
    build: () => ({ model: globePlaceholder() }),
    licensed: ['synty/globe.glb'],
    fitHeight: 5.2,
    materials: 'keep',
    tier: 'prop',
    colliders: [
      { kind: 'sphere', x: 0, y: 3.4, z: 0, r: 1.8 },
      { kind: 'box', x: 0, y: 0.8, z: 0, hx: 0.9, hy: 0.8, hz: 0.9, yaw: 0 },
    ],
  },
  ...SYNTY_PROPS,
};

/** An original stand-in for a classroom globe: a faceted blue ball with green land, on a tilted ring and a stand. */
function globePlaceholder(): Model {
  const m = new Model();
  m.part('plastic/blue').cylinder(1.1, 0.25, { sides: 10 });
  m.part('pencil/metal').cylinder(0.12, 1.6, { sides: 6 }, { at: [0, 0.25, 0] });
  const ball = new MeshBuilder().crumpled(1.75, 9, { at: [0, 3.4, 0] });
  const [sea, land] = splitFacets(ball, (x, y, z) => Math.sin(x * 1.7 + 0.4) * Math.cos(z * 1.3 - y * 0.9) > 0.18);
  m.part('paper/blue').add(sea);
  m.part('paper/green').add(land);
  m.part('pencil/metal').tube(2.05, 1.9, 0.12, { sides: 18 }, { at: [0, 3.4, 0], rot: [90, 0, 23] });
  return m;
}

/** Splits a builder's triangles in two by where their centres lie. */
function splitFacets(b: MeshBuilder, pick: (x: number, y: number, z: number) => boolean): [MeshBuilder, MeshBuilder] {
  const out: [MeshBuilder, MeshBuilder] = [new MeshBuilder(), new MeshBuilder()];
  for (let i = 0; i < b.indices.length; i += 3) {
    const tri = [b.indices[i], b.indices[i + 1], b.indices[i + 2]];
    const c = [0, 1, 2].map((k) => tri.reduce((sum, v) => sum + b.positions[v * 3 + k], 0) / 3);
    const target = out[pick(c[0], c[1], c[2]) ? 1 : 0];
    target.face(tri.map((v) => [b.positions[v * 3], b.positions[v * 3 + 1], b.positions[v * 3 + 2]] as [number, number, number]));
  }
  return out;
}

// ---- Choosing a source ------------------------------------------------------------------------

export type PropSource = { kind: 'licensed'; file: string } | { kind: 'model'; file: string } | { kind: 'placeholder' } | { kind: 'custom' };

/**
 * Where a prop comes from, given the model files present (paths relative to assets/, e.g.
 * `licensed/synty/globe.glb`, `models/lamp.glb`): the first of its licensed files that exists,
 * else its own Blender model if present, else its code-built design (a placeholder for a licensed
 * slot, or the game's own design).
 */
export function resolveProp(def: PropDef, available: ReadonlySet<string>): PropSource {
  const lower = new Map([...available].map((f) => [f.toLowerCase(), f]));
  for (const file of def.licensed ?? []) {
    const found = lower.get(`licensed/${file}`.toLowerCase());
    if (found) return { kind: 'licensed', file: found };
  }
  if (def.model) {
    const found = lower.get(`models/${def.model}`.toLowerCase());
    if (found) return { kind: 'model', file: found };
  }
  return def.licensed?.length ? { kind: 'placeholder' } : { kind: 'custom' };
}

/** Turns the keys of an import.meta.glob over assets/ into paths relative to it. */
export function assetPaths(globKeys: readonly string[]): string[] {
  return globKeys.map((k) => k.replace(/\\/g, '/').replace(/^.*?assets\//, ''));
}

/** Every licensed file the manifest can use, for the README and the developer's checklist. */
export function expectedLicensedFiles(): Array<{ prop: PropId; files: readonly string[] }> {
  return (Object.keys(PROPS) as PropId[]).filter((id) => PROPS[id].licensed?.length).map((id) => ({ prop: id, files: PROPS[id].licensed! }));
}
