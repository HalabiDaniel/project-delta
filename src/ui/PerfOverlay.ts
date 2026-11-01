import type * as pc from 'playcanvas';
import { checkBudget, type BudgetCheck, type GraphicsPreset } from '../render/GraphicsSettings';

/** One reading of how the game is performing. */
export interface PerfSnapshot {
  fps: number;
  /** Mean and 95th-percentile frame time over the last couple of seconds (ms). */
  frameMs: number;
  frameP95: number;
  /** Frames slower than 33 ms in that window: hitches the player would notice. */
  spikes: number;
  drawCalls: number;
  triangles: number;
  /** Pencil strokes drawn (edges) and objects outlined. */
  strokes: number;
  outlined: number;
  /** GPU memory the engine has allocated for textures and for vertex/index buffers (MB). */
  textureMb: number;
  bufferMb: number;
  /** Repeated meshes drawn instanced: groups (draws) and the copies in them. */
  instanced: { groups: number; copies: number; culled: number } | null;
  /** JavaScript heap in MB, where the browser reports it (Chrome, Edge). */
  heapMb: number | null;
  /** Seconds from page start until the game was ready. */
  loadSeconds: number;
}

const WINDOW = 120;

/**
 * Frame timing and rendering counts, for measuring on real hardware: shown in a corner with
 * `?perf` in the address, and always available from the console as `paperwars.perf()`.
 */
export class PerfMonitor {
  private readonly times: number[] = [];
  private last = 0;
  private el: HTMLElement | null = null;
  private shownAt = 0;
  readonly loadSeconds = performance.now() / 1000;

  /** The graphics preset the frame is judged against, and the instancer's counts. */
  preset: () => GraphicsPreset = () => 'high';
  instanced: () => PerfSnapshot['instanced'] = () => null;

  constructor(
    private readonly app: pc.AppBase,
    private readonly strokes: () => { objects: number; edges: number },
    show: boolean,
  ) {
    if (show) {
      this.el = document.createElement('div');
      this.el.className = 'perf-overlay';
      this.el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.el);
    }
  }

  /** Call once a frame. */
  frame(): void {
    const now = performance.now();
    if (this.last > 0) {
      this.times.push(now - this.last);
      if (this.times.length > WINDOW) this.times.shift();
    }
    this.last = now;
    if (this.el && now - this.shownAt > 500) {
      this.shownAt = now;
      const s = this.snapshot();
      this.el.textContent =
        `${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms (p95 ${s.frameP95.toFixed(1)}, ${s.spikes} spikes)\n` +
        `${s.drawCalls} draws  ${(s.triangles / 1000).toFixed(0)}k tris  ${s.strokes} strokes / ${s.outlined} objects` +
        (s.instanced ? `\n${s.instanced.copies} instanced in ${s.instanced.groups} draws (${s.instanced.culled} culled)` : '') +
        `\n${s.textureMb.toFixed(0)} MB textures  ${s.bufferMb.toFixed(0)} MB buffers` +
        (s.heapMb !== null ? `  ${s.heapMb.toFixed(0)} MB heap` : '') +
        `\nloaded in ${s.loadSeconds.toFixed(1)} s` +
        `\n${budgetLine(this.budget(s))}`;
    }
  }

  snapshot(): PerfSnapshot {
    const sorted = [...this.times].sort((a, b) => a - b);
    const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    const stats = this.app.stats as unknown as { drawCalls: { total: number }; frame: { triangles?: number; primitives?: number } };
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const strokes = this.strokes();
    const vram = (this.app.graphicsDevice as unknown as { _vram?: { tex?: number; vb?: number; ib?: number } })._vram ?? {};
    return {
      fps: mean > 0 ? 1000 / mean : 0,
      frameMs: mean,
      frameP95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      spikes: sorted.filter((t) => t > 33).length,
      drawCalls: stats.drawCalls.total,
      triangles: stats.frame.triangles ?? stats.frame.primitives ?? 0,
      strokes: strokes.edges,
      outlined: strokes.objects,
      textureMb: (vram.tex ?? 0) / 1048576,
      bufferMb: ((vram.vb ?? 0) + (vram.ib ?? 0)) / 1048576,
      instanced: this.instanced(),
      heapMb: memory ? memory.usedJSHeapSize / 1048576 : null,
      loadSeconds: this.loadSeconds,
    };
  }

  /** This frame against the current preset's budget. */
  budget(s: PerfSnapshot = this.snapshot()): BudgetCheck {
    return checkBudget(this.preset(), { drawCalls: s.drawCalls, triangles: s.triangles, strokes: s.strokes, textureMb: s.textureMb, loadSeconds: s.loadSeconds });
  }
}

function budgetLine(b: BudgetCheck): string {
  return b.ok ? `${b.preset} budget: ok` : `${b.preset} budget OVER: ${b.over.join(', ')}`;
}
