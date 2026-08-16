# dsh-unarchive（归档会话恢复）产品需求文档（PRD）

| 项 | 内容 |
|---|---|
| 文档版本 | v0.2（草案，待评审删改；v0.2 新增：归档二次确认 FR-10、官方文档规范依据第 14 节） |
| 产品名称 | dsh-unarchive（归档会话恢复） |
| 形态 | DeepSeek Harness（DSH）宿主插件 + Web 客户端插件双端 bundle |
| 目标 profile | `web`（`headless` 不涉及 UI，可不支持） |
| 目标 DSH 版本 | `0.1.0-rc.6`（与 dsh-airbag 对齐） |
| 文档日期 | 2026-08 |
| 状态 | 待评审 |

---

## 1. 背景与问题定义

### 1.1 问题：归档是不可逆的"黑洞"

DSH 侧边栏的会话右键菜单提供"归档会话"（`menu.archiveSession`），但**全产品没有任何入口可以查看或找回已归档会话**：

- 归档会话被从**所有**列表表面排除：侧边栏分组/平铺列表（`sessionVisible` 过滤）、会话搜索（搜索结果明确"members never match"）；
- 被归档的当前会话会被清除选中，用户当场"丢失"当前上下文；
- 代码层面**不存在取消归档 API**——`WorkspaceRegistry` 只有 `archiveSession`，全代码库 grep `unarchive` 零命中。

用户一旦误归档（手滑、右键错位、习惯性清理），会话就从界面上彻底消失，只能手工编辑持久化存储 JSON 找回。这对高频使用侧边栏整理会话的重度用户是真实的日常事故。

### 1.2 好消息：数据从未丢失（本产品可行性的基础）

调研确认，归档**不删除任何数据**，恢复在机制上天然安全：

- 归档只把 session id 追加进注册表全局集合 `archivedSessionIds`（持久化于 workspace storage domain 的 global JSON）；
- 会话日志（JSONL）、workspace 记账（`sessionIds` 槽位）**全部保留**。`dsh-workspace` 源码注释明确承诺：
  > "Archiving never touches workspace accounting — an archived session keeps its `sessionIds` slot so **unarchiving restores the position**."

即：恢复 = 把 id 从 `archivedSessionIds` 里移除，会话自动回到原工作区的原排序位置。

### 1.3 产品定位

**一句话**：给 DSH 补上"归档会话回收站"——**主功能**是在侧边栏提供安静的"归档会话"入口，一键查看全部已归档会话、按内容预览、点击即恢复（回到原工作区原位置，侧边栏即时刷新）；**附属功能**是可选的归档二次确认（默认关闭，防误归档保险），两者互不打扰。

**与原生及竞品边界**：

| 能力 | 归属 | 定位 |
|---|---|---|
| 查看已归档会话列表 | **本产品新增**（原生无） | **主功能** |
| 恢复（unarchive） | **本产品新增**（原生无 API，需宿主插件补充） | **主功能** |
| 归档二次确认（可配置开关，默认关闭） | **本产品新增**（原生无确认；经客户端 `workspaces` 服务包装实现，见 FR-10） | **附属功能**（默认不干扰原生行为） |
| 归档会话（入口、API、持久化、事件同步） | DSH 原生，本产品只复用，不重写 | — |
| 删除会话 / 清理归档 / 回收站自动过期 | **不做**（原生无删除语义，超范围） | — |

---

## 2. 现状调研结论（事实基础，全部代码核实）

### 2.1 归档机制数据流

```
侧边栏菜单"归档会话"
  → 客户端 workspaces.archiveSession(id)        dsh-client-runtime
  → RPC "workspace.archiveSession"               dsh-host-apiproxy
  → WorkspaceRegistry.archiveSession(id)         dsh-workspace
      → setState({ archivedSessionIds: [...prev, id] })  持久化（storage domain）
  → 事件 host/archived-sessions-changed          host-apiproxy watcher
  → 客户端 installArchived() 更新 store          侧边栏即时隐藏
```

### 2.2 关键代码坐标

| 事实 | 位置 |
|---|---|
| `archivedSessionIds` 状态定义（全局集合，无时间戳，仅 id 数组） | `dsh-workspace/lib/types/spec.js` L36–45 |
| `WorkspaceRegistry` 类；`archivedSessionIds` getter | `dsh-workspace/lib/index.js` L289 / L412 |
| `archiveSession(id)`——唯一的归档写入；无对应 unarchive | `dsh-workspace/lib/index.js` L422 |
| `sessionKnown(id)`——live / header 索引 / 持久化存在性校验 | `dsh-workspace/lib/index.js` L439 |
| `readSessionHeader(id)` / `headers` 索引（id、cwd、createdAt、origin） | `dsh-workspace/lib/index.js` L295 / L720 |
| `setState` / `requireState` / `enqueueOperation`（公开方法，可被插件调用） | `dsh-workspace/lib/index.js` L738 / L742 / L423 |
| RPC 路由 `workspace.archiveSession` | `dsh-host-apiproxy/lib/index.js` L3180 |
| `host/archived-sessions-changed` 自动推送（registry 状态变更即触发，插件无需自己发事件） | `dsh-host-apiproxy/lib/index.js` L3703–3758 |
| 客户端归档 API | `dsh-client-runtime/lib/client.js` L10032 |
| 归档会话被隐藏的 UI 过滤（侧边栏、搜索） | `dsh-client-ui-workspace/lib/client.js` L100 / L246–276 |
| "归档会话"菜单项 | `dsh-client-ui-workspace/lib/client.js` L711–712 |

