// dns 套：G361 No show（DOR 第四类）——Log 弹窗带出、Earlier records、联系记录、Guest decision、Evidence、How to use。mock 用 dor-mock（dns-mock.js）。
// 下面 helper 照抄 dor-test.js。
// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Daily Operation Report（Dashboard 块、弹窗、/daily-report 页）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");

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
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: SELECT_HELPERS });
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

// ── G361 No show（Annie 2026-11-27「T1 A，T2 A，T3 A」「动手」；preview UAhRhQfyGQYt2D8hWjHqZz）──
const dialog = "document.querySelector('[role=dialog]')";
const H2 = `
${SELECT_HELPERS}
window.$field = (label) => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.replace('*','').trim() === label); return l && document.getElementById(l.htmlFor); };
window.$dialogBtn = (t) => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === t);
window.$item = (id) => document.querySelector('li[data-report-id="' + id + '"]');
window.$btnIn = (root, t) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === t);
window.$vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
`;
const posts = async (from, path, method = "POST") => (await mockLog()).slice(from).filter((e) => e.path === path && e.method === method);

async function openReports(id) {
  await goto(`${APP}/daily-report${id ? `?id=${id}` : ""}`);
  await waitFor("document.querySelector('li[data-report-id]')", 60000);
  await helpers();
  await evaluate(H2);
}
async function openLog() {
  await evaluate("$btn('+ Log an incident').click();");
  await waitFor(`${dialog}`);
  await evaluate("$dialogBtn('No show').click();");
  await waitFor("!!$field('Tour date') || !!document.querySelector('[role=dialog] [aria-label=\"Tour date\"]')");
}

