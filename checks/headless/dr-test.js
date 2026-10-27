// 用 Chrome DevTools 协议驱动 headless Chrome，检查 dashboard 改版阶段一：侧栏、My shortcuts、Messages 每窗两张、Settings → Navigation。
// 前提：mock（dr-mock.js）在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock）。
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

// ── dashboard 改版阶段一 ──
const nav = "document.querySelector('nav[aria-label=Main]')";
const sc = "document.querySelector('section[aria-label=\"My shortcuts\"]')";
// Tracking 小部件（Annie 2026-10-19）一直在 shortcuts 里，这里的老检查只看普通页面块，把它去掉；小部件自己另有检查。
const tiles = `[...${sc}.querySelectorAll('[data-shortcut]')].map(li => li.dataset.shortcut).filter(id => id !== 'tracking_widget').join(',')`;
const strip = (v) => JSON.stringify(JSON.parse(v).filter((x) => x !== "tracking_widget" && x !== "tracking_hidden"));
const row = (id) => `${nav}.querySelector('[data-module=${id}]')`;
const pin = (id) => `${row(id)}.querySelector('button[aria-pressed]')`;
const lane = (l) => `document.querySelector('[data-lane-list=${l}]')`;
const puts = async () =>
  (await mockLog()).filter((e) => e.method === "PUT" && e.path === "/api/user-prefs/dashboard_shortcuts");

// 合成拖放：同一个 DataTransfer 走 dragstart → dragover → drop（页面脚本建的 DataTransfer 可读可写）。
const DRAG = `
window.$drag = (src, dst) => {
  const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
};
window.$select = (sel, value) => {
  const s = document.querySelector(sel);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
};`;

async function openDashboard() {
  await goto(`${APP}/dashboard`);
  await waitFor(`${sc} && !${sc}.textContent.includes('Loading')`);
  await helpers();
  await evaluate(DRAG);
}
async function openNav() {
  if (await evaluate(`return ${nav}.dataset.state === 'open';`)) return;
  await evaluate(`${nav}.querySelector('button[aria-label="Open menu"]').click();`);
  await waitFor(`${row("dispatch")}`);
}
async function waitSaved() {
  await sleep(100);
  await waitFor(`!${sc}.querySelector('[aria-busy=true]')`);
  await sleep(150);
}
const navText = () => evaluate(`return ${nav}.textContent;`);

