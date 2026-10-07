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


// ── Order Log 检查（拼在 harness-head.js 后面运行） ──
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const SEL = `window.$sel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };`;

async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
  await goto(`${APP}/order-log`);
  await waitFor("document.querySelectorAll('tbody tr').length === 50");
  await helpers();
  await evaluate(SEL);

  let log = await mockLog();
  check("默认今天、第 1 页、每页 50", log.some((e) => e.query === `?date_from=${today}&date_to=${today}&page=1&page_size=50`), JSON.stringify(log.map((e) => e.query)));
  check("统计：Total 130 / 客人 33 / 员工 97（含 Field Updated）", (await evaluate("return $t('section[aria-label=Summary] > div').join('|');")) === "Total130|Guest Actions33|Staff Actions97");
  const rows = await evaluate("return $rows();");
  check("Field Updated 有名字（旧页面显示原始代码）", rows[2][2] === "Field Updated", rows[2][2]);
  check("Detail 照原样显示，不当 HTML", rows[1][3] === "<img src=x onerror=alert(1)>" && !(await evaluate("return !!document.querySelector('tbody img');")));
  check("颜色不是 #RRGGBB 的改成灰色", (await evaluate("return document.querySelectorAll('tbody tr')[5].children[2].querySelector('span').style.color;")) === "rgb(136, 136, 136)");
  check("分页：Page 1 of 3", await evaluate("return document.body.textContent.includes('Page 1 of 3');"));
  let before = (await mockLog()).length;
  await evaluate("$btn('Next →').click();");
  await waitFor("document.body.textContent.includes('Page 2 of 3')");
  check("Next：page=2", (await since(before, (e) => e.query.includes("page=2&"))).length >= 1);
  before = (await mockLog()).length;
  await evaluate("$sel([...document.querySelectorAll('select')][0], 'action_taken');");
  await sleep(500);
  check("改筛选回到第 1 页（旧页面不回）", (await since(before, (e) => e.query.includes("event_type=action_taken") && e.query.includes("page=1&"))).length >= 1);
  check("事件下拉没有 Guest Confirmed（永远是空的）", !(await evaluate("return [...document.querySelectorAll('select')][0].textContent.includes('Guest Confirmed');")));
  before = (await mockLog()).length;
  // 10-05 起订单号是边打边查（停 400ms）、不限日期，没有 Filter 按钮（task/log-search-compact）。
  await evaluate("$setValue(document.getElementById('order-number'), 'CHDZZ12');");
  await sleep(900);
  check("订单号：边打边查、不带日期", (await since(before, (e) => e.query.includes("order_number=CHDZZ12") && !e.query.includes("date_from"))).length >= 1);
  before = (await mockLog()).length;
  await evaluate("$btn('Yesterday').click();");
  await sleep(500);
  check("Yesterday", (await since(before, (e) => e.query.includes(`date_from=${yesterday}&date_to=${yesterday}`))).length >= 1);
  await evaluate("$btn('Reset').click();");
  await waitFor("document.querySelectorAll('tbody tr').length === 50");
  check("Reset：回到今天、全部、清空订单号", (await evaluate("return document.getElementById('order-number').value;")) === "" && (await evaluate(`return document.querySelector('[role=group][aria-label="Date range"] button[aria-pressed=true]').textContent;`)) === "Today");

  // ── 导出全部 ──
  await evaluate(`
    window.__blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  `);
  before = (await mockLog()).length;
  await evaluate("$btn('⬇ Export').click();");
  await waitFor("!!window.__blob", 10000);
  const csv = await evaluate("return await window.__blob.text();");
  const lines = csv.trim().split("\r\n");
  check("导出：所有页（130 行 + 表头），每次拉 200", lines.length === 131 && (await since(before, (e) => e.query.includes("page_size=200"))).length >= 1, `${lines.length}`);
  check("导出文件名和表头", (await evaluate("return window.__download;")) === `order_log_${today}.csv` && lines[0].replace(/^﻿/, "") === "Tour Date,Order #,Event,Detail,By,Type,Modified At");

  const lineOf = (no) => lines.find((l) => l.includes(`,${no},`)) || "";
  check("导出防公式注入：= / @ 开头的文字前加 '", lineOf("CHDZZ4").includes(",'=1+2,") && lineOf("CHDZZ10").includes(",'@SUM(A1),"), `${lineOf("CHDZZ4")} / ${lineOf("CHDZZ10")}`);
  check("导出：普通负数不加 '", lineOf("CHDZZ8").includes(",-5,"), lineOf("CHDZZ8"));

  // 分页重叠（后端没有次序键）：按 id 去重。
  await ctl({ overlap: true });
  await evaluate("window.__blob = null;");
  await evaluate("$btn('⬇ Export').click();");
  await waitFor("!!window.__blob", 15000);
  const bigLines = (await evaluate("return await window.__blob.text();")).trim().split(String.fromCharCode(13, 10));
  const bigOrders = bigLines.slice(1).map((l) => l.split(",")[1]);
  check("导出：跨页重复的行按 id 去重（450 行、不重复）", bigLines.length === 451 && new Set(bigOrders).size === 450, `${bigLines.length} lines, ${new Set(bigOrders).size} unique`);
  await ctl({ overlap: false });

  await ctl({ fail500: true });
  await evaluate("$btn('Yesterday').click();");
  await waitFor("document.body.textContent.includes('Could not load the order log')");
  check("出错：显示原因（旧页面显示 No records found.）", await evaluate("return document.body.textContent.includes('Internal Server Error');"));
  await ctl({ fail500: false, fail401: true });
  await goto(`${APP}/order-log`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
