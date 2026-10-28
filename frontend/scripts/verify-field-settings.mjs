/**
 * Field settings live check: the super admin's /admin/field-settings page (branch × trade type
 * table, 3-state visibility, ordering by buttons and drag, locked fields, staged changes with
 * the unsaved bar, leave-page confirm, live preview, hidden-field warning, history, copy,
 * copy to all, reset) and its effect on the real transaction form of the branch managers —
 * against the real stack (Django + Vite).
 *   ..\.venv\Scripts\python scripts\cleanup-field-settings.py --setup
 *   node scripts/verify-field-settings.mjs <screenshot-dir>
 *   ..\.venv\Scripts\python scripts\cleanup-field-settings.py
 * Env: KC_BASE_URL, KC_PASS (default: the password cleanup-field-settings.py sets), KC_BROWSER.
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'field-settings-screenshots';
const PASS = process.env.KC_PASS ?? 'E2e-Fields-Pass-2026';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(SHOTS, { recursive: true });
const FA = JSON.parse(fs.readFileSync(new URL('../src/i18n/locales/fa.json', import.meta.url)));
const PS = JSON.parse(fs.readFileSync(new URL('../src/i18n/locales/ps.json', import.meta.url)));
const EN = JSON.parse(fs.readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url)));

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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
const api = (page, method, url, body) =>
  page.evaluate(
    async ({ method, url, body }) => {
      const send = () =>
        fetch(`/api${url}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('kc.access')}`,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      let r = await send();
      if (r.status === 429) {
        const wait = Math.min(Number(r.headers.get('retry-after')) || 30, 65);
        await new Promise((done) => setTimeout(done, wait * 1000));
        r = await send();
      }
      const text = await r.text();
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: r.status, data };
    },
    { method, url, body },
  );
const toast = (p, text) => p.locator('div[role=status]', { hasText: text }).first();

const admin = await session('e2e_fc_admin');
const mgr = await session('e2e_fc_mgr');
const mgr2 = await session('e2e_fc_mgr2');
pages = { admin, mgr, mgr2 };
const A = (await api(mgr, 'GET', '/auth/me/')).data.branch.id;
const B = (await api(mgr2, 'GET', '/auth/me/')).data.branch.id;

const SETTINGS = (b, tt = 'IMPORT') => `${BASE}/admin/field-settings?branch=${b}&type=${tt}`;
async function openSettings(b, tt = 'IMPORT') {
  await admin.goto(SETTINGS(b, tt));
  await admin.getByTestId('fs-row-goods_type').waitFor();
}
/** {field_name: [visibility, sort_order]} of one branch × trade type, from the API. */
async function settingsOf(page, b, tt = 'IMPORT') {
  const rows = (await api(page, 'GET', `/field-configs/?branch=${b}&trade_type=${tt}`)).data;
  return Object.fromEntries(rows.map((r) => [r.field_name, [r.visibility, r.sort_order]]));
}
const same = (x, y) =>
  JSON.stringify(Object.entries(x).sort()) === JSON.stringify(Object.entries(y).sort());
/** Field names of one form section, in screen order. */
const sectionOrder = (page, scope, section) =>
  page.$$eval(`${scope} [data-testid=section-${section}] [data-testid^="field-"]`, (els) => [
    ...new Set(
      els
        .map((e) => e.getAttribute('data-testid').replace(/^field-/, ''))
        .filter((n) => !/-(clear|add-new|input)$/.test(n)),
    ),
  ]);
async function realForm(page) {
  await page.goto(`${BASE}/transactions/new/IMPORT`);
  await page.getByTestId('tx-form').waitFor();
  await page.getByTestId('field-serial_number').waitFor();
}

await step(1, 'Sidebar item opens the page (no «به‌زودی» badge)', async () => {
  const link = admin.locator('[data-testid=nav-admin] a[href="/admin/field-settings"]');
  const badge = await admin
    .locator('[data-testid=nav-admin]', { hasText: FA.nav.coming_soon })
    .count();
  await link.click();
  await admin.getByRole('heading', { level: 1, name: FA.field_settings.title }).waitFor();
  await admin.getByTestId('fs-row-goods_type').waitFor();
  check(1, 'Sidebar item opens the page (no «به‌زودی» badge)', badge === 0, admin.url());
});

