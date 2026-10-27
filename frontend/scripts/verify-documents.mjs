/**
 * Customs documents live check: document types, required documents per branch × trade type,
 * the upload dialog (type, number, issue date, note, several files), number sync with the
 * transaction, the checklist, the documents register and its «missing documents» tab, the
 * dashboard tile, the super admin's types page and requirement matrix — against the real
 * stack (Django + Vite).
 *   ..\.venv\Scripts\python scripts\cleanup-documents.py --setup
 *   node scripts/verify-documents.mjs <screenshot-dir>
 *   ..\.venv\Scripts\python scripts\cleanup-documents.py
 * Env: KC_BASE_URL, KC_PASS (default: the password cleanup-documents.py sets), KC_BROWSER.
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'documents-screenshots';
const PASS = process.env.KC_PASS ?? 'E2e-Docs-Pass-2026';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(SHOTS, { recursive: true });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f80f00000101000518d84e0000000049454e44ae426082',
  'hex',
);
const BIG = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 48)]);
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), Buffer.alloc(300)]);

const results = [];
let pages = {};
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
    for (const [who, p] of Object.entries(pages)) {
      await p.screenshot({ path: `${SHOTS}/fail-${id}-${who}.png` }).catch(() => {});
    }
  }
}

const browser = await chromium.launch({ executablePath: BROWSER });
const errors = [];
async function session(username) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${username}: ${e}`));
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.setItem('kc.lang', 'fa'));
  await page.fill('#username', username);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  return page;
}
const api = (page, method, url, body, { token = true } = {}) =>
  page.evaluate(
    async ({ method, url, body, token }) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${localStorage.getItem('kc.access')}`;
      const send = () =>
        fetch(url.startsWith('/api') ? url : `/api${url}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      let r = await send();
      if (r.status === 429) {
        const wait = Math.min(Number(r.headers.get('retry-after')) || 30, 65);
        await new Promise((done) => setTimeout(done, wait * 1000));
        r = await send();
      }
      const type = r.headers.get('content-type') ?? '';
      const disposition = r.headers.get('content-disposition') ?? '';
      const raw = new Uint8Array(await r.arrayBuffer());
      const text = new TextDecoder().decode(raw);
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: r.status, type, disposition, head: Array.from(raw.slice(0, 4)), text, data };
    },
    { method, url, body, token },
  );
/** multipart upload through the API (the page's token), for fixtures and server-side checks. */
const upload = (page, fields, file) =>
  page.evaluate(
    async ({ fields, file }) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.append(k, String(v));
      if (file)
        body.append('file', new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      const r = await fetch('/api/documents/', {
        method: 'POST',
        body,
        headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
      });
      return { status: r.status, data: await r.json() };
    },
    { fields, file: file && { ...file, bytes: Array.from(file.bytes) } },
  );
const shamsi = (page, days) =>
  page.evaluate(async (n) => {
    const m = await import('/src/lib/date.ts');
    return m.shiftShamsi(m.todayShamsi(), n, 'day');
  }, days);
const toast = (p, text) => p.locator('div[role=status]', { hasText: text }).first();
const toDari = (s) => String(s).replace(/\d/g, (x) => String.fromCharCode(0x06f0 + Number(x)));
const results_ = (r) => (Array.isArray(r.data) ? r.data : r.data.results);

const admin = await session('e2e_doc_admin');
const mgr = await session('e2e_doc_mgr');
const mgr2 = await session('e2e_doc_mgr2');
pages = { admin, mgr, mgr2 };
const me = (await api(mgr, 'GET', '/auth/me/')).data;
const me2 = (await api(mgr2, 'GET', '/auth/me/')).data;
const branchId = me.branch.id;
const today = await shamsi(mgr, 0);
const lastWeek = await shamsi(mgr, -7);

const create = async (page, branch, body) =>
  (
    await api(page, 'POST', '/transactions/', {
      branch,
      date: today,
      currency: 'AFN',
      status: 'WAITING',
      customer_payment: '1000',
      ...body,
    })
  ).data;
const txEmpty = await create(mgr, branchId, { trade_type: 'TRANSIT', serial_number: 'DOC-TR-2' });
const txExp = await create(mgr, branchId, { trade_type: 'EXPORT', serial_number: 'DOC-EX-1' });
const txB = await create(mgr2, me2.branch.id, { trade_type: 'TRANSIT', serial_number: 'DOC-B-1' });
let txForm = null;

