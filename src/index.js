/**
 * dsh-unarchive — host half.
 *
 * Original implementation written against the public DSH service surface
 * (`workspaceRegistry`, `sessionQuery`, `webServer`). No DSH source code is
 * copied; the restore path simply mirrors the *contract* of the native
 * `archiveSession` (idempotent, existence-checked, serialized) in reverse.
 *
 * HTTP API (same origin, prefix /dsh-unarchive/api):
 *   GET  /api/archived                     -> { total, items }
 *   GET  /api/archived/:id/preview         -> preview payload
 *   POST /api/restore      { sessionId }   -> { ok } | { ok:false, error, message }
 *   POST /api/restore-all  { ids? }        -> { restored, failed }
 *   POST /api/title        { sessionId }   -> { title }
 *   GET  /api/settings                     -> { confirmOnArchive, showButton, previewEnabled }
 *   POST /api/settings     { ...patch }    -> merged settings (persisted)
 */
import Schema from '@deepseek-ai/schemastery';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'dsh-unarchive';

/** Official config convention: exported schema, defaults inside the schema. */
export const Config = Schema.object({
  /** Ask for confirmation before archiving (off by default: native behavior). */
  confirmOnArchive: Schema.boolean().default(false),
  /** Show the sidebar entry button. */
  showButton: Schema.boolean().default(true),
  /** Enable inline content preview. */
  previewEnabled: Schema.boolean().default(true),
});

export const inject = ['timer'];

const SETTINGS_DIR = join(homedir(), '.dsh', 'unarchive');
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json');

/** Settings precedence: cordis.yml config is the install-time default; the
 * settings file (written by the panel) wins when present. */
async function loadSettings(defaults) {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      confirmOnArchive: typeof parsed.confirmOnArchive === 'boolean' ? parsed.confirmOnArchive : defaults.confirmOnArchive,
      showButton: typeof parsed.showButton === 'boolean' ? parsed.showButton : defaults.showButton,
      previewEnabled: typeof parsed.previewEnabled === 'boolean' ? parsed.previewEnabled : defaults.previewEnabled,
    };
  } catch {
    return { ...defaults };
  }
}

async function saveSettings(settings) {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Shared core (identical to the verified dynamic prototype)
// ---------------------------------------------------------------------------

const isTextBlock = (b) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string';
const textOf = (content) => (Array.isArray(content) ? content.filter(isTextBlock).map((b) => b.text).join('\n') : '');
const msgText = (ev) => {
  const d = ev && ev.data;
  return d && typeof d === 'object' ? textOf(d.content) : '';
};
const truncate = (s, n) => (s.length <= n ? s : s.slice(0, n) + '…');
const cap = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n) : []);

const PREVIEW_CAP = 128;
const PREVIEW_TTL = 5 * 60 * 1000;
function makePreviewCache() {
  const cache = new Map();
  return {
    get(key) {
      const entry = cache.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.at > PREVIEW_TTL) { cache.delete(key); return undefined; }
      cache.delete(key); cache.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      cache.delete(key);
      if (cache.size >= PREVIEW_CAP) cache.delete(cache.keys().next().value);
      cache.set(key, { value, at: Date.now() });
    },
  };
}

