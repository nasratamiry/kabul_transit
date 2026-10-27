/**
 * Stage 12b live check: transaction detail, documents, USD equivalent, print view, branch
 * manager's today-rate entry — against the real stack (Django :8000 + Vite :5173).
 *   ..\.venv\Scripts\python scripts\cleanup-stage12b.py --setup
 *   node scripts/verify-stage12b.mjs <screenshot-dir>
 *   ..\.venv\Scripts\python scripts\cleanup-stage12b.py
 * Env: KC_PASS (default: the password cleanup-stage12b.py sets), KC_BROWSER.
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'stage12b-screenshots';
const PASS = process.env.KC_PASS ?? 'E2e-Stage12b-Pass-2026';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(SHOTS, { recursive: true });

// Test files, built in memory.
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
      // The API allows each user 100 requests a minute (stage 7); this suite runs close to
      // that, so a 429 waits the server's Retry-After once and retries.
      if (r.status === 429) {
        const wait = Math.min(Number(r.headers.get('retry-after')) || 30, 65);
        await new Promise((done) => setTimeout(done, wait * 1000));
        r = await send();
      }
      const type = r.headers.get('content-type') ?? '';
      const raw = new Uint8Array(await r.arrayBuffer());
      const text = new TextDecoder().decode(raw);
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: r.status, type, size: raw.length, head: Array.from(raw.slice(0, 4)), data };
    },
    { method, url, body, token },
  );
const shamsi = (page, days) =>
  page.evaluate(async (n) => {
    const m = await import('/src/lib/date.ts');
    return m.shiftShamsi(m.todayShamsi(), n, 'day');
  }, days);
const toast = (p, text) => p.locator('div[role=status]', { hasText: text }).first();
const toDari = (s) => String(s).replace(/\d/g, (x) => String.fromCharCode(0x06f0 + Number(x)));

const admin = await session('e2e_admin');
const mgr = await session('e2e_mgr');
const mgrB = await session('e2e_mgr_b');
pages = { admin, mgr, mgrB };
const me = (await api(mgr, 'GET', '/auth/me/')).data;
const meB = (await api(mgrB, 'GET', '/auth/me/')).data;
const trader = (await api(mgr, 'GET', `/traders/?search=${encodeURIComponent('تاجر آزمایشی ۱۲ب')}`))
  .data[0];
const tenDaysAgo = await shamsi(mgr, -10);
const today = await shamsi(mgr, 0);

// An AFN transaction dated ten days ago: its USD figures must use THAT day's rate (60), not today's (70).
const txA = (
  await api(mgr, 'POST', '/transactions/', {
    branch: me.branch.id,
    trade_type: 'EXPORT',
    serial_number: 'B12-1001',
    date: tenDaysAgo,
    currency: 'AFN',
    status: 'WAITING',
    trader: trader.id,
    plate_afghan: 'KBL-12',
    driver_name: 'نادر',
    customer_payment: '6000',
    tariff_expense: '600',
  })
).data;
const txOther = (
  await api(mgrB, 'POST', '/transactions/', {
    branch: meB.branch.id,
    trade_type: 'IMPORT',
    serial_number: 'B12-2001',
    date: today,
    currency: 'AFN',
  })
).data;

// ================================ USD equivalent ================================
await step(1, 'AFN transaction: USD at its own date’s rate (60), not today’s (70)', async () => {
  const r = (await api(mgr, 'GET', `/transactions/${txA.id}/`)).data.row_summary;
  check(
    1,
    'AFN transaction: USD at its own date’s rate (60), not today’s (70)',
    r.fee_per_dollar_afn === '60.00000000' &&
      r.profit_or_loss_usd === '90.00' &&
      r.total_expense_usd === '10.00',
    JSON.stringify(r),
  );
});

await step(2, 'List shows the USD profit of the AFN row', async () => {
  await mgr.goto(`${BASE}/transactions?date_from=${tenDaysAgo}&date_to=${today}`);
  const row = mgr.locator('tbody tr', { hasText: 'B12-1001' });
  await row.waitFor();
  const usd = await row.getByTestId('profit-usd').textContent();
  check(2, 'List shows the USD profit of the AFN row', usd.includes('۹۰٫۰۰'), usd);
});

// ================================ Detail page ================================
await step(3, 'Row click → detail: serial, trade badge, branch, dual date, status', async () => {
  await mgr.locator('tbody tr', { hasText: 'B12-1001' }).click();
  await mgr.waitForURL(`**/transactions/${txA.id}`);
  await mgr.getByTestId('tx-detail').waitFor();
  const head = await mgr.locator('h1').textContent();
  const date = await mgr.getByTestId('detail-date').textContent();
  const page = await mgr.textContent('[data-testid=tx-detail]');
  check(
    3,
    'Row click → detail: serial, trade badge, branch, dual date, status',
    head.includes('B12-1001') &&
      head.includes('صادرات') &&
      head.includes('در انتظار تفتیش') &&
      date.includes(toDari(tenDaysAgo)) &&
      /20\d\d-\d\d-\d\d/.test(date) &&
      page.includes('بندر آزمایشی ۱۲ب الف'),
    `${head} | ${date}`,
  );
});

await step(4, 'Money table: each line in AFN + USD; profit USD at the date rate', async () => {
  await mgr.waitForFunction(() => document.querySelector('[data-testid=money-tariff_expense-usd]'));
  const tariffUsd = await mgr.textContent('[data-testid=money-tariff_expense-usd]');
  const profitUsd = await mgr.textContent('[data-testid=detail-profit-usd]');
  const profitAfn = await mgr.textContent('[data-testid=detail-profit-afn]');
  const cls = await mgr.locator('tfoot tr').last().getAttribute('class');
  const table = await mgr.textContent('[data-testid=money-table]');
  check(
    4,
    'Money table: each line in AFN + USD; profit USD at the date rate',
    tariffUsd.includes('۱۰٫۰۰') &&
      profitUsd.includes('۹۰٫۰۰') &&
      profitAfn.includes('۵٬۴۰۰') &&
      cls.includes('emerald') &&
      table.includes('۶۰٫۰۰') &&
      table.includes('یگانه عاید'),
    `${tariffUsd} | ${profitUsd} | ${profitAfn}`,
  );
});

await step(5, 'Read-only sections mirror the form', async () => {
  const sections = await mgr.locator('[data-testid^=detail-section-]').count();
  const parties = await mgr.textContent('[data-testid=detail-section-parties]');
  check(
    5,
    'Read-only sections mirror the form',
    sections >= 3 && parties.includes('تاجر آزمایشی ۱۲ب') && parties.includes('نادر'),
    `${sections} sections`,
  );
  await mgr.screenshot({ path: `${SHOTS}/01-detail.png`, fullPage: true });
});

await step(6, 'Print view: A4 PDF, no topbar/sidebar, letterhead + signatures', async () => {
  await mgr.emulateMedia({ media: 'print' });
  const vis = await mgr.evaluate(() => {
    // checkVisibility(): an element inside a display:none parent is hidden too.
    const shown = (el) => !!el && el.checkVisibility();
    return {
      header: shown(document.querySelector('header.sticky')),
      aside: shown(document.querySelector('aside')),
      letterhead: shown(document.querySelector('[data-testid=print-header]')),
      signatures: shown(document.querySelector('[data-testid=print-signatures]')),
      actions: shown(document.querySelector('[data-testid=detail-print]')),
      docs: shown(document.querySelector('[data-testid=documents-panel]')),
    };
  });
  const pdf = await mgr.pdf({
    path: `${SHOTS}/02-print.pdf`,
    format: 'A4',
    printBackground: false,
    preferCSSPageSize: true,
  });
  await mgr.screenshot({ path: `${SHOTS}/02-print-preview.png`, fullPage: true });
  await mgr.emulateMedia({ media: 'screen' });
  check(
    6,
    'Print view: A4 PDF, no topbar/sidebar, letterhead + signatures',
    !vis.header &&
      !vis.aside &&
      vis.letterhead &&
      vis.signatures &&
      !vis.actions &&
      !vis.docs &&
      pdf.subarray(0, 4).toString() === '%PDF',
    `${JSON.stringify(vis)} pdf=${pdf.length}B`,
  );
});

// ================================ Documents ================================
let docs = [];
await step(7, 'Upload a PDF and a PNG at once (progress, then listed with thumbnail)', async () => {
  // Since the customs-documents stage every upload has a type (here «سایر اسناد»).
  await mgr.click('[data-testid=upload-open]');
  await mgr.getByTestId('upload-dialog').waitFor();
  await mgr.selectOption('[data-testid=doc-type-select]', 'OTHER');
  await mgr.setInputFiles('[data-testid=file-input]', [
    { name: 'بارنامه.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'photo.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await mgr.locator('[data-testid=upload-submit]:not([disabled])').click();
  await mgr.waitForFunction(
    () => document.querySelectorAll('[data-testid=document-item]').length === 2,
    null,
    { timeout: 15000 },
  );
  await mgr.getByTestId('document-thumb').first().waitFor({ timeout: 10000 });
  docs = (await api(mgr, 'GET', `/documents/?transaction=${txA.id}`)).data;
  check(
    7,
    'Upload a PDF and a PNG at once (progress, then listed with thumbnail)',
    docs.length === 2,
    docs.map((x) => x.file_name).join(', '),
  );
  await mgr.screenshot({ path: `${SHOTS}/03-documents.png` });
});

await step(8, 'Client refuses 11 MB and an .exe renamed .jpg (no request sent)', async () => {
  let posted = 0;
  const listener = (r) => r.method() === 'POST' && r.url().endsWith('/api/documents/') && posted++;
  mgr.on('request', listener);
  await mgr.click('[data-testid=upload-open]');
  await mgr.getByTestId('upload-dialog').waitFor();
  await mgr.selectOption('[data-testid=doc-type-select]', 'OTHER');
  await mgr.setInputFiles('[data-testid=file-input]', [
    { name: 'big.pdf', mimeType: 'application/pdf', buffer: BIG },
    { name: 'virus.jpg', mimeType: 'image/jpeg', buffer: EXE },
  ]);
  await mgr.waitForFunction(
    () => document.querySelectorAll('[data-testid=upload-error]').length === 2,
    null,
    { timeout: 10000 },
  );
  const submitDisabled = await mgr.getByTestId('upload-submit').isDisabled();
  mgr.off('request', listener);
  const msgs = await mgr.getByTestId('upload-error').allTextContents();
  await mgr.keyboard.press('Escape');
  await mgr.getByTestId('upload-dialog').waitFor({ state: 'detached' });
  check(
    8,
    'Client refuses 11 MB and an .exe renamed .jpg (no request sent)',
    posted === 0 &&
      submitDisabled &&
      msgs.some((m) => m.includes('میگابایت')) &&
      msgs.some((m) => m.includes('جعلی')),
    msgs.join(' | '),
  );
});

await step(9, 'Server refuses the same files (final judge, Dari message)', async () => {
  const send = (name, bytes, type) =>
    mgr.evaluate(
      async ({ name, bytes, type, tx }) => {
        const body = new FormData();
        body.append('transaction', String(tx));
        body.append('doc_type', 'OTHER');
        body.append('file', new File([new Uint8Array(bytes)], name, { type }));
        const r = await fetch('/api/documents/', {
          method: 'POST',
          body,
          headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
        });
        return { status: r.status, data: await r.json() };
      },
      { name, bytes: Array.from(bytes), type, tx: txA.id },
    );
  const exe = await send('virus.jpg', EXE, 'image/jpeg');
  const big = await mgr.evaluate(
    async ({ tx }) => {
      const body = new FormData();
      body.append('transaction', String(tx));
      body.append('doc_type', 'OTHER');
      body.append(
        'file',
        new File([new Uint8Array(11 * 1024 * 1024).fill(48)], 'big.pdf', {
          type: 'application/pdf',
        }),
      );
      const r = await fetch('/api/documents/', {
        method: 'POST',
        body,
        headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
      });
      return { status: r.status, data: await r.json() };
    },
    { tx: txA.id },
  );
  check(
    9,
    'Server refuses the same files (final judge, Dari message)',
    exe.status === 400 &&
      JSON.stringify(exe.data).includes('جعلی') &&
      big.status === 400 &&
      JSON.stringify(big.data).includes('میگابایت'),
    `${exe.status} ${JSON.stringify(exe.data)} | ${big.status} ${JSON.stringify(big.data)}`,
  );
});

await step(
  10,
  'API never exposes a raw /media/ URL; download works with the token, 401 without',
  async () => {
    const list = await api(mgr, 'GET', `/documents/?transaction=${txA.id}`);
    const pdfDoc = docs.find((x) => x.content_type === 'application/pdf');
    const withToken = await api(mgr, 'GET', pdfDoc.download_url);
    const without = await api(mgr, 'GET', pdfDoc.download_url, null, { token: false });
    const raw = await mgr.evaluate(async () =>
      (
        await fetch('/api/documents/?x=1', {
          headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
        })
      ).text(),
    );
    check(
      10,
      'API never exposes a raw /media/ URL; download works with the token, 401 without',
      !JSON.stringify(list.data).includes('/media/') &&
        !raw.includes('/media/') &&
        withToken.status === 200 &&
        withToken.type === 'application/pdf' &&
        String.fromCharCode(...withToken.head) === '%PDF' &&
        without.status === 401,
      `with=${withToken.status} ${withToken.type}, without=${without.status}`,
    );
  },
);

await step(11, 'Open: image in a lightbox, PDF in a new tab (blob)', async () => {
  await mgr
    .locator('[data-testid=document-item]', { hasText: 'photo' })
    .getByTestId('document-open')
    .click();
  await mgr.getByTestId('lightbox-image').waitFor({ timeout: 10000 });
  const src = await mgr.getByTestId('lightbox-image').getAttribute('src');
  await mgr.keyboard.press('Escape');
  const popup = mgr.waitForEvent('popup');
  await mgr
    .locator('[data-testid=document-item]', { hasText: 'بارنامه' })
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
    `${src.slice(0, 30)} | ${url.slice(0, 30)}`,
  );
});

await step(
  12,
  'Another branch’s manager cannot see / download / open these documents',
  async () => {
    const listB = await api(mgrB, 'GET', `/documents/?transaction=${txA.id}`);
    const dl = await api(mgrB, 'GET', docs[0].download_url);
    await mgrB.goto(`${BASE}/transactions/${txA.id}`);
    await mgrB.getByTestId('tx-not-available').waitFor({ timeout: 10000 });
    check(
      12,
      'Another branch’s manager cannot see / download / open these documents',
      listB.status === 200 && listB.data.length === 0 && dl.status === 404,
      `list=${listB.data.length}, download=${dl.status}`,
    );
  },
);

await step(13, '«فقط دارای سند» filter (URL state) and the document-count link', async () => {
  await mgr.goto(`${BASE}/transactions?date_from=${tenDaysAgo}&date_to=${today}`);
  await mgr.selectOption('[data-testid=filter-documents]', 'true');
  await mgr.waitForFunction(() => location.search.includes('has_documents=true'));
  await mgr.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length === 1);
  const rows = await mgr.locator('tbody tr[tabindex]').allTextContents();
  await mgr.locator('tbody tr', { hasText: 'B12-1001' }).getByTestId('documents-link').click();
  await mgr.waitForURL(`**/transactions/${txA.id}#documents`);
  await mgr.getByTestId('document-item').first().waitFor();
  // Smooth scrolling takes a moment.
  const inView = await mgr
    .waitForFunction(
      () => {
        const r = document.getElementById('documents').getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      },
      null,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  check(
    13,
    '«فقط دارای سند» filter (URL state) and the document-count link',
    rows.length === 1 && rows[0].includes('B12-1001') && rows[0].includes('۲') && inView,
    rows.join(' | '),
  );
});

