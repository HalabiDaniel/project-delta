/** Largest single mouse-move delta accepted; browsers sometimes spike around pointer-lock changes. */
const MAX_MOUSE_STEP = 120;
/**
 * The cursor jump when pointer lock engages can arrive as one large bogus move, either just before
 * or just after the lock change event. Movement is ignored from the request until shortly after
 * the change (or until the cap, if the lock never comes).
 */
const LOCK_SETTLE_MS = 100;
const LOCK_REQUEST_CAP_MS = 500;

const GAME_KEYS = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyR', 'Escape']);

/**
 * Keyboard and mouse for the game, using physical key codes (so WASD works on any layout).
 * Mouse movement is accumulated as deltas and consumed once per frame. While flying, the canvas
 * holds pointer lock so the mouse can steer without the cursor leaving the window.
 */
export class Input {
  private readonly held = new Set<string>();
  private dx = 0;
  private dy = 0;
  private ignoreMouseUntil = 0;
  private readonly keyHandlers: Array<(code: string) => void> = [];
  private readonly clickHandlers: Array<() => void> = [];
  private readonly lockHandlers: Array<(locked: boolean) => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!GAME_KEYS.has(e.code)) return;
      if (e.code === 'Space') e.preventDefault(); // no page scrolling or button activation
      this.held.add(e.code);
      if (!e.repeat) for (const handler of this.keyHandlers) handler(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    document.addEventListener('mousemove', (e) => {
      if (performance.now() < this.ignoreMouseUntil) return;
      this.dx += clamp(e.movementX, -MAX_MOUSE_STEP, MAX_MOUSE_STEP);
      this.dy += clamp(e.movementY, -MAX_MOUSE_STEP, MAX_MOUSE_STEP);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      for (const handler of this.clickHandlers) handler();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockerror', () => {
      this.ignoreMouseUntil = 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.ignoreMouseUntil = performance.now() + LOCK_SETTLE_MS;
      for (const handler of this.lockHandlers) handler(this.pointerLocked);
    });
  }

  onKeyDown(handler: (code: string) => void): void {
    this.keyHandlers.push(handler);
  }

  /** Left mouse button pressed on the game canvas. */
  onCanvasClick(handler: () => void): void {
    this.clickHandlers.push(handler);
  }

  onPointerLockChange(handler: (locked: boolean) => void): void {
    this.lockHandlers.push(handler);
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  /** -1, 0 or +1 from a pair of keys. */
  axis(negative: string, positive: string): number {
    return (this.isHeld(positive) ? 1 : 0) - (this.isHeld(negative) ? 1 : 0);
  }

  /** Mouse movement since the previous call. */
  consumeMouse(): { dx: number; dy: number } {
    const delta = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return delta;
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /**
   * Best effort: browsers only grant pointer lock during a user gesture (a key press or click),
   * and embedded pages may not allow it at all. Steering still works from raw mouse deltas while
   * the cursor stays over the window.
   */
  requestPointerLock(): void {
    if (this.pointerLocked || !this.canvas.requestPointerLock) return;
    this.ignoreMouseUntil = performance.now() + LOCK_REQUEST_CAP_MS;
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Not permitted here; fall back to unlocked steering.
      this.ignoreMouseUntil = 0;
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
