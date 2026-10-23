import { chromium } from 'playwright-core';
import fs from 'node:fs';

/**
 * Stage 9 end-to-end check against the live stack (Django :8000 + Vite :5173). See VERIFY.md.
 *   node scripts/verify-e2e.mjs <screenshot-dir> <backend kabul_today, e.g. 1405-08-01>
 * Env: KC_ADMIN_USER/KC_ADMIN_PASS (super_admin), KC_MANAGER_USER/KC_MANAGER_PASS
 * (branch_manager with a branch), KC_BROWSER (Edge/Chrome exe; default: Edge).
 * The wrong-password test runs last: axes then locks this IP for 15 min (manage.py axes_reset).
 */
const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'e2e-screenshots';
const BACKEND_TODAY = process.argv[3];
const ADMIN = [process.env.KC_ADMIN_USER, process.env.KC_ADMIN_PASS];
const MANAGER = [process.env.KC_MANAGER_USER, process.env.KC_MANAGER_PASS];
if (!BACKEND_TODAY || !ADMIN.every(Boolean) || !MANAGER.every(Boolean)) {
  console.error('Usage: see the header of this file / VERIFY.md');
  process.exit(2);
}
const storedUser = () => page.evaluate(() => JSON.parse(localStorage.getItem('kc.user') ?? 'null'));
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok: Boolean(ok), info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
};
const toDari = (s) => s.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));

const browser = await chromium.launch({
  executablePath:
    process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: 'light',
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const htmlAttr = () =>
  page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    dark: document.documentElement.classList.contains('dark'),
    font: getComputedStyle(document.documentElement).fontFamily,
  }));

async function login(user, pass) {
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await page.click('button[type=submit]');
}

// 1. / → /login
await page.goto(BASE + '/');
await page.waitForURL('**/login');
check('1. / redirects to /login', page.url().endsWith('/login'), page.url());

// 2. Dari + RTL
await page.waitForSelector('#username');
let a = await htmlAttr();
const title = await page.textContent('h1');
check(
  '2. Login renders in Dari, RTL',
  a.lang === 'fa' && a.dir === 'rtl' && title.includes('کابل کارگو'),
  JSON.stringify({ ...a, title }),
);
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/01-login-fa.png` });

// Intended-URL memory: hit a protected page while logged out
await page.goto(BASE + '/dashboard?tab=x');
await page.waitForURL('**/login');

// 3. super_admin login → back to intended /dashboard?tab=x
await login(...ADMIN);
await page.waitForURL('**/dashboard**');
check(
  '3. super_admin login → /dashboard (intended URL kept)',
  page.url().endsWith('/dashboard?tab=x'),
  page.url(),
);

// 4/5. Dashboard content + /auth/me/ badge
await page.waitForSelector('[data-testid=backend-status][data-state=ok]', { timeout: 10000 });
const admin = await storedUser();
const greeting = await page.textContent('[data-testid=greeting]');
const role = await page.textContent('[data-testid=role-badge]');
const roleClass = await page.getAttribute('[data-testid=role-badge]', 'class');
const branch = await page.textContent('[data-testid=branch]');
const shamsi = (await page.textContent('[data-testid=today-shamsi]')).trim();
const greg = (await page.textContent('[data-testid=today-gregorian]')).trim();
const adminNav = await page.isVisible('[data-testid=nav-admin]');
check(
  '4. Dashboard shows name, role badge, branch, dual date',
  greeting.includes(admin.full_name) &&
    role === 'سوپر ادمین' &&
    roleClass.includes('bg-brand') &&
    branch === 'همهٔ بندرها' &&
    shamsi &&
    greg,
  JSON.stringify({ greeting, role, branch, shamsi, greg }),
);
check(
  '5. /api/auth/me/ → 200 (green badge)',
  true,
  await page.textContent('[data-testid=backend-status]'),
);
check('   super_admin sees "مدیریت" section', adminNav);
await page.screenshot({ path: `${SHOTS}/02-dashboard-fa-super-admin.png` });

// 13. Shamsi date matches backend kabul_today()
check(
  '13. Shamsi date matches backend kabul_today()',
  shamsi.startsWith(toDari(BACKEND_TODAY)),
  `${shamsi} vs ${BACKEND_TODAY}`,
);

// 6. English → LTR, Inter
await page.selectOption('header select', 'en');
await page.waitForFunction(() => document.documentElement.dir === 'ltr');
a = await htmlAttr();
const enGreeting = await page.textContent('[data-testid=greeting]');
check(
  '6. English → LTR, Inter font, English text',
  a.lang === 'en' &&
    a.dir === 'ltr' &&
    a.font.startsWith('Inter') &&
    enGreeting.startsWith('Welcome'),
  JSON.stringify({ ...a, enGreeting }),
);
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/03-dashboard-en-ltr.png` });