await step(14, 'Delete a document (confirm)', async () => {
  await mgr
    .locator('[data-testid=document-item]', { hasText: 'photo' })
    .getByTestId('document-delete')
    .click();
  await mgr.click('[data-testid=confirm-ok]');
  await toast(mgr, 'حذف شد').waitFor({ timeout: 10000 });
  await mgr.waitForFunction(
    () => document.querySelectorAll('[data-testid=document-item]').length === 1,
  );
  const left = (await api(mgr, 'GET', `/documents/?transaction=${txA.id}`)).data;
  check(
    14,
    'Delete a document (confirm)',
    left.length === 1 && left[0].content_type === 'application/pdf',
  );
});

// ================================ History ================================
await step(15, 'History timeline shows an edit (field, old → new, user, dual date)', async () => {
  await mgr.click('[data-testid=detail-edit]');
  await mgr.waitForURL(`**/transactions/${txA.id}/edit`);
  await mgr.fill('[data-testid=field-customer_payment]', '۶۶۰۰');
  for (const f of ['seal_expense', 'scale_ticket_expense', 'gate_ticket_expense']) {
    if (!(await mgr.inputValue(`[data-testid=field-${f}]`)))
      await mgr.fill(`[data-testid=field-${f}]`, '0');
  }
  await mgr.click('[data-testid=tx-submit]');
  await toast(mgr, 'B12-1001').waitFor({ timeout: 10000 });
  await mgr.goto(`${BASE}/transactions/${txA.id}`);
  const item = mgr.getByTestId('history-item').first();
  await item.waitFor({ timeout: 10000 });
  const text = await item.textContent();
  check(
    15,
    'History timeline shows an edit (field, old → new, user, dual date)',
    text.includes('پرداخت مشتری') &&
      text.includes('۶۰۰۰٫۰۰') &&
      text.includes('۶۶۰۰٫۰۰') &&
      text.includes('e2e_mgr') &&
      /20\d\d-\d\d-\d\d/.test(text),
    text,
  );
  await mgr.getByTestId('detail-history').screenshot({ path: `${SHOTS}/04-history.png` });
});

