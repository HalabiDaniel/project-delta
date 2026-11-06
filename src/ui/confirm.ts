/**
 * Confirmations for destructive actions (plan v0.0.15 §4B, docs/DESIGN_SYSTEM.md §2C): Remove a
 * building, End sortie, Leave the classroom, Reset progress, Abandon an operation.
 *
 * One ConfirmDialog for the page (the HUD installs it). Every path to one of these actions goes
 * through `requestConfirm`: the HUD's buttons (through `guardActions`, so single-player and
 * multiplayer get the same dialogs) and the keyboard and controller shortcuts (the game calls
 * `confirmThen`). The shortcut opens the dialog; Enter / A confirms, Esc / B cancels.
 *
 * Without an installed dialog (tests, tools with no HUD) the action goes ahead at once.
 */

import type { ConfirmDialog } from './components';
import { DIALOG_KEYS } from '../input/glyphs';
import type { IconName } from './icons';
import { CONFIRM_TEXT } from './strings';
import type { HudActions, HudView } from './views';

export type ConfirmKind = keyof typeof CONFIRM_TEXT;

const ICONS: Record<ConfirmKind, IconName> = {
  remove: 'remove', endSortie: 'land', endSortieActive: 'land', leave: 'close', reset: 'remove', abandon: 'close',
};

/** What a dialog needs: open() resolving to the answer, and whether one is up. */
export interface ConfirmHost {
  open: ConfirmDialog['open'];
  readonly isOpen: boolean;
}

let host: ConfirmHost | null = null;

export function installConfirmDialog(d: ConfirmHost | null): void {
  host = d;
}

/** A confirm dialog is up: the game ignores its own keys and buttons meanwhile. */
export function confirmOpen(): boolean {
  return host?.isOpen ?? false;
}

/** Asks before a destructive action. True once confirmed; false when cancelled or another dialog is up. */
export function requestConfirm(kind: ConfirmKind): Promise<boolean> {
  if (!host) return Promise.resolve(true);
  if (host.isOpen) return Promise.resolve(false);
  // A captured mouse can't reach the buttons.
  if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.();
  const t = CONFIRM_TEXT[kind];
  return host.open({
    title: t.title,
    body: t.body,
    confirm: { label: t.confirm, icon: ICONS[kind], key: DIALOG_KEYS.confirm },
    cancel: { label: t.cancel, key: DIALOG_KEYS.cancel },
    danger: true,
  });
}

/** Runs `action` once the player confirms. */
export function confirmThen(kind: ConfirmKind, action: () => void): Promise<boolean> {
  return requestConfirm(kind).then((ok) => {
    if (ok) action();
    return ok;
  });
}

/**
 * The HUD's actions with the destructive ones behind a confirm dialog: End sortie (the dialog says
 * when a mission is still on), Reset progress, or Leave in multiplayer (the same menu button), and
 * Abandon operation. Remove is asked by BaseMode itself, so its keyboard shortcut asks too.
 */
export function guardActions(actions: HudActions, opts: { multiplayer: boolean; view: () => HudView | null }): HudActions {
  return {
    ...actions,
    endSortie: () => void confirmThen(opts.view()?.ground?.status === 'active' ? 'endSortieActive' : 'endSortie', () => actions.endSortie()),
    resetProgress: () => void confirmThen(opts.multiplayer ? 'leave' : 'reset', () => actions.resetProgress()),
    abandonOperation: () => void confirmThen('abandon', () => actions.abandonOperation()),
  };
}