// ================================ Navigation ================================
await step(
  1,
  'Sidebar «اسناد» for both roles; «انواع اسناد» / «اسناد لازم» for the super admin only',
  async () => {
    const nav = async (p, text) => (await p.locator('aside nav a', { hasText: text }).count()) > 0;
    const mgrDocs = await nav(mgr, 'اسناد');
    const mgrTypes = await nav(mgr, 'انواع اسناد');
    const adminTypes = await nav(admin, 'انواع اسناد');
    const adminReq = await nav(admin, 'اسناد لازم');
    await mgr.locator('aside nav a[href="/documents"]').click();
    await mgr.waitForURL('**/documents');
    await mgr.getByTestId('tab-all').waitFor();
    check(
      1,
      'Sidebar «اسناد» for both roles; «انواع اسناد» / «اسناد لازم» for the super admin only',
      mgrDocs && !mgrTypes && adminTypes && adminReq,
      `mgr docs=${mgrDocs} types=${mgrTypes}; admin types=${adminTypes} req=${adminReq}`,
    );
  },
);

// ============================ Number fields in the form ============================
await step(2, 't1_number entered in the transaction form is saved and shown', async () => {
  await mgr.goto(`${BASE}/transactions/new/TRANSIT`);
  await mgr.waitForSelector('[data-testid=tx-form]');
  await mgr.fill('[data-testid=field-serial_number]', 'DOC-TR-1');
  await mgr.fill('[data-testid=field-t1_number]', 'T1-۵۵۵');
  await mgr.fill('[data-testid=field-cmr_number]', 'CMR-1');
  await mgr.fill('[data-testid=field-customer_payment]', '۱۰۰۰');
  await mgr.selectOption('[data-testid=field-currency]', 'AFN');
  const resp = mgr.waitForResponse(
    (r) => r.url().endsWith('/api/transactions/') && r.request().method() === 'POST',
  );
  await mgr.click('[data-testid=tx-submit]');
  const status = (await resp).status();
  await mgr.waitForURL(/highlight=\d+/);
  txForm = results_(await api(mgr, 'GET', '/transactions/?search=DOC-TR-1'))[0];
  await mgr.goto(`${BASE}/transactions/${txForm.id}`);
  const section = await mgr.getByTestId('detail-section-documents').textContent();
  check(
    2,
    't1_number entered in the transaction form is saved and shown',
    status === 201 &&
      txForm.t1_number === 'T1-555' &&
      txForm.cmr_number === 'CMR-1' &&
      section.includes('T1-555'),
    `status=${status} t1=${txForm?.t1_number} section=${section.slice(0, 80)}`,
  );
});

// ================================ Checklist ================================
await step(3, 'TRANSIT without T1: checklist ✗ T1, «سند ناقص» badge in the list', async () => {
  await mgr.goto(`${BASE}/transactions/${txEmpty.id}`);
  const item = mgr.getByTestId('checklist-T1');
  await item.waitFor();
  const state = await item.getAttribute('data-state');
  await mgr.screenshot({ path: `${SHOTS}/01-checklist-missing.png` });
  await mgr.goto(`${BASE}/transactions`);
  const row = mgr.locator('tbody tr', { hasText: 'DOC-TR-2' });
  await row.waitFor();
  const badge = await row.getByTestId('missing-badge').textContent();
  check(
    3,
    'TRANSIT without T1: checklist ✗ T1, «سند ناقص» badge in the list',
    state === 'missing' && badge.includes('سند ناقص'),
    `state=${state} badge=${badge}`,
  );
});

await step(4, '«فقط سند ناقص» filter (URL state) lists only incomplete transactions', async () => {
  await mgr.selectOption('[data-testid=filter-missing-documents]', 'true');
  await mgr.waitForFunction(() => location.search.includes('missing_documents=true'));
  await mgr.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length === 3);
  const rows = await mgr.locator('tbody tr[tabindex]').count();
  const badges = await mgr.locator('tbody [data-testid=missing-badge]').count();
  check(
    4,
    '«فقط سند ناقص» filter (URL state) lists only incomplete transactions',
    rows === 3 && badges === 3,
    `${rows} rows, ${badges} badges`,
  );
});

