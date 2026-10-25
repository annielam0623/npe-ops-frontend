// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Daily Operation Report（Dashboard 块、弹窗、/daily-report 页）。
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
// ── Daily Operation Report 检查 ──
// 1. Dashboard 块：visible_to_me=true 才画；false / 404 不画也不请求 DOR 接口；只列未结。
// 2. 改状态 / 跟进人（主管）、员工只读。
// 3. Log an incident 弹窗：三类必填校验、Accident 日期可选 + Unknown、POST 请求体。
// 4. /daily-report 页：筛选、不可见时的提示、?id= 置顶展开。
const sel = "document.querySelector('[aria-label=\"Daily Operation Report\"]')";
const dialog = "document.querySelector('[role=dialog]')";
const BLOCK = '[aria-label="Daily Operation Report"]';
const H2 = `
window.$sel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
window.$field = (label) => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.replace('*','').trim() === label); return l && document.getElementById(l.htmlFor); };
window.$ids = (root) => [...document.querySelectorAll(root + ' li[data-report-id]')].map(li => li.dataset.reportId);
window.$dialogBtn = (t) => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === t);
window.$item = (id) => document.querySelector('li[data-report-id="' + id + '"]');
window.$btnIn = (root, t) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === t);
`;
const laYmd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dorCalls = (log) => log.filter((e) => e.path.startsWith("/api/operation-reports"));
const openLog = `$btnIn(${sel}, '+ Log an incident').click();`;

async function openDashboard() {
  await goto(`${APP}/dashboard`);
  await waitFor(sel);
  await helpers();
  await evaluate(H2);
}

