import { cleanPrefs, rankFor } from '../src/ranks/Ranks';
import { createEndpoint, createRouter, matchMaker } from '@colyseus/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { log } from './log';
import { RateLimit } from './RateLimit';
import { services } from './services';
import { sessions } from './sessions/directory';
import { PgStore } from './store/PgStore';
import { timeLeft } from './sessions/rules';
import type { WorldRoom } from './WorldRoom';

/**
 * The minimal admin endpoint (v0.0.14): what the command line can't do on a running server. Every
 * request needs ADMIN_KEY (`Authorization: Bearer <key>`); without ADMIN_KEY set the endpoint
 * doesn't exist. Every action is logged (`admin.*`). The full dashboard is v0.0.27.
 *
 *   GET  /admin/sessions                                   sessions, their players (with ping) and held desks
 *   POST /admin/kick  {"player", "reason"?, "minutes"?}     remove a player now (public id or name);
 *                                                          they can't join again for `minutes` (default 10)
 *   POST /admin/end   {"session", "seconds"?, "reason"?}    end a session `seconds` from now (default 60), with notice
 *   POST /admin/desk  {"session", "desk"}                  free a desk stuck in the wrong state
 *   GET  /admin/merit?player=<public id or name>           a player's Merit, rank and latest awards (v0.0.17)
 *   GET  /admin/reports[?days=7]                           player reports and anti-farming flags (v0.0.19)
 *   GET  /admin/director[?session=<id>]                    each session's recent director decisions, open
 *                                                          bounties, alliances and situations (v0.0.19)
 *   GET  /admin/stats[?reset=1]                            server step and tick timing per session,
 *                                                          database writes, memory (the load test reads it);
 *                                                          reset=1 starts the maxima over
 *
 * From the developer's computer, `npm run admin -- live …` calls these (server/admin.ts).
 */

/** Failed keys per address: a handful, then one a minute. */
const failures = new RateLimit(1 / 60, 5);

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

function room(id: string): WorldRoom | null {
  return (matchMaker.getLocalRoomById(id) as unknown as WorldRoom | undefined) ?? null;
}

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

type Ctx = { headers?: Headers; body?: unknown; query?: Record<string, unknown>; json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => unknown };