async function run() {
  await ctl({ reset: true, ns: true, supervisor: true, superadmin: true, visible: true, notifyOff: true, nsBoarded: false, noOrdersView: false, partner: false });
  await openReports();

  // ── 列表：计数、筛选、Farm out、跟进人只写文字（T2 A）──
  check("计数多 No show 1（紫 #c4b5fd）", await evaluate("const s = [...document.querySelectorAll('main span')].find(x => x.textContent.trim() === 'No show 1'); return !!s && getComputedStyle(s).color === 'rgb(196, 181, 253)';"));
  check("类型筛选多 No show", (await evaluate("return (await $selOptions(document.querySelector('[aria-label=\"Type filter\"]'))).map(o => o.label).join('|');")) === "All types|Complaint|Accident|Emergency|No show");
  check("No show 那一行：类型「NO SHOW」紫框、灰底白字 Farm out、第一行写客人名、没有 What happened 空段", await evaluate("const li = $item(5); const t = li.querySelector('span'); const f = li.querySelector('[data-farm-out]'); return t.textContent.trim() === 'No show' && getComputedStyle(t).color === 'rgb(196, 181, 253)' && !!f && f.textContent === 'Farm out' && getComputedStyle(f).backgroundColor === 'rgb(71, 85, 105)' && li.textContent.includes('ZZ Test Guest') && !li.querySelector('p.mt-1');"), await evaluate("return $item(5).outerHTML.slice(0, 600);"));
  check("T2 A：No show 底行没有 Follow-up 下拉，只写文字「Follow-up: not assigned yet」；Status 下拉照旧", await evaluate("const li = $item(5); const fu = li.querySelector('[aria-label=\"Follow-up of report 5\"]'); return (!fu || !$vis(fu)) && li.querySelector('[data-follow-up-text]').textContent === 'Follow-up: not assigned yet' && $vis(li.querySelector('[aria-label=\"Status of report 5\"]'));"));
  check("别的类别（Complaint 2）底行 Follow-up 下拉照旧", await evaluate("return $vis($item(2).querySelector('[aria-label=\"Follow-up of report 2\"]'));"));

  // ── 展开：详情行、Evidence（T3 A）、Earlier records ──
  await evaluate("$btnIn($item(5), 'Details').click();");
  await waitFor("$item(5).querySelector('[data-evidence] li') && $item(5).querySelector('[data-contact-log]') && $item(5).querySelector('[data-earlier-records]')");
  check("详情：Tour date / Pickup / Driver / Guide / Reported by / Reason / Logged from Morning Tracking", await evaluate("const t = $item(5).textContent; return t.includes('Nov 26, 2026 · Grand Canyon West Rim Day Tour') && t.includes('Circus Circus') && t.includes('ZZ Test Driver · ZZ Test Guide · Bus 1328') && t.includes('Reported byOffice') && t.includes('Wrong pickup info given to guest') && t.includes('Logged fromMorning Tracking');"), await evaluate("return $item(5).querySelector('dl')?.textContent;"));
  const ev = await evaluate("return [...$item(5).querySelectorAll('[data-evidence] li')].map(l => l.textContent.replace(/\\s+/g, ' ').trim());");
  check("T3 A Evidence 每样一行：确认送达、早班提醒失败、Guest reply none、Rezdy changes 1、Day of tour Bus No show、★ Notes 2、Phone AI 1（Super Admin）", ev.length === 7 && ev[0].startsWith("Confirmation sent · Nov 24") && ev[0].includes("delivered") && ev[1].startsWith("Pickup reminder · Nov 25") && ev[1].includes("failed") && ev[2] === "Guest reply · none" && ev[3].startsWith("Rezdy changes · 1") && ev[3].includes("Pickup") && ev[4].includes("Nov 26, 2026 Bus: No show by ZZ Test Driver") && ev[5] === "★ Notes · 2" && ev[6].startsWith("Phone AI calls · 1"), JSON.stringify(ev));
  check("Evidence：早班失败那行红字、确认送达绿字；最后「Open order page →」链到 /orders/CHDNS0001", await evaluate("const lis = $item(5).querySelectorAll('[data-evidence] li'); const c = (li) => getComputedStyle(li.querySelector('span')).color; const a = [...$item(5).querySelectorAll('[data-evidence] a')].find(x => x.textContent === 'Open order page →'); return c(lis[1]) === 'rgb(248, 113, 113)' && c(lis[0]) === 'rgb(74, 222, 128)' && !!a && a.getAttribute('href') === '/orders/CHDNS0001';"));
  check("Earlier records（详情里不列自己）：★ Note（from Morning Tracking，长的截断 + Show ▸）+ No show 标记（field）", await evaluate("const e = $item(5).querySelector('[data-earlier-records]'); const t = e.textContent; return t.includes('Earlier records for CHDNS0001 (2)') && !e.querySelector('[data-earlier-report]') && t.includes('Lizzie') && t.includes('from Morning Tracking') && t.includes('…') && !!$btnIn(e, 'Show ▸') && t.includes('Nov 26, 2026 · Bus · ZZ Test Driver (field)');"), await evaluate("return $item(5).querySelector('[data-earlier-records]')?.textContent;"));
  await evaluate("$btnIn($item(5).querySelector('[data-earlier-records]'), 'Show ▸').click();");
  check("★ Note 点 Show ▸ 看全文", await waitFor("$item(5).querySelector('[data-earlier-records]').textContent.includes('please double check with the guest.')"));

  // ── 联系记录：只加，必填照契约 ──
  let from = (await mockLog()).length;
  const CL = "$item(5).querySelector('[data-contact-log]')";
  await evaluate(`$btnIn(${CL}, 'Save contact').click();`);
  check("联系记录：没选 Reached? 就 Save ⇒「Please fill in: Reached?.」、不发请求", (await waitFor(`${CL}.querySelector('[role=alert]')?.textContent === 'Please fill in: Reached?.'`)) && (await posts(from, "/api/operation-reports/5/contacts")).length === 0);
  await evaluate(`$btnIn(${CL}, 'Yes').click();`);
  await waitFor(`${CL}.querySelector('textarea')`);
  await evaluate(`$btnIn(${CL}, 'Save contact').click();`);
  check("联系上了没写客人说了什么 ⇒「Please fill in: What the guest said.」", await waitFor(`${CL}.querySelector('[role=alert]')?.textContent === 'Please fill in: What the guest said.'`));
  await evaluate(`await $sel(${CL}.querySelector('[aria-label="Contact method"]'), 'whatsapp'); $setValue(${CL}.querySelector('[aria-label="Contact date"]'), '2026-11-26'); $setValue(${CL}.querySelector('[aria-label="Contact time"]'), '10:40'); $setValue(${CL}.querySelector('textarea'), '  ZZ Was waiting at Resorts World. OK to go on Nov 29.  ');`);
  await evaluate(`$btnIn(${CL}, 'Save contact').click();`);
  await waitFor(`${CL}.querySelector('[data-contact-saved]')`);
  const cp = (await posts(from, "/api/operation-reports/5/contacts"))[0]?.body;
  check("Save contact：POST {method whatsapp, contacted_at 带偏移 2026-11-26T10:40 -08:00, reached true, guest_said 去空格}", cp && cp.method === "whatsapp" && /^2026-11-26T10:40(:00)?(\.000)?-08:00$/.test(cp.contacted_at) && cp.reached === true && cp.guest_said === "ZZ Was waiting at Resorts World. OK to go on Nov 29.", JSON.stringify(cp));
  check("存好：列表多一行「WhatsApp · by Lizzie」+ 绿 Reached + 客人原话；绿字 Saved；Save contact 是蓝色", await evaluate(`const li = ${CL}.querySelector('[data-contact-id]'); const s = ${CL}.querySelector('[data-contact-saved]'); return li.textContent.includes('WhatsApp · by Lizzie') && li.textContent.includes('Reached') && li.textContent.includes('ZZ Was waiting at Resorts World') && getComputedStyle(s).color === 'rgb(74, 222, 128)' && getComputedStyle($btnIn(${CL}, 'Save contact')).backgroundColor === 'rgb(59, 130, 246)';`));

  // ── Guest decision：先选后存（T2 A：跟进人在这里）──
  const GD = "$item(5).querySelector('[data-guest-decision]')";
  from = (await mockLog()).length;
  check("Guest decision：三个决定；没改时 Save 灰着", await evaluate(`return [...${GD}.querySelectorAll('[data-decision]')].map(b => b.textContent).join('|') === 'Accepted reschedule|Declined|No reply' && ${GD}.querySelector('[data-decision-save]').disabled;`));
  await evaluate(`${GD}.querySelector('[data-decision="declined"]').click();`);
  check("选 Declined：出 Follow-up * 和 Follow up by *、提示 My tasks、灰字 Not saved yet；还没发 PATCH", (await waitFor(`!!${GD}.querySelector('[aria-label="Follow up by"]')`)) && (await evaluate(`const t = ${GD}.textContent; return t.includes('Follow-up *') && t.includes('Follow up by *') && t.includes('The follow-up person gets a task in My tasks on that day.') && t.includes('Not saved yet');`)) && (await posts(from, "/api/operation-reports/5", "PATCH")).length === 0, await evaluate(`return ${GD}.textContent;`));
  await evaluate(`${GD}.querySelector('[data-decision-save]').click();`);
  check("Declined 不填跟进人 / 期限 Save ⇒「Please fill in: Follow-up, Follow up by.」、不发请求", (await waitFor(`${GD}.querySelector('[role=alert]')?.textContent === 'Please fill in: Follow-up, Follow up by.'`)) && (await posts(from, "/api/operation-reports/5", "PATCH")).length === 0);
  // 没存就离开要问
  await evaluate("window.__asked = ''; window.confirm = (m) => { window.__asked = m; return false; };");
  check("有没存的决定：离开页面会拦（beforeunload 挂上）", await evaluate("const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented;"));
  const due = laYmd(new Date(Date.now() + 2 * 86400000));
  await evaluate(`await $sel(${GD}.querySelector('[aria-label="Follow-up"]'), '7'); $setValue(${GD}.querySelector('[aria-label="Follow up by"]'), '${due}');`);
  await evaluate(`${GD}.querySelector('[data-decision-save]').click();`);
  await waitFor(`!!${GD}.querySelector('[data-decision-saved]')`);
  let pb = (await posts(from, "/api/operation-reports/5", "PATCH"))[0]?.body;
  check("Save：一个 PATCH {details: 原来 staff 那部分 + decision declined + follow_up_due，不带系统键 / new_order_number, follow_up_user_id 7}", pb && pb.follow_up_user_id === 7 && pb.details.decision === "declined" && pb.details.follow_up_due === due && pb.details.tour_date === "2026-11-26" && pb.details.reason === "wrong_pickup_info" && pb.details.pickup_location === "Circus Circus" && !("source" in pb.details) && !("farm_out" in pb.details) && !("new_order_number" in pb.details) && Object.keys(pb).sort().join() === "details,follow_up_user_id", JSON.stringify(pb));
  check("存好：绿 Saved；底行「Follow-up: Annie · due …」、状态 In progress", await evaluate(`const li = $item(5); return getComputedStyle(${GD}.querySelector('[data-decision-saved]')).color === 'rgb(74, 222, 128)' && li.querySelector('[data-follow-up-text]').textContent.startsWith('Follow-up: Annie · due ') && li.textContent.includes('In progress');`), await evaluate("return $item(5).querySelector('[data-follow-up-text]')?.textContent;"));
  // Accepted
  from = (await mockLog()).length;
  await evaluate(`${GD}.querySelector('[data-decision="accepted"]').click();`);
  await waitFor(`!!${GD}.querySelector('[aria-label="New order #"]')`);
  check("选 Accepted：出 New order # *，Follow up by 不出", await evaluate(`return !${GD}.querySelector('[aria-label="Follow up by"]') && ${GD}.textContent.includes('New order # *');`));
  await evaluate(`${GD}.querySelector('[data-decision-save]').click();`);
  check("Accepted 不填新单号 ⇒「Please fill in: New order #.」", await waitFor(`${GD}.querySelector('[role=alert]')?.textContent === 'Please fill in: New order #.'`));
  await evaluate(`$setValue(${GD}.querySelector('[aria-label="New order #"]'), 'chdns0009'); ${GD}.querySelector('[data-decision-save]').click();`);
  await waitFor(`!!${GD}.querySelector('[data-decision-saved]')`);
  pb = (await posts(from, "/api/operation-reports/5", "PATCH"))[0]?.body;
  check("Accepted Save：details.decision accepted、new_order_number 大写 CHDNS0009、不带 follow_up_due", pb && pb.details.decision === "accepted" && pb.details.new_order_number === "CHDNS0009" && !("follow_up_due" in pb.details), JSON.stringify(pb));
  check("状态 Waiting for rescheduled tour（紫胶囊）；Status 下拉多这一项；新单那行「New order CHDNS0009 · Nov 29, 2026 · Confirmed · not boarded yet」", (await waitFor("$item(5).querySelector('[data-rescheduled]')?.textContent.includes('not boarded yet')")) && (await evaluate("const li = $item(5); const pill = [...li.querySelectorAll('span')].find(s => s.textContent === 'Waiting for rescheduled tour' && s.className.includes('rounded-full')); return !!pill && getComputedStyle(pill).color === 'rgb(196, 181, 253)' && li.querySelector('[data-rescheduled]').textContent === 'New order CHDNS0009 · Nov 29, 2026 · Confirmed · not boarded yet';")) && (await evaluate("return (await $selOptions($item(5).querySelector('[aria-label=\"Status of report 5\"]'))).map(o => o.label).join('|');")) === "Open|In progress|Waiting for rescheduled tour|Resolved", await evaluate("return $item(5).querySelector('[data-rescheduled]')?.textContent;"));
  check("还没上车：没有 ready to close 绿条", await evaluate("return !$item(5).querySelector('[data-ready-to-close]');"));
  await ctl({ nsBoarded: true });
  await openReports(5);
  await waitFor("document.querySelector('li[data-report-id=\"5\"] [data-ready-to-close]')");
  check("新单上车：绿条「✓ Guest boarded the rescheduled tour - ready to close」，不自动关（还是 Waiting）", await evaluate("const b = document.querySelector('li[data-report-id=\"5\"] [data-ready-to-close]'); return b.textContent === '✓ Guest boarded the rescheduled tour - ready to close' && getComputedStyle(b).color === 'rgb(74, 222, 128)' && document.querySelector('li[data-report-id=\"5\"]').textContent.includes('Waiting for rescheduled tour');"));

  // ── Log 弹窗：只填订单号 + 团期，其余带出 ──
  await openReports();
  await openLog();
  check("Report type 四个、选 No show；What happened 没有 *；Follow-up 照旧", await evaluate(`const t = ${dialog}.textContent; return [...${dialog}.querySelectorAll('[aria-label="Report type"] button')].map(b => b.textContent).join('|') === 'Complaint|Accident|Emergency|No show' && !!$field('What happened') && ![...${dialog}.querySelectorAll('label')].find(l => l.textContent.startsWith('What happened'))?.textContent.includes('*') && !!$field('Follow-up');`));
  let fromLog = (await mockLog()).length;
  await evaluate(`$dialogBtn('Save').click();`);
  check("什么都不填 Save ⇒「Please fill in: CHD# / order, Tour date.」、不发请求", (await waitFor(`${dialog}.querySelector('[role=alert]')?.textContent === 'Please fill in: CHD# / order, Tour date.'`)) && (await posts(fromLog, "/api/operation-reports")).length === 0);
  await evaluate("$setValue($field('CHD# / order'), 'chdns0002');");
  await waitFor(`${dialog}.querySelectorAll('[data-ns-day]').length === 2`);
  check("一单两天 ⇒ 两个按钮「Nov 26, 2026 · Grand Canyon West…」「Nov 27, 2026 · Hoover Dam Tour」+ 说明；带出说明紫字", await evaluate(`const b = [...${dialog}.querySelectorAll('[data-ns-day]')].map(x => x.textContent); return b[0] === 'Nov 26, 2026 · Grand Canyon West Rim Day Tour' && b[1] === 'Nov 27, 2026 · Hoover Dam Tour' && ${dialog}.textContent.includes('This order has 2 tour days. Pick the one the guest missed.') && ${dialog}.textContent.includes('Filled in from Main manifest and Dispatch. You can change them.');`));
  check("Earlier records：这单没有记录 ⇒「No earlier records for this order.」", await waitFor(`${dialog}.querySelector('[data-earlier-records]')?.textContent.includes('No earlier records for this order.')`));
  await evaluate(`${dialog}.querySelector('[data-ns-day="2026-11-27"]').click();`);
  check("选 Nov 27：产品 Hoover Dam Tour、接客 Excalibur 带出，司机 / 导游 / 车号空着能填", await waitFor("$field('Product')?.value === 'Hoover Dam Tour' && $field('Pickup location').value === 'Excalibur' && $field('Driver').value === '' && $field('Vehicle').value === ''"));
  await evaluate("$setValue($field('Driver'), 'ZZ Typed Driver'); $dialogBtn('Guide').click();");
  fromLog = (await mockLog()).length;
  await evaluate(`$dialogBtn('Save').click();`);
  await waitFor(`!${dialog}`);
  const cb = (await posts(fromLog, "/api/operation-reports"))[0]?.body;
  check("Save POST：report_type no_show、order_number 大写、subject_name = 客人名、details 只带有值的键、reported_by guide、what_happened 空串", cb && cb.report_type === "no_show" && cb.order_number === "CHDNS0002" && cb.subject_name === "ZZ Two Days" && cb.what_happened === "" && JSON.stringify(cb.details) === JSON.stringify({ tour_date: "2026-11-27", product_code: "HD01", product_name: "Hoover Dam Tour", pickup_location: "Excalibur", driver_name: "ZZ Typed Driver", reported_by: "guide" }) && cb.complaint_about === null, JSON.stringify(cb));
  check("存好提示「Saved. The people on shift got a Notice.」（N5）", await waitFor("document.body.textContent.includes('Saved. The people on shift got a Notice.')"));
  // 409：这单这天已有没关的
  await openLog();
  await evaluate("$setValue($field('CHD# / order'), 'CHDNS0001');");
  check("一单一天 ⇒ 不出按钮、Tour date 直接填好；Farm out 标签出在 No show details 上", await waitFor(`$field('Tour date')?.value === '2026-11-26' && !!${dialog}.querySelector('legend [data-farm-out]')`));
  check("Earlier records 在弹窗里列出这单以前的 No show 登记（Open ▸）", await waitFor(`!!${dialog}.querySelector('[data-earlier-report="5"]')`));
  await evaluate(`$btnIn(${dialog}.querySelector('[data-earlier-report="5"]'), 'Open ▸').click();`);
  check("Open ▸ 就地展开：Updates / No updates yet + 「Open in Daily report →」/daily-report?id=5", await waitFor(`${dialog}.querySelector('[data-earlier-report="5"] a')?.getAttribute('href') === '/daily-report?id=5'`));
  await evaluate(`$dialogBtn('Save').click();`);
  check("409：红字后端原话 + 「Open it →」链到 /daily-report?id=5", await waitFor(`${dialog}.querySelector('[data-open-existing]')?.getAttribute('href') === '/daily-report?id=5' && ${dialog}.querySelector('[role=alert]').textContent.startsWith('There is already an open No show report for this order and tour date.')`));
  // 查不到
  await evaluate("$setValue($field('CHD# / order'), 'CHDZZ404');");
  check("Order List 里查不到 ⇒ 黄字说明、日期格手填", await waitFor(`!!${dialog}.querySelector('[data-ns-not-found]') && $field('Tour date')?.type === 'date'`));
  // Complaint about Office / Booking
  await evaluate("$dialogBtn('Complaint').click();");
  await waitFor(`!!${dialog}.querySelector('[aria-label="Complaint about"]')`);
  check("Complaint about 多 Office / Booking；选了以后旁边那格叫 Staff or system involved", (await evaluate(`return [...${dialog}.querySelectorAll('[aria-label="Complaint about"] button')].map(b => b.textContent).join('|');`)) === "Driver|Guide|Itinerary|Office / Booking" && (await evaluate("$dialogBtn('Office / Booking').click(); return true;")) && (await waitFor("!!$field('Staff or system involved')")));
  await evaluate("$dialogBtn('Cancel').click();");
  await waitFor(`!${dialog}`);

  // ── How to use：页面最底、默认折叠 ──
  check("/daily-report 最底 How to use，默认折叠，No show 几条原文", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Daily Operation Report')); const t = d?.textContent ?? ''; return !!d && !d.open && t.includes('For a No show, type the order # and pick the tour date.') && t.includes('Contacts can’t be edited or deleted.') && t.includes('Declined or No reply needs a follow-up person and a date: that person gets a task in My tasks on that day.') && t.includes('It never closes by itself: set Status to Resolved.') && t.includes('Farm out orders follow the same steps.') && t.includes('Marking No show in Morning Tracking logs a No show report for you.');"));

  // ── 手机：类别 2 × 2、Earlier records 收起 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openReports(5);
  await waitFor("document.querySelector('li[data-report-id=\"5\"] [data-earlier-records]')");
  check("手机：Earlier records 默认收起（标题看得见、内容藏着）", await evaluate("const e = document.querySelector('li[data-report-id=\"5\"] [data-earlier-records]'); return $vis(e.querySelector('button')) && !$vis(e.querySelector('ul'));"));
  check("手机：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= window.innerWidth + 1;"), await evaluate("return document.documentElement.scrollWidth;"));
  await openLog();
  check("手机：Report type 四个排成 2 × 2", await evaluate(`const bs = [...${dialog}.querySelectorAll('[aria-label="Report type"] button')].map(b => b.getBoundingClientRect()); return Math.abs(bs[0].top - bs[1].top) < 2 && bs[2].top > bs[0].top + 10 && Math.abs(bs[2].top - bs[3].top) < 2;`));
  await cdp("Emulation.clearDeviceMetricsOverride");

  // ── 不是 Super Admin：Evidence 没有 Phone AI；没有 orders.view：Earlier records 只列登记 ──
  await ctl({ superadmin: false, noOrdersView: true, nsBoarded: false });
  await openReports(5);
  await waitFor("document.querySelector('li[data-report-id=\"5\"] [data-evidence] li')");
  check("不是 Super Admin：Evidence 没有 Phone AI 那行，也不去搜电话", await evaluate("return !document.querySelector('li[data-report-id=\"5\"] [data-evidence-voice]');") && !(await mockLog()).some((e) => e.path === "/api/voice/call-log/search" && e.at === undefined && false));
  check("没有 orders.view：Earlier records 没有 ★ Notes / No show marks 两段", await waitFor("document.querySelector('li[data-report-id=\"5\"] [data-earlier-records]')?.textContent.includes('No earlier records for this order.')"), await evaluate("return document.querySelector('li[data-report-id=\"5\"] [data-earlier-records]')?.textContent;"));
  await ctl({ superadmin: true, noOrdersView: false });

  // ── Dashboard 块计数 ──
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('[aria-label=\"Daily Operation Report\"]')", 60000);
  check("Dashboard 块计数多 No show", await waitFor("[...document.querySelectorAll('[aria-label=\"Daily Operation Report\"] span')].some(s => /^No show \\d+$/.test(s.textContent.trim()))"));
}
const laYmd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

main();
