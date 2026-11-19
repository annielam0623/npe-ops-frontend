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



// ── Tour Confirmation 发送页 ──
const DIR = __dirname.replace(/\\/g, "/");
const DATE = "2026-10-10";
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }
async function waitReq(before, filter) { for (let i = 0; i < 40; i++) { const s = await since(before, filter); if (s.length) return s; await sleep(150); } return since(before, filter); }
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
const lane = (l) => `document.querySelector('[data-lane="${l}"]')`;
const rowOf = (order, nth = 0) => `[...document.querySelectorAll('tbody tr')].filter(tr => [...tr.children].slice(0, 2).some(td => td.textContent === '${order}'))[${nth}]`;
async function fill(l, type, date) {
  await evaluate(`
    const root = ${lane(l)};
    const sel = root.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '${type}');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const d = root.querySelector('input[type=date]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(d, '${date}');
    d.dispatchEvent(new Event('input', { bubbles: true }));
    d.dispatchEvent(new Event('change', { bubbles: true }));`);
}
async function open() {
  await goto(`${APP}/tour-confirmation/send`);
  await waitFor(`${lane("tour_confirmation")} && ${lane("tour_confirmation")}.querySelector('select').options.length > 1`);
  await helpers();
}
async function upload(scenario, extra = {}, l = "tour_confirmation", file = `west-${DATE}.csv`) {
  await ctl({ scenario, serverSkip: [], fail502At: 0, reject400: "", applyFail: false, batchFail: false, applyDelay: 0, batchHtml: false, bulkHtmlAt: 0, bulkDelay: 0, ...extra });
  await open();
  await fill(l, "grand_canyon_west", DATE);
  await setFile(`[data-lane="${l}"] input[type=file]`, file);
  await sleep(200);
  // 点 Upload & Preview 本身（表单里第一个键现在是手机版标题后的「i」）。
  await evaluate(`${lane(l)}.querySelector('form [type=submit]').click();`);
  await waitFor(`${lane(l)}.querySelector('tbody tr')`);
}
async function clickSend(l = "tour_confirmation") {
  await evaluate(`[...${lane(l)}.querySelectorAll('button')].find(b => /— \\d+ order/.test(b.textContent)).click();`);
  await waitFor(dialog);
}
const statsText = (l = "tour_confirmation") => `return [...${lane(l)}.querySelectorAll('section [data-stat]')].map(e => e.textContent).join('|');`;

