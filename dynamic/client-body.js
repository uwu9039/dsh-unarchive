/**
 * dsh-unarchive — client half.
 *
 * Pure-DOM UI mirroring the dsh-airbag client architecture end to end: no
 * React, no slots, no portal. A root element is appended to <body> (with the
 * same DOMContentLoaded fallback airbag uses), its own stylesheet is injected
 * into <head>, and every piece of chrome — FAB, corner panel, archive
 * confirmation modal — is built and updated by hand.
 *
 * The optional archive confirmation wraps `ctx.workspaces.archiveSession`
 * (fail-open: any unavailable piece lets native archiving through).
 *
 * Talks to the host half over same-origin HTTP (/dsh-unarchive/api/*).
 */


return {
  inject: ['timer'],
  apply(ctx) {
    const timer = ctx.get('timer');
    const warn = (...a) => console.error('[dsh-unarchive]', ...a);
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return; // headless surface: nothing to mount (fail-open)

    const API = '/dsh-unarchive/api';

    async function apiJson(path, options) {
      const res = await fetch(API + path, options);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || ('HTTP ' + res.status));
      }
      return res.json();
    }

        // ---- host bridge (dynamic: package-private harness.call) ----
    const api = {
      list: () => host.call('archived.ids', {}).then((r) => host.call('archived.list', { ids: (r && Array.isArray(r.ids)) ? r.ids : [] })),
      preview: (sessionId) => host.call('archived.preview', { sessionId }),
      restore: (sessionId) => host.call('archived.restore', { sessionId }),
      restoreAll: (ids) => host.call('archived.restore-all', { ids }),
      title: (sessionId) => host.call('session.title', { sessionId }),
      getSettings: () => Promise.resolve(null),
      setSettings: () => Promise.resolve(null),
    };
    // ---- end host bridge ----

    // Styles mirror the dsh-airbag capsule/panel look: the FAB root is a small
    // fixed box in the bottom-right corner (airbag's own root shape — not a
    // full-screen layer), the corner panel and the confirmation modal are
    // independent fixed elements, light/dark theme via prefers-color-scheme,
    // and a vertical stack when airbag is also mounted.
    const CSS = `
.dua-root {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px; line-height: 1.45; color: #1f2430;
}
@media (prefers-color-scheme: dark) { .dua-root { color: #d6dae3; } }
.dua-root * { box-sizing: border-box; }
.dua-fab {
  display: flex; align-items: center; gap: 6px;
  background: #1f2430; color: #fff; border: none; border-radius: 999px;
  padding: 8px 12px; cursor: pointer;
  box-shadow: 0 4px 14px rgba(20, 30, 60, .28);
  font-size: 13px; line-height: 1.45;
}
.dua-fab:hover { background: #2c3342; }
.dua-fab-active { background: #2c3342; }
.dua-fab[hidden] { display: none; }
/* Vertical stack with dsh-airbag (no :has dependency): a MutationObserver on
   <body> probes for airbag's FAB and its open panel, then positions our FAB
   and panel via inline bottom offsets so the two plugins never overlap — in
   any combination and regardless of mount order. */
.dua-panel *, .dua-modal * { box-sizing: border-box; }
.dua-panel {
  position: fixed; right: 16px; bottom: 64px; z-index: 2147483001;
  width: 380px; max-width: calc(100vw - 32px);
  max-height: min(560px, calc(100vh - 96px));
  background: #ffffff; border: 1px solid #e2e5ec; border-radius: 12px;
  box-shadow: 0 12px 36px rgba(20, 30, 60, .22);
  display: flex; flex-direction: column; overflow: hidden;
  color: #1f2430;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px;
}
.dua-panel[hidden] { display: none; }
@media (prefers-color-scheme: dark) {
  .dua-panel { background: #232936; border-color: #343c4d; color: #d6dae3; }
}
.dua-panel-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e8eaf0; flex: none; }
@media (prefers-color-scheme: dark) { .dua-panel-head { border-bottom-color: #343c4d; } }
.dua-panel-title { font-weight: 700; display: flex; align-items: baseline; gap: 6px; }
.dua-panel-count { font-size: 11px; opacity: .6; background: rgba(0,0,0,.06); border-radius: 999px; padding: 1px 8px; }
@media (prefers-color-scheme: dark) { .dua-panel-count { background: rgba(255,255,255,.08); } }
.dua-panel-subtitle { flex: 1; font-size: 12px; opacity: .6; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dua-icon-btn { border: none; background: none; cursor: pointer; color: inherit; opacity: .55; border-radius: 6px; padding: 2px 6px; font-family: inherit; font-size: 14px; }
.dua-icon-btn:hover { opacity: 1; background: rgba(0,0,0,.06); }
@media (prefers-color-scheme: dark) { .dua-icon-btn:hover { background: rgba(255,255,255,.1); } }
.dua-close-btn { flex: none; align-self: center; font-size: 16px; }
.dua-tabs { display: flex; border-bottom: 1px solid #e8eaf0; flex: none; }
@media (prefers-color-scheme: dark) { .dua-tabs { border-bottom-color: #343c4d; } }
.dua-tab { flex: 1; padding: 8px 4px; border: none; background: none; cursor: pointer; font-family: inherit; font-size: 13px; color: inherit; opacity: .6; border-bottom: 2px solid transparent; }
.dua-tab[aria-selected="true"] { opacity: 1; border-bottom-color: #4c7df0; font-weight: 600; }
.dua-feedback { margin: 8px 12px 0; padding: 6px 10px; border-radius: 8px; background: rgba(76,125,240,.1); color: #2e7d32; flex: none; }
@media (prefers-color-scheme: dark) { .dua-feedback { color: #81c784; } }
.dua-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 0 8px; }
.dua-actions { padding: 8px 12px 2px; }
.dua-confirm-all { display: inline-flex; align-items: center; gap: 8px; opacity: .7; }
.dua-group-label { padding: 8px 12px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
.dua-item { border-top: 1px solid #f0f1f5; }
@media (prefers-color-scheme: dark) { .dua-item { border-top-color: #2e3544; } }
.dua-item-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.dua-item-info { flex: 1; min-width: 0; }
.dua-item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dua-item-meta { font-size: 11px; opacity: .6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.dua-preview-toggle { flex: none; }
.dua-restore-btn { flex: none; }
.dua-btn { border: 1px solid #d5d9e2; background: #f6f7fa; color: inherit; border-radius: 8px; padding: 6px 12px; font-family: inherit; font-size: 12px; cursor: pointer; }
.dua-btn:hover { background: #eceef4; }
@media (prefers-color-scheme: dark) {
  .dua-btn { background: #2a3140; border-color: #3a4254; }
  .dua-btn:hover { background: #333b4d; }
}
.dua-btn-primary { background: #4c7df0; border-color: #4c7df0; color: #fff; }
.dua-btn-primary:hover { background: #3d6ae0; }
@media (prefers-color-scheme: dark) {
  .dua-btn-primary { background: #4c7df0; border-color: #4c7df0; color: #fff; }
  .dua-btn-primary:hover { background: #3d6ae0; }
}
.dua-btn:disabled { opacity: .5; cursor: default; }
.dua-preview { padding: 2px 12px 10px; }
.dua-preview-meta { font-size: 11px; opacity: .6; margin: 2px 0; }
.dua-preview-error { color: #d64545; opacity: 1; }
.dua-preview-omit { font-style: italic; }
.dua-preview-msg { margin: 4px 0; padding: 6px 8px; border-radius: 8px; background: #f6f7fa; white-space: pre-wrap; word-break: break-word; }
@media (prefers-color-scheme: dark) { .dua-preview-msg { background: #2a3140; } }
.dua-preview-head { border-left: 2px solid #4c7df0; }
.dua-empty { padding: 28px 12px 4px; text-align: center; }
.dua-empty-hint { padding: 4px 12px 24px; text-align: center; font-size: 12px; opacity: .6; }
.dua-panel-foot { padding: 8px 12px 10px; font-size: 11px; opacity: .6; flex: none; }
.dua-settings { padding: 10px 12px; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
.dua-toggle-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f1f5; }
@media (prefers-color-scheme: dark) { .dua-toggle-row { border-bottom-color: #2e3544; } }
.dua-toggle-text { flex: 1; min-width: 0; }
.dua-toggle-label { font-weight: 600; }
.dua-toggle-desc { font-size: 12px; opacity: .6; margin-top: 2px; }
.dua-toggle { flex: none; width: 34px; height: 20px; border-radius: 999px; border: 1px solid #d5d9e2; background: #e8eaf0; cursor: pointer; padding: 0; position: relative; transition: background .15s; }
.dua-toggle-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: left .15s; }
@media (prefers-color-scheme: dark) { .dua-toggle { background: #3a4254; border-color: #3a4254; } }
.dua-toggle-on { background: #4c7df0; border-color: #4c7df0; }
.dua-toggle-on .dua-toggle-knob { left: 16px; }
.dua-modal { position: fixed; inset: 0; z-index: 2147483002; display: flex; align-items: center; justify-content: center; }
.dua-modal[hidden] { display: none; }
.dua-modal-mask { position: absolute; inset: 0; background: rgba(20, 30, 60, .35); }
.dua-confirm {
  position: relative; z-index: 1; width: 340px; max-width: calc(100vw - 32px);
  background: #ffffff; color: #1f2430; border: 1px solid #e2e5ec;
  border-radius: 12px; box-shadow: 0 12px 36px rgba(20, 30, 60, .22); padding: 16px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px;
}
@media (prefers-color-scheme: dark) { .dua-confirm { background: #232936; border-color: #343c4d; color: #d6dae3; } }
.dua-confirm-title { font-size: 15px; font-weight: 700; }
.dua-confirm-session { margin-top: 8px; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dua-confirm-body { margin-top: 6px; font-size: 12px; opacity: .7; }
.dua-confirm-actions { margin-top: 14px; display: flex; justify-content: flex-end; gap: 8px; }
`;

    /** Build one element: className/disabled/hidden/autofocus get native props,
     * `on<Event>` attrs become listeners, everything else is an attribute. */
    function el(tag, attrs = {}, text) {
      const node = doc.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'className') node.className = value;
        else if (key === 'disabled') node.disabled = true;
        else if (key === 'hidden') node.hidden = true;
        else if (key === 'autofocus') node.autofocus = true;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value === true ? '' : String(value));
      }
      if (text !== undefined) node.textContent = text;
      return node;
    }

    // ---- i18n (own wording; bilingual) ----
    const dicts = {
      zh: {
        fabLabel: '归档',
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
        settingButton: '显示右下角入口',
        settingButtonDesc: '右下角显示“归档”悬浮按钮',
        settingPreview: '启用内容预览',
        settingPreviewDesc: '展开行内预览会话开头与最近消息',
        confirmTitle: 'dsh-unarchive 归档确认',
        confirmBody: '归档不会删除会话，可在右下角 dsh-unarchive 面板中随时恢复。',
        archive: '归档',
      },
      en: {
        fabLabel: 'Archive',
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
        settingButton: 'Show corner entry',
        settingButtonDesc: 'Show the floating “Archive” button at the bottom-right corner',
        settingPreview: 'Enable content preview',
        settingPreviewDesc: 'Expand inline previews of the session opening and recent messages',
        confirmTitle: 'dsh-unarchive archive confirmation',
        confirmBody: 'Archiving does not delete the session — you can restore it anytime from the dsh-unarchive panel at the bottom-right corner.',
        archive: 'Archive',
      },
    };
    const lang = () => {
      try {
        const snap = ctx.get('locale') && typeof ctx.get('locale').getLocale === 'function' ? ctx.get('locale').getLocale() : null;
        const id = snap && snap.id ? String(snap.id) : '';
        return /^zh/i.test(id) ? 'zh' : 'en';
      } catch { return 'en'; }
    };
    const t = (key) => {
      const d = dicts[lang()] || dicts.en;
      return d[key] ?? dicts.en[key] ?? key;
    };

    ctx.effect(() => {
      // ---- state ----
      const state = {
        open: false,
        tab: 'list',
        settings: { confirmOnArchive: false, showButton: true, previewEnabled: true },
        confirm: null,       // { sessionId, title, resolve }
        feedback: null,
        feedbackTimer: null,
        phase: 'idle',       // idle | loading | ready | error
        items: [],
        listError: null,
        previews: new Map(), // sessionId -> { phase, data }
        restoring: null,
        busyAll: false,
        confirmAll: false,
        disposed: false,
      };

      // ---- DOM skeleton (airbag mounting style: small FAB root + independent
      // fixed panel/modal, each appended to <body>) ----
      const styleTag = doc.createElement('style');
      styleTag.dataset.plugin = 'dsh-unarchive';
      styleTag.dataset.pluginCss = 'dsh-unarchive-css';
      styleTag.textContent = CSS;
      doc.head.appendChild(styleTag);

      const root = doc.createElement('div');
      root.dataset.duaRoot = 'true';

      const fab = el('button', { type: 'button', className: 'dua-fab', title: t('fabLabel'), 'aria-label': t('fabLabel') });
      fab.innerHTML = '<span aria-hidden="true">📦</span><span class="dua-fab-label"></span>';
      root.append(fab);

      const panel = el('div', { className: 'dua-panel', role: 'dialog', 'aria-label': t('panelTitle'), hidden: true });

      const modal = el('div', { className: 'dua-modal', hidden: true });
      const modalMask = el('div', { className: 'dua-modal-mask', 'aria-hidden': 'true' });
      const modalBox = el('div', { className: 'dua-confirm' });
      modal.append(modalMask, modalBox);

      const targets = [root, panel, modal];
      let attached = false;
      const attach = () => {
        if (state.disposed) return;
        if (doc.body === null) {
          doc.addEventListener('DOMContentLoaded', attach, { once: true });
          return;
        }
        attached = true;
        doc.body.append(...targets);
        // Vertical stack with dsh-airbag (same bottom-right corner): a
        // MutationObserver probes for airbag's FAB and its open panel, then
        // refreshLayout() parks our FAB above the airbag capsule (or above
        // its open panel) and our panel above our own FAB — the two plugins
        // never overlap, in any combination and mount order.
        refreshLayout();
        const observer = new MutationObserver(refreshLayout);
        observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
        shiftObserver = observer;
      };
      let shiftObserver = null;

      /** Recompute corner offsets against the live airbag DOM (rAF-throttled). */
      let layoutRaf = 0;
      let resizeObserver = null;
      let resizeTarget = null;
      const refreshLayout = () => {
        cancelAnimationFrame(layoutRaf);
        layoutRaf = requestAnimationFrame(() => {
          if (state.disposed) return;
          const airbagFab = doc.querySelector('[data-airbag-fab]');
          const airbagPanel = doc.querySelector('[data-airbag-panel]');
          let base = 16; // default corner (same spot airbag's own FAB uses)
          if (airbagFab) base = 64; // above the airbag capsule
          if (airbagPanel && !airbagPanel.hidden) {
            const h = airbagPanel.getBoundingClientRect().height || 0;
            base = 64 + h + 8; // above airbag's open panel
          }
          const vh = (typeof window !== 'undefined' && window.innerHeight) || doc.documentElement.clientHeight || 0;
          const maxBase = Math.max(16, vh - 608); // keep our panel (≤560 + 48) on screen
          base = Math.min(base, maxBase);
          if (base === 16) {
            root.style.removeProperty('bottom');
            panel.style.removeProperty('bottom');
          } else {
            root.style.bottom = base + 'px';
            panel.style.bottom = (base + 48) + 'px';
          }
          // Track airbag panel height changes (tab switches resize it).
          const ap = doc.querySelector('[data-airbag-panel]');
          if (typeof ResizeObserver !== 'undefined') {
            if (resizeTarget !== ap) {
              if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
              resizeTarget = ap;
              if (ap) {
                resizeObserver = new ResizeObserver(() => refreshLayout());
                resizeObserver.observe(ap);
              }
            }
          }
        });
      };
      attach();

      // ---- helpers ----
      const fmtTime = (ts) => {
        try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
      };
      const displayTitle = (it) => it.title || t('untitled').replace('{id}', String(it.sessionId).slice(-8));

      // ---- render ----
      const render = () => {
        if (state.disposed) return;
        fab.hidden = !state.settings.showButton;
        fab.querySelector('.dua-fab-label').textContent = t('fabLabel');
        fab.classList.toggle('dua-fab-active', state.open);
        panel.hidden = !state.open;
        if (state.open) renderPanel();
        modal.hidden = !state.confirm;
        if (state.confirm) renderModal();
      };

      const renderPanel = () => {
        panel.textContent = '';
        const head = el('div', { className: 'dua-panel-head' });
        const title = el('div', { className: 'dua-panel-title' }, '📦 ' + t('panelTitle'));
        title.append(el('span', { className: 'dua-panel-count' }, String(state.items.length)));
        head.append(title);
        head.append(el('div', { className: 'dua-panel-subtitle' }, t('panelSubtitle')));
        head.append(el('button', {
          type: 'button', className: 'dua-icon-btn dua-close-btn', title: t('close'), 'aria-label': t('close'),
          onClick: () => { state.open = false; state.confirmAll = false; render(); },
        }, '×'));
        panel.append(head);

        const tabs = el('div', { className: 'dua-tabs' });
        tabs.append(el('button', {
          type: 'button', role: 'tab', className: 'dua-tab',
          'aria-selected': state.tab === 'list' ? 'true' : 'false',
          onClick: () => { state.tab = 'list'; render(); },
        }, t('tabList')));
        tabs.append(el('button', {
          type: 'button', role: 'tab', className: 'dua-tab',
          'aria-selected': state.tab === 'settings' ? 'true' : 'false',
          onClick: () => { state.tab = 'settings'; render(); },
        }, t('tabSettings')));
        panel.append(tabs);

        if (state.feedback) panel.append(el('div', { className: 'dua-feedback' }, state.feedback));

        if (state.tab === 'settings') panel.append(renderSettings());
        else panel.append(renderList());

        panel.append(el('div', { className: 'dua-panel-foot' }, t('footer')));
      };

      const renderList = () => {
        const list = el('div', { className: 'dua-list' });
        if (state.phase === 'error') {
          list.append(el('div', { className: 'dua-empty' }, t('loadError').replace('{reason}', String(state.listError || 'unknown'))));
          return list;
        }
        if (state.items.length === 0 && state.phase === 'ready') {
          list.append(el('div', { className: 'dua-empty' }, t('empty')));
          list.append(el('div', { className: 'dua-empty-hint' }, t('emptyHint')));
          return list;
        }
        if (state.items.length >= 2 && !state.busyAll) {
          const actions = el('div', { className: 'dua-actions' });
          if (state.confirmAll) {
            const span = el('span', { className: 'dua-confirm-all' }, t('confirmRestoreAll').replace('{n}', String(state.items.length)));
            span.append(el('button', { type: 'button', className: 'dua-btn dua-btn-primary', onClick: restoreAll }, t('confirm')));
            span.append(el('button', { type: 'button', className: 'dua-btn', onClick: () => { state.confirmAll = false; render(); } }, t('cancel')));
            actions.append(span);
          } else {
            actions.append(el('button', { type: 'button', className: 'dua-btn', onClick: () => { state.confirmAll = true; render(); } }, t('restoreAll')));
          }
          list.append(actions);
        }
        const groups = [];
        const seen = new Set();
        for (const it of state.items) {
          const key = it.workspaceTitle || '\u0000';
          if (!seen.has(key)) { seen.add(key); groups.push({ key, label: it.workspaceTitle || t('ungrouped'), items: [] }); }
          groups[groups.length - 1].items.push(it);
        }
        for (const g of groups) {
          const group = el('div', { className: 'dua-group' });
          group.append(el('div', { className: 'dua-group-label' }, g.label));
          for (const it of g.items) group.append(renderItem(it));
          list.append(group);
        }
        if (state.phase === 'loading' && state.items.length === 0) list.append(el('div', { className: 'dua-empty' }, t('previewLoading')));
        return list;
      };

      const renderItem = (it) => {
        const item = el('div', { className: 'dua-item' });
        const row = el('div', { className: 'dua-item-row' });
        const info = el('div', { className: 'dua-item-info' });
        info.append(el('div', { className: 'dua-item-title', title: displayTitle(it) }, displayTitle(it)));
        info.append(el('div', { className: 'dua-item-meta' },
          (it.workspacePath || it.workspaceTitle ? it.workspacePath || it.workspaceTitle + ' · ' : '') +
          (typeof it.createdAt === 'number' ? t('createdAt') + ' ' + fmtTime(it.createdAt) : '')));
        row.append(info);
        const pv = state.previews.get(it.sessionId);
        const expanded = !!(pv && pv.phase === 'ready');
        row.append(el('button', {
          type: 'button', className: 'dua-icon-btn dua-preview-toggle',
          title: expanded ? t('collapse') : t('preview'),
          'aria-label': expanded ? t('collapse') : t('preview'),
          onClick: () => togglePreview(it.sessionId),
        }, expanded ? '▾' : '▸'));
        row.append(el('button', {
          type: 'button', className: 'dua-btn dua-btn-primary dua-restore-btn',
          disabled: state.restoring === it.sessionId,
          onClick: () => restoreOne(it),
        }, state.restoring === it.sessionId ? t('restoring') : t('restore')));
        item.append(row);
        if (state.settings.previewEnabled && pv) item.append(renderPreview(pv.data));
        return item;
      };

      const renderPreview = (data) => {
        const box = el('div', { className: 'dua-preview' });
        if (!data) {
          box.append(el('div', { className: 'dua-preview-meta' }, t('previewLoading')));
          return box;
        }
        if (data.error) {
          const reason = ({ missing: 'missing log', corrupt: 'corrupt log', timeout: 'timeout', unreadable: 'unreadable log' })[data.error.category] || data.error.category;
          box.append(el('div', { className: 'dua-preview-meta dua-preview-error' }, t('previewUnavailable').replace('{reason}', reason)));
          return box;
        }
        const st = data.stats || {};
        if (data.empty) box.append(el('div', { className: 'dua-preview-meta' }, t('previewEmpty')));
        const statText = t('statLine')
          .replace('{u}', String(st.userMessages ?? 0))
          .replace('{a}', String(st.assistantMessages ?? 0))
          .replace('{t}', String(st.toolCalls ?? 0)) +
          (typeof st.lastActivityAt === 'number' ? ' · ' + t('lastActivity') + ' ' + fmtTime(st.lastActivityAt) : '');
        box.append(el('div', { className: 'dua-preview-meta' }, statText));
        for (const m of data.head || []) box.append(el('div', { className: 'dua-preview-msg dua-preview-head' }, m.text));
        if (data.omittedMessages > 0) box.append(el('div', { className: 'dua-preview-meta dua-preview-omit' }, t('previewOmitted').replace('{n}', String(data.omittedMessages))));
        for (const m of data.tail || []) {
          const node = el('div', { className: 'dua-preview-msg' + (m.role === 'assistant' ? ' dua-preview-assistant' : '') }, m.text);
          if (m.role === 'assistant') node.style.opacity = '0.85';
          box.append(node);
        }
        return box;
      };

      const renderSettings = () => {
        const box = el('div', { className: 'dua-settings' });
        box.append(makeToggle('confirmOnArchive', t('settingConfirm'), t('settingConfirmDesc')));
        box.append(makeToggle('showButton', t('settingButton'), t('settingButtonDesc')));
        box.append(makeToggle('previewEnabled', t('settingPreview'), t('settingPreviewDesc')));
        return box;
      };

      const makeToggle = (key, label, desc) => {
        const row = el('div', { className: 'dua-toggle-row' });
        const text = el('div', { className: 'dua-toggle-text' });
        text.append(el('div', { className: 'dua-toggle-label' }, label));
        if (desc) text.append(el('div', { className: 'dua-toggle-desc' }, desc));
        row.append(text);
        const btn = el('button', {
          type: 'button', role: 'switch',
          'aria-checked': state.settings[key] ? 'true' : 'false',
          className: 'dua-toggle' + (state.settings[key] ? ' dua-toggle-on' : ''),
          onClick: () => {
            const next = !state.settings[key];
            state.settings = { ...state.settings, [key]: next };
            api.setSettings({ [key]: next }).catch((e) => warn('settings save failed', e));
            render();
          },
        });
        btn.append(el('span', { className: 'dua-toggle-knob' }));
        row.append(btn);
        return row;
      };

      const renderModal = () => {
        modalBox.textContent = '';
        const c = state.confirm;
        modalBox.append(el('div', { className: 'dua-confirm-title' }, t('confirmTitle')));
        modalBox.append(el('div', { className: 'dua-confirm-session' }, c.title || t('untitled').replace('{id}', String(c.sessionId).slice(-8))));
        modalBox.append(el('div', { className: 'dua-confirm-body' }, t('confirmBody')));
        const actions = el('div', { className: 'dua-confirm-actions' });
        actions.append(el('button', { type: 'button', className: 'dua-btn', autofocus: true, onClick: () => finishConfirm(false) }, t('cancel')));
        actions.append(el('button', { type: 'button', className: 'dua-btn dua-btn-primary', onClick: () => finishConfirm(true) }, t('archive')));
        modalBox.append(actions);
      };

      // ---- actions ----
      const loadList = () => {
        state.phase = 'loading';
        render();
        api.list().then((res) => {
          if (state.disposed) return;
          const r = res || {};
          state.phase = 'ready';
          state.items = Array.isArray(r.items) ? r.items : [];
          state.listError = r.unavailable ? 'unavailable' : null;
          render();
        }).catch((e) => {
          if (state.disposed) return;
          state.phase = 'error';
          state.listError = String((e && e.message) || e);
          render();
        });
      };

      const togglePreview = (sessionId) => {
        const pv = state.previews.get(sessionId);
        if (pv && pv.phase === 'ready') {
          state.previews.delete(sessionId);
          render();
          return;
        }
        state.previews.set(sessionId, { phase: 'loading', data: null });
        render();
        api.preview(sessionId).then((res) => {
          if (state.disposed) return;
          state.previews.set(sessionId, { phase: 'ready', data: res || {} });
          render();
        }).catch((e) => {
          if (state.disposed) return;
          state.previews.set(sessionId, { phase: 'ready', data: { error: { category: 'unreadable', message: String((e && e.message) || e) } } });
          render();
        });
      };

      const restoreOne = (it) => {
        state.restoring = it.sessionId;
        render();
        api.restore(it.sessionId).then((res) => {
          if (state.disposed) return;
          state.restoring = null;
          const ok = res && res.ok;
          setFeedback(ok
            ? t('restoredFeedback').replace('{title}', displayTitle(it))
            : t('restoreFailedFeedback').replace('{title}', displayTitle(it)).replace('{reason}', (res && res.message) || 'unknown'));
          if (ok) loadList();
          else render();
        }).catch((e) => {
          if (state.disposed) return;
          state.restoring = null;
          setFeedback(t('restoreFailedFeedback').replace('{title}', displayTitle(it)).replace('{reason}', String((e && e.message) || e)));
          render();
        });
      };

      const restoreAll = () => {
        state.busyAll = true;
        state.confirmAll = false;
        render();
        api.restoreAll(state.items.map((i) => i.sessionId)).then((res) => {
          if (state.disposed) return;
          state.busyAll = false;
          const r = res || {};
          const n = typeof r.restored === 'number' ? r.restored : 0;
          const failed = Array.isArray(r.failed) ? r.failed : [];
          setFeedback(failed.length
            ? t('restoreAllPartial').replace('{n}', String(n)).replace('{m}', String(failed.length))
            : t('restoreAllDone').replace('{n}', String(n)));
          loadList();
        }).catch((e) => {
          if (state.disposed) return;
          state.busyAll = false;
          setFeedback(String((e && e.message) || e));
          render();
        });
      };

      const setFeedback = (text) => {
        state.feedback = text;
        if (state.feedbackTimer) clearTimeout(state.feedbackTimer);
        const clear = () => { state.feedback = null; if (!state.disposed) render(); };
        state.feedbackTimer = (timer && typeof timer.timeout === 'function')
          ? timer.timeout(clear, 4000)
          : setTimeout(clear, 4000);
        render();
      };

      const finishConfirm = (allowed) => {
        const resolve = state.confirm && state.confirm.resolve;
        state.confirm = null;
        render();
        if (resolve) resolve(allowed);
      };

      // ---- events ----
      fab.addEventListener('click', () => {
        state.open = !state.open;
        if (state.open) {
          state.tab = 'list';
          state.confirmAll = false;
          loadList();
        }
        render();
      });
      modalMask.addEventListener('click', () => finishConfirm(false));
      const onKey = (e) => {
        if (e && e.key === 'Escape') {
          if (state.confirm) finishConfirm(false);
          else if (state.open) { state.open = false; render(); }
        }
      };
      doc.addEventListener('keydown', onKey);
      const onLocale = () => render();
      ctx.on('locale/change', onLocale);

      // ---- settings bootstrap ----
      api.getSettings().then((s) => {
        if (state.disposed || !s || typeof s !== 'object') return;
        state.settings = {
          confirmOnArchive: typeof s.confirmOnArchive === 'boolean' ? s.confirmOnArchive : state.settings.confirmOnArchive,
          showButton: typeof s.showButton === 'boolean' ? s.showButton : state.settings.showButton,
          previewEnabled: typeof s.previewEnabled === 'boolean' ? s.previewEnabled : state.settings.previewEnabled,
        };
        render();
      }).catch((e) => warn('settings load failed (using defaults)', e));

      // ---- archive guard: wrap workspaces.archiveSession (fail-open) ----
      // The workspaces service may not be provided yet when this entry applies
      // (the Loader mounts entries concurrently), so keep retrying until it
      // arrives; a 60s fail-open backstop lets archiving through if the dialog
      // can never be answered.
      const MARK = '__dshUnarchiveGuard';
      const installGuard = () => {
        const workspaces = ctx.get('workspaces');
        if (!workspaces || typeof workspaces.archiveSession !== 'function') return false;
        if (workspaces[MARK]) return true;
        const original = workspaces.archiveSession.bind(workspaces);
        const next = async (sessionId) => {
          if (!state.settings.confirmOnArchive) return original(sessionId);
          const ask = () => new Promise((resolve) => {
            state.confirm = { sessionId, title: null, resolve };
            render();
            api.title(sessionId).then((res) => {
              const c = state.confirm;
              if (c && c.sessionId === sessionId && res && typeof res.title === 'string') {
                state.confirm = { ...c, title: res.title };
                render();
              }
            }).catch(() => { /* keep id suffix fallback */ });
          });
          const allowed = await Promise.race([ask(), timer.timeout(60000).then(() => true)]);
          if (!allowed) return;
          return original(sessionId);
        };
        workspaces[MARK] = { original, next };
        workspaces.archiveSession = next;
        ctx.effect(() => {
          if (workspaces[MARK] && workspaces[MARK].next === next) {
            workspaces.archiveSession = workspaces[MARK].original;
            delete workspaces[MARK];
          }
        });
        return true;
      };
      if (!installGuard()) {
        const iv = setInterval(() => { if (installGuard()) clearInterval(iv); }, 1000);
        ctx.effect(() => clearInterval(iv));
      }

      console.log('[dsh-unarchive] client ready');

      // ---- dispose ----
      return () => {
        state.disposed = true;
        if (state.feedbackTimer) clearTimeout(state.feedbackTimer);
        doc.removeEventListener('keydown', onKey);
        ctx.off('locale/change', onLocale);
        if (shiftObserver) shiftObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        cancelAnimationFrame(layoutRaf);
        if (attached) targets.forEach((node) => node.remove());
        styleTag.remove();
      };
    });
  },
}