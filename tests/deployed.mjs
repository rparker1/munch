/* Is the live site serving what the workflow stages?
 *
 * deploy.mjs proves the cache-busting *mechanism* works, but it serves its own
 * staged copy locally — so it cannot notice that production is not wired to use
 * it. This repo spent a long time with Pages set to "deploy from a branch",
 * publishing the raw tree: sw.js shipped with BUILD = 'dev', the ?b= tag never
 * changed, and an installed app could keep booting the previous version for ten
 * minutes after every deploy while the workflow reported success.
 *
 * Plain fetch, no Playwright, so this runs with nothing installed. Point it
 * somewhere else with LIVE=<url>.
 */

const BASE = (process.env.LIVE || 'https://rparker1.github.io/munch/').replace(/\/?$/, '/');

const fails = [];
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!pass) fails.push(name);
};

/* A query the CDN has never seen, so we read the deploy rather than a cached copy. */
const bust = () => `?t=${process.hrtime.bigint()}`;
const get = async path => {
  const res = await fetch(`${BASE}${path}${bust()}`, { cache: 'no-store' });
  return { status: res.status, body: res.ok ? await res.text() : '' };
};
const status = async path => (await fetch(`${BASE}${path}${bust()}`, {
  method: 'HEAD', cache: 'no-store',
})).status;

console.log(`checking ${BASE}\n`);

/* --- 1. the build stamp must be a real commit, not the checked-in default --- */
const sw = await get('sw.js');
check('sw.js is served', sw.status === 200, `HTTP ${sw.status}`);
const stamp = sw.body.match(/const BUILD = '([^']*)'/)?.[1];
check('sw.js carries a build stamp', !!stamp, `BUILD='${stamp ?? ''}'`);
check("the stamp is not the 'dev' placeholder", stamp !== 'dev',
      stamp === 'dev'
        ? "Pages is serving the raw tree, not the workflow artefact — check Settings -> Pages -> Source"
        : `BUILD='${stamp}'`);

/* --- 2. everything the app needs to boot ---------------------------------- */
for (const p of [
  'index.html', 'css/app.css', 'js/app.js', 'js/store.js',
  'manifest.webmanifest', 'fonts/plus-jakarta-sans-latin-var.woff2',
]) {
  check(`serves ${p}`, await status(p) === 200);
}

/* --- 3. repo furniture must NOT be public -------------------------------- */
/* These are 200 exactly when the raw tree is being published instead of _site,
   which is the same fault as a 'dev' stamp seen from the other end. */
for (const p of ['tests/smoke.mjs', 'tools/make-icons.py']) {
  const s = await status(p);
  check(`does not serve ${p}`, s === 404, `HTTP ${s}`);
}

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
