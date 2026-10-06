// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
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



// ── Dispatch → Imports ──
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }
const card = (id) => `document.querySelector('article[data-import="${id}"]')`;
const lineRow = (id, n) => `${card(id)}.querySelector('tr[data-line="${n}"]')`;
const txt = (expr) => `return ${expr}.textContent;`;

async function run() {
  let before = (await mockLog()).length;
  await goto(`${APP}/dispatch/imports`);
  await waitFor("document.querySelector('article[data-import]')");
  await helpers();
  const first = (await since(before, (e) => e.path === "/api/dispatch/imports"))[0];
  check("默认不带 since（服务端定前 7 天），日期框填上服务端用的那天", first && first.q.since === undefined && (await evaluate("return document.getElementById('since').value;")) === "2026-09-27");
  check("上次拉取时间按洛杉矶显示", await evaluate("return document.body.textContent.includes('Last pull: 10/04 02:13 PM');"), await evaluate("return document.querySelector('[data-testid=last-pull]').textContent;"));
  check("上次失败的原因（带洛杉矶时间）", await evaluate("return document.body.textContent.includes('Last attempt failed at 10/04 02:43 PM: Discord rejected the bot token (401).');"));
  check("侧栏 Dispatch Imports 走站内、高亮，不标 old", await evaluate("const a = [...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent.startsWith('Dispatch Imports')); return !!a && a.getAttribute('href') === '/dispatch/imports' && a.getAttribute('aria-current') === 'page' && !a.textContent.includes('old');"), await evaluate("const a = [...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent.startsWith('Dispatch Imports')); return a ? a.outerHTML : 'none';"));
  check("侧栏 Dispatch 不跟着高亮", await evaluate("const a = [...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent.trim() === 'Dispatch'); return !!a && a.getAttribute('aria-current') !== 'page';"));

  // 卡片头
  check("卡片头：日期 Mon 10/05、Applied、Revision、1 line not read、标题", await evaluate(`const t = ${card(11)}.querySelector('div').textContent; return t.includes('Mon 10/05') && t.includes('Applied') && t.includes('Revision') && t.includes('1 line not read') && t.includes('NPE 10/5: Revision');`), await evaluate(txt(`${card(11)}.querySelector('div')`)));
  check("卡片头：车数、posted / edited 洛杉矶时间", await evaluate(`return ${card(11)}.querySelector('div').textContent.includes('3 vehicles · posted 10/04 02:13 PM · edited 10/04 03:30 PM');`), await evaluate(txt(`${card(11)}.querySelector('div')`)));
  check("被取代的一版变淡、写 Superseded、单数 vehicle", await evaluate(`return ${card(10)}.className.includes('opacity-60') && ${card(10)}.textContent.includes('Superseded') && ${card(10)}.textContent.includes('1 vehicle ·');`));
  check("顺序照服务端（同一天新版在前）", await evaluate("return [...document.querySelectorAll('article[data-import]')].map(a => a.dataset.import).join(',') === '11,10';"));
  check("原文默认收起，展开照原样显示（不当 HTML）", await evaluate(`const d = ${card(11)}.querySelector('details'); const closed = !d.open; d.open = true; const pre = d.querySelector('pre'); return closed && pre.textContent.includes('<b>FREDDY</b> - 768') && !pre.querySelector('b');`));
  check("关闭的团：团名 + Closed / CCL 原话；没有团名时写 CCL 段名", await evaluate(`const t = ${card(11)}.textContent; return t.includes('Hoover DamClosed') && t.includes('ANTELOPEClosed due to weather');`), await evaluate(txt(card(11))));

  // 行
  check("Relay 行：段名下写 Morning Relay · 1st Round；对上的写 → 名字；OK", await evaluate(`const t = ${lineRow(11, 1)}.textContent; return t.includes('MORNING RELAYMorning Relay · 1st Round') && t.includes('FREDDY→ Freddy L') && t.includes('768→ 768') && t.endsWith('OK');`), await evaluate(txt(lineRow(11, 1))));
  check("团车行：团名、Bus 字母、分不清的人列候选、车没对上 No match、Driver Guide、Label、CCL note", await evaluate(`const t = ${lineRow(11, 2)}.textContent; return t.includes('WEST RIMWest Rim Bus Tour') && t.includes('BRUCENo match - Bruce O or Bruce W?') && t.includes('9999No match') && t.includes('Driver Guide') && t.includes('WESTRIM') && t.includes('late start');`), await evaluate(txt(lineRow(11, 2))));
  check("私人团行：Private Tour、手填名 (typed, not in HR)、导游没对上、停用的车标 (inactive)", await evaluate(`const t = ${lineRow(11, 3)}.textContent; return t.includes('PRIVATEPrivate Tour') && t.includes('ZED→ ZED (typed, not in HR)') && t.includes('PAMNo match') && !t.includes('PAMNo match -') && t.includes('2056→ 2056 (inactive)');`), await evaluate(txt(lineRow(11, 3))));
  check("读不出的行：红底、写原因和原文、不写 No match", await evaluate(`const r = ${lineRow(11, 4)}; const t = r.textContent; return r.className.includes('bg-[#fff6f6]') && t.includes('No dash between name and vehicle') && t.includes('BOB 1328 ??') && !t.includes('No match');`), await evaluate(txt(lineRow(11, 4))));
  check("How to use 默认收起", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('How to use — Dispatch Imports') && !d.open);"));

  // 换起始日
  before = (await mockLog()).length;
  await evaluate("$setValue(document.getElementById('since'), '2026-10-30'); document.getElementById('since').dispatchEvent(new Event('change', { bubbles: true }));");
  await sleep(100);
  await evaluate("$btn('Show').click();");
  await waitFor("document.body.textContent.includes('No CCL schedules imported for these days yet')");
  const req2 = (await since(before, (e) => e.path === "/api/dispatch/imports"))[0];
  check("Show：带 since 查、地址栏 ?since=、没有时写空提示", req2?.q.since === "2026-10-30" && (await evaluate("return location.search;")) === "?since=2026-10-30");

  // 打开时认 ?since=
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch/imports?since=2026-10-30`);
  await waitFor("document.body.textContent.includes('No CCL schedules imported')");
  await helpers();
  check("打开时认 ?since=", (await since(before, (e) => e.path === "/api/dispatch/imports"))[0]?.q.since === "2026-10-30" && (await evaluate("return document.getElementById('since').value;")) === "2026-10-30");
  await goto(`${APP}/dispatch/imports?since=not-a-date`);
  await waitFor("document.querySelector('article[data-import]')");
  await helpers();
  check("?since= 不是日期：不传（用服务端默认），不报错", await evaluate("return document.getElementById('since').value;") === "2026-09-27");

  // 拉取
  await ctl({ pullStatus: "nothing" });
  before = (await mockLog()).length;
  await evaluate("$btn('Pull from Discord').click();");
  await sleep(100);
  check("拉取中：按钮灰掉写 Pulling...", await evaluate("const b = $btn('Pulling...'); return !!b && b.disabled;"));
  await waitFor("document.body.textContent.includes('Nothing new from CCL')");
  const pr = (await since(before, (e) => e.path === "/api/dispatch/imports/pull"))[0];
  check("拉取：trigger manual；没新东西写一句（绿）、不重拉列表、上次拉取时间更新", pr?.body.trigger === "manual" && (await since(before, (e) => e.path === "/api/dispatch/imports")).length === 0 && (await evaluate("return document.body.textContent.includes('Last pull: 10/04 03:00 PM') && [...document.querySelectorAll('[role=status]')].some(p => p.textContent.includes('Nothing new') && p.className.includes('3B6D11'));")));
  await ctl({ pullStatus: "new" });
  before = (await mockLog()).length;
  await evaluate("$btn('Pull from Discord').click();");
  await waitFor("document.querySelector('article[data-import=\"12\"]')");
  check("拉到新的：结果那句话留着、列表自动重拉出现新的一天", await evaluate("return document.body.textContent.includes('1 new schedule from CCL.');") && (await since(before, (e) => e.path === "/api/dispatch/imports")).length === 1);
  await ctl({ pullStatus: "failed" });
  await evaluate("$btn('Pull from Discord').click();");
  await waitFor("document.body.textContent.includes('Pull failed: Discord rejected')");
  check("拉取失败：红字写原因", await evaluate("return [...document.querySelectorAll('[role=status]')].some(p => p.textContent.includes('Pull failed') && p.className.includes('A32D2D'));"));

  // 列表出错
  await ctl({ failList: true });
  await evaluate("$btn('Show').click();");
  await waitFor("document.querySelector('[role=alert]')");
  check("列表拉不到：红条写原因 + Retry，旧内容变淡留着", await evaluate("return document.querySelector('[role=alert]').textContent.includes('Could not load the imports') && !!$btn('Retry') && document.querySelectorAll('article[data-import]').length > 0;"));
  await ctl({ failList: false });
  await evaluate("$btn('Retry').click();");
  await waitFor("!document.querySelector('[role=alert]') && document.querySelectorAll('article[data-import]').length === 3 && !document.body.textContent.includes('Loading…')");
  check("Retry 后恢复", await evaluate("return !document.querySelector('[role=alert]') && document.querySelectorAll('article[data-import]').length === 3;"));

  // 401
  await ctl({ fail401: true });
  await goto(`${APP}/dispatch/imports`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${MOCK}/auth/login?next=`));
  await ctl({ fail401: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
