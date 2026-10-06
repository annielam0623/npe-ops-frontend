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




// ── 门票发送：防重发 / 预览拦截 / 断开提示（拼在 harness-head.js 后面运行） ──
const DIR = __dirname.replace(/\\/g, "/");
const DATE = "2026-10-10";
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
const rowOf = (order, nth = 0) => `[...document.querySelectorAll('tbody tr')].filter(tr => tr.children[0].textContent === '${order}')[${nth}]`;
async function upload(scenario, extra = {}) {
  await ctl({ scenario, serverSkip: ["T05"], fail502At: 0, reject400: "", noPhone: [], applyDelay: 0, ...extra });
  await goto(`${APP}/tickets-reminder/send`);
  await waitFor("document.querySelector('select')");
  await helpers();
  await evaluate(`
    const sel = document.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'upper_antelope_tsosie');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const d = document.querySelector('input[type=date]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(d, '${DATE}');
    d.dispatchEvent(new Event('input', { bubbles: true }));
    d.dispatchEvent(new Event('change', { bubbles: true }));`);
  await setFile("input[type=file]", `manifest-${DATE}.csv`);
  await sleep(200);
  await evaluate("$btn('Upload & Preview').click();");
  await waitFor("document.querySelector('tbody tr') && document.body.textContent.includes('booking')");
}
async function sendAll() {
  await evaluate("[...document.querySelectorAll('button')].find(b => /^Send \\d+ Reminder/.test(b.textContent.trim())).click();");
  await waitFor(dialog);
}