// 7. Pashto → RTL, Vazirmatn
await page.selectOption('header select', 'ps');
await page.waitForFunction(() => document.documentElement.dir === 'rtl');
a = await htmlAttr();
const psGreeting = await page.textContent('[data-testid=greeting]');
check(
  '7. Pashto → RTL, Vazirmatn',
  a.lang === 'ps' &&
    a.dir === 'rtl' &&
    a.font.startsWith('Vazirmatn') &&
    psGreeting.includes('ښه راغلاست'),
  JSON.stringify({ ...a, psGreeting }),
);
await page.screenshot({ path: `${SHOTS}/04-dashboard-ps.png` });
await page.selectOption('header select', 'fa');

// 8. Reload → still logged in, language kept
await page.reload();
await page.waitForSelector('[data-testid=backend-status][data-state=ok]');
a = await htmlAttr();
check(
  '8. Reload → still logged in (localStorage)',
  page.url().includes('/dashboard') && a.lang === 'fa',
  page.url(),
);

// Token refresh: break the access token, reload → one refresh, then /me succeeds
let refreshCalls = 0;
page.on('request', (r) => r.url().includes('/api/auth/refresh/') && refreshCalls++);
await page.evaluate(() => localStorage.setItem('kc.access', 'broken.token.value'));
await page.reload();
await page.waitForSelector('[data-testid=backend-status][data-state=ok]', { timeout: 10000 });
check(
  '   Expired access → refresh → retry succeeds',
  refreshCalls === 1,
  `refresh calls=${refreshCalls}`,
);

// Single-flight: 4 parallel requests with a bad token → exactly one refresh call
refreshCalls = 0;
const parallel = await page.evaluate(async () => {
  const { useAuth } = await import('/src/stores/auth.ts');
  const { api } = await import('/src/lib/api.ts');
  useAuth.setState({ access: 'broken.again' });
  const res = await Promise.all([1, 2, 3, 4].map(() => api.get('/auth/me/').then((r) => r.status)));
  return res;
});
check(
  '   Single-flight refresh (4 parallel 401s → 1 refresh)',
  refreshCalls === 1 && parallel.every((s) => s === 200),
  `refresh calls=${refreshCalls}, statuses=${parallel}`,
);

// Utilities in the running app (same modules the UI uses)
const util = await page.evaluate(async () => {
  const d = await import('/src/lib/digits.ts');
  const dt = await import('/src/lib/date.ts');
  const m = await import('/src/lib/money.ts');
  return {
    norm: d.normalizeDigits(' ۱۲۳٫٤٥ ٦٧٨ '),
    dari: d.toDariDigits(2026),
    shamsi: dt.toShamsi('2026-10-23'),
    greg: dt.toGregorian('۱۴۰۵/۸/۱'),
    parseFa: dt.parseAnyDate('١٤٠٥-٠٨-٠١').toDateString(),
    parseEn: dt.parseAnyDate('2026-10-23').toDateString(),
    fmtEn: dt.formatDate('2026-10-23', 'en'),
    fmtFa: dt.formatDate('2026-10-23', 'fa'),
    moneyFa: m.formatMoney('1234567.891', 'AFN', 'fa'),
    moneyEn: m.formatMoney(1234567.5, 'USD', 'en'),
    moneyBig: m.formatMoney('99999999999999.99', 'USD', 'en'),
    moneyNull: m.formatMoney(null, 'AFN'),
    moneyNeg: m.formatMoney('-0.005', 'AFN', 'en'),
  };
});
check(
  '   Utilities (digits/date/money)',
  util.norm === '123٫45 678' &&
    util.dari === '۲۰۲۶' &&
    util.shamsi === '۱۴۰۵-۰۸-۰۱' &&
    util.greg === '2026-10-23' &&
    util.parseFa === util.parseEn &&
    util.fmtEn === '2026-10-23' &&
    util.fmtFa === '۱۴۰۵-۰۸-۰۱' &&
    util.moneyFa === '۱٬۲۳۴٬۵۶۷٫۸۹ ؋' &&
    util.moneyEn === '$1,234,567.50' &&
    util.moneyBig === '$99,999,999,999,999.99' &&
    util.moneyNull === '—',
  JSON.stringify(util),
);

// Dari digits in a numeric <Input> → English on blur
const blur = await page.evaluate(async () => {
  // Use the exact pre-bundled URLs (with ?v=hash) the app loaded, so it is the same React instance.
  const dep = (n) =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((u) => u.includes(`/.vite/deps/${n}.js`));
  const React = (await import(dep('react'))).default;
  const rdc = await import(dep('react-dom_client'));
  const createRoot = rdc.createRoot ?? rdc.default.createRoot;
  const { Input } = await import('/src/components/ui/Input.tsx');
  const host = document.createElement('div');
  document.body.appendChild(host);
  let seen = '';
  createRoot(host).render(
    React.createElement(Input, {
      id: 'num-test',
      inputMode: 'decimal',
      onChange: (e) => (seen = e.target.value),
    }),
  );
  await new Promise((r) => setTimeout(r, 50));
  const el = document.getElementById('num-test');
  return { type: el.type };
});
await page.fill('#num-test', '۱۲۵٫۵');
await page.locator('#num-test').blur();
const blurred = await page.inputValue('#num-test');
check(
  '   Numeric Input normalizes Dari digits on blur',
  blurred === '125٫5' || blurred === '125.5' || blurred === '125٫5',
  `${blur.type} → "${blurred}"`,
);

