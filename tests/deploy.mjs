/* Does a deploy actually reach an already-installed app?
 *
 * Serves a copy of the site, loads it so the service worker installs and takes
 * control, then edits the copy on disk the way a deploy would and reloads. The
 * new content must appear. A cache-first asset strategy passes the first load and
 * fails here, which is precisely the bug this guards.
 *
 * Usage: node tests/deploy.mjs   (no server needed — it starts its own)
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};

// Stage the app exactly as the Pages workflow does.
const root = await mkdtemp(join(tmpdir(), 'munch-deploy-'));
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'fonts']) {
  await cp(f, join(root, f), { recursive: true });
}

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    // Mimic GitHub Pages: a short max-age on everything, sw.js included.
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'max-age=600',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
const page = await ctx.newPage();

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `   [${detail}]`}`);
};

/* --- 1. install and take control ---------------------------------------- */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10_000 })
  .catch(() => {});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
check('the service worker is installed and in control', controlled);

/* --- 2. ship a deploy --------------------------------------------------- */
const edit = async (rel, from, to) => {
  const p = join(root, rel);
  const body = await readFile(p, 'utf8');
  if (!body.includes(from)) throw new Error(`deploy test cannot patch ${rel}`);
  await writeFile(p, body.replace(from, to));
};

await edit('css/app.css', '--mint:       #7FD9AE;', '--mint:       rgb(1, 2, 3);');
await edit('js/views/today.js', "title: () => 'Today',", "title: () => 'DEPLOYED',");
// Stamp the build exactly as .github/workflows/pages.yml does. Without this the
// tagged URLs are unchanged and the HTTP cache legitimately answers with the old
// files — so a deploy that forgot to re-stamp would fail here, which is the point.
await edit('sw.js', "const BUILD = 'dev';", "const BUILD = 'deploy2';");

/* --- 3. the running app must pick it up -------------------------------- */
// Two loads by design: the first is still served by the outgoing worker, which
// then updates, activates and reloads the page onto the new assets. That reload
// tears down the execution context, so poll rather than evaluate once.
async function settle(read, want, ms = 12_000) {
  const until = Date.now() + ms;
  let last = '';
  while (Date.now() < until) {
    try {
      last = await read();
      if (last === want) return last;
    } catch { /* the auto-reload destroyed the context; try again */ }
    await page.waitForTimeout(250);
  }
  return last;
}

await page.reload({ waitUntil: 'networkidle' });

const gotCss = await settle(
  () => page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mint').trim()),
  'rgb(1, 2, 3)',
);
check('a stylesheet change reaches an installed app', gotCss === 'rgb(1, 2, 3)', gotCss);

const gotJs = await settle(
  async () => (await page.locator('#viewTitle').textContent()).trim(),
  'DEPLOYED',
);
check('a module change reaches an installed app', gotJs === 'DEPLOYED', gotJs);

/* --- 4. and it still works with the network gone ----------------------- */
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(800);
// Non-zero, not an exact count. The point is that the shell came up from cache with
// the network off; how many tabs there happen to be is a product decision, and pinning
// it made adding one look like an offline-boot regression.
const offlineTabs = await page.locator('.tab').count();
check('the app still boots offline', offlineTabs > 0, `${offlineTabs} tabs`);
await ctx.setOffline(false);

await browser.close();
server.close();

const failed = checks.filter(c => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
