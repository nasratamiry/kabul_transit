/**
 * Lighthouse (accessibility) for the customs-documents pages: /documents (both tabs), a
 * transaction's detail page with its documents panel, and the super admin's types page and
 * requirement matrix. Logs in through a persistent Edge profile with a debugging port, then
 * points the Lighthouse CLI at that browser (same localStorage, so same login).
 *   ..\.venv\Scripts\python scripts\cleanup-documents.py --setup
 *   node scripts/lighthouse-documents.mjs <out-dir>        (Vite :5183 → Django :8010 by default)
 *   ..\.venv\Scripts\python scripts\cleanup-documents.py
 * Needs network once: `npx -y lighthouse@13.5.0`.
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5183';
const OUT = process.argv[2] ?? 'lighthouse-documents';
const PASS = process.env.KC_PASS ?? 'E2e-Docs-Pass-2026';
const PORT = 9333;
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(OUT, { recursive: true });

// Edge is started directly (not by Playwright, whose CDP session would fight Lighthouse for the
// tabs); Playwright only connects to log in, Lighthouse then audits in the same profile.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-lh-'));
const edge = spawn(
  BROWSER,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--headless=new',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
/**
 * Connect, log in as `username`, run `prepare(page, api)`, then disconnect: Lighthouse fails
 * («Target closed») while another CDP client is attached.
 */
async function loggedIn(username, prepare = async () => undefined) {
  let browser = null;
  for (let i = 0; i < 50 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
    if (!browser) await new Promise((done) => setTimeout(done, 200));
  }
  const page = await browser.contexts()[0].newPage();
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('kc.lang', 'fa');
  });
  await page.goto(`${BASE}/login`);
  await page.fill('#username', username);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  const api = (method, url, body) =>
    page.evaluate(
      async ({ method, url, body }) => {
        const r = await fetch(`/api${url}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('kc.access')}`,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return r.json();
      },
      { method, url, body },
    );
  const result = await prepare(page, api);
  await page.close();
  await browser.close(); // over CDP this only disconnects; Edge keeps running
  return result;
}

// One export with its customs declaration (the exit slip still missing): a full checklist.
const { tx, me } = await loggedIn('e2e_doc_mgr', async (page, api) => {
  const me = await api('GET', '/auth/me/');
  const today = await page.evaluate(async () => (await import('/src/lib/date.ts')).todayShamsi());
  const tx = await api('POST', '/transactions/', {
    branch: me.branch.id,
    trade_type: 'EXPORT',
    serial_number: 'LH-1',
    date: today,
    currency: 'AFN',
    customer_payment: '1000',
  });
  await page.evaluate(async (id) => {
    const body = new FormData();
    body.append('transaction', String(id));
    body.append('doc_type', 'CUSTOMS_DECLARATION');
    body.append('doc_number', 'CD-1');
    body.append(
      'file',
      new File(['%PDF-1.4\n%%EOF\n'], 'declaration.pdf', { type: 'application/pdf' }),
    );
    await fetch('/api/documents/', {
      method: 'POST',
      body,
      headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
    });
  }, tx.id);
  return { tx, me };
});

const scores = {};
function audit(name, url) {
  const file = path.join(OUT, `${name}.json`);
  // One command string (the shell resolves npx / npx.cmd on every platform); both values quoted.
  execSync(
    `npx -y lighthouse@13.5.0 "${url}" --port=${PORT} --only-categories=accessibility ` +
      `--preset=desktop --disable-storage-reset --output=json --output-path="${file}" --quiet`,
    { stdio: 'inherit' },
  );
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  scores[name] = Math.round(report.categories.accessibility.score * 100);
  const failed = Object.values(report.audits).filter(
    (a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === 'binary',
  );
  console.log(
    `${name}: ${scores[name]}${failed.length ? ' — ' + failed.map((a) => a.id).join(', ') : ''}`,
  );
}

audit('documents-register', `${BASE}/documents`);
audit('documents-missing-tab', `${BASE}/documents?tab=missing`);
audit('transaction-detail', `${BASE}/transactions/${tx.id}`);
await loggedIn('e2e_doc_admin');
audit('admin-document-types', `${BASE}/admin/document-types`);
audit('admin-document-requirements', `${BASE}/admin/document-requirements?branch=${me.branch.id}`);

edge.kill();
await new Promise((done) => setTimeout(done, 1000));
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
fs.writeFileSync(path.join(OUT, 'scores.json'), JSON.stringify(scores, null, 2));
const low = Object.entries(scores).filter(([, s]) => s < 95);
console.log(low.length ? `below 95: ${low.map(([n]) => n).join(', ')}` : 'all ≥ 95');
process.exit(low.length ? 1 : 0);
