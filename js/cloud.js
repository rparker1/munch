/* ==========================================================================
   Supabase over plain HTTPS.

   Deliberately no @supabase/supabase-js: the app has no dependencies and no
   build step, and the SDK would have to come from a CDN, which a strictly
   offline-capable PWA cannot rely on. Auth is GoTrue and the data API is
   PostgREST — both are ordinary REST, and only the handful of calls below are
   needed.

   Sign-in is the implicit magic-link flow: request a link, Supabase emails it,
   the link returns to the app with tokens in the URL fragment.
   ========================================================================== */

import { SUPABASE, cloudConfigured } from './config.js';

const SESSION_KEY = 'munch.session';
const TABLE = 'munch_records';

/* --- session ------------------------------------------------------------- */

let session = null;

/** Decode a JWT payload. No verification — the server does that on every call. */
function jwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(part.length + ((4 - (part.length % 4)) % 4), '='));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function store(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private mode — the session just will not survive a reload */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch {
    session = null;
  }
  return session;
}

function adopt(tokens) {
  const claims = jwtPayload(tokens.access_token);
  if (!claims?.sub) throw new Error('Sign-in token could not be read');
  store({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    // expires_in is seconds from now; expires_at (when present) is absolute.
    expiresAt: Number(tokens.expires_at)
      ? Number(tokens.expires_at) * 1000
      : Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    userId: claims.sub,
    email: claims.email || '',
  });
  return session;
}

export const currentUser = () =>
  (session ? { id: session.userId, email: session.email } : null);

export const signedIn = () => !!session;

/* --- auth --------------------------------------------------------------- */

function authHeaders(extra = {}) {
  return { apikey: SUPABASE.anonKey, 'content-type': 'application/json', ...extra };
}

async function readError(res, fallback) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.msg || body.message || body.error_description || body.error || '';
  } catch { /* not JSON */ }
  return new Error(detail || `${fallback} (HTTP ${res.status})`);
}

/**
 * Ask Supabase to email a sign-in link.
 * `redirectTo` must be listed under Authentication → URL Configuration, or
 * Supabase refuses to send the user back.
 */
export async function sendMagicLink(email, redirectTo = linkTarget()) {
  if (!cloudConfigured()) throw new Error('Supabase is not configured');
  const url = `${SUPABASE.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!res.ok) throw await readError(res, 'Could not send the sign-in link');
}

/** Where the emailed link should land: this app, with no route or auth fragment. */
export function linkTarget() {
  return location.origin + location.pathname;
}

/**
 * Pick up tokens from a magic-link return and clean the URL.
 * Returns 'signed-in', 'error', or null when this is an ordinary page load.
 * The app routes on the hash, so the fragment must be cleared either way.
 */
export function consumeAuthRedirect() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!raw || !/access_token=|error=|error_description=/.test(raw)) return null;

  const params = new URLSearchParams(raw);
  const clean = () => history.replaceState(null, '', location.pathname + location.search);

  const err = params.get('error_description') || params.get('error');
  if (err) {
    clean();
    return { status: 'error', message: err.replace(/\+/g, ' ') };
  }

  try {
    adopt({
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token'),
      expires_in: params.get('expires_in'),
      expires_at: params.get('expires_at'),
    });
    clean();
    return { status: 'signed-in', user: currentUser() };
  } catch (e) {
    clean();
    return { status: 'error', message: e.message };
  }
}

/**
 * Sign in with the six-digit code from the email.
 *
 * The most reliable route into an installed app. A Home Screen web app on iOS has
 * its own storage, separate from Safari, and iOS will not open an emailed link
 * into it — so a tapped link can only ever sign Safari in. Typing a code keeps the
 * exchange inside the app, and unlike a link it does not matter which app the
 * email was read in.
 *
 * Needs `{{ .Token }}` in the Magic Link email template (Supabase dashboard →
 * Authentication → Emails), otherwise the email carries only a link.
 */
export async function signInWithCode(email, code) {
  if (!cloudConfigured()) throw new Error('Supabase is not configured');
  const token = String(code || '').replace(/\s+/g, '');
  if (!token) throw new Error('Enter the code from the email');
  if (!email) throw new Error('Enter the email you asked for the code with');

  const res = await fetch(`${SUPABASE.url}/auth/v1/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, token, type: 'email' }),
  });
  if (!res.ok) throw await readError(res, 'That code was not accepted — it may have expired');
  return adopt(await res.json());
}