await step(2, 'Branch manager gets the 403 page', async () => {
  await mgr.goto(`${BASE}/admin/field-settings`);
  await mgr.getByRole('heading', { name: FA.errors.forbidden_title }).waitFor();
  const rows = await mgr.locator('[data-testid^=fs-row-]').count();
  const usage = await api(mgr, 'GET', `/field-configs/usage/?branch=${A}&trade_type=IMPORT`);
  const bulk = await api(mgr, 'PATCH', '/field-configs/bulk/', []);
  check(
    2,
    'Branch manager gets the 403 page',
    rows === 0 && usage.status === 403 && bulk.status === 403,
    `rows=${rows} usage=${usage.status} bulk=${bulk.status}`,
  );
});

await step(
  3,
  'All 29 non-money fields in the 6 form sections (money fields: «عواید و مصارف»); four trade-type tabs',
  async () => {
    await openSettings(A);
    const rows = await admin.locator('[data-testid^=fs-row-]').count();
    const sections = await admin.locator('[data-testid^=fs-section-]').count();
    const tabs = await admin.locator('[role=tab]').allTextContents();
    const mono = await admin.getByTestId('fs-row-goods_type').locator('code').textContent();
    await admin.screenshot({ path: `${SHOTS}/01-table.png`, fullPage: false });
    check(
      3,
      'All 29 non-money fields in the 6 form sections (money fields: «عواید و مصارف»); four trade-type tabs',
      // The 14 revenue / expense columns are managed on «عواید و مصارف» (only a link here).
      rows === 29 &&
        sections === 6 &&
        tabs.length === 4 &&
        tabs.includes(FA.trade_types.TIR_CARNET) &&
        mono === 'goods_type',
      `rows=${rows} sections=${sections} tabs=${tabs.join('/')}`,
    );
  },
);

await step(4, 'Locked fields: lock icon, controls disabled, API 400 in Dari', async () => {
  const locks = await admin.locator('[data-testid^=fs-lock-]').count();
  const disabled = await admin.getByTestId('fs-vis-currency-HIDDEN').locator('input').isDisabled();
  await admin.getByTestId('fs-vis-currency-HIDDEN').click({ force: true });
  const bar = await admin.getByTestId('fs-unsaved-bar').count();
  const title = await admin.getByTestId('fs-lock-currency').getAttribute('title');
  const rows = (await api(admin, 'GET', `/field-configs/?branch=${A}&trade_type=IMPORT`)).data;
  const currency = rows.find((r) => r.field_name === 'currency');
  const res = await api(admin, 'PATCH', `/field-configs/${currency.id}/`, { visibility: 'HIDDEN' });
  await admin.getByTestId('fs-row-currency').scrollIntoViewIfNeeded();
  await admin.getByTestId('fs-lock-currency').hover();
  await admin.screenshot({ path: `${SHOTS}/03-locked-field.png` });
  check(
    4,
    'Locked fields: lock icon, controls disabled, API 400 in Dari',
    locks === 4 && // serial, date, currency, rate; customer_payment's lock is on «عواید و مصارف»
      disabled &&
      bar === 0 &&
      title === FA.field_settings.locked &&
      res.status === 400 &&
      /قفل/.test(res.data.visibility?.[0] ?? ''),
    `locks=${locks} disabled=${disabled} bar=${bar} api=${res.status} ${JSON.stringify(res.data)}`,
  );
});

await step(5, 'Staged HIDDEN: preview drops the field at once; unsaved bar counts 1', async () => {
  const preview = admin.locator('[data-testid=fs-preview] [data-testid=field-goods_type]');
  const before = await preview.count();
  await admin.getByTestId('fs-vis-goods_type-HIDDEN').click();
  await admin.getByTestId('fs-unsaved-bar').waitFor();
  const after = await preview.count();
  const bar = await admin.getByTestId('fs-unsaved-bar').textContent();
  const saved = (await settingsOf(admin, A)).goods_type[0];
  check(
    5,
    'Staged HIDDEN: preview drops the field at once; unsaved bar counts 1',
    before === 1 &&
      after === 0 &&
      bar.includes(FA.field_settings.unsaved.replace('{{count}}', '1')) &&
      saved === 'OPTIONAL',
    `preview ${before}→${after}, bar="${bar}", saved=${saved}`,
  );
});

await step(6, 'Hidden field with data: warning shows the API count (3)', async () => {
  const usage = (await api(admin, 'GET', `/field-configs/usage/?branch=${A}&trade_type=IMPORT`))
    .data;
  const text = await admin.getByTestId('fs-warning-goods_type').textContent();
  await admin.getByTestId('fs-row-goods_type').scrollIntoViewIfNeeded();
  await admin.screenshot({ path: `${SHOTS}/02-preview-and-warning.png` });
  check(
    6,
    'Hidden field with data: warning shows the API count (3)',
    usage.goods_type === 3 &&
      text.startsWith('3 ') &&
      text.includes('جزئیات') &&
      (await admin.getByTestId('fs-warning-remarks').count()) === 0,
    `usage=${usage.goods_type} text="${text}"`,
  );
});

