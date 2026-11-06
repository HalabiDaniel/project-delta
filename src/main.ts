import { Game } from './Game';
import { applyTokens, systemTokenOptions } from './ui/tokens';
import { PSEUDO, setPseudo, T } from './ui/strings';

// The design tokens on :root before anything draws (src/ui/tokens.ts, docs/DESIGN_SYSTEM.md).
applyTokens(document.documentElement, systemTokenOptions());

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
// Multiplayer: ?mp, or an invite link (…/?invite=CODE) straight into the lobby.
const query = new URLSearchParams(window.location.search);
const multiplayer = query.has('mp') || query.has('invite');
// The design system gallery (?ui-gallery): every component in every state, no game.
const gallery = query.has('ui-gallery');

/**
 * Console hooks beside the game's own: `paperwars.pseudo()` turns pseudo-localisation on (the page
 * reloads with ?pseudo), `paperwars.pseudo(false)` off (docs/DESIGN_SYSTEM.md §11).
 */
function withDevHooks<G extends object>(game: G): G & { pseudo: (on?: boolean) => boolean } {
  return Object.assign(game, {
    pseudo: (on = true): boolean => {
      if (on !== PSEUDO) setPseudo(on);
      return on;
    },
  });
}

function bootError(error: unknown): void {
  console.error(error);
  const message = document.createElement('div');
  message.className = 'boot-error';
  message.textContent = T.boot.webgl;
  document.body.appendChild(message);
}

// Production builds keep the model files in the browser's cache between visits (public/model-cache.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register(`./model-cache.js?v=${encodeURIComponent(__APP_VERSION__)}`).catch(() => {});
}

if (gallery) {
  canvas.hidden = true;
  import('./ui/gallery/Gallery')
    .then(({ mountGallery }) => {
      mountGallery(document.body);
      (window as unknown as { paperwars: unknown }).paperwars = withDevHooks({});
    })
    .catch((error) => console.error(error));
} else if (multiplayer) {
  // Multiplayer: the shared classroom, loaded only when asked for.
  import('./mp/MultiplayerGame')
    .then(({ MultiplayerGame }) => MultiplayerGame.create(canvas, hudRoot))
    .then((game) => {
      (window as unknown as { paperwars: unknown }).paperwars = withDevHooks(game);
    })
    .catch(bootError);
} else {
  Game.create(canvas, hudRoot)
    .then((game) => {
      // Handle for tuning and debugging from the browser console, e.g. `paperwars.state`.
      (window as unknown as { paperwars: Game }).paperwars = withDevHooks(game);
    })
    .catch(bootError);
}
