import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backup, backupKey, expired, restore } from './backup';
import { Database } from './Database';
import { migrate } from './migrate';
import { bucketFromEnv, listObjects, sign } from './r2';
import { TEST_DATABASE_URL } from './testdb';

/**
 * Backups (v0.0.14): names, what is kept, the request signing R2 checks, and (with a test database
 * and the PostgreSQL tools) a whole backup to a bucket and restore into a fresh database.
 */

describe('backup names and retention', () => {
  it('names a backup after the time it was taken, sortably', () => {
    expect(backupKey(new Date('2026-11-05T03:00:07.123Z'), 'paperwars/')).toBe('paperwars/2026-11-05T03-00-07Z.dump');
  });

  it('deletes copies older than the retention, never the newest', () => {
    const now = new Date('2026-11-30T03:00:00Z');
    const day = (d: number) => ({ key: `k${d}`, lastModified: new Date(now.getTime() - d * 86_400_000) });
    const all = [day(0), day(1), day(13), day(15), day(30)];
    expect(expired(all, 14, now).map((o) => o.key)).toEqual(['k15', 'k30']);
    // Only old copies (the job stopped for a while): the newest stays.
    expect(expired([day(20), day(40)], 14, now).map((o) => o.key)).toEqual(['k40']);
  });
});

describe('R2 settings and signing', () => {
  it('reads the bucket, taking the bucket off an endpoint copied with it', () => {
    const b = bucketFromEnv({ R2_ENDPOINT: 'https://abc.r2.cloudflarestorage.com/paperwars-backups/', R2_BUCKET: 'paperwars-backups', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret' });
    expect(b).toMatchObject({ endpoint: 'https://abc.r2.cloudflarestorage.com', bucket: 'paperwars-backups', region: 'auto' });
    expect(bucketFromEnv({ R2_BUCKET: 'x' })).toBeNull();
  });

  it('signs as AWS Signature Version 4 does (checked against the AWS reference signer)', () => {
    const s = { endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'paperwars-backups', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'auto' };
    const req = sign(s, 'DELETE', 'dir/a b(1).dump', {}, '', new Date('2026-11-05T12:34:56Z'));
    expect(req.url).toBe('https://abc123.r2.cloudflarestorage.com/paperwars-backups/dir/a%20b%281%29.dump');
    expect(req.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261105/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=f3b1a6b2d12c3da3f650c2cf56ab522806ce4892caa20cc2b92a54e0f21bea2e',
    );
  });
});

/** A bucket in memory that speaks the four S3 requests the backups use. */
function fakeBucket(): Promise<{ server: Server; objects: Map<string, { body: Buffer; at: Date }>; endpoint: string }> {
  const objects = new Map<string, { body: Buffer; at: Date }>();
  const server = createServer((req, res) => {
    if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) {
      res.writeHead(403).end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://x');
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT') objects.set(key, { body: Buffer.concat(chunks), at: new Date() });
      else if (req.method === 'DELETE') objects.delete(key);
      else if (req.method === 'GET' && key) {
        const o = objects.get(key);
        if (!o) return void res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
        return void res.writeHead(200).end(o.body);
      } else if (req.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const items = [...objects].filter(([k]) => k.startsWith(prefix)).map(([k, o]) => `<Contents><Key>${k}</Key><Size>${o.body.length}</Size><LastModified>${o.at.toISOString()}</LastModified></Contents>`);
        return void res.writeHead(200).end(`<ListBucketResult><IsTruncated>false</IsTruncated>${items.join('')}</ListBucketResult>`);
      }
      res.writeHead(200).end();
    });
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, objects, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

const hasTools = (() => {
  try {
    execFileSync('pg_dump', ['--version']);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!TEST_DATABASE_URL || !hasTools)('a backup and a restore drill (needs TEST_DATABASE_URL and pg_dump)', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const names = [`drill_src_${suffix}`, `drill_dst_${suffix}`];
  const urlOf = (name: string) => {
    const u = new URL(TEST_DATABASE_URL!);
    u.pathname = `/${name}`;
    return u.toString();
  };
  let bucket: Awaited<ReturnType<typeof fakeBucket>>;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL! });
    await admin.connect();
    for (const n of names) await admin.query(`create database ${n}`);
    await admin.end();
    bucket = await fakeBucket();
    Object.assign(process.env, { R2_ENDPOINT: bucket.endpoint, R2_BUCKET: 'paperwars-backups', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret' });
  });

  afterAll(async () => {
    bucket?.server.close();
    for (const k of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'DATABASE_URL']) delete process.env[k];
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL! });
    await admin.connect();
    for (const n of names) await admin.query(`drop database if exists ${n} with (force)`);
    await admin.end();
  });

  it('backs a database up to the bucket and restores it, intact, into a fresh one', async () => {
    const src = new Database(urlOf(names[0]));
    await migrate(src, undefined, () => undefined);
    await src.query(`insert into players (id, public_id, display_name) values (gen_random_uuid(), 'pub12345', 'Ann')`);
    await src.close();

    process.env.DATABASE_URL = urlOf(names[0]);
    await backup([]);
    const stored = await listObjects(bucketFromEnv()!, 'paperwars/');
    expect(stored).toHaveLength(1);
    expect(stored[0].key).toMatch(/^paperwars\/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.dump$/);

    process.env.DATABASE_URL = urlOf(names[1]);
    await restore(['latest', '--yes']);
    const dst = new Database(urlOf(names[1]));
    const { rows } = await dst.query(`select display_name as name from players where public_id = 'pub12345'`);
    await dst.close();
    expect(rows).toEqual([{ name: 'Ann' }]);
  });
});