// ======================= Branch manager: today's rate =======================
await step(16, 'Branch manager: past-date rate → 403; delete / edit a rate → 403', async () => {
  const past = await api(mgr, 'POST', '/exchange-rates/', {
    date: await shamsi(mgr, -1),
    currency: 'EUR',
    rate: '80',
  });
  const rates = (await api(mgr, 'GET', `/exchange-rates/?currency=USD&date=${today}`)).data;
  const del = await api(mgr, 'DELETE', `/exchange-rates/${rates[0].id}/`);
  const edit = await api(mgr, 'PATCH', `/exchange-rates/${rates[0].id}/`, { rate: '71' });
  check(
    16,
    'Branch manager: past-date rate → 403; delete / edit a rate → 403',
    past.status === 403 && del.status === 403 && edit.status === 403,
    `past=${past.status} ${JSON.stringify(past.data)}, delete=${del.status}, edit=${edit.status}`,
  );
});

await step(
  17,
  'No rate today: manager sees «ثبت نرخ امروز» on the list and the dashboard',
  async () => {
    const rates = (await api(admin, 'GET', `/exchange-rates/?currency=USD&date=${today}`)).data;
    await api(admin, 'DELETE', `/exchange-rates/${rates[0].id}/`);
    await mgr.goto(`${BASE}/transactions`);
    await mgr.getByTestId('open-rate-dialog').waitFor({ timeout: 10000 });
    await mgr.goto(`${BASE}/dashboard`);
    await mgr.waitForSelector('[data-testid=today-rate-banner][data-state=missing]');
    const cta = await mgr.getByTestId('today-rate-cta').isVisible();
    check(17, 'No rate today: manager sees «ثبت نرخ امروز» on the list and the dashboard', cta);
  },
);

