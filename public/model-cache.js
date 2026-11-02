/*
 * paperwars.io model cache (v0.0.11). A service worker that keeps the game's 3D model files
 * (.glb, .gltf, .bin, .ktx2) in the browser's Cache Storage, so a returning player loads them from
 * disk instead of the network, whatever cache headers the host sends.
 *
 * The built files have content hashes in their names, so a cached file never goes stale: a new
 * model gets a new name. Each game version gets its own cache (the version comes in on the
 * script's URL); caches of older versions are deleted when this one takes over.
 *
 * Only model files are handled; everything else goes to the network as usual. Registered only by
 * production builds (src/main.ts).
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `paperwars-models-${VERSION}`;
const MODEL = /\.(glb|gltf|bin|ktx2)$/i;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('paperwars-models-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !MODEL.test(new URL(request.url).pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') cache.put(request, response.clone()).catch(() => {});
      return response;
    }),
  );
});