await step(7, 'Cancel drops every staged change', async () => {
  await admin.getByTestId('fs-cancel').click();
  const bar = await admin.getByTestId('fs-unsaved-bar').count();
  const vis = await admin.getByTestId('fs-row-goods_type').getAttribute('data-visibility');
  const preview = await admin
    .locator('[data-testid=fs-preview] [data-testid=field-goods_type]')
    .count();
  check(7, 'Cancel drops every staged change', bar === 0 && vis === 'OPTIONAL' && preview === 1);
});

await step(
  8,
  'Leaving with unsaved changes asks; «stay» keeps them, «leave» drops them',
  async () => {
    await admin.getByTestId('fs-vis-remarks-HIDDEN').click();
    await admin.locator('nav a[href="/dashboard"]').first().click();
    const dialog = admin.locator('[role=alertdialog]');
    await dialog.waitFor();
    const asked = (await dialog.textContent()).includes(FA.field_settings.leave_title);
    await dialog.getByRole('button', { name: FA.common.cancel }).click();
    await dialog.waitFor({ state: 'detached' });
    const stayed = admin.url().includes('/admin/field-settings');
    const kept = await admin.getByTestId('fs-unsaved-bar').count();
    await admin.locator('nav a[href="/dashboard"]').first().click();
    await admin.getByTestId('confirm-ok').click();
    await admin.waitForURL('**/dashboard');
    const saved = (await settingsOf(admin, A)).remarks[0];
    check(
      8,
      'Leaving with unsaved changes asks; «stay» keeps them, «leave» drops them',
      asked && stayed && kept === 1 && saved === 'OPTIONAL',
      `asked=${asked} stayed=${stayed} kept=${kept} saved=${saved}`,
    );
  },
);

await step(9, 'Save: HIDDEN stored with the bulk endpoint, bar gone', async () => {
  await openSettings(A);
  await admin.getByTestId('fs-vis-goods_type-HIDDEN').click();
  await admin.getByTestId('fs-save').click();
  await toast(admin, FA.field_settings.saved.replace('{{count}}', '1')).waitFor();
  const bar = await admin.getByTestId('fs-unsaved-bar').count();
  const saved = (await settingsOf(admin, A)).goods_type[0];
  check(9, 'Save: HIDDEN stored with the bulk endpoint, bar gone', bar === 0 && saved === 'HIDDEN');
});

await step(
  10,
  'Hidden field gone from the real form of that branch, still there for another',
  async () => {
    await realForm(mgr);
    const hiddenA = await mgr.getByTestId('field-goods_type').count();
    await realForm(mgr2);
    const shownB = await mgr2.getByTestId('field-goods_type').count();
    check(
      10,
      'Hidden field gone from the real form of that branch, still there for another',
      hiddenA === 0 && shownB === 1,
      `A=${hiddenA} B=${shownB}`,
    );
  },
);

await step(11, 'Detail page still shows the hidden field’s value', async () => {
  const list = (await api(mgr, 'GET', '/transactions/?search=E2EFC-1')).data;
  const tx = (list.results ?? list).find((x) => x.serial_number === 'E2EFC-1');
  await mgr.goto(`${BASE}/transactions/${tx.id}`);
  await mgr.getByTestId('detail-section-vehicle').waitFor();
  const text = await mgr.getByTestId('detail-section-vehicle').textContent();
  check(
    11,
    'Detail page still shows the hidden field’s value',
    text.includes('آرد-E2EFC') && text.includes(FA.form.goods_type),
    text.slice(0, 120),
  );
});

await step(12, 'History: the change, the user and both dates', async () => {
  await admin.getByTestId('fs-history-goods_type').click();
  await admin.getByTestId('history-item').first().waitFor();
  const first = admin.getByTestId('history-item').first();
  const text = await first.textContent();
  await admin.screenshot({ path: `${SHOTS}/05-history.png` });
  const url = admin.url();
  await admin.keyboard.press('Escape');
  await admin.getByTestId('history-modal').waitFor({ state: 'detached' });
  check(
    12,
    'History: the change, the user and both dates',
    text.includes('e2e_fc_admin') &&
      text.includes(FA.field_settings.visibility_field) &&
      text.includes('پنهان') &&
      /[1۱][4۴][0-9۰-۹]{2}/.test(text) && // Shamsi year, in Dari digits
      /20\d\d/.test(text) &&
      /\/admin\/field-settings\/\d+\/history/.test(url),
    text.slice(0, 160),
  );
});

