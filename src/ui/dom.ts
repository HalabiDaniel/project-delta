/** Tiny DOM helpers for the HUD: each only touches the page when the value actually changes. */

export interface ScreenPoint {
  x: number;
  y: number;
}

export function text(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function attr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function toggle(el: HTMLElement, visible: boolean): void {
  if (el.hidden === visible) el.hidden = !visible;
}

export function place(el: HTMLElement, point: ScreenPoint | null): void {
  toggle(el, point !== null);
  if (point) el.style.transform = `translate(${point.x}px, ${point.y}px)`;
}

export function width(el: HTMLElement, fraction: number): void {
  const value = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  if (el.style.width !== value) el.style.width = value;
}

/** Escapes text for use inside an HTML template. */
export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Buttons never take focus, so Space can't re-trigger them after a click. */
export function bindButton(button: HTMLElement, action: () => void): void {
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    action();
  });
}