async function run() {
  require("fs").writeFileSync(`${DIR}/manifest-${DATE}.csv`, "Order Number\nT01\n");
  await goto(`${APP}/tickets-reminder/send`);
  await waitFor("document.querySelector('input[type=file]')");
  check("上传页：文件框收 .csv 和 .xlsx、有 How to use", await evaluate("return document.querySelector('input[type=file]').accept === '.csv,.xlsx' && document.body.textContent.includes('Manifest (.csv or .xlsx)') && document.body.textContent.includes('How to use — Tickets Reminder');"));
  await upload("normal");
  check("同一单第二行：Listed twice、没有 Send anyway", await evaluate(`return ${rowOf("T02", 1)}.textContent.includes('Listed twice in this file') && !${rowOf("T02", 1)}.querySelector('input[type=checkbox]') && !${rowOf("T02", 0)}.textContent.includes('Listed twice');`));
  check("已发过的：Duplicate + Send anyway；CSV 显示人数和 Quantities", await evaluate(`return ${rowOf("T01")}.textContent.includes('Duplicate') && !!${rowOf("T01")}.querySelector('input[type=checkbox]') && ${rowOf("T03")}.children[5].textContent === '2Adult: 2';`));
  check("提示：1 already sent and 1 listed twice will be skipped；按钮 Send 11", await evaluate("return document.body.textContent.includes('1 already sent and 1 listed twice will be skipped.') && !!$btn('Send 11 Reminders');"));

  // 不勾 Send anyway 发
  await sendAll();
  check("确认框：11 位、2 位跳过", await evaluate(`return ${dialog}.textContent.includes('11 guests') && ${dialog}.textContent.includes('2 will be skipped');`));
  let before = (await mockLog()).length;
  await evaluate(`$btn('Send to 11 guests', ${dialog}).click();`);
  await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === 'Send Results')");
  let bulks = await since(before, (e) => e.path.endsWith("/send-bulk"));
  const g0 = bulks[0]?.body.guests ?? [];
  check("分两批（10 + 1），不含 T01 和第二个 T02", bulks.length === 2 && bulks[0].body.guests.length === 10 && bulks[1].body.guests.length === 1 && !bulks.flatMap((b) => b.body.guests).some((g) => g.chd_number === "T01") && bulks.flatMap((b) => b.body.guests).filter((g) => g.chd_number === "T02").length === 1, JSON.stringify(bulks.map((b) => b.body.guests.map((g) => g.chd_number))));
  check("每批都带 preview_at 和 send_anyway=[]", bulks.every((b) => b.body.preview_at === "2026-10-04T07:00:00.123456+00:00" && Array.isArray(b.body.send_anyway) && b.body.send_anyway.length === 0));
  const tb = (await since(before, (e) => e.path === "/api/tickets-reminder/batches"))[0]?.body;
  check("先建批次（同旧页面）：产品、日期、方式、文件行数、页面留下的两单；每批带 batch_id", tb && tb.tour_type === "upper_antelope_tsosie" && tb.service_date === DATE && tb.send_type === "combined" && tb.file_rows === 13 && tb.held.map((h) => h.chd_number + ":" + h.message).join("|") === "T01:Already sent for this date and tour|T02:Listed twice in this file" && bulks.every((b) => b.body.batch_id === 701), JSON.stringify(tb));
  check("CSV 送 Quantities 原文和 upload_row", g0[0]?.no_of_pax === "Adult: 2" && g0[0]?.upload_row?.["Order Number"] === g0[0]?.chd_number, JSON.stringify(g0[0]));
  check("结果：Sent 10、Failed 0、No address 0、Skipped 3、Total 13", await evaluate("const t = [...document.querySelectorAll('section .text-2xl')].map(e => e.textContent); return t.join('|') === '10|0|0|3|13';"), await evaluate("return [...document.querySelectorAll('section .text-2xl')].map(e => e.textContent).join('|');"));
  check("结果页 View this send → /send-log?batch=701（新标签页）", await evaluate("const a = [...document.querySelectorAll('a')].find(a => a.textContent.includes('View this send')); return !!a && a.getAttribute('href') === '/send-log?batch=701' && a.target === '_blank';"));
  check("跳过的单逐条写原因（服务端查重跳过的 T05 也在）", await evaluate(`return [...document.querySelectorAll('tr[data-skipped]')].map(tr => tr.textContent).join('|').includes('T05') && document.body.textContent.includes('Skipped: Already sent for this date and tour') && document.body.textContent.includes('Skipped: Listed twice in this file');`));

  // 勾 Send anyway
  await upload("normal", { serverSkip: [] });
  await evaluate(`${rowOf("T01")}.querySelector('input[type=checkbox]').click();`);
  await sleep(100);
  await sendAll();
  check("确认框说明 Send anyway 只再发一次", await evaluate(`return ${dialog}.textContent.includes('Send anyway: T01 will be sent once more');`));
  before = (await mockLog()).length;
  await evaluate(`$btn('Send to 12 guests', ${dialog}).click();`);
  await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === 'Send Results')");
  bulks = await since(before, (e) => e.path.endsWith("/send-bulk"));
  check("Send anyway：T01 在 guests 里、每批 send_anyway=['T01']", bulks.flatMap((b) => b.body.guests).some((g) => g.chd_number === "T01") && bulks.every((b) => JSON.stringify(b.body.send_anyway) === '["T01"]'));

  // 第二批断开（502）
  await upload("normal", { serverSkip: [], fail502At: 2 });
  await sendAll();
  await evaluate(`$btn('Send to 11 guests', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('may already have been sent')");
  check("断开：提示可能已发、先看 Send Log、不再给发送按钮", await evaluate("return !!document.querySelector('[role=alert] a[href^=\"/send-log?batch=\"]') && document.body.textContent.includes('Do not send again yet') && ![...document.querySelectorAll('button')].some(b => /^Send \\d+/.test(b.textContent.trim())) && !!$btn('↩ Send Another');"));
  check("断开：第二批列为状态不明", await evaluate("return document.body.textContent.includes('1 guest (T12) may or may not have been sent');"), await evaluate("return document.querySelector('[role=alert]').textContent;"));

  // 建批次失败：什么都不发，确认框写原因
  await upload("normal", { serverSkip: [], batchFail: true });
  await sendAll();
  before = (await mockLog()).length;
  await evaluate(`$btn('Send to 11 guests', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Nothing was sent')`);
  check("建批次失败：确认框写原因、没发", (await since(before, (e) => e.path.endsWith("/send-bulk"))).length === 0 && (await evaluate(`return ${dialog}.textContent.includes('Could not start the send: send_type must be combined, sms or email. Nothing was sent.');`)));
  await ctl({ batchFail: false });

  // 第一批 400（服务端整批拒，没发）
  await upload("normal", { serverSkip: [], reject400: "Order number, service date and tour type are required: ?" });
  await sendAll();
  await evaluate(`$btn('Send to 11 guests', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('Sending stopped')");
  check("400：写服务端原因，不说「可能已发」，后面的列为没发", await evaluate("return document.body.textContent.includes('Sending stopped: Order number, service date and tour type are required') && !document.body.textContent.includes('may already have been sent') && document.body.textContent.includes('11 guests were not sent');"));

  // 重新上传：比对 + Apply
  await upload("normal");
  check("第一次上传（系统里没有）：不显示比对框", !(await evaluate("return !!document.querySelector('section[aria-label=\"Changes since the last upload\"]');")));
  await upload("reupload", { applyFail: true });
  const panel = "document.querySelector('section[aria-label=\"Changes since the last upload\"]')";
  check("比对框：计数、Added / Removed / Changed 旧值 → 新值", await evaluate(`const t = ${panel}.textContent; return t.includes('1 added · 1 removed · 1 changed · 1 unchanged') && t.includes('Check-in Time 8:30 AM → 9:00 AM') && t.includes('Already sent') && t.includes('No message is sent to the guest') && t.includes('1 unchanged order is not listed here.');`), await evaluate(`return ${panel}.textContent;`));
  check("表格：每行标 Added / Changed / No change；Removed 的单划掉列在最后", await evaluate(`return ${rowOf("R01")}.textContent.includes('Added') && ${rowOf("R02")}.textContent.includes('Changed') && ${rowOf("R03")}.textContent.includes('No change') && !!document.querySelector('tr[data-removed]') && document.querySelector('tbody tr:last-child').textContent.includes('R09');`));
  before = (await mockLog()).length;
  await evaluate("$btn('Apply 2 changes').click();");
  await waitFor(`${panel}.querySelector('[role=alert]')`);
  check("Apply 失败：写原因、什么都没存、按钮可再点", (await evaluate(`return ${panel}.querySelector('[role=alert]').textContent;`)).includes("Nothing was saved.") && !(await evaluate("return $btn('Apply 2 changes').disabled;")));
  await ctl({ applyFail: false });
  before = (await mockLog()).length;
  await evaluate("$btn('Apply 2 changes').click();");
  await waitFor(`${panel}.textContent.includes('Saved: 1 updated, 1 added. Nothing was sent.')`);
  const ap = (await since(before, (e) => e.path === "/api/tickets-reminder/apply"))[0]?.body;
  check("Apply：只送 Added + Changed、带团期和产品，不发送", ap && ap.service_date === DATE && ap.tour_type === "upper_antelope_tsosie" && ap.guests.map((g) => g.chd_number).join(",") === "R01,R02" && (await since(before, (e) => e.path.endsWith("/send-bulk"))).length === 0, JSON.stringify(ap));
  check("Apply 后两行变 No change、比对框写已保存", await evaluate(`return ${rowOf("R01")}.textContent.includes('No change') && ${rowOf("R02")}.textContent.includes('No change') && !$btn('Apply 2 changes');`));
  await sendAll();
  before = (await mockLog()).length;
  await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.textContent.startsWith('Send to')).click();`);
  await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === 'Send Results')");
  const sentOrders = (await since(before, (e) => e.path.endsWith("/send-bulk"))).flatMap((b) => b.body.guests.map((g) => g.chd_number));
  check("Removed 的单不在发送名单里", !sentOrders.includes("R09") && sentOrders.includes("R01"), sentOrders.join(","));

  // ── 审查修正 ──
  // No address：只发短信、T03 没手机号 → 单独一格，不算 Failed；行里写 No address
  await upload("normal", { serverSkip: [], noPhone: ["T03"] });
  await evaluate("$btn('SMS Only').click();");
  await sleep(100);
  await sendAll();
  await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.textContent.startsWith('Send to')).click();`);
  await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === 'Send Results')");
  const statsNow = "return [...document.querySelectorAll('section .text-2xl')].map(e => e.textContent).join('|');";
  check("No address：Sent 10、Failed 0、No address 1（T03 没手机号）、Skipped 2、Total 13", (await evaluate(statsNow)) === "10|0|1|2|13", await evaluate(statsNow));
  check("No address：T03 那一行 SMS 写 No address", await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[0].textContent === 'T03'); return !!tr && tr.children[3].textContent === 'No address';"));

  // Apply 存的时候 Start Over 关着（晚到的 Apply 结果不会盖回别的批次）
  await upload("reupload", { applyDelay: 1500 });
  await evaluate("$btn('Apply 2 changes').click();");
  await sleep(200);
  check("Apply 存的时候 ↩ Start Over 关着", await evaluate("return $btn('↩ Start Over').disabled;"));
  await waitFor("document.body.textContent.includes('Saved: 1 updated, 1 added.')");
  check("Apply 存完 ↩ Start Over 恢复", await evaluate("return !$btn('↩ Start Over').disabled;"));

  // 网络断开：不说「Please try again」（同一个框里正叫人别重发）
  await upload("normal", { serverSkip: [] });
  await sendAll();
  await evaluate("window.__realFetch = window.fetch; let n = 0; window.fetch = (u, o) => (String(u).includes('/send-bulk') && ++n === 2 ? Promise.reject(new TypeError('Failed to fetch')) : window.__realFetch(u, o));");
  await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.textContent.startsWith('Send to')).click();`);
  await waitFor("document.body.textContent.includes('may already have been sent')");
  check("断网：原因写 Could not reach the server.，没有 Please try again", await evaluate("const t = document.querySelector('[role=alert]').textContent; return t.includes('(Could not reach the server.)') && !t.includes('Please try again');"), await evaluate("return document.querySelector('[role=alert]').textContent;"));

  // 预览拦截
  await upload("blocked");
  check("拦截：人数算不出 / 同单内容不同 / 缺订单号，三条都写", await evaluate("const a = document.querySelector('[role=alert]').textContent; return a.includes('Guest count not found in Quantities: B01') && a.includes('Listed twice in this file with different details: B02') && a.includes('No order number: No Order Guest');"));
  check("拦截：发送按钮禁用；行标红；Qty 显示 ?", await evaluate(`return [...document.querySelectorAll('button')].find(b => /^Send \\d+/.test(b.textContent.trim())).disabled && ${rowOf("B01")}.className.includes('fdecec') && ${rowOf("B01")}.children[5].textContent.startsWith('?') && ${rowOf("B02")}.textContent.includes('Listed twice, details differ');`));
  check("CSV 编码提示", await evaluate("return document.body.textContent.includes('This CSV is not saved as UTF-8.');"));
  check("Check-in Time 是算出来的：预览上方蓝条写按几分钟算", await evaluate("const p = [...document.querySelectorAll('[role=status]')].find(e => e.textContent.includes('Check-in Time was worked out')); return !!p && p.textContent.startsWith('ℹ️') && p.className.includes('eaf2fd');"));
  await upload("normal", { serverSkip: [] });
  check("文件自带 Check-in Time：没有蓝条", await evaluate("return !document.body.textContent.includes('Check-in Time was worked out');"));
  await goto(`${APP}/tickets-reminder/send`);
  await waitFor("document.body.textContent.includes('Upload & Preview')");
  check("上传框下的提示：照 Rezdy 原样上传，不再列必填列", await evaluate("const t = document.body.textContent; return t.includes('Upload the CSV exactly as you downloaded it from Rezdy.') && !t.includes('Required columns');"));
  check("How to use 有 Check-in Time 怎么算的一条", await evaluate("return document.body.textContent.includes('The Rezdy CSV has no Check-in Time column.');"));
}

main().catch((e) => { console.error(e); process.exit(2); });
