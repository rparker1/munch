/* Recipe Edge Function checks.
 *
 * Plain fetch, no Playwright, so this runs with nothing installed. Most of it is
 * the SSRF guards, because that is the part where a mistake matters: the function
 * fetches arbitrary URLs on request, so "refuses to fetch the metadata endpoint"
 * is a more important property than anything about parsing.
 *
 * FN overrides the endpoint, RECIPE_URL the page it tries.
 */

const FN = process.env.FN
  || 'https://aaticbarhuvbjmfjtfey.supabase.co/functions/v1/recipe';

const fails = [];
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!pass) fails.push(name);
};
const call = async qs => {
  const res = await fetch(`${FN}?${qs}`);
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body };
};

console.log(`checking ${FN}\n`);

/* --- guards: every one of these must be refused ------------------------- */
for (const [label, url] of [
  ['plain http', 'http://example.com/recipe'],
  ['loopback', 'https://127.0.0.1/'],
  ['localhost by name', 'https://localhost/'],
  ['private 10/8', 'https://10.0.0.1/'],
  ['private 192.168/16', 'https://192.168.1.1/'],
  ['private 172.16/12', 'https://172.16.0.1/'],
  ['0.0.0.0', 'https://0.0.0.0/'],
  ['a file URL', 'file:///etc/passwd'],
]) {
  const r = await call(`url=${encodeURIComponent(url)}`);
  check(`refuses ${label}`, r.body.reason === 'blocked', `${r.status} ${JSON.stringify(r.body)}`);
}

/* The link-local range is a special case. Cloudflare, in front of supabase.co,
   refuses any request carrying a 169.254.x.x address in its query string before it
   ever reaches the function — verified: all of `169.254.169.254/`,
   `169.254.169.254/latest/meta-data/` and `169.254.1.1/` come back as a Cloudflare
   block page with HTTP 403, not as our JSON.
   So this asserts refusal only, and does NOT claim to exercise our own guard. That
   guard still matters and is still in the code: a *redirect* to a link-local
   address never appears in a query string, so nothing upstream would see it. */
const meta = await call(`url=${encodeURIComponent('https://169.254.169.254/latest/meta-data/')}`);
check('refuses cloud metadata (upstream or ours)', meta.status === 403,
      `HTTP ${meta.status}${meta.body.reason ? ` reason=${meta.body.reason}` : ' (blocked upstream, no JSON body)'}`);

const missing = await call('');
check('rejects a missing url', missing.body.reason === 'bad-request', JSON.stringify(missing.body));

/* --- a page with no Recipe JSON-LD ------------------------------------- */
const bare = await call(`url=${encodeURIComponent('https://example.com/')}`);
check('reports no-recipe on a page without one', bare.body.reason === 'no-recipe',
      JSON.stringify(bare.body));

/* --- a real recipe page ------------------------------------------------ */
const REAL = process.env.RECIPE_URL
  || 'https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya';
const good = await call(`url=${encodeURIComponent(REAL)}`);
if (good.body.ok) {
  const r = good.body.recipe;
  check('returns a name', typeof r.name === 'string' && r.name.length > 0, r.name);
  check('returns ingredient lines', Array.isArray(r.ingredients) && r.ingredients.length > 2,
        `${r.ingredients?.length} lines`);
  check('every line is a non-empty string',
        r.ingredients.every(l => typeof l === 'string' && l.trim().length > 0));
  check('reports the source', !!r.sourceName && r.sourceUrl === REAL, String(r.sourceName));
  check('returns no raw HTML', !JSON.stringify(good.body).includes('<script'));
} else {
  // A live third-party page may bot-block, which is not our bug. Say so loudly
  // rather than failing the suite on someone else's WAF.
  console.log(`SKIP  live recipe page — ${JSON.stringify(good.body)} (set RECIPE_URL to retry)`);
}

/* --- online search via TheMealDB --------------------------------------- */
const search = await call(`q=${encodeURIComponent('chicken')}`);
check('search returns results', search.body.ok && search.body.results?.length > 0,
      `${search.body.results?.length} results`);
check('results carry a numeric id and a name',
      !!search.body.results?.every(r => /^\d+$/.test(r.id) && r.name), '');

const firstId = search.body.results?.[0]?.id;
if (firstId) {
  const looked = await call(`id=${encodeURIComponent(firstId)}`);
  check('lookup returns the same recipe shape as ?url=',
        looked.body.ok && Array.isArray(looked.body.recipe?.ingredients)
        && looked.body.recipe.ingredients.length > 0,
        `${looked.body.recipe?.ingredients?.length} lines`);
  check('lookup credits TheMealDB', looked.body.recipe?.sourceName === 'TheMealDB',
        String(looked.body.recipe?.sourceName));
  // measure and ingredient arrive as separate fields; the function joins them so the
  // client has one parser and one input format whatever the source.
  check('measure and ingredient are joined into one trimmed line',
        !!looked.body.recipe?.ingredients.every(
          l => typeof l === 'string' && l === l.trim() && l.length > 0));
}

const badId = await call('id=not-a-number');
check('a non-numeric id is rejected', badId.body.reason === 'bad-request', JSON.stringify(badId.body));

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
