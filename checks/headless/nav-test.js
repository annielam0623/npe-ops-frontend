// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9333;
const SKIP_POLL = process.argv.includes("--skip-poll");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  → ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ctl(body) {
  await fetch(`${MOCK}/__ctl`, { method: "POST", body: JSON.stringify(body) });
}
async function mockLog() {
  return (await fetch(`${MOCK}/__log`)).json();
}

let ws;
let msgId = 0;
const pending = new Map();
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expr) {
  const r = await cdp("Runtime.evaluate", {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
}
async function waitFor(expr, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await evaluate(`return !!(${expr});`)) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}
async function goto(url) {
  await cdp("Page.navigate", { url });
  await sleep(300);
}

// 页面里用的小工具（每次导航后重新注入）。
const HELPERS = `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
window.$heads = () => [...document.querySelectorAll('thead th')].map(th => th.textContent.replace('⠿','').trim());
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage(url) {
  await goto(url);
  await waitFor("document.querySelector('thead th')");
  await helpers();
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
    "--window-size=1600,1000",
    "about:blank",
  ]);
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (targets.find((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  await cdp("Page.enable");
  await cdp("Runtime.enable");

  try {
    await run();
  } finally {
    ws.close();
    chrome.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}




// ── 侧栏导航 ──
const nav = "document.querySelector('nav[aria-label=Main]')";
// dashboard 改版（Annie 2026-10-11）：侧栏每次打开页面都是收起的，先点 ☰ 展开再看条目（细节见 dr 套）。
async function openNav() {
  await waitFor(`${nav} && ${nav}.querySelector('button[aria-label="Open menu"]')`);
  await evaluate(`${nav}.querySelector('button[aria-label="Open menu"]').click();`);
  await waitFor(`${nav}.dataset.state === 'open'`);
}
async function run() {
  await ctl({ forbid: false, fail401: false, admin: true });
  await goto(`${APP}/dispatch/work-sheet`);
  await openNav();
  await waitFor(`${nav} && ${nav}.textContent.includes('ZZ Test')`);
  await helpers();
  check("侧栏：分组、Work Sheet 算在 Forms 下高亮且只有它", await evaluate(`const t = ${nav}.textContent; const cur = [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent); return ['Dashboard','Operations','Notifications','Activities','Reports','Messages'].every(x => t.includes(x)) && cur.join('|') === 'Forms';`), await evaluate(`return [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent).join('|');`));
  check("顶栏：页面名照旧模板 page_title", (await evaluate("return document.querySelector('header').textContent;")).includes("Dispatch — Work Sheet"));
  check("顶栏：有订单搜索框、不写登录名（Annie 2026-10-14 拿掉）", await evaluate("const h = document.querySelector('header'); return !!h.querySelector('[data-top-order-search] input') && !h.textContent.includes('zztest');"), await evaluate("return document.querySelector('header').textContent;"));
  check("admin：看得到 Settings；名字和角色", await evaluate(`return ${nav}.textContent.includes('Settings') && ${nav}.textContent.includes('admin');`));
  // 2026-10-12 Annie 定全部切换（只留挂起的 Bug Reports），侧栏链到 ops 新页面。
  check("Settings（已切换）：链到 ops 新页面", await evaluate(`return [...${nav}.querySelectorAll('a')].find(a => a.textContent === 'Human Resource').getAttribute('href') === '/settings/hr';`));
  check("侧栏（已切换）：Manifests 链到 ops 新页面（不带域名、不标 old ↗）", await evaluate(`const a = [...${nav}.querySelectorAll('a')].find(a => a.textContent.startsWith('Manifests')); return a.getAttribute('href') === '/manifests' && !a.textContent.includes('old ↗') && ![...${nav}.querySelectorAll('a')].some(x => /^https?:/.test(x.getAttribute('href')));`));
  check("7 Days Forecast（已切换）：去 ops 的 /forecast", await evaluate(`const a = [...${nav}.querySelectorAll('a')].find(a => a.textContent.startsWith('7 Days')); return a?.getAttribute('href') === '/forecast';`));
  check("Bug Reports（没切换，挂起）：还去同一个网址下的旧页面", await evaluate(`const a = [...${nav}.querySelectorAll('a')].find(a => a.textContent.startsWith('Bug Reports')); return a?.getAttribute('href') === '/admin/system/bug-reports';`));
  check("General 仍是占位页，显示 Coming soon、不可点", await evaluate(`return [...${nav}.querySelectorAll('div')].some(s => s.textContent === 'GeneralComing soon') && ![...${nav}.querySelectorAll('a')].some(a => a.textContent.startsWith('General'));`));
  check("Sign out 走站内代理（不是旧后台域名）", await evaluate(`return [...${nav}.querySelectorAll('a')].find(a => a.textContent === 'Sign out').getAttribute('href') === '/auth/logout';`));
  // ── 分批切换：ops 自己没有的路径原样转给后端，同一个网址、同一个登录（Annie 2026-10-10）──
  let fromLog = (await mockLog()).length;
  // 没切换的 Bug Reports 拿来测「旧页面经 ops 打开」；已切换的 HR 旧路径跳新页面。
  const page = await fetch(`${APP}/admin/system/bug-reports`, { headers: { cookie: "session=zz-ops-login" }, redirect: "manual" });
  const css = await fetch(`${APP}/static/admin.css`, { redirect: "manual" });
  const legacyLog = (await mockLog()).slice(fromLog);
  check("旧后台页面经 ops 打开：内容是后端给的、网址不变（不跳 confirm）", page.status === 200 && (await page.text()).includes("LEGACY BUGS") && legacyLog.some((e) => e.path === "/admin/system/bug-reports"), String(page.status));
  check("登录 cookie 原样带给后端（不用再登录一次）", legacyLog.find((e) => e.path === "/admin/system/bug-reports")?.cookie === "session=zz-ops-login", JSON.stringify(legacyLog));
  const hrOld = await fetch(`${APP}/admin/settings/hr`, { redirect: "manual" });
  check("已切换的旧路径（HR）：307 跳 ops 新页面", hrOld.status === 307 && hrOld.headers.get("location") === "/settings/hr", `${hrOld.status} ${hrOld.headers.get("location")}`);
  check("旧页面的样式文件也经 ops 拿到", css.status === 200 && (await css.text()).includes("color:red") && (css.headers.get("content-type") || "").includes("text/css"));
  const save = await fetch(`${APP}/admin/settings/hr/save`, { method: "POST", redirect: "manual" });
  check("旧页面的保存（表单 POST）转给后端；后端跳回的地址是站内路径、Set-Cookie 落在 ops", save.status === 303 && save.headers.get("location") === "/admin/settings/hr" && (save.headers.get("set-cookie") || "").includes("flash=saved"), `${save.status} ${save.headers.get("location")} ${save.headers.get("set-cookie")}`);
  const home = await fetch(`${APP}/`, { redirect: "manual" });
  check("首页（已切换）：进 ops 的 /dashboard", home.status === 307 && home.headers.get("location") === "/dashboard", `${home.status} ${home.headers.get("location")}`);
  const ops = await fetch(`${APP}/admin/dashboard`, { redirect: "manual" });
  check("已切换：旧 dashboard 路径跳 ops 新页面", ops.status === 307 && ops.headers.get("location") === "/dashboard", `${ops.status} ${ops.headers.get("location")}`);
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await openNav();
  await waitFor(`${nav} && ${nav}.querySelector('[aria-current=page]')`);
  check("manifest 页算在 Dispatch 下", (await evaluate(`return [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent).join('|');`)) === "Dispatch");
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("打印：侧栏、顶栏不印", await evaluate(`return getComputedStyle(${nav}).display === 'none' && getComputedStyle(document.querySelector('header')).display === 'none';`));
  await cdp("Emulation.setEmulatedMedia", { media: "" });

  await ctl({ admin: false });
  await goto(`${APP}/dispatch/guide-sheet`);
  await openNav();
  await waitFor(`${nav} && ${nav}.textContent.includes('ZZ Test')`);
  check("staff：看不到 Settings", await evaluate(`return !${nav}.textContent.includes('Settings');`));

  // 发送页：旧模板把顶栏搜索框藏了；tracking 页：旧模板不继承 base.html，整页没有侧栏 / 顶栏。
  await goto(`${APP}/morning-pickup/send`);
  await waitFor(`${nav} && document.querySelector('header')?.textContent.includes('Morning Pickup — Send')`);
  check("发送页：顶栏也有订单搜索框（Annie 2026-10-14）", await evaluate("return !!document.querySelector('header [data-top-order-search] input');"));
  await goto(`${APP}/morning-pickup/tracking`);
  await sleep(1500);
  check("tracking 页：不套外框（没有侧栏）", await evaluate(`return !${nav} && !document.body.textContent.includes('Operations Center');`));
  await goto(`${APP}/dispatch/guide-sheet`);
  await waitFor(`${nav} && ${nav}.textContent.includes('ZZ Test')`);

  // ── 别的页面：顶栏下面的 shortcuts 导航条（Annie 2026-10-14）：← Back、Dashboard 第一个，钉在上面 ──
  const bar = "document.querySelector('section[aria-label=\"My shortcuts\"]')";
  await waitFor(`${bar} && ${bar}.querySelector('[data-shortcut=dashboard]')`);
  check("导航条：在顶栏下面（不在页面里）、最左 ← Back、Dashboard 第一个", await evaluate(`const b = ${bar}; return !b.closest('main') && b.previousElementSibling?.tagName === 'HEADER' && b.querySelector('button').textContent.trim() === '← Back' && b.querySelector('li').dataset.shortcut === 'dashboard' && !b.querySelector('[data-shortcut=dashboard] button');`));
  check("导航条和顶栏一起钉在上面（sticky）", await evaluate(`return getComputedStyle(${bar}.parentElement).position === 'sticky';`));
  check("侧栏顶部不再写名字（Operations Center 下面）", await evaluate(`return !${nav}.querySelector('a[href=\"/dashboard\"]').parentElement.textContent.includes('ZZ Test');`));
  await evaluate(`${bar}.querySelector('button').click();`);
  await waitFor("location.pathname === '/dashboard'");
  check("直接打开的页面点 ← Back：回 Dashboard（不会跳出 ops）", (await evaluate("return location.pathname;")) === "/dashboard");
  await goto(`${APP}/dispatch/guide-sheet`);
  await waitFor(`${nav} && ${nav}.textContent.includes('ZZ Test')`);

  await cdp("Emulation.setDeviceMetricsOverride", { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  check("窄屏：侧栏收起", await evaluate(`return ${nav}.getBoundingClientRect().right <= 0;`));
  await evaluate("document.querySelector('button[aria-label=\"Open menu\"]').click();");
  await sleep(400);
  check("窄屏：点 ☰ 打开", await evaluate(`return ${nav}.getBoundingClientRect().left >= 0;`));
  await cdp("Emulation.clearDeviceMetricsOverride");

  // /auth/login 是后端代理的登录页（next.config.ts 转发，后端 G32），不经过本仓库的 React 页面，
  // 自然没有侧栏——这里只确认代理生效、看到的是后端的内容，不是本仓库的 404。
  await goto(`${APP}/auth/login`);
  await sleep(800);
  check("/auth/login 代理到后端，没有侧栏", await evaluate(`return document.body.textContent.trim() === 'LOGIN' && !${nav};`));

  // /admin/dashboard 只在 Dashboard 切换以后才跳 /dashboard（分批切换）；2026-10-12 起已切换，见上面「已切换：旧 dashboard 路径跳 ops 新页面」。
}
main().catch((e) => { console.error(e); process.exit(2); });
