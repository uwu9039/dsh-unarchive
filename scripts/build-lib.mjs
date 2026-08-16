// dsh-unarchive — client bundle builder.
// Transforms src/client.js (raw ESM) into lib/client.js (ModuleLoader format:
// `window.__ModuleLoader__.load({id, factory})`, module.exports carrying the
// cordis plugin shape { name, inject, apply }).
// Usage: node scripts/build-lib.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let src = readFileSync(join(root, 'src', 'client.js'), 'utf8');

// 1) Module-scope name -> factory-scope var (referenced by the object shorthand).
src = src.replace("export const name = 'dsh-unarchive';", 'var name = "dsh-unarchive";');

// 2) Default export object -> plain object literal.
src = src.replace('export default {', 'var plugin = {');

const header = `// dsh-unarchive — client bundle (built artifact, ModuleLoader format).
// Source of truth: ../src/client.js (raw ESM). This file is the built form
// served by the web plugin table: \`window.__ModuleLoader__.load({id, factory})\`
// with \`module.exports\` carrying the cordis plugin (\`name\`/\`inject\`/\`apply\`).
window.__ModuleLoader__.load({
	id: "dsh-unarchive",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`;

const footer = `		exports.name = plugin.name;
		exports.inject = plugin.inject;
		exports.apply = plugin.apply;
		return module.exports;
	}
});
`;

writeFileSync(join(root, 'lib', 'client.js'), header + src + footer);
console.log('lib/client.js rebuilt from src/client.js');
