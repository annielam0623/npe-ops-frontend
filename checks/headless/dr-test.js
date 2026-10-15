// 用 Chrome DevTools 协议驱动 headless Chrome，检查 dashboard 改版阶段一：侧栏、My shortcuts、Messages 每窗两张、Settings → Navigation。
// 前提：mock（dr-mock.js）在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:3198";
const MOCK = "http://localhost:8799";
const PORT = 9333;
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
    `--user-data-dir=${path.join(__dirname, "chrome-profile")}`,
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
const tiles = `[...${sc}.querySelectorAll('[data-shortcut]')].map(li => li.dataset.shortcut).join(',')`;
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
  await waitFor(`!${sc}.querySelector('ul[aria-busy=true]')`);
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
    "Operations 的条目和顺序（含 My Workspace、Quotation、Forms、Staff Schedule、Daily Operation Report）",
    (await evaluate(`return [...${nav}.querySelector('section[aria-label=Operations]').querySelectorAll('[data-module]')].map(r => r.dataset.module).join(',');`)) ===
      "dashboard,workspace,forecast,manifests,orders,quotation,dispatch,forms,schedule,daily_report",
    await evaluate(`return [...${nav}.querySelectorAll('[data-module]')].map(r => r.dataset.module).join(',');`),
  );
  check("拿掉了 Dispatch Imports / Work Sheet / Guide Sheet", !/Dispatch Imports|Work Sheet|Guide Sheet/.test(t1));
  check(
    "Quotation / Staff Schedule / Daily Operation Report 标 SOON，照样是链接",
    await evaluate(`return ['quotation','schedule','daily_report'].every(id => { const r = ${nav}.querySelector('[data-module=' + id + ']'); return r && r.textContent.includes('SOON') && r.querySelector('a[href]'); }) && !${row("orders")}.textContent.includes('SOON');`),
  );
  check(
    "每个条目都能拖（draggable）、有钉子",
    await evaluate(`return [...${nav}.querySelectorAll('[data-module]')].every(r => r.querySelector('a[draggable=true]') && r.querySelector('button[aria-pressed]'));`),
  );
  check("说明：Click a button to open it…", t1.includes("Click a button to open it. Drag it onto your desktop, or use the pin, to keep it as a shortcut."));
  check("当前页 Dashboard 高亮", (await evaluate(`return [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent).join('|');`)) === "Dashboard");
  check(
    "链接（已全部切换）：都去 ops 路径",
    await evaluate(`const h = (id) => ${nav}.querySelector('[data-module=' + id + '] a').getAttribute('href'); return h('manifests') === '/manifests' && h('dispatch') === '/dispatch' && h('forms') === '/forms' && h('quotation') === '/quotation' && h('schedule') === '/schedule' && h('daily_report') === '/daily-report';`),
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
  await evaluate(`${row("quotation")}.querySelector('a').click();`);
  await waitFor("location.pathname === '/quotation' && document.querySelector('main')?.textContent.includes('Coming soon')");
  check(
    "Quotation：占位页 Coming soon，顶栏写页面名",
    await evaluate("return document.querySelector('main h1').textContent === 'Quotation' && document.querySelector('header').textContent.includes('Quotation');"),
  );
  await goto(`${APP}/schedule`);
  await waitFor(`${nav} && document.querySelector('main')?.textContent.includes('Coming soon')`);
  check("重新打开页面：侧栏又是收起的", await evaluate(`return ${nav}.dataset.state === 'closed';`));

  // ── 发送卡片、区块顺序、问候语一行 ──
  await openDashboard();
  await waitFor(`${lane("morning")}`);
  check(
    "区块顺序：发送卡片 → My shortcuts → Today’s tasks → Messages → Daily Operation Report",
    await evaluate("const y = (l) => document.querySelector('section[aria-label=\"' + l + '\"]').getBoundingClientRect().top; const m = document.getElementById('messages-title').getBoundingClientRect().top; return y('Quick actions') < y('My shortcuts') && y('My shortcuts') < y('Today’s tasks') && y('Today’s tasks') < m && m < y('Daily Operation Report');"),
  );
  check(
    "发送卡片：四张，没有 Dispatch；缩小一档（每张高度 ≤ 110px）",
    await evaluate("const s = document.querySelector('section[aria-label=\"Quick actions\"]'); const cards = [...s.children]; return cards.length === 4 && !s.textContent.includes('Dispatch') && cards.every(c => c.getBoundingClientRect().height <= 110);"),
    await evaluate("return [...document.querySelector('section[aria-label=\"Quick actions\"]').children].map(c => c.getBoundingClientRect().height).join(',');"),
  );
  // Annie 2026-10-14：问候语不需要那么多位置 ⇒ 挪到顶栏和搜索框一行，页面上的大标题和说明拿掉。
  check(
    "问候语在顶栏一行，页面上没有大标题和说明",
    await evaluate("return document.querySelector('header').textContent.includes('Good morning') && !document.querySelector('main').textContent.includes('Your daily hub');"),
    await evaluate("return document.querySelector('header').textContent;"),
  );
  check(
    "Today’s tasks / Daily Operation Report：占位框",
    await evaluate("return ['Today’s tasks','Daily Operation Report'].every(l => document.querySelector('section[aria-label=\"' + l + '\"]').textContent.includes('Coming in a later phase'));"),
  );
  check(
    "My shortcuts 的用法说明和标题同一行、不换行",
    await evaluate(`const h = ${sc}.querySelector('h2'); const s = h.nextElementSibling; return s.textContent.includes('Drag a page here from the') && Math.abs(h.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom) < 8 && s.getBoundingClientRect().height < 22;`),
  );

  // ── Messages：每窗两张 ──
  check(
    "Messages 说明：每窗两条、窗内滚动",
    (await evaluate("return document.getElementById('messages-title').closest('section').textContent;")).includes("Each window shows two messages — scroll inside a window for the rest."),
  );
  check(
    "早班窗（4 张，第一张特别高）：只露前两张的实际高度，其余窗内滚动",
    await evaluate(`const el = ${lane("morning")}; const c = el.children; const want = c[0].offsetHeight + parseFloat(getComputedStyle(el).rowGap) + c[1].offsetHeight; return c[0].offsetHeight > c[1].offsetHeight + 10 && Math.abs(el.clientHeight - want) <= 2 && el.scrollHeight > el.clientHeight + 50;`),
    await evaluate(`const el = ${lane("morning")}; return el.clientHeight + ' / ' + el.scrollHeight + ' / ' + [...el.children].map(c => c.offsetHeight).join(',');`),
  );
  check(
    "Tickets 窗（2 张）、Tour 窗（1 张）：不限高、不滚动",
    await evaluate(`return ['tickets','tour'].every(l => { const el = document.querySelector('[data-lane-list=' + l + ']'); return !el.style.maxHeight && el.scrollHeight <= el.clientHeight + 1; });`),
  );

  // ── My shortcuts ──
  check("没存过、配置读不到：用内置默认值（Dispatch）", (await evaluate(`return ${tiles};`)) === "dispatch");
  check(
    "快捷方式块的链接走 page-switch（已切换，去 ops 路径）",
    (await evaluate(`return ${sc}.querySelector('[data-shortcut=dispatch] a').getAttribute('href');`)) === "/dispatch",
  );
  await openNav();
  const before = (await puts()).length;
  await evaluate(`${pin("manifests")}.click();`);
  await waitSaved();
  let p = await puts();
  check(
    "侧栏钉住 Manifests：加到最后，立刻存（PUT 值是 id 的 JSON 数组）",
    (await evaluate(`return ${tiles};`)) === "dispatch,manifests" && p.length === before + 1 && p[p.length - 1].body.value === '["dispatch","manifests"]',
    JSON.stringify(p.slice(-1)),
  );
  check("钉住后钉子是按下状态", (await evaluate(`return ${pin("manifests")}.getAttribute('aria-pressed');`)) === "true");
  await evaluate(`$drag(${row("orders")}.querySelector('a'), ${sc});`);
  await waitSaved();
  check(
    "从侧栏拖进框里：加到最后并保存",
    (await evaluate(`return ${tiles};`)) === "dispatch,manifests,orders" && (await puts()).pop().body.value === '["dispatch","manifests","orders"]',
    await evaluate(`return ${tiles};`),
  );
  await evaluate(`$drag(${row("quotation")}.querySelector('a'), ${sc}.querySelector('[data-shortcut=manifests]'));`);
  await waitSaved();
  check(
    "拖到某一块上：放在那一块前面；SOON 的条目也能拖",
    (await evaluate(`return ${tiles};`)) === "dispatch,quotation,manifests,orders" && (await evaluate(`return ${sc}.querySelector('[data-shortcut=quotation]').textContent.includes('SOON');`)),
    await evaluate(`return ${tiles};`),
  );
  await evaluate(`$drag(${sc}.querySelector('[data-shortcut=orders]'), ${sc}.querySelector('[data-shortcut=dispatch]'));`);
  await waitSaved();
  check(
    "框里拖动排序",
    (await evaluate(`return ${tiles};`)) === "orders,dispatch,quotation,manifests" && (await puts()).pop().body.value === '["orders","dispatch","quotation","manifests"]',
    await evaluate(`return ${tiles};`),
  );
  await evaluate(`${sc}.querySelector('[data-shortcut=quotation] button').click();`);
  await waitSaved();
  check("× 移除", (await evaluate(`return ${tiles};`)) === "orders,dispatch,manifests");
  await evaluate(`${pin("manifests")}.click();`);
  await waitSaved();
  check(
    "侧栏再点钉子 = 取消钉住",
    (await evaluate(`return ${tiles};`)) === "orders,dispatch" && (await evaluate(`return ${pin("manifests")}.getAttribute('aria-pressed');`)) === "false",
  );
  // 存不上：退回改动前、写原因、能重试
  await ctl({ failSave: true });
  await evaluate(`${pin("forms")}.click();`);
  await waitSaved();
  check(
    "保存失败：块退回改动前、框里写原因",
    (await evaluate(`return ${tiles};`)) === "orders,dispatch" && (await evaluate(`return ${sc}.querySelector('[role=alert]')?.textContent || '';`)).includes("mock save failed"),
    await evaluate(`return ${tiles} + ' | ' + (${sc}.querySelector('[role=alert]')?.textContent || '');`),
  );
  await ctl({ failSave: false });
  await evaluate(`$btn('Try again', ${sc}).click();`);
  await waitSaved();
  check(
    "Try again：再存一次，成功后错误消失",
    (await evaluate(`return ${tiles};`)) === "orders,dispatch,forms" && !(await evaluate(`return !!${sc}.querySelector('[role=alert]');`)),
  );
  // 跟账号走：清掉浏览器存储再开，读回同一份
  await evaluate("localStorage.clear(); sessionStorage.clear(); return 1;");
  await openDashboard();
  check("重新打开（清掉浏览器存储）：读回服务端存的同一份", (await evaluate(`return ${tiles};`)) === "orders,dispatch,forms");
  await evaluate(`$btn('Reset to default', ${sc}).click();`);
  await waitSaved();
  check(
    "Reset to default：回到默认（Dispatch）并保存",
    (await evaluate(`return ${tiles};`)) === "dispatch" && (await puts()).pop().body.value === '["dispatch"]',
  );
  await ctl({ shortcuts: "[]" });
  await openDashboard();
  check(
    "空的：写 No shortcuts yet…",
    (await evaluate(`return ${sc}.textContent;`)).includes("No shortcuts yet — drag any module from the menu on the left and drop it here."),
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
    "侧栏照配置：改名、隐藏的不显示、不认识的丢掉；配置里没写的条目放回原分组",
    t2.includes("Bookings") && !t2.includes("Promotion Stats") && !t2.includes("Unknown") && t2.includes("Morning Pickup") && t2.includes("Quotation"),
    t2,
  );

  // ── Settings → Navigation ──
  await ctl({ role: "admin", navConfig: null });
  await openDashboard();
  await openNav();
  await waitFor(`${nav}.textContent.includes('Human Resource')`);
  check(
    "admin：看得到 Settings，看不到 Navigation",
    await evaluate(`const t = ${nav}.textContent; return t.includes('Settings') && t.includes('Human Resource') && !t.includes('Navigation');`),
  );
  await goto(`${APP}/settings/navigation`);
  check("admin 打开 Settings → Navigation：Superadmin access required", await waitFor("document.querySelector('main')?.textContent.includes('Superadmin access required')"));
  await ctl({ role: "superadmin" });
  await goto(`${APP}/settings/navigation`);
  await waitFor("document.querySelector('[data-nav-item=orders]')");
  await helpers();
  await evaluate(DRAG);
  check("superadmin：读不到配置时写明用的是内置默认值", (await evaluate("return document.querySelector('main').textContent;")).includes("The server doesn’t have navigation settings yet"));
  check("每个条目恰好一次（21 项，含 My Workspace）", (await evaluate("return document.querySelectorAll('[data-nav-item]').length;")) === 21);
  await evaluate("$setValue(document.querySelector('[data-nav-item=orders] input'), 'Order list'); document.querySelector('[data-nav-item=task_board] input[type=checkbox]').click(); return 1;");
  await sleep(100);
  await evaluate("$btn('', document.querySelector('[data-nav-item=forms]')); [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Move Forms up').click(); return 1;");
  await evaluate("$select('select[aria-label=\"Add a default shortcut\"]', 'manifests'); return 1;");
  await sleep(150);
  check(
    "默认快捷方式：加了 Manifests",
    (await evaluate("return [...document.querySelectorAll('[data-default-shortcut]')].map(x => x.dataset.defaultShortcut).join(',');")) === "dispatch,manifests",
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
      opsIds === "dashboard,workspace,forecast,manifests,orders,quotation,forms,dispatch,schedule,daily_report" &&
      put.body.default_shortcuts.join(",") === "dispatch,manifests",
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




