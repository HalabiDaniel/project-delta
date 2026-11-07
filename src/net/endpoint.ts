/**
 * Where the multiplayer server is (shared by the multiplayer client and the main menu's
 * matchmaking, which must not load the multiplayer bundle):
 * ?server=wss://host:port in the address (testing), else the address the build was given
 * (VITE_SERVER_URL, set in Vercel: v0.0.14), else the page's host on port 2567 (development).
 */
export function serverEndpoint(): string {
  const given = new URLSearchParams(window.location.search).get('server');
  if (given) return given;
  const built = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
  if (built) return built.replace(/\/+$/, '');
  const secure = window.location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${window.location.hostname || 'localhost'}:2567`;
}

/** The HTTP side of the server, next to the WebSocket one. */
export function serverHttp(endpoint = serverEndpoint()): string {
  return endpoint.replace(/^ws/, 'http').replace(/\/$/, '');
}
