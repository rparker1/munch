/* The ways into an account, minus the one thing that cannot be tested here.
 *
 * A tapped magic link cannot reach an installed app at all: a Home Screen web app
 * on iOS keeps its own storage, separate from Safari, and iOS will not open an
 * emailed URL into it. So the app offers a code, a pasted link and a transfer code
 * — all of which exchange the token inside the app. This covers the routing and
 * the transfer-code encoding; the calls to Supabase itself need a reachable
 * project, which this sandbox's egress policy denies.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await b.newContext({ viewport:{width:393,height:852}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: '+e.message));
p.on('console', m => { if (m.type()==='error' && !/Failed to load resource|ERR_TUNNEL/.test(m.text())) errs.push('console: '+m.text()); });
await p.goto(BASE, { waitUntil:'networkidle' });
await p.waitForTimeout(500);

const out = [];
const check = (n, pass, d='') => { out.push({n,pass,d}); console.log(`${pass?'PASS':'FAIL'}  ${n}${pass?'':`   [${d}]`}`); };

// signed-out settings shows all three routes
await p.locator('#viewActions [data-act=settings]').click();
await p.waitForTimeout(400);

const signedOut = await p.evaluate(() => ({
  email: !!document.querySelector('[name=email]'),
  transfer: !!document.querySelector('[name=transfer]'),
  send: !!document.querySelector('[data-signin]'),
  // the code/paste step only appears once an email has been requested
  code: !!document.querySelector('[name=code]'),
}));
check('signed out: can ask for an email', signedOut.email && signedOut.send);
check('signed out: transfer code is offered without any email', signedOut.transfer);
check('signed out: the code step is hidden until an email is sent', !signedOut.code, JSON.stringify(signedOut));

// pretend an email was sent, reopen, the code + paste step appears
await p.evaluate(() => localStorage.setItem('munch.pendingEmail', 'me@example.invalid'));
await p.locator('.sheet__close').click();
await p.waitForTimeout(300);
await p.locator('#viewActions [data-act=settings]').click();
await p.waitForTimeout(400);
const pending = await p.evaluate(() => ({
  code: !!document.querySelector('[name=code]'),
  pasted: !!document.querySelector('[name=pasted]'),
  prefilled: document.querySelector('[name=email]')?.value,
}));
check('after sending: a code field appears', pending.code);
check('after sending: pasting the link is offered too', pending.pasted);
check('after sending: the address is remembered', pending.prefilled === 'me@example.invalid', pending.prefilled);
await p.locator('.sheet__close').click();
await p.waitForTimeout(300);

// transfer code round trip, purely local encode/decode
const round = await p.evaluate(() => {
  const { cloud } = window.munch;
  localStorage.setItem('munch.session', JSON.stringify({
    accessToken: 'a.b.c', refreshToken: 'refresh-abc-123',
    expiresAt: Date.now() + 3600e3, userId: 'u1', email: 'me@example.invalid',
  }));
  return { note: 'session forged' };
});

await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const made = await p.evaluate(() => {
  try { return { code: window.munch.cloud.exportTransfer() }; }
  catch (e) { return { err: e.message }; }
});
check('a transfer code can be produced while signed in', !!made.code && made.code.startsWith('munch1:'), JSON.stringify(made));

const decoded = await p.evaluate(code => {
  // Decode it the way signInWithTransfer does, without the network call.
  const b64 = code.slice('munch1:'.length);
  const bytes = Uint8Array.from(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}, made.code || 'munch1:');
check('it carries the refresh token', decoded.rt === 'refresh-abc-123', JSON.stringify(decoded));
check('it is scoped to this project', decoded.ref === 'aaticbarhuvbjmfjtfey', String(decoded.ref));

// a code from another project must be refused
const wrong = await p.evaluate(async () => {
  const blob = JSON.stringify({ v:1, ref:'someotherproject', rt:'x', em:'a@b.c' });
  const code = 'munch1:' + btoa(String.fromCharCode(...new TextEncoder().encode(blob))).replace(/=+$/,'');
  try { await window.munch.cloud.signInWithTransfer(code); return 'accepted'; }
  catch (e) { return e.message; }
});
check('a code from another project is refused', /different Munch project/.test(wrong), wrong);

const junk = await p.evaluate(async () => {
  try { await window.munch.cloud.signInWithTransfer('hello'); return 'accepted'; }
  catch (e) { return e.message; }
});
check('junk is refused with a useful message', /transfer code/.test(junk), junk);

await p.evaluate(() => { localStorage.removeItem('munch.session'); localStorage.removeItem('munch.pendingEmail'); });
const failed = out.filter(r => !r.pass).length;
console.log(`\n${out.length - failed}/${out.length} passed`);
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
process.exit(failed || errs.length ? 1 : 0);
