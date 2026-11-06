// @vitest-environment happy-dom
/**
 * Multiplayer asks before ending a sortie, like single-player (v0.0.15 phase 4 left this open):
 * Enter after a landing opens the confirm dialog, and while any confirm dialog is up the
 * controller is in the menu context and no key reaches the game.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MultiplayerGame } from './MultiplayerGame';
import { guardActions, installConfirmDialog, type ConfirmHost } from '../ui/confirm';
import { CONFIRM_TEXT } from '../ui/strings';
import type { HudActions } from '../ui/views';

interface Game {
  onAction(a: string, d: string): void;
  inputContext(): string;
  lostDialog: { isOpen: boolean };
}

function rig(phase: string) {
  const asked: string[] = [];
  const sent: unknown[] = [];
  let ended = 0;
  let open = false;
  let resolve: (ok: boolean) => void = () => {};
  const host: ConfirmHost = {
    get isOpen() { return open; },
    open: (o) => {
      asked.push(o.title);
      open = true;
      return new Promise<boolean>((r) => (resolve = r));
    },
  };
  installConfirmDialog(host);
  const raw = { endSortie: () => ended++ } as unknown as HudActions;
  const game = Object.create(MultiplayerGame.prototype) as Game;
  Object.defineProperty(game, 'room', { value: {} });
  Object.assign(game, {
    sounds: { unlock() {} },
    lostDialog: { isOpen: false },
    lobby: { open: false },
    paused: false,
    state: { phase },
    baseMode: null,
    offers: [],
    hud: { guarded: guardActions(raw, { multiplayer: true, view: () => null }), alert() {} },
    send: (c: unknown) => sent.push(c),
  });
  const answer = async (ok: boolean) => {
    open = false;
    resolve(ok);
    for (let i = 0; i < 3; i++) await Promise.resolve();
  };
  return { game, asked, sent, answer, ended: () => ended };
}

afterEach(() => installConfirmDialog(null));

describe('multiplayer: End sortie asks first', () => {
  it('Enter after a landing opens the dialog instead of ending the sortie; confirming ends it', async () => {
    const r = rig('landed');
    r.game.onAction('confirm', 'keyboard');
    expect(r.asked).toEqual([CONFIRM_TEXT.endSortie.title]);
    expect(r.ended()).toBe(0);
    expect(r.sent).toEqual([]);
    // While it is up the controller is in the menu context and the game gets no keys.
    expect(r.game.inputContext()).toBe('menu');
    r.game.onAction('fold', 'keyboard');
    r.game.onAction('confirm', 'keyboard');
    r.game.onAction('launch', 'gamepad');
    expect(r.sent).toEqual([]);
    expect(r.asked).toHaveLength(1);
    await r.answer(true);
    expect(r.ended()).toBe(1);
    expect(r.game.inputContext()).toBe('home');
  });

  it('cancelling keeps the plane on the runway', async () => {
    const r = rig('landed');
    r.game.onAction('confirm', 'keyboard');
    await r.answer(false);
    expect(r.ended()).toBe(0);
  });

  it('the server-lost dialog also keeps buttons from the game', () => {
    const r = rig('desk');
    r.game.lostDialog.isOpen = true;
    expect(r.game.inputContext()).toBe('menu');
    r.game.onAction('fold', 'keyboard');
    expect(r.sent).toEqual([]);
  });
});