let promptConfirm = true, dialogSeen = 0;
async function run() {
  const orig = ws.onmessage;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Page.javascriptDialogOpening") { dialogSeen++; void cdp("Page.handleJavaScriptDialog", { accept: promptConfirm }); return; }
    orig(ev);
  };
  for (const f of [`west-${DATE}.csv`, `wrongname.csv`]) require("fs").writeFileSync(`${DIR}/${f}`, "Order Number\nN01\n");

  // ── 表单 ──
  let before = (await mockLog()).length;
  await open();
  // 「改回」（Annie 2026-10-20，审计 #18）：How to use 一字不差照旧 send_tour.html。
  {
    const pre = `const d = [...document.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent.includes('How to use — Tour Confirmation')); const n = (e) => e.textContent.replace(/\\s+/g, ' ').trim(); const t = n(d); `;
    check("How to use（Tour）：共 17 步（G297 多一条酒店空着），最后一条是拖底部滚动条（Annie 2026-10-23 #19，原文）", await evaluate(pre + "const li = d.querySelectorAll('ol > li'); return li.length === 17 && li[16].textContent.replace(/\\s+/g, ' ').trim() === 'If the preview is wider than the window, a scrollbar shows along the bottom of the window. Drag it to see the columns on the right without scrolling down to the end of the list.';"), await evaluate(pre + "const li = d.querySelectorAll('ol > li'); return li.length + ' | ' + li[li.length - 1].textContent.replace(/\\s+/g, ' ').trim();"));
    check("How to use（Tour）第 8 步：flagged as Already Sent. Skip or override as needed.", await evaluate(pre + "return t.includes('Any orders already sent will be flagged as Already Sent . Skip or override as needed.') || t.includes('Any orders already sent will be flagged as Already Sent. Skip or override as needed.');"));
    check("How to use（Tour）发送条目：click Send to All. The button shows how many have been sent so far.", await evaluate(pre + "return t.includes('then click Send to All. The button shows how many have been sent so far. Keep the page open until Send Results appears.');"));
    check("How to use（Tour）Error Handling 照旧：do not click Send again / Start Over；页脚 no reminders will be sent", await evaluate(pre + "return t.includes('The page says it lost contact with the server: stop and do not click Send again. Click View this send to see which messages went out. If something really went wrong, wait a few minutes, then click Start Over and upload the file again: orders already sent are skipped and never sent twice.') && t.includes('This will break the upload and no reminders will be sent.');"));
    check("G297 How to use（Tour）：多一句酒店空着（后端工作区 send_tour.html 原文）", await evaluate(pre + "return t.includes('If a row has no Pickup Location, it turns red. That order is not sent; the others are sent as usual. Staff on shift get a Notice for it. Open the Notice, add the pickup location to the order in Rezdy, click Refresh from Rezdy, then click Send tour confirmation.');"));
    check("G297 How to use（Last Minute）：同一句", await evaluate(pre.replace('Tour Confirmation', 'Last Minute Order') + "return t.includes('If a row has no Pickup Location, it turns red. That order is not sent; the others are sent as usual. Staff on shift get a Notice for it. Open the Notice, add the pickup location to the order in Rezdy, click Refresh from Rezdy, then click Send tour confirmation.');"));
    check("How to use（Last Minute）：Click Send Last Minute and keep the page open…；Error Handling 用 click Cancel", await evaluate(pre.replace('Tour Confirmation', 'Last Minute Order') + "return t.includes('Click Send Last Minute and keep the page open until the results appear. Click View this send to open this send in the Send Log.') && t.includes('then click Cancel and upload the file again: orders already sent are skipped and never sent twice.') && t.includes('do not click Send again');"));
  }
  check("团型下拉来自接口（按顺序、下拉文字）", await evaluate(`return [...${lane("tour_confirmation")}.querySelector('select').options].map(o => o.value + ':' + o.text).join('|') === ':— Select tour type —|upper_antelope:Upper Antelope Canyon Bus Tour|grand_canyon_west:Grand Canyon West Rim Bus Tour|hoover_dam:Hoover Dam Tour';`));
  check("两块：General Order Confirmation、⚡ Last Minute Order（红字说明）、各自 How to use、文件框收 .csv / .xlsx", await evaluate(`return ${lane("tour_confirmation")}.textContent.includes('General Order Confirmation') && ${lane("last_minute")}.textContent.includes('⚡ Last Minute Order') && ${lane("last_minute")}.textContent.includes('skip reconfirmation') && document.body.textContent.includes('How to use — Tour Confirmation') && document.body.textContent.includes('How to use — Last Minute Order') && document.querySelector('[data-lane=tour_confirmation] input[type=file]').accept === '.csv,.xlsx';`));
  // dashboard 改版：侧栏默认收起，先展开。
  await evaluate("document.querySelector('nav[aria-label=Main] button[aria-label=\"Open menu\"]')?.click();");
  await waitFor("document.querySelector('nav[aria-label=Main]').dataset.state === 'open'");
  check("侧栏 Tour Confirmation（已切换）：链到 ops 新页面、当前页高亮", await evaluate("const a = [...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent.startsWith('Tour Confirmation')); return !!a && a.getAttribute('href') === '/tour-confirmation/send' && a.getAttribute('aria-current') === 'page';"));
  // 看完收起，后面的检查照原来的版面跑。
  await evaluate("document.querySelector('nav[aria-label=Main] button[aria-label=\"Close menu\"]')?.click();");
  await waitFor("document.querySelector('nav[aria-label=Main]').dataset.state === 'closed'");
  check("View Tracking（已切换）→ ops 新 tracking 页", await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent === 'View Tracking').getAttribute('href') === '/tour-confirmation/tracking';"));
  await evaluate(`$btn('📂 Upload & Preview').click();`);
  await sleep(200);
  check("没选文件：提示，不发请求", await evaluate(`return ${lane("tour_confirmation")}.textContent.includes('Please select a CSV or Excel file.');`) && (await since(before, (e) => e.path.endsWith("/preview"))).length === 0);
  await fill("tour_confirmation", "grand_canyon_west", DATE);
  await waitFor("document.body.textContent.includes('SMS for grand_canyon_west 2026-10-10')");
  check("选好团和日期：消息预览自动出来", await evaluate("return document.body.textContent.includes('SMS for grand_canyon_west 2026-10-10');"));

  // 文件名不符
  await setFile('[data-lane="tour_confirmation"] input[type=file]', "wrongname.csv");
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate(`$btn('📂 Upload & Preview').click();`);
  await waitFor(dialog);
  check("文件名不含团名片段和日期：先确认（写团、片段 west、日期、文件名），不发请求", await evaluate(`const t = ${dialog}.textContent; return t.includes('Grand Canyon West Rim Bus Tour') && t.includes('west') && t.includes('Date selected: 2026-10-10') && t.includes('wrongname.csv');`) && (await since(before, (e) => e.path.endsWith("/preview"))).length === 0);
  await ctl({ scenario: "parseError" });
  await evaluate(`$btn('Proceed anyway', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('Missing required columns')");
  check("解析失败（400）：写原因", await evaluate(`return ${lane("tour_confirmation")}.querySelector('[role=alert]').textContent.includes('Missing required columns: Pick-up Location');`));

  // ── 预览 ──
  before = (await mockLog()).length;
  await upload("normal");
  const pv = (await since(before, (e) => e.path.endsWith("/preview")))[0];
  check("预览请求：团型、日期、文件；Regular 不带 lane", pv?.form.tour_type === "grand_canyon_west" && pv?.form.tour_date === DATE && pv?.form.lane === null && pv?.form.file === `west-${DATE}.csv`, JSON.stringify(pv?.form));
  check("预览头：13 bookings · 26 guests · 团名 · 日期", await evaluate(`return ${lane("tour_confirmation")}.querySelector('h2').textContent.includes('13 bookings · 26 guests · Grand Canyon West Rim Bus Tour · 2026-10-10');`), await evaluate(`return ${lane("tour_confirmation")}.querySelector('h2').textContent;`));
  check("已发过：写谁什么时候发的 + Send anyway；第二次出现的：Listed twice、没有 Send anyway", await evaluate(`return ${rowOf("N01")}.textContent.includes('Sent by annie on 10/4 2:13 PM') && !!${rowOf("N01")}.querySelector('label input[type=checkbox]') && ${rowOf("N02", 1)}.textContent.includes('Listed twice in this file') && !${rowOf("N02", 1)}.querySelector('label input[type=checkbox]');`));
  check("CSV：Qty 是人数、Quantities 列；MTLV：Eligible / 🎫 2 / —", await evaluate(`return ${rowOf("N03")}.children[5].textContent === '2' && ${rowOf("N03")}.children[6].textContent === 'Adult: 2' && ${rowOf("N03")}.children[7].textContent === 'Eligible' && ${rowOf("N04")}.children[7].textContent === '🎫 2' && ${rowOf("N05")}.children[7].textContent === '—';`));
  check("缺邮箱 / 缺电话的黄框", await evaluate("const t = document.querySelector('[data-testid=missing-info]').textContent; return t.includes('No email (email will be skipped): N03') && t.includes('No phone (SMS will be skipped): N04');"));
  check("说明：1 个已发过会跳过；按钮 Send to All — 11 orders (SMS + Email)", await evaluate(`return ${lane("tour_confirmation")}.textContent.includes('1 previously sent order will be skipped') && [...${lane("tour_confirmation")}.querySelectorAll('button')].some(b => b.textContent === '✉️ Send to All — 11 orders (SMS + Email)');`), await evaluate(`return [...${lane("tour_confirmation")}.querySelectorAll('button')].map(b => b.textContent).join('|');`));
  check("Last Minute 那一块在 Regular 预览时还在（各自独立）", await evaluate(`return !!${lane("last_minute")}.querySelector('form');`));

  // 单选 / 全选（Annie 2026-10-13）：取消勾 N03 ⇒ 少一单；表头 Select all 勾回、碰不到已发过的 N01
  await evaluate(`${rowOf("N03")}.querySelector('[data-pick]').click();`);
  await sleep(100);
  check("单选：取消勾 N03，按钮变 10 单；已发过的 N01 勾选框灰着", await evaluate(`return [...${lane("tour_confirmation")}.querySelectorAll('button')].some(b => b.textContent.includes('10 orders')) && ${rowOf("N01")}.querySelector('[data-pick]').disabled && !${rowOf("N01")}.querySelector('[data-pick]').checked;`));
  await evaluate(`${lane("tour_confirmation")}.querySelector('thead input[aria-label="Select all"]').click();`);
  await sleep(100);
  check("表头 Select all：勾回 N03、回到 11 单，N01 还是不勾", await evaluate(`return ${rowOf("N03")}.querySelector('[data-pick]').checked && [...${lane("tour_confirmation")}.querySelectorAll('button')].some(b => b.textContent.includes('11 orders')) && !${rowOf("N01")}.querySelector('[data-pick]').checked;`));

  // 发送：不勾 Send anyway
  await clickSend();
  check("确认框：11 单、1 跳过、团、日期、方式", await evaluate(`const t = ${dialog}.textContent; return t.includes('11 orders will get the Grand Canyon West Rim Bus Tour message for 2026-10-10 by SMS + Email') && t.includes('2 will be skipped');`), await evaluate(`return ${dialog}.textContent;`));
  before = (await mockLog()).length;
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor(`${lane("tour_confirmation")}.textContent.includes('📬 Send Results')`);
  const batch = (await since(before, (e) => e.path === "/send/tour-batches"))[0]?.body;
  check("先建批次：lane、团、日期、方式、文件行数、页面留下的两单和原因", batch && batch.lane === "tour_confirmation" && batch.tour_type === "grand_canyon_west" && batch.tour_date === DATE && batch.send_type === "combined" && batch.file_rows === 13 && batch.held.map((h) => `${h.order}:${h.message}`).join("|") === "N01:Already sent for this date and tour|N02:Listed twice in this file", JSON.stringify(batch));
  let bulks = await since(before, (e) => e.path === "/send/tour-confirmation-bulk");
  check("分两组（10 + 1），每组带 batch_id、preview_at、send_anyway=[]", bulks.length === 2 && bulks[0].body.guests.length === 10 && bulks[1].body.guests.length === 1 && bulks.every((b) => b.body.batch_id === 501 && b.body.preview_at === "2026-10-04T14:00:00.123456-07:00" && JSON.stringify(b.body.send_anyway) === "[]" && b.body.tour_type === "grand_canyon_west" && b.body.tour_date === DATE), JSON.stringify(bulks.map((b) => [b.body.batch_id, b.body.guests.length])));
  const g = bulks[0]?.body.guests.find((x) => x.order_number === "N04");
  check("客人字段：CSV 送 Quantities 原文、MTLV 张数、upload_row", g && g.quantities === "Adult: 2" && g.mtlv_promo === "2" && g.mtlv_qty === 2 && g.upload_row?.["Order Number"] === "N04" && g.first_name === "ZZ4" && g.customer_email === "zz@example.test" && g.pickup_location === "MGM", JSON.stringify(g));
  check("结果（置顶 109）：Sent 11、Failed 0、No contact 0、Skipped 2、Total 13", (await evaluate(statsText())) === "11|0|0|2|13", await evaluate(statsText()));
  check("结果表：Sent / Failed: 原因 / No email / No number；跳过的写原因", await evaluate(`const t = ${lane("tour_confirmation")}.textContent; return t.includes('Failed: Twilio 21211 invalid number') && t.includes('No email') && t.includes('No number') && t.includes('Skipped: Already sent for this date and tour') && t.includes('Skipped: Listed twice in this file');`));
  check("Send Report 列出没邮箱 / 没电话的单", await evaluate(`const t = ${lane("tour_confirmation")}.textContent; return t.includes('Email skipped (no email): N03') && t.includes('SMS skipped (no number): N04');`));
  check("View this send → /send-log?batch=501（新标签页）", await evaluate(`const a = [...${lane("tour_confirmation")}.querySelectorAll('a')].find(a => a.textContent.includes('View this send')); return !!a && a.getAttribute('href') === '/send-log?batch=501' && a.target === '_blank';`));

  // Send anyway + 服务端跳过 + 只发短信
  await upload("normal", { serverSkip: ["N06"] });
  await evaluate(`${rowOf("N01")}.querySelector('label input[type=checkbox]').click();`);
  await evaluate(`$btn('📱 SMS Only', ${lane("tour_confirmation")}).click();`);
  await sleep(100);
  await clickSend();
  check("确认框：Send anyway 只再发一次", await evaluate(`return ${dialog}.textContent.includes('Send anyway: N01 will be sent once more') && ${dialog}.textContent.includes('by SMS Only');`));
  before = (await mockLog()).length;
  await evaluate(`$btn('Send to 12 orders', ${dialog}).click();`);
  await waitFor(`${lane("tour_confirmation")}.textContent.includes('📬 Send Results')`);
  bulks = await since(before, (e) => e.path === "/send/tour-confirmation-bulk");
  check("Send anyway：N01 在名单里、每组 send_anyway=['N01']、send_type=sms", bulks.flatMap((b) => b.body.guests).some((x) => x.order_number === "N01") && bulks.every((b) => JSON.stringify(b.body.send_anyway) === '["N01"]' && b.body.send_type === "sms"));
  check("服务端发前查重跳过的 N06 算进 Skipped；只发短信时短信失败的 N05 算 Failed、没电话的 N04 算 No contact（置顶 109）；邮件列是 —", (await evaluate(statsText())) === "9|1|1|2|13" && (await evaluate(`return [...document.querySelectorAll('tr[data-skipped]')].some(tr => tr.textContent.includes('N06'));`)) && (await evaluate(`return ${rowOf("N03")}.children[2].textContent === '—';`)), await evaluate(statsText()));
  check("置顶 109 Q1：没电话的 N04 短信格是灰字 No number（#6B6B6B），不是琥珀", await evaluate(`const td = ${rowOf("N04")}.children[3]; return td.textContent === 'No number' && getComputedStyle(td).color === 'rgb(107, 107, 107)';`), await evaluate(`const td = ${rowOf("N04")}.children[3]; return td.textContent + ' ' + getComputedStyle(td).color;`));

  // 置顶 109：新后端（每行带 outcome / *_outcome、顶层四计数）——页面照后端的结论，不自己猜。
  // N07 后端说两个渠道都没地址（no_contact），虽然旧原文看起来是发出去了。
  await upload("normal", { newOutcome: true, outcomeOverride: { N07: { outcome: "no_contact", sms_outcome: "no_address", email_outcome: "no_address" } } });
  await clickSend();
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor(`${lane("tour_confirmation")}.textContent.includes('📬 Send Results')`);
  check("新后端：照每行 outcome 数——N07 No contact ⇒ Sent 10 / Failed 0 / No contact 1 / Skipped 2 / Total 13", (await evaluate(statsText())) === "10|0|1|2|13", await evaluate(statsText()));
  check("新后端：N07 两格灰字 No email / No number；No contact 那一格灰字", await evaluate(`const tr = ${rowOf("N07")}; const grey = (e) => getComputedStyle(e).color === 'rgb(107, 107, 107)'; const st = [...${lane("tour_confirmation")}.querySelectorAll('section [data-stat]')][2]; return tr.dataset.outcome === 'no_contact' && tr.children[2].textContent === 'No email' && tr.children[3].textContent === 'No number' && grey(tr.children[2]) && grey(tr.children[3]) && grey(st);`), await evaluate(`return ${rowOf("N07")}.outerHTML;`));
  check("新后端：N05 短信失败、邮件发出 ⇒ Sent（任一渠道发出就算），SMS 格红字 Failed: 原因", await evaluate(`const tr = ${rowOf("N05")}; return tr.dataset.outcome === 'sent' && tr.children[3].textContent.startsWith('Failed: Twilio 21211') && getComputedStyle(tr.children[3]).color === 'rgb(163, 45, 45)';`));
  await ctl({ newOutcome: false, outcomeOverride: {} });

  // 建批次失败：什么都不发、确认框里写原因
  await upload("normal", { batchFail: true });
  await clickSend();
  before = (await mockLog()).length;
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Nothing was sent')`);
  check("建批次失败：确认框写原因、没发任何一组", (await since(before, (e) => e.path.endsWith("-bulk"))).length === 0 && (await evaluate(`return ${dialog}.textContent.includes('Could not start the send: send_type must be combined, sms or email. Nothing was sent.');`)));
  await evaluate(`$btn('Cancel', ${dialog}).click();`);

  // 第二组断开
  await upload("normal", { fail502At: 2 });
  await clickSend();
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor("!!document.querySelector('[data-maybe-sent]')");
  check("断开（改回旧页面 #2）：回到预览页，红框 ⛔ Stop. Do not click Send again. + 已确认发出几位 + View this send；发送键禁用，Start Over 还能点；没有结果页", await evaluate(`const box = ${lane("tour_confirmation")}.querySelector('[data-maybe-sent]'); const t = box ? box.textContent.replace(/\\s+/g, ' ') : ''; const send = [...${lane("tour_confirmation")}.querySelectorAll('button')].find(b => /Send to All/.test(b.textContent)); return !!box && t.includes('⛔ Stop. Do not click Send again. The page lost contact with the server, and some or all messages may already have been sent.') && t.includes('10 messages were confirmed sent before the connection was lost.') && t.includes('Click View this send to see which messages went out. If something really went wrong, wait a few minutes, then click Start Over and upload the file again: orders already sent are skipped and never sent twice.') && !!box.querySelector('a[href^="/send-log?batch="]') && !!send && send.disabled && !!$btn('↩ Start Over', ${lane("tour_confirmation")}) && !${lane("tour_confirmation")}.textContent.includes('Send Results') && !t.includes('may or may not have been sent');`), await evaluate(`return ${lane("tour_confirmation")}.textContent.slice(0, 500);`));

  // 第一组 400
  await upload("normal", { reject400: "Order number is required: ZZ. Nothing was sent." });
  await clickSend();
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('Order number is required: ZZ. Nothing was sent.')");
  check("第 1 组 400（改回旧页面 #2）：留在预览页，原因写在发送键旁，发送键可再点，没有「可能已发」红框", await evaluate(`const t = ${lane("tour_confirmation")}.textContent; const send = [...${lane("tour_confirmation")}.querySelectorAll('button')].find(b => /Send to All/.test(b.textContent)); return t.includes('Order number is required: ZZ. Nothing was sent.') && !!send && !send.disabled && !${lane("tour_confirmation")}.querySelector('[data-maybe-sent]') && !t.includes('Sending stopped') && !t.includes('Send Results');`));

  // ── 重新上传：比对 + Apply ──
  await upload("reupload", { applyFail: true });
  const panel = `${lane("tour_confirmation")}.querySelector('section[aria-label="Changes since the last upload"]')`;
  check("比对框：计数、Added 写人数地点时间、Changed 旧 → 新、Removed", await evaluate(`const t = ${panel}.textContent; return t.includes('1 added · 1 removed · 1 changed · 1 unchanged') && t.includes('R01 ZZ Added · 2 pax · MGM 6:30 AM') && t.includes('Pick-up Time 6:30 AM → 7:00 AM') && t.includes('R09 ZZ Gone · 2 pax · Excalibur 6:30 AM');`), await evaluate(`return ${panel}.textContent;`));
  check("表格：Added / Changed / No change；Removed 划掉在最后", await evaluate(`return ${rowOf("R01")}.textContent.includes('Added') && ${rowOf("R02")}.textContent.includes('Changed') && ${rowOf("R03")}.textContent.includes('No change') && document.querySelector('tbody tr:last-child').textContent.includes('R09') && !!document.querySelector('tr[data-removed]');`));
  await evaluate(`${rowOf("R02")}.querySelector('label input[type=checkbox]').click();`);
  await evaluate("$btn('Apply 2 changes').click();");
  await waitFor(`${panel}.querySelector('[role=alert]')`);
  check("Apply 失败：直接显示后端原话（同旧页面）、可再点", (await evaluate(`return ${panel}.querySelector('[role=alert]').textContent;`)) === "Guest count not found in Quantities: R01" && !(await evaluate("return $btn('Apply 2 changes').disabled;")));
  await ctl({ applyFail: false });
  before = (await mockLog()).length;
  await evaluate("$btn('Apply 2 changes').click();");
  await waitFor(`${panel}.textContent.includes('Saved: 1 updated, 1 added. Nothing was sent.')`);
  const ap = (await since(before, (e) => e.path === "/send/tour-confirmation-apply"))[0]?.body;
  check("Apply：只送 Added + Changed、lane regular、不发送", ap && ap.lane === "regular" && ap.tour_type === "grand_canyon_west" && ap.tour_date === DATE && ap.guests.map((x) => x.order_number).join(",") === "R01,R02" && (await since(before, (e) => e.path.endsWith("-bulk"))).length === 0, JSON.stringify(ap));
  check("Apply 后：两行 No change、已勾的 Send anyway 还勾着", await evaluate(`return ${rowOf("R01")}.textContent.includes('No change') && ${rowOf("R02")}.textContent.includes('No change') && ${rowOf("R02")}.querySelector('label input[type=checkbox]').checked;`));
  await clickSend();
  before = (await mockLog()).length;
  await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.textContent.startsWith('Send to')).click();`);
  await waitFor(`${lane("tour_confirmation")}.textContent.includes('📬 Send Results')`);
  const sentOrders = (await since(before, (e) => e.path.endsWith("-bulk"))).flatMap((b) => b.body.guests.map((x) => x.order_number));
  check("Removed 的单不发", !sentOrders.includes("R09") && sentOrders.join(",") === "R01,R02,R03", sentOrders.join(","));

  // ── 拦截 ──
  await upload("blocked");
  check("拦截：人数算不出 / 同单内容不同 / 缺订单号；发送按钮禁用；CSV 编码提示", await evaluate(`const a = ${lane("tour_confirmation")}.querySelector('[role=alert]').textContent; return a.includes('Guest count not found in Quantities: B01') && a.includes('Listed twice in this file with different details: B02') && a.includes('No order number: No Order Guest') && [...${lane("tour_confirmation")}.querySelectorAll('button')].find(b => /— \\d+ order/.test(b.textContent)).disabled && ${lane("tour_confirmation")}.textContent.includes('This CSV is not saved as UTF-8.') && ${lane("tour_confirmation")}.textContent.includes('⛔ Fix the problems in the red box before sending');`));

  // ── G297：酒店空着（新规则：标红留下、其余照发，Send 不禁用）──
  const sendBtnOf = (l) => `[...${lane(l)}.querySelectorAll("button")].find(b => /— \\d+ order/.test(b.textContent))`;
  const RED_BG = "rgb(253, 236, 236)";
  for (const l of ["tour_confirmation", "last_minute"]) {
    await upload("nohotel", {}, l);
    const nh = await evaluate(`const L = ${lane(l)}; const bg = (o) => getComputedStyle(L.querySelector('tr[data-order="' + o + '"]')).backgroundColor;
      const y = L.querySelector("[data-no-hotel-line]");
      return { red: ["H01","H02","H03","H04"].map(o => bg(o) === "${RED_BG}").join(","), yellow: y ? y.textContent.replace(/\\s+/g, " ").trim() : "", alert: !!L.querySelector("[role=alert]"), disabled: ${sendBtnOf(l)}.disabled, btn: ${sendBtnOf(l)}.textContent };`);
    check(`G297 ${l}：H01（空）、H02（只有空格）标红；已发过的 H04、正常的 H03 不红；黄框列 H01, H02；没有红框、Send 能按`, nh.red === "true,true,false,false" && nh.yellow === "⚠️ Pickup location is empty in Rezdy (not sent, shown in red; staff on shift get a Notice): H01, H02" && !nh.alert && !nh.disabled, JSON.stringify(nh));
    const g297shot = async (name, sel) => { if (!process.env.SHOT_DIR || l !== "tour_confirmation") return; await evaluate(`${sel}.scrollIntoView({ block: "start" }); window.scrollBy(0, -140);`); await sleep(250); const r = await cdp("Page.captureScreenshot", { format: "png" }); require("fs").mkdirSync(process.env.SHOT_DIR, { recursive: true }); require("fs").writeFileSync(require("path").join(process.env.SHOT_DIR, name + ".png"), Buffer.from(r.data, "base64")); };
    await g297shot("tour-preview", `${lane(l)}.querySelector("table")`);
    await clickSend(l);
    before = (await mockLog()).length;
    await evaluate(`[...${dialog}.querySelectorAll("button")].find(b => b.textContent.startsWith("Send")  && b.textContent.includes("order")).click();`);
    await waitFor(`${lane(l)}.textContent.includes("📬 Send Results")`);
    const sent = (await since(before, (e) => e.path.endsWith("-bulk"))).flatMap((b) => b.body.guests.map((x) => x.order_number));
    check(`G297 ${l}：H01、H02、H03 照样送给后端（后端留下没酒店的）；H04 没勾 Send anyway 不送`, sent.join(",") === "H01,H02,H03", sent.join(","));
    const res = await evaluate(`const L = ${lane(l)}; return [...L.querySelectorAll("tr[data-skipped]")].map(tr => tr.textContent.replace(/\\s+/g, " ").trim() + "|" + (tr.dataset.noHotel ? "red:" + (getComputedStyle(tr).backgroundColor === "${RED_BG}") : "plain")).join(" / ");`);
    await g297shot("tour-results", `[...${lane(l)}.querySelectorAll("h2, h3, p, div")].find(e => e.textContent.trim().startsWith("📬 Send Results"))`);
    check(`G297 ${l}：结果表 H01、H02 标红写「Skipped: Pickup location is empty in Rezdy」，H03 照常 Sent`, res.includes("H01ZZ1 TestSkipped: Pickup location is empty in Rezdy|red:true") && res.includes("H02ZZ2 TestSkipped: Pickup location is empty in Rezdy|red:true") && (await evaluate(`return [...${lane(l)}.querySelectorAll("tr[data-outcome]")].map(tr => tr.firstElementChild.textContent + ":" + tr.dataset.outcome).join(",") === "H03:sent";`)), res);
  }

  // .xlsx：没有 Quantities 列，Qty 原值，送数字
  await upload("xlsx");
  check(".xlsx：没有 Quantities 列、Qty 原值、预览头不写 guests", await evaluate(`return ![...${lane("tour_confirmation")}.querySelectorAll('th')].some(th => th.textContent === 'Quantities') && ${rowOf("X01")}.children[5].textContent === '3' && !${lane("tour_confirmation")}.querySelector('h2').textContent.includes('guests');`));

  // ── Last Minute ──
  before = (await mockLog()).length;
  await upload("normal", {}, "last_minute");
  const lpv = (await since(before, (e) => e.path.endsWith("/preview")))[0];
  check("Last Minute 预览：带 lane=last_minute；头写 ⚡ Last Minute Preview；Regular 表单还在", lpv?.form.lane === "last_minute" && (await evaluate(`return ${lane("last_minute")}.querySelector('h2').textContent.startsWith('⚡ Last Minute Preview') && !!${lane("tour_confirmation")}.querySelector('form');`)));
  check("Last Minute 按钮：Send Last Minute — 11 orders、✕ Cancel", await evaluate(`return [...${lane("last_minute")}.querySelectorAll('button')].some(b => b.textContent === '⚡ Send Last Minute — 11 orders (SMS + Email)') && !!$btn('✕ Cancel', ${lane("last_minute")});`));
  await clickSend("last_minute");
  check("Last Minute 确认框", await evaluate(`return ${dialog}.textContent.includes('Send Last Minute?') && ${dialog}.textContent.includes('Last Minute Grand Canyon West Rim Bus Tour message');`));
  before = (await mockLog()).length;
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor(`${lane("last_minute")}.textContent.includes('⚡ Last Minute Send Complete')`);
  const lb = (await since(before, (e) => e.path === "/send/tour-batches"))[0]?.body;
  const lbulk = await since(before, (e) => e.path === "/send/last-minute-confirmation-bulk");
  check("Last Minute：批次 lane=last_minute、发到 last-minute 接口、不碰团确认接口", lb?.lane === "last_minute" && lbulk.length === 2 && (await since(before, (e) => e.path === "/send/tour-confirmation-bulk")).length === 0);
  await upload("reupload", {}, "last_minute");
  before = (await mockLog()).length;
  await evaluate(`$btn('Apply 2 changes', ${lane("last_minute")}).click();`);
  const lap = (await waitReq(before, (e) => e.path === "/send/tour-confirmation-apply"))[0]?.body;
  check("Last Minute Apply：lane last_minute", lap?.lane === "last_minute");
  // Apply 存的时候 Cancel 是灰的：等存完、能点了再点（不然点空，偶发失败）。
  await waitFor(`!!$btn('✕ Cancel', ${lane("last_minute")}) && !$btn('✕ Cancel', ${lane("last_minute")}).disabled`, 5000);
  await evaluate(`$btn('✕ Cancel', ${lane("last_minute")}).click();`);
  // 等表单出来再查（原来固定等 150ms，页面重渲染慢一点就偶发失败）。
  await waitFor(`!!${lane("last_minute")}.querySelector('form')`, 5000).catch(() => {});
  check("✕ Cancel 回到表单", await evaluate(`return !!${lane("last_minute")}.querySelector('form');`));


  // ── 审查修正 ──
  await upload("reupload", { applyDelay: 1500 });
  await evaluate("$btn('Apply 2 changes').click();");
  await sleep(200);
  check("Apply 存的时候发送按钮灰掉", await evaluate(`return [...${lane("tour_confirmation")}.querySelectorAll('button')].find(b => /— \\d+ order/.test(b.textContent)).disabled;`));
  check("Apply 存的时候 ↩ Start Over 也关着（晚到的结果不会盖回别的批次）", await evaluate(`return $btn('↩ Start Over', ${lane("tour_confirmation")}).disabled;`));
  await sleep(1600);
  check("Apply 存完 ↩ Start Over 恢复", await evaluate(`return !$btn('↩ Start Over', ${lane("tour_confirmation")}).disabled;`));
  check("Apply 存完发送按钮恢复", await evaluate(`return ![...${lane("tour_confirmation")}.querySelectorAll('button')].find(b => /— \\d+ order/.test(b.textContent)).disabled;`));
  await upload("normal", { batchHtml: true });
  await clickSend();
  before = (await mockLog()).length;
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('not understood')`);
  check("建批次回的不是批次号：不发、确认框写原因", (await since(before, (e) => e.path.endsWith("-bulk"))).length === 0);
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await upload("normal", { bulkHtmlAt: 1 });
  await clickSend();
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor("!!document.querySelector('[data-maybe-sent]')");
  check("发送回 200 但不是结果：按可能已发停下（红框，回预览页），发送键禁用", await evaluate(`const send = [...${lane("tour_confirmation")}.querySelectorAll('button')].find(b => /Send to All/.test(b.textContent)); return !!${lane("tour_confirmation")}.querySelector('[data-maybe-sent]') && !!send && send.disabled;`));
  await upload("normal", { bulkDelay: 2500 });
  await clickSend();
  await evaluate(`$btn('Send to 11 orders', ${dialog}).click();`);
  await waitFor(`${lane("tour_confirmation")}.textContent.includes('Sending…')`);
  promptConfirm = false;
  await evaluate("document.querySelector('nav[aria-label=Main] button[aria-label=\"Open menu\"]')?.click();");
  await waitFor("document.querySelector('nav[aria-label=Main]').dataset.state === 'open'");
  await evaluate("[...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent.trim().endsWith('Dashboard')).click();");
  await sleep(400);
  check("发送中点侧栏：先问，取消就留在这页", (await evaluate("return location.pathname;")) === "/tour-confirmation/send" && dialogSeen > 0);
  await waitFor(`${lane("tour_confirmation")}.textContent.includes('📬 Send Results')`, 20000);

  // 团型拉不到
  await ctl({ typesFail: true });
  await goto(`${APP}/tour-confirmation/send`);
  await waitFor("document.body.textContent.includes('Could not load the tour types')");
  check("团型拉不到：写原因、上传按钮禁用", await evaluate(`return ${lane("tour_confirmation")}.querySelector('[type=submit]').disabled;`));
  await ctl({ typesFail: false });

  // 401
  // ── 员工也按勾（Annie 2026-10-30 置顶 10c）：没勾 tour.send 预览照出、没有 Send to All；Super Admin 一项没勾也有 ──
  for (const [label, opts, canSend] of [
    ["员工只勾 tour.view", { staffPerms: ["tour.view"] }, false],
    ["员工勾 tour.send", { staffPerms: ["tour.view", "tour.send"] }, true],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
  ]) {
    await upload("normal", { staffPerms: null, superAdmin: false, ...opts });
    const has = await evaluate(`return [...${lane("tour_confirmation")}.querySelectorAll('button')].some(b => /— \\d+ order/.test(b.textContent));`);
    const rows = await evaluate(`return !!${lane("tour_confirmation")}.querySelector('tbody tr');`);
    check(`${label}：Tour 发送预览照出、${canSend ? "有" : "没有"} Send to All`, rows && has === canSend, String(has));
  }
  await ctl({ staffPerms: null, superAdmin: false });
  // ── 手机版第 ③ 批（Annie 2026-11-01 手机版规则）：两段 How to use 都在页面最底；上传说明和 Last Minute 红字进 i ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(`${APP}/tour-confirmation/send`);
  await waitFor("document.querySelectorAll('[data-lane]').length === 2", 30000);
  await sleep(600);
  check("手机：不左右晃；两段 How to use 都在 Last Minute 那块下面", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); const lm = document.querySelector('[data-lane=last_minute]').getBoundingClientRect().bottom; const hs = [...document.querySelectorAll('details')].filter((d) => d.textContent.includes('How to use')); return noSway && hs.length === 2 && hs.every((d) => d.getBoundingClientRect().top >= lm);`));
  check("手机：Last Minute 红字和 Required columns 默认收着，点 i 才出", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); const lane = document.querySelector('[data-lane=last_minute]'); const red = [...lane.querySelectorAll('p')].find((p) => p.textContent.includes('cancellation window')); const before = vis(red); lane.querySelector('[data-phone-info]').click(); await new Promise((r) => setTimeout(r, 200)); return !before && vis(red);`));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await goto(`${APP}/tour-confirmation/send`);
  await waitFor("document.querySelectorAll('[data-lane]').length === 2", 30000);
  await sleep(400);
  check("电脑：How to use — Tour Confirmation 照旧在第一块里、Last Minute 红字直接显示", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); const h = [...document.querySelectorAll('details')].find((d) => d.textContent.includes('How to use — Tour Confirmation')); const red = [...document.querySelectorAll('p')].find((p) => p.textContent.includes('cancellation window')); return !!h && !!h.closest('[data-lane=tour_confirmation]') && vis(red);`));

  await ctl({ fail401: true });
  await goto(`${APP}/tour-confirmation/send`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