// ================================ Upload dialog ================================
await step(
  5,
  'Upload T1 (number in Dari digits, issue date, note, two pages) → transaction.t1_number filled',
  async () => {
    await mgr.goto(`${BASE}/transactions/${txEmpty.id}`);
    await mgr.getByTestId('checklist-T1').click(); // a missing item opens the dialog for that type
    await mgr.getByTestId('upload-dialog').waitFor();
    const preselected = await mgr.inputValue('[data-testid=doc-type-select]');
    const hint = await mgr.getByTestId('upload-dialog').textContent();
    await mgr.fill('[data-testid=doc-number-input]', '۷۷۷-۱');
    await mgr.fill('[data-testid=doc-issue-date]', toDari(lastWeek));
    await mgr.fill('[data-testid=doc-note]', 'دو صفحه');
    await mgr.setInputFiles('[data-testid=file-input]', [
      { name: 't1-page1.pdf', mimeType: 'application/pdf', buffer: PDF },
      { name: 't1-page2.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mgr.locator('[role=progressbar]').first().waitFor({ state: 'attached' }); // 0 % wide until sent
    await mgr.screenshot({ path: `${SHOTS}/02-upload-dialog.png` });
    await mgr.locator('[data-testid=upload-submit]:not([disabled])').click();
    await toast(mgr, 'پر شد').waitFor({ timeout: 15000 });
    await mgr.getByTestId('upload-dialog').waitFor({ state: 'detached' });
    const tx = (await api(mgr, 'GET', `/transactions/${txEmpty.id}/`)).data;
    const docs = (await api(mgr, 'GET', `/documents/?transaction=${txEmpty.id}`)).data;
    check(
      5,
      'Upload T1 (number in Dari digits, issue date, note, two pages) → transaction.t1_number filled',
      preselected === 'T1' &&
        hint.includes('خالی است') &&
        tx.t1_number === '777-1' &&
        docs.length === 2 &&
        docs.every(
          (x) =>
            x.doc_type === 'T1' &&
            x.doc_number === '777-1' &&
            x.issue_date === lastWeek &&
            x.note === 'دو صفحه',
        ),
      `pre=${preselected} t1=${tx.t1_number} docs=${docs.map((x) => `${x.doc_type}:${x.doc_number}:${x.issue_date}`).join(',')}`,
    );
  },
);

await step(6, 'Checklist ✓ T1 with its number; the «missing» flag clears', async () => {
  const item = mgr.locator('[data-testid=checklist-T1][data-state=present]');
  await item.waitFor({ timeout: 10000 });
  const text = await item.textContent();
  const status = (await api(mgr, 'GET', `/transactions/${txEmpty.id}/`)).data.documents_status;
  const missingIds = results_(await api(mgr, 'GET', '/transactions/?missing_documents=true')).map(
    (x) => x.id,
  );
  await mgr
    .getByTestId('documents-panel')
    .screenshot({ path: `${SHOTS}/03-checklist-complete.png` });
  check(
    6,
    'Checklist ✓ T1 with its number; the «missing» flag clears',
    text.includes('777-1') && status.missing.length === 0 && !missingIds.includes(txEmpty.id),
    `${text} | ${JSON.stringify(status)}`,
  );
});

await step(7, 'Different number → Dari warning, nothing overwritten', async () => {
  await mgr.goto(`${BASE}/transactions/${txForm.id}`);
  await mgr.getByTestId('upload-open').click();
  await mgr.getByTestId('upload-dialog').waitFor();
  await mgr.selectOption('[data-testid=doc-type-select]', 'T1');
  const hint = await mgr.getByTestId('upload-dialog').textContent();
  await mgr.fill('[data-testid=doc-number-input]', '999');
  await mgr.setInputFiles('[data-testid=file-input]', [
    { name: 't1.pdf', mimeType: 'application/pdf', buffer: PDF },
  ]);
  await mgr.locator('[data-testid=upload-submit]:not([disabled])').click();
  await toast(mgr, 'فرق دارد').waitFor({ timeout: 15000 });
  await mgr.getByTestId('number-mismatch').waitFor();
  const warning = await mgr.getByTestId('number-mismatch').textContent();
  const tx = (await api(mgr, 'GET', `/transactions/${txForm.id}/`)).data;
  const doc = (await api(mgr, 'GET', `/documents/?transaction=${txForm.id}`)).data[0];
  check(
    7,
    'Different number → Dari warning, nothing overwritten',
    hint.includes('T1-555') &&
      warning.includes('T1-555') &&
      tx.t1_number === 'T1-555' &&
      doc.doc_number === '999' &&
      doc.number_mismatch === 'T1-555',
    `${warning} | t1=${tx.t1_number} doc=${doc.doc_number}`,
  );
});

await step(
  8,
  'Client refuses an 11 MB file and an .exe renamed .jpg (no request, submit disabled)',
  async () => {
    let posted = 0;
    const listener = (r) =>
      r.method() === 'POST' && r.url().endsWith('/api/documents/') && posted++;
    mgr.on('request', listener);
    await mgr.getByTestId('upload-open').click();
    await mgr.getByTestId('upload-dialog').waitFor();
    await mgr.selectOption('[data-testid=doc-type-select]', 'CMR');
    await mgr.setInputFiles('[data-testid=file-input]', [
      { name: 'big.pdf', mimeType: 'application/pdf', buffer: BIG },
      { name: 'virus.jpg', mimeType: 'image/jpeg', buffer: EXE },
    ]);
    await mgr.waitForFunction(
      () => document.querySelectorAll('[data-testid=upload-error]').length === 2,
    );
    const disabled = await mgr.getByTestId('upload-submit').isDisabled();
    const msgs = await mgr.getByTestId('upload-error').allTextContents();
    mgr.off('request', listener);
    await mgr.keyboard.press('Escape');
    await mgr.getByTestId('upload-dialog').waitFor({ state: 'detached' });
    check(
      8,
      'Client refuses an 11 MB file and an .exe renamed .jpg (no request, submit disabled)',
      posted === 0 &&
        disabled &&
        msgs.some((m) => m.includes('میگابایت')) &&
        msgs.some((m) => m.includes('جعلی')),
      msgs.join(' | '),
    );
  },
);

await step(
  9,
  'Server refuses the same files and an upload without a type (Dari messages)',
  async () => {
    const base = { transaction: txForm.id, doc_type: 'T1' };
    const exe = await upload(mgr, base, { name: 'virus.jpg', type: 'image/jpeg', bytes: EXE });
    const big = await upload(mgr, base, { name: 'big.pdf', type: 'application/pdf', bytes: BIG });
    const noType = await upload(
      mgr,
      { transaction: txForm.id },
      { name: 'a.pdf', type: 'application/pdf', bytes: PDF },
    );
    check(
      9,
      'Server refuses the same files and an upload without a type (Dari messages)',
      exe.status === 400 &&
        JSON.stringify(exe.data).includes('جعلی') &&
        big.status === 400 &&
        JSON.stringify(big.data).includes('میگابایت') &&
        noType.status === 400 &&
        'doc_type' in noType.data,
      `${exe.status} ${big.status} ${noType.status} ${JSON.stringify(noType.data)}`,
    );
  },
);

await step(
  10,
  'Download with the token (type + «T1 777-1» name), 401 without; no /media/ in any API response',
  async () => {
    const doc = (await api(mgr, 'GET', `/documents/?transaction=${txEmpty.id}`)).data.find(
      (x) => x.content_type === 'application/pdf',
    );
    const withToken = await api(mgr, 'GET', doc.download_url);
    const without = await api(mgr, 'GET', doc.download_url, null, { token: false });
    const bodies = await Promise.all([
      api(mgr, 'GET', '/documents/?page=1'),
      api(mgr, 'GET', `/documents/?transaction=${txEmpty.id}`),
      api(mgr, 'GET', `/transactions/${txEmpty.id}/`),
      api(mgr, 'GET', '/transactions/?missing_documents=true'),
    ]);
    check(
      10,
      'Download with the token (type + «T1 777-1» name), 401 without; no /media/ in any API response',
      withToken.status === 200 &&
        withToken.type === 'application/pdf' &&
        String.fromCharCode(...withToken.head) === '%PDF' &&
        decodeURIComponent(withToken.disposition).includes('T1 777-1') &&
        without.status === 401 &&
        bodies.every((b) => !b.text.includes('/media/')),
      `${withToken.status} ${decodeURIComponent(withToken.disposition)} | without=${without.status}`,
    );
  },
);

await step(11, 'Open: image in a lightbox, PDF in a new tab (blob)', async () => {
  await mgr.goto(`${BASE}/transactions/${txEmpty.id}`);
  await mgr
    .locator('[data-testid=document-item]', { hasText: 't1-page2' })
    .getByTestId('document-open')
    .click();
  await mgr.getByTestId('lightbox-image').waitFor({ timeout: 10000 });
  const src = await mgr.getByTestId('lightbox-image').getAttribute('src');
  await mgr.keyboard.press('Escape');
  const popup = mgr.waitForEvent('popup');
  await mgr
    .locator('[data-testid=document-item]', { hasText: 't1-page1' })
    .getByTestId('document-open')
    .click();
  const tab = await popup;
  await tab.waitForURL(/^blob:/, { timeout: 10000 });
  const url = tab.url();
  await tab.close();
  check(
    11,
    'Open: image in a lightbox, PDF in a new tab (blob)',
    src.startsWith('blob:') && url.startsWith('blob:'),
  );
});

await step(
  12,
  'List item: type, number, dual issue date, uploader; history shows the upload',
  async () => {
    const item = mgr.locator('[data-testid=document-item]', { hasText: 't1-page1' });
    const text = await item.textContent();
    await item.getByTestId('document-history').click();
    const modal = mgr.getByTestId('document-history-modal');
    await modal.waitFor();
    await modal.locator('li').first().waitFor({ timeout: 10000 });
    const history = await modal.textContent();
    await mgr.keyboard.press('Escape');
    check(
      12,
      'List item: type, number, dual issue date, uploader; history shows the upload',
      text.includes('سند T1') &&
        text.includes('777-1') &&
        text.includes(toDari(lastWeek)) &&
        /20\d\d-\d\d-\d\d/.test(text) &&
        text.includes('مدیر') &&
        history.includes('e2e_doc_mgr'),
      `${text.slice(0, 160)} | ${history.slice(0, 80)}`,
    );
  },
);

await step(13, 'Delete a document (confirm)', async () => {
  await mgr
    .locator('[data-testid=document-item]', { hasText: 't1-page2' })
    .getByTestId('document-delete')
    .click();
  await mgr.click('[data-testid=confirm-ok]');
  await toast(mgr, 'حذف شد').waitFor({ timeout: 10000 });
  await mgr.waitForFunction(
    () => document.querySelectorAll('[data-testid=document-item]').length === 1,
  );
  const left = (await api(mgr, 'GET', `/documents/?transaction=${txEmpty.id}`)).data;
  check(
    13,
    'Delete a document (confirm)',
    left.length === 1 && left[0].file_name.startsWith('t1-page1'),
  );
});

// ================================ Register ================================
// An export with its customs declaration (issued last week) but no exit slip.
await upload(
  mgr,
  {
    transaction: txExp.id,
    doc_type: 'CUSTOMS_DECLARATION',
    doc_number: 'CD-42',
    issue_date: lastWeek,
  },
  { name: 'declaration.pdf', type: 'application/pdf', bytes: PDF },
);

await step(
  14,
  '/documents: search by the T1 number finds the document and links to its transaction',
  async () => {
    await mgr.goto(`${BASE}/documents`);
    await mgr.fill('[data-testid=register-search]', '۷۷۷-۱');
    await mgr.waitForFunction(() => location.search.includes('search='));
    await mgr.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length === 1);
    const row = await mgr.locator('tbody tr[tabindex]').textContent();
    await mgr.screenshot({ path: `${SHOTS}/04-register.png` });
    await mgr.locator('tbody tr[tabindex]').getByTestId('tx-link').click();
    await mgr.waitForURL(`**/transactions/${txEmpty.id}#documents`);
    await mgr.getByTestId('documents-panel').waitFor();
    check(
      14,
      '/documents: search by the T1 number finds the document and links to its transaction',
      row.includes('DOC-TR-2') && row.includes('777-1'),
      row,
    );
  },
);

await step(15, 'Register filters: type, trade type, issue-date range', async () => {
  const count = async (q) => (await api(mgr, 'GET', `/documents/?page=1&${q}`)).data.count;
  const t1 = await count('doc_type=T1');
  const exportDocs = await count('trade_type=EXPORT');
  const dated = await count(`date_from=${lastWeek}&date_to=${lastWeek}`);
  const none = await count(`date_from=${today}&date_to=${today}`);
  await mgr.goto(`${BASE}/documents?doc_type=CUSTOMS_DECLARATION`);
  await mgr.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length === 1);
  const row = await mgr.locator('tbody tr[tabindex]').textContent();
  check(
    15,
    'Register filters: type, trade type, issue-date range',
    t1 === 2 &&
      exportDocs === 1 &&
      dated === 2 &&
      none === 0 &&
      row.includes('CD-42') &&
      row.includes('DOC-EX-1'),
    `t1=${t1} export=${exportDocs} dated=${dated} none=${none}`,
  );
});

await step(
  16,
  'Tab «معاملات با سند ناقص»: which transactions, which documents are missing',
  async () => {
    await mgr.goto(`${BASE}/documents?tab=missing`);
    const row = mgr.locator('tbody tr', { hasText: 'DOC-EX-1' });
    await row.waitFor();
    const missing = await row.getByTestId('missing-types').textContent();
    const all = await mgr.locator('tbody tr[tabindex]').allTextContents();
    const count = await mgr.getByTestId('tab-missing-count').textContent();
    await mgr.screenshot({ path: `${SHOTS}/05-missing-tab.png` });
    check(
      16,
      'Tab «معاملات با سند ناقص»: which transactions, which documents are missing',
      missing.includes('برگهٔ خروجی') &&
        !missing.includes('اظهارنامه') &&
        // DOC-TR-1 got its T1 in check 7, DOC-TR-2 in check 5: only the export still lacks one.
        all.length === 1 &&
        count === toDari(1),
      `${missing} | rows=${all.length} count=${count}`,
    );
  },
);

await step(17, 'Dashboard tile: count of incomplete transactions → the missing tab', async () => {
  await mgr.goto(`${BASE}/dashboard`);
  const value = await mgr.getByTestId('tile-missing-documents-value').textContent();
  const api_ = (await api(mgr, 'GET', '/transactions/?missing_documents=true&page_size=1')).data
    .count;
  await mgr.getByTestId('tile-missing-documents').click();
  await mgr.waitForURL('**/documents?tab=missing');
  await mgr.locator('[data-testid=tab-missing][aria-selected=true]').waitFor();
  check(
    17,
    'Dashboard tile: count of incomplete transactions → the missing tab',
    value === toDari(api_) && api_ === 1,
    `${value} vs ${api_}`,
  );
});

await step(18, 'Transactions list: filter by document type', async () => {
  await mgr.goto(`${BASE}/transactions`);
  await mgr
    .locator('[data-testid=filter-doc-type] option[value=T1]')
    .waitFor({ state: 'attached' });
  await mgr.selectOption('[data-testid=filter-doc-type]', 'T1');
  await mgr.waitForFunction(() => location.search.includes('doc_type=T1'));
  await mgr.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length === 2);
  const rows = await mgr.locator('tbody tr[tabindex]').allTextContents();
  check(
    18,
    'Transactions list: filter by document type',
    rows.some((r) => r.includes('DOC-TR-1')) && rows.some((r) => r.includes('DOC-TR-2')),
    rows.length,
  );
});