/** Remember which address a code was sent to, so it need not be retyped. */
const PENDING_KEY = 'munch.pendingEmail';
export function setPendingEmail(email) {
  try { localStorage.setItem(PENDING_KEY, email); } catch { /* private mode */ }
}
export function pendingEmail() {
  try { return localStorage.getItem(PENDING_KEY) || ''; } catch { return ''; }
}
export function clearPendingEmail() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* nothing to do */ }
}

/**
 * Sign in from the text of the emailed link, pasted into the app.
 *
 * Needed because a magic link cannot be relied on to return *into* an installed
 * app: tapping it in Mail opens Safari, and a Home Screen web app does not
 * necessarily share Safari's storage — so the browser ends up signed in while the
 * app it was meant for still shows signed out. Pasting the link keeps the exchange
 * inside whichever context the user is actually looking at.
 *
 * Accepts either shape Supabase produces: a `verify` URL carrying a token, or a
 * URL that already came back with tokens in its fragment.
 */
export async function signInWithPastedLink(text) {
  if (!cloudConfigured()) throw new Error('Supabase is not configured');
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Paste the whole link from the email');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That does not look like a link — paste the whole thing');
  }

  // Already-exchanged tokens in the fragment.
  const frag = new URLSearchParams(url.hash.replace(/^#/, ''));
  if (frag.get('access_token')) {
    return adopt({
      access_token: frag.get('access_token'),
      refresh_token: frag.get('refresh_token'),
      expires_in: frag.get('expires_in'),
      expires_at: frag.get('expires_at'),
    });
  }

  const token = url.searchParams.get('token') || url.searchParams.get('token_hash');
  if (!token) throw new Error('No sign-in token in that link — copy it again from the email');
  const type = url.searchParams.get('type') || 'magiclink';

  const res = await fetch(`${SUPABASE.url}/auth/v1/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ token_hash: token, type }),
  });
  if (!res.ok) throw await readError(res, 'That link could not be used — it may have expired');
  return adopt(await res.json());
}

/* --- moving a session between contexts ---------------------------------- */

const TRANSFER_PREFIX = 'munch1:';

/**
 * A code that carries this session to another context, needing no email.
 *
 * The case it exists for: a Home Screen web app on iOS keeps its own storage,
 * separate from Safari, and iOS will not open an emailed link into it — so signing
 * in from the browser cannot reach the installed app however the link is handled.
 * Copying a code across is the one route that does not involve another email,
 * which matters because Supabase's built-in mail is limited to a couple of
 * messages an hour.
 *
 * It contains the refresh token, so it is as sensitive as a password and is only
 * ever meant to be pasted into your own app.
 */
export function exportTransfer() {
  if (!session?.refreshToken) throw new Error('Nothing to transfer — not signed in');
  const ref = new URL(SUPABASE.url).hostname.split('.')[0];
  const blob = JSON.stringify({ v: 1, ref, rt: session.refreshToken, em: session.email });
  // btoa cannot take multi-byte characters, so go via UTF-8 bytes.
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(blob)));
  return TRANSFER_PREFIX + b64.replace(/=+$/, '');
}

/**
 * Redeem a transfer code.
 *
 * Supabase rotates refresh tokens, so redeeming here may sign the context that
 * produced the code out. For moving a session to where you actually want it, that
 * is the desired outcome rather than a problem.
 */
export async function signInWithTransfer(code) {
  if (!cloudConfigured()) throw new Error('Supabase is not configured');
  const raw = String(code || '').trim();
  if (!raw.startsWith(TRANSFER_PREFIX)) {
    throw new Error('That is not a transfer code — it should start with “munch1:”');
  }

  let data;
  try {
    const b64 = raw.slice(TRANSFER_PREFIX.length);
    const bytes = Uint8Array.from(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')),
                                  c => c.charCodeAt(0));
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('That code is incomplete — copy the whole thing');
  }

  const ref = new URL(SUPABASE.url).hostname.split('.')[0];
  if (data.ref && data.ref !== ref) throw new Error('That code belongs to a different Munch project');
  if (!data.rt) throw new Error('That code has no session in it');

  const res = await fetch(`${SUPABASE.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ refresh_token: data.rt }),
  });
  if (!res.ok) throw await readError(res, 'That code has expired — make a fresh one');
  return adopt(await res.json());
}

