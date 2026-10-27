/**
 * Stage 14 live check: dashboard, income statement page, Excel exports — against the real
 * stack (Django :8000 + Vite :5173).
 *   ..\.venv\Scripts\python scripts\cleanup-stage14.py --setup
 *   node scripts/verify-stage14.mjs <screenshot-dir>
 *   ..\.venv\Scripts\python scripts\cleanup-stage14.py
 * Env: KC_PASS (default: the password cleanup-stage14.py sets), KC_BROWSER, KC_PYTHON.
 * Excel files are opened with openpyxl (scripts/xlsx_dump.py). The load is spread over four
 * users: the API allows each 100 requests a minute.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'stage14-screenshots';
const PASS = process.env.KC_PASS ?? 'E2e-Stage14-Pass-2026';
const PYTHON = process.env.KC_PYTHON ?? '../.venv/Scripts/python.exe';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(SHOTS, { recursive: true });

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
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${username}: ${e}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#username', username);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  return page;
}
const api = (page, url) =>
  page.evaluate(async (url) => {
    const r = await fetch(`/api${url}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
    });
    return { status: r.status, data: await r.json() };
  }, url);
const toDari = (s) => String(s).replace(/\d/g, (x) => String.fromCharCode(0x06f0 + Number(x)));
/** '-10250.00' → '۱۰٬۲۵۰٫۰۰' (formatMoney's fa digits, no sign or symbol). */
const dariMoney = (s) => {
  const [i, f = '00'] = String(s).replace('-', '').split('.');
  return toDari(`${i.replace(/\B(?=(\d{3})+(?!\d))/g, '٬')}٫${f.padEnd(2, '0').slice(0, 2)}`);
};
const text = (p, id) => p.getByTestId(id).first().textContent();
const xlsx = (file) => {
  const r = spawnSync(PYTHON, ['scripts/xlsx_dump.py', file], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
async function download(page, click, name) {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  const target = path.join(SHOTS, name);
  await file.saveAs(target);
  return { target, suggested: file.suggestedFilename() };
}

const mgr = await session('e2e_mgr'); // branch A: dashboard
const mgr2 = await session('e2e_mgr_a2'); // branch A: income statement page and exports
const mgrB = await session('e2e_mgr_b');
const admin = await session('e2e_admin');
pages = { mgr, mgr2, mgrB, admin };
const me = (await api(mgr, '/auth/me/')).data;
const A = me.branch.id;
const B = (await api(mgrB, '/auth/me/')).data.branch.id;
const C = (await api(admin, '/branches/?search=E2E14C')).data.find((b) => b.code === 'E2E14C').id;
const dates = await mgr.evaluate(async () => {
  const m = await import('/src/lib/reports.ts');
  const d = await import('/src/lib/date.ts');
  return {
    month: m.presetRange('this_month'),
    last: m.presetRange('last_month'),
    today: d.todayShamsi(),
    lossDay: d.shiftShamsi(m.presetRange('this_month').from, 1, 'day'),
    old: d.shiftShamsi(d.todayShamsi(), -400, 'day'),
  };
});
const statement = async (p, from, to, branch) =>
  (
    await api(
      p,
      `/income-statement/?date_from=${from}&date_to=${to}${branch ? `&branch=${branch}` : ''}`,
    )
  ).data;
const cur = await statement(admin, dates.month.from, dates.month.to, A);
const prev = await statement(admin, dates.last.from, dates.last.to, A);

// ================================ dashboard ================================
await step(1, 'BM dashboard KPIs = income statement of this month (own branch)', async () => {
  await mgr.getByTestId('kpi-net-value').waitFor();
  const shown = {
    count: await text(mgr, 'kpi-count-value'),
    revenue: await text(mgr, 'kpi-revenue-value'),
    expenses: await text(mgr, 'kpi-expenses-value'),
    net: await text(mgr, 'kpi-net-value'),
    netUsd: await text(mgr, 'kpi-net-usd'),
  };
  const s = cur.summary;
  await mgr.waitForTimeout(800);
  await mgr.screenshot({ path: `${SHOTS}/dashboard-manager.png`, fullPage: true });
  check(
    1,
    'BM dashboard KPIs = income statement of this month (own branch)',
    s.net_profit_afn === '10250.00' &&
      shown.count.includes(toDari(s.transactions_count)) &&
      shown.revenue.includes(dariMoney(s.revenue_afn)) &&
      shown.expenses.includes(dariMoney(s.expenses_afn)) &&
      shown.net.includes(dariMoney(s.net_profit_afn)) &&
      shown.netUsd.includes(dariMoney(s.net_profit_usd)),
    `${JSON.stringify(shown)} | ${JSON.stringify(s)}`,
  );
});

await step(2, 'Previous-month comparison: change % and last month’s value', async () => {
  const rev = await text(mgr, 'kpi-revenue-change');
  const net = await text(mgr, 'kpi-net-change');
  const pct = (((17500 - 8000) / 8000) * 100).toFixed(1); // 118.8
  check(
    2,
    'Previous-month comparison: change % and last month’s value',
    prev.summary.revenue_afn === '8000.00' &&
      rev.includes(toDari(pct).replace('.', '٫')) &&
      rev.includes(dariMoney(prev.summary.revenue_afn)) &&
      net.includes(dariMoney(prev.summary.net_profit_afn)),
    `${rev} | ${net}`,
  );
});

await step(
  3,
  'Daily net profit chart renders: a bar per day with data, loss in the loss colour',
  async () => {
    await mgr.waitForSelector('[data-testid=net-profit-chart] .recharts-bar-rectangle path');
    const fills = await mgr
      .locator('[data-testid=net-profit-chart] .recharts-bar-rectangle path')
      .evaluateAll((ps) => ps.map((p) => p.getAttribute('fill')));
    const days = (await api(mgr, '/dashboard/summary/')).data.daily;
    const withData = days.filter((d) => Number(d.net_profit_afn) !== 0).length;
    const sum = days.reduce((a, d) => a + Number(d.net_profit_afn), 0);
    check(
      3,
      'Daily net profit chart renders: a bar per day with data, loss in the loss colour',
      fills.length >= withData &&
        fills.includes('var(--chart-loss)') &&
        fills.includes('var(--chart-profit)') &&
        sum.toFixed(2) === cur.summary.net_profit_afn,
      `bars=${fills.length} withData=${withData} sum=${sum}`,
    );
  },
);

await step(4, 'Chart tooltip on hover: date (Shamsi + Gregorian) and net profit', async () => {
  const bar = mgr.locator('[data-testid=net-profit-chart] .recharts-bar-rectangle').first();
  await bar.hover();
  await mgr.waitForSelector('.recharts-tooltip-wrapper p');
  const tip = await mgr.locator('.recharts-tooltip-wrapper').textContent();
  check(
    4,
    'Chart tooltip on hover: date (Shamsi + Gregorian) and net profit',
    tip.includes('مفاد خالص') && /20\d\d-\d\d-\d\d/.test(tip),
    tip,
  );
});

await step(
  5,
  'Top traders (this month, AFN + USD) and recent transactions link to detail',
  async () => {
    const top = await text(mgr, 'top-traders');
    const first = await mgr.locator('[data-testid=top-traders] li').first().textContent();
    await mgr.locator('[data-testid=recent-link]', { hasText: 'S14-003' }).click();
    await mgr.waitForURL(/\/transactions\/\d+$/);
    await mgr.waitForFunction(() =>
      document.querySelector('main')?.textContent.includes('S14-003'),
    );
    const heading = await mgr.locator('main').textContent();
    check(
      5,
      'Top traders (this month, AFN + USD) and recent transactions link to detail',
      first.includes('تاجر ۱۴ الف') &&
        first.includes('۱۰٬۵۰۰٫۰۰') &&
        top.includes('$') &&
        heading.includes('S14-003'),
      `${first} | ${mgr.url()}`,
    );
  },
);

await step(
  6,
  'BM sees only own branch: no comparison, no B rows, ?branch=B ignored with warning',
  async () => {
    await mgr.goto(`${BASE}/dashboard?branch=${B}`);
    await mgr.getByTestId('kpi-net-value').waitFor();
    const comparison = await mgr.getByTestId('branch-comparison').count();
    const recent = await mgr.locator('[data-testid=recent-link]').allTextContents();
    const forced = (await api(mgr, `/dashboard/summary/?branch=${B}`)).data;
    check(
      6,
      'BM sees only own branch: no comparison, no B rows, ?branch=B ignored with warning',
      comparison === 0 &&
        !recent.includes('S14-B01') &&
        forced.branch === A &&
        forced.warnings.some((w) => w.includes('بندر خود')) &&
        !('branches' in forced),
      `cmp=${comparison} recent=${recent} branch=${forced.branch}`,
    );
  },
);

await step(7, 'BM rate card: today’s rate set (banner green)', async () => {
  const state = await mgr.getByTestId('today-rate-banner').getAttribute('data-state');
  check(7, 'BM rate card: today’s rate set (banner green)', state === 'set', state);
});

await step(
  8,
  'Super admin: branch comparison rows = each branch’s statement; sortable',
  async () => {
    await admin.goto(`${BASE}/dashboard`);
    await admin.getByTestId('branch-comparison').waitFor();
    const table = admin.getByTestId('branch-comparison');
    const rowA = await table.locator('tbody tr', { hasText: 'بندر آزمایشی ۱۴ الف' }).textContent();
    const rowB = await table.locator('tbody tr', { hasText: 'بندر آزمایشی ۱۴ ب' }).textContent();
    const b = await statement(admin, dates.month.from, dates.month.to, B);
    const order = async () => table.locator('tbody tr td:first-child').allTextContents();
    const before = await order();
    await table.getByRole('button', { name: /مفاد/ }).click();
    const after = await order();
    await admin.waitForTimeout(800);
    await admin.screenshot({ path: `${SHOTS}/dashboard-admin.png`, fullPage: true });
    check(
      8,
      'Super admin: branch comparison rows = each branch’s statement; sortable',
      rowA.includes(dariMoney(cur.summary.net_profit_afn)) &&
        rowB.includes(dariMoney(b.summary.net_profit_afn)) &&
        JSON.stringify(before) !== JSON.stringify(after),
      `${rowA} | ${rowB} | ${before.slice(0, 3)} → ${after.slice(0, 3)}`,
    );
  },
);

await step(
  9,
  'Super admin dashboard per branch; empty-month state for a branch with nothing',
  async () => {
    await admin.selectOption('[data-testid=dashboard-branch]', String(A));
    await admin.waitForFunction(
      (v) => document.querySelector('[data-testid=kpi-net-value]')?.textContent.includes(v),
      dariMoney(cur.summary.net_profit_afn),
    );
    await admin.selectOption('[data-testid=dashboard-branch]', String(C));
    await admin.getByTestId('empty-month').waitFor();
    const comparison = await admin.getByTestId('branch-comparison').count();
    check(
      9,
      'Super admin dashboard per branch; empty-month state for a branch with nothing',
      comparison === 0,
      `cmp=${comparison}`,
    );
  },
);

// ================================ income statement page ================================
await step(10, 'Income statement page (BM): IAS 1 sections, subtotals and net = API', async () => {
  await mgr2.goto(`${BASE}/reports/income-statement`);
  await mgr2.getByTestId('total-net').waitFor();
  const net = await text(mgr2, 'total-net-afn');
  const gross = await text(mgr2, 'total-gross-afn');
  const lines = await mgr2.getByTestId('statement-line').count();
  const heads = await mgr2.locator('tbody th[scope=rowgroup]').allTextContents();
  await mgr2.screenshot({ path: `${SHOTS}/income-statement.png`, fullPage: true });
  check(
    10,
    'Income statement page (BM): IAS 1 sections, subtotals and net = API',
    net.includes(dariMoney(cur.totals.net_profit_afn)) &&
      gross.includes(dariMoney(cur.totals.gross_profit_afn)) &&
      lines === cur.lines.length &&
      heads.length === 4,
    `net=${net} gross=${gross} lines=${lines} heads=${heads}`,
  );
});

await step(
  11,
  'Preset «ماه گذشته»: period in the URL, figures = last month’s statement',
  async () => {
    await mgr2.click('[data-testid=preset-last_month]');
    await mgr2.waitForURL(/preset=last_month/);
    await mgr2.waitForFunction(
      (v) => document.querySelector('[data-testid=total-net-afn]')?.textContent.includes(v),
      dariMoney(prev.totals.net_profit_afn),
    );
    check(
      11,
      'Preset «ماه گذشته»: period in the URL, figures = last month’s statement',
      true,
      prev.totals.net_profit_afn,
    );
  },
);

await step(12, 'Custom range on the loss day: negative net in parentheses and red', async () => {
  const loss = await statement(mgr2, dates.lossDay, dates.lossDay);
  await mgr2.goto(
    `${BASE}/reports/income-statement?preset=custom&date_from=${dates.lossDay}&date_to=${dates.lossDay}`,
  );
  await mgr2.waitForFunction(
    (v) => document.querySelector('[data-testid=total-net-afn]')?.textContent.includes(v),
    dariMoney(loss.totals.net_profit_afn),
  );
  const cell = mgr2.getByTestId('total-net-afn').locator('span');
  const shown = await cell.textContent();
  const cls = await cell.getAttribute('class');
  check(
    12,
    'Custom range on the loss day: negative net in parentheses and red',
    loss.totals.net_profit_afn.startsWith('-') &&
      shown.startsWith('(') &&
      shown.endsWith(')') &&
      cls.includes('text-red'),
    `${loss.totals.net_profit_afn} → ${shown} ${cls}`,
  );
});

await step(
  13,
  'Drill-down: tariff line → transactions filtered by period, branch and field',
  async () => {
    await mgr2.goto(`${BASE}/reports/income-statement`);
    const code = cur.lines.find((l) => l.source_field === 'tariff_expense').code;
    await mgr2.locator(`[data-code=${code}] [data-testid=drill-down]`).click();
    await mgr2.waitForURL(/\/transactions\?.*nonzero=tariff_expense/);
    await mgr2.getByTestId('nonzero-chip').waitFor();
    await mgr2.waitForSelector('tbody tr[tabindex]');
    const shown = await mgr2.locator('tbody tr[tabindex]').count();
    const q = `date_from=${dates.month.from}&date_to=${dates.month.to}&nonzero=tariff_expense`;
    const apiCount = (await api(mgr2, `/transactions/?${q}`)).data.count;
    const url = new URL(mgr2.url());
    check(
      13,
      'Drill-down: tariff line → transactions filtered by period, branch and field',
      shown === apiCount &&
        apiCount === 2 &&
        url.searchParams.get('date_from') === dates.month.from &&
        url.searchParams.get('branch') === String(A),
      `${mgr2.url()} rows=${shown} api=${apiCount}`,
    );
  },
);

await step(14, 'Drill-down: office-expense line → office expenses without salary', async () => {
  await mgr2.goto(`${BASE}/reports/income-statement`);
  const code = cur.lines.find((l) => l.source_field === '@office_expense').code;
  await mgr2.locator(`[data-code=${code}] [data-testid=drill-down]`).click();
  await mgr2.waitForURL(/\/finance\/office-expenses\?.*kind=non_salary/);
  await mgr2.getByTestId('kind-chip').waitFor();
  await mgr2.getByTestId('totals').waitFor();
  const total = await text(mgr2, 'total-amount-afn');
  const line = cur.lines.find((l) => l.code === code);
  check(
    14,
    'Drill-down: office-expense line → office expenses without salary',
    total.includes(dariMoney(line.amount_afn)),
    `${total} vs ${line.amount_afn}`,
  );
});

await step(15, 'Warnings panel: a period without any USD rate shows the warning', async () => {
  await mgr2.goto(
    `${BASE}/reports/income-statement?preset=custom&date_from=${dates.old}&date_to=${dates.month.to}`,
  );
  await mgr2.getByTestId('report-warnings').waitFor();
  const warn = await text(mgr2, 'report-warnings');
  check(
    15,
    'Warnings panel: a period without any USD rate shows the warning',
    warn.includes('نرخ دالر'),
    warn.slice(0, 160),
  );
});

await step(16, 'Super admin income statement: branch selector (all → B) = API', async () => {
  await admin.goto(`${BASE}/reports/income-statement`);
  await admin.getByTestId('total-net').waitFor();
  const all = await statement(admin, dates.month.from, dates.month.to);
  const allShown = await text(admin, 'total-net-afn');
  await admin.selectOption('[data-testid=report-branch]', String(B));
  const b = await statement(admin, dates.month.from, dates.month.to, B);
  await admin.waitForFunction(
    (v) => document.querySelector('[data-testid=total-net-afn]')?.textContent.includes(v),
    dariMoney(b.totals.net_profit_afn),
  );
  check(
    16,
    'Super admin income statement: branch selector (all → B) = API',
    allShown.includes(dariMoney(all.totals.net_profit_afn)),
    `${allShown} ${b.totals.net_profit_afn}`,
  );
});

await step(
  17,
  'Print view: header with branch, period, generated-at; controls hidden',
  async () => {
    await mgr2.goto(`${BASE}/reports/income-statement`);
    await mgr2.getByTestId('total-net').waitFor();
    await mgr2.emulateMedia({ media: 'print' });
    const header = await mgr2.getByTestId('print-header').isVisible();
    const headerText = await text(mgr2, 'print-header');
    const controls = await mgr2.getByTestId('excel-button').isVisible();
    await mgr2.screenshot({ path: `${SHOTS}/income-statement-print.png`, fullPage: true });
    await mgr2.pdf({ path: `${SHOTS}/income-statement-print.pdf`, format: 'A4' }).catch(() => {});
    await mgr2.emulateMedia({ media: 'screen' });
    check(
      17,
      'Print view: header with branch, period, generated-at; controls hidden',
      header &&
        !controls &&
        headerText.includes('بندر آزمایشی ۱۴ الف') &&
        headerText.includes('ساخته‌شده') &&
        headerText.includes(toDari(dates.month.from)),
      headerText,
    );
  },
);

// ================================ Excel ================================
let isFile;
await step(
  18,
  'Income statement Excel: RTL, frozen header, Vazirmatn, numeric cells, net = API',
  async () => {
    isFile = await download(
      mgr2,
      () => mgr2.click('[data-testid=excel-button]'),
      'income-statement.xlsx',
    );
    const x = xlsx(isFile.target);
    const netRow = x.rows.find((r) => r[1] === 'مفاد / ضرر خالص');
    const lineRows = x.rows.slice(4).filter((r) => r[0] && !String(r[0]).startsWith('⚠'));
    const numericLines = x.rows
      .slice(4)
      .every((r, i) => !(r[0] && !String(r[0]).startsWith('⚠')) || x.numeric[i + 4][2]);
    check(
      18,
      'Income statement Excel: RTL, frozen header, Vazirmatn, numeric cells, net = API',
      isFile.suggested.endsWith('.xlsx') &&
        x.rtl &&
        x.freeze === 'A5' &&
        x.font === 'Vazirmatn' &&
        netRow &&
        netRow[2].toFixed(2) === cur.totals.net_profit_afn &&
        lineRows.length === cur.lines.length &&
        numericLines &&
        String(x.rows[1][0]).includes('بندر آزمایشی ۱۴ الف'),
      `${isFile.suggested} rtl=${x.rtl} net=${netRow?.[2]} lines=${lineRows.length}`,
    );
  },
);

await step(
  19,
  'Transactions Excel from the list (current filters): all rows, numeric, totals = API',
  async () => {
    await mgr2.goto(`${BASE}/transactions?date_from=${dates.old}&date_to=${dates.today}`);
    await mgr2.waitForSelector('tbody tr[tabindex]');
    const f = await download(
      mgr2,
      () => mgr2.click('[data-testid=export-transactions]'),
      'transactions.xlsx',
    );
    const x = xlsx(f.target);
    const body = x.rows.slice(4, -1);
    const total = x.rows.at(-1);
    const listed = (
      await api(mgr2, `/transactions/?date_from=${dates.old}&date_to=${dates.today}&page_size=200`)
    ).data;
    const profit = listed.results.reduce((a, r) => a + Number(r.row_summary.profit_or_loss_afn), 0);
    check(
      19,
      'Transactions Excel from the list (current filters): all rows, numeric, totals = API',
      x.rtl &&
        body.length === listed.count &&
        listed.count === 5 &&
        total[0] === 'جمع' &&
        total.at(-2).toFixed(2) === profit.toFixed(2) &&
        x.numeric.slice(4, -1).every((r) => r[12]) &&
        !body.some((r) => r[0] === 'S14-B01') &&
        body.some((r) => /^14\d\d-\d\d-\d\d$/.test(r[1]) && /^20\d\d-\d\d-\d\d$/.test(r[2])),
      `rows=${body.length} api=${listed.count} profit=${total.at(-2)} vs ${profit}`,
    );
  },
);

await step(20, 'Super admin export with branch filter: only that branch’s rows', async () => {
  await admin.goto(
    `${BASE}/transactions?branch=${B}&date_from=${dates.month.from}&date_to=${dates.month.to}`,
  );
  await admin.waitForSelector('tbody tr[tabindex]');
  const f = await download(
    admin,
    () => admin.click('[data-testid=export-transactions]'),
    'transactions-b.xlsx',
  );
  const x = xlsx(f.target);
  const body = x.rows.slice(4, -1);
  check(
    20,
    'Super admin export with branch filter: only that branch’s rows',
    body.length === 1 &&
      body[0][0] === 'S14-B01' &&
      String(x.rows[1][0]).includes('بندر آزمایشی ۱۴ ب'),
    JSON.stringify(body.map((r) => r[0])),
  );
});

await step(21, 'Exports are written to the security log (who, what)', async () => {
  const log = fs.readFileSync('../logs/security.log', 'utf-8').split('\n').slice(-200).join('\n');
  check(
    21,
    'Exports are written to the security log (who, what)',
    /export .*actor='e2e_mgr_a2'.*kind='income_statement'/.test(log) &&
      /export .*actor='e2e_mgr_a2'.*kind='transactions'/.test(log) &&
      /export .*actor='e2e_admin'.*kind='transactions'/.test(log),
    log
      .split('\n')
      .filter((l) => l.includes('export'))
      .slice(-3)
      .join(' || ')
      .slice(0, 250),
  );
});

await step(
  22,
  'BM API scoping of exports: another branch’s id gives own branch only (statement)',
  async () => {
    const r = await mgr2.evaluate(async (b) => {
      const res = await fetch(`/api/income-statement/export/?branch=${b}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
      });
      return {
        status: res.status,
        type: res.headers.get('content-type'),
        size: (await res.arrayBuffer()).byteLength,
      };
    }, B);
    const json = await api(mgr2, `/income-statement/?branch=${B}`);
    check(
      22,
      'BM API scoping of exports: another branch’s id gives own branch only (statement)',
      r.status === 200 && r.type.includes('spreadsheetml') && json.data.branch.id === A,
      `${r.status} ${r.type} ${json.data.branch.id}`,
    );
  },
);

await step(23, 'Sidebar: «گزارش عاید» enabled for both roles', async () => {
  const href = async (p) => p.locator('nav a', { hasText: 'گزارش عاید' }).getAttribute('href');
  check(
    23,
    'Sidebar: «گزارش عاید» enabled for both roles',
    (await href(mgrB)) === '/reports/income-statement' &&
      (await href(admin)) === '/reports/income-statement',
  );
});

await step(24, 'English UI: dashboard KPI and chart axis in English digits', async () => {
  await mgrB.evaluate(async () =>
    (await import('/src/i18n/index.ts')).default.changeLanguage('en'),
  );
  await mgrB.goto(`${BASE}/dashboard`);
  await mgrB.getByTestId('kpi-net-value').waitFor();
  await mgrB.waitForSelector('[data-testid=net-profit-chart] .recharts-cartesian-axis-tick');
  const kpi = await text(mgrB, 'kpi-revenue-value');
  const ticks = await mgrB
    .locator('.recharts-xAxis .recharts-cartesian-axis-tick')
    .allTextContents();
  await mgrB.evaluate(async () =>
    (await import('/src/i18n/index.ts')).default.changeLanguage('fa'),
  );
  check(
    24,
    'English UI: dashboard KPI and chart axis in English digits',
    /4,000\.00/.test(kpi) && ticks.every((x) => /^[0-9]+$/.test(x)),
    `${kpi} | ${ticks}`,
  );
});

await step(25, 'No uncaught page errors in any session', async () => {
  check(25, 'No uncaught page errors in any session', errors.length === 0, errors.join(' | '));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