export function adminRoutes(adminKey: string | null) {
  const expected = adminKey ? digest(adminKey) : null;
  const NO_STORE = { 'Cache-Control': 'no-store' };

  /** The caller's key checked (in constant time); returns a refusal to send, or null when it's fine. */
  function refuse(ctx: Ctx, action: string): unknown | null {
    const ip = ctx.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() || 'direct';
    if (!expected) return ctx.json({ error: 'Not found' }, { status: 404 });
    const header = ctx.headers?.get('authorization') ?? '';
    const given = header.replace(/^Bearer\s+/i, '').trim() || ctx.headers?.get('x-admin-key')?.trim() || '';
    if (given.length > 0 && timingSafeEqual(digest(given), expected)) return null;
    if (!failures.take(ip)) return ctx.json({ error: 'Too many attempts. Wait a minute.' }, { status: 429, headers: NO_STORE });
    log('warn', 'admin.refused', { ip, action });
    return ctx.json({ error: 'The admin key is missing or wrong.' }, { status: 401, headers: NO_STORE });
  }

  /** The request's fields: the JSON body, or the query string (handy with curl). */
  function input(ctx: Ctx): Record<string, unknown> {
    const body = ctx.body && typeof ctx.body === 'object' ? (ctx.body as Record<string, unknown>) : {};
    return { ...(ctx.query ?? {}), ...body };
  }

  /** The session and room a player (public id, name or username) is in right now. */
  function findPlayer(query: string): { room: WorldRoom; id: string } | null {
    const q = query.toLowerCase();
    for (const s of sessions()) {
      const r = room(s.id);
      const p = r?.adminPlayers().find((x) => x.id === query || x.account === query || x.name.toLowerCase() === q || x.username?.toLowerCase() === q);
      if (r && p) return { room: r, id: p.id };
    }
    return null;
  }

  return createRouter({
    adminSessions: createEndpoint('/admin/sessions', { method: 'GET' }, async (ctx) => {
      const no = refuse(ctx as unknown as Ctx, 'sessions');
      if (no) return no as Response;
      const now = Date.now();
      const out = sessions(now).map((s) => {
        const r = room(s.id);
        return { id: s.id, title: s.title, status: s.status, players: s.players, capacity: s.capacity, left: Math.round(timeLeft(s, now)), people: r?.adminPlayers() ?? [], held: r?.adminHeld() ?? [] };
      });
      log('info', 'admin.sessions', { sessions: out.length });
      return ctx.json({ sessions: out }, { headers: NO_STORE });
    }),
    adminStats: createEndpoint('/admin/stats', { method: 'GET' }, async (ctx) => {
      const no = refuse(ctx as unknown as Ctx, 'stats');
      if (no) return no as Response;
      const reset = String(input(ctx as unknown as Ctx).reset ?? '') === '1';
      const store = services().store;
      const db = store instanceof PgStore ? store.db.writes : null;
      const rooms = sessions().map((s) => {
        const r = room(s.id);
        const out = r ? { id: s.id, players: s.players, steps: r.world.perf.steps, stepMs: r.world.perf.totalMs, stepMaxMs: r.world.perf.maxMs, ticks: r.ticks.count, tickGapS: r.ticks.totalGap, tickGapMaxS: r.ticks.maxGap } : { id: s.id, players: s.players };
        if (r && reset) {
          r.world.perf.maxMs = 0;
          r.ticks.maxGap = 0;
        }
        return out;
      });
      const db0 = db ? { ...db } : null;
      if (db && reset) db.maxMs = 0;
      const m = process.memoryUsage();
      return ctx.json({ at: Date.now(), uptime: Math.round(process.uptime()), memory: { rssMB: Math.round(m.rss / 1e6), heapMB: Math.round(m.heapUsed / 1e6) }, store: store.kind, writes: db0, sessions: rooms }, { headers: NO_STORE });
    }),
    adminReports: createEndpoint('/admin/reports', { method: 'GET' }, async (ctx) => {
      const no = refuse(ctx as unknown as Ctx, 'reports');
      if (no) return no as Response;
      const days = Math.max(1, Math.min(90, num(input(ctx as unknown as Ctx).days) ?? 7));
      const since = new Date(Date.now() - days * 86_400_000);
      const store = services().store;
      const [reports, flags] = await Promise.all([store.reports(since), store.farmFlags(since)]);
      log('info', 'admin.reports', { reports: reports.length, flags: flags.length, days });
      return ctx.json({
        days,
        reports: reports.map((r) => ({ at: r.createdAt, reporter: r.reporterName, reported: r.reportedName, reason: r.reason, session: r.session, context: r.context })),
        farming: flags.map((f) => ({ at: f.createdAt, a: f.aName, b: f.bName, reason: f.reason, data: f.data })),
      }, { headers: NO_STORE });
    }),
    adminDirector: createEndpoint('/admin/director', { method: 'GET' }, async (ctx) => {
      const no = refuse(ctx as unknown as Ctx, 'director');
      if (no) return no as Response;
      const only = str(input(ctx as unknown as Ctx).session, 64);
      const out = sessions().filter((s) => !only || s.id === only).map((s) => {
        const r = room(s.id);
        const w = r?.world;
        return {
          id: s.id, title: s.title,
          decisions: w?.directorLog.entries ?? [],
          bounties: w?.bounties.open.map((b) => ({ kind: b.kind, target: b.targetName, pot: b.pot, left: Math.round(b.expires - w.time), reason: b.reason })) ?? [],
          alliances: w?.alliances.alliances.map((a) => a.members.map((m) => w.pilots.get(m)?.name ?? m)) ?? [],
          situations: w ? [...w.situations.values()].map((x) => ({ name: x.name, tier: x.tier, strength: x.strength, relative: x.relative, threat: x.threat, raids: x.raids, weakKills: x.weakKills })) : [],
        };
      });
      log('info', 'admin.director', { sessions: out.length });
      return ctx.json({ sessions: out }, { headers: NO_STORE });
    }),
    adminMerit: createEndpoint('/admin/merit', { method: 'GET' }, async (ctx) => {
      const no = refuse(ctx as unknown as Ctx, 'merit');
      if (no) return no as Response;
      const who = str(input(ctx as unknown as Ctx).player, 64);
      if (!who) return ctx.json({ error: 'Which player? Ask /admin/merit?player=<public id or name>.' }, { status: 400, headers: NO_STORE });
      const store = services().store;
      const found = (await store.findPlayers(who))[0];
      if (!found) return ctx.json({ error: `No player called "${who}".` }, { status: 404, headers: NO_STORE });
      const [merit, history, prefs] = await Promise.all([store.merit(found.id), store.meritHistory(found.id, 50), store.rankPrefs(found.id)]);
      const step = rankFor(merit, cleanPrefs(prefs, rankFor(0)).peak);
      log('info', 'admin.merit', { player: found.publicId });
      return ctx.json({ player: found.publicId, name: found.username ?? found.name, merit, rank: step.label, history: history.map((h) => ({ key: h.key, source: h.source, amount: h.amount, reason: h.reason, at: h.createdAt })) }, { headers: NO_STORE });
    }),
    adminKick: createEndpoint('/admin/kick', { method: 'POST' }, async (ctx) => {
      const no = refuse(ctx as unknown as Ctx, 'kick');
      if (no) return no as Response;
      const f = input(ctx as unknown as Ctx);
      const who = str(f.player, 64);
      if (!who) return ctx.json({ error: 'Which player? Send {"player": "<public id or name>"}.' }, { status: 400, headers: NO_STORE });
      const found = findPlayer(who);
      if (!found) return ctx.json({ error: `Nobody called "${who}" is in a session right now.` }, { status: 404, headers: NO_STORE });
      const minutes = Math.max(0, Math.min(24 * 60, num(f.minutes) ?? 10));
      found.room.kick(found.id, str(f.reason) ?? 'Removed by the developer', minutes);
      return ctx.json({ ok: true, session: found.room.roomId, player: found.id, minutes }, { headers: NO_STORE });
    }),
    adminEnd: createEndpoint('/admin/end', { method: 'POST' }, async (ctx) => {
      const no = refuse(ctx as unknown as Ctx, 'end');
      if (no) return no as Response;
      const f = input(ctx as unknown as Ctx);
      const id = str(f.session, 64);
      const r = id ? room(id) : null;
      if (!r) return ctx.json({ error: 'Which session? Send {"session": "<id from /admin/sessions>"}.' }, { status: 404, headers: NO_STORE });
      const seconds = Math.max(0, Math.min(3600, num(f.seconds) ?? 60));
      const result = r.endWithNotice(seconds, str(f.reason, 80) ?? 'Ended by the developer');
      return ctx.json({ ok: true, session: id, ...result }, { headers: NO_STORE });
    }),
    adminDesk: createEndpoint('/admin/desk', { method: 'POST' }, async (ctx) => {
      const no = refuse(ctx as unknown as Ctx, 'desk');
      if (no) return no as Response;
      const f = input(ctx as unknown as Ctx);
      const id = str(f.session, 64);
      const desk = str(f.desk, 16);
      const r = id ? room(id) : null;
      if (!r || !desk) return ctx.json({ error: 'Send {"session": "<id>", "desk": "<desk id, e.g. T14>"}.' }, { status: 400, headers: NO_STORE });
      return ctx.json({ ok: true, session: id, desk, ...r.freeDesk(desk) }, { headers: NO_STORE });
    }),
  });
}