### 2.3 关键技术结论

1. **恢复无原生 API**：插件宿主端需自行实现"从 `archivedSessionIds` 移除 id"，走 `WorkspaceRegistry` 公开的 `enqueueOperation` / `requireState` / `setState`，复用原生的串行化与持久化语义。
2. **恢复后 UI 自动刷新**：host-apiproxy 的 watcher 监测 registry 状态变化并推送 `host/archived-sessions-changed`，客户端 store 自动更新——**插件无需任何客户端状态注入**，侧边栏即时恢复显示。
3. **恢复后位置还原**：workspace 记账槽位保留，恢复即回到原工作区原排序位置（原生承诺）。
4. **无归档时间戳**：`archivedSessionIds` 只存 id，原生不记录"何时归档"。列表排序只能用会话创建时间（header `createdAt`）与工作区归属。
5. **会话元数据可读**：宿主插件可经 `ctx.workspaceRegistry` 读 header（id/cwd/createdAt）与 workspace 归属；显示标题解析沿用侧边栏同款逻辑（title 事件/回退规则）。
6. **归档动作的唯一客户端入口是服务方法 `ctx.workspaces.archiveSession(id)`**（`WorkspaceRuntime`，`dsh-client-runtime` L10032；UI 侧 `dsh-client-ui-workspace` L2386 也走它）。调用链上**没有任何可拦截的原生事件**（无 bail/serial 分发），因此"归档二次确认"需由客户端插件**包装该服务方法**实现——这是不依赖 DOM 结构的稳定拦截点；`workspaces` 服务缺失时按"可选依赖探测"处理（官方文档 03-services 约定），fail-open 不阻塞归档。

---

## 3. 设计原则（优先级从高到低）

1. **非侵入**：不抢焦点、不打断操作；入口为**侧边栏原生 slot 按钮**（与侧边栏观感一致），面板可一键关闭；确认框可 Esc/点外取消。
2. **安静运行（主功能对日常使用零打扰）**：插件安装后，用户不主动点击就**完全不可见**——无自动弹窗、无轮询通知、无徽标闪烁、无定时任务；面板只在点击按钮后出现，预览只在主动展开时请求；数据刷新走原生事件静默同步。
3. **复用原生通道**：恢复写入走 registry 公开方法与既有事件同步，不注入客户端状态、不改写原生存储结构、不复制会话数据；二次确认只包装原生服务方法，不替换原生实现。
4. **安全兜底**：恢复操作幂等（不在集合内即 no-op）、校验会话存在性（沿用 `sessionKnown` 语义）、未知会话报错不静默。
5. **fail-open**：插件的任何附加功能（确认框、列表、预览）不可用时，**绝不阻塞原生归档**——确认通道故障时直接放行归档（宁可少一道保险，不可卡死用户操作）。
6. **零残留**：插件不新增任何持久化数据；卸载后无文件、无配置、无状态残留（patch 的恢复由 effect 保证）。
7. **双向可读**：列表展示的信息（标题、工作区、时间）与侧边栏一致，不引入第二套展示口径。

---

## 4. 目标用户与场景

| 用户画像 | 典型场景 | 核心诉求 |
|---|---|---|
| 重度多会话用户 | 侧边栏整理时误点"归档"；或归档后想找回某次讨论 | 一键看到归档清单并恢复，不翻存储文件 |
| 归档习惯用户 | 定期把旧会话归档"收起来"，之后想继续其中某段 | 恢复后回到原位置，上下文完整可续聊 |
| 新用户 | 不知道归档去哪了，以为会话被删 | 界面明示"归档 ≠ 删除"，消除恐慌 |

---

## 5. 功能需求

### FR-1 归档会话列表（P0，主功能入口）

- **入口：侧边栏设置按钮旁**（官方 slot `sidebar.settings`，与"设置"按钮同区相邻，视觉完全融入原生侧边栏）：
  - 宽侧边栏：图标 + 文字"归档会话"；折叠侧边栏：仅图标（复用 primitives 的 Icon/Tooltip 组件，与设置按钮同款交互，`wide` 由 slot props 提供）；
  - 按钮**无徽标、无动画、无角标**——保持安静（P2 可选：静态计数角标，默认不加）；
  - slot 被其他插件占用时按 `sidebar.settings` → `sidebar.footer.action` 依次尝试；均不可用则隐藏按钮并 console 警告（恢复功能不可用，不打扰用户）。
- 点击按钮打开**独立浮层面板**（见 FR-1b），列出**全部**已归档会话，每行展示：
  - 会话标题（与侧边栏同款解析；无标题时显示回退标题/会话 id 后缀）；
  - 所属工作区（标题/路径）；
  - 创建时间（header `createdAt`，本地化格式）；
  - 会话类型标记（普通会话 / 子代理会话 origin=subagent 的，**不展示**，与侧边栏口径一致）。