// 12. Dark mode toggle persists
await page.reload();
await page.waitForSelector('[data-testid=theme-toggle]');
await page.click('[data-testid=theme-toggle]');
a = await htmlAttr();
await page.reload();
await page.waitForSelector('[data-testid=backend-status][data-state=ok]');
const afterReload = await htmlAttr();
check(
  '12. Dark mode toggles and persists',
  a.dark && afterReload.dark,
  `after toggle=${a.dark}, after reload=${afterReload.dark}`,
);
await page.screenshot({ path: `${SHOTS}/05-dashboard-dark.png` });
await page.click('[data-testid=theme-toggle]');

// 404
await page.goto(BASE + '/no-such-page');
const nf = await page.textContent('h1');
check('   Unknown URL → 404 page', nf.includes('۴۰۴'), nf);

// 9. Logout → /login, storage cleared
await page.goto(BASE + '/dashboard');
await page.waitForSelector('[data-testid=user-menu]');
await page.click('[data-testid=user-menu]');
await page.click('[data-testid=logout]');
await page.waitForURL('**/login');
const stored = await page.evaluate(() => [
  localStorage.getItem('kc.access'),
  localStorage.getItem('kc.refresh'),
]);
check(
  '9. Logout → /login, tokens cleared',
  page.url().endsWith('/login') && stored.every((v) => v === null),
  JSON.stringify(stored),
);

// 11. branch_manager → no "مدیریت"
await login(...MANAGER);
await page.waitForURL('**/dashboard');
await page.waitForSelector('[data-testid=backend-status][data-state=ok]');
const manager = await storedUser();
const mAdmin = await page.isVisible('[data-testid=nav-admin]');
const mBranch = await page.textContent('[data-testid=branch]');
const mTop = await page.textContent('[data-testid=topbar-branch]');
const mRoleClass = await page.getAttribute('[data-testid=role-badge]', 'class');
check(
  '11. branch_manager: "مدیریت" hidden, own branch shown, orange badge',
  !mAdmin &&
    manager.role === 'branch_manager' &&
    mBranch === manager.branch_name &&
    mTop === manager.branch_name &&
    mRoleClass.includes('bg-accent'),
  JSON.stringify({ mAdmin, mBranch, mTop }),
);
await page.screenshot({ path: `${SHOTS}/06-dashboard-branch-manager.png` });

// Mobile: sidebar collapsed, opens from the menu button
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(400); // let the slide-out transition finish
const asideBox = async () => page.locator('aside').boundingBox();
const closed = await asideBox();
await page.click('header button[aria-label="منو"]');
await page.waitForTimeout(400);
const opened = await asideBox();
check(
  '   Mobile: sidebar off-canvas, opens from menu',
  closed.x >= 390 && opened.x < 390,
  `closed x=${closed.x}, open x=${opened.x}`,
);
await page.screenshot({ path: `${SHOTS}/07-mobile-menu.png` });
await page.setViewportSize({ width: 1280, height: 800 });
await page.click('[data-testid=user-menu]').catch(() => {});
await page.evaluate(() => localStorage.clear());

// 10. Wrong password repeatedly → rate-limit / lock messages (last: it locks this IP for 15 min)
await page.goto(BASE + '/login');
const attempts = [];
for (let i = 1; i <= 6; i++) {
  const resp = page.waitForResponse((r) => r.url().includes('/api/auth/login/'));
  await login(ADMIN[0], 'wrong-password-' + i);
  const r = await resp;
  await page.waitForSelector('[data-testid=login-error]');
  await page.waitForTimeout(150);
  attempts.push({
    i,
    status: r.status(),
    msg: (await page.textContent('[data-testid=login-error]')).trim(),
  });
}
console.log(JSON.stringify(attempts, null, 1));
const last = attempts.at(-1);
check(
  '10. Wrong password ×5 → blocked with "تلاش‌های زیاد" / lock message',
  attempts.slice(0, 4).every((x) => x.status === 401 && x.msg === 'نام کاربری یا رمز اشتباه است') &&
    attempts
      .slice(4)
      .every(
        (x) =>
          (x.status === 429 && x.msg === 'تلاش‌های زیاد. چند دقیقه صبر کنید.') ||
          (x.status === 423 && x.msg.startsWith('حساب شما قفل است')),
      ),
  attempts.map((x) => `${x.i}:${x.status}`).join(' '),
);
await page.screenshot({ path: `${SHOTS}/08-login-rate-limited.png` });

check(
  '   No console errors',
  consoleErrors.filter((e) => !e.includes('401') && !e.includes('429') && !e.includes('423'))
    .length === 0,
  consoleErrors.join(' | ').slice(0, 600),
);

await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify({ results, attempts, util }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