// ================================ Branch scoping ================================
await step(
  19,
  'Other branch’s manager: sees only own documents, cannot upload or open ours',
  async () => {
    const theirs = (await api(mgr2, 'GET', '/documents/?page=1')).data.count;
    const ours = await api(mgr2, 'GET', `/transactions/${txEmpty.id}/`);
    const cross = await upload(
      mgr2,
      { transaction: txEmpty.id, doc_type: 'T1' },
      { name: 'x.pdf', type: 'application/pdf', bytes: PDF },
    );
    const own = await upload(
      mgr2,
      { transaction: txB.id, doc_type: 'T1', doc_number: 'B-1' },
      { name: 'b.pdf', type: 'application/pdf', bytes: PDF },
    );
    await mgr2.goto(`${BASE}/documents`);
    await mgr2.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length === 1);
    const rows = await mgr2.locator('tbody tr[tabindex]').allTextContents();
    check(
      19,
      'Other branch’s manager: sees only own documents, cannot upload or open ours',
      theirs === 0 &&
        ours.status === 404 &&
        cross.status === 403 &&
        own.status === 201 &&
        rows[0].includes('DOC-B-1'),
      `before=${theirs} tx=${ours.status} cross=${cross.status} own=${own.status}`,
    );
  },
);

await step(
  20,
  'Branch manager cannot change document types or the requirement matrix',
  async () => {
    const type = await api(mgr, 'POST', '/document-types/', { code: 'E2EDOC_X', name_fa: 'x' });
    const cell = await api(mgr, 'POST', '/document-requirements/set/', {
      branch: branchId,
      trade_type: 'TRANSIT',
      doc_type: 'CMR',
      required: true,
    });
    const grid = results_(await api(mgr, 'GET', '/document-requirements/'));
    await mgr.goto(`${BASE}/admin/document-types`);
    await mgr.waitForTimeout(800);
    const page = await mgr.getByTestId('add-document-type').count();
    check(
      20,
      'Branch manager cannot change document types or the requirement matrix',
      type.status === 403 &&
        cell.status === 403 &&
        grid.every((r) => r.branch === branchId) &&
        page === 0,
      `type=${type.status} cell=${cell.status} page=${page}`,
    );
  },
);

