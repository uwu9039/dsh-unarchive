# dsh-unarchive

归档会话回收站 · An archived-session recycle bin for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) (DSH).

查看已归档会话、预览内容、恢复到原工作区；另有一个默认关闭的归档二次确认开关。

List archived sessions, preview their content, and restore them to their original workspace. An optional archive confirmation (off by default) is included.

> 独立第三方插件，与 DeepSeek 无隶属关系。Independent third-party plugin, not affiliated with DeepSeek.

---

## 功能 / Features

| 功能 | 说明 |
|---|---|
| 归档列表 | 右下角悬浮按钮打开浮层面板，按工作区分组、组内按创建时间倒序；空态、总数、中英文界面 |
| 内容预览 | 行内展开会话开头与最近消息：第一条用户消息、最近 1–2 条消息文本、消息/工具统计、最后活动时间；单条 ≤200 字符，只提取 `text` 块，不展示工具参数与附件 |
| 单个恢复 | 幂等、存在性校验、串行写入；恢复后侧边栏即时回到原工作区原位置（不刷新页面、多标签页同步） |
| 全部恢复 | 列表 ≥2 条时可用，面板内二次确认，逐个恢复，失败项不整体回滚 |
| 归档二次确认 | 默认关闭；开启后从侧边栏右键归档前弹确认框（Esc / 遮罩 / 取消均可取消）；包装 `workspaces.archiveSession`，fail-open |
| 设置 | 面板「设置」页签：`confirmOnArchive` / `showButton` / `previewEnabled`；即时生效，持久化到 `~/.dsh/unarchive/settings.json` |

## 安装 / Install

已发布到 npm，直接安装：

```bash
dsh plugin --profile web add dsh-unarchive
```

也可以本地打包安装：

```bash
npm pack
dsh plugin --profile web add dsh-unarchive-0.1.8.tgz
```

官方参考：[打包与安装插件 (basic/publish)](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)

## 配置 / Configuration

`cordis.yml` 的 `config:` 块（Schemastery 校验，默认值见 schema）：

```yaml
plugins:
  dsh-unarchive:
    config:
      confirmOnArchive: false   # 归档二次确认（默认关）
      showButton: true          # 显示右下角入口
      previewEnabled: true      # 内容预览
```

## 兼容性 / Compatibility

- 目标 DSH `0.1.0-rc.6`，profile `web`。
- 依赖公开服务：`workspaceRegistry`（`archivedSessionIds` 为公开 API；恢复走 `enqueueOperation` / `requireState` / `setState` / `sessionKnown`，与原生 `archiveSession` 同一串行化队列）、`sessionQuery`（列表/标题/预览）、`webServer`（HTTP API）、客户端 `workspaces` / `locale` / `timer`。
- 任一依赖缺失即相应功能降级，不阻塞原生归档（fail-open）。
- 卸载后仅残留设置文件 `~/.dsh/unarchive/settings.json`，其余由插件清理还原。

## 架构 / Architecture

```
src/index.js   宿主插件：恢复 / 列表 / 预览 / 标题 / 设置 HTTP API（同源 /dsh-unarchive/api/*）
src/client.js  客户端插件：右下角悬浮按钮 + 浮层面板 + 行内预览 + 设置页签
               + 归档二次确认（包装 workspaces.archiveSession）
```

数据流：

```
恢复 → registry.enqueueOperation → requireState → sessionKnown 校验 → setState
     → domain 持久化写 → domain/changed → host-apiproxy watcher
     → host/archived-sessions-changed 推送 → 客户端 store → 侧边栏与面板即时刷新
```

## 边界 / Out of scope

不做删除/清空归档、不做归档内容搜索、不做"恢复并打开"、不兼容 `headless` UI、不展示工具参数与附件。

## 许可 / License

[MIT](./LICENSE)。
