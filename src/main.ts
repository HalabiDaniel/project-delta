import { Game } from './Game';
import { applyTokens, systemTokenOptions } from './ui/tokens';

// The design tokens on :root before anything draws (src/ui/tokens.ts, docs/DESIGN_SYSTEM.md).
applyTokens(document.documentElement, systemTokenOptions());

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
// Multiplayer: ?mp, or an invite link (…/?invite=CODE) straight into the lobby.
const query = new URLSearchParams(window.location.search);
const multiplayer = query.has('mp') || query.has('invite');
// The design system gallery (?ui-gallery): every component in every state, no game.
const gallery = query.has('ui-gallery');

function bootError(error: unknown): void {
  console.error(error);
  const message = document.createElement('div');
  message.className = 'boot-error';
  message.textContent = 'paperwars.io needs WebGL 2 to run. Try an up-to-date desktop browser with hardware acceleration enabled.';
  document.body.appendChild(message);
}

// Production builds keep the model files in the browser's cache between visits (public/model-cache.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register(`./model-cache.js?v=${encodeURIComponent(__APP_VERSION__)}`).catch(() => {});
}

if (gallery) {
  canvas.hidden = true;
  import('./ui/gallery/Gallery')
    .then(({ mountGallery }) => mountGallery(document.body))
    .catch((error) => console.error(error));
} else if (multiplayer) {
  // Multiplayer: the shared classroom, loaded only when asked for.
  import('./mp/MultiplayerGame')
    .then(({ MultiplayerGame }) => MultiplayerGame.create(canvas, hudRoot))
    .then((game) => {
      (window as unknown as { paperwars: unknown }).paperwars = game;
    })
    .catch(bootError);
} else {
  Game.create(canvas, hudRoot)
    .then((game) => {
      // Handle for tuning and debugging from the browser console, e.g. `paperwars.state`.
      (window as unknown as { paperwars: Game }).paperwars = game;
    })
    .catch(bootError);
}
