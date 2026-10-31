import * as pc from 'playcanvas';
import type { TextureId } from '../style';

/**
 * Procedural textures for the material library, drawn on canvases when the game starts: no image
 * files to load, license or keep in sync. Every pattern tiles. Most are near-white so the
 * material's colour shows through; notebook and graph paper carry their own coloured lines.
 *
 * To add one: add its id to TextureId in ../style.ts and a painter below.
 */

type Painter = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;

const SIZES: Partial<Record<TextureId | 'grain', number>> = { notebook: 512, graph: 512, wood: 512 };
/** Only the big sheets seen at grazing angles need anisotropic filtering. */
const ANISOTROPY: Partial<Record<TextureId | 'grain', number>> = { notebook: 4, graph: 4 };

const PAINTERS: Record<TextureId, Painter> = {
  paper: (ctx, size, rand) => {
    fill(ctx, size, '#fbfaf6');
    speckle(ctx, size, rand, 1400, 'rgba(120,110,90,', 0.05);
    fibres(ctx, size, rand, 90, 'rgba(150,140,120,0.07)');
  },
  notebook: (ctx, size, rand) => {
    fill(ctx, size, '#fdfcf7');
    speckle(ctx, size, rand, 2200, 'rgba(120,110,90,', 0.04);
    // Four ruled lines per tile, printed in pale blue.
    const step = size / 4;
    for (let i = 0; i < 4; i++) {
      const y = Math.round(i * step + step * 0.5);
      ctx.fillStyle = 'rgba(96,146,214,0.7)';
      ctx.fillRect(0, y - 1.5, size, 3);
      ctx.fillStyle = 'rgba(96,146,214,0.18)';
      ctx.fillRect(0, y - 3, size, 6);
    }
  },
  graph: (ctx, size, rand) => {
    fill(ctx, size, '#fbfdf9');
    speckle(ctx, size, rand, 1600, 'rgba(120,110,90,', 0.04);
    const fine = size / 16;
    for (let i = 0; i < 16; i++) {
      const bold = i % 4 === 0;
      ctx.fillStyle = bold ? 'rgba(70,150,120,0.7)' : 'rgba(70,150,120,0.35)';
      const w = bold ? 3 : 1.5;
      ctx.fillRect(Math.round(i * fine) - w / 2, 0, w, size);
      ctx.fillRect(0, Math.round(i * fine) - w / 2, size, w);
    }
  },
  cardboard: (ctx, size, rand) => {
    fill(ctx, size, '#f4f0ea');
    // Faint bands from the flutes under the liner.
    for (let x = 0; x < size; x += size / 16) {
      ctx.fillStyle = 'rgba(90,60,30,0.05)';
      ctx.fillRect(x, 0, size / 32, size);
    }
    speckle(ctx, size, rand, 2600, 'rgba(70,45,20,', 0.12);
    fibres(ctx, size, rand, 160, 'rgba(90,60,30,0.08)');
  },
  corrugated: (ctx, size) => {
    // The cut edge: two liners with the wavy flute between them.
    fill(ctx, size, '#efe5d6');
    ctx.fillStyle = 'rgba(60,40,20,0.35)';
    ctx.fillRect(0, size * 0.12, size, size * 0.06);
    ctx.fillRect(0, size * 0.82, size, size * 0.06);
    ctx.strokeStyle = 'rgba(60,40,20,0.45)';
    ctx.lineWidth = size * 0.04;
    ctx.beginPath();
    for (let x = 0; x <= size; x++) {
      const y = size * (0.5 + 0.3 * Math.sin((x / size) * Math.PI * 4));
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  },
  kraft: (ctx, size, rand) => {
    fill(ctx, size, '#f1ebe2');
    speckle(ctx, size, rand, 4000, 'rgba(60,35,15,', 0.16);
    fibres(ctx, size, rand, 220, 'rgba(70,45,20,0.1)');
  },
  wood: (ctx, size, rand) => {
    fill(ctx, size, '#f6efe4');
    // Long wavy grain lines along U.
    for (let i = 0; i < 46; i++) {
      const y0 = rand() * size;
      const amp = 4 + rand() * 10;
      const freq = 1 + Math.floor(rand() * 3);
      ctx.strokeStyle = `rgba(110,70,35,${0.06 + rand() * 0.12})`;
      ctx.lineWidth = 1 + rand() * 3;
      for (const shift of [-size, 0, size]) {
        ctx.beginPath();
        for (let x = 0; x <= size; x += 4) {
          const y = y0 + shift + Math.sin((x / size) * Math.PI * 2 * freq + y0) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  },
  hatching: (ctx, size, rand) => {
    fill(ctx, size, '#ffffff');
    // Quick diagonal pencil strokes.
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = rand() * size * 1.4 - size * 0.2;
      const len = size * (0.15 + rand() * 0.25);
      ctx.strokeStyle = `rgba(40,40,50,${0.25 + rand() * 0.35})`;
      ctx.lineWidth = 1 + rand() * 1.5;
      const y = rand() * size;
      for (const [dx, dy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + len * 0.7, y + dy - len * 0.7);
        ctx.stroke();
      }
    }
  },
  rubber: (ctx, size, rand) => {
    fill(ctx, size, '#fbf7f6');
    speckle(ctx, size, rand, 900, 'rgba(255,255,255,', 0.5);
    speckle(ctx, size, rand, 700, 'rgba(90,40,50,', 0.08);
  },
  tape: (ctx, size, rand) => {
    fill(ctx, size, '#f7f5f0');
    fibres(ctx, size, rand, 140, 'rgba(110,100,80,0.07)', true);
    speckle(ctx, size, rand, 900, 'rgba(110,100,80,', 0.05);
  },
  pencilWood: (ctx, size, rand) => {
    fill(ctx, size, '#f8f1e6');
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = `rgba(150,100,60,${0.05 + rand() * 0.1})`;
      ctx.fillRect(0, rand() * size, size, 1 + rand() * 3);
    }
  },
  ink: (ctx, size, rand) => {
    fill(ctx, size, '#ffffff');
    // Soft brush streaks.
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.05})`;
      ctx.fillRect(0, rand() * size, size, 2 + rand() * 10);
    }
  },
};

/** Builds textures on first use and keeps them. */
export class TextureBank {
  private readonly cache = new Map<string, pc.Texture>();

  constructor(private readonly device: pc.GraphicsDevice) {}

  get(id: TextureId): pc.Texture {
    let tex = this.cache.get(id);
    if (!tex) {
      const size = SIZES[id] ?? 256;
      tex = this.fromCanvas(id, paint(size, PAINTERS[id], hashString(id)), true, ANISOTROPY[id] ?? 1);
      this.cache.set(id, tex);
    }
    return tex;
  }

  /**
   * The paper grain every lit surface is multiplied by (see PaperShading): soft multi-octave
   * noise with fibres, centred on mid grey, in linear space.
   */
  grain(): pc.Texture {
    let tex = this.cache.get('grain');
    if (!tex) {
      tex = this.fromCanvas('grain', paint(256, paintGrain, 7), false);
      this.cache.set('grain', tex);
    }
    return tex;
  }

  private fromCanvas(name: string, canvas: HTMLCanvasElement, srgb: boolean, anisotropy = 1): pc.Texture {
    const tex = new pc.Texture(this.device, {
      name: `paper-${name}`,
      width: canvas.width,
      height: canvas.height,
      format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      anisotropy,
    });
    tex.setSource(canvas);
    return tex;
  }
}

function paint(size: number, painter: Painter, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  painter(ctx, size, mulberry32(seed));
  return canvas;
}

function paintGrain(ctx: CanvasRenderingContext2D, size: number, rand: () => number): void {
  const img = ctx.createImageData(size, size);
  const octaves = [
    { cells: 8, weight: 0.35 },
    { cells: 32, weight: 0.35 },
    { cells: 128, weight: 0.3 },
  ].map((o) => ({ ...o, lattice: Array.from({ length: o.cells * o.cells }, () => rand()) }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const o of octaves) v += o.weight * valueNoise(o.lattice, o.cells, (x / size) * o.cells, (y / size) * o.cells);
      const g = Math.max(0, Math.min(255, Math.round((0.5 + (v - 0.5) * 1.6) * 255)));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  fibres(ctx, size, rand, 120, 'rgba(70,70,70,0.12)');
  fibres(ctx, size, rand, 80, 'rgba(255,255,255,0.12)');
}

/** Tileable smooth value noise on a wrapped lattice of cells × cells. */
function valueNoise(lattice: number[], cells: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) => lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
  const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

function fill(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
}

/** Tiny dots, wrapped at the edges so the tile repeats seamlessly. */
function speckle(ctx: CanvasRenderingContext2D, size: number, rand: () => number, count: number, rgbaPrefix: string, maxAlpha: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `${rgbaPrefix}${(rand() * maxAlpha).toFixed(3)})`;
    const s = 1 + rand() * 1.5;
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
}

/** Short hair-thin fibres in random directions (or mostly along U), wrapped at the edges. */
function fibres(ctx: CanvasRenderingContext2D, size: number, rand: () => number, count: number, color: string, alongU = false): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const x = rand() * size, y = rand() * size;
    const a = alongU ? (rand() - 0.5) * 0.3 : rand() * Math.PI;
    const len = 4 + rand() * size * 0.06;
    for (const [dx, dy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
      ctx.stroke();
    }
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