await step(13, 'REQUIRED: the real form marks the field and blocks saving without it', async () => {
  await realForm(mgr);
  const before = await mgr.getByTestId('field-driver_phone').getAttribute('aria-required');
  await admin.getByTestId('fs-vis-driver_phone-REQUIRED').click();
  await admin.getByTestId('fs-save').click();
  await toast(admin, FA.field_settings.saved.replace('{{count}}', '1')).waitFor();
  await realForm(mgr);
  const after = await mgr.getByTestId('field-driver_phone').getAttribute('aria-required');
  await mgr.getByTestId('field-serial_number').fill('E2EFC-REQ');
  await mgr.getByTestId('field-customer_payment').fill('500');
  await mgr.getByTestId('tx-submit').click();
  await mgr.locator('[data-testid=field-driver_phone][aria-invalid=true]').waitFor();
  const stillHere = mgr.url().includes('/transactions/new/IMPORT');
  const created = (await api(mgr, 'GET', '/transactions/?search=E2EFC-REQ')).data;
  check(
    13,
    'REQUIRED: the real form marks the field and blocks saving without it',
    before === null && after === 'true' && stillHere && (created.count ?? created.length) === 0,
    `before=${before} after=${after} url=${mgr.url()}`,
  );
});

await step(14, 'Reorder with the keyboard buttons and by drag; preview follows', async () => {
  const preview = '[data-testid=fs-preview]';
  const start = await sectionOrder(admin, preview, 'parties');
  // ↑ on transport_company (keyboard: focus + Enter), then drag driver_phone onto driver_name.
  await admin.getByTestId('fs-up-transport_company').focus();
  await admin.keyboard.press('Enter');
  const afterUp = await sectionOrder(admin, preview, 'parties');
  await admin.getByTestId('fs-row-driver_phone').dragTo(admin.getByTestId('fs-row-driver_name'));
  const afterDrag = await sectionOrder(admin, preview, 'parties');
  check(
    14,
    'Reorder with the keyboard buttons and by drag; preview follows',
    JSON.stringify(start) ===
      JSON.stringify(['driver_name', 'driver_phone', 'trader', 'transport_company']) &&
      JSON.stringify(afterUp) ===
        JSON.stringify(['driver_name', 'driver_phone', 'transport_company', 'trader']) &&
      JSON.stringify(afterDrag) ===
        JSON.stringify(['driver_phone', 'driver_name', 'transport_company', 'trader']),
    `${start} → ${afterUp} → ${afterDrag}`,
  );
});

await step(15, 'Saved order shows in the real form', async () => {
  await admin.getByTestId('fs-save').click();
  await toast(admin, FA.field_settings.saved.replace('{{count}}', '4')).waitFor();
  await realForm(mgr);
  const order = await sectionOrder(mgr, '[data-testid=tx-form]', 'parties');
  check(
    15,
    'Saved order shows in the real form',
    JSON.stringify(order) ===
      JSON.stringify(['driver_phone', 'driver_name', 'transport_company', 'trader']),
    order.join(','),
  );
});

await step(16, 'Copy from branch A to branch B (dialog)', async () => {
  await openSettings(B);
  await admin.getByTestId('fs-copy-from').click();
  await admin.getByTestId('fs-copy-dialog').waitFor();
  await admin.getByTestId('fs-copy-branch').selectOption(String(A));
  await admin.getByTestId('fs-copy-type').selectOption('IMPORT');
  await admin.screenshot({ path: `${SHOTS}/04-copy-dialog.png` });
  await admin.getByTestId('fs-copy-submit').click();
  await admin.getByTestId('fs-copy-dialog').waitFor({ state: 'detached' });
  await admin.locator('[data-testid=fs-row-goods_type][data-visibility=HIDDEN]').waitFor();
  const equal = same(await settingsOf(admin, A), await settingsOf(admin, B));
  await realForm(mgr2);
  const hiddenB = await mgr2.getByTestId('field-goods_type').count();
  check(16, 'Copy from branch A to branch B (dialog)', equal && hiddenB === 0, `B form=${hiddenB}`);
});

