import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { log } from '../log';
import { redactUrl } from './Database';
import { bucketFromEnv, deleteObject, getObject, listObjects, putObject, type BucketSettings } from './r2';

/**
 * Backups (v0.0.14). A scheduled job on Railway runs `npm run db:backup` once a day: pg_dump of the
 * database, checked readable, uploaded to a Cloudflare R2 bucket, and copies older than
 * BACKUP_KEEP_DAYS (default 14) deleted. `npm run db:restore` brings one back.
 *
 *   npm run db:backup                         dump DATABASE_URL to R2, then prune old copies
 *   npm run db:backup -- --out backups/       dump to a local folder instead (no R2 needed)
 *   npm run db:backup -- --list               the backups in R2, newest last
 *
 *   npm run db:restore -- latest              the newest backup in R2, into DATABASE_URL
 *   npm run db:restore -- <key in R2>         a given one (as --list shows it)
 *   npm run db:restore -- ./file.dump         a local file
 *   … -- --yes                                no confirmation prompt (scripts, the drill)
 *
 * Restoring replaces every table in DATABASE_URL with the backup's. It asks first, and names the
 * database it is about to overwrite. The server migrates a restored database to its own schema
 * when it starts, so an older backup works with a newer server.
 *
 * Settings: DATABASE_URL, R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (see
 * server/db/r2.ts), BACKUP_PREFIX (default "paperwars/"), BACKUP_KEEP_DAYS (default 14).
 */

const PREFIX = process.env.BACKUP_PREFIX?.trim() || 'paperwars/';
const KEEP_DAYS = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS ?? 14) || 14);

/** Runs a PostgreSQL tool; resolves with its standard output, rejects with its error output. */
function run(tool: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn(tool, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => fail(new Error(`${tool} could not be started (${e.message}). It comes with the PostgreSQL client tools.`)));
    child.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(`${tool} failed (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`))));
  });
}

/** A backup's name: the time it was taken, sortable. */
export function backupKey(now: Date = new Date(), prefix: string = PREFIX): string {
  return `${prefix}${now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')}.dump`;
}

/** The backups to delete: older than `keepDays`, never the newest one. */
export function expired<T extends { key: string; lastModified: Date }>(objects: T[], keepDays: number, now: Date = new Date()): T[] {
  const newest = objects.reduce<T | null>((a, b) => (!a || b.lastModified > a.lastModified ? b : a), null);
  const cutoff = now.getTime() - keepDays * 86_400_000;
  return objects.filter((o) => o !== newest && o.lastModified.getTime() < cutoff);
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set.');
  return url;
}

function bucket(): BucketSettings {
  const b = bucketFromEnv();
  if (!b) throw new Error('R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must all be set (or use --out <folder>).');
  return b;
}

/** pg_dump into `file` (custom format: compressed, restorable table by table), then checked readable. */
async function dump(url: string, file: string): Promise<number> {
  await run('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-acl', '--file', file, '--dbname', url]);
  const tables = (await run('pg_restore', ['--list', file])).split('\n').filter((l) => / TABLE DATA /.test(l)).length;
  if (tables === 0) throw new Error('the dump has no tables in it: is DATABASE_URL the game\'s database?');
  return tables;
}

export async function backup(args: string[]): Promise<void> {
  const url = databaseUrl();
  const at = new Date();
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0) {
    const dir = resolve(args[outIndex + 1] ?? 'backups');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, `paperwars-${backupKey(at, '')}`);
    const tables = await dump(url, file);
    console.log(`Backed up ${redactUrl(url)} to ${file} (${tables} tables, ${kb(statSync(file).size)}).`);
    return;
  }
  const b = bucket();
  const dir = mkdtempSync(join(tmpdir(), 'paperwars-backup-'));
  try {
    const file = join(dir, 'backup.dump');
    const tables = await dump(url, file);
    const key = backupKey(at);
    const body = readFileSync(file);
    await putObject(b, key, body);
    log('info', 'backup.done', { key, bytes: body.length, tables, bucket: b.bucket });
    const old = expired(await listObjects(b, PREFIX), KEEP_DAYS, at);
    for (const o of old) await deleteObject(b, o.key);
    if (old.length > 0) log('info', 'backup.pruned', { deleted: old.map((o) => o.key), keepDays: KEEP_DAYS });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function list(): Promise<void> {
  const objects = await listObjects(bucket(), PREFIX);
  if (objects.length === 0) console.log('No backups yet.');
  for (const o of objects) console.log(`${o.key.padEnd(44)} ${kb(o.size).padStart(10)}  ${o.lastModified.toISOString()}`);
}

export async function restore(args: string[]): Promise<void> {
  const yes = args.includes('--yes');
  const which = args.find((a) => !a.startsWith('--'));
  if (!which) throw new Error('Which backup? npm run db:restore -- latest | <key from --list> | <file>');
  const url = databaseUrl();
  const dir = mkdtempSync(join(tmpdir(), 'paperwars-restore-'));
  try {
    let file: string;
    let name: string;
    if (existsSync(which)) {
      file = resolve(which);
      name = file;
    } else {
      const b = bucket();
      let key = which;
      if (which === 'latest') {
        const all = await listObjects(b, PREFIX);
        if (all.length === 0) throw new Error(`No backups in ${b.bucket}.`);
        key = all[all.length - 1].key;
      }
      file = join(dir, 'restore.dump');
      writeFileSync(file, await getObject(b, key));
      name = `${b.bucket}/${key}`;
    }
    const tables = (await run('pg_restore', ['--list', file])).split('\n').filter((l) => / TABLE DATA /.test(l)).length;
    const target = redactUrl(url);
    console.log(`Backup: ${name} (${tables} tables, ${kb(statSync(file).size)})`);
    console.log(`Into:   ${target}`);
    if (!yes) {
      const dbName = new URL(url).pathname.replace(/^\//, '') || 'the database';
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question(`\nEverything in "${dbName}" will be replaced by the backup. Type its name (${dbName}) to go ahead: `)).trim();
      rl.close();
      if (answer !== dbName) {
        console.log('Nothing was changed.');
        return;
      }
    }
    await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', '--dbname', url, file]);
    log('info', 'restore.done', { from: name, into: target, tables });
    console.log('Restored. Restart the game server so it reloads everything (it migrates the schema if the backup is older).');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} kB`;
}

const mode = process.argv[2];
const args = process.argv.slice(3);
if (mode === 'backup' || mode === 'restore') {
  try {
    if (mode === 'restore') await restore(args);
    else if (args.includes('--list')) await list();
    else await backup(args);
  } catch (error) {
    log('error', `${mode}.failed`, { error });
    process.exitCode = 1;
  }
}