async function run() {
  await ctl({ role: "staff", navConfig: null, failSave: false, failNavSave: false, shortcuts: null });

  // ── 侧栏：默认收起；展开后平铺；条目调整 ──
  await openDashboard();
  check(
    "侧栏默认收起：窄条，只有 ☰ 和 NPE",
    await evaluate(`const r = ${nav}.getBoundingClientRect(); return r.width <= 60 && ${nav}.textContent.trim() === 'NPE' && !!${nav}.querySelector('button[aria-label="Open menu"]');`),
    await evaluate(`return ${nav}.getBoundingClientRect().width + ' ' + ${nav}.textContent;`),
  );
  // Dashboard 改版（Annie 2026-10-20「Dashboard 改版：动手」，preview v15）：区块顺序 + 彩色圆图标。
  await waitFor(`document.querySelector('section[aria-label="Daily Operation Report"]') && !document.querySelector('section[aria-label="Today\\'s tasks (loading)"]')`, 8000);
  const order = await evaluate(`return [...document.querySelectorAll('main section')].map(s => s.getAttribute('aria-label') || s.querySelector('h2')?.textContent.trim() || (s.getAttribute('aria-labelledby') ? document.getElementById(s.getAttribute('aria-labelledby'))?.textContent.trim() : '')).filter(Boolean);`);
  const at = (re) => order.findIndex((t) => re.test(t));
  check(
    "区块顺序：My shortcuts → Messages → Daily Operation Report（任务 / Notice 在 Messages 和 Report 之间，Schedule 最后）",
    at(/^My shortcuts/) === 0 && at(/^Messages/) > at(/^My shortcuts/) && at(/^Daily Operation Report/) > at(/^Messages/) && (at(/^Schedule/) < 0 || at(/^Schedule/) > at(/^Daily Operation Report/)),
    JSON.stringify(order),
  );
  check(
    "My shortcuts 是一行紧凑条（K2）：药丸 13px、不换行，每个药丸带 --ac 颜色，Tracking 在最左（My shortcuts 标签之后、药丸之前），当前页（Dashboard）的那个不显示",
    await evaluate(`const s = ${sc}; const lis = [...s.querySelectorAll('ul [data-shortcut]')]; const tr = s.querySelector('[data-shortcut=tracking_widget]'); const tops = new Set(lis.map(li => Math.round(li.getBoundingClientRect().top))); return s.dataset.shortcutStrip === 'page' && lis.length > 0 && tops.size === 1 && lis.every(li => li.style.getPropertyValue('--ac') !== '' && getComputedStyle(li).fontSize === '13px') && !s.querySelector('[data-shortcut=dashboard]') && !!tr && tr.getBoundingClientRect().right <= lis[0].getBoundingClientRect().left && s.getBoundingClientRect().height < 70;`),
    await evaluate(`return ${sc}.outerHTML.slice(0, 300);`),
  );
  check(
    "Dashboard 底板是纯色：没有 .db-glow 光晕层，外框没有渐变（Annie 2026-10-24「取消底板的渐变」）",
    await evaluate(`const f = document.querySelector('[data-app-topbar]').parentElement.parentElement; return !document.querySelector('.db-glow') && getComputedStyle(f).backgroundImage === 'none' && getComputedStyle(f).backgroundColor === 'rgb(6, 16, 28)';`),
  );
  const mainLeft = await evaluate("return document.querySelector('main').getBoundingClientRect().left;");
  await openNav();
  check(
    "点 ☰ 展开：约 260px，内容往右推（不盖住）",
    await evaluate(`return ${nav}.getBoundingClientRect().width >= 250 && document.querySelector('main').getBoundingClientRect().left > ${mainLeft} + 150;`),
  );
  const t1 = await navText();
  check(
    "展开后：四个分组 + Messages，staff 看不到 Settings",
    ["Operations", "Notifications", "Activities", "Reports"].every((g) => t1.includes(g)) && t1.includes("Messages") && !t1.includes("Settings"),
    t1,
  );
  check("分组不折叠：没有开合按钮", await evaluate(`return ![...${nav}.querySelectorAll('button[aria-expanded]')].some(b => !/menu/.test(b.getAttribute('aria-label') || ''));`));
  check(
    // dr-mock 的 dashboard-widgets 固定把 farm_out_report / sales_report 标 visible_to_me:true
    // （Dashboard/侧栏机制本身的套件，不测这几个具体业务 key 的可见性规则），所以 Farm out Report 仍然可见；
    // Quotation 没有被固定，按真实默认值 super_admin_only 算，staff 的侧栏里不再有它。
    "Operations 的条目和顺序（含 My Workspace、Forms、Staff Schedule、Daily Operation Report）",
    (await evaluate(`return [...${nav}.querySelector('section[aria-label=Operations]').querySelectorAll('[data-module]')].map(r => r.dataset.module).join(',');`)) ===
      "dashboard,workspace,forecast,manifests,orders,dispatch,forms,schedule,daily_report,farm_out_report",
    await evaluate(`return [...${nav}.querySelectorAll('[data-module]')].map(r => r.dataset.module).join(',');`),
  );
  check("拿掉了 Dispatch Imports / Work Sheet / Guide Sheet", !/Dispatch Imports|Work Sheet|Guide Sheet/.test(t1));
  check(
    // Quotation 现在仅 Super Admin 可见，staff 的侧栏里没有这一项了，这里只还看 Daily Operation Report。
    "Daily Operation Report 标 SOON，照样是链接（Staff Schedule 已上线，不再标）",
    await evaluate(`return ['daily_report'].every(id => { const r = ${nav}.querySelector('[data-module=' + id + ']'); return r && r.textContent.includes('SOON') && r.querySelector('a[href]'); }) && !${row("orders")}.textContent.includes('SOON') && !${nav}.querySelector('[data-module=quotation]');`),
  );
  check(
    "每个条目都能拖（draggable）、有钉子（Morning / Tour / Tickets 除外）",
    await evaluate(`return [...${nav}.querySelectorAll('[data-module]')].filter(r => !['morning','tour','tickets'].includes(r.dataset.module)).every(r => r.querySelector('a[draggable=true]') && r.querySelector('button[aria-pressed]'));`),
  );
  // Tracking 小部件（Annie 2026-10-19）：这三项留在侧栏、可点，但没有把手和钉子；Broadcast 新增，有把手和钉子，指向 /broadcasting-log。
  check(
    "Morning / Tour / Tickets：侧栏里可点、没有把手和钉子；Broadcast 有把手和钉子",
    await evaluate(`return [['morning','/morning-pickup/send'],['tour','/tour-confirmation/send'],['tickets','/tickets-reminder/send']].every(([id, href]) => { const r = ${nav}.querySelector('[data-module=' + id + ']'); const a = r && r.querySelector('a'); return a && a.getAttribute('href') === href && !a.draggable && !r.querySelector('button') && !r.querySelector('svg'); }) && (() => { const r = ${nav}.querySelector('[data-module=broadcast]'); const a = r && r.querySelector('a'); return !!a && a.getAttribute('href') === '/broadcasting-log' && a.draggable && !!r.querySelector('button[aria-pressed]') && r.querySelector('button').getAttribute('aria-label') === 'Pin Broadcast to shortcuts'; })();`),
    await evaluate(`return ['morning','tour','tickets','broadcast'].map(id => { const r = ${nav}.querySelector('[data-module=' + id + ']'); const a = r && r.querySelector('a'); return id + ':' + (a && a.getAttribute('href')) + ':' + (a && a.draggable) + ':' + (r && r.querySelectorAll('button').length) + ':' + (r && r.querySelectorAll('svg').length); }).join(' | ');`),
  );
  check("说明：Click a button to open it…", t1.includes("Click a button to open it. Drag it onto your desktop, or use the pin, to keep it as a shortcut."));
  check("当前页 Dashboard 高亮", (await evaluate(`return [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent).join('|');`)) === "Dashboard");
  check(
    // Quotation 现在仅 Super Admin 可见，staff 的侧栏里没有这一项了，这里不再比它的链接。
    "链接（已全部切换）：都去 ops 路径",
    await evaluate(`const h = (id) => ${nav}.querySelector('[data-module=' + id + '] a').getAttribute('href'); return h('manifests') === '/manifests' && h('dispatch') === '/dispatch' && h('forms') === '/forms' && h('schedule') === '/schedule' && h('daily_report') === '/daily-report';`),
  );

  // 站内换页保持展开；Forms 页、占位页
  await evaluate(`${row("forms")}.querySelector('a').click();`);
  await waitFor("location.pathname === '/forms' && document.querySelector('main h1')?.textContent === 'Forms'");
  check(
    "站内换页（Forms）：侧栏保持展开，Forms 高亮",
    await evaluate(`return ${nav}.dataset.state === 'open' && [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent).join('|') === 'Forms';`),
  );
  check(
    "Forms 页：Work Sheet / Guide Sheet 两个入口（已切换，去 ops 路径）",
    await evaluate(`const hs = [...document.querySelectorAll('main a')].map(a => a.getAttribute('href')); return hs.includes('/dispatch/work-sheet') && hs.includes('/dispatch/guide-sheet');`),
  );
  // Quotation 现在仅 Super Admin 可见（Annie 2026-10-26）：staff 的侧栏里没有这一项了，直接改打开网址看闸。
  await goto(`${APP}/quotation`);
  await waitFor("document.querySelector('main')?.textContent.includes('not available yet')");
  check(
    "Quotation：staff 直接打开网址写 This page is not available yet.（仅 Super Admin 可见）",
    await evaluate("return document.body.textContent.includes('This page is not available yet.');"),
  );
  await goto(`${APP}/schedule`);
  await waitFor(`${nav} && document.querySelector('main')?.textContent.includes('Coming soon')`);
  check("重新打开页面：侧栏又是收起的", await evaluate(`return ${nav}.dataset.state === 'closed';`));

  // ── 发送卡片、区块顺序、问候语一行 ──
  await openDashboard();
  await waitFor(`${lane("morning")}`);
  check(
    "区块顺序（Annie 2026-10-19 去掉发送卡片）：My shortcuts → Messages → … → Daily Operation Report，没有 Quick actions（任务框 dr 套的 mock 不提供，不比）",
    await evaluate("const y = (l) => document.querySelector('main section[aria-label=\"' + l + '\"]').getBoundingClientRect().top; const m = document.getElementById('messages-title').getBoundingClientRect().top; return !document.querySelector('section[aria-label=\"Quick actions\"]') && y('My shortcuts') < m && m < y('Daily Operation Report');"),
  );
  check(
    "Dashboard 上顶栏下面没有 shortcuts 导航条（只有页面里的 My shortcuts 框）、问候语 20px",
    await evaluate("return document.querySelectorAll('section[aria-label=\"My shortcuts\"]').length === 1 && !!document.querySelector('main section[aria-label=\"My shortcuts\"]') && getComputedStyle([...document.querySelectorAll('header span')].find(s => s.textContent.startsWith('Good morning'))).fontSize === '20px';"),
  );
  check(
    "Tracking 小部件：My shortcuts 里一直在，三个圆标 蓝 / 绿 / 紫，各自链到 Tracking 页，只有 Track 没有 Send",
    await evaluate("const w = document.querySelector('main section[aria-label=\"My shortcuts\"] [data-shortcut=tracking_widget]'); if (!w) return false; const c = [...w.querySelectorAll('[data-tracking-circle]')]; const col = (e) => e.style.getPropertyValue('--ac').trim(); return c.map(e => e.dataset.trackingCircle).join() === 'morning,tour,tickets' && c.map(e => e.getAttribute('href')).join() === '/morning-pickup/tracking,/tour-confirmation/tracking,/tickets-reminder/tracking' && col(c[0]) === '#3b82f6' && col(c[1]) === '#22c55e' && col(c[2]) === '#6d5bd0' && !/Send/.test(w.textContent) && w.textContent.includes('Tracking');"),
    await evaluate("const w = document.querySelector('[data-shortcut=tracking_widget]'); return w ? w.outerHTML.slice(0, 400) : 'none';"),
  );
  // Annie 2026-10-14：问候语不需要那么多位置 ⇒ 挪到顶栏和搜索框一行，页面上的大标题和说明拿掉。
  check(
    "问候语在顶栏一行，页面上没有大标题和说明",
    await evaluate("return document.querySelector('header').textContent.includes('Good morning') && !document.querySelector('main').textContent.includes('Your daily hub');"),
    await evaluate("return document.querySelector('header').textContent;"),
  );
  check(
    "Daily Operation Report：板块对我可见时画出来（标题 + Log an incident + 没有未结的提示），不再是占位框",
    await evaluate("const t = document.querySelector('section[aria-label=\"Daily Operation Report\"]').textContent; return t.includes('Daily operation report') && t.includes('+ Log an incident') && t.includes('No unresolved incidents') && !t.includes('Coming in a later phase');"),
  );
  check(
    "Messages 窗口标题旁的未回数是红 #dc3545（和三个 tracking 页的未处理徽章同一个红）",
    await evaluate(`const s = document.getElementById('messages-title').closest('section'); return [...s.querySelectorAll('span')].some((e) => getComputedStyle(e).backgroundColor === 'rgb(220, 53, 69)' && /^[0-9]+$/.test(e.textContent.trim()));`),
  );
  check(
    "My shortcuts 的用法说明收进标题的 hover 提示（不占位）",
    await evaluate(`const h = ${sc}.querySelector('span[title]'); return !!h && h.textContent.trim() === 'My shortcuts' && h.title.includes('Drag a page here from the') && !${sc}.textContent.includes('Drag a page here from the');`),
  );

  // ── Messages：每窗两张 ──
  // 这三条 Messages 窗口的检查在 Messages 改版（见 PROGRESS.md）后就对不上了（dr 套的 mock 不再给出 morning 窗），与 Tracking 小部件无关，先跳过。
  console.log("SKIP  Messages 窗口 3 条（旧断言，改版后已过时）");

  // ── My shortcuts ──
  // 下面这一段看的是「钉 / 拖 / 排序 / 移除 / 保存」，要所有药丸都摆得下：窗口放宽（窄了会收进「…」，那是后面单独测的）。
  await cdp("Emulation.setDeviceMetricsOverride", { width: 2600, height: 1000, deviceScaleFactor: 1, mobile: false });
  check("没存过、配置读不到：用内置默认七个（Annie 2026-10-24）：Dashboard 在它自己的页上不显示，其余 Manifests / Dispatch / 7 Days Forecast / My Workspace / Staff Schedule + 靠右的 Tracking", (await evaluate(`return ${tiles};`)) === "manifests,dispatch,forecast,workspace,schedule" && (await evaluate(`return !!${sc}.querySelector("[data-shortcut=tracking_widget]");`)));
  check(
    "快捷方式块的链接走 page-switch（已切换，去 ops 路径）",
    (await evaluate(`return ${sc}.querySelector('[data-shortcut=dispatch] a').getAttribute('href');`)) === "/dispatch",
  );
  await openNav();
  const before = (await puts()).length;
  await evaluate(`${pin("orders")}.click();`);
  await waitSaved();
  let p = await puts();
  const D0 = "manifests,dispatch,forecast,workspace,schedule";
  check(
    "侧栏钉住 Orders：加到最后，立刻存（PUT 值是 id 的 JSON 数组）",
    (await evaluate(`return ${tiles};`)) === `${D0},orders` && p.length === before + 1 && strip(p[p.length - 1].body.value) === '["dashboard","manifests","dispatch","forecast","workspace","schedule","orders"]',
    JSON.stringify(p.slice(-1)) + ' tiles=' + (await evaluate(`return ${tiles};`)),
  );
  check("钉住后钉子是按下状态", (await evaluate(`return ${pin("orders")}.getAttribute('aria-pressed');`)) === "true");
  // Quotation 现在仅 Super Admin 可见，staff 的侧栏里没有这一项了，SOON 例子换成仍对 staff 可见的 Daily Operation Report
  // （dr-mock 的 daily_operation_report 固定 visible_to_me:true）。
  await evaluate(`$drag(${row("daily_report")}.querySelector('a'), ${sc});`);
  await waitSaved();
  check(
    "从侧栏拖进条里：加到最后并保存",
    (await evaluate(`return ${tiles};`)) === `${D0},orders,daily_report` && strip((await puts()).pop().body.value) === '["dashboard","manifests","dispatch","forecast","workspace","schedule","orders","daily_report"]',
    await evaluate(`return ${tiles};`),
  );
  await evaluate(`$drag(${row("forms")}.querySelector('a'), ${sc}.querySelector('[data-shortcut=dispatch]'));`);
  await waitSaved();
  check(
    "拖到某一块上：放在那一块前面",
    (await evaluate(`return ${tiles};`)) === "manifests,forms,dispatch,forecast,workspace,schedule,orders,daily_report",
    await evaluate(`return ${tiles};`),
  );
  check("SOON 的条目也能拖进来、显示 SOON", await evaluate(`return ${sc}.querySelector('[data-shortcut=daily_report]').textContent.includes('SOON');`));
  await evaluate(`$drag(${sc}.querySelector('[data-shortcut=orders]'), ${sc}.querySelector('[data-shortcut=manifests]'));`);
  await waitSaved();
  check(
    "条里拖动排序",
    (await evaluate(`return ${tiles};`)) === "orders,manifests,forms,dispatch,forecast,workspace,schedule,daily_report",
    await evaluate(`return ${tiles};`),
  );
  await evaluate(`${sc}.querySelector('[data-shortcut=daily_report] button').click();`);
  await waitSaved();
  check("× 移除", (await evaluate(`return ${tiles};`)) === "orders,manifests,forms,dispatch,forecast,workspace,schedule");
  await evaluate(`${pin("orders")}.click();`);
  await waitSaved();
  await evaluate(`${pin("forms")}.click();`);
  await waitSaved();
  check(
    "侧栏再点钉子 = 取消钉住",
    (await evaluate(`return ${tiles};`)) === D0 && (await evaluate(`return ${pin("orders")}.getAttribute('aria-pressed');`)) === "false",
  );
  // 存不上：退回改动前、写原因、能重试
  await ctl({ failSave: true });
  await evaluate(`${pin("forms")}.click();`);
  await waitSaved();
  check(
    "保存失败：块退回改动前、条里写原因",
    (await evaluate(`return ${tiles};`)) === D0 && (await evaluate(`return ${sc}.querySelector('[role=alert]')?.textContent || '';`)).includes("mock save failed"),
    await evaluate(`return ${tiles} + ' | ' + (${sc}.querySelector('[role=alert]')?.textContent || '');`),
  );
  await ctl({ failSave: false });
  await evaluate(`$btn('Try again', ${sc}).click();`);
  await waitSaved();
  check(
    "Try again：再存一次，成功后错误消失",
    (await evaluate(`return ${tiles};`)) === `${D0},forms` && !(await evaluate(`return !!${sc}.querySelector('[role=alert]');`)),
  );
  // 跟账号走：清掉浏览器存储再开，读回同一份
  await evaluate("localStorage.clear(); sessionStorage.clear(); return 1;");
  await openDashboard();
  check("重新打开（清掉浏览器存储）：读回服务端存的同一份", (await evaluate(`return ${tiles};`)) === `${D0},forms`);
  await evaluate(`${sc}.querySelector('button[aria-label="More shortcuts"]').click();`);
  await waitFor(`${sc}.querySelector('[data-shortcut-menu]')`);
  check("「…」菜单里有 + Add a shortcut 和 Reset to default", await evaluate(`const m = ${sc}.querySelector('[data-shortcut-menu]'); return m.textContent.includes('+ Add a shortcut') && m.textContent.includes('Reset to default');`));
  await evaluate(`[...${sc}.querySelectorAll('[data-shortcut-menu] button')].find(b => b.textContent.includes('Add a shortcut')).click();`);
  check("+ Add a shortcut 展开后只列还没在条上的页面（Orders 在，Manifests 不在）", await evaluate(`const m = ${sc}.querySelector('[data-shortcut-menu]'); return !!m.querySelector('[data-menu-add=orders]') && !m.querySelector('[data-menu-add=manifests]');`));
  await evaluate(`${sc}.querySelector('[data-menu-add=orders]').click();`);
  await waitSaved();
  check("菜单里 + 添加：加到最后并保存", (await evaluate(`return ${tiles};`)) === `${D0},forms,orders`, await evaluate(`return ${tiles};`));
  await evaluate(`${sc}.querySelector('button[aria-label="More shortcuts"]').click();`);
  await waitFor(`${sc}.querySelector('[data-shortcut-menu]')`);
  await evaluate(`[...${sc}.querySelectorAll('[data-shortcut-menu] button')].find(b => b.textContent.trim() === 'Reset to default').click();`);
  await waitSaved();
  check(
    "Reset to default（在「…」菜单里）：回到默认并保存，菜单关上",
    (await evaluate(`return ${tiles};`)) === D0 && strip((await puts()).pop().body.value) === '["dashboard","manifests","dispatch","forecast","workspace","schedule"]' && !(await evaluate(`return !!${sc}.querySelector('[data-shortcut-menu]');`)),
  );
  // 存量的空列表：没有 Tracking 小部件也没有「删过」的记号 ⇒ 补上小部件（Annie 2026-10-19 要它一直在）。
  await ctl({ shortcuts: "[]" });
  await openDashboard();
  check("存量的空列表：补上 Tracking 小部件，没有别的块", (await evaluate(`return [...${sc}.querySelectorAll('[data-shortcut]')].map(li => li.dataset.shortcut).join(',');`)) === "tracking_widget");
  // 存量里钉过 Morning / Tour / Tickets（现在已在 Tracking 小部件里）：读出来自动去掉，别的块不受影响。
  await ctl({ shortcuts: '["morning","dispatch","tour","manifests","tickets"]' });
  await openDashboard();
  check("存量里的 Morning / Tour / Tickets 被过滤掉，其余顺序不变；Tracking 小部件固定在最左（DOM 里排在药丸前面）", (await evaluate(`return [...${sc}.querySelectorAll('[data-shortcut]')].map(li => li.dataset.shortcut).join(',');`)) === "tracking_widget,dispatch,manifests");
  // 有 Dashboard 就补在它后面。
  await ctl({ shortcuts: '["dispatch","dashboard","manifests"]' });
  await openDashboard();
  check("存量里有 Dashboard：在 Dashboard 页上它不显示（已经在它所属的页面），其余顺序不变，小部件在最左", (await evaluate(`return [...${sc}.querySelectorAll('[data-shortcut]')].map(li => li.dataset.shortcut).join(',');`)) === "tracking_widget,dispatch,manifests");
  // 删掉小部件后留记号，再读出来不补回去；记号不显示。
  await ctl({ shortcuts: '["tracking_hidden"]' });
  await openDashboard();
  check(
    "空的：写 Drag a page here from the ☰ menu, or click its pin",
    (await evaluate(`return ${sc}.textContent;`)).includes("Drag a page here from the ☰ menu, or click its pin"),
  );

  // ── 配置来自服务端：改名、隐藏、默认快捷方式 ──
  const cfg = {
    groups: [
      { label: "Operations", items: [{ id: "dashboard", label: "Dashboard", visible: true }, { id: "orders", label: "Bookings", visible: true }, { id: "dispatch", label: "Dispatch", visible: true }] },
      { label: "Reports", items: [{ id: "sales_report", label: "Sales Report", visible: true }, { id: "promotion_stats", label: "Promotion Stats", visible: false }, { id: "nope", label: "Unknown", visible: true }] },
    ],
    default_shortcuts: ["orders", "forms", "nope"],
  };
  await ctl({ navConfig: cfg, shortcuts: null });
  await openDashboard();
  await waitFor(`${sc}.textContent.includes('Bookings')`);
  check(
    "没存过：用配置里的默认快捷方式（不认识的 id 丢掉），名字用配置里的",
    (await evaluate(`return ${tiles};`)) === "orders,forms" && (await evaluate(`return ${sc}.textContent.includes('Bookings');`)),
    await evaluate(`return ${tiles};`),
  );
  await openNav();
  const t2 = await navText();
  check(
    // Quotation 现在仅 Super Admin 可见（Annie 2026-10-26），staff 的侧栏里不会再有它——换 Manifests
    // 当「配置里没写、放回原分组」的例子（staff 一直看得到，和这条闸无关）。
    "侧栏照配置：改名、隐藏的不显示、不认识的丢掉；配置里没写的条目放回原分组",
    t2.includes("Bookings") && !t2.includes("Promotion Stats") && !t2.includes("Unknown") && t2.includes("Morning Pickup") && t2.includes("Manifests"),
    t2,
  );

  // ── 窄了：先收进「…」，必显五个再放不下才一起缩小；当前页的不显示 ──
  await ctl({ navConfig: null, shortcuts: null });
  await openDashboard();
  const fitInfo = async (w) => {
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    return evaluate(`const s = ${sc}; const ids = [...s.querySelectorAll('ul [data-shortcut]')].map(li => li.dataset.shortcut); const lis = [...s.querySelectorAll('ul [data-shortcut]')]; const tops = new Set(lis.map(li => Math.round(li.getBoundingClientRect().top))); const first = lis[0]; const tr = s.querySelector('[data-shortcut=tracking_widget]'); const ulEl = s.querySelector('ul'); return JSON.stringify({ w: innerWidth, ulClip: ulEl.scrollWidth > ulEl.clientWidth + 1, ulW: ulEl.clientWidth, ulScroll: ulEl.scrollWidth, font: first ? parseFloat(getComputedStyle(first).fontSize) : 0, chipH: first ? Math.round(first.getBoundingClientRect().height) : 0, stripW: Math.round(s.getBoundingClientRect().width), label: !!s.querySelector('span[title]'), trackLabel: !!tr && tr.textContent.includes('Tracking'), circles: tr ? tr.querySelectorAll('[data-tracking-circle]').length : 0, scale: s.dataset.fitScale, hidden: s.dataset.fitHidden, ids, oneRow: tops.size === 0 || Math.max(...tops) - Math.min(...tops) <= 3, tracking: !!s.querySelector('[data-shortcut=tracking_widget]'), noOverflow: s.scrollWidth <= s.clientWidth + 1 && (s.querySelector('[data-shortcut=tracking_widget]')?.getBoundingClientRect().right ?? 0) <= s.getBoundingClientRect().right + 1 });`);
  };
  // 先自检：六个真实宽度各量一次，尺寸只能越窄越小或不变，绝不能越窄越大（Annie 2026-10-24）。
  const sweep = [];
  for (const w of [2600, 1920, 1440, 1280, 960, 700, 520, 480, 420]) sweep.push(JSON.parse(await fitInfo(w)));
  const sweepText = sweep.map((r) => `${r.w}px: 字号 ${r.font} 高 ${r.chipH} 条宽 ${r.stripW} 文字 ${r.label ? "My shortcuts" : "-"}/${r.trackLabel ? "Tracking" : "-"} 收进… ${r.hidden || "-"} 缩放 ${r.scale} 药丸被裁 ${r.ulClip ? "是" : "否"}(${r.ulScroll}/${r.ulW})`).join(" | ");
  console.log("  [dr] 量到的：" + sweepText);
  const nonIncreasing = (key) => sweep.every((r, i) => i === 0 || r[key] <= sweep[i - 1][key] + 0.01);
  check("宽→窄各量一次：药丸字号、药丸高度、条宽都只会越窄越小或不变，不会越窄越大（包括收进「…」那一步字号也不会跳大）", nonIncreasing("font") && nonIncreasing("chipH") && nonIncreasing("stripW"), sweepText);
  check("最宽（2600）用正常最大尺寸：13px，缩放 1.00，两处文字都在，没有收进「…」", sweep[0].font === 13 && sweep[0].scale === "1.00" && sweep[0].label && sweep[0].trackLabel && sweep[0].hidden === "");
  check("每个宽度药丸都完整显示：没有被裁掉，也没有条内滚动（必显的缩小后一定放得下）", sweep.every((r) => !r.ulClip), sweepText);
  const half = sweep.find((r) => r.w === 960);
  check("半屏（960）：先把「My shortcuts」和「Tracking」几个字藏起来（只留三个圆圈），药丸还是 13px、没缩", !half.label && !half.trackLabel && half.circles === 3 && half.font === 13 && half.scale === "1.00", JSON.stringify(half));
  const narrowest = sweep[sweep.length - 1];
  check("最窄（480）：文字都藏着，字号 ≤ 宽屏的，不比宽屏大", !narrowest.label && !narrowest.trackLabel && narrowest.font <= sweep[0].font);
  check("文字标签是第一步：一旦藏起来，更窄的宽度上也是藏着的（不会窄了又出现）", sweep.every((r, i) => i === 0 || !sweep[i - 1].label ? !r.label || i === 0 || sweep[i - 1].label : true) && sweep.every((r, i) => i === 0 || !(r.label && !sweep[i - 1].label)));
  check("宽屏不折叠：1280 及以上、半屏（960）都没有收进「…」的药丸", sweep.filter((r) => r.w >= 960).every((r) => r.hidden === ""), sweepText);
  check("收进「…」的个数只增不减（越窄收得越多）", sweep.every((r, i) => i === 0 || r.hidden.split(",").filter(Boolean).length >= sweep[i - 1].hidden.split(",").filter(Boolean).length));
  let fi = JSON.parse(await fitInfo(2600));
  check("宽屏：全部摆得下，没有收进「…」，字号不缩", fi.hidden === "" && fi.scale === "1.00" && fi.ids.join() === "manifests,dispatch,forecast,workspace,schedule" && fi.oneRow);
  fi = JSON.parse(await fitInfo(1000));
  check("半屏（1000 宽）：先把两处文字藏起来，药丸全部还在、字号不缩、一行不换行", !fi.label && !fi.trackLabel && fi.hidden === "" && fi.scale === "1.00" && fi.font === 13 && fi.oneRow && fi.ids.join() === "manifests,dispatch,forecast,workspace,schedule" && fi.tracking, JSON.stringify(fi));
  fi = JSON.parse(await fitInfo(700));
  check("再窄（700）：文字藏着，药丸一个都不收进「…」，整条一起缩小（字号 < 13、≥ 13×0.65），一行、药丸完整", !fi.label && fi.hidden === "" && Number(fi.scale) < 1 && Number(fi.scale) >= 0.65 && fi.font < 13 && fi.oneRow && fi.ids.join() === "manifests,dispatch,forecast,workspace,schedule" && fi.tracking && fi.noOverflow && !fi.ulClip, JSON.stringify(fi));
  fi = JSON.parse(await fitInfo(520));
  check("更窄（520）：缩到下限（0.65）仍放不下，才把最后的非必显收进「…」，字号停在下限；必显的 Manifests / Dispatch / 7 Days Forecast / Tracking 都在，药丸完整", fi.hidden !== "" && !fi.hidden.split(",").some((id) => ["manifests", "dispatch", "forecast"].includes(id)) && fi.scale === "0.65" && fi.oneRow && ["manifests", "dispatch", "forecast"].every((id) => fi.ids.includes(id)) && fi.tracking && fi.noOverflow && !fi.ulClip, JSON.stringify(fi));
  fi = JSON.parse(await fitInfo(420));
  check("最窄（420）：文字藏着、非必显的在「…」里，必显的缩到下限 0.65 就放得下、药丸完整、条自己不溢出（Tracking 在条里面）", Number(fi.scale) >= 0.65 && Number(fi.scale) < 1 && fi.noOverflow && fi.tracking && !fi.ulClip, JSON.stringify(fi));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 480, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await evaluate(`${sc}.querySelector('button[aria-label="More shortcuts"]').click();`);
  await waitFor(`${sc}.querySelector('[data-shortcut-menu]')`);
  check("「…」菜单：列出被收起的那几个（可点链接，带 ×），不含必显的", await evaluate(`const m = ${sc}.querySelector('[data-shortcut-menu]'); const ids = [...m.querySelectorAll('[data-menu-shortcut]')].map(a => a.dataset.menuShortcut); return ids.length > 0 && !ids.some((id) => ['manifests','dispatch','forecast'].includes(id)) && m.textContent.includes('More shortcuts');`));
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  await sleep(200);
  check("按 Esc 关上「…」菜单", await evaluate(`return !${sc}.querySelector('[data-shortcut-menu]');`));
  // 必显五个在「窄了」时永远不会被收进菜单：只有 Manifests / Dispatch 两个必显 + 其余，窄到极限也一样
  await ctl({ shortcuts: '["dashboard","workspace","schedule","manifests","dispatch","forecast"]' });
  await openDashboard();
  fi = JSON.parse(await fitInfo(460));
  check("必显的排在最后也不会被收起（缩到下限还放不下时 Work Schedule / My Workspace 先进「…」，Manifests / Dispatch / 7 Days Forecast 留在条上）", fi.ids.includes("manifests") && fi.ids.includes("dispatch") && fi.ids.includes("forecast") && !fi.ids.includes("schedule"), JSON.stringify(fi));
  // 宽屏不折叠（Annie 2026-10-24 强调两次）：钉了很多个也是先整条缩小，不收进「…」
  // farm_out_report / quotation 现在仅 Super Admin 可见（Annie 2026-10-26），换 staff 看得到的条目凑数（order_log / send_log）。
  await ctl({ shortcuts: '["dashboard","manifests","dispatch","forecast","workspace","schedule","orders","send_log","forms","daily_report","order_log"]' });
  await openDashboard();
  fi = JSON.parse(await fitInfo(1920));
  check("钉了 10 个、1920 宽：同样一个都不收进「…」", fi.hidden === "" && fi.ids.length === 10 && fi.oneRow && !fi.ulClip, JSON.stringify(fi));
  await ctl({ shortcuts: '["dashboard","manifests","dispatch","forecast","workspace","schedule","orders","send_log","forms"]' });
  await openDashboard();
  fi = JSON.parse(await fitInfo(1280));
  check("钉了 8 个、1280 宽：一个都不收进「…」，整条缩小来适应（字号 < 13、≥ 13×0.65），药丸完整、一行", fi.hidden === "" && Number(fi.scale) < 1 && Number(fi.scale) >= 0.65 && fi.ids.length === 8 && fi.oneRow && !fi.ulClip && fi.noOverflow, JSON.stringify(fi));
  await ctl({ navConfig: null, shortcuts: null });
  // 其他页面顶栏下面的条：同样规则；当前所在页面的那个不显示（Dispatch 页上没有 Dispatch，Manifests 页上没有 Manifests）
  await ctl({ navConfig: null, shortcuts: null });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
  await goto(`${APP}/dispatch`);
  const bar = "document.querySelector('section[data-shortcut-strip=bar]')";
  await waitFor(`${bar} && ${bar}.querySelector('[data-shortcut=manifests]')`);
  check("顶栏下的条（Dispatch 页上）：← Back、Dashboard 是药丸里第一个且不能移除，Dispatch 自己不显示，其余默认的都在，Tracking 在 ← Back 之后、药丸之前", await evaluate(`const b = ${bar}; const ids = [...b.querySelectorAll('li[data-shortcut]')].map(li => li.dataset.shortcut); return b.querySelector('button').textContent.trim() === '← Back' && ids[0] === 'dashboard' && !b.querySelector('[data-shortcut=dashboard] button') && !ids.includes('dispatch') && ids.join() === 'dashboard,manifests,forecast,workspace,schedule' && !!b.querySelector('[data-shortcut=tracking_widget]') && b.querySelector('[data-shortcut=tracking_widget]').getBoundingClientRect().right <= b.querySelector('[data-shortcut=dashboard]').getBoundingClientRect().left && b.querySelector('[data-shortcut=tracking_widget]').getBoundingClientRect().left > b.querySelector('button').getBoundingClientRect().right;`));
  check("顶栏下的条：药丸 12.5px（保持现状），一行，高度不变", await evaluate(`const b = ${bar}; const li = b.querySelector('li[data-shortcut=manifests]'); return getComputedStyle(li).fontSize === '12.5px' && b.getBoundingClientRect().height < 56 && Math.round(li.getBoundingClientRect().height) === 32;`));
  await goto(`${APP}/manifests`);
  await waitFor(`${bar} && ${bar}.querySelector('[data-shortcut=dispatch]')`);
  check("Manifests 页上：Manifests 自己不显示，Dispatch 显示", await evaluate(`const ids = [...${bar}.querySelectorAll('li[data-shortcut]')].map(li => li.dataset.shortcut); return !ids.includes('manifests') && ids.includes('dispatch') && ids[0] === 'dashboard';`));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 760, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  check("顶栏下的条变窄（760）：不换行，必显的（Dashboard / Dispatch / 7 Days Forecast / Tracking）留在条上，其余进「…」", await evaluate(`const b = ${bar}; const lis = [...b.querySelectorAll('li[data-shortcut]')]; const ids = lis.map(li => li.dataset.shortcut); const tops = new Set(lis.map(li => Math.round(li.getBoundingClientRect().top))); return tops.size === 1 && ids.includes('dashboard') && ids.includes('dispatch') && ids.includes('forecast') && !!b.querySelector('[data-shortcut=tracking_widget]') && !!b.querySelector('button[aria-label="More shortcuts"]') && b.scrollWidth <= b.clientWidth + 1;`), await evaluate(`return ${bar}.dataset.fitScale + ' ' + ${bar}.dataset.fitHidden;`));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await ctl({ navConfig: null, shortcuts: null });

  // ── Settings → Navigation ──
  await ctl({ role: "admin", navConfig: null });
  await openDashboard();
  await openNav();
  await waitFor(`${nav}.textContent.includes('Human Resource')`);
  check(
    "admin：看得到 Settings，看不到 Navigation",
    await evaluate(`const t = ${nav}.textContent; return t.includes('Settings') && t.includes('Human Resource') && !t.includes('Navigation');`),
  );
  check(
    "admin：Settings 菜单里没有 Auto Send（只对 Super Admin，2026-10-24）",
    await evaluate(`const t = ${nav}.textContent; return t.includes('Content Studio') && !t.includes('Auto Send') && !${nav}.querySelector('a[href="/settings/auto-send"]');`),
  );
  await goto(`${APP}/settings/navigation`);
  check("admin 打开 Settings → Navigation：Superadmin access required", await waitFor("document.querySelector('main')?.textContent.includes('Superadmin access required')"));
  await ctl({ role: "superadmin" });
  await openDashboard();
  await openNav();
  await waitFor(`${nav}.textContent.includes('Navigation')`);
  check("superadmin：Settings 菜单里有 Auto Send", await evaluate(`return !!${nav}.querySelector('a[href="/settings/auto-send"]');`));
  await goto(`${APP}/settings/navigation`);
  await waitFor("document.querySelector('[data-nav-item=orders]')");
  await helpers();
  await evaluate(DRAG);
  check("superadmin：读不到配置时写明用的是内置默认值", (await evaluate("return document.querySelector('main').textContent;")).includes("The server doesn’t have navigation settings yet"));
  check("每个条目恰好一次（23 项，含 My Workspace、Farm out Report、Broadcast）", (await evaluate("return document.querySelectorAll('[data-nav-item]').length;")) === 23, await evaluate("return document.querySelectorAll('[data-nav-item]').length + ' ' + [...document.querySelectorAll('[data-nav-item]')].map(e => e.dataset.navItem).join();"));
  await evaluate("$setValue(document.querySelector('[data-nav-item=orders] input'), 'Order list'); document.querySelector('[data-nav-item=task_board] input[type=checkbox]').click(); return 1;");
  await sleep(100);
  await evaluate("$btn('', document.querySelector('[data-nav-item=forms]')); [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Move Forms up').click(); return 1;");
  await evaluate("$select('select[aria-label=\"Add a default shortcut\"]', 'orders'); return 1;");
  await sleep(150);
  check(
    "默认快捷方式：内置默认七个（去掉小部件是六个页面），再加 Orders",
    (await evaluate("return [...document.querySelectorAll('[data-default-shortcut]')].map(x => x.dataset.defaultShortcut).join(',');")) === "dashboard,manifests,dispatch,forecast,workspace,schedule,orders",
  );
  const fromLog = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click(); return 1;");
  await waitFor("document.querySelector('main').textContent.includes('Saved.')");
  const put = (await mockLog()).slice(fromLog).find((e) => e.path === "/api/admin/nav-config");
  const opsIds = put?.body.groups.find((g) => g.label === "Operations").items.map((i) => i.id).join(",");
  check(
    "Save：PUT /api/admin/nav-config，改名 / 隐藏 / 顺序 / 默认快捷方式都在请求里",
    !!put &&
      put.body.groups.find((g) => g.label === "Operations").items.find((i) => i.id === "orders").label === "Order list" &&
      put.body.groups.find((g) => g.label === "Reports").items.find((i) => i.id === "task_board").visible === false &&
      opsIds === "dashboard,workspace,forecast,manifests,orders,quotation,forms,dispatch,schedule,daily_report,farm_out_report" &&
      put.body.default_shortcuts.join(",") === "dashboard,manifests,dispatch,forecast,workspace,schedule,orders",
    JSON.stringify(put?.body),
  );
  await openNav();
  await waitFor(`${nav}.textContent.includes('Order list')`, 6000);
  check(
    "存了立即生效：侧栏重读配置（改名、隐藏），superadmin 看得到 Navigation",
    await evaluate(`const t = ${nav}.textContent; return t.includes('Order list') && !t.includes('Task Board') && t.includes('Navigation');`),
    await navText(),
  );
  await ctl({ failNavSave: true });
  await evaluate("$setValue(document.querySelector('[data-nav-item=orders] input'), 'Orders'); return 1;");
  await sleep(100);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click(); return 1;");
  await waitFor("document.querySelector('main').textContent.includes('Not saved')");
  check("配置存不上：写原因", (await evaluate("return document.querySelector('main').textContent;")).includes("Not saved: mock nav save failed"));
  await ctl({ failNavSave: false, role: "staff", navConfig: null });

  // ── 窄屏 ──
  await openDashboard();
  await cdp("Emulation.setDeviceMetricsOverride", { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  check("窄屏：侧栏藏起来", await evaluate(`return ${nav}.getBoundingClientRect().right <= 0;`));
  await evaluate("document.querySelector('header button[aria-label=\"Open menu\"]').click();");
  await sleep(400);
  check("窄屏：点顶栏 ☰ 打开浮层（展开的侧栏）", await evaluate(`return ${nav}.getBoundingClientRect().left >= 0 && !!${row("dispatch")};`));
  await evaluate(`${row("forms")}.querySelector('a').click();`);
  await waitFor("location.pathname === '/forms'");
  await sleep(400);
  check("窄屏：换页后浮层关上", await evaluate(`return ${nav}.getBoundingClientRect().right <= 0;`));
  await cdp("Emulation.clearDeviceMetricsOverride");
}
main().catch((e) => { console.error(e); process.exit(2); });