function makeUnarchive(getRegistry) {
  return async (sessionId) => {
    const registry = getRegistry();
    if (!registry || typeof registry.enqueueOperation !== 'function'
      || typeof registry.requireState !== 'function' || typeof registry.setState !== 'function') {
      return { ok: false, error: 'unavailable', message: 'workspace registry does not expose the unarchive surface' };
    }
    try {
      await registry.enqueueOperation(async () => {
        const first = registry.requireState();
        const ids = first.archivedSessionIds;
        if (!Array.isArray(ids) || !ids.includes(sessionId)) return; // idempotent
        if (typeof registry.sessionKnown === 'function' && !(await registry.sessionKnown(sessionId))) {
          throw new Error('session-not-found: ' + sessionId);
        }
        const current = registry.requireState();
        const nextIds = current.archivedSessionIds.filter((x) => x !== sessionId);
        await registry.setState({ ...current, archivedSessionIds: nextIds });
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'failed', message: String((e && e.message) || e) };
    }
  };
}

function makeLister(getRegistry, getQuery) {
  return async (rawIds) => {
    const registry = getRegistry();
    const query = getQuery();
    const ids = cap(rawIds, 500);
    const empty = { total: 0, items: [] };
    if (!query || !registry) return { ...empty, unavailable: true };
    const headers = new Map();
    try {
      const records = await query.listSessions();
      if (Array.isArray(records)) {
        for (const r of records) {
          const h = r && r.header;
          if (h && h.id !== undefined) headers.set(String(h.id), h);
        }
      }
    } catch (e) { console.error('[dsh-unarchive] listSessions failed', e); }
    const titles = new Map();
    try {
      const obs = await query.readTitleSnapshots(ids);
      if (Array.isArray(obs)) {
        for (const o of obs) {
          if (o && o.status === 'fulfilled' && o.value && o.value.title && typeof o.value.title.title === 'string') {
            titles.set(String(o.sessionId), o.value.title.title);
          }
        }
      }
    } catch (e) { console.error('[dsh-unarchive] readTitleSnapshots failed', e); }
    const wsBySession = new Map();
    try {
      for (const ws of registry.list()) {
        const members = ws && ws.sessionIds;
        if (!Array.isArray(members)) continue;
        const meta = { workspaceTitle: ws.title ?? null, workspacePath: ws.path ?? null };
        for (const m of members) {
          const k = String(m);
          if (!wsBySession.has(k)) wsBySession.set(k, meta);
        }
      }
    } catch (e) { console.error('[dsh-unarchive] workspace membership failed', e); }
    const items = [];
    for (const id of ids) {
      const h = headers.get(id);
      if (!h) continue;
      if (h.origin === 'subagent') continue;
      const ws = wsBySession.get(id);
      items.push({
        sessionId: id,
        title: titles.get(id) ?? null,
        workspaceTitle: ws ? ws.workspaceTitle : null,
        workspacePath: ws ? ws.workspacePath : null,
        createdAt: typeof h.createdAt === 'number' ? h.createdAt : null,
      });
    }
    items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return { total: items.length, items };
  };
}

const previewError = (category, message) => ({ category, message: String(message || '') });
const categorize = (e) => {
  const m = String((e && e.message) || e);
  if (/no such|not found|absent|missing|holds no such/i.test(m)) return 'missing';
  if (/corrupt|invalid|torn|malformed/i.test(m)) return 'corrupt';
  return 'unreadable';
};

function makePreviewer(getQuery, timer, cache) {
  const buildPreview = async (query, sessionId) => {
    const surface = await query.readSurface(sessionId);
    const events = Array.isArray(surface && surface.events) ? surface.events : [];
    const head = [];
    const tail = [];
    let userCount = 0, assistantCount = 0, toolResultCount = 0, toolCallBlocks = 0;
    let lastActivityAt = null, anyTruncated = false;
    for (const ev of events) {
      const t = typeof ev.time === 'number' ? ev.time : null;
      if (t !== null && (lastActivityAt === null || t > lastActivityAt)) lastActivityAt = t;
      const type = ev && ev.type;
      const d = ev && ev.data;
      const content = d && typeof d === 'object' ? d.content : undefined;
      if (type === 'user/message') {
        userCount += 1;
        const raw = msgText(ev);
        if (raw) {
          const text = truncate(raw, 200);
          if (text.length < raw.length) anyTruncated = true;
          if (head.length === 0) head.push({ role: 'user', text, at: t });
          tail.push({ role: 'user', text, at: t });
        }
      } else if (type === 'assistant/message') {
        assistantCount += 1;
        if (Array.isArray(content)) for (const b of content) if (b && b.type === 'tool-call') toolCallBlocks += 1;
        const raw = msgText(ev);
        if (raw) {
          const text = truncate(raw, 200);
          if (text.length < raw.length) anyTruncated = true;
          tail.push({ role: 'assistant', text, at: t });
        }
      } else if (type === 'tool/result') {
        toolResultCount += 1;
        if (Array.isArray(content)) for (const b of content) if (b && b.type === 'tool-call') toolCallBlocks += 1;
      }
    }
    const lastTwo = tail.slice(-2);
    let omittedMessages = 0;
    if (head.length > 0 && lastTwo.length > 0) {
      const headKey = head[0].text;
      const inTail = lastTwo.some((m) => m.text === headKey);
      if (!inTail) omittedMessages = Math.max(0, tail.length - 1 - lastTwo.length);
    }
    return {
      sessionId,
      stats: {
        userMessages: userCount,
        assistantMessages: assistantCount,
        toolCalls: Math.max(toolCallBlocks, toolResultCount),
        lastActivityAt,
      },
      head,
      tail: lastTwo,
      omittedMessages,
      truncated: anyTruncated || omittedMessages > 0,
      empty: userCount === 0,
      error: null,
    };
  };
  return async (sessionId) => {
    const query = getQuery();
    if (!query || typeof query.readSurface !== 'function') {
      return { sessionId, error: previewError('unavailable', 'session query service unavailable') };
    }
    const cached = cache.get(sessionId);
    if (cached) return cached;
    try {
      const result = await Promise.race([
        buildPreview(query, sessionId).then((v) => ({ v })),
        timer.timeout(4000).then(() => null),
      ]);
      if (result === null) {
        const partial = { sessionId, error: previewError('timeout', 'preview timed out'), truncated: true };
        cache.set(sessionId, partial);
        return partial;
      }
      cache.set(sessionId, result.v);
      return result.v;
    } catch (e) {
      return { sessionId, error: previewError(categorize(e), (e && e.message) || e), truncated: false };
    }
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing (node:http style, per the webServer route contract)
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function registerRoutes(ctx, deps) {
  const { registry, query, listArchived, previewOne, unarchiveOne, sessionTitle, getSettings, setSettings } = deps;

  // GET /dsh-unarchive/api/archived
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-unarchive/api/archived',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        const reg = registry();
        let ids = [];
        try { ids = reg && Array.isArray(reg.archivedSessionIds) ? [...reg.archivedSessionIds] : []; } catch { /* ignore */ }
        sendJson(res, 200, await listArchived(ids));
      } catch (e) {
        sendJson(res, 500, { total: 0, items: [], error: String((e && e.message) || e) });
      }
    },
  });
  // GET /dsh-unarchive/api/archived/<id>/preview
  ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-unarchive/api/archived/',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' });
      const rest = decodeURIComponent((req.url || '').slice('/dsh-unarchive/api/archived/'.length));
      const match = /^([^/]+)\/preview$/.exec(rest);
      if (!match) return sendJson(res, 404, { error: 'not-found' });
      try {
        sendJson(res, 200, await previewOne(match[1]));
      } catch (e) {
        sendJson(res, 500, { sessionId: match[1], error: previewError('unreadable', String((e && e.message) || e)) });
      }
    },
  });
  // POST /dsh-unarchive/api/restore
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-unarchive/api/restore',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        const body = await readJsonBody(req);
        if (typeof body.sessionId !== 'string') return sendJson(res, 400, { ok: false, error: 'bad-request', message: 'sessionId required' });
        sendJson(res, 200, await unarchiveOne(body.sessionId));
      } catch (e) {
        sendJson(res, 500, { ok: false, error: 'failed', message: String((e && e.message) || e) });
      }
    },
  });
  // POST /dsh-unarchive/api/restore-all
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-unarchive/api/restore-all',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        const body = await readJsonBody(req);
        const ids = cap(body.ids, 500);
        const failed = [];
        let restored = 0;
        for (const id of ids) {
          const r = await unarchiveOne(id);
          if (r.ok) restored += 1;
          else failed.push({ sessionId: id, error: r.error, message: r.message });
        }
        sendJson(res, 200, { restored, failed });
      } catch (e) {
        sendJson(res, 500, { restored: 0, failed: [], error: String((e && e.message) || e) });
      }
    },
  });
  // POST /dsh-unarchive/api/title
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-unarchive/api/title',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        const body = await readJsonBody(req);
        if (typeof body.sessionId !== 'string') return sendJson(res, 400, { title: null });
        sendJson(res, 200, await sessionTitle(body.sessionId));
      } catch (e) {
        sendJson(res, 500, { title: null, error: String((e && e.message) || e) });
      }
    },
  });
  // GET/POST /dsh-unarchive/api/settings
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-unarchive/api/settings',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        return sendJson(res, 200, { ...getSettings() });
      }
      if (req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const next = {
            confirmOnArchive: typeof body.confirmOnArchive === 'boolean' ? body.confirmOnArchive : getSettings().confirmOnArchive,
            showButton: typeof body.showButton === 'boolean' ? body.showButton : getSettings().showButton,
            previewEnabled: typeof body.previewEnabled === 'boolean' ? body.previewEnabled : getSettings().previewEnabled,
          };
          setSettings(next);
          await saveSettings(next).catch((e) => console.error('[dsh-unarchive] settings persist failed', e));
          return sendJson(res, 200, { ...next });
        } catch (e) {
          return sendJson(res, 500, { error: String((e && e.message) || e) });
        }
      }
      return sendJson(res, 405, { error: 'method-not-allowed' });
    },
  });
}

