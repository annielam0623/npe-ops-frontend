// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Settings → Notifications（/settings/notifications，统一自动通知开关页）。
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
// ── Notifications 开关页检查（样稿 https://claude.ai/artifact/HMF3ZUz2M4zYMd23gJTv7t） ──
const CARD = (k) => `document.querySelector('[data-notification="${k}"]')`;
const H2 = `
window.$sw = (k) => document.querySelector('[data-notification="' + k + '"] button[role=switch]');
window.$card = (k) => document.querySelector('[data-notification="' + k + '"]');
window.$keys = () => [...document.querySelectorAll('[data-notification]')].map(e => e.dataset.notification);
window.$btnIn = (root, t) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === t);
`;
const since = async (from, f) => (await mockLog()).slice(from).filter(f);
const isPut = (e) => e.method === "PUT" && e.path === "/api/settings/notification-switches";
const isScPut = (e) => e.method === "PUT" && e.path === "/api/settings/schedule-confirm";

async function open() {
  await goto(`${APP}/settings/notifications`);
  await waitFor("document.querySelector('[data-notification]') || document.body.textContent.includes('Admin access required')");
  await helpers();
  await evaluate(H2);
}

async function run() {
  await ctl({ reset: true, role: "superadmin", failPut: "", failScPut: "", extras: false, serverText: false, autoSendOn: false, fail401: false });
  let from = (await mockLog()).length;
  await open();

  // ── Super Admin，全部关 ──
  check("四张卡，顺序：每日任务提醒 → DOR 通知 → 周三排班确认 → 定时自动发送", (await evaluate("return $keys().join(',');")) === "daily_task_reminders,operation_report_notify,schedule_confirm,auto_send");
  check("分组标题（后端的 group）：Daily tasks / Daily Operation Report / Staff schedule；定时自动发送是 Messages to guests", await evaluate("const t = document.querySelector('main').textContent; return ['Daily tasks', 'Daily Operation Report', 'Staff schedule', 'Messages to guests'].every((g) => t.includes(g));"));
  check("全关：顶上黄条 All 4 automatic notifications are OFF", await evaluate("const b = document.querySelector('[data-banner=all-off]'); return !!b && b.textContent.includes('All 4 automatic notifications are OFF.') && b.textContent.includes('Nothing is being sent by itself.');"));
  check("三个开关都是关（灰），状态写 Off", await evaluate("return ['daily_task_reminders', 'operation_report_notify', 'schedule_confirm'].every((k) => $sw(k).getAttribute('aria-checked') === 'false' && $card(k).querySelector('[data-state=off]').textContent.trim() === 'Off');"));
  check("关着的开关不是蓝色（蓝色只给提交键）", await evaluate("return !getComputedStyle($sw('daily_task_reminders')).borderColor.includes('59, 130, 246');"));
  check("每张卡有一句说明（写明关着会怎样）", await evaluate("return $card('daily_task_reminders').textContent.includes('While this is off, none of these are sent.');"));
  check("Details 默认收起；展开后有 When / Who gets it / Sample", await (async () => {
    const closed = await evaluate("return !$card('daily_task_reminders').querySelector('details').open;");
    await evaluate("$card('daily_task_reminders').querySelector('summary').click();");
    const t = await evaluate("return $card('daily_task_reminders').querySelector('details').textContent;");
    return closed && t.includes('When') && t.includes('Who gets it') && t.includes('reservations@') && t.includes('Task due in 30 minutes') && t.includes('Send last minute confirmations');
  })());
  check("周三确认卡：说明用后端的 description，Details 里的触发 / 收件人 / 样例是前端兜底文案，发送时间 09:00，Super Admin 能改", await evaluate("const c = $card('schedule_confirm'); c.querySelector('summary').click(); return c.textContent.includes('Sends staff next week') && c.textContent.includes('Wednesdays at the time set below') && c.textContent.includes('Please confirm your schedule for Oct 25') && c.querySelector('input[type=time]').value === '09:00' && !c.querySelector('input[type=time]').disabled && !$sw('schedule_confirm').disabled;"));
  check("定时自动发送卡：没有开关，写 Managed on the Auto Send page + 真实状态 + 链接", await evaluate("const c = $card('auto_send'); const a = c.querySelector('a'); return !c.querySelector('button[role=switch]') && c.textContent.includes('Managed on the Auto Send page') && c.textContent.includes('Tour confirmations: Off') && c.textContent.includes('Ticket reminders: Off') && !!a && a.getAttribute('href') === '/settings/auto-send';"));
  check("先拉 /api/me 再拉 notification-switches、schedule-confirm；定时自动发送的状态来自开关列表，不再单独请求 /api/settings/auto-send", await (async () => {
    const l = (await mockLog()).slice(from);
    const idx = (p) => l.findIndex((e) => e.path === p);
    return idx("/api/me") >= 0 && idx("/api/settings/notification-switches") > idx("/api/me") && idx("/api/settings/schedule-confirm") > 0 && idx("/api/settings/auto-send") === -1;
  })());

  // ── 打开前确认 ──
  from = (await mockLog()).length;
  await evaluate("$sw('daily_task_reminders').click();");
  await waitFor("$card('daily_task_reminders').querySelector('[role=alertdialog]')");
  check("点开关：出现确认框，还没发请求", (await since(from, isPut)).length === 0 && (await evaluate("return $sw('daily_task_reminders').getAttribute('aria-checked') === 'false';")));
  check("确认框写了三点：谁收到、也发 reservations@、不补发", await evaluate("const t = $card('daily_task_reminders').querySelector('[role=alertdialog]').textContent; return t.includes('Who gets reminders') && t.includes('reservations@') && t.includes('No catch-up') && t.includes('30 minutes left');"));
  check("确认键是蓝色提交键（Turn on）", await evaluate("return getComputedStyle($btnIn($card('daily_task_reminders'), 'Turn on')).backgroundColor === 'rgb(59, 130, 246)';"));
  await evaluate("$btnIn($card('daily_task_reminders'), 'Cancel').click();");
  await sleep(150);
  check("Cancel：确认框收起，没发请求，仍是关", (await since(from, isPut)).length === 0 && (await evaluate("return !$card('daily_task_reminders').querySelector('[role=alertdialog]') && $sw('daily_task_reminders').getAttribute('aria-checked') === 'false';")));
  await evaluate("$sw('daily_task_reminders').click();");
  await waitFor("$card('daily_task_reminders').querySelector('[role=alertdialog]')");
  await evaluate("$btnIn($card('daily_task_reminders'), 'Turn on').click();");
  await waitFor("$sw('daily_task_reminders').getAttribute('aria-checked') === 'true'");
  let puts = await since(from, isPut);
  check("Turn on：PUT {switches:{daily_task_reminders:true}}，用返回的整份刷新（不再 GET）", puts.length === 1 && JSON.stringify(puts[0].body) === '{"switches":{"daily_task_reminders":true}}');
  check("打开后：状态 On since Oct 24, 5:42 PM，开关绿，卡片边框变绿", await evaluate("const c = $card('daily_task_reminders'); const st = c.querySelector('[data-state=on]'); return !!st && st.textContent.includes('On since Oct 24, 5:42 PM') && getComputedStyle($sw('daily_task_reminders')).borderColor === 'rgb(74, 222, 128)' && c.hasAttribute('data-on');"));
  check("有开的：黄条变绿条，写 1 of 4 ... ON 和名称", await evaluate("const b = document.querySelector('[data-banner=some-on]'); return !document.querySelector('[data-banner=all-off]') && !!b && b.textContent.includes('1 of 4 automatic notifications are ON.') && b.textContent.includes('Daily tasks: reminders and shift-end alerts');"));
  check("提示 “Daily tasks: reminders and shift-end alerts” is on.", await evaluate("return document.body.textContent.includes('“Daily tasks: reminders and shift-end alerts” is on.');"));

  // ── 关闭不用确认 ──
  from = (await mockLog()).length;
  await evaluate("$sw('daily_task_reminders').click();");
  await waitFor("$sw('daily_task_reminders').getAttribute('aria-checked') === 'false'");
  puts = await since(from, isPut);
  check("关闭：不弹确认，直接 PUT enabled:false，条变回黄", puts.length === 1 && puts[0].body.switches.daily_task_reminders === false && (await evaluate("return !document.querySelector('[role=alertdialog]') && !!document.querySelector('[data-banner=all-off]');")));

  // ── PUT 失败：开关不动 ──
  await ctl({ failPut: "Could not save (mock)." });
  from = (await mockLog()).length;
  await evaluate("$sw('operation_report_notify').click();");
  await waitFor("$card('operation_report_notify').querySelector('[role=alertdialog]')");
  await evaluate("$btnIn($card('operation_report_notify'), 'Turn on').click();");
  await waitFor("$card('operation_report_notify').textContent.includes('Not changed: Could not save (mock).')");
  check("PUT 失败：写出原因，开关仍是关，黄条还在", await evaluate("return $sw('operation_report_notify').getAttribute('aria-checked') === 'false' && !!document.querySelector('[data-banner=all-off]');"));
  await ctl({ failPut: "" });

  // ── 周三排班确认：开关走 notification-switches，发送时刻走 schedule-confirm ──
  from = (await mockLog()).length;
  await evaluate("$sw('schedule_confirm').click();");
  await waitFor("$card('schedule_confirm').querySelector('[role=alertdialog]')");
  await evaluate("$btnIn($card('schedule_confirm'), 'Turn on').click();");
  await waitFor("$sw('schedule_confirm').getAttribute('aria-checked') === 'true'");
  puts = await since(from, isPut);
  check("周三确认打开：PUT notification-switches {switches:{schedule_confirm:true}}，没有单独写 schedule-confirm", puts.length === 1 && JSON.stringify(puts[0].body) === '{"switches":{"schedule_confirm":true}}' && (await since(from, isScPut)).length === 0);
  check("没改时间时没有 Save time 键", await evaluate("return !$btnIn($card('schedule_confirm'), 'Save time');"));
  await evaluate("$setValue($card('schedule_confirm').querySelector('input[type=time]'), '10:30');");
  await waitFor("$btnIn($card('schedule_confirm'), 'Save time')");
  from = (await mockLog()).length;
  await evaluate("$btnIn($card('schedule_confirm'), 'Save time').click();");
  await waitFor("!$btnIn($card('schedule_confirm'), 'Save time')");
  let scPuts = await since(from, isScPut);
  check("改时间：Save time（蓝色提交键）→ PUT schedule-confirm 带新时间并保持开着", scPuts.length === 1 && JSON.stringify(scPuts[0].body) === '{"enabled":true,"weekday":"wed","time":"10:30"}' && (await evaluate("return $sw('schedule_confirm').getAttribute('aria-checked') === 'true' && $card('schedule_confirm').querySelector('input[type=time]').value === '10:30';")));
  await ctl({ failScPut: "time: use a 24-hour time like 09:00." });
  await evaluate("$setValue($card('schedule_confirm').querySelector('input[type=time]'), '11:00');");
  await waitFor("$btnIn($card('schedule_confirm'), 'Save time')");
  await evaluate("$btnIn($card('schedule_confirm'), 'Save time').click();");
  await waitFor("$card('schedule_confirm').textContent.includes('Time not saved: time: use a 24-hour time')");
  check("改时间失败：原因写在卡片里，开关仍开", await evaluate("return $sw('schedule_confirm').getAttribute('aria-checked') === 'true';"));
  await ctl({ failScPut: "" });
  await evaluate("$sw('schedule_confirm').click();");
  await waitFor("$sw('schedule_confirm').getAttribute('aria-checked') === 'false'");
  check("周三确认关闭：不用确认，直接 PUT schedule_confirm:false", (await since(from, isPut)).some((e) => e.body.switches.schedule_confirm === false));

  // ── 定时自动发送开着：绿条里算上 ──
  await ctl({ reset: true, autoSendOn: true });
  await open();
  check("定时自动发送真实状态：Tour confirmations: On，顶上绿条算上它", await evaluate("const c = $card('auto_send'); const b = document.querySelector('[data-banner=some-on]'); return c.textContent.includes('Tour confirmations: On') && !!b && b.textContent.includes('1 of 4') && b.textContent.includes('Scheduled auto-send');"));

  // ── 后端以后返回 trigger / recipients / sample：优先用后端的 ──
  await ctl({ reset: true, serverText: true, autoSendOn: false });
  await open();
  check("后端返回了 trigger / recipients / sample：用后端的，不用前端兜底文案", await evaluate("const c = $card('daily_task_reminders'); c.querySelector('summary').click(); return c.textContent.includes('SERVER TRIGGER') && c.textContent.includes('SERVER RECIPIENTS') && c.textContent.includes('SERVER SAMPLE') && !c.textContent.includes('Task due in 30 minutes');"));

  // ── 开关读不出来（readable:false）──
  await ctl({ reset: true, serverText: false, unreadable: true });
  await open();
  check("readable:false：提示读不出来、全部按关处理", await evaluate("return !!document.querySelector('[data-unreadable]') && !!document.querySelector('[data-banner=all-off]');"));
  await ctl({ unreadable: false });

  // ── 未接线 / 未知项不崩 ──
  await ctl({ reset: true, extras: true });
  await open();
  check("未接线的项：标 Not connected yet，没有可点的开关；页面不崩", await evaluate("const c = $card('future_thing'); return !!c && c.textContent.includes('Not connected yet') && !$sw('future_thing') && !c.querySelector('[data-state=on]');"));
  check("未接线的项即使后端说 enabled:true 也不算开着（黄条还在）", await evaluate("return !!document.querySelector('[data-banner=all-off]');"));
  check("只带最少字段、sample 是纯字符串的未知项：显示名称，Details 里是 sample 文字；can_edit 缺省当不能改（写 Only a Super Admin…）", await evaluate("const c = $card('mystery'); c.querySelector('summary').click(); return !!c && c.textContent.includes('Mystery notification') && c.textContent.includes('Plain string sample') && $sw('mystery').disabled && c.textContent.includes('Only a Super Admin can change this one.');"));
  check("别的卡还正常", await evaluate("return !!$card('daily_task_reminders') && !!$card('auto_send');"));

  // ── 普通 admin ──
  await ctl({ reset: true, role: "admin", extras: false });
  from = (await mockLog()).length;
  await open();
  check("普通 admin：没有定时自动发送卡，只有 3 张卡，黄条写 All 3", (await evaluate("return $keys().join(',');")) === "daily_task_reminders,operation_report_notify,schedule_confirm" && (await evaluate("return document.querySelector('[data-banner=all-off]').textContent.includes('All 3 automatic notifications are OFF.');")));
  check("普通 admin：不请求 auto-send（该接口对他 403）", (await since(from, (e) => e.path === "/api/settings/auto-send")).length === 0);
  check("普通 admin：所有开关都是灰的（只有 Super Admin 能改），每张卡写 Only a Super Admin can change this one.，周三确认的时间框也灰", await evaluate("const ks = ['daily_task_reminders', 'operation_report_notify', 'schedule_confirm']; return ks.every((k) => $sw(k).disabled && $card(k).textContent.includes('Only a Super Admin can change this one.')) && $card('schedule_confirm').querySelector('input[type=time]').disabled;"));
  check("普通 admin：点灰开关什么都不会发生（没有确认框、没有 PUT）", await (async () => { const f = (await mockLog()).length; await evaluate("$sw('daily_task_reminders').click();"); await sleep(200); return !(await evaluate("return !!document.querySelector('[role=alertdialog]');")) && (await since(f, isPut)).length === 0; })());

  // ── 侧栏入口（admin 看得到 Notifications） ──
  const nav = "document.querySelector('nav[aria-label=Main]')";
  await waitFor(`${nav} && ${nav}.querySelector('button[aria-label="Open menu"]')`);
  await evaluate(`${nav}.querySelector('button[aria-label="Open menu"]').click();`);
  await waitFor(`${nav}.dataset.state === 'open' && [...${nav}.querySelectorAll('a')].some(a => a.textContent === 'Notifications')`);
  check("侧栏 Settings 里有 Notifications → /settings/notifications，且是当前页", await evaluate(`const a = [...${nav}.querySelectorAll('a')].find(a => a.textContent === 'Notifications'); return a?.getAttribute('href') === '/settings/notifications' && a.getAttribute('aria-current') === 'page';`));
  check("顶栏页面名 Notifications", await evaluate("return document.querySelector('header').textContent.includes('Notifications');"));

  // ── 员工 ──
  await ctl({ reset: true, role: "staff" });
  from = (await mockLog()).length;
  await open();
  check("员工：Admin access required，不请求开关接口", (await evaluate("return document.body.textContent.includes('Admin access required') && !$keys().length;")) && (await since(from, (e) => e.path.startsWith("/api/settings/") && e.path !== "/api/settings/dashboard-widgets")).length === 0);

  // ── 401 ──
  await ctl({ reset: true, role: "superadmin", fail401: true });
  await goto(`${APP}/settings/notifications`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页（带 next）", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false, reset: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