// ================================ Super admin ================================
await step(
  21,
  'Super admin: «انواع اسناد» lists the 12 defaults; a new type is created (code fixed after)',
  async () => {
    await admin.goto(`${BASE}/admin/document-types`);
    await admin.locator('tbody tr', { hasText: 'CUSTOMS_DECLARATION' }).waitFor();
    const before = await admin.locator('tbody tr').count();
    await admin.getByTestId('add-document-type').click();
    await admin.waitForURL('**/admin/document-types/new');
    await admin.getByTestId('type-code').waitFor();
    await admin.fill('[data-testid=type-code]', 'e2edoc_permit');
    await admin.fill('[data-testid=type-name-fa]', 'جواز آزمایشی');
    await admin.click('[data-testid=drawer-submit]');
    await toast(admin, 'جواز آزمایشی').waitFor({ timeout: 10000 });
    const row = admin.locator('tbody tr', { hasText: 'E2EDOC_PERMIT' });
    await row.waitFor();
    await row.click();
    await admin.waitForURL(/document-types\/\d+\/edit/);
    await admin.getByTestId('type-code').waitFor();
    const locked = await admin.getByTestId('type-code').isDisabled();
    await admin.keyboard.press('Escape');
    check(
      21,
      'Super admin: «انواع اسناد» lists the 12 defaults; a new type is created (code fixed after)',
      before >= 12 && locked,
      `rows=${before} locked=${locked}`,
    );
  },
);

