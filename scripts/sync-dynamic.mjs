// dsh-unarchive — dynamic recovery-body generator.
// Derives dynamic/client-body.js from src/client.js: the packaged ESM form
// and the dynamic Cordis body share one UI implementation; only the module
// wrapper and the host bridge differ (HTTP API vs harness.call).
// Usage: node scripts/sync-dynamic.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let src = readFileSync(join(root, 'src', 'client.js'), 'utf8');

// 1) Module wrapper -> dynamic body wrapper.
src = src.replace("export const name = 'dsh-unarchive';\n", '');
src = src.replace('export default {', 'return {');
src = src.replace(/^  name,\n/m, '');
src = src.replace(/\n\};\s*$/, '\n}');

// 2) Host bridge: HTTP API -> harness.call (settings are local-only in the
//    dynamic host; getSettings resolves null so the client keeps defaults).
const dynamicApi = `    // ---- host bridge (dynamic: package-private harness.call) ----
    const api = {
      list: () => host.call('archived.ids', {}).then((r) => host.call('archived.list', { ids: (r && Array.isArray(r.ids)) ? r.ids : [] })),
      preview: (sessionId) => host.call('archived.preview', { sessionId }),
      restore: (sessionId) => host.call('archived.restore', { sessionId }),
      restoreAll: (ids) => host.call('archived.restore-all', { ids }),
      title: (sessionId) => host.call('session.title', { sessionId }),
      getSettings: () => Promise.resolve(null),
      setSettings: () => Promise.resolve(null),
    };
    // ---- end host bridge ----`;

const bridgeStart = src.indexOf('// ---- host bridge');
const bridgeEnd = src.indexOf('// ---- end host bridge ----');
if (bridgeStart < 0 || bridgeEnd < 0) throw new Error('host bridge markers not found in src/client.js');
const afterBridge = src.indexOf('\n', bridgeEnd);
if (afterBridge < 0) throw new Error('host bridge end marker malformed');
src = src.slice(0, bridgeStart) + dynamicApi + src.slice(afterBridge);

writeFileSync(join(root, 'dynamic', 'client-body.js'), src);
console.log('dynamic/client-body.js regenerated from src/client.js');
