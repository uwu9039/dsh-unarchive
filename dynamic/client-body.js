return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    const timer = ctx.get('timer')
    const localeSvc = ctx.get('locale')
    const warn = (...a) => console.error('[dsh-unarchive]', ...a)
    const h = React.createElement

    const dicts = {
      zh: {
        entry: '归档会话',
        tabList: '归档列表',
        tabSettings: '设置',
        panelTitle: '归档会话',
        panelSubtitle: 'Archived sessions',
        close: '关闭',
        empty: '没有已归档的会话',
        emptyHint: '归档入口在侧边栏右键菜单：归档不会删除会话数据。',
        ungrouped: '未分组',
        untitled: '未命名会话 · {id}',
        restore: '恢复',
        restoring: '恢复中…',
        restoreAll: '全部恢复',
        confirmRestoreAll: '确认恢复全部 {n} 个会话？',
        confirm: '确认',
        cancel: '取消',
        preview: '预览',
        collapse: '收起',
        previewLoading: '正在读取预览…',
        previewEmpty: '该会话还没有用户消息。',
        previewUnavailable: '预览不可用（{reason}）',
        previewOmitted: '…（中间 {n} 条消息已省略）',
        statLine: '用户消息 {u} · 助手消息 {a} · 工具调用 {t}',
        lastActivity: '最后活动',
        createdAt: '创建于',
        restoredFeedback: '已恢复：{title}（回到原工作区）',
        restoreFailedFeedback: '恢复失败：{title}（{reason}）',
        restoreAllDone: '已全部恢复 {n} 个会话',
        restoreAllPartial: '已恢复 {n} 个，{m} 个失败（可在列表中重试）',
        loadError: '列表加载失败：{reason}',
        footer: '归档不会删除会话数据',
        settingConfirm: '归档前二次确认',
        settingConfirmDesc: '右键菜单归档时先弹出确认框（默认关闭，与原生行为一致）',
        settingButton: '显示侧边栏入口',
        settingButtonDesc: '在侧边栏设置按钮旁显示“归档会话”按钮',
        settingPreview: '启用内容预览',
        settingPreviewDesc: '展开行内预览会话开头与最近消息',
        confirmTitle: 'dsh-unarchive 归档确认',
        confirmBody: '归档不会删除会话，可在侧边栏 dsh-unarchive 面板中随时恢复。',
        archive: '归档',
      },
      en: {
        entry: 'Archived sessions',
        tabList: 'Archived',
        tabSettings: 'Settings',
        panelTitle: 'Archived sessions',
        panelSubtitle: 'Restore archived conversations',
        close: 'Close',
        empty: 'No archived sessions',
        emptyHint: 'Archive from the session context menu: archiving never deletes session data.',
        ungrouped: 'Ungrouped',
        untitled: 'Untitled · {id}',
        restore: 'Restore',
        restoring: 'Restoring…',
        restoreAll: 'Restore all',
        confirmRestoreAll: 'Restore all {n} sessions?',
        confirm: 'Confirm',
        cancel: 'Cancel',
        preview: 'Preview',
        collapse: 'Collapse',
        previewLoading: 'Loading preview…',
        previewEmpty: 'This session has no user messages yet.',
        previewUnavailable: 'Preview unavailable ({reason})',
        previewOmitted: '… ({n} messages omitted)',
        statLine: 'User {u} · Assistant {a} · Tools {t}',
        lastActivity: 'Last activity',
        createdAt: 'Created',
        restoredFeedback: 'Restored: {title} (back to its original workspace)',
        restoreFailedFeedback: 'Restore failed: {title} ({reason})',
        restoreAllDone: 'Restored all {n} sessions',
        restoreAllPartial: 'Restored {n}, {m} failed (retry from the list)',
        loadError: 'Failed to load list: {reason}',
        footer: 'Archiving never deletes session data',
        settingConfirm: 'Confirm before archiving',
        settingConfirmDesc: 'Ask before archiving from the context menu (off by default — identical to native behavior)',
        settingButton: 'Show sidebar entry',
        settingButtonDesc: 'Show the “Archived sessions” button next to Settings',
        settingPreview: 'Enable content preview',
        settingPreviewDesc: 'Expand inline previews of the session opening and recent messages',
        confirmTitle: 'dsh-unarchive archive confirmation',
        confirmBody: 'Archiving does not delete the session — you can restore it anytime from the dsh-unarchive panel in the sidebar.',
        archive: 'Archive',
      },
    }
    const lang = () => {
      try {
        const snap = localeSvc && typeof localeSvc.getLocale === 'function' ? localeSvc.getLocale() : null
        const id = snap && snap.id ? String(snap.id) : ''
        return /^zh/i.test(id) ? 'zh' : 'en'
      } catch { return 'en' }
    }
    const t = (key) => {
      const d = dicts[lang()] || dicts.en
      return d[key] ?? dicts.en[key] ?? key
    }

    const listeners = new Set()
    const notify = () => { for (const fn of Array.from(listeners)) { try { fn() } catch {} } }
    const store = {
      open: false,
      tab: 'list',
      settings: { confirmOnArchive: false, showButton: true, previewEnabled: true },
      confirm: null,
      feedback: null,
      feedbackKey: 0,
    }
    const setStore = (patch) => { Object.assign(store, patch); notify() }
    const subscribe = (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }
    const useStore = () => {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((x) => x + 1)), [])
      return store
    }

    // Archive glyph on the native 20px icon grid (fill-based weight, own drawing).
    const IconArchive = () => h('svg', { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
      h('path', { d: 'M2.5 5h15M3.5 5v8.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M7.5 3.5h5M8 3.5V2.8a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v.7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M10 14.5v-3.6M10 10.9l-1.3 1.3M10 10.9l1.3 1.3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    )

    function SidebarEntry(props) {
      const s = useStore()
      if (!s.settings.showButton) return null
      const wide = !!props.wide
      return h('button', {
        type: 'button',
        className: 'dua-entry' + (wide ? '' : ' dua-entry-rail') + (s.open ? ' dua-entry-active' : ''),
        title: t('entry'),
        'aria-label': t('entry'),
        onClick: () => setStore({ open: !s.open, tab: 'list' }),
      },
        h(IconArchive, { key: 'i' }),
        wide ? h('span', { key: 'l', className: 'dua-entry-label' }, t('entry')) : null,
      )
    }

    const fmtTime = (ts) => {
      try { return new Date(ts).toLocaleString() } catch { return String(ts) }
    }

    function PreviewBody({ data }) {
      if (!data) return h('div', { className: 'dua-preview-meta' }, t('previewLoading'))
      const err = data.error
      if (err) {
        const reason = ({ missing: 'missing log', corrupt: 'corrupt log', timeout: 'timeout', unreadable: 'unreadable log' })[err.category] || err.category
        return h('div', { className: 'dua-preview-meta dua-preview-error' }, t('previewUnavailable').replace('{reason}', reason))
      }
      const st = data.stats || {}
      const kids = []
      if (data.empty) kids.push(h('div', { key: 'e', className: 'dua-preview-meta' }, t('previewEmpty')))
      const statText = t('statLine')
        .replace('{u}', String(st.userMessages ?? 0))
        .replace('{a}', String(st.assistantMessages ?? 0))
        .replace('{t}', String(st.toolCalls ?? 0))
      kids.push(h('div', { key: 's', className: 'dua-preview-meta' }, statText +
        (typeof st.lastActivityAt === 'number' ? ' · ' + t('lastActivity') + ' ' + fmtTime(st.lastActivityAt) : '')))
      for (const m of data.head || []) kids.push(h('div', { key: 'h' + m.at, className: 'dua-preview-msg dua-preview-head' }, m.text))
      if (data.omittedMessages > 0) kids.push(h('div', { key: 'o', className: 'dua-preview-meta dua-preview-omit' }, t('previewOmitted').replace('{n}', String(data.omittedMessages))))
      for (const m of data.tail || []) kids.push(h('div', { key: 't' + m.at, className: 'dua-preview-msg' + (m.role === 'assistant' ? ' dua-preview-assistant' : ''), style: m.role === 'assistant' ? { opacity: 0.85 } : undefined }, m.text))
      return h('div', { className: 'dua-preview' }, kids)
    }

    function ArchivePanel({ useWorkspaces }) {
      const s = useStore()
      const [state, setState] = React.useState({ phase: 'loading', items: [], error: null })
      const [previews, setPreviews] = React.useState({})
      const [restoring, setRestoring] = React.useState(null)
      const [confirmAll, setConfirmAll] = React.useState(false)
      const [busyAll, setBusyAll] = React.useState(false)
      const [fallbackIds, setFallbackIds] = React.useState(null)

      let reactiveIds = []
      let hasHook = false
      if (typeof useWorkspaces === 'function') {
        try { reactiveIds = useWorkspaces((st) => (st && st.archivedSessionIds) || []) || []; hasHook = true } catch {}
      }
      const archivedIds = hasHook ? reactiveIds : (fallbackIds || [])
      const idsKey = JSON.stringify(archivedIds)

      React.useEffect(() => {
        if (!hasHook) {
          let alive = true
          host.call('archived.ids', {}).then((r) => { if (alive) setFallbackIds((r && Array.isArray(r.ids)) ? r.ids : []) }).catch(() => { if (alive) setFallbackIds([]) })
          return () => { alive = false }
        }
      }, [hasHook])

      React.useEffect(() => {
        let alive = true
        if (!archivedIds.length) { setState({ phase: 'ready', items: [], error: null }); return }
        setState((prev) => ({ ...prev, phase: 'loading' }))
        host.call('archived.list', { ids: archivedIds }).then((res) => {
          if (!alive) return
          const r = res || {}
          setState({ phase: 'ready', items: Array.isArray(r.items) ? r.items : [], error: r.unavailable ? 'unavailable' : null })
        }).catch((e) => {
          if (!alive) return
          setState({ phase: 'error', items: [], error: String((e && e.message) || e) })
        })
        return () => { alive = false }
      }, [idsKey])

      React.useEffect(() => {
        if (!store.feedback || !timer) return
        return timer.timeout(() => setStore({ feedback: null }), 4000)
      }, [store.feedbackKey])

      // Modal behavior: Escape closes (native settings panel pattern).
      React.useEffect(() => {
        const onKey = (e) => { if (e && e.key === 'Escape') setStore({ open: false }) }
        if (typeof window !== 'undefined') {
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }
      }, [])

      const displayTitle = (it) => it.title || t('untitled').replace('{id}', String(it.sessionId).slice(-8))
      const onRestore = (it) => {
        setRestoring(it.sessionId)
        host.call('archived.restore', { sessionId: it.sessionId }).then((res) => {
          setRestoring(null)
          const title = displayTitle(it)
          const ok = res && res.ok
          setStore({
            feedback: ok
              ? t('restoredFeedback').replace('{title}', title)
              : t('restoreFailedFeedback').replace('{title}', title).replace('{reason}', (res && res.message) || 'unknown'),
            feedbackKey: store.feedbackKey + 1,
          })
        }).catch((e) => {
          setRestoring(null)
          setStore({ feedback: t('restoreFailedFeedback').replace('{title}', displayTitle(it)).replace('{reason}', String((e && e.message) || e)), feedbackKey: store.feedbackKey + 1 })
        })
      }
      const onTogglePreview = (it) => {
        const cur = previews[it.sessionId]
        if (cur && cur.phase === 'ready') {
          const next = { ...previews }
          delete next[it.sessionId]
          setPreviews(next)
          return
        }
        setPreviews((p) => ({ ...p, [it.sessionId]: { phase: 'loading' } }))
        host.call('archived.preview', { sessionId: it.sessionId }).then((res) => {
          setPreviews((p) => ({ ...p, [it.sessionId]: { phase: 'ready', data: res || {} } }))
        }).catch((e) => {
          setPreviews((p) => ({ ...p, [it.sessionId]: { phase: 'ready', data: { error: { category: 'unreadable', message: String((e && e.message) || e) } } } }))
        })
      }
      const onRestoreAll = () => {
        if (!confirmAll) { setConfirmAll(true); return }
        setBusyAll(true)
        host.call('archived.restore-all', { ids: archivedIds }).then((res) => {
          setBusyAll(false); setConfirmAll(false)
          const r = res || {}
          const n = typeof r.restored === 'number' ? r.restored : 0
          const failed = Array.isArray(r.failed) ? r.failed : []
          setStore({
            feedback: failed.length
              ? t('restoreAllPartial').replace('{n}', String(n)).replace('{m}', String(failed.length))
              : t('restoreAllDone').replace('{n}', String(n)),
            feedbackKey: store.feedbackKey + 1,
          })
        }).catch((e) => {
          setBusyAll(false); setConfirmAll(false)
          setStore({ feedback: String((e && e.message) || e), feedbackKey: store.feedbackKey + 1 })
        })
      }

      const groups = []
      const seen = new Set()
      for (const it of state.items || []) {
        const key = it.workspaceTitle || '\u0000'
        if (!seen.has(key)) { seen.add(key); groups.push({ key, label: it.workspaceTitle || t('ungrouped'), items: [] }) }
        const g = groups[groups.length - 1]
        if (g.key === key) g.items.push(it)
      }
      const total = state.items.length

      const kids = []
      kids.push(h('div', { key: 'head', className: 'dua-panel-head' },
        h('div', { key: 't', className: 'dua-panel-title' }, t('panelTitle'),
          h('span', { key: 'n', className: 'dua-panel-count' }, String(total))),
        h('div', { key: 's', className: 'dua-panel-subtitle' }, t('panelSubtitle')),
        h('button', { key: 'x', type: 'button', className: 'dua-icon-btn dua-close-btn', autoFocus: true, title: t('close'), 'aria-label': t('close'), onClick: () => setStore({ open: false }) }, '✕'),
      ))
      kids.push(h('div', { key: 'tabs', className: 'dua-tabs' },
        h('button', { key: 'l', className: 'dua-tab' + (s.tab === 'list' ? ' dua-tab-active' : ''), onClick: () => setStore({ tab: 'list' }) }, t('tabList')),
        h('button', { key: 's', className: 'dua-tab' + (s.tab === 'settings' ? ' dua-tab-active' : ''), onClick: () => setStore({ tab: 'settings' }) }, t('tabSettings')),
      ))
      if (store.feedback) kids.push(h('div', { key: 'fb', className: 'dua-feedback' }, store.feedback))
      if (s.tab === 'settings') {
        kids.push(h('div', { key: 'body', className: 'dua-settings' },
          h(Toggle, { key: 'c', checked: s.settings.confirmOnArchive, onChange: (v) => setStore({ settings: { ...s.settings, confirmOnArchive: v } }), label: t('settingConfirm'), desc: t('settingConfirmDesc') }),
          h(Toggle, { key: 'b', checked: s.settings.showButton, onChange: (v) => setStore({ settings: { ...s.settings, showButton: v } }), label: t('settingButton'), desc: t('settingButtonDesc') }),
          h(Toggle, { key: 'p', checked: s.settings.previewEnabled, onChange: (v) => setStore({ settings: { ...s.settings, previewEnabled: v } }), label: t('settingPreview'), desc: t('settingPreviewDesc') }),
          h('div', { key: 'n', className: 'dua-panel-foot' }, t('footer')),
        ))
      } else {
        const body = []
        if (state.phase === 'error') {
          body.push(h('div', { key: 'e', className: 'dua-empty' }, t('loadError').replace('{reason}', state.error)))
        } else if (total === 0 && state.phase === 'ready') {
          body.push(h('div', { key: 'e', className: 'dua-empty' }, t('empty')))
          body.push(h('div', { key: 'h', className: 'dua-empty-hint' }, t('emptyHint')))
        } else {
          if (total >= 2 && !busyAll) {
            body.push(h('div', { key: 'ra', className: 'dua-actions' },
              confirmAll
                ? h('span', { key: 'q', className: 'dua-confirm-all' }, t('confirmRestoreAll').replace('{n}', String(total)),
                    h('button', { key: 'y', className: 'dua-btn dua-btn-primary', onClick: onRestoreAll }, t('confirm')),
                    h('button', { key: 'n', className: 'dua-btn', onClick: () => setConfirmAll(false) }, t('cancel')))
                : h('button', { key: 'b', className: 'dua-btn', onClick: () => setConfirmAll(true) }, t('restoreAll')),
            ))
          }
          for (const g of groups) {
            body.push(h('div', { key: 'g' + g.key, className: 'dua-group' },
              h('div', { key: 'l', className: 'dua-group-label' }, g.label),
              g.items.map((it) => {
                const pv = previews[it.sessionId]
                const expanded = !!(pv && pv.phase === 'ready')
                return h('div', { key: it.sessionId, className: 'dua-item' },
                  h('div', { key: 'row', className: 'dua-item-row' },
                    h('div', { key: 'info', className: 'dua-item-info' },
                      h('div', { key: 'title', className: 'dua-item-title', title: displayTitle(it) }, displayTitle(it)),
                      h('div', { key: 'meta', className: 'dua-item-meta' },
                        (it.workspacePath || it.workspaceTitle ? it.workspacePath || it.workspaceTitle + ' · ' : '') +
                        (typeof it.createdAt === 'number' ? t('createdAt') + ' ' + fmtTime(it.createdAt) : ''),
                      ),
                    ),
                    h('button', {
                      key: 'pv', className: 'dua-icon-btn dua-preview-toggle', title: expanded ? t('collapse') : t('preview'),
                      'aria-label': expanded ? t('collapse') : t('preview'),
                      onClick: () => onTogglePreview(it),
                    }, expanded ? '▾' : '▸'),
                    h('button', {
                      key: 'rs', className: 'dua-btn dua-btn-primary dua-restore-btn',
                      disabled: restoring === it.sessionId,
                      onClick: () => onRestore(it),
                    }, restoring === it.sessionId ? t('restoring') : t('restore')),
                  ),
                  (s.settings.previewEnabled && pv) ? h(PreviewBody, { key: 'pvbody', data: pv.data }) : null,
                )
              }),
            ))
          }
          if (state.phase === 'loading' && total === 0) body.push(h('div', { key: 'ld', className: 'dua-empty' }, t('previewLoading')))
        }
        kids.push(h('div', { key: 'body', className: 'dua-list' }, body))
        kids.push(h('div', { key: 'foot', className: 'dua-panel-foot' }, t('footer')))
      }
      // Centered modal (native settings-panel pattern): mask click and Escape close.
      return h('div', { key: 'ov', className: 'dua-overlay' },
        h('div', { key: 'mask', className: 'dua-mask', 'aria-hidden': 'true', onClick: () => setStore({ open: false }) }),
        h('div', { key: 'panel', className: 'dua-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('panelTitle') }, kids),
      )
    }

    function Toggle({ checked, onChange, label, desc }) {
      return h('div', { className: 'dua-toggle-row' },
        h('div', { className: 'dua-toggle-text' },
          h('div', { className: 'dua-toggle-label' }, label),
          desc ? h('div', { className: 'dua-toggle-desc' }, desc) : null,
        ),
        h('button', {
          className: 'dua-toggle' + (checked ? ' dua-toggle-on' : ''),
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          onClick: () => onChange(!checked),
        }, h('span', { className: 'dua-toggle-knob' })),
      )
    }

    function ConfirmBox() {
      useStore()
      React.useEffect(() => {
        const onKey = (e) => {
          const c = store.confirm
          if (c && e && e.key === 'Escape') {
            const resolve = c.resolve
            setStore({ confirm: null })
            resolve(false)
          }
        }
        if (typeof window !== 'undefined') {
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }
      }, [])
      const c = store.confirm
      if (!c) return null
      const finish = (allowed) => { const resolve = c.resolve; setStore({ confirm: null }); resolve(allowed) }
      const titleText = c.title || t('untitled').replace('{id}', String(c.sessionId).slice(-8))
      return h('div', { className: 'dua-overlay' },
        h('div', { key: 'mask', className: 'dua-mask', 'aria-hidden': 'true', onClick: () => finish(false) }),
        h('div', { key: 'box', className: 'dua-confirm', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'dua-confirm-title' }, t('confirmTitle')),
          h('div', { className: 'dua-confirm-session' }, titleText),
          h('div', { className: 'dua-confirm-body' }, t('confirmBody')),
          h('div', { className: 'dua-confirm-actions' },
            h('button', { key: 'no', className: 'dua-btn', autoFocus: true, onClick: () => finish(false) }, t('cancel')),
            h('button', { key: 'yes', className: 'dua-btn dua-btn-primary', onClick: () => finish(true) }, t('archive')),
          ),
        ),
      )
    }

    function Overlay(props) {
      const s = useStore()
      const closed = !s.open && !s.confirm
      return h('div', { className: 'dua-layer', style: closed ? { display: 'none' } : undefined },
        s.open ? h(ArchivePanel, { key: 'panel', useWorkspaces: props.useWorkspaces }) : null,
        s.confirm ? h(ConfirmBox, { key: 'confirm' }) : null,
      )
    }

    styles.insert(`
.dua-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
.dua-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.dua-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1, rgba(0,0,0,.35)); backdrop-filter: var(--dsw-mask-blur, none); }
/* Sidebar footer row: mirrors the native Settings trigger (34px, radius 12, hover token). */
.dua-entry {
  box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  width: 100%; height: 34px; padding: 6px 10px; margin: 4px 0;
  border: none; border-radius: 12px; cursor: pointer; flex: none; overflow: hidden;
  background: transparent; color: var(--dsw-alias-label-primary, #202124);
  font-family: inherit; font-size: 14px; line-height: 22px;
}
.dua-entry:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
.dua-entry-active { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08)); }
.dua-entry-rail { border-radius: 50%; justify-content: center; gap: 0; width: 36px; height: 36px; margin: 8px 0 10px; padding: 0; }
.dua-entry-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Centered modal panel: mirrors the native settings modal (mask + layer-2 card). */
.dua-panel {
  position: relative; z-index: 1; display: flex; flex-direction: column;
  width: 640px; max-width: calc(100vw - 48px); max-height: min(720px, 100vh - 48px);
  background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #202124);
  border-radius: 24px; box-shadow: var(--dsw-shadow-lv3, 0 8px 32px rgba(0,0,0,.18)); overflow: hidden;
}
.dua-panel-head { display: flex; align-items: baseline; gap: 8px; padding: 16px 18px 8px; flex: none; }
.dua-panel-title { font-size: 15px; font-weight: 600; display: flex; align-items: baseline; gap: 6px; }
.dua-panel-count { font-size: 12px; color: var(--dsw-alias-label-secondary, #5f6368); background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.06)); border-radius: 999px; padding: 1px 8px; }
.dua-panel-subtitle { flex: 1; font-size: 12px; color: var(--dsw-alias-label-secondary, #5f6368); }
.dua-icon-btn {
  border: none; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #5f6368);
  font-size: 13px; line-height: 1; border-radius: 6px; padding: 4px 6px;
  display: inline-flex; align-items: center; justify-content: center;
}
.dua-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); color: var(--dsw-alias-label-primary, #202124); }
.dua-close-btn { flex: none; align-self: center; }
.dua-tabs { display: flex; gap: 2px; padding: 0 16px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); flex: none; }
.dua-tab { border: none; background: transparent; cursor: pointer; padding: 6px 10px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-secondary, #5f6368); border-bottom: 2px solid transparent; }
.dua-tab-active { color: var(--dsw-alias-brand-primary, #1a73e8); border-bottom-color: var(--dsw-alias-brand-primary, #1a73e8); }
.dua-feedback { margin: 8px 18px 0; padding: 6px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.05)); color: var(--dsw-alias-state-success-primary, #188038); flex: none; }
.dua-list { padding: 6px 0 8px; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
.dua-actions { padding: 8px 18px 2px; }
.dua-confirm-all { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary, #5f6368); }
.dua-group-label { padding: 8px 18px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--dsw-alias-label-secondary, #5f6368); }
.dua-item { border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.05)); }
.dua-item-row { display: flex; align-items: center; gap: 8px; padding: 8px 18px; }
.dua-item-info { flex: 1; min-width: 0; }
.dua-item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dua-item-meta { font-size: 11px; color: var(--dsw-alias-label-secondary, #5f6368); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.dua-preview-toggle { flex: none; }
.dua-restore-btn { flex: none; }
.dua-btn {
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.2)); background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #202124); border-radius: 8px; padding: 4px 12px; font: inherit; font-size: 12px; cursor: pointer;
}
.dua-btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.06)); }
.dua-btn-primary { background: var(--dsw-alias-brand-primary, #1a73e8); border-color: transparent; color: #fff; }
.dua-btn-primary:hover { opacity: .9; background: var(--dsw-alias-brand-primary, #1a73e8); }
.dua-btn:disabled { opacity: .5; cursor: default; }
.dua-preview { padding: 2px 18px 10px; }
.dua-preview-meta { font-size: 11px; color: var(--dsw-alias-label-secondary, #5f6368); margin: 2px 0; }
.dua-preview-error { color: var(--dsw-alias-state-error-primary, #d93025); }
.dua-preview-omit { font-style: italic; }
.dua-preview-msg { margin: 4px 0; padding: 6px 8px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.03)); white-space: pre-wrap; word-break: break-word; }
.dua-preview-head { border-left: 2px solid var(--dsw-alias-brand-primary, #1a73e8); }
.dua-empty { padding: 28px 18px 4px; text-align: center; color: var(--dsw-alias-label-primary, #202124); }
.dua-empty-hint { padding: 4px 18px 24px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary, #5f6368); }
.dua-panel-foot { padding: 8px 18px 12px; font-size: 11px; color: var(--dsw-alias-label-secondary, #5f6368); flex: none; }
.dua-settings { padding: 10px 18px; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
.dua-toggle-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.05)); }
.dua-toggle-text { flex: 1; min-width: 0; }
.dua-toggle-label { font-weight: 500; }
.dua-toggle-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, #5f6368); margin-top: 2px; }
.dua-toggle { flex: none; width: 34px; height: 20px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.2)); background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.1)); cursor: pointer; padding: 0; position: relative; transition: background .15s; }
.dua-toggle-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .15s; }
.dua-toggle-on { background: var(--dsw-alias-brand-primary, #1a73e8); border-color: transparent; }
.dua-toggle-on .dua-toggle-knob { left: 16px; }
.dua-confirm {
  position: relative; z-index: 1; width: 340px; max-width: calc(100vw - 48px);
  background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #202124);
  border-radius: 24px; box-shadow: var(--dsw-shadow-lv3, 0 8px 32px rgba(0,0,0,.2)); padding: 16px;
}
.dua-confirm-title { font-size: 15px; font-weight: 600; }
.dua-confirm-session { margin-top: 8px; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dua-confirm-body { margin-top: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, #5f6368); }
.dua-confirm-actions { margin-top: 14px; display: flex; justify-content: flex-end; gap: 8px; }
`)

    const workspaces = ctx.get('workspaces')
    const MARK = '__dshUnarchiveGuard'
    if (workspaces && typeof workspaces.archiveSession === 'function') {
      const original = workspaces.archiveSession.bind(workspaces)
      const prev = workspaces[MARK]
      if (prev && typeof prev.original === 'function') workspaces.archiveSession = prev.original
      const next = async (sessionId) => {
        if (!store.settings.confirmOnArchive) return original(sessionId)
        const ask = () => new Promise((resolve) => {
          setStore({ confirm: { sessionId, title: null, resolve } })
          host.call('session.title', { sessionId }).then((res) => {
            const c = store.confirm
            if (c && c.sessionId === sessionId && res && typeof res.title === 'string') {
              setStore({ confirm: { ...c, title: res.title } })
            }
          }).catch(() => {})
        })
        const allowed = await Promise.race([ask(), timer.timeout(60000).then(() => true)])
        if (!allowed) return
        return original(sessionId)
      }
      workspaces[MARK] = { original, next }
      workspaces.archiveSession = next
      ctx.effect(() => {
        if (workspaces[MARK] && workspaces[MARK].next === next) {
          workspaces.archiveSession = workspaces[MARK].original
          delete workspaces[MARK]
        }
      })
    } else {
      warn('workspaces service unavailable — archive confirmation disabled (fail-open)')
    }

    if (slots) {
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'unarchive-entry', order: 100, label: () => t('entry') },
        SidebarEntry,
      ))
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'unarchive-overlay', order: 100 },
        Overlay,
      ))
    } else {
      warn('slots service unavailable — sidebar entry and panel disabled')
    }

    ctx.on('locale/change', () => notify())
    console.log('[dsh-unarchive] client ready')
  },
}