await step(
  22,
  'A new branch gets its requirement grid automatically (defaults per trade type)',
  async () => {
    const branch = (
      await api(admin, 'POST', '/branches/', {
        name: 'بندر آزمایشی اسناد سوم',
        code: 'E2EDOC3',
        city: 'کابل',
      })
    ).data;
    const grid = await api(admin, 'GET', `/document-requirements/?branch=${branch.id}`);
    const types = (await api(admin, 'GET', '/document-types/')).data;
    const required = (tt) =>
      grid.data
        .filter((r) => r.trade_type === tt && r.required)
        .map((r) => r.doc_type_code)
        .sort()
        .join(',');
    check(
      22,
      'A new branch gets its requirement grid automatically (defaults per trade type)',
      grid.data.length === 4 * types.length &&
        required('TRANSIT') === 'T1' &&
        required('EXPORT') === 'CUSTOMS_DECLARATION,EXIT_SLIP' &&
        required('IMPORT') === 'CUSTOMS_DECLARATION,TARIFF_SLIP' &&
        required('TIR_CARNET') === 'CMR',
      `rows=${grid.data.length} types=${types.length}`,
    );
  },
);

await step(
  23,
  'Matrix: super admin ticks CMR for TRANSIT → the checklist follows; unticking restores it',
  async () => {
    await admin.goto(`${BASE}/admin/document-requirements?branch=${branchId}`);
    const t1 = admin.getByTestId('req-T1-TRANSIT');
    await t1.waitFor();
    const t1Checked = await t1.isChecked();
    const newType = await admin.getByTestId('req-E2EDOC_PERMIT-TRANSIT').isChecked();
    await admin.getByTestId('req-CMR-TRANSIT').check();
    await toast(admin, 'لازم شد').waitFor({ timeout: 10000 });
    await admin.screenshot({ path: `${SHOTS}/06-requirements-matrix.png` });
    await mgr.goto(`${BASE}/transactions/${txEmpty.id}`);
    const cmr = mgr.getByTestId('checklist-CMR');
    await cmr.waitFor({ timeout: 10000 });
    const cmrState = await cmr.getAttribute('data-state');
    await admin.getByTestId('req-CMR-TRANSIT').uncheck();
    await toast(admin, 'دیگر لازم نیست').waitFor({ timeout: 10000 });
    await mgr.reload();
    await mgr.getByTestId('checklist-T1').waitFor();
    const gone = (await mgr.getByTestId('checklist-CMR').count()) === 0;
    const history = (
      await api(admin, 'GET', `/document-requirements/?branch=${branchId}&trade_type=TRANSIT`)
    ).data.find((r) => r.doc_type_code === 'CMR');
    const entries = (await api(admin, 'GET', `/document-requirements/${history.id}/history/`)).data;
    check(
      23,
      'Matrix: super admin ticks CMR for TRANSIT → the checklist follows; unticking restores it',
      t1Checked &&
        !newType &&
        cmrState === 'missing' &&
        gone &&
        entries.length >= 3 &&
        entries[0].user === 'e2e_doc_admin',
      `T1=${t1Checked} new=${newType} cmr=${cmrState} gone=${gone} history=${entries.length}`,
    );
  },
);

