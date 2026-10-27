/**
 * Screenshots for docs/USER_GUIDE.md, taken from the running app with clean sample data.
 *   ..\.venv\Scripts\python scripts\guide_demo.py --setup
 *   node scripts/capture-guide.mjs            (dev servers: Vite :5173 → Django :8000)
 *   ..\.venv\Scripts\python scripts\guide_demo.py
 * Env: KC_BASE_URL, KC_BROWSER. Output: ../docs/user-guide/img/*.jpg
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const OUT = '../docs/user-guide/img';
const PASS = 'Guide-Demo-Pass-2026';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: BROWSER });
const shots = [];

async function session(username) {
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 820 } })
  ).newPage();
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.setItem('kc.lang', 'fa'));
  await page.fill('#username', username);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  return page;
}

/** Open a URL (or keep the page), wait for it to settle, save a JPEG. */
async function shot(page, name, { url, ready, full = false } = {}) {
  if (url) await page.goto(`${BASE}${url}`);
  if (ready) await page.locator(ready).first().waitFor({ timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600); // drawers slide in, charts animate
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 80, fullPage: full });
  shots.push(name);
  console.log('saved', name);
}

// ---------------------------------------------------------------- login page
const anon = await (await browser.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
await shot(anon, 'login', { url: '/login', ready: '#username' });

// ---------------------------------------------------------------- branch manager
const mgr = await session('guide_mgr');
await shot(mgr, 'mgr-dashboard-no-rate', { ready: '[data-testid=greeting]' });
await mgr.goto(`${BASE}/transactions`);
await mgr.click('[data-testid=open-rate-dialog]');
await mgr.fill('[data-testid=today-rate-input]', '70.50');
await shot(mgr, 'mgr-rate-dialog', { ready: '[data-testid=today-rate-dialog]' });
await mgr.click('[data-testid=today-rate-save]');
await mgr.waitForTimeout(1200);
await shot(mgr, 'mgr-dashboard', { url: '/dashboard', ready: '[data-testid=net-profit-chart]' });
await shot(mgr, 'mgr-transactions', { url: '/transactions', ready: 'tbody tr' });
await shot(mgr, 'mgr-trade-type', {
  url: '/transactions/new',
  ready: '[data-testid^=trade-card-]',
});
const txId = await mgr.evaluate(async () => {
  const r = await fetch('/api/transactions/?search=KC-1405-101', {
    headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
  });
  return (await r.json()).results[0].id;
});
await shot(mgr, 'mgr-transaction-form', {
  url: `/transactions/${txId}/edit`,
  ready: '[data-testid=tx-form]',
  full: true,
});
await shot(mgr, 'mgr-transaction-detail', {
  url: `/transactions/${txId}`,
  ready: '[data-testid=tx-detail]',
  full: true,
});
await shot(mgr, 'mgr-hawala', { url: '/finance/hawala', ready: 'tbody tr' });
await shot(mgr, 'mgr-hawala-new', { url: '/finance/hawala/new', ready: '[role=dialog] input' });
await shot(mgr, 'mgr-office-expenses', { url: '/finance/office-expenses', ready: 'tbody tr' });
await shot(mgr, 'mgr-income-statement', {
  url: '/reports/income-statement',
  ready: '[data-testid^=statement-line]',
  full: true,
});

// ---------------------------------------------------------------- super admin
const admin = await session('guide_admin');
await shot(admin, 'admin-dashboard', { ready: '[data-testid=branch-comparison]', full: true });
await shot(admin, 'admin-branches', { url: '/admin/branches', ready: 'tbody tr' });
await shot(admin, 'admin-branch-new', { url: '/admin/branches/new', ready: '[role=dialog] input' });
await shot(admin, 'admin-users', { url: '/admin/users', ready: 'tbody tr' });
await shot(admin, 'admin-user-new', { url: '/admin/users/new', ready: '[role=dialog] input' });
await shot(admin, 'admin-rates', { url: '/admin/exchange-rates', ready: 'tbody tr' });
await shot(admin, 'admin-statement-lines', { url: '/admin/statement-lines', ready: 'tbody tr' });

await browser.close();
console.log(`\n${shots.length} screenshots in ${OUT}`);
