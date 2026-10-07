// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /manifests。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:3198";
const MOCK = "http://localhost:8799";
const PORT = 9333;

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
async function since(from, pred) {
  return (await mockLog()).slice(from).filter(pred);
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
const HELPERS = `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
`;
async function helpers() {
  await evaluate(HELPERS);
}

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const yesterday = shiftYmd(today, -1);

async function run() {
  // ── staff：Admin access required，不发 /api/manifests ──
  await ctl({ fail401: false, staff: true, fail: false });
  await goto(`${APP}/manifests`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff：Admin access required", await evaluate("return document.body.textContent.includes('Admin access required');"));
  check("staff：没发 /api/manifests", (await mockLog()).filter((e) => e.path === "/api/manifests").length === 0);

  // ── admin：默认今天，地址栏补 ?date= ──
  await ctl({ fail401: false, staff: false, fail: false });
  await goto(`${APP}/manifests`);
  await waitFor("document.querySelectorAll('table').length > 0");
  await helpers();
  check("地址栏带今天的 ?date=", (await evaluate("return location.search;")) === `?date=${today}`);
  check("标题和说明", await evaluate("return document.querySelector('h1').textContent === 'Manifests' && document.body.textContent.includes('Read-only');"));

  // ── 分块顺序：Antelope Canyon Group → Shuttle Group → No group → Not in Products yet ──
  const blockTitles = await evaluate("return [...document.querySelectorAll('section h2')].map(h => h.textContent);");
  check("分块顺序：两个组（按 sort）→ No group → Not in Products yet", blockTitles.join("|") === "Antelope Canyon Group|Shuttle Group|No group|Not in Products yet", blockTitles.join("|"));

  // ── 每块的统计（orders / pax / rows）──
  const blockStats = await evaluate("return [...document.querySelectorAll('section')].map(s => s.querySelector('h2')?.nextElementSibling?.textContent.trim());");
  check("Antelope Canyon Group：2 单 6 人 2 行", blockStats[0] === "2 orders · 6 pax · 2 rows", blockStats[0]);
  check("Shuttle Group：1 单 1 人 1 行", blockStats[1] === "1 order · 1 pax · 1 row", blockStats[1]);

  // ── 行内容（按列序号核对，列顺序：Order# Guest Phone Product Pax Pickup Status Cfm# Sent Agent）──
  check("ORD-A1：产品、分类、人数、接客、状态、确认号、Agent 各列正确", await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ORD-A1'));
    const c = tr.children;
    return c[3].textContent.includes('Antelope Canyon') && c[3].textContent.includes('Bus Tour')
      && c[4].textContent.trim() === '2' && c[5].textContent.includes('7:00 AM') && c[5].textContent.includes('Aria')
      && c[6].textContent.trim() === 'confirmed' && c[7].textContent.trim() === 'CFM-1' && c[9].textContent.trim() === 'Website';
  `));
  check("ORD-C1：没有接客时间 / 地点显示 —，状态 unknown 灰色徽章", await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ORD-C1'));
    const c = tr.children;
    return c[5].textContent.trim() === '—' && c[6].textContent.trim() === 'unknown' && c[6].querySelector('span').className.includes('stone-100');
  `));

  // ── Sent 胶囊：未发（灰）/ Tour 已发 ✓（绿，带提示）/ Morning 一个渠道失败 ⚠ / Tickets 已发 ✓ ──
  check("ORD-A1：Tour ✓（绿）、Morning / Tickets 未发（灰）", await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ORD-A1'));
    const tour = [...tr.querySelectorAll('span')].find(s => s.textContent.startsWith('Tour'));
    const morning = [...tr.querySelectorAll('span')].find(s => s.textContent.startsWith('Morning'));
    return tour.textContent === 'Tour ✓' && tour.className.includes('emerald') && morning.textContent === 'Morning' && morning.className.includes('stone');
  `));
  check("ORD-A1：Tour 胶囊提示写 by / at", await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ORD-A1'));
    const tour = [...tr.querySelectorAll('span')].find(s => s.textContent.startsWith('Tour'));
    return tour.title.includes('sent') && tour.title.includes('by annie');
  `));
  check("ORD-B1：Morning ⚠（一个渠道失败），提示写 sms failed / email delivered", await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ORD-B1'));
    const morning = [...tr.querySelectorAll('span')].find(s => s.textContent.startsWith('Morning'));
    return morning.textContent === 'Morning ⚠' && morning.title.includes('sms failed') && morning.title.includes('email delivered');
  `));
  check("ORD-C1：Tickets ✓（绿）", await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ORD-C1'));
    const tickets = [...tr.querySelectorAll('span')].find(s => s.textContent.startsWith('Tickets'));
    return tickets.textContent === 'Tickets ✓' && tickets.className.includes('emerald');
  `));

  // ── Legacy 标记 + 顶部提示条 ──
  check("ORD-A2（legacy）行内有 Legacy 标签", await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ORD-A2')); return tr.textContent.includes('Legacy');"));
  check("顶部黄条写 1 row 来自冻结数据", await evaluate("return document.body.textContent.includes('1 row comes from data frozen before Aug 16, 2026');"));

  // ── 导出 CSV ──
  await evaluate(`
    window.__blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  `);
  await evaluate("$btn('⬇ Export CSV').click();");
  await sleep(150);
  const csv = await evaluate("return window.__blob ? await window.__blob.text() : '';");
  const name = await evaluate("return window.__download;");
  check("导出文件名", name === `manifests_${today}.csv`, name);
  check("导出带表头和全部 5 行", csv.includes("Order #,Guest,Phone,Email,Group,Category,Product") && csv.split("\r\n").length === 6, csv.split("\r\n").length);

  // ── ‹ › 换日期：地址栏和请求都带新日期；没有数据时显示 No live orders ──
  let before = (await mockLog()).length;
  await evaluate("document.querySelector('[aria-label=\"Previous day\"]').click();");
  await waitFor(`location.search === '?date=${yesterday}'`);
  check("‹：地址栏变成前一天", (await evaluate("return location.search;")) === `?date=${yesterday}`);
  check("‹：发请求查前一天", (await since(before, (e) => e.path === "/api/manifests" && e.query === `?date=${yesterday}`)).length === 1);
  await waitFor("document.body.textContent.includes('No live orders for this date.')");
  check("没有数据：No live orders for this date.", await evaluate("return document.body.textContent.includes('No live orders for this date.');"));

  // ── Today 按钮回到今天 ──
  await evaluate("$btn('Today').click();");
  await waitFor(`location.search === '?date=${today}'`);
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  check("Today：回到今天、重新看到 5 行数据", (await evaluate("return location.search;")) === `?date=${today}` && (await evaluate("return document.querySelectorAll('tbody tr').length;")) === 5);

  // ── 加载失败：显示原因、Retry 重拉同一天 ──
  await ctl({ fail: true });
  await evaluate("document.querySelector('[aria-label=\"Previous day\"]').click();");
  await waitFor("document.body.textContent.includes('Could not load manifests');");
  check("加载失败：写原因", await evaluate("return document.body.textContent.includes('Could not load manifests: Internal Server Error');"));
  await ctl({ fail: false });
  await evaluate("$btn('Retry').click();");
  // 等最终状态（不等错误条先消失）：重拉中间会先进 Loading，那一刻两句话都不在，等中间态会偶发误判。
  await waitFor("document.body.textContent.includes('No live orders for this date.')");
  check("Retry：错误条消失、重新拉到这天（没有数据显示 No live orders）", !(await evaluate("return document.body.textContent.includes('Could not load manifests');")));

  // ── 未登录跳旧后台登录页 ──
  await ctl({ fail401: true });
  await goto(`${APP}/manifests`);
  await waitFor("location.pathname === '/auth/login'", 8000);
  check("未登录跳旧后台登录页带 next", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });

  // ── 还在用初始密码：接口回 403「Password change required」，跳改密码页（后端 G32 第 4 条，apiFetch 全局拦截）──
  await ctl({ pwdChange: true });
  await goto(`${APP}/manifests`);
  await waitFor("location.pathname === '/auth/change-password'", 8000);
  check("403 Password change required：跳站内改密码页带 next", (await evaluate("return location.href;")).startsWith(`${APP}/auth/change-password?next=${encodeURIComponent("/manifests")}`));
  await ctl({ pwdChange: false });
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

main();
