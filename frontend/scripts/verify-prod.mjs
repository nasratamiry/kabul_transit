/**
 * Stage 15: checks that only make sense against the production stack (docker compose), not the
 * dev servers. Run by scripts/prod_local_test.ps1 after the first super admin exists:
 *   node scripts/verify-prod.mjs <screenshot-dir>
 * Env: KC_BASE_URL (default http://localhost:8080 = nginx of docker-compose.local.yml),
 *      KC_ADMIN_USER / KC_ADMIN_PASS (the first super admin), KC_BROWSER.
 *
 * It does the first-run steps through the UI (log in, create the first branch), then checks:
 * built SPA + history fallback, cache headers, gzip, security headers (SPA and API), DEBUG off,
 * /media/ closed, documents only through the authenticated X-Accel download, health endpoint,
 * and that the per-user throttle is shared by all gunicorn workers (Redis). Everything it creates
 * besides the first branch is deleted again (the exchange rate too: stage 10 needs none today).
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = (process.env.KC_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const SHOTS = process.argv[2] ?? 'prod-screenshots';
const ADMIN = [process.env.KC_ADMIN_USER, process.env.KC_ADMIN_PASS];
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!ADMIN.every(Boolean)) {
  console.error('Set KC_ADMIN_USER and KC_ADMIN_PASS (the first super admin)');
  process.exit(2);
}
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(id, name, ok, info = '') {
  results.push({ id, name, ok: Boolean(ok), info: String(info).slice(0, 300) });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${id}. ${name}${info ? '  — ' + String(info).slice(0, 220) : ''}`,
  );
}
async function step(id, name, fn) {
  try {
    await fn();
  } catch (err) {
    check(id, name, false, `threw: ${err.message.split('\n')[0]}`);
  }
}

let token = null;
async function api(method, path, body, { auth = true, raw = false, headers = {} } = {}) {
  const isForm = body instanceof FormData;
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    redirect: 'manual',
  });
  if (raw) return r;
  const text = await r.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, data, headers: r.headers };
}
const header = (r, name) => r.headers.get(name) ?? '';
const SECURITY = [
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'content-security-policy',
];
const hasSecurityHeaders = (r) =>
  header(r, 'x-content-type-options') === 'nosniff' &&
  header(r, 'x-frame-options') === 'DENY' &&
  header(r, 'referrer-policy') === 'same-origin' &&
  header(r, 'content-security-policy').includes("frame-ancestors 'none'") &&
  header(r, 'content-security-policy').includes("script-src 'self'");

const browser = await chromium.launch({ executablePath: BROWSER });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const created = { branchId: null, userId: null, rateId: null, txId: null, docId: null };

// ---------------------------------------------------------------- first run, through the UI
await step(1, 'First super admin logs in through the built app (nginx)', async () => {
  await page.goto(`${BASE}/login`);
  await page.fill('#username', ADMIN[0]);
  await page.fill('#password', ADMIN[1]);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  token = await page.evaluate(() => localStorage.getItem('kc.access'));
  await page.screenshot({ path: `${SHOTS}/01-dashboard.png` });
  check(1, 'First super admin logs in through the built app (nginx)', Boolean(token), page.url());
});

await step(2, 'First branch created through the UI (172 fields), seen by the API', async () => {
  await page.goto(`${BASE}/admin/branches`);
  await page.click('[data-testid=add-branch]');
  await page.waitForURL('**/admin/branches/new');
  await page.fill('input[name=name]', 'بندر اول');
  await page.fill('input[name=code]', 'first');
  await page.fill('input[name=city]', 'کابل');
  await page.click('[data-testid=drawer-submit]');
  await page
    .locator('div[role=status]', { hasText: 'بندر اول' })
    .first()
    .waitFor({ timeout: 10000 });
  const toast = await page
    .locator('div[role=status]', { hasText: 'بندر اول' })
    .first()
    .textContent();
  await page.waitForURL(/\/admin\/branches$/);
  await page.screenshot({ path: `${SHOTS}/02-first-branch.png` });
  const found = await api('GET', '/branches/?search=FIRST');
  created.branchId = found.data[0]?.id;
  check(
    2,
    'First branch created through the UI (172 fields), seen by the API',
    created.branchId && found.data[0].code === 'FIRST' && toast.includes('۱۷۲'),
    toast,
  );
});

