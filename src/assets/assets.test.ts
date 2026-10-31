import { describe, expect, it } from 'vitest';
import { assetPaths, expectedLicensedFiles, PROPS, resolveProp, type PropDef } from './manifest';

const slot: PropDef = { name: 'Books', build: () => ({ model: null as never }), licensed: ['synty/books_stack.glb', 'synty/books_alt.glb'], tier: 'prop' };

describe('asset manifest', () => {
  it("uses the game's own design for props with no licensed slot", () => {
    expect(resolveProp(PROPS['pencil.yellow'], new Set(['licensed/synty/books_stack.glb']))).toEqual({ kind: 'custom' });
  });

  it('falls back to the placeholder until a licensed file is supplied', () => {
    expect(resolveProp(slot, new Set())).toEqual({ kind: 'placeholder' });
    expect(resolveProp(slot, new Set(['licensed/synty/other.glb']))).toEqual({ kind: 'placeholder' });
    // Without the licensed/ prefix the file isn't in the licensed folder.
    expect(resolveProp(slot, new Set(['synty/books_stack.glb']))).toEqual({ kind: 'placeholder' });
  });

  it('takes the first licensed file present, whatever its case', () => {
    expect(resolveProp(slot, new Set(['licensed/synty/books_alt.glb']))).toEqual({ kind: 'licensed', file: 'licensed/synty/books_alt.glb' });
    expect(resolveProp(slot, new Set(['licensed/Synty/Books_Stack.GLB', 'licensed/synty/books_alt.glb']))).toEqual({ kind: 'licensed', file: 'licensed/Synty/Books_Stack.GLB' });
  });

  it("uses the game's own Blender model when it is there, after any licensed one", () => {
    const own: PropDef = { ...slot, licensed: undefined, model: 'lamp.glb' };
    expect(resolveProp(own, new Set())).toEqual({ kind: 'custom' });
    expect(resolveProp(own, new Set(['models/lamp.glb']))).toEqual({ kind: 'model', file: 'models/lamp.glb' });
    const both: PropDef = { ...slot, model: 'books.glb' };
    expect(resolveProp(both, new Set(['models/books.glb']))).toEqual({ kind: 'model', file: 'models/books.glb' });
    expect(resolveProp(both, new Set(['models/books.glb', 'licensed/synty/books_alt.glb']))).toEqual({ kind: 'licensed', file: 'licensed/synty/books_alt.glb' });
  });

  it('reads glob keys as paths inside assets/', () => {
    expect(assetPaths(['/assets/licensed/synty/books_stack.glb', '../../assets/models/a/b.gltf'])).toEqual(['licensed/synty/books_stack.glb', 'models/a/b.gltf']);
  });

  it('lists every licensed file the game can use, each with a placeholder and a size', () => {
    const list = expectedLicensedFiles();
    expect(list.length).toBeGreaterThan(0);
    for (const { prop } of list) {
      expect(PROPS[prop].fitHeight).toBeGreaterThan(0);
      expect(typeof PROPS[prop].build).toBe('function');
    }
  });

  it('builds every placeholder and own design without errors', () => {
    for (const def of Object.values(PROPS)) {
      const built = def.build();
      expect(built.model.isEmpty).toBe(false);
    }
  });
});
