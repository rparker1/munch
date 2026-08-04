import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8765/';
const OUT = process.env.SHOT_DIR || './shots';
const errors = [];

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },   // iPhone 15 Pro
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'en-GB',
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const shot = async name => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot:', name);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// Fail fast and say why. A module-level syntax error leaves the shell blank, and
// every later step then times out on a missing locator, which points nowhere near
// the real cause.
if (errors.length) {
  console.log('BOOT FAILED:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
// Not pinned to an exact number. This check exists to prove the shell came up, and
// hardcoding the tab count meant adding a tab failed here with a message pointing at
// the wrong thing entirely. Whether each individual view renders is covered by the
// layout loop below, which names them.
const tabCount = await page.locator('.tab').count();
if (tabCount === 0) {
  console.log('BOOT FAILED: the tab bar did not render — the app did not start.');
  await browser.close();
  process.exit(1);
}

await shot('01-today');

// tab bar present with 4 tabs
const tabs = await page.locator('.tab').count();
console.log('tabs:', tabs);

// Plan
await page.click('[data-view=plan]');
await page.waitForTimeout(250);
await shot('02-plan');

// Stock
await page.click('[data-view=inventory]');
await page.waitForTimeout(250);
await shot('03-stock');

// Shop
await page.click('[data-view=shop]');
await page.waitForTimeout(250);
await shot('04-shop');

// Tick a shopping line
const before = await page.locator('#viewSub').textContent();
await page.locator('.row__hit').first().click();
await page.waitForTimeout(300);
const after = await page.locator('#viewSub').textContent();
console.log('shop sub:', before, '->', after);
await shot('05-shop-ticked');

// Open a line's details
await page.locator('[data-info]').first().click();
await page.waitForTimeout(350);
await shot('06-line-peek');
await page.click('.sheet__close');
await page.waitForTimeout(300);

// Open the meal editor from Today
await page.click('[data-view=today]');
await page.waitForTimeout(250);
await page.locator('[data-slot=dinner]').click();
await page.waitForTimeout(350);
await shot('07-meal-editor');

// Assign from stock
await page.locator('[data-step=inv]').click();
await page.waitForTimeout(300);
await shot('08-from-stock');
await page.locator('[data-pick]').first().click();
await page.waitForTimeout(250);
await shot('09-picked');
await page.locator('[data-add]').click();
await page.waitForTimeout(300);
await shot('10-back-to-meal');

// Add a to-buy item
await page.locator('[data-step=buy]').click();
await page.waitForTimeout(250);
await page.fill('[name=name]', 'Flat-leaf parsley');
await page.fill('[name=qty]', '1');
await page.locator('[data-chipgroup=category] [data-opt=produce]').click();
await page.locator('[data-add]').click();
await page.waitForTimeout(300);
await shot('11-added-buy');

// Save the meal
await page.locator('[data-save]').click();
await page.waitForTimeout(400);
await shot('12-saved');

// The new buy item should now be on the shopping list
await page.click('[data-view=shop]');
await page.waitForTimeout(300);
const hasParsley = await page.locator('text=Flat-leaf Parsley').count();
console.log('parsley on list:', hasParsley);
await shot('13-shop-with-parsley');

// Inventory item editor
await page.click('[data-view=inventory]');
await page.waitForTimeout(250);
await page.locator('[data-peek]').first().click();
await page.waitForTimeout(350);
await shot('14-item-peek');
await page.locator('[data-edit]').click();
await page.waitForTimeout(400);
await shot('15-item-edit');
await page.click('.sheet__close');
await page.waitForTimeout(300);

// Add stock
await page.locator('#viewActions [data-act=add]').click();
await page.waitForTimeout(350);
await shot('16-add-stock');
await page.click('.sheet__close');
await page.waitForTimeout(250);

// Settings
await page.click('[data-view=today]');
await page.waitForTimeout(200);
await page.locator('#viewActions [data-act=settings]').click();
await page.waitForTimeout(400);
await shot('17-settings');

await page.click('.sheet__close');
await page.waitForTimeout(250);

// Recipes — the collection, with whatever has been imported into it
await page.click('[data-view=recipes]');
await page.waitForTimeout(350);
await shot('24-recipes');

// Persistence across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const persisted = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('munch.state'));
  return { inv: s.inventory.length, days: Object.keys(s.plan).length };
});
console.log('persisted:', JSON.stringify(persisted));

// Dark mode
// dark-only app: colour-scheme emulation removed
await page.waitForTimeout(200);
await shot('18-dark-today');
await page.click('[data-view=shop]');
await page.waitForTimeout(250);
await shot('19-dark-shop');
await page.click('[data-view=plan]');
await page.waitForTimeout(250);
await shot('20-dark-plan');

// Empty state: wipe and check

await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('munch.state'));
  s.inventory = []; s.plan = {}; s.shopping = []; s.library = []; s.planTicks = {};
  localStorage.setItem('munch.state', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);
await shot('21-empty-today');
await page.click('[data-view=shop]');
await page.waitForTimeout(250);
await shot('22-empty-shop');
await page.click('[data-view=inventory]');
await page.waitForTimeout(250);
await shot('23-empty-stock');

// Layout-width check on every view. Comparing scrollWidth to innerWidth is
// useless here: under mobile emulation Chromium widens the *layout* viewport to
// swallow overflowing content and scales the page down, so both numbers grow
// together and the check passes while the real page is zoomed out and the fixed
// tab bar has been pushed off screen. Comparing innerWidth to the device width
// catches it, and listing what pokes past the edge says why.
const DEVICE_W = 393;
for (const v of ['today', 'plan', 'recipes', 'inventory', 'shop']) {
  await page.click(`[data-view=${v}]`, { force: true });
  await page.waitForTimeout(250);
  const o = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const past = [];
    for (const el of document.querySelectorAll('body *')) {
      // Horizontal scrollers are meant to run past the edge.
      if (el.closest('.hstrip')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > W + 0.5 || r.left < -0.5)) {
        past.push(`${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '') || '-'}`);
      }
    }
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    return { innerW: window.innerWidth, innerH: window.innerHeight, barBottom: Math.round(bar.bottom), past: past.slice(0, 6) };
  });
  const zoomed = o.innerW !== DEVICE_W;
  const barOff = o.barBottom > o.innerH + 1;
  const ok = !zoomed && !barOff && !o.past.length;
  console.log(`layout ${v}: innerW=${o.innerW} tabbarBottom=${o.barBottom}/${o.innerH} ${ok ? 'ok' : 'FAIL ' + JSON.stringify(o.past)}`);
  if (!ok) errors.push(`layout ${v}: zoomed=${zoomed} tabbarOffscreen=${barOff} past=[${o.past}]`);
}

// The tab bar must be genuinely tappable by touch, not just present in the DOM.
for (const v of ['plan', 'recipes', 'inventory', 'shop', 'today']) {
  try {
    await page.tap(`[data-view=${v}]`, { timeout: 4000 });
    await page.waitForTimeout(200);
  } catch {
    errors.push(`tab ${v} could not be tapped`);
  }
}
console.log('tab bar tappable:', errors.some(e => e.startsWith('tab ')) ? 'FAIL' : 'ok');

// service worker
const sw = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return !!r;
});
console.log('service worker registered:', sw);

console.log('\nERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
