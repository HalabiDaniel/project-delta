import { Game } from './Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

Game.create(canvas, hudRoot)
  .then((game) => {
    // Handle for tuning and debugging from the browser console, e.g. `paperwars.state`.
    (window as unknown as { paperwars: Game }).paperwars = game;
  })
  .catch((error: unknown) => {
    console.error(error);
    const message = document.createElement('div');
    message.className = 'boot-error';
    message.textContent =
      'paperwars.io needs WebGL 2 to run. Try an up-to-date desktop browser with hardware acceleration enabled.';
    document.body.appendChild(message);
  });