await step(17, 'New branch: its settings exist and the page shows them', async () => {
  const made = await api(admin, 'POST', '/branches/', {
    name: 'بندر آزمایشی فیلدها سوم',
    code: 'E2EFC3',
    is_active: true,
  });
  await admin.goto(SETTINGS(made.data.id));
  await admin.getByTestId('fs-row-goods_type').waitFor();
  const rows = await admin.locator('[data-testid^=fs-row-]').count();
  const option = await admin
    .locator(`[data-testid=fs-branch] option[value="${made.data.id}"]`)
    .count();
  const all = await api(admin, 'GET', `/field-configs/?branch=${made.data.id}`);
  // 43 fields × 4 trade types, plus one row per trade type for every added money type.
  const added = (await api(admin, 'GET', '/money-types/')).data.filter((x) => !x.column).length;
  check(
    17,
    'New branch: its settings exist and the page shows them',
    made.status === 201 && rows === 29 && option === 1 && all.data.length === 172 + 4 * added,
    `status=${made.status} rows=${rows} api=${all.data.length}`,
  );
  globalThis.C = made.data.id;
});

await step(18, 'Copy to all branches (confirm)', async () => {
  await openSettings(A);
  await admin.getByTestId('fs-copy-all').click();
  await admin.locator('[role=alertdialog]').waitFor();
  await admin.getByTestId('confirm-ok').click();
  await toast(admin, FA.field_settings.copied_all.split('{{count}}')[1].trim()).waitFor();
  const source = await settingsOf(admin, A);
  const branches = (await api(admin, 'GET', '/branches/')).data;
  const list = branches.results ?? branches;
  const rows = (await api(admin, 'GET', '/field-configs/?trade_type=IMPORT')).data;
  const mismatched = list.filter((b) => {
    const mine = Object.fromEntries(
      rows
        .filter((r) => r.branch === b.id)
        .map((r) => [r.field_name, [r.visibility, r.sort_order]]),
    );
    return !same(mine, source);
  });
  check(
    18,
    'Copy to all branches (confirm)',
    list.length >= 3 && mismatched.length === 0,
    `branches=${list.length} mismatched=${mismatched.map((b) => b.code)}`,
  );
});

await step(19, 'Reset to defaults (confirm) → matches FIELD_SPEC', async () => {
  // E2EFC3 was copied over in 18; branch B's EXPORT was never touched — the seed defaults.
  const defaults = await settingsOf(admin, B, 'EXPORT');
  await openSettings(A, 'EXPORT');
  await admin.getByTestId('fs-vis-remarks-HIDDEN').click();
  await admin.getByTestId('fs-save').click();
  await toast(admin, FA.field_settings.saved.replace('{{count}}', '1')).waitFor();
  const changed = !same(await settingsOf(admin, A, 'EXPORT'), defaults);
  await admin.getByTestId('fs-reset').click();
  await admin.locator('[role=alertdialog]').waitFor();
  await admin.getByTestId('confirm-ok').click();
  await admin.locator('[data-testid=fs-row-remarks][data-visibility=OPTIONAL]').waitFor();
  await openSettings(A, 'IMPORT');
  await admin.getByTestId('fs-reset').click();
  await admin.getByTestId('confirm-ok').click();
  await admin.locator('[data-testid=fs-row-goods_type][data-visibility=OPTIONAL]').waitFor();
  const importDefaults = await settingsOf(admin, B, 'TIR_CARNET'); // same rows as IMPORT by default
  check(
    19,
    'Reset to defaults (confirm) → matches FIELD_SPEC',
    changed &&
      same(await settingsOf(admin, A, 'EXPORT'), defaults) &&
      same(await settingsOf(admin, A, 'IMPORT'), importDefaults) &&
      defaults.seal_expense[0] === 'REQUIRED' &&
      importDefaults.seal_expense[0] === 'OPTIONAL',
  );
});

await step(20, 'TIR_CARNET tab loads its own rows', async () => {
  await admin.getByTestId('fs-tab-TIR_CARNET').click();
  await admin.waitForURL(/type=TIR_CARNET/);
  await admin.getByTestId('fs-row-goods_type').waitFor();
  const selected = await admin.getByTestId('fs-tab-TIR_CARNET').getAttribute('aria-selected');
  check(20, 'TIR_CARNET tab loads its own rows', selected === 'true');
});

await step(21, 'Page translated in Pashto and English', async () => {
  const titles = [];
  for (const lang of ['ps', 'en']) {
    await admin.evaluate((l) => localStorage.setItem('kc.lang', l), lang);
    await admin.reload();
    await admin.getByTestId('fs-row-goods_type').waitFor();
    titles.push(await admin.locator('h1').first().textContent());
  }
  await admin.evaluate(() => localStorage.setItem('kc.lang', 'fa'));
  check(
    21,
    'Page translated in Pashto and English',
    titles[0] === PS.field_settings.title && titles[1] === EN.field_settings.title,
    titles.join(' / '),
  );
});

check('E', 'No uncaught page errors', errors.length === 0, errors.join(' | '));
await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