- 排序：按工作区分组，组内按创建时间倒序（与侧边栏默认一致）。
- 空态：无归档会话时显示"没有已归档的会话"，并说明归档入口在侧边栏右键菜单。
- 面板顶部展示归档总数。
- **内容预览入口**：每行提供"预览"展开按钮（▶/▽），点击后行内展开该会话的主要文本内容（见 FR-9），供用户判断"这是不是我想要的会话"后再决定恢复。
- **数据刷新**：打开面板时拉取 + 监听原生 `host/archived-sessions-changed` 静默增量更新（不轮询、无通知）。

### FR-1b 面板形态：独立浮层（P0，已定）

- 面板为**独立浮层**：叠于内容区上方，**不改变侧边栏内容区布局**；位置默认贴合侧边栏右侧弹出（与 DSH 既有浮层/菜单同款层级与阴影），可拖动或固定视用户后续反馈定。
- 打开：点击侧边栏按钮；关闭：Esc / 点击遮罩 / 面板内关闭按钮。
- 面板尺寸：宽约 360–420px、高约 60–80vh，列表可滚动；样式沿用 primitives 与原生 CSS 变量，观感与 DSH 一致。
- 同一时刻仅一个实例；打开时若已有归档确认框等其他插件浮层，按 z-index 正常叠放，互不干扰。

### FR-2 单个恢复（P0）

- 每行提供"恢复"按钮；点击后该会话从 `archivedSessionIds` 移除并立即从列表消失。
- 恢复成功后该行从面板消失，并在面板顶部显示内联反馈"已恢复：<标题>（回到原工作区）"，短暂停留后自动消退——**不弹全局 toast、不弹窗**（保持安静，反馈只在用户主动操作的面板内呈现）。
- 恢复不自动切换当前会话、不改变当前选中（保守原则）。

### FR-3 全部恢复（P0）

- 面板提供"全部恢复"按钮（≥2 条时启用）。
- 点击后弹原生确认（简单 confirm 或面板内二次确认），确认后逐个恢复全部归档会话。
- 过程中任一失败：已成功的保持成功，失败项在面板内标红并提示重试，不整体回滚。

### FR-4 状态一致性（P0）

- 恢复后侧边栏/搜索**即时**可见该会话（依赖原生 `host/archived-sessions-changed` 推送，不刷新页面）。
- 恢复后会话回到原工作区原排序位置（原生承诺，需在验收中断言）。
- 多标签页：另一标签页的归档列表与侧边栏同步刷新（事件是 host 级广播）。

### FR-5 容错与幂等（P0）

- 恢复不存在的会话 id → 明确报错（复用 `WorkspaceUnknownSessionError` 语义），列表照常。
- 重复点击恢复同一会话（快速连点）→ 幂等，不产生重复写入或报错。
- host 路由不可用（webServer 未就绪/非 web profile）→ 按钮隐藏或禁用，不报错刷屏。

### FR-6 界面文案与国际化（P1）

- 中英双语：面板标题"归档会话 / Archived sessions"、按钮"恢复 / Restore"、"全部恢复 / Restore all"、"没有已归档的会话 / No archived sessions"等。
- 与 DSH 既有文案风格一致（参考 `menu.archiveSession` 的"归档会话"）。

### FR-7 配置（P0）

遵循官方《插件配置》规范：插件导出 `Config` 类型 + 同名 Schemastery schema，默认值写在 schema 中；`cordis.yml` 的 `config:` 块可在安装时覆盖（HMR 热替换即时生效）。

- **配置字段**（全部可选，schema 提供默认值）：
  - `confirmOnArchive: boolean`——归档二次确认开关（**附属功能**），**默认 false**（安装插件后不改变任何原生行为；用户可在设置面板主动开启）；
  - `showButton: boolean`——侧边栏按钮显隐，默认 true；
  - `previewEnabled: boolean`——内容预览开关，默认 true（FR-9）。
- **设置面板**：面板内设"设置"页签（与"归档列表"页签并列），提供上述开关；开关变更**即时生效**（不重启），并持久化到插件自己的设置存储（见第 8 节），`cordis.yml` config 作为安装时默认值来源。遵循"唯一配置入口"惯例：确认框内不提供"不再询问"现场开关。

### FR-8 演示与可发现性（P2，可选）

- 面板底部一行小字说明"归档不会删除会话数据"。
- 首次打开时（若存在归档）显示一次性轻提示，说明恢复方式。

### FR-9 主要内容预览，辅助判断（P0）

**目的**：用户面对多个归档会话时，仅凭标题/时间难以判断该恢复哪个；预览展示会话的"主要内容"，让选择有依据。

- **预览内容**（按需加载，点击行内展开）：
  - **开头**：第一条用户消息的文本（会话起点，通常即主题）；
  - **最近动态**：最后 1–2 条用户/助手消息的文本（"这个会话最近在聊什么"）；
  - **统计行**：用户消息条数、助手消息条数、工具调用次数、最后活动时间；
  - **标记**：若会话从未有用户消息（空会话）或仅含工具结果，显示对应空态说明。
