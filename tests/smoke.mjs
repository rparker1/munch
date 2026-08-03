import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = process.env.SHOT_DIR || './shots';
const errors = [];

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
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
await page.waitForTimeout(300);
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

// Persistence across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const persisted = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('munch.state'));
  return { inv: s.inventory.length, days: Object.keys(s.plan).length };
});
console.log('persisted:', JSON.stringify(persisted));

// Dark mode
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(200);
await shot('18-dark-today');
await page.click('[data-view=shop]');
await page.waitForTimeout(250);
await shot('19-dark-shop');
await page.click('[data-view=plan]');
await page.waitForTimeout(250);
await shot('20-dark-plan');

// Empty state: wipe and check
await page.emulateMedia({ colorScheme: 'light' });
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

// horizontal overflow check on every view
for (const v of ['today', 'plan', 'inventory', 'shop']) {
  await page.click(`[data-view=${v}]`);
  await page.waitForTimeout(200);
  const o = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  console.log(`overflow ${v}:`, JSON.stringify(o), o.doc > o.win + 1 ? 'BLEED' : 'ok');
}

// service worker
const sw = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return !!r;
});
console.log('service worker registered:', sw);

console.log('\nERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
