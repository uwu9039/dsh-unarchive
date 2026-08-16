# 重建步骤（进程重启后）

动态 Cordis 插件定义存在 DSH 进程内存中，**进程重启即消失**。重建方法：

## 方式 A：让 Agent 重建（推荐）

对会话说：「用 `dsh-unarchive/dynamic/host-body.js` 和 `client-body.js` 重建 dsh-unarchive 插件并运行」。

Agent 会执行：
1. `cordis_define`（kind: new，idPrefix `unarc`，`code.host` 取 `host-body.js` 内容，`code.client` 取 `client-body.js` 内容）
2. `cordis_run` 激活（客户端需在 UI 批准一次）

## 方式 B：手动核对

两个文件分别是 cordis_define 的 `code.host` / `code.client` 函数体（不含外层引号），原样粘贴即可。

## 注意

- 重建后 `confirmOnArchive` 等设置回到默认值（动态插件设置存内存）
- 发布版（`../src/index.js` + `../src/client.js`）不受进程重启影响，安装进 profile 后常驻