- **提取规则**：只提取消息 `content` 中的 `text` 块；**不展示** `tool-call` / `tool-result` 参数与附件内容（噪音大、可能含敏感值，如环境变量、密钥）。工具调用只以"次数"形式呈现。
- **截断与上限**：单条消息文本截断（≤ 200 字符），单次预览总文本 ≤ 4KB；超长取开头 + 最近动态，中间省略并标注"…（中间 N 条消息已省略）"。
- **交互**：预览在行内展开（不弹窗、不跳转），再次点击收起；同一时间可展开多行；预览加载中显示行内骨架/加载态，失败显示"预览不可用（日志缺失/损坏）"并给出原因类别。
- **性能**：预览按需请求，一次只读一个会话；host 侧内存 LRU 缓存（默认 128 条 / TTL 5 分钟），重复展开不重复读盘。
- **隐私**：预览文本仅在请求-响应内存中流转，**不持久化、不进日志**；只从本地会话日志读取。

### FR-10 归档二次确认（P1，附属功能）

**定位**：附属功能、默认关闭。安装插件后**不改变任何原生行为**（归档无确认、无弹窗）；仅在用户于设置面板主动开启后生效。目的：给"归档"动作加一道可选保险，与主功能"可恢复"形成闭环。

- **触发**：开关开启时，用户从侧边栏右键菜单点击"归档会话"（唯一入口，服务方法 `ctx.workspaces.archiveSession`）→ 先弹确认框；开关关闭时**完全跳过**，与原生无差异。
- **确认框内容**：
  - 标题带插件名："dsh-unarchive 归档确认"（明确功能来源，卸载后用户不会困惑"原来的确认框去哪了"）；
  - 会话标题（与侧边栏一致；取不到标题时显示会话 id 后缀）；
  - 说明文案："归档不会删除会话，可在侧边栏 dsh-unarchive 面板中随时恢复"；
  - 按钮：**取消**（默认聚焦）/ **归档**（确认后放行）。
- **交互约束**：确认框为轻量浮层（非系统 `confirm`），支持 Esc 与点击遮罩取消；不抢焦点（确认框获得焦点但不动输入框内容）。
- **开关**：由设置面板与 `cordis.yml` config 的 `confirmOnArchive` 控制（FR-7），默认关闭；**确认框内不提供"不再询问"**（唯一配置入口原则）。
- **fail-open 兜底**：确认框渲染失败、`workspaces` 服务不可用、或插件被部分卸载时，**直接放行归档**（不弹框、不阻塞），仅 console 警告。
- **覆盖范围**：拦截点在客户端服务方法层，覆盖侧边栏菜单等一切走 `ctx.workspaces.archiveSession` 的归档路径；host 侧直接调 registry 的路径（当前不存在 UI 入口）不在拦截范围，文档注明。

### FR-11 设置面板持久化（P0，与 FR-7 配套）

- 设置（`confirmOnArchive` / `showButton` / `previewEnabled`）持久化到插件自己的设置文件（如 `~/.dsh/unarchive/settings.json`，airbag 同款 dataDir 约定），**不写**原生存储；
- `cordis.yml` config 为安装时默认值来源：插件启动时 settings 文件不存在则以 config 初始化；存在则文件值优先（用户面板修改不回写 cordis.yml，避免与 HMR 冲突）；卸载插件后删除设置文件，零残留。

---

## 6. 非功能需求

| 项 | 要求 |
|---|---|
| 性能 | 列表渲染 ≤ 500 条无明显卡顿；恢复操作单次 < 100ms（本地 JSON 写）；列表数据来自 host 内存态 + header 索引，不读全量日志；预览为有界读取（头/尾窗口），单次 < 2s 硬超时，LRU 缓存避免重复读盘；确认框出现 < 50ms（仅开关开启时存在） |
| 观感 | 侧边栏按钮与原生按钮（新建会话/设置）同款组件、图标风格、尺寸与 Tooltip；折叠态仅图标；面板沿用 primitives 与原生 CSS 变量；**不引入与 DSH 主题冲突的自定义样式体系** |
| 安静性 | 安装后零打扰：无自动弹窗、无轮询、无徽标、无定时任务；面板/预览/确认均仅在用户主动触发时出现；数据同步只经原生事件静默更新 |
| 兼容性 | 目标 DSH `0.1.0-rc.6`；仅依赖 cordis 公开 API、slots 服务与 registry 公开方法；**二次确认不依赖任何 DOM 结构/菜单文案**（拦截点在服务方法层）；不依赖任何原生私有字段 |
| 隐私 | 不新增持久化（除设置文件）；不记录任何会话内容；不上传任何数据（纯本地） |
| 健壮性 | host 路由挂载走 `ctx.inject(['webServer'], …)`（airbag 同款，不假设 apply 时已就绪）；所有监听器/节点/样式由 disposer 管理，卸载零副作用；**fail-open**：确认/预览任一环节故障不得阻塞归档 |
| 可维护性 | TypeScript strict、`verbatimModuleSyntax`、`import type`、源码导入带 `.ts` 扩展（沿用 dsh-airbag 约定）；host 逻辑 `src/*.ts`、浏览器逻辑 `src/client/*.tsx`；无默认导出插件入口 |

---

## 7. 技术方案（草案）

### 7.1 包结构与双端形态

