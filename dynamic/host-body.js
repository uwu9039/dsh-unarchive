return {
  inject: ['timer'],
  apply(ctx) {
    const timer = ctx.get('timer')
    const warn = (...a) => console.error('[dsh-unarchive]', ...a)
    // Services are read lazily (per call): the Loader mounts entries
    // concurrently, so ctx.get() at apply time may still be undefined.
    const registryOf = () => ctx.get('workspaceRegistry')
    const queryOf = () => ctx.get('sessionQuery')

    const isTextBlock = (b) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string'
    const textOf = (content) => (Array.isArray(content) ? content.filter(isTextBlock).map((b) => b.text).join('\n') : '')
    const msgText = (ev) => {
      const d = ev && ev.data
      return d && typeof d === 'object' ? textOf(d.content) : ''
    }
    const truncate = (s, n) => (s.length <= n ? s : s.slice(0, n) + '…')
    const cap = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n) : [])

    const PREVIEW_CAP = 128
    const PREVIEW_TTL = 5 * 60 * 1000
    const previewCache = new Map()
    const cacheGet = (key) => {
      const entry = previewCache.get(key)
      if (!entry) return undefined
      if (Date.now() - entry.at > PREVIEW_TTL) { previewCache.delete(key); return undefined }
      previewCache.delete(key); previewCache.set(key, entry)
      return entry.value
    }
    const cacheSet = (key, value) => {
      previewCache.delete(key)
      if (previewCache.size >= PREVIEW_CAP) previewCache.delete(previewCache.keys().next().value)
      previewCache.set(key, { value, at: Date.now() })
    }

    const unarchiveOne = async (sessionId) => {
      const registry = registryOf()
      if (!registry || typeof registry.enqueueOperation !== 'function' ||
          typeof registry.requireState !== 'function' || typeof registry.setState !== 'function') {
        return { ok: false, error: 'unavailable', message: 'workspace registry does not expose the unarchive surface' }
      }
      try {
        await registry.enqueueOperation(async () => {
          const first = registry.requireState()
          const ids = first.archivedSessionIds
          if (!Array.isArray(ids) || !ids.includes(sessionId)) return
          if (typeof registry.sessionKnown === 'function' && !(await registry.sessionKnown(sessionId))) {
            throw new Error('session-not-found: ' + sessionId)
          }
          const current = registry.requireState()
          const nextIds = current.archivedSessionIds.filter((x) => x !== sessionId)
          await registry.setState({ ...current, archivedSessionIds: nextIds })
        })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: 'failed', message: String((e && e.message) || e) }
      }
    }

    const listArchived = async (rawIds) => {
      const registry = registryOf()
      const query = queryOf()
      const ids = cap(rawIds, 500)
      const empty = { total: 0, items: [] }
      if (!query || !registry) return { ...empty, unavailable: true }
      const headers = new Map()
      try {
        const records = await query.listSessions()
        if (Array.isArray(records)) {
          for (const r of records) {
            const h = r && r.header
            if (h && h.id !== undefined) headers.set(String(h.id), h)
          }
        }
      } catch (e) { warn('listSessions failed', e) }
      const titles = new Map()
      try {
        const obs = await query.readTitleSnapshots(ids)
        if (Array.isArray(obs)) {
          for (const o of obs) {
            if (o && o.status === 'fulfilled' && o.value && o.value.title && typeof o.value.title.title === 'string') {
              titles.set(String(o.sessionId), o.value.title.title)
            }
          }
        }
      } catch (e) { warn('readTitleSnapshots failed', e) }
      const wsBySession = new Map()
      try {
        for (const ws of registry.list()) {
          const members = ws && ws.sessionIds
          if (!Array.isArray(members)) continue
          const meta = { workspaceTitle: ws.title ?? null, workspacePath: ws.path ?? null }
          for (const m of members) {
            const k = String(m)
            if (!wsBySession.has(k)) wsBySession.set(k, meta)
          }
        }
      } catch (e) { warn('workspace membership failed', e) }
      const items = []
      for (const id of ids) {
        const h = headers.get(id)
        if (!h) continue
        if (h.origin === 'subagent') continue
        const ws = wsBySession.get(id)
        items.push({
          sessionId: id,
          title: titles.get(id) ?? null,
          workspaceTitle: ws ? ws.workspaceTitle : null,
          workspacePath: ws ? ws.workspacePath : null,
          createdAt: typeof h.createdAt === 'number' ? h.createdAt : null,
        })
      }
      items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      return { total: items.length, items }
    }

    const previewError = (category, message) => ({ category, message: String(message || '') })
    const categorize = (e) => {
      const m = String((e && e.message) || e)
      if (/no such|not found|absent|missing|holds no such/i.test(m)) return 'missing'
      if (/corrupt|invalid|torn|malformed/i.test(m)) return 'corrupt'
      return 'unreadable'
    }
    const buildPreview = async (query, sessionId) => {
      const surface = await query.readSurface(sessionId)
      const events = Array.isArray(surface && surface.events) ? surface.events : []
      const head = []
      const tail = []
      let userCount = 0, assistantCount = 0, toolResultCount = 0, toolCallBlocks = 0
      let lastActivityAt = null, anyTruncated = false
      for (const ev of events) {
        const t = typeof ev.time === 'number' ? ev.time : null
        if (t !== null && (lastActivityAt === null || t > lastActivityAt)) lastActivityAt = t
        const type = ev && ev.type
        const d = ev && ev.data
        const content = d && typeof d === 'object' ? d.content : undefined
        if (type === 'user/message') {
          userCount += 1
          const raw = msgText(ev)
          if (raw) {
            const text = truncate(raw, 200)
            if (text.length < raw.length) anyTruncated = true
            if (head.length === 0) head.push({ role: 'user', text, at: t })
            tail.push({ role: 'user', text, at: t })
          }
        } else if (type === 'assistant/message') {
          assistantCount += 1
          if (Array.isArray(content)) for (const b of content) if (b && b.type === 'tool-call') toolCallBlocks += 1
          const raw = msgText(ev)
          if (raw) {
            const text = truncate(raw, 200)
            if (text.length < raw.length) anyTruncated = true
            tail.push({ role: 'assistant', text, at: t })
          }
        } else if (type === 'tool/result') {
          toolResultCount += 1
          if (Array.isArray(content)) for (const b of content) if (b && b.type === 'tool-call') toolCallBlocks += 1
        }
      }
      const lastTwo = tail.slice(-2)
      let omittedMessages = 0
      if (head.length > 0 && lastTwo.length > 0) {
        const headKey = head[0].text
        const inTail = lastTwo.some((m) => m.text === headKey)
        if (!inTail) omittedMessages = Math.max(0, tail.length - 1 - lastTwo.length)
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
      }
    }
    const previewOne = async (sessionId) => {
      const query = queryOf()
      if (!query || typeof query.readSurface !== 'function') {
        return { sessionId, error: previewError('unavailable', 'session query service unavailable') }
      }
      const cached = cacheGet(sessionId)
      if (cached) return cached
      try {
        const result = await Promise.race([
          buildPreview(query, sessionId).then((v) => ({ v })),
          timer.timeout(4000).then(() => null),
        ])
        if (result === null) {
          const partial = { sessionId, error: previewError('timeout', 'preview timed out'), truncated: true }
          cacheSet(sessionId, partial)
          return partial
        }
        cacheSet(sessionId, result.v)
        return result.v
      } catch (e) {
        return { sessionId, error: previewError(categorize(e), (e && e.message) || e), truncated: false }
      }
    }

    harness.handle('archived.ids', () => {
      try {
        const registry = registryOf()
        const ids = registry && registry.archivedSessionIds
        return { ids: Array.isArray(ids) ? [...ids] : [] }
      } catch (e) {
        return { ids: [], error: String((e && e.message) || e) }
      }
    })
    harness.handle('archived.list', async (args) => {
      try {
        const a = args && typeof args === 'object' ? args : {}
        return await listArchived(a.ids)
      } catch (e) {
        return { total: 0, items: [], error: String((e && e.message) || e) }
      }
    })
    harness.handle('archived.restore', async (args) => {
      const a = args && typeof args === 'object' ? args : {}
      if (typeof a.sessionId !== 'string') return { ok: false, error: 'bad-request', message: 'sessionId required' }
      return await unarchiveOne(a.sessionId)
    })
    harness.handle('archived.restore-all', async (args) => {
      const a = args && typeof args === 'object' ? args : {}
      const ids = cap(a.ids, 500)
      const failed = []
      let restored = 0
      for (const id of ids) {
        const r = await unarchiveOne(id)
        if (r.ok) restored += 1
        else failed.push({ sessionId: id, error: r.error, message: r.message })
      }
      return { restored, failed }
    })
    harness.handle('archived.preview', async (args) => {
      const a = args && typeof args === 'object' ? args : {}
      if (typeof a.sessionId !== 'string') return { sessionId: null, error: previewError('bad-request', 'sessionId required') }
      return await previewOne(a.sessionId)
    })
    harness.handle('session.title', async (args) => {
      const a = args && typeof args === 'object' ? args : {}
      if (typeof a.sessionId !== 'string') return { title: null }
      const query = queryOf()
      if (!query || typeof query.readTitleSnapshots !== 'function') return { title: null }
      try {
        const obs = await query.readTitleSnapshots([a.sessionId])
        const o = Array.isArray(obs) ? obs[0] : undefined
        if (o && o.status === 'fulfilled' && o.value && o.value.title && typeof o.value.title.title === 'string') {
          return { title: o.value.title.title }
        }
        return { title: null }
      } catch (e) {
        return { title: null, error: String((e && e.message) || e) }
      }
    })
    console.log('[dsh-unarchive] host ready (restore=' + String(!!registryOf()) + ', query=' + String(!!queryOf()) + ')')
  },
}
