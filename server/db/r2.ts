import { createHash, createHmac } from 'node:crypto';

/**
 * Just enough of the S3 API for the backups (v0.0.14): put, get, list and delete objects in one
 * bucket on Cloudflare R2 (or any S3-compatible store), signed with AWS Signature Version 4. No SDK:
 * four requests don't need one.
 *
 *   R2_ENDPOINT           https://<account id>.r2.cloudflarestorage.com
 *   R2_BUCKET             paperwars-backups
 *   R2_ACCESS_KEY_ID      from R2's "Manage API tokens"
 *   R2_SECRET_ACCESS_KEY
 */

export interface BucketSettings {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** "auto" for R2. */
  region?: string;
}

export interface BucketObject {
  key: string;
  size: number;
  lastModified: Date;
}

/** The bucket from R2_* variables, or null when they aren't all set. */
export function bucketFromEnv(env: Record<string, string | undefined> = process.env): BucketSettings | null {
  const endpoint = env.R2_ENDPOINT?.trim().replace(/\/+$/, '');
  const bucket = env.R2_BUCKET?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  // The endpoint R2 shows sometimes ends with the bucket's name: that part belongs in R2_BUCKET.
  const base = endpoint.endsWith(`/${bucket}`) ? endpoint.slice(0, -bucket.length - 1) : endpoint;
  return { endpoint: base, bucket, accessKeyId, secretAccessKey, region: env.R2_REGION?.trim() || 'auto' };
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, as SigV4 wants it (slashes kept in paths). */
function encode(s: string, keepSlash = false): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(keepSlash ? /%2F/g : /$^/, '/');
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** Signs one request (exported for the test against the reference signer). */
export function sign(
  s: BucketSettings,
  method: string,
  key: string,
  query: Record<string, string>,
  body: Uint8Array | string,
  now: Date = new Date(),
): SignedRequest {
  const url = new URL(s.endpoint);
  const path = `${url.pathname.replace(/\/$/, '')}/${encode(s.bucket)}${key ? `/${encode(key, true)}` : ''}`;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const region = s.region ?? 'auto';
  const payload = sha256(body);
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k])}`)
    .join('&');
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const canonical = [method, path, canonicalQuery, names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payload].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${s.secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${s.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return { url: `${url.origin}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`, headers };
}

async function send(s: BucketSettings, method: string, key: string, query: Record<string, string> = {}, body: Uint8Array = new Uint8Array()): Promise<Response> {
  const req = sign(s, method, key, query, body);
  const { host: _host, ...headers } = req.headers;
  const response = await fetch(req.url, { method, headers, body: method === 'PUT' ? (body as Uint8Array<ArrayBuffer>) : undefined });
  if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
    const text = await response.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
    throw new Error(`${method} ${key || s.bucket}: ${response.status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`);
  }
  return response;
}

export async function putObject(s: BucketSettings, key: string, body: Uint8Array): Promise<void> {
  await send(s, 'PUT', key, {}, body);
}

export async function getObject(s: BucketSettings, key: string): Promise<Uint8Array> {
  return new Uint8Array(await (await send(s, 'GET', key)).arrayBuffer());
}

export async function deleteObject(s: BucketSettings, key: string): Promise<void> {
  await send(s, 'DELETE', key);
}

/** Every object whose key starts with `prefix`, oldest first. */
export async function listObjects(s: BucketSettings, prefix: string): Promise<BucketObject[]> {
  const out: BucketObject[] = [];
  let token: string | null = null;
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;
    const xml = await (await send(s, 'GET', '', query)).text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const field = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(m[1])?.[1] ?? '';
      out.push({ key: unescapeXml(field('Key')), size: Number(field('Size')), lastModified: new Date(field('LastModified')) });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null;
  } while (token);
  return out.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime() || a.key.localeCompare(b.key));
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
