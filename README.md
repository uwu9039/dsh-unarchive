# dsh-unarchive

归档会话回收站 · An archived-session recycle bin for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) (DSH).

归档不再是黑洞：侧边栏新增「归档会话」入口，一键查看全部已归档会话、按内容预览、点击即恢复到原工作区原位置。附赠一个默认关闭的「归档二次确认」开关。

Archiving is no longer a black hole: a new sidebar entry lists every archived session, previews its content, and restores it back to its original workspace with one click. An optional (off by default) archive confirmation is included.

> 独立第三方插件，与 DeepSeek 无隶属关系。Independent third-party plugin, not affiliated with DeepSeek.

---

## 功能 / Features

| 功能 | 说明 |
|---|---|
| 归档列表 | 侧边栏「归档会话」按钮 → 独立浮层面板，按工作区分组、组内按创建时间倒序；空态、总数、双语界面 |
| 内容预览 (FR-9) | 行内展开：开头第一条用户消息 + 最近 1–2 条消息文本 + 消息/工具统计 + 最后活动时间；单条 ≤200 字符；只提取 `text` 块，**不展示** tool 参数/附件（隐私）；host 内存 LRU（128 条 / 5 分钟）+ 4s 硬超时 |
| 单个恢复 (FR-2) | 幂等、存在性校验、串行化写入，恢复后经原生 `host/archived-sessions-changed` 推送**即时**回到侧边栏原工作区原位置（不刷新页面、多标签页同步） |
| 全部恢复 (FR-3) | ≥2 条启用，面板内二次确认，逐个恢复、失败项不整体回滚 |
| 归档二次确认 (FR-10) | **默认关闭**：开启后在侧边栏右键「归档会话」前弹确认框（含插件名、会话标题、"可恢复"说明；Esc/遮罩/取消均可取消）；包装客户端 `workspaces.archiveSession` 服务方法，不依赖 DOM；fail-open |
| 设置 (FR-7/11) | 面板「设置」页签：`confirmOnArchive` / `showButton` / `previewEnabled`；即时生效；持久化到 `~/.dsh/unarchive/settings.json`（`cordis.yml` config 为安装默认值，文件值优先） |
| 安静性 | 无轮询、无徽标、无自动弹窗；数据同步走原生事件静默更新；卸载即复原（guard 由 effect 解包恢复） |

## 安装 / Install

打包并安装（正式发布前请以官方文档为准）：

```bash
# 1) 打包 tarball
npm pack

# 2) 安装到 web profile
dsh plugin --profile web add dsh-unarchive-0.1.2.tgz
```

官方参考：

- [打包与安装插件 (basic/publish)](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)
- [官方插件脚手架 `pnpm create dsh-plugin`](https://github.com/deepseek-ai/deepseek-harness/discussions/1629)（用它生成工程后，将 `src/` 两文件放入即可）

## 配置 / Configuration

`cordis.yml` 的 `config:` 块（Schemastery 校验，默认值见 schema）：

```yaml
plugins:
  dsh-unarchive:
    config:
      confirmOnArchive: false   # 归档二次确认（默认关）
      showButton: true          # 侧边栏入口
      previewEnabled: true      # 内容预览
```

## 兼容性 / Compatibility

- 目标 DSH `0.1.0-rc.6`，profile `web`。
- 依赖公开服务：`workspaceRegistry`（`archivedSessionIds` 为 README 公开 API；恢复走类公开方法 `enqueueOperation`/`requireState`/`setState`/`sessionKnown`，与原生 `archiveSession` 同一串行化队列，上游若新增官方 `unarchiveSession` 请优先切换）、`sessionQuery`（列表/标题/预览）、`webServer`（HTTP API）、客户端 `slots` / `workspaces` / `locale` / `timer`。
- 任一依赖缺失即相应功能降级，**绝不阻塞原生归档**（fail-open）。
- 卸载后残留：仅设置文件 `~/.dsh/unarchive/settings.json`（如需可手动删除）；其余全部由 effect 复原。

## 架构 / Architecture

```
src/index.js   宿主插件：恢复/列表/预览/标题/设置 HTTP API（同源 /dsh-unarchive/api/*）
src/client.js  客户端插件：侧边栏入口(sidebar.footer.action) + 浮层面板(shell.overlay)
               + 行内预览 + 设置页签 + 归档二次确认(workspaces.archiveSession 包装)
```

数据流：

```
恢复 → registry.enqueueOperation → requireState → sessionKnown 校验 → setState
     → domain 持久化写 → domain/changed → host-apiproxy watcher
     → host/archived-sessions-changed 推送 → 客户端 store → 侧边栏与面板即时刷新
```

面板列表经槽位标准 prop `useWorkspaces((s) => s.archivedSessionIds)` 响应式同步（与原生侧边栏同源）。

## 边界 / Out of scope

不做删除/清空归档、不做归档内容搜索、不做"恢复并打开"、不兼容 `headless` UI、不展示工具参数与附件。

## 原创性与许可 / Originality & License

本插件全部代码为原创实现，仅按公开 API 契约编写（未复制 DSH 源码）；图标为原创内联 SVG；文案为原创措辞。MIT License，详见 [LICENSE](./LICENSE)。