async function refresh() {
  if (!session?.refreshToken) throw new Error('Session expired — sign in again');
  const res = await fetch(`${SUPABASE.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!res.ok) {
    store(null);
    throw await readError(res, 'Session expired — sign in again');
  }
  return adopt(await res.json());
}

/** A valid access token, refreshed if it is close to expiring. */
async function token() {
  if (!session) throw new Error('Not signed in');
  if (Date.now() > session.expiresAt - 60_000) await refresh();
  return session.accessToken;
}

export async function signOut() {
  const had = session;
  store(null);
  if (!had) return;
  try {
    await fetch(`${SUPABASE.url}/auth/v1/logout`, {
      method: 'POST',
      headers: authHeaders({ Authorization: `Bearer ${had.accessToken}` }),
    });
  } catch { /* the local session is already gone, which is what matters */ }
}

/* --- records ------------------------------------------------------------ */

async function dataHeaders(extra = {}) {
  return {
    apikey: SUPABASE.anonKey,
    Authorization: `Bearer ${await token()}`,
    'content-type': 'application/json',
    ...extra,
  };
}

/**
 * Everything the server has seen since `sinceIso` (exclusive), oldest first.
 * Filtering on the server's own clock rather than the client's means a device
 * with a wrong clock cannot skip records.
 */
export async function pull(sinceIso = null) {
  const params = new URLSearchParams({
    select: 'kind,id,payload,updated_at,deleted_at,synced_at',
    order: 'synced_at.asc',
    limit: '10000',
  });
  if (sinceIso) params.set('synced_at', `gt.${sinceIso}`);

  const res = await fetch(`${SUPABASE.url}/rest/v1/${TABLE}?${params}`, {
    headers: await dataHeaders(),
  });
  if (!res.ok) throw await readError(res, 'Could not read from Supabase');
  return res.json();
}

/**
 * Upsert records. Each needs { kind, id, payload, updatedAt, deleted }.
 * user_id is sent explicitly rather than defaulted, so the insert policy has
 * something to check and the upsert has a complete primary key.
 */
export async function push(records) {
  if (!records.length) return;
  const userId = session.userId;
  const rows = records.map(r => ({
    user_id: userId,
    kind: r.kind,
    id: r.id,
    payload: r.deleted ? null : r.payload,
    updated_at: r.updatedAt,
    deleted_at: r.deleted ? r.updatedAt : null,
  }));

  const res = await fetch(
    `${SUPABASE.url}/rest/v1/${TABLE}?on_conflict=user_id,kind,id`,
    {
      method: 'POST',
      headers: await dataHeaders({
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw await readError(res, 'Could not write to Supabase');
}

/** The server's clock, so watermarks never depend on the device's. */
export async function serverNow() {
  const res = await fetch(`${SUPABASE.url}/rest/v1/${TABLE}?select=synced_at&limit=1`, {
    headers: await dataHeaders(),
  });
  const date = res.headers.get('date');
  return date ? new Date(date).toISOString() : new Date().toISOString();
}

restore();