```
dsh-unarchive/
├── package.json          # dsh.bundle.patch + dsh.client 声明（airbag 同款）
├── cordis.patch.yml      # 向 profile 注入 host 插件行
├── src/index.ts          # host 插件：注入 ['webServer']，挂路由
├── src/registry.ts       # 恢复逻辑：基于 workspaceRegistry 的窄封装
├── src/routes.ts         # HTTP API：/dsh-unarchive/api/*
└── src/client/
    ├── index.ts          # 客户端插件入口（slot 注入 + 生命周期）
    ├── sidebar-entry.tsx # 侧边栏按钮组件（宽/折叠态）
    ├── panel.tsx         # 面板 UI（归档列表 / 设置页签）
    ├── api.ts            # fetch 封装
    └── archive-guard.ts  # 归档二次确认包装（FR-10，附属功能）
```

### 7.2 宿主端

- **插件声明**：`cordis.patch.yml` 注入 `{ id: unarchive, name: dsh-unarchive }`；`package.json` 的 `dsh.bundle.patch` 指向它（与 dsh-airbag 完全同构）。
- **HTTP API**（同源，前缀 `/dsh-unarchive/api`）：
  - `GET /api/archived` → `{ total, items: [{ sessionId, title, workspaceTitle, workspacePath, createdAt }] }`（host 内存态 + header 索引组装，不读日志体）；
  - `GET /api/archived/:sessionId/preview` → `{ sessionId, stats: { userMessages, assistantMessages, toolCalls, lastActivityAt }, head: [{ role, text, at }], tail: [{ role, text, at }], truncated, error? }`（按需读取该会话日志，提取纯文本块）；
  - `POST /api/restore` body `{ sessionId }` → 恢复单个（幂等）；
  - `POST /api/restore-all` → 逐个恢复，返回 `{ restored: number, failed: [{ sessionId, error }] }`。
- **恢复实现**（`registry.ts`）：经 `ctx.workspaceRegistry` 公开方法执行，语义与原生 `archiveSession` 对齐：

```ts
// 示意（最终以 rc.6 实际签名校准）
const registry = ctx.workspaceRegistry
await registry.enqueueOperation(async () => {
  const state = registry.requireState()
  if (!state.archivedSessionIds.includes(id)) return        // 幂等
  if (!await registry.sessionKnown(id)) throw UnknownSession // 存在性校验
  await registry.setState({
    ...state,
    archivedSessionIds: state.archivedSessionIds.filter((x) => x !== id),
  })
})
```

  写入后 host-apiproxy watcher 自动推送 `host/archived-sessions-changed`，客户端无需额外动作。

### 7.5 预览实现（bounded read，不读全文）

会话日志是 JSONL（首行 header + 事件行），事件类型：`user/message`（`data` 即消息，role=user）、`assistant/message`（`data.message`，role=assistant）、`tool/result`（role=user 的工具结果消息）；消息 `content` 为块数组（`text` / `tool-call` / `tool-result` 块）。预览只取 `text` 块：

- **有界读取**：非压缩日志——只读文件头部窗口（约前 128KB，覆盖会话开头若干事件）与尾部窗口（约尾 64KB，覆盖最近事件），超大文件开销 O(1)；zstd 压缩日志——沿用 `dsh-session-persistence-jsonl` 的帧机制，只解码首帧与尾帧（实现时以 rc.6 实际压缩布局校准；若帧不可独立寻址则退回"只读首帧 + 统计"，绝不整读）。
- **事件遍历**：按事件行解析，保留前 N 条 `user/message` 文本与末尾 N 条 `user/message` / `assistant/message` 文本；`tool-call` 计数，不展开参数；`tool-result` 不计入正文。
- **缓存**：host 内存 LRU（128 条 / TTL 5 分钟），键为 sessionId + 日志 mtime；缓存未命中才读盘。
- **降级**：日志缺失/损坏/解析失败 → 返回结构化 `error` 类别（`missing` / `corrupt` / `unreadable`），前端显示"预览不可用"行内提示，不影响列表与恢复功能。
- **超时**：单次预览硬超时（如 2s），超时返回部分结果 + `truncated: true`。

### 7.3 客户端端

- 客户端插件经 `exports["./client"]` + `dsh.client` 声明加载（airbag 同构）。
- **侧边栏入口（主功能）**：经客户端 slots 服务（`ctx.slots`，`dsh-client-ui-slots`）注入 `sidebar.settings` 槽（宽/折叠态由 slot props `wide` 驱动），按钮组件复用 `@deepseek-ai/dsh-client-ui-primitives` 的 Icon/Tooltip，与设置按钮同款观感。注入方式与原生一致：

```ts
// src/client/sidebar-entry.tsx（示意，以 rc.6 实际签名校准）
import { IconArchiveOutline } from '@deepseek-ai/dsh-client-ui-primitives'  // 具体图标名以包内导出为准
ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
  name: 'sidebar.settings',
}, ArchiveEntryButton))
```

  slot 被占用时按 `sidebar.settings` → `sidebar.footer.action` 降级；均失败则隐藏按钮并 console 警告（不打扰）。
- **面板**：**独立浮层**（FR-1b，叠于内容区上方，不改变侧边栏布局），两个页签——**归档列表**（FR-1/2/3/9）、**设置**（FR-7）。面板为 React 组件（样式沿用 primitives/原生 CSS 变量，保证观感一致）；Esc/点击遮罩关闭。
- 数据流：打开面板时 `GET /api/archived`；点击恢复 → `POST /api/restore` → 成功后本地移除该行 + 面板内联反馈（FR-2，不弹全局 toast）；同时监听 `host/archived-sessions-changed`（经客户端 runtime 的 workspace store，`useWorkspaces(s => s.archivedSessionIds)` 响应式）静默同步列表与侧边栏。
- **安静性保证**：无轮询、无定时器、无后台弹窗；插件未打开面板时只保留一个 slot 按钮与事件监听（监听仅更新内存 store，不产生任何 UI 动作）。