await step(
  24,
  'Missing documents never block saving: an EXPORT without any document saves',
  async () => {
    const r = await api(mgr, 'POST', '/transactions/', {
      branch: branchId,
      trade_type: 'EXPORT',
      serial_number: 'DOC-EX-2',
      date: today,
      currency: 'AFN',
      status: 'WAITING',
      customer_payment: '500',
      seal_expense: '1',
      scale_ticket_expense: '1',
      gate_ticket_expense: '1',
    });
    check(
      24,
      'Missing documents never block saving: an EXPORT without any document saves',
      r.status === 201 &&
        r.data.documents_status.missing.join(',') === 'CUSTOMS_DECLARATION,EXIT_SLIP',
      `${r.status} ${JSON.stringify(r.data.documents_status)}`,
    );
  },
);

await step(25, 'Pashto and English: register and checklist are translated', async () => {
  const texts = {};
  for (const lang of ['ps', 'en']) {
    await mgr.evaluate((l) => localStorage.setItem('kc.lang', l), lang);
    await mgr.goto(`${BASE}/transactions/${txEmpty.id}`);
    await mgr.getByTestId('doc-checklist').waitFor();
    // The type names arrive with their own request, after the panel itself: wait for them.
    const typeName = lang === 'ps' ? 'T1 سند' : 'T1 transit document';
    await mgr
      .getByTestId('documents-panel')
      .getByText(typeName)
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => {});
    texts[lang] = await mgr.getByTestId('documents-panel').textContent();
  }
  await mgr.evaluate(() => localStorage.setItem('kc.lang', 'fa'));
  check(
    25,
    'Pashto and English: register and checklist are translated',
    texts.ps.includes('اړین اسناد') &&
      texts.en.includes('Documents this transaction needs') &&
      texts.en.includes('T1 transit document'),
    `${texts.ps.slice(0, 60)} | ${texts.en.slice(0, 60)}`,
  );
});