// ---------------------------------------------------------------------------
// Plugin (function form, matching the deployment's bundle convention)
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const warn = (...a) => console.error('[dsh-unarchive]', ...a);
  // Services are read lazily (per call) because the Loader mounts entries
  // concurrently: `ctx.get()` at apply time may still be undefined. Fail-open:
  // each surface degrades until (and unless) the service is provided.
  const registryOf = () => ctx.get('workspaceRegistry');
  const queryOf = () => ctx.get('sessionQuery');
  const timer = ctx.get('timer');

  const defaults = {
    confirmOnArchive: !!(config && config.confirmOnArchive),
    showButton: config && typeof config.showButton === 'boolean' ? config.showButton : true,
    previewEnabled: config && typeof config.previewEnabled === 'boolean' ? config.previewEnabled : true,
  };
  let settings = { ...defaults };
  loadSettings(defaults).then((loaded) => { settings = loaded; }).catch(() => {});

  const cache = makePreviewCache();
  const unarchiveOne = makeUnarchive(registryOf);
  const listArchived = makeLister(registryOf, queryOf);
  const previewOne = makePreviewer(queryOf, timer, cache);

  const sessionTitle = async (sessionId) => {
    const q = queryOf();
    if (!q || typeof q.readTitleSnapshots !== 'function') return { title: null };
    try {
      const obs = await q.readTitleSnapshots([sessionId]);
      const o = Array.isArray(obs) ? obs[0] : undefined;
      if (o && o.status === 'fulfilled' && o.value && o.value.title && typeof o.value.title.title === 'string') {
        return { title: o.value.title.title };
      }
      return { title: null };
    } catch (e) {
      return { title: null, error: String((e && e.message) || e) };
    }
  };

  const getSettings = () => settings;
  const setSettings = (next) => { settings = next; };

  // Mount HTTP routes once the web server is ready (airbag-proven pattern).
  ctx.inject(['webServer'], (sub) => {
    registerRoutes(sub, { registry: registryOf, query: queryOf, listArchived, previewOne, unarchiveOne, sessionTitle, getSettings, setSettings });
    console.log('[dsh-unarchive] host routes mounted');
  });

  console.log('[dsh-unarchive] host ready (restore=' + String(!!registryOf()) + ', query=' + String(!!queryOf()) + ')');
}
