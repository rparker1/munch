/* ==========================================================================
   Recipe helper.

   This exists for one reason: a page served from rparker1.github.io cannot fetch
   a recipe site. CORS forbids it and no client-side arrangement changes that.

   It returns ingredient lines as raw strings and parses none of them. Parsing
   lives in js/recipe.js so it is unit-testable with no network and so a parser fix
   never needs a redeploy.

   Nothing is stored. The function fetches, extracts, returns and forgets — there
   is no cache, no table and no retention question to answer.
   ========================================================================== */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'content-type': 'application/json',
};

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;

const fail = (reason: string, status = 400) =>
  new Response(JSON.stringify({ ok: false, reason }), { status, headers: CORS });

/* Literal hosts we refuse. A hostname that *resolves* to a private address is not
   detectable here — this runtime exposes no DNS — which is why nothing but parsed
   JSON is ever returned and why the size and time caps are hard rather than
   advisory. */
function hostBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;   // cloud metadata
  }
  return false;
}

function checkUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (hostBlocked(u.hostname)) return null;
  return u;
}

/** Follow redirects by hand so every hop is re-checked, not only the input. */
async function safeFetch(start: URL, signal: AbortSignal): Promise<Response> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url.toString(), {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': 'Munch/1.0 (personal recipe importer)', accept: 'text/html' },
    });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    if (!loc) return res;
    const next = checkUrl(new URL(loc, url).toString());
    if (!next) throw new Error('blocked');
    url = next;
  }
  throw new Error('too-many-redirects');
}

/** Read at most MAX_BYTES, refusing while streaming rather than after the fact. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('too-large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Walk JSON-LD for the first Recipe, including inside @graph and arrays. */
function findRecipe(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findRecipe(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isRecipe = type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
  if (isRecipe) return obj;
  return findRecipe(obj['@graph'] ?? null);
}

const firstString = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return firstString(v[0]);
  if (v && typeof v === 'object') return firstString((v as Record<string, unknown>).url);
  return '';
};

const asServes = (v: unknown): number | null => {
  const s = typeof v === 'number' ? String(v) : firstString(v);
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const params = new URL(req.url).searchParams;
  const target = params.get('url');
  if (!target) return fail('bad-request');

  const safe = checkUrl(target);
  if (!safe) return fail('blocked', 403);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await safeFetch(safe, ctrl.signal);
    if (!res.ok) return fail('fetch-failed', 502);
    const html = await readCapped(res);

    let found: Record<string, unknown> | null = null;
    const blocks = html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    );
    for (const b of blocks) {
      try {
        found = findRecipe(JSON.parse(b[1].trim()));
      } catch {
        /* a malformed JSON-LD block is not fatal; try the next one */
      }
      if (found) break;
    }
    if (!found) return fail('no-recipe', 422);

    const ingredients = (Array.isArray(found.recipeIngredient) ? found.recipeIngredient : [])
      .map(String)
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!ingredients.length) return fail('no-recipe', 422);

    const siteName = html.match(
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    )?.[1];

    return new Response(JSON.stringify({
      ok: true,
      recipe: {
        name: firstString(found.name) || 'Imported recipe',
        serves: asServes(found.recipeYield),
        sourceUrl: safe.toString(),
        sourceName: siteName || safe.hostname.replace(/^www\./, ''),
        image: firstString(found.image),
        ingredients,
      },
    }), { headers: CORS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'blocked') return fail('blocked', 403);
    if (msg === 'too-large') return fail('too-large', 413);
    if (msg === 'too-many-redirects') return fail('fetch-failed', 502);
    if (ctrl.signal.aborted) return fail('timeout', 504);
    return fail('fetch-failed', 502);
  } finally {
    clearTimeout(timer);
  }
});