### 7.6 归档二次确认实现（客户端服务包装）

拦截点：客户端 cordis 服务 `workspaces`（`WorkspaceRuntime`，`ctx.reflect.provide("workspaces", …)` 注册）。插件按官方《服务与依赖》教程的**可选依赖探测**模式获取服务（不 `inject`，服务缺失时插件其余功能照常）：

```ts
// src/client/archive-guard.ts（示意，最终以 rc.6 实际签名校准）
export function mountArchiveGuard(ctx: Context, opts: {
  isEnabled(): boolean                 // 读设置（confirmOnArchive）
  confirm(sessionId: string): Promise<boolean>  // 自绘确认框，true=放行
}): () => void {
  const workspaces = ctx.get('workspaces') as { archiveSession?: (id: string) => Promise<void> } | undefined
  if (!workspaces || typeof workspaces.archiveSession !== 'function') return () => {}  // fail-open

  const original = workspaces.archiveSession.bind(workspaces)
  // 防重复包装：HMR 重启/多实例时先解包自己上次的包装
  const wrapped = (workspaces as any).__dshUnarchiveWrapped
  if (wrapped) workspaces.archiveSession = wrapped.original

  const next = async (sessionId: string): Promise<void> => {
    if (!opts.isEnabled()) return original(sessionId)
    try {
      if (!(await opts.confirm(sessionId))) return   // 用户取消 → 不归档
    } catch {
      // fail-open：确认环节异常 → 直接放行归档
    }
    return original(sessionId)
  }
  ;(workspaces as any).__dshUnarchiveWrapped = { original, next }
  workspaces.archiveSession = next

  return () => {                                     // effect disposer
    if ((workspaces as any).__dshUnarchiveWrapped?.next === next) {
      workspaces.archiveSession = (workspaces as any).__dshUnarchiveWrapped.original
      delete (workspaces as any).__dshUnarchiveWrapped
    }
  }
}
```

要点：

- **唯一包装者约定**：通过 `__dshUnarchiveWrapped` 标记自持的 original/next 对，HMR 卸载重装或重复 apply 时先解包自己再重包，不与其他插件（若未来也有包装者）互相覆盖；卸载时 effect 恢复原方法，**零残留**。
- **确认框展示会话标题**：从客户端 sessions store（`useSessions` 同源数据，`list.byId[id]`）取标题，取不到则显示 id 后缀。
- **fail-open**：`ctx.get('workspaces')` 拿不到、`archiveSession` 非函数、确认框异常——全部静默放行原生归档。
- **并发/竞态**：确认期间用户再次触发归档同一会话 → 确认框只保留最新一次（单例确认框），避免堆叠。
- **配置热更新**：`isEnabled()` 每次调用读设置（内存态），设置面板切换即时生效，无需重启（官方 HMR 约定之外的轻量热更新）。

### 7.4 测试

- host 单测（node env）：幂等、未知会话、并发串行化、restore-all 部分失败；
- client 单测（jsdom）：面板渲染、空态、恢复交互、事件同步；
- E2E（可选）：安装 tarball → 归档两个会话 → 面板恢复 → 断言侧边栏即时可见、位置还原。

---

## 8. 数据与存储

| 项 | 说明 |
|---|---|
| 新增持久化 | 仅插件设置文件 `~/.dsh/unarchive/settings.json`（`confirmOnArchive` / `showButton` / `previewEnabled`，airbag dataDir 同款约定）；恢复本身只修改原生 `archivedSessionIds`（既有 storage domain），复用原生原子写与 durability |
| 会话数据 | 恢复操作不读取、不复制、不修改日志体；预览只做有界读（头/尾窗口），不整读日志 |
| 预览缓存 | 仅 host 内存 LRU（128 条 / TTL 5 分钟），进程重启即清空，不落盘 |
| 配置 | `cordis.yml` `config:` 块 = 安装时默认值（Schemastery 校验）；settings.json = 面板修改的运行时值（文件优先）；两者独立，互不回写 |
| 卸载 | 删除插件即完全复原（patch 由 effect 恢复，设置文件随卸载清理），无残留文件/状态 |

---

## 9. 边界与不做（明确排除）

1. 不提供"删除/清空归档"功能（原生无删除语义）。
2. 不修改原生归档入口与存储结构（`archivedSessionIds` 保持纯 id 数组，不自行加时间戳）。
3. 不做归档会话的搜索穿透（原生搜索排除归档；如需可列为 v2 需求，需改 `deriveSearchResults` 或另建索引——成本高，本期不做）。
4. 不做"恢复并打开会话"的一键跳转（P2 候选，本期恢复后不切换当前会话）。
5. 不兼容 `headless` profile 的 UI（无浏览器）。
6. 不自建通知体系：如检测到 dsh-airbag 已安装则复用其 toast，否则用最简 toast，互不依赖、互不冲突。
7. 预览**不展示**工具调用参数、附件、图片与超长正文（只呈现 text 块摘要 + 统计），避免敏感值与噪音；不做"全文浏览/搜索归档会话内容"（需另建索引，成本高，列为 v2 候选）。