// ---------------------------------------------------------------- nginx: SPA, cache, gzip, headers
await step(
  3,
  'SPA: deep link served index.html (history fallback), no-cache, security headers',
  async () => {
    const r = await fetch(`${BASE}/transactions/123/edit`);
    const html = await r.text();
    check(
      3,
      'SPA: deep link served index.html (history fallback), no-cache, security headers',
      r.status === 200 &&
        html.includes('<div id="root">') &&
        header(r, 'cache-control') === 'no-cache' &&
        hasSecurityHeaders(r) &&
        !header(r, 'strict-transport-security'), // HSTS only over HTTPS
      SECURITY.map((h) => `${h}=${header(r, h).slice(0, 40)}`).join(' | '),
    );
  },
);

await step(
  4,
  'Hashed bundle: immutable 1-year cache + gzip; unknown asset 404 (not index.html)',
  async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    const js = html.match(/\/assets\/[^"]+\.js/)[0];
    const r = await fetch(`${BASE}${js}`, { headers: { 'Accept-Encoding': 'gzip' } });
    await r.arrayBuffer();
    const missing = await fetch(`${BASE}/assets/does-not-exist.js`);
    check(
      4,
      'Hashed bundle: immutable 1-year cache + gzip; unknown asset 404 (not index.html)',
      r.status === 200 &&
        header(r, 'cache-control').includes('immutable') &&
        header(r, 'cache-control').includes('max-age=31536000') &&
        header(r, 'content-encoding') === 'gzip' &&
        missing.status === 404,
      `${js} cache=${header(r, 'cache-control')} enc=${header(r, 'content-encoding')} missing=${missing.status}`,
    );
  },
);

await step(5, 'API responses carry Django security headers (XFO, CSP, nosniff, COOP)', async () => {
  const r = await api('GET', '/auth/me/');
  check(
    5,
    'API responses carry Django security headers (XFO, CSP, nosniff, COOP)',
    r.status === 200 &&
      hasSecurityHeaders(r) &&
      r.headers.get('cross-origin-opener-policy') === 'same-origin',
    SECURITY.map((h) => `${h}=${(r.headers.get(h) ?? '').slice(0, 40)}`).join(' | '),
  );
});

await step(
  6,
  'DEBUG off: unknown API URL = short 404 (no debug page), JSON only (no browsable API)',
  async () => {
    const notFound = await api('GET', '/no-such-endpoint/', null, {
      headers: { Accept: 'text/html' },
    });
    const browsable = await api('GET', '/branches/', null, { headers: { Accept: 'text/html' } });
    const body = typeof notFound.data === 'string' ? notFound.data : JSON.stringify(notFound.data);
    check(
      6,
      'DEBUG off: unknown API URL = short 404 (no debug page), JSON only (no browsable API)',
      notFound.status === 404 &&
        !/DEBUG|Traceback|urlpatterns|URLconf/i.test(body) &&
        body.length < 400 &&
        browsable.headers.get('content-type').startsWith('application/json'),
      `404 body=${body.slice(0, 80)} | browsable=${browsable.headers.get('content-type')}`,
    );
  },
);

await step(7, 'Admin panel and its static files (collectstatic → nginx /static/)', async () => {
  const login = await fetch(`${BASE}/admin/login/`);
  const html = await login.text();
  const css = html.match(/\/static\/[^"]+\.css/)?.[0];
  const cssResponse = css ? await fetch(`${BASE}${css}`) : { status: 0 };
  check(
    7,
    'Admin panel and its static files (collectstatic → nginx /static/)',
    login.status === 200 && html.includes('کابل کارگو') && cssResponse.status === 200,
    `css=${css} ${cssResponse.status}`,
  );
});

await step(8, 'Health endpoint: 200 {status: ok}, database + cache, nothing else', async () => {
  const r = await api('GET', '/health/', null, { auth: false });
  check(
    8,
    'Health endpoint: 200 {status: ok}, database + cache, nothing else',
    r.status === 200 &&
      JSON.stringify(r.data) ===
        JSON.stringify({ status: 'ok', checks: { database: true, cache: true } }),
    JSON.stringify(r.data),
  );
});

// ---------------------------------------------------------------- documents: X-Accel only
await step(
  9,
  'Document: download with login 200 (same bytes, via X-Accel); without login 401',
  async () => {
    // A transaction needs today's USD rate (otherwise 428). 400 = one exists already: keep it.
    const kabulToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kabul' }).format(
      new Date(),
    );
    const rate = await api('POST', '/exchange-rates/', {
      date: kabulToday,
      currency: 'USD',
      rate: '70',
    });
    if (rate.status === 201) created.rateId = rate.data.id;
    const tx = await api('POST', '/transactions/', {
      branch: created.branchId,
      trade_type: 'EXPORT',
      serial_number: 'PROD-TEST-1',
      customer_payment: '1000',
    });
    if (tx.status !== 201)
      throw new Error(`transaction ${tx.status}: ${JSON.stringify(tx.data).slice(0, 150)}`);
    created.txId = tx.data.id;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.append('transaction', String(created.txId));
    form.append('file', new Blob([png], { type: 'image/png' }), 'سند.png');
    const doc = await api('POST', '/documents/', form);
    created.docId = doc.data.id;
    const ok = await api('GET', `/documents/${created.docId}/download/`, null, { raw: true });
    const bytes = Buffer.from(await ok.arrayBuffer());
    const anonymous = await api('GET', `/documents/${created.docId}/download/`, null, {
      auth: false,
      raw: true,
    });
    check(
      9,
      'Document: download with login 200 (same bytes, via X-Accel); without login 401',
      doc.status === 201 &&
        ok.status === 200 &&
        bytes.equals(png) &&
        anonymous.status === 401 &&
        !JSON.stringify(doc.data).includes('/media/'),
      `upload=${doc.status} download=${ok.status} bytes=${bytes.length}/${png.length} anon=${anonymous.status} type=${ok.headers.get('content-type')}`,
    );
  },
);

await step(
  10,
  'Raw files closed: /media/… 404, /protected-media/… 404 from a browser',
  async () => {
    const media = await fetch(`${BASE}/media/documents/`);
    const internal = await fetch(`${BASE}/protected-media/documents/`);
    check(
      10,
      'Raw files closed: /media/… 404, /protected-media/… 404 from a browser',
      media.status === 404 && internal.status === 404,
      `media=${media.status} protected=${internal.status}`,
    );
  },
);

// ---------------------------------------------------------------- clean up what 9 created
await step(11, 'Clean-up: test transaction, document and rate deleted', async () => {
  const statuses = [];
  if (created.docId) statuses.push((await api('DELETE', `/documents/${created.docId}/`)).status);
  if (created.txId) statuses.push((await api('DELETE', `/transactions/${created.txId}/`)).status);
  if (created.rateId)
    statuses.push((await api('DELETE', `/exchange-rates/${created.rateId}/`)).status);
  check(
    11,
    'Clean-up: test transaction, document and rate deleted',
    statuses.every((s) => s === 204),
    statuses.join(','),
  );
});

// ---------------------------------------------------------------- throttle shared by the workers
// 100 requests a minute per user (stage 7). With per-process counters (LocMem) each gunicorn
// worker would allow 100, so 3 workers would let ~300 through; with Redis it is 100 in total.
await step(
  12,
  'Throttle shared across gunicorn workers (Redis): 130 requests → 429s, ≤100 OK',
  async () => {
    const statuses = [];
    for (let i = 0; i < 13; i++) {
      // 10 at a time: keeps every worker busy without piling up in front of them.
      const batch = Array.from({ length: 10 }, () =>
        api('GET', '/auth/me/', null, { raw: true }).then((r) => r.status),
      );
      statuses.push(...(await Promise.all(batch)));
    }
    const ok = statuses.filter((s) => s === 200).length;
    const limited = statuses.filter((s) => s === 429).length;
    check(
      12,
      'Throttle shared across gunicorn workers (Redis): 130 requests → 429s, ≤100 OK',
      limited > 0 && ok <= 100 && ok + limited === 130,
      JSON.stringify(statuses.reduce((n, code) => ({ ...n, [code]: (n[code] ?? 0) + 1 }), {})),
    );
  },
);

check(13, 'No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