await step(
  26,
  'Drag & drop on the panel opens the upload dialog with the dropped files',
  async () => {
    await mgr.goto(`${BASE}/transactions/${txExp.id}`);
    await mgr.getByTestId('dropzone').waitFor();
    const transfer = await mgr.evaluateHandle(() => {
      const dt = new DataTransfer();
      const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
      dt.items.add(new File([pdf], 'dropped-exit-slip.pdf', { type: 'application/pdf' }));
      return dt;
    });
    await mgr.dispatchEvent('[data-testid=dropzone]', 'drop', { dataTransfer: transfer });
    await mgr.getByTestId('upload-dialog').waitFor();
    await mgr
      .locator('[data-testid=upload-list] li', { hasText: 'dropped-exit-slip.pdf' })
      .waitFor();
    const type = await mgr.inputValue('[data-testid=doc-type-select]');
    check(
      26,
      'Drag & drop on the panel opens the upload dialog with the dropped files',
      type === '',
      `type=${type}`,
    );
  },
);

await step(
  27,
  'The document type is required: submitting without one shows a Dari error, nothing is sent',
  async () => {
    let posted = 0;
    const listener = (r) =>
      r.method() === 'POST' && r.url().endsWith('/api/documents/') && posted++;
    mgr.on('request', listener);
    await mgr.locator('[data-testid=upload-submit]:not([disabled])').click();
    const error = await mgr
      .getByTestId('upload-dialog')
      .getByText('نوع سند را انتخاب کنید.')
      .first();
    await error.waitFor();
    mgr.off('request', listener);
    await mgr.selectOption('[data-testid=doc-type-select]', 'EXIT_SLIP');
    await mgr.fill('[data-testid=doc-number-input]', 'EX-9');
    await mgr.locator('[data-testid=upload-submit]:not([disabled])').click();
    await mgr.getByTestId('upload-dialog').waitFor({ state: 'detached', timeout: 15000 });
    const status = (await api(mgr, 'GET', `/transactions/${txExp.id}/`)).data;
    check(
      27,
      'The document type is required: submitting without one shows a Dari error, nothing is sent',
      posted === 0 &&
        status.documents_status.missing.length === 0 &&
        status.exit_slip_number === 'EX-9',
      `posted=${posted} ${JSON.stringify(status.documents_status)} exit=${status.exit_slip_number}`,
    );
  },
);

await step(
  28,
  'Super admin renames a type in the drawer; the change is in its history',
  async () => {
    await admin.goto(`${BASE}/admin/document-types`);
    await admin.locator('tbody tr', { hasText: 'E2EDOC_PERMIT' }).click();
    await admin.getByTestId('type-name-fa').waitFor();
    await admin.fill('[data-testid=type-name-fa]', 'جواز آزمایشی تازه');
    await admin.click('[data-testid=drawer-submit]');
    await admin.locator('tbody tr', { hasText: 'جواز آزمایشی تازه' }).waitFor({ timeout: 10000 });
    const type = (await api(admin, 'GET', '/document-types/')).data.find(
      (x) => x.code === 'E2EDOC_PERMIT',
    );
    const history = (await api(admin, 'GET', `/document-types/${type.id}/history/`)).data;
    check(
      28,
      'Super admin renames a type in the drawer; the change is in its history',
      type.name_fa === 'جواز آزمایشی تازه' &&
        history[0].user === 'e2e_doc_admin' &&
        history[0].changes.some((c) => c.field === 'name_fa' && c.new === 'جواز آزمایشی تازه'),
      JSON.stringify(history[0]?.changes),
    );
  },
);

await step(
  29,
  'An inactive type is no longer offered for uploads (its old documents stay)',
  async () => {
    // The super admin's page: by now the manager is close to the API's 100 requests a minute.
    const option = '[data-testid=doc-type-select] option[value=E2EDOC_PERMIT]';
    await admin.goto(`${BASE}/transactions/${txExp.id}`);
    await admin.getByTestId('upload-open').click();
    await admin
      .locator('[data-testid=doc-type-select] option[value=T1]')
      .waitFor({ state: 'attached' });
    const before = await admin.locator(option).count();
    await admin.keyboard.press('Escape');
    const type = (await api(admin, 'GET', '/document-types/')).data.find(
      (x) => x.code === 'E2EDOC_PERMIT',
    );
    const off = await api(admin, 'PATCH', `/document-types/${type.id}/`, { is_active: false });
    await admin.reload();
    await admin.getByTestId('upload-open').click();
    await admin
      .locator('[data-testid=doc-type-select] option[value=T1]')
      .waitFor({ state: 'attached' });
    const after = await admin.locator(option).count();
    await admin.keyboard.press('Escape');
    check(
      29,
      'An inactive type is no longer offered for uploads (its old documents stay)',
      before === 1 && off.status === 200 && after === 0,
      `before=${before} after=${after}`,
    );
  },
);

check('E', 'No uncaught page errors', errors.length === 0, errors.join(' | '));
await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
