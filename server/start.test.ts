import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * The server starts as Railway starts it (v0.0.14): plain Node with tsx, not through Vite. The
 * other tests run under Vite, which provides things Node doesn't (`import.meta.glob`,
 * `import.meta.env`), so code the server imports from src/ can work in every test and still crash
 * the deployed server. This one starts the real process and asks it for /health.
 */
describe('the server process', () => {
  it('starts under plain Node and answers /health', async () => {
    const port = 2611;
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development', DATABASE_URL: '', LOG_FORMAT: 'json' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    try {
      let body: Record<string, unknown> | null = null;
      for (let i = 0; i < 100 && !body && child.exitCode === null; i++) {
        await new Promise((r) => setTimeout(r, 200));
        body = await fetch(`http://localhost:${port}/health`)
          .then((r) => r.json() as Promise<Record<string, unknown>>)
          .catch(() => null);
      }
      expect(body, `the server did not answer; its output:\n${output}`).toMatchObject({ status: 'ok' });
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);
});