---

## 10. 验收标准

| # | 场景 | 期望结果 |
|---|---|---|
| A1 | 安装插件后重启 Web | 侧边栏**设置按钮旁**出现"归档会话"按钮（宽态图标+文字/折叠态仅图标，与设置按钮同款观感）；无归档时打开面板显示空态；**未做任何操作时无任何弹窗/通知/徽标** |
| A2 | 侧边栏归档 1 个会话 → 打开面板 | 列表出现该会话，标题/工作区/创建时间正确 |
| A3 | 点击"恢复" | 面板该行消失；侧边栏**不刷新页面**即出现该会话，且位于原工作区原位置 |
| A4 | 归档 3 个会话 → "全部恢复" | 3 条全部回到侧边栏原位置；面板回到空态；toast 汇总提示 |
| A5 | 对已归档 id 重复调 restore（连点/重放） | 幂等成功，无报错、无重复行 |
| A6 | 手工删掉会话日志后再恢复该 id | 返回明确错误，插件不崩溃，列表其余项正常 |
| A7 | 卸载插件 | 归档会话保持原状（仍隐藏）；无残留文件；DSH 其余功能不受影响 |
| A8 | 双标签页同时打开 | 一侧恢复，另一侧侧边栏与面板同步更新 |
| A9 | 归档一个含多轮对话的会话 → 展开预览 | 显示开头第一条用户消息、最近 1–2 条消息文本、消息/工具统计；无 tool 参数与附件内容；总文本 ≤ 4KB |
| A10 | 对超大日志会话展开预览 | 有界读取生效（接口耗时 < 2s，响应带 `truncated` 标记）；LRU 缓存下第二次展开不读盘（可观察 host 日志无第二次文件读） |
| A11 | 手工删除某会话日志后展开其预览 | 显示"预览不可用（日志缺失）"，列表与恢复功能不受影响；对该会话恢复仍返回明确错误 |
| A12 | 默认安装（确认开关关闭）→ 侧边栏点"归档会话" | **不弹任何确认框**，行为与未安装插件完全一致（原生直接归档） |
| A12b | 设置面板开启 `confirmOnArchive` → 再归档 | 弹确认框，标题含"dsh-unarchive 归档确认"，显示会话标题与"可恢复"说明；Esc/点遮罩/取消 → 不归档，会话仍在侧边栏；点"归档" → 正常归档并隐藏 |
| A13 | 设置面板关闭 `confirmOnArchive` → 再归档 | 不弹确认框，直接归档；设置面板切换即时生效（不重启、不刷新页面） |
| A14 | 卸载插件（或确认框渲染抛错）后归档 | 不弹框、不阻塞，归档正常完成（fail-open）；console 至多一条警告；卸载后无残留（再次安装无重复确认框） |
| A15 | 侧边栏宽/折叠两种形态 + 面板为独立浮层 | 按钮两种形态渲染正确、与设置按钮视觉一致；点击打开**独立浮层面板**（叠于内容区上方，侧边栏布局不变），Esc/点遮罩关闭；关闭后界面恢复原状，无残留节点/样式 |

---

## 11. 里程碑

| 里程碑 | 内容 | 交付物 |
|---|---|---|
| M1 核心闭环 | host 路由（列表/预览/单个恢复/全部恢复）+ 客户端侧边栏入口/面板/空态/toast | 可安装 tarball，A1–A5、A15 通过 |
| M2 体验完善 | 行内预览展开（FR-9 完整）、设置页签与持久化（FR-7/11）、归档二次确认（FR-10，默认关闭）、中英双语、部分失败提示、双标签页同步验证 | A6–A14 通过 |
| M3 打磨发布 | 单测补全（含预览有界读取与缓存、archive-guard 包装/解包）、README 中英、版本号 1.0.0、npm 发布准备 | 发布包 + 文档 |

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `enqueueOperation` / `setState` / `requireState` 是公开方法但非官方扩展点，上游版本可能改名/私有化 | 插件在升级后失效 | 锁定 rc.6；将 registry 访问收敛到 `registry.ts` 单文件窄接口；上游若原生新增 `unarchiveSession`，优先切换到官方 API（PRD 已预留） |
| 恢复写入与原生操作并发 | 状态竞争 | 一律走 `enqueueOperation` 串行化（与原生 `archiveSession` 同一队列） |
| 显示标题与侧边栏口径不一致 | 用户困惑 | 复用同款解析逻辑；验收 A2 断言标题一致 |
| 无归档时间戳 | 列表信息有限 | 明示排序依据为创建时间；不伪造归档时间；预览的 `lastActivityAt`（最后活动时间）可部分弥补"多久没动"的判断需求 |
| 与侧边栏其他插件的 slot 冲突 | 按钮不显示或重复 | 注入按 `sidebar.settings` → `sidebar.footer.action` 降级探测；register 前先探测槽占用（slots 服务支持探测）；冲突则隐藏按钮并 console 警告，不影响其他功能 |
| 上游侧边栏结构调整（slot 改名/移除） | 入口失效 | 入口代码收敛到 `sidebar-entry.tsx` 单文件；slot 不可用时隐藏按钮（fail-open），不报错刷屏；锁定 rc.6 并在 README 记录兼容基线 |
| 预览读盘并发（多个展开同时请求） | IO 抖动 | 预览接口并发上限（如同时 ≤ 4）；LRU 缓存；超时降级返回部分结果 |
| zstd 压缩日志帧不可独立寻址 | 无法尾窗读取 | 退回"仅首帧 + 统计行"降级预览；明确标注"长会话仅显示开头" |
| `workspaces.archiveSession` 包装与 HMR/其他插件冲突 | 重复确认框 / 互相覆盖 / 卸载后残留 | 唯一包装者约定（`__dshUnarchiveWrapped` 标记 + 先解包后重包）；卸载恢复原方法；单测覆盖"装→卸→装"与"双实例"场景 |
| 原生未来在归档路径上加事件/改方法签名 | 拦截点失效或误拦 | 拦截实现探测方法签名与 `ctx.get('workspaces')` 存在性；任何探测失败即 fail-open 放行；锁定 rc.6 并在 README 记录上游兼容基线 |
| 确认框实现引入 React 依赖冲突 | 构建/运行冲突 | 确认框用原生 DOM + 插件自带最小样式（与 airbag 面板同思路），不引入额外运行时依赖 |
| 用户误以为"确认框=原生功能" | 卸载后归档无确认而困惑 | 确认框文案含插件名（"dsh-unarchive 归档确认"），README 说明卸载即恢复原生行为 |