await step(
  18,
  '428 → manager enters today’s rate in the dialog → the save is retried and succeeds',
  async () => {
    await mgr.goto(`${BASE}/transactions/new/IMPORT`);
    await mgr.waitForSelector('[data-testid=tx-form]');
    for (const [f, v] of Object.entries({
      serial_number: 'B12-3001',
      plate_afghan: 'KBL-13',
      driver_name: 'کریم',
      customer_payment: '500',
    })) {
      await mgr.fill(`[data-testid=field-${f}]`, v);
    }
    const t = mgr.locator('[data-testid=field-trader] input');
    await t.click();
    await mgr.locator('[role=option]', { hasText: 'تاجر آزمایشی ۱۲ب' }).click();
    await mgr.click('[data-testid=tx-submit]');
    await mgr.getByTestId('rate-missing-page').waitFor({ timeout: 10000 });
    await mgr.click('[data-testid=rate-missing-cta]');
    await mgr.getByTestId('today-rate-dialog').waitFor();
    const dateNote = await mgr.getByTestId('today-rate-dialog').textContent();
    await mgr.screenshot({ path: `${SHOTS}/05-bm-rate-dialog.png` });
    await mgr.fill('[data-testid=today-rate-input]', '۷۱٫۲۵');
    await mgr.click('[data-testid=today-rate-save]');
    await toast(mgr, 'B12-3001').waitFor({ timeout: 15000 });
    await mgr.waitForURL(/highlight=\d+/);
    const rate = (await api(mgr, 'GET', `/exchange-rates/?currency=USD&date=${today}`)).data[0];
    const saved = (await api(mgr, 'GET', '/transactions/?search=B12-3001')).data.results[0];
    check(
      18,
      '428 → manager enters today’s rate in the dialog → the save is retried and succeeds',
      dateNote.includes(toDari(today)) &&
        rate?.rate === '71.25000000' &&
        saved?.serial_number === 'B12-3001',
      `rate=${rate?.rate}, saved=${saved?.id}`,
    );
  },
);

await step(19, 'Dashboard banner turns green after the manager’s rate', async () => {
  await mgr.goto(`${BASE}/dashboard`);
  await mgr.waitForSelector('[data-testid=today-rate-banner][data-state=set]', { timeout: 10000 });
  check(19, 'Dashboard banner turns green after the manager’s rate', true);
});

// ============================ Delete transaction ============================
await step(20, 'Delete a transaction from its detail page (confirm) — own branch', async () => {
  await mgr.goto(`${BASE}/transactions/${txA.id}`);
  await mgr.click('[data-testid=detail-delete]');
  await mgr.click('[data-testid=confirm-ok]');
  await mgr.waitForURL(/\/transactions$/);
  const r = await api(mgr, 'GET', `/transactions/${txA.id}/`);
  const otherDel = await api(mgr, 'DELETE', `/transactions/${txOther.id}/`);
  check(
    20,
    'Delete a transaction from its detail page (confirm) — own branch',
    r.status === 404 && otherDel.status === 404,
    `after=${r.status}, other branch delete=${otherDel.status}`,
  );
});

check('E', 'No uncaught page errors', errors.length === 0, errors.join(' | '));
await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
