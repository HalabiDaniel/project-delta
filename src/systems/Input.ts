/** Largest single mouse-move delta accepted; browsers sometimes spike around pointer-lock changes. */
const MAX_MOUSE_STEP = 120;
/**
 * The cursor jump when pointer lock engages can arrive as one large bogus move, either just before
 * or just after the lock change event. Movement is ignored from the request until shortly after
 * the change (or until the cap, if the lock never comes).
 */
const LOCK_SETTLE_MS = 100;
const LOCK_REQUEST_CAP_MS = 500;

const GAME_KEYS = new Set([
  'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyR', 'KeyQ', 'KeyE', 'KeyM', 'Escape', 'Enter', 'NumpadEnter',
  'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyL', 'Backquote',
  // B base management, H key hints, U upgrade, Delete remove; 0–7 pick mission cards or base slots.
  'KeyB', 'KeyH', 'KeyU', 'Delete',
  // Multiplayer: Z / C / V emotes, Tab the scoreboard.
  'KeyZ', 'KeyC', 'KeyV', 'Tab',
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7',
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7',
]);

/** Mouse buttons as reported by MouseEvent.button. */
export const MOUSE_LEFT = 0;
export const MOUSE_RIGHT = 2;

/**
 * Keyboard and mouse for the game, using physical key codes (so WASD works on any layout).
 * Mouse movement is accumulated as deltas and consumed once per frame. While flying, the canvas
 * holds pointer lock so the mouse can steer without the cursor leaving the window.
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly buttons = new Set<number>();
  private dx = 0;
  private dy = 0;
  private ignoreMouseUntil = 0;
  private readonly keyHandlers: Array<(code: string) => void> = [];
  private readonly clickHandlers: Array<(button: number) => void> = [];
  private readonly lockHandlers: Array<(locked: boolean) => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!GAME_KEYS.has(e.code)) return;
      // Keys typed into a form control (the developer panel's) are not for the game.
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); // no page scrolling, button activation or focus moves
      this.held.add(e.code);
      if (!e.repeat) for (const handler of this.keyHandlers) handler(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.buttons.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (performance.now() < this.ignoreMouseUntil) return;
      this.dx += clamp(e.movementX, -MAX_MOUSE_STEP, MAX_MOUSE_STEP);
      this.dy += clamp(e.movementY, -MAX_MOUSE_STEP, MAX_MOUSE_STEP);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== MOUSE_LEFT && e.button !== MOUSE_RIGHT) return;
      this.buttons.add(e.button);
      for (const handler of this.clickHandlers) handler(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
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

  /** Left or right mouse button pressed on the game canvas. */
  onCanvasClick(handler: (button: number) => void): void {
    this.clickHandlers.push(handler);
  }

  /** Is this mouse button held down (pressed on the canvas and not yet released)? */
  isButtonHeld(button: number): boolean {
    return this.buttons.has(button);
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