---

## 13. 待确认问题（评审项）

1. 产品名：`dsh-unarchive`（倾向）/ `dsh-archive-restore` / `dsh-restore-archive`？
2. FR-8"首次打开提示"与 FR-3 的确认弹窗形态（面板内二次确认 vs 系统 confirm）？
3. "恢复并打开"（P2）本期是否要？
4. 是否需要 `headless` 下的 CLI 恢复命令（`dsh unarchive <id>`）作为扩展？
5. 预览交互：行内展开（文档默认，多行可同时展开）vs 单行手风琴 vs 右侧详情栏？
6. 预览是否包含**工具调用摘要**（如"执行了 12 次文件写入 / 3 次 bash"的按工具类别计数），还是仅保留总次数（文档默认仅总数）？

---

## 14. 官方文档规范依据（v0.2 新增）

本产品设计与实现遵循 DeepSeek Harness 官方开发者文档（本文档定稿时已逐篇核实）：

| 官方文档 | 本产品遵循的条款 |
|---|---|
| [插件配置（develop/basic/config）](https://deepseek-harness.github.io/deepseek-harness/develop/basic/config) | 导出 `Config` 类型 + 同名 Schemastery schema；默认值写在 schema；`cordis.yml` `config:` 块传值并在加载时校验；"无硬编码可调参数"（`confirmOnArchive` / `showButton` / `previewEnabled` 全部配置化）；"配置错误要响亮"；配合 HMR（配置变更热替换） |
| [编写第一个插件（cordis-tutorial/01-first-plugin）](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/01-first-plugin) | 函数形态插件 + `name` 元数据 + `apply(ctx)`；不写框架启动代码，插件只描述贡献 |
| [打包与安装插件（develop/basic/publish）](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish) | bundle manifest：`dsh.bundle.patch` → `cordis.patch.yml`，插件行按包名引用（与 dsh-airbag 同构）；`dsh plugin --profile <name> add <tarball>` 安装流程 |
| [生命周期与 effect（cordis-tutorial/02）](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/02-lifecycle-and-effects) | 所有注册（路由、监听器、patch、DOM）均为 effect，卸载/HMR 时自动清理——二次确认的"解包恢复"与面板销毁依赖此语义 |
| [服务与依赖（cordis-tutorial/03）](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/03-services) | `inject` 硬依赖 vs **可选依赖探测**（`ctx.get(...)` + 判空，功能缺失时插件照常运行）——归档确认采用探测模式实现 fail-open |
| [事件（cordis-tutorial/04 与 framework/events）](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/04-events) | 事件命名空间 `namespace/action`；bail/serial 短路语义——调研结论：原生归档路径**无**可拦截事件，故确认采用服务方法包装（FR-10），若上游未来提供 `workspace/archive-request` 类 bail 事件则优先切换 |
| [配置（cordis-tutorial/05）](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/05-config) | 与 basic/config 一致；`apply` 始终收到完整且经校验的配置；无效配置加载失败并明确报错 |
| [组合与 HMR（cordis-tutorial/06）](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/06-composition-and-hmr) | 配置变更触发插件卸载+重装；包装者"先解包后重包"保证 HMR 后不产生重复确认框 |
| [进入 harness（cordis-tutorial/07）](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/07-into-the-harness) | 通过 `inject` 等待服务就绪；`ctx.on('tools/result')` 观察模式——宿主插件访问 `workspaceRegistry` / `webServer` 的方式同源 |

> 注：官方文档站还有 framework/service、basic/tool、practice/llm-adapter 等章节，与本产品相关性低，仅作背景阅读，不构成设计约束。侧边栏 UI 注入遵循 DSH 原生 **slots 服务**（`dsh-client-ui-slots` / `dsh-client-ui-sidebar` 的 `sidebar.settings` 槽，代码核实），该机制尚未收录于文档站，属源码级规范；其余设计均以文档站条款为准。
