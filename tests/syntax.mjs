/* Syntax gate for every JS file in the app.
 *
 * `node --check foo.js` is NOT a valid check here: for a .js file Node parses it
 * as CommonJS, whose body is function-wrapped, so constructs that are illegal in
 * an ES module (a stray top-level `return`, for instance) pass silently. Copying
 * each file to .mjs first forces module parsing, which is how the browser reads
 * them. Run it before the browser suites — it is far faster and the error points
 * straight at the line.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, copyFile, rm, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { glob } from 'node:fs/promises';

const run = promisify(execFile);

const files = [];
for await (const f of glob(['js/**/*.js', 'sw.js', 'tests/*.mjs'])) files.push(f);
files.sort();

const dir = await mkdtemp(join(tmpdir(), 'munch-syntax-'));
let failed = 0;

for (const f of files) {
  // sw.js is a classic worker script, not a module — check it as-is.
  const asModule = f !== 'sw.js';
  const target = join(dir, basename(f).replace(/\.m?js$/, '') + (asModule ? '.mjs' : '.js'));
  await copyFile(f, target);
  try {
    await run(process.execPath, ['--check', target]);
    console.log(`ok    ${f}`);
  } catch (err) {
    failed += 1;
    const msg = String(err.stderr || err.message)
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('    at '))
      .slice(0, 4)
      .join('\n      ')
      .replaceAll(target, f);
    console.log(`FAIL  ${f}\n      ${msg}`);
  }
}

await rm(dir, { recursive: true, force: true });
console.log(`\n${files.length - failed}/${files.length} files parse as modules`);

/* Every module must also be in the worker's precache list.
 *
 * sw.js names each file explicitly, so adding a module and forgetting to list it
 * breaks the app *only when offline* — the import fails, and because app.js pulls in
 * the whole graph, nothing boots at all. That is a long way from where the mistake
 * was made, and it is invisible online. Cheap to check statically, so check here. */
const shell = await readFile('sw.js', 'utf8');
const missing = files
  .filter(f => f.startsWith('js/'))
  .filter(f => !shell.includes(`'./${f}'`));

if (missing.length) {
  console.log(`\nFAIL  not in the sw.js precache list — these break an offline boot:`);
  for (const m of missing) console.log(`      ${m}`);
} else {
  console.log(`${files.filter(f => f.startsWith('js/')).length} modules are all precached in sw.js`);
}

process.exit(failed || missing.length ? 1 : 0);
