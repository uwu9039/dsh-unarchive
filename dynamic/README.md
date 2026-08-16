# dsh-unarchive — 动态插件重建源（recovery source）

> 动态 Cordis 插件的定义只存在于 DSH 进程内存中：**进程重启后插件即消失**（定义/授权/运行都不保留）。
> 本目录保存重建所需的全部源码。重建步骤见下方 `REBUILD.md`。

- `host-body.js`   — cordis_define 的 `code.host` 函数体（原样粘贴，不含外层引号包装）
- `client-body.js` — cordis_define 的 `code.client` 函数体（原样粘贴，不含外层引号包装）