async function run() {
  await ctl({ reset: true, supervisor: true, visible: true, widgets404: false, reports403: false, notifyOff: true });

  // ── 1. Dashboard 块 ──
  await openDashboard();
  await waitFor(`$ids('${BLOCK}').length === 3`);
  check("Dashboard 块：只列未结 3 条（已解决的不在）", (await evaluate(`return $ids('${BLOCK}').sort().join(',');`)) === "1,2,3");
  check("上方三类计数", await evaluate(`const t = ${sel}.textContent; return t.includes('Complaint 2') && t.includes('Accident 1') && t.includes('Emergency 0');`));
  check("列表请求不带 status（后端默认未结）", dorCalls(await mockLog()).filter((e) => e.path === "/api/operation-reports" && e.method === "GET").every((e) => !e.query.includes("status")));
  check("「+ Log an incident」白底深字，不是蓝色", await evaluate(`const s = getComputedStyle($btnIn(${sel}, '+ Log an incident')); return s.backgroundColor === 'rgb(248, 250, 252)' && s.color === 'rgb(6, 16, 28)';`));
  check("「View reports →」指向 /daily-report", await evaluate(`return [...${sel}.querySelectorAll('a')].some(a => a.textContent.includes('View reports') && a.getAttribute('href') === '/daily-report');`));

  // ── 2. 主管改状态 / 跟进人 ──
  let before = (await mockLog()).length;
  await evaluate(`$sel($item(2).querySelector('select[aria-label^="Follow-up"]'), '9');`);
  await waitFor(`$item(2) && $item(2).querySelector('select[aria-label^="Follow-up"]').value === '9'`);
  let patches = (await mockLog()).slice(before).filter((e) => e.method === "PATCH");
  check("改跟进人：PATCH 只带 follow_up_user_id", patches.length === 1 && JSON.stringify(patches[0].body) === '{"follow_up_user_id":9}');
  before = (await mockLog()).length;
  await evaluate(`$sel($item(2).querySelector('select[aria-label^="Status"]'), 'resolved');`);
  await waitFor(`!$item(2)`);
  patches = (await mockLog()).slice(before).filter((e) => e.method === "PATCH");
  check("改成 Resolved：PATCH status，记录从块里消失", patches.length === 1 && patches[0].body.status === "resolved");
  await evaluate(`$btnIn($item(1), 'Details').click();`);
  check("展开 Details：Accident 详情 + 修改记录", await waitFor(`$item(1).textContent.includes('Hotel driveway') && $item(1).textContent.includes('Registered by Annie')`));

  // ── 员工：只读 ──
  await ctl({ reset: true, supervisor: false });
  before = (await mockLog()).length;
  await openDashboard();
  await waitFor(`$ids('${BLOCK}').length >= 2`);
  check("员工：没有状态 / 跟进人下拉，跟进人显示为文字", await evaluate(`return !${sel}.querySelector('select') && ${sel}.textContent.includes('Follow-up: Annie');`));
  check("员工：没指派的显示 not assigned yet", await evaluate(`return ${sel}.textContent.includes('not assigned yet');`));
  check("员工不去拉跟进人名单", !(await mockLog()).slice(before).some((e) => e.path.endsWith("/assignees")));

  // ── 3. 弹窗 ──
  await ctl({ supervisor: true, reset: true });
  await openDashboard();
  await waitFor(`$ids('${BLOCK}').length === 3`);
  await evaluate(openLog);
  await waitFor(dialog);
  check("弹窗：Save 是蓝色提交键", await evaluate(`return getComputedStyle($dialogBtn('Save')).backgroundColor === 'rgb(59, 130, 246)';`));
  await evaluate(`$dialogBtn('Save').click();`);
  await waitFor(`${dialog}.textContent.includes('Please fill in')`);
  check("Complaint 空提交：只缺 What happened，且没有发请求", (await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent;`)) === "Please fill in: What happened." && !(await mockLog()).some((e) => e.method === "POST" && e.path === "/api/operation-reports"));
  check("Complaint 默认对象 Driver，标签 Driver name", await evaluate(`return !!$field('Driver name');`));
  await evaluate(`$btnIn(${dialog}, 'Itinerary').click();`);
  check("切到 Itinerary：标签变 Itinerary or tour name", await waitFor(`$field('Itinerary or tour name')`));
  await waitFor(`$field('Follow-up').options.length > 1`);
  await evaluate(`$setValue($field('Itinerary or tour name'), 'ZZ Tour'); $setValue($field('CHD# / order'), 'CHDZZ1'); $setValue($field('What happened'), 'ZZ Too short stop'); $sel($field('Follow-up'), '8');`);
  before = (await mockLog()).length;
  await evaluate(`$dialogBtn('Save').click();`);
  await waitFor(`!${dialog}`);
  let posts = (await mockLog()).slice(before).filter((e) => e.method === "POST");
  const b1 = posts[0]?.body || {};
  check("Complaint POST 请求体", posts.length === 1 && b1.report_type === "complaint" && b1.complaint_about === "itinerary" && b1.order_number === "CHDZZ1" && b1.subject_name === "ZZ Tour" && b1.follow_up_user_id === 8 && JSON.stringify(b1.details) === "{}" && typeof b1.client_token === "string" && b1.client_token.length > 8, JSON.stringify(b1));
  check("通知总开关关着：提示 Notifications are off，新记录出现在块里", await waitFor(`${sel}.textContent.includes('Saved. Notifications are off.') && $ids('${BLOCK}').includes('5')`));

  await ctl({ notifyOff: false });
  await evaluate(openLog);
  await waitFor(dialog);
  await evaluate(`$btnIn(${dialog}, 'Emergency').click();`);
  await waitFor(`$field('People involved')`);
  check("Emergency：没有 Accident 详情，标签 People involved", await evaluate(`return !${dialog}.textContent.includes('Accident details') && !$field('Location');`));
  await evaluate(`$setValue($field('What happened'), 'ZZ Guest fainted'); $dialogBtn('Save').click();`);
  check("通知开着：提示 People in charge notified", await waitFor(`${sel}.textContent.includes('Saved. People in charge notified.')`));

  // ── Accident ──
  await evaluate(openLog);
  await waitFor(dialog);
  await evaluate(`$btnIn(${dialog}, 'Accident').click();`);
  await waitFor(`$field('Location')`);
  const today = laYmd(new Date());
  check("Accident：日期默认今天（洛杉矶）", (await evaluate(`return $field('Accident date').value;`)) === today);
  check("Accident：不能选今天以后（max=今天）", (await evaluate(`return $field('Accident date').max;`)) === today);
  await evaluate(`$dialogBtn('Save').click();`);
  await waitFor(`${dialog}.textContent.includes('Please fill in')`);
  check("Accident 空提交：七项全部列出", (await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent;`)) === "Please fill in: What happened, Accident time, Location, Vehicle #, Driver, Injuries, Police report.");
  const yesterday = laYmd(new Date(Date.now() - 86_400_000));
  await evaluate(`$setValue($field('Accident date'), '${yesterday}'); $setValue($field('Accident time'), '23:40'); $setValue($field('What happened'), 'ZZ Late entry'); $setValue($field('Location'), 'ZZ Parking lot'); $setValue($field('Injuries'), 'None'); $dialogBtn('Save').click();`);
  await waitFor(`${dialog}.textContent.includes('Vehicle #, Driver, Police report')`);
  check("车号、司机、是否报警缺了仍然拦下", (await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent;`)) === "Please fill in: Vehicle #, Driver, Police report.");
  await evaluate(`[...${dialog}.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Unknown').forEach(b => b.click()); $sel($field('Police report'), 'unknown');`);
  check("Unknown 按钮填入车号和司机", await evaluate(`return $field('Vehicle #').value === 'Unknown' && $field('Driver').value === 'Unknown';`));
  before = (await mockLog()).length;
  await evaluate(`$dialogBtn('Save').click();`);
  await waitFor(`!${dialog}`);
  posts = (await mockLog()).slice(before).filter((e) => e.method === "POST");
  const b2 = posts[0]?.body || {};
  const iso = b2.details?.occurred_at || "";
  check("Accident POST：日期是选的前一天，带洛杉矶偏移", posts.length === 1 && b2.report_type === "accident" && b2.complaint_about === null && /^\d{4}-\d{2}-\d{2}T23:40:00-0[78]:00$/.test(iso) && iso.startsWith(yesterday), iso);
  check("Accident POST：Unknown 车号 / 司机，police_report=unknown，其余字段齐", b2.details?.vehicle_no === "Unknown" && b2.details?.driver_name === "Unknown" && b2.details?.police_report === "unknown" && b2.details?.location === "ZZ Parking lot" && b2.details?.injuries === "None");

  // ── 4. 不可见 ──
  await ctl({ visible: false });
  before = (await mockLog()).length;
  await goto(`${APP}/dashboard`);
  await waitFor(`document.querySelector('main')`);
  await sleep(1500);
  check("visible_to_me=false：Dashboard 不画这一块", await evaluate(`return !${sel};`));
  check("visible_to_me=false：不请求 DOR 接口", dorCalls((await mockLog()).slice(before)).length === 0);
  await ctl({ visible: true, widgets404: true });
  before = (await mockLog()).length;
  await goto(`${APP}/dashboard`);
  await waitFor(`document.querySelector('main')`);
  await sleep(1500);
  check("板块接口 404：当作不可见，不画", await evaluate(`return !${sel};`));
  check("板块接口 404：不请求 DOR 接口", dorCalls((await mockLog()).slice(before)).length === 0);
  await ctl({ widgets404: false, reports403: true });
  await goto(`${APP}/dashboard`);
  check("可见但 DOR 接口 403：块里显示错误，不崩", await waitFor(`${sel} && ${sel}.textContent.includes('Failed to load reports')`));
  await ctl({ reports403: false });

  // ── 4b. Super Admin 的「员工可见」开关（Annie 2026-10-24 选 A：标题行右侧） ──
  await ctl({ reset: true, superadmin: true, visible: false, supervisor: true });
  before = (await mockLog()).length;
  await openDashboard();
  await waitFor(`$ids('${BLOCK}').length === 3`);
  const swSel = `${sel}.querySelector('[role=switch]')`;
  check("Super Admin：员工还看不到时板块照样显示，开关关着，状态写 Staff can’t see this，黄色虚线边框", await evaluate(`const s = ${swSel}; const st = ${sel}.querySelector('[data-staff-state]'); return !!s && s.getAttribute('aria-checked') === 'false' && st.textContent.includes('Staff can’t see this') && getComputedStyle(${sel}).borderStyle === 'dashed';`));
  check("开关不是蓝色（蓝色只给提交键）", await evaluate(`const c = getComputedStyle(${swSel}).borderColor; return !c.includes('59, 130, 246');`));
  await evaluate(`${swSel}.click();`);
  await waitFor(`${swSel}.getAttribute('aria-checked') === 'true'`);
  let puts = (await mockLog()).slice(before).filter((e) => e.method === "PUT");
  check("打开开关：PUT widgets.daily_operation_report=staff", puts.length === 1 && JSON.stringify(puts[0].body) === '{"widgets":{"daily_operation_report":"staff"}}');
  check("打开后：状态写 Visible to staff，边框变实线，提示 Staff can now see this block.", await waitFor(`${sel}.querySelector('[data-staff-state]').textContent.includes('Visible to staff') && getComputedStyle(${sel}).borderStyle === 'solid' && ${sel}.textContent.includes('Staff can now see this block.')`));
  await evaluate(`${swSel}.click();`);
  await waitFor(`${swSel}.getAttribute('aria-checked') === 'false'`);
  puts = (await mockLog()).slice(before).filter((e) => e.method === "PUT");
  check("再关掉：PUT super_admin_only，提示 no longer", puts.length === 2 && puts[1].body.widgets.daily_operation_report === "super_admin_only" && (await waitFor(`${sel}.textContent.includes('Staff can no longer see this block.')`)));
  await ctl({ putFail: true });
  await evaluate(`${swSel}.click();`);
  check("PUT 失败：写出原因，开关留在原状态", await waitFor(`${sel}.textContent.includes('Could not change who can see this block: mock save failed')`) && (await evaluate(`return ${swSel}.getAttribute('aria-checked') === 'false';`)));
  await ctl({ putFail: false, superadmin: false, visible: true, supervisor: true });
  await openDashboard();
  await waitFor(`$ids('${BLOCK}').length === 3`);
  check("主管 / 员工：看不到开关，也没有虚线边框", await evaluate(`return !${swSel} && !${sel}.querySelector('[data-staff-state]') && getComputedStyle(${sel}).borderStyle === 'solid';`));
  await ctl({ superadmin: false, visible: false });
  await goto(`${APP}/dashboard`);
  await sleep(1500);
  check("员工 + 板块没放出来：整块不画", await evaluate(`return !${sel};`));

  // ── 5. /daily-report 页 ──
  await ctl({ reset: true, visible: true, supervisor: true });
  await goto(`${APP}/daily-report`);
  await waitFor(`document.querySelector('li[data-report-id]')`);
  await helpers();
  await evaluate(H2);
  check("页面：默认只列未结 3 条，倒序", (await evaluate(`return $ids('main').join(',');`)) === "3,2,1");
  await evaluate(`$btnIn(document.querySelector('[aria-label="Status filter"]'), 'Resolved').click();`);
  await waitFor(`$ids('main').join(',') === '4'`);
  check("筛选 Resolved：请求 status=resolved，只剩 4", (await mockLog()).some((e) => e.path === "/api/operation-reports" && e.query.includes("status=resolved")));
  await evaluate(`$btnIn(document.querySelector('[aria-label="Status filter"]'), 'All').click();`);
  check("筛选 All：四条（含已解决）", await waitFor(`$ids('main').length === 4`));
  await evaluate(`$sel(document.querySelector('[aria-label="Type filter"]'), 'complaint');`);
  await waitFor(`$ids('main').join(',') === '3,2'`);
  check("筛选类型 Complaint", (await mockLog()).some((e) => e.query.includes("type=complaint")));
  await evaluate(`$setValue(document.querySelector('[aria-label="Search reports"]'), 'refund');`);
  await waitFor(`$ids('main').join(',') === '3'`);
  check("搜索 refund（防抖后带 q 查询）", (await mockLog()).some((e) => e.query.includes("q=refund")));
  await evaluate(`$setValue(document.querySelector('[aria-label="Search reports"]'), 'zzznothing');`);
  check("没有匹配：显示空提示", await waitFor(`document.body.textContent.includes('No reports match these filters.')`));
  await evaluate(`$setValue(document.querySelector('[aria-label="Search reports"]'), ''); $sel(document.querySelector('[aria-label="Type filter"]'), '');`);
  await waitFor(`$ids('main').length === 4`);
  before = (await mockLog()).length;
  await evaluate(`$sel($item(4).querySelector('select[aria-label^="Status"]'), 'open');`);
  await waitFor(`$item(4) && $item(4).querySelector('select[aria-label^="Status"]').value === 'open'`);
  check("页面里可以把已解决改回 Open（重新打开）", (await mockLog()).slice(before).some((e) => e.method === "PATCH" && e.body.status === "open"));

  await goto(`${APP}/daily-report?id=3`);
  await waitFor(`$item(3) && $item(3).textContent.includes('Registered by Annie')`);
  check("?id=3：那条置顶并自动展开（带修改记录）", await evaluate(`return document.querySelector('main li[data-report-id]').dataset.reportId === '3';`));

  await ctl({ visible: false });
  before = (await mockLog()).length;
  await goto(`${APP}/daily-report`);
  check("页面：板块不可见 → 提示还没开放", await waitFor(`document.body.textContent.includes('This section is not available yet.')`));
  check("页面：板块不可见 → 不请求 DOR 接口", dorCalls((await mockLog()).slice(before)).length === 0);
  await ctl({ widgets404: true, visible: true });
  await goto(`${APP}/daily-report`);
  check("页面：板块接口 404 → 同样当不可见", await waitFor(`document.body.textContent.includes('This section is not available yet.')`));
  await ctl({ widgets404: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
