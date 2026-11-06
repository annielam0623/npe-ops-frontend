// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Settings → Auto Send（/settings/auto-send，后端 auto-send G76）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9333;

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

// 页面里用的小工具（每次导航后重新注入）。
const HELPERS = `
window.$q = (s, root=document) => root.querySelector(s);
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$dialog = () => document.querySelector('[role=dialog]');
window.$switch = (root) => (root ?? document).querySelector('button[role=switch][data-auto-switch]');
window.$tour = () => document.querySelector('section[aria-label="Tour confirmations"]');
window.$tix = () => document.querySelector('section[aria-label="Ticket reminders"]');
window.$save = (card) => [...card.querySelectorAll('button')].find(b => ['Save', 'Saving…'].includes(b.textContent.trim()));
window.$status = (card) => card.querySelector('[role=status]')?.textContent.trim() ?? '';
window.$times = (card) => [...card.querySelectorAll('[data-time]')].map(c => c.dataset.time).join(',');
window.$emails = (card) => [...card.querySelectorAll('[data-email]')].map(c => c.dataset.email).join(',');
window.$setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$run = (key) => { const tr = document.querySelector('tr[data-run="' + key + '"]'); return tr ? [...tr.children].map(td => td.textContent.trim()) : null; };
window.$runRed = (key) => document.querySelector('tr[data-run="' + key + '"]').children[3].className.includes('text-[#b91c1c]');
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage() {
  await goto(`${APP}/settings/auto-send`);
  await waitFor("document.querySelector('button[role=switch][data-auto-switch]') || document.body.textContent.includes('Admin access required') || document.body.textContent.includes('Could not load')");
  await helpers();
}
const isPut = (e) => e.path === "/api/settings/auto-send" && e.method === "PUT";
const isGet = (e) => e.path === "/api/settings/auto-send" && e.method === "GET";

// 新后端（as-mock V3_CONFIG 一样）。
const V3_TOUR = { enabled: false, times: ["07:00", "18:00"], days_before: 3, alert_emails: ["ops@example.com"], last_minute_cutoff: "15:00", max_per_batch: 100, template_regular: "tour_confirmation", template_last_minute: "last_minute" };
const V3_TICKETS = { enabled: false, times: ["09:00", "12:00", "17:00"], days_before: 5, max_per_batch: 150, lead_groups: [{ days_before: 3, ticket_types: ["lower"] }], daily_report: { enabled: false, emails: ["antelope@nationalparkexpress.com"] } };
const DEFAULT_TICKETS = { enabled: false, times: ["10:00"], days_before: 3, summary_time: "17:00", summary_emails: ["tickets@example.com"] };

/**
 * 同页面每张卡自己的 nextRun（洛杉矶时间；2026-10-16 两个开关拆开后，每张卡只看自己这节的时间）；
 * 分钟边界上前后各算一次，两个都算对。summaryTime 只有 Tickets 卡传。
 */
function expectedNext(times, summaryTime, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(at);
  const now = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
  const mins = (t) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  const clock = (t) => { const h = Number(t.split(":")[0]); return `${h % 12 || 12}:${t.split(":")[1]} ${h < 12 ? "AM" : "PM"}`; };
  const all = [
    ...times.map((t) => ({ t, label: undefined })),
    ...(summaryTime ? [{ t: summaryTime, label: "summary" }] : []),
  ].sort((a, b) => mins(a.t) - mins(b.t));
  const today = all.find((x) => mins(x.t) > now);
  const pick = today ?? all[0];
  return `Next: ${today ? "today" : "tomorrow"} ${clock(pick.t)}${pick.label ? ` · ${pick.label}` : ""}`;
}
const NEXT_RE = /^Next: (today|tomorrow) \d{1,2}:\d{2} (AM|PM)( · summary)?$/;

async function run() {
  // ── G203 第二批：页面最底的 Action Log（共用读接口 /api/settings/auto-send/action-log）──
  await goto(`${APP}/settings/auto-send`);
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'))", 60000);
  {
    const alBefore = (await mockLog()).length;
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
    await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length === 2", 20000);
    const alReqs = (await mockLog()).slice(alBefore).filter((e) => e.path === "/api/settings/auto-send/action-log");
    check("G203 Action Log：页面最底，展开才请求 /api/settings/auto-send/action-log、显示 2 行", alReqs.length === 1 && (await evaluate("return document.querySelectorAll('[data-action-log] tbody tr').length;")) === 2, JSON.stringify(alReqs));
  }
  await ctl({ reset: true, fail401: false, staff: false, unreadable: false, failPut: "", slowPut: 0, runs: "default", failGet: false });
  let from = (await mockLog()).length;
  await openPage();

  // ── 打开：admin 检查、开关、两张卡片 ──
  check("先拉 /api/me 再拉 /api/settings/auto-send", await (async () => { const l = (await mockLog()).slice(from); const me = l.findIndex((e) => e.path === "/api/me"); const g = l.findIndex(isGet); return me >= 0 && g > me; })());
  check("顶栏页面名 Auto Send；页内重复的标题不占位（只留给读屏，Annie 2026-10-19）", await evaluate("const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent === '⏱️ Auto Send'); const r = h && h.getBoundingClientRect(); return document.querySelector('header').textContent.includes('Auto Send') && !!r && r.width <= 1 && r.height <= 1;"), await evaluate("return document.querySelector('header')?.textContent;"));
  check("Tour 关着：switch aria-checked=false、写 OFF、没有 Next", await evaluate("const s = $switch($tour()); return s.getAttribute('aria-checked') === 'false' && s.textContent.includes('OFF') && !$tour().querySelector('[data-next-run]');"));
  check("Tickets 关着：switch aria-checked=false、写 OFF、没有 Next", await evaluate("const s = $switch($tix()); return s.getAttribute('aria-checked') === 'false' && s.textContent.includes('OFF') && !$tix().querySelector('[data-next-run]');"));
  check("读得出来：没有黄条", await evaluate("return !document.querySelector('[data-unreadable]');"));
  check("Tour confirmations 卡片：时间 09:00 / 18:00（带 9:00 AM / 6:00 PM）、提前 2 天、跳过的单发给 ops@example.com", await evaluate("const c = $tour(); return $times(c) === '09:00,18:00' && c.querySelector('[data-time=\"09:00\"]').textContent.includes('9:00 AM') && c.querySelector('[data-time=\"18:00\"]').textContent.includes('6:00 PM') && $q('#tour-days').value === '2' && $emails(c) === 'ops@example.com';"), await evaluate("return $tour()?.textContent;"));
  check("Ticket reminders 卡片：时间 10:00、提前 3 天、汇总 17:00、汇总发给 tickets@example.com", await evaluate("const c = $tix(); return $times(c) === '10:00' && $q('#tickets-days').value === '3' && $q('#tickets-summary-time').value === '17:00' && $emails(c) === 'tickets@example.com';"));
  check("没改动：两个 Save 都不能点", await evaluate("return $save($tour()).disabled && $save($tix()).disabled;"));
  check("How to use 写了各自开关、tour type 要在 Products 配、Send anyway", await evaluate("const d = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Auto Send')); return !!d && d.textContent.includes('each have their own switch, off until you turn it on') && d.textContent.includes('Each bus product needs a tour type in Settings → Products') && d.textContent.includes('Send anyway');"));

  // ── 最近的批次 ──
  check("记录表头 Started / What / Status / Result", await evaluate("return [...document.querySelectorAll('section[aria-label=\"Recent runs\"] thead th')].map(th => th.textContent).join('|') === 'Started|What|Status|Result';"));
  let r = await evaluate("return $run('tour:2026-10-15T18:00');");
  check("团确认 done：Oct 15, 6:00 PM（洛杉矶）· Tour confirmations · Done · 12 sent · 2 skipped", JSON.stringify(r) === JSON.stringify(["Oct 15, 6:00 PM", "Tour confirmations", "Done", "12 sent · 2 skipped"]), JSON.stringify(r));
  r = await evaluate("return $run('tickets:2026-10-15T10:00');");
  check("门票提醒 done：4 sent · 5 not ready (no Cfm #)", r?.[1] === "Ticket reminders" && r?.[2] === "Done" && r?.[3] === "4 sent · 5 not ready (no Cfm #)", JSON.stringify(r));
  r = await evaluate("return $run('tickets_summary:2026-10-14:sent');");
  check("汇总 sent：Emailed · 3 not sent yet for the day", r?.[1] === "Ticket summary email" && r?.[3] === "Emailed · 3 not sent yet for the day", JSON.stringify(r));
  check("汇总 email_failed：红字 The summary email could not be sent", (await evaluate("return $run('tickets_summary:2026-10-13:email_failed')[3];")) === "The summary email could not be sent" && (await evaluate("return $runRed('tickets_summary:2026-10-13:email_failed');")));
  check("汇总 no_tickets：No tickets that day（不红）", (await evaluate("return $run('tickets_summary:2026-10-12:no_tickets')[3];")) === "No tickets that day" && !(await evaluate("return $runRed('tickets_summary:2026-10-12:no_tickets');")));
  check("汇总其他状态：Already emailed", (await evaluate("return $run('tickets_summary:2026-10-11:already')[3];")) === "Already emailed");
  r = await evaluate("return $run('tour:2026-10-11T09:00');");
  check("failed：Status Failed、Result 红字写 summary.error", r?.[2] === "Failed" && r?.[3] === "Database is not reachable (mock)." && (await evaluate("return $runRed('tour:2026-10-11T09:00');")), JSON.stringify(r));
  r = await evaluate("return $run('tour:2026-10-10T18:00');");
  check("off：Status Off、Auto-send was off", r?.[2] === "Off" && r?.[3] === "Auto-send was off", JSON.stringify(r));
  r = await evaluate("return $run('tickets:2026-10-10T10:00');");
  check("running（没超时）：Status Running、Result Sending…（不红）", r?.[2] === "Running" && r?.[3] === "Sending…" && !(await evaluate("return $runRed('tickets:2026-10-10T10:00');")), JSON.stringify(r));
  r = await evaluate("return $run('tour:2026-10-09T09:00');");
  check("running 超过 2 小时（stale）：Status Stuck、红字 Started over 2 hours ago…", r?.[2] === "Stuck" && r?.[3].startsWith("Started over 2 hours ago") && (await evaluate("return $runRed('tour:2026-10-09T09:00');")), JSON.stringify(r));
  check("记录按接口的顺序（新的在前）、10 行", (await evaluate("return [...document.querySelectorAll('tr[data-run]')].map(tr => tr.dataset.run);")).length === 10 && (await evaluate("return document.querySelector('tr[data-run]').dataset.run;")) === "tour:2026-10-15T18:00");

  // ── 侧栏：Settings 下有 Auto Send（Products 和 Content Studio 中间），当前页高亮 ──
  const nav = "document.querySelector('nav[aria-label=Main]')";
  await waitFor(`${nav} && ${nav}.querySelector('button[aria-label="Open menu"]')`);
  await evaluate(`${nav}.querySelector('button[aria-label="Open menu"]').click();`);
  await waitFor(`${nav}.dataset.state === 'open' && [...${nav}.querySelectorAll('a')].some(a => a.textContent === 'Auto Send')`);
  check("侧栏 Settings：有 Auto Send → /settings/auto-send，排在 Products 和 Content Studio 中间", await evaluate(`const names = [...${nav}.querySelectorAll('a')].map(a => a.textContent); const a = [...${nav}.querySelectorAll('a')].find(a => a.textContent === 'Auto Send'); return a?.getAttribute('href') === '/settings/auto-send' && names.indexOf('Products') < names.indexOf('Auto Send') && names.indexOf('Auto Send') < names.indexOf('Content Studio');`), await evaluate(`return [...${nav}.querySelectorAll('a')].map(a => a.textContent + '=' + a.getAttribute('href')).join(' | ');`));
  check("侧栏：Auto Send 是当前页", await evaluate(`return [...${nav}.querySelectorAll('[aria-current=page]')].some(a => a.textContent === 'Auto Send');`), await evaluate(`return [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent).join('|');`));
  await goto(`${APP}/settings/auto-send`);
  await waitFor("document.querySelector('button[role=switch][data-auto-switch]')");
  await helpers();

  // ── Tour 卡片：时间 ──
  const tourTime = "$q('#tour-times')";
  check("时间框空着：+ Add time 不能点", await evaluate("return $btn('+ Add time', $tour()).disabled;"));
  await evaluate(`$setValue(${tourTime}, '18:00');`);
  await sleep(100);
  check("已有的时间（18:00）：+ Add time 不能点", await evaluate("return $btn('+ Add time', $tour()).disabled;"));
  await evaluate(`$setValue(${tourTime}, '07:30');`);
  await sleep(100);
  check("新时间：+ Add time 能点", await evaluate("return !$btn('+ Add time', $tour()).disabled;"));
  await evaluate("$btn('+ Add time', $tour()).click();");
  await sleep(100);
  check("加了 07:30：按时间排序、框清空、Save 能点", await evaluate(`return $times($tour()) === '07:30,09:00,18:00' && ${tourTime}.value === '' && !$save($tour()).disabled;`), await evaluate("return $times($tour());"));
  await evaluate("$q('button[aria-label=\"Remove 18:00\"]', $tour()).click();");
  await sleep(100);
  check("Remove 18:00：只剩 07:30,09:00", (await evaluate("return $times($tour());")) === "07:30,09:00");
  await evaluate("$setValue($q('#tour-days'), '4');");
  await sleep(100);
  // ── Tour 卡片：邮箱 ──
  const tourMail = "$q('#tour-alerts')";
  await evaluate(`$setValue(${tourMail}, 'not-an-email');`);
  await sleep(100);
  check("不像邮箱：+ Add email 不能点", await evaluate("return $btn('+ Add email', $tour()).disabled;"));
  await evaluate(`$setValue(${tourMail}, ' OPS@Example.com ');`);
  await sleep(100);
  check("已有的（不分大小写、去空格）：+ Add email 不能点", await evaluate("return $btn('+ Add email', $tour()).disabled;"));
  await evaluate(`$setValue(${tourMail}, ' New.Person@Example.com ');`);
  await sleep(100);
  await evaluate(`${tourMail}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await sleep(100);
  check("回车加邮箱：去空格、转小写、框清空", await evaluate(`return $emails($tour()) === 'ops@example.com,new.person@example.com' && ${tourMail}.value === '';`), await evaluate("return $emails($tour());"));
  await evaluate(`$setValue(${tourMail}, 'zz@test.co');`);
  await sleep(100);
  await evaluate("$btn('+ Add email', $tour()).click();");
  await sleep(100);
  check("点 + Add email 也能加", (await evaluate("return $emails($tour());")) === "ops@example.com,new.person@example.com,zz@test.co");
  await evaluate("$q('button[aria-label=\"Remove zz@test.co\"]', $tour()).click();");
  await sleep(100);
  check("Remove 邮箱", (await evaluate("return $emails($tour());")) === "ops@example.com,new.person@example.com");
  // Tickets 卡片也改一点、不存：存 Tour 时不能带上。
  await evaluate("$setValue($q('#tickets-days'), '5');");
  await sleep(100);
  check("Tickets 卡片改了：它自己的 Save 能点", await evaluate("return !$save($tix()).disabled;"));

  // ── 存 Tour 卡片：PUT 整份（已存的 + 只换 tour 部分），Saving… → Saved.，存完重拉 ──
  await ctl({ slowPut: 700 });
  from = (await mockLog()).length;
  await evaluate("$save($tour()).click();");
  await sleep(200);
  check("保存中：按钮写 Saving…、不能点", await evaluate("const b = $save($tour()); return b.textContent.trim() === 'Saving…' && b.disabled;"));
  await waitFor("$status($tour()) === 'Saved.'");
  await ctl({ slowPut: 0 });
  let puts = await since(from, isPut);
  // 字段在前、enabled 在后——跟组件 save() 拼 body 的顺序一致（{...draft, enabled}），JSON.stringify 比较要对得上。
  const savedTour = { times: ["07:30", "09:00"], days_before: 4, alert_emails: ["ops@example.com", "new.person@example.com"], enabled: false };
  check("存 Tour：PUT 整份，tour 换成卡片上的字段（enabled 照已存的 false）、tickets 是已存的（不带 Tickets 卡片没存的 5 天）", puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ tour: savedTour, tickets: DEFAULT_TICKETS }), JSON.stringify(puts.map((e) => e.body)));
  check("存好：写 Saved.、Save 又不能点", await evaluate("return $status($tour()) === 'Saved.' && $save($tour()).disabled;"));
  await waitFor("true", 300);
  check("存好后重拉一次设置（记录跟着刷新）", (await since(from, isGet)).length >= 1);
  check("Tickets 卡片没存的改动还在（5 天、Save 能点）", await evaluate("return $q('#tickets-days').value === '5' && !$save($tix()).disabled;"));

  // ── 存 Tickets 卡片：400 写原话；再存成功 ──
  await ctl({ failPut: "Send the summary to: add at least one address." });
  from = (await mockLog()).length;
  await evaluate("$save($tix()).click();");
  await waitFor("$status($tix()).includes('at least one address')");
  check("400：卡片上写服务端原话、Save 还能点、改动还在", await evaluate("return $status($tix()) === 'Send the summary to: add at least one address.' && !$save($tix()).disabled && $q('#tickets-days').value === '5';"), await evaluate("return $status($tix());"));
  check("400：不重拉", (await since(from, isGet)).length === 0);
  await ctl({ failPut: "" });
  await evaluate("$setValue($q('#tickets-summary-time'), '16:30');");
  await evaluate("$setValue($q('#tickets-times'), '14:00');");
  await sleep(100);
  await evaluate("$btn('+ Add time', $tix()).click();");
  await sleep(100);
  from = (await mockLog()).length;
  await evaluate("$save($tix()).click();");
  await waitFor("$status($tix()) === 'Saved.'");
  puts = await since(from, isPut);
  const savedTickets = { times: ["10:00", "14:00"], days_before: 5, summary_time: "16:30", summary_emails: ["tickets@example.com"], enabled: false };
  check("存 Tickets：PUT 整份，tour 是刚存好的、只换 tickets 字段（enabled 照已存的 false）", puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ tour: savedTour, tickets: savedTickets }), JSON.stringify(puts.map((e) => e.body)));
  check("存 Tickets 后 Tour 卡片照旧（Saved. 是 Tour 自己的上一次）", await evaluate("return $times($tour()) === '07:30,09:00' && $save($tour()).disabled;"));

  // ── 开关拆成两个（2026-10-16），各自标题区、各自确认：先测 Tour 的——先确认；Cancel 不发；
  //    确认 = 已存的整份字段 + 这一节的 enabled 翻过来（Tour 卡片没存的草稿不带、也不会被冲掉）──
  await evaluate(`$setValue(${tourTime}, '20:00');`);
  await sleep(100);
  await evaluate("$btn('+ Add time', $tour()).click();");
  await sleep(100);
  await evaluate("$switch($tour()).click();");
  await waitFor("$dialog()");
  check("点 Tour 开关：弹确认 Turn on tour confirmations?、按钮 Turn on", await evaluate("return $dialog().textContent.includes('Turn on tour confirmations?') && !!$btn('Turn on', $dialog());"));
  from = (await mockLog()).length;
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  await sleep(200);
  check("Cancel：不发请求、Tour 还是 OFF、Tickets 没受影响（还是 OFF）", (await since(from, isPut)).length === 0 && (await evaluate("return $switch($tour()).getAttribute('aria-checked') === 'false' && $switch($tix()).getAttribute('aria-checked') === 'false';")));
  await evaluate("$switch($tour()).click();");
  await waitFor("$dialog()");
  from = (await mockLog()).length;
  await evaluate("$btn('Turn on', $dialog()).click();");
  await waitFor("!$dialog() && $switch($tour()).getAttribute('aria-checked') === 'true'");
  puts = await since(from, isPut);
  check("Turn on Tour：PUT 已存的整份字段、只把 tour.enabled 改成 true（不带 Tour 卡片没存的 20:00、tickets 照旧）", puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ tour: { ...savedTour, enabled: true }, tickets: savedTickets }), JSON.stringify(puts.map((e) => e.body)));
  check("Tour 开了：aria-checked=true、写 ON；Tickets 仍是 OFF（两个开关互不影响）", await evaluate("const t = $switch($tour()); const k = $switch($tix()); return t.getAttribute('aria-checked') === 'true' && t.textContent.includes('ON') && k.getAttribute('aria-checked') === 'false';"));
  const before = expectedNext(savedTour.times);
  const next = await evaluate("return $tour().querySelector('[data-next-run]')?.textContent;");
  const after = expectedNext(savedTour.times);
  check("Tour 开着：卡片里写下一批（洛杉矶时间）Next: today|tomorrow h:mm AM/PM，没有 summary 字样（那是 Tickets 的）", NEXT_RE.test(next || "") && !/summary/.test(next || "") && [before, after].includes(next), `${next} / 期望 ${before} 或 ${after}`);
  check("开关存完：Tour 卡片没存的 20:00 还在、Save 能点（开关没有冲掉字段草稿）", await evaluate("return $times($tour()) === '07:30,09:00,20:00' && !$save($tour()).disabled;"));
  await evaluate("$q('button[aria-label=\"Remove 20:00\"]', $tour()).click();");
  await sleep(100);

  // ── 关 Tour：400 留在弹窗里写原因；再确认关掉 ──
  await evaluate("$switch($tour()).click();");
  await waitFor("$dialog()");
  check("Tour 开着时点开关：Turn off tour confirmations?、按钮 Turn off", await evaluate("return $dialog().textContent.includes('Turn off tour confirmations?') && !!$btn('Turn off', $dialog());"));
  await ctl({ failPut: "Auto-send could not be saved (mock)." });
  await evaluate("$btn('Turn off', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[role=alert]')");
  check("关不上（400）：弹窗留着写原因、还是 ON", await evaluate("return $dialog().querySelector('[role=alert]').textContent === 'Auto-send could not be saved (mock).' && $switch($tour()).getAttribute('aria-checked') === 'true';"));
  await ctl({ failPut: "" });
  from = (await mockLog()).length;
  await evaluate("$btn('Turn off', $dialog()).click();");
  await waitFor("!$dialog() && $switch($tour()).getAttribute('aria-checked') === 'false'");
  puts = await since(from, isPut);
  check("Turn off Tour：PUT tour.enabled false、其他照已存的；Tour 卡片没有 Next", puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ tour: savedTour, tickets: savedTickets }) && (await evaluate("return !$tour().querySelector('[data-next-run]') && $switch($tour()).textContent.includes('OFF');")), JSON.stringify(puts.map((e) => e.body)));

  // ── Tickets 自己的开关：确认 = 已存的整份字段 + tickets.enabled 翻过来，不碰 tour（两个开关各自独立）──
  await evaluate("$switch($tix()).click();");
  await waitFor("$dialog()");
  check("点 Tickets 开关：弹确认 Turn on ticket reminders?", await evaluate("return $dialog().textContent.includes('Turn on ticket reminders?');"));
  from = (await mockLog()).length;
  await evaluate("$btn('Turn on', $dialog()).click();");
  await waitFor("!$dialog() && $switch($tix()).getAttribute('aria-checked') === 'true'");
  puts = await since(from, isPut);
  check("Turn on Tickets：PUT tour 照已存的（还是关着）、只把 tickets.enabled 改成 true", puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ tour: savedTour, tickets: { ...savedTickets, enabled: true } }), JSON.stringify(puts.map((e) => e.body)));
  check("Tickets 开了、Tour 还是关着（两个开关互不影响）", await evaluate("return $switch($tix()).getAttribute('aria-checked') === 'true' && $switch($tour()).getAttribute('aria-checked') === 'false';"));
  const tixNext = await evaluate("return $tix().querySelector('[data-next-run]')?.textContent;");
  check("Tickets 开着：下一批带 summary（算进了汇总邮件的时间）", NEXT_RE.test(tixNext || "") && [expectedNext(savedTickets.times, savedTickets.summary_time), expectedNext(savedTickets.times, savedTickets.summary_time)].includes(tixNext), tixNext);
  from = (await mockLog()).length;
  await evaluate("$switch($tix()).click();");
  await waitFor("$dialog()");
  await evaluate("$btn('Turn off', $dialog()).click();");
  await waitFor("!$dialog() && $switch($tix()).getAttribute('aria-checked') === 'false'");
  puts = await since(from, isPut);
  check("Turn off Tickets：PUT tickets.enabled false、tour 不受影响", puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ tour: savedTour, tickets: savedTickets }), JSON.stringify(puts.map((e) => e.body)));

  // ── 下一批固定可算：所有时间都是 00:00 ⇒ 永远是明天 12:00 AM ──
  await ctl({ config: { tour: { enabled: true, times: ["00:00"], days_before: 1, alert_emails: [] }, tickets: { enabled: false, times: ["00:00"], days_before: 1, summary_time: "00:00", summary_emails: [] } } });
  await openPage();
  check("所有时间 00:00：Tour 卡片写 Next: tomorrow 12:00 AM（没有 summary）", (await evaluate("return $tour().querySelector('[data-next-run]')?.textContent;")) === "Next: tomorrow 12:00 AM", await evaluate("return $tour().querySelector('[data-next-run]')?.textContent;"));

  // ── 库里的设置读不出来：黄条、两个开关都按关显示；保存一次就好 ──
  await ctl({ reset: true, unreadable: true, config: { tour: { ...savedTour, enabled: true }, tickets: { ...savedTickets, enabled: true } } });
  await openPage();
  check("readable:false：黄条写读不出来、按关处理", await evaluate("const b = document.querySelector('[data-unreadable]'); return !!b && b.textContent.includes('Settings could not be read, so auto-send is treated as off. Save once to fix it.');"));
  check("readable:false：两个开关都显示 OFF（存的其实是 true）", await evaluate("return $switch($tour()).getAttribute('aria-checked') === 'false' && $switch($tix()).getAttribute('aria-checked') === 'false' && !document.querySelector('[data-next-run]');"));
  await evaluate("$switch($tour()).click();");
  await waitFor("$dialog()");
  check("readable:false 点 Tour 开关：问 Turn on tour confirmations?", await evaluate("return $dialog().textContent.includes('Turn on tour confirmations?');"));
  from = (await mockLog()).length;
  await evaluate("$btn('Turn on', $dialog()).click();");
  await waitFor("!$dialog() && $switch($tour()).getAttribute('aria-checked') === 'true'");
  puts = await since(from, isPut);
  check("存一次：PUT tour.enabled true、黄条消失、Tour ON", puts.length === 1 && puts[0].body.tour.enabled === true && (await evaluate("return !document.querySelector('[data-unreadable]');")), JSON.stringify(puts.map((e) => e.body)));

  // ── G258 / G259 新后端（置顶 89；0f task/auto-send-limits，49 转字段 2026-11-06）──
  await openPage();
  check("旧后端：不出模板两行、Max per batch、按门票团、Daily report；Day-before summary 照旧", await evaluate("return !$q('[data-field=tour-templates]') && !$q('#tour-max') && !$q('#tickets-max') && !$q('[data-lead-groups]') && !$q('[data-daily-report]') && !!$q('#tickets-summary-time') && !$q('[data-howto-last-minute]');"));
  await ctl({ v3: true });
  from = (await mockLog()).length;
  await openPage();
  await waitFor("$q('[data-field=tour-templates]')");
  await evaluate(`window.$pick = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };`);
  check("新后端：Tour 卡片 Max per batch 100", (await evaluate("return $q('#tour-max')?.value;")) === "100");
  check("G258：两行模板下拉，选项照 tour_templates（Tour confirmation / Last Minute），值照 config", await evaluate("const r = $q('#tour-template-regular'), l = $q('#tour-template-last-minute'); return [...r.options].map(o => o.textContent).join('|') === 'Tour confirmation|Last Minute' && r.value === 'tour_confirmation' && l.value === 'last_minute';"), await evaluate("return $q('[data-field=tour-templates]')?.textContent;"));
  check("G258：两行的名字 Orders before the cutoff / Orders after the cutoff", await evaluate("const t = $q('[data-field=tour-templates]').textContent; return t.includes('Message template') && t.includes('Orders before the cutoff') && t.includes('Orders after the cutoff');"));
  check("G258：说明写 cutoff 时间（15:00 ⇒ 3:00 PM the day before）、每小时整点、11:59 PM the day before", await evaluate("const t = $q('[data-template-note]').textContent; return t.includes('after 3:00 PM the day before the tour') && t.includes('every hour on the hour') && t.includes('the last check is at 11:59 PM the day before the tour.');"), await evaluate("return $q('[data-template-note]')?.textContent;"));
  check("G259：Tickets 卡片不出 Day-before summary 两格，Max per batch 150", await evaluate("return !$q('#tickets-summary-time') && !$q('[data-field=tickets-summary]') && $q('#tickets-max').value === '150';"));
  check("G259：门票团名字读 GET 里的 ticket_types（Lower Antelope 胶囊），不再另读 /api/settings/tix-tour-types", (await evaluate("return $q('[data-type-chip=lower]')?.textContent.includes('Lower Antelope');")) && (await since(from, (e) => e.path === "/api/settings/tix-tour-types")).length === 0);
  check("G259：没挑的团灰字列默认（5 days）", (await evaluate("return $q('[data-lead-default]')?.textContent;")) === "Using the default (5 days): Upper Antelope, Horseshoe Bend, Canyon X.", await evaluate("return $q('[data-lead-default]')?.textContent;"));
  check("G259：Daily report 收件人 antelope@nationalparkexpress.com", (await evaluate("return $emails($q('[data-daily-report]'));")) === "antelope@nationalparkexpress.com");
  check("G258：How to use 有 Message template 那一条（最后一次 11:59 PM the day before，没有 12:00 AM on the tour day）", await evaluate("return !!$q('[data-howto-last-minute]') && $q('[data-howto-last-minute]').textContent.includes('Orders after the cutoff') && $q('[data-howto-last-minute]').textContent.includes('the last check is at 11:59 PM the day before the tour') && $q('[data-howto-last-minute]').textContent.includes('Orders placed after 11:59 PM need to be sent by hand on Manifests.') && !document.body.textContent.includes('12:00 AM on the tour day');"));

  // 改 Last Minute 模板 ⇒ Save ⇒ PUT 带两个模板、保留 last_minute_cutoff；tickets 不带不再用的键
  await evaluate("$pick($q('#tour-template-last-minute'), 'tour_confirmation');");
  check("改模板：Save 能点（暂存，没马上存）", (await evaluate("return !$save($tour()).disabled;")) && (await since(from, isPut)).length === 0);
  from = (await mockLog()).length;
  await evaluate("$save($tour()).click();");
  await waitFor("$status($tour()) === 'Saved.'");
  {
    const puts = await since(from, isPut);
    const b = puts[0]?.body;
    check("存 Tour：PUT tour.template_regular=tour_confirmation、template_last_minute=tour_confirmation、last_minute_cutoff 15:00、max_per_batch 100", puts.length === 1 && b.tour.template_regular === "tour_confirmation" && b.tour.template_last_minute === "tour_confirmation" && b.tour.last_minute_cutoff === "15:00" && b.tour.max_per_batch === 100, JSON.stringify(b?.tour));
    check("存 Tour：tickets 不带 summary_time / summary_emails / cfm_alert_emails", puts.length === 1 && !("summary_time" in b.tickets) && !("summary_emails" in b.tickets) && !("cfm_alert_emails" in b.tickets) && b.tickets.daily_report?.emails?.[0] === "antelope@nationalparkexpress.com", JSON.stringify(b?.tickets));
    check("存好：绿字 Saved.", await evaluate("return $status($tour()) === 'Saved.' && $tour().querySelector('[role=status]').className.includes('3B6D11');"), await evaluate("return $tour().querySelector('[role=status]')?.className;"));
  }

  // 前端先挡：不发请求、红字
  await evaluate("$setValue($q('#tour-max'), '0');");
  from = (await mockLog()).length;
  await evaluate("$save($tour()).click();");
  await waitFor("$status($tour()).startsWith('Max per batch')");
  check("Max per batch 0：红字 Max per batch must be a whole number from 1 to 2000.、不发 PUT", (await evaluate("return $status($tour());")) === "Max per batch must be a whole number from 1 to 2000." && (await since(from, isPut)).length === 0, await evaluate("return $status($tour());"));
  await evaluate("$setValue($q('#tour-max'), '2001');");
  await evaluate("$save($tour()).click();");
  await sleep(300);
  check("Max per batch 2001：也挡住", (await evaluate("return $status($tour());")) === "Max per batch must be a whole number from 1 to 2000." && (await since(from, isPut)).length === 0);
  await evaluate("$setValue($q('#tour-max'), '100');");

  await evaluate("$setValue($q('[aria-label=\"Days before, time 1\"]'), '20');");
  from = (await mockLog()).length;
  await evaluate("$save($tix()).click();");
  await waitFor("$status($tix()).startsWith('Start sending')");
  check("按门票团天数 20：红字、不发 PUT", (await evaluate("return $status($tix());")) === "Start sending, by ticket type: days must be a whole number from 1 to 14." && (await since(from, isPut)).length === 0, await evaluate("return $status($tix());"));
  await evaluate("$setValue($q('[aria-label=\"Days before, time 1\"]'), '3');");

  // 加一行、挑 Upper ⇒ Save
  await evaluate("$q('[data-add-lead]').click();");
  await waitFor("$q('[data-lead-row=\"1\"]')");
  check("+ Add another time：新一行，Lower 灰、点不了、写 - 3 days before", await evaluate("const o = [...$q('[data-lead-row=\"1\"] select').options].find(o => o.value === 'lower'); return !!o && o.disabled && o.textContent.includes('- 3 days before');"));
  await evaluate("$setValue($q('[aria-label=\"Days before, time 2\"]'), '7');");
  await evaluate("$pick($q('[data-lead-row=\"1\"] select'), 'upper');");
  from = (await mockLog()).length;
  await evaluate("$save($tix()).click();");
  await waitFor("$status($tix()) === 'Saved.'");
  {
    const puts = await since(from, isPut);
    const t = puts[0]?.body?.tickets;
    check("存 Tickets：lead_groups 两组（3 天 Lower / 7 天 Upper）、max_per_batch 150、不带 summary_*", puts.length === 1 && JSON.stringify(t.lead_groups) === JSON.stringify([{ days_before: 3, ticket_types: ["lower"] }, { days_before: 7, ticket_types: ["upper"] }]) && t.max_per_batch === 150 && !("summary_time" in t) && !("summary_emails" in t), JSON.stringify(t));
  }

  // 同一个团两组（后端 400 原话）
  await ctl({ failPut: "Start sending, by ticket type: a ticket type can be in one time only (lower)." });
  await evaluate("$setValue($q('#tickets-max'), '140');");
  await evaluate("$save($tix()).click();");
  await waitFor("$status($tix()).includes('one time only')");
  check("后端 400（同一个团两组）：红字照原话", (await evaluate("return $status($tix());")) === "Start sending, by ticket type: a ticket type can be in one time only (lower)." && (await evaluate("return $tix().querySelector('[role=status]').className.includes('A32D2D');")), await evaluate("return $tix().querySelector('[role=status]')?.className;"));
  await ctl({ failPut: "" });

  // 20 组上限
  await ctl({ config: { tour: V3_TOUR, tickets: { ...V3_TICKETS, lead_groups: Array.from({ length: 20 }, (_, i) => ({ days_before: (i % 14) + 1, ticket_types: [] })) } } });
  await openPage();
  await waitFor("$q('[data-add-lead]')");
  check("已有 20 个时间：+ Add another time 不能点", await evaluate("return $q('[data-add-lead]').disabled;"));
  await ctl({ v3: true });
  await openPage();
  await waitFor("$q('tr[data-run]')");

  // Recent runs 的新写法
  r = await evaluate("return $run('last_minute|2026-11-06|23:59');");
  check("11:59 PM 那次扫描（run_key …|23:59）：Started Nov 6, 11:59 PM、Last Minute (tours)、2 sent · 0 skipped", r?.[0] === "Nov 6, 11:59 PM" && r?.[1] === "Last Minute (tours)" && r?.[3] === "2 sent · 0 skipped", JSON.stringify(r));
  r = await evaluate("return $run('last_minute|2026-11-06|14:00');");
  check("Last Minute run：What 写 Last Minute (tours)、4 sent · 1 skipped", r?.[1] === "Last Minute (tours)" && r?.[3] === "4 sent · 1 skipped", JSON.stringify(r));
  r = await evaluate("return $run('last_minute|2026-11-06|13:00');");
  check("Last Minute run 提醒邮件没发出：红字 · 2 alert emails failed", r?.[3] === "1 sent · 0 skipped · 2 alert emails failed" && (await evaluate("return $runRed('last_minute|2026-11-06|13:00');")), JSON.stringify(r));
  r = await evaluate("return $run('tickets:2026-11-05T17:00');");
  check("当天最后一批门票带每日报告：· Daily report emailed (3 not sent)", r?.[3] === "40 sent · 2 not ready (no Cfm #) · Daily report emailed (3 not sent)", JSON.stringify(r));
  r = await evaluate("return $run('tickets:2026-11-05T12:00');");
  check("上限挤到下一批：· 12 left for the next batch", r?.[3] === "150 sent · 1 not ready (no Cfm #) · 12 left for the next batch", JSON.stringify(r));
  r = await evaluate("return $run('tickets:2026-11-04T17:00');");
  check("全发了：· Daily report emailed (all sent)", r?.[3] === "9 sent · 0 not ready (no Cfm #) · Daily report emailed (all sent)", JSON.stringify(r));
  r = await evaluate("return $run('tickets:2026-11-03T17:00');");
  check("每日报告发不出：红字 · Daily report could not be emailed", r?.[3] === "5 sent · 0 not ready (no Cfm #) · Daily report could not be emailed" && (await evaluate("return $runRed('tickets:2026-11-03T17:00');")), JSON.stringify(r));
  r = await evaluate("return $run('tour:2026-11-03T07:00');");
  check("Tour 上限挤到下一批：100 sent · 1 skipped · 7 left for the next batch", r?.[3] === "100 sent · 1 skipped · 7 left for the next batch", JSON.stringify(r));
  await ctl({ reset: true, v3: false });

  // ── 没有记录 ──
  await ctl({ runs: "empty" });
  await openPage();
  check("还没有批次：写 Nothing has run yet.、没有表", await evaluate("const s = document.querySelector('section[aria-label=\"Recent runs\"]'); return s.textContent.includes('Nothing has run yet.') && !s.querySelector('table');"));
  await ctl({ runs: "default" });

  // ── 出错 / 权限 / 未登录 ──
  await ctl({ failGet: true });
  await openPage();
  check("设置拉不到（500）：写 Could not load auto-send settings、有 Retry", await evaluate("return document.body.textContent.includes('Could not load auto-send settings') && !!$btn('Retry');"));
  await ctl({ failGet: false });
  await evaluate("$btn('Retry').click();");
  await waitFor("$switch()");
  check("Retry：重新拉到、显示开关", await evaluate("return !!$switch();"));
  await ctl({ staff: true });
  from = (await mockLog()).length;
  await openPage();
  // 只看勾（2026-11-01）：没有 settings.auto_send 的勾 ⇒ 页面门口就拦（You don't have access to this page.）。
  await waitFor("document.querySelector('[data-no-access]')");
  check("staff：没有 settings.auto_send ⇒ 门口拦住、不拉设置", (await evaluate("return !!document.querySelector('[data-no-access]') && !$switch();")) && (await since(from, isGet)).length === 0);
  await ctl({ staff: false, admin: true });
  from = (await mockLog()).length;
  await openPage();
  await waitFor("document.querySelector('[data-no-access]')");
  check("普通 admin（标准里没有 settings.auto_send）：门口拦住、不拉设置、没有报错条", (await evaluate("return !!document.querySelector('[data-no-access]') && !$switch() && !document.body.textContent.includes('Could not load');")) && (await since(from, isGet)).length === 0);
  await ctl({ admin: false, fail401: true });
  await goto(`${APP}/settings/auto-send`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页（带 next）", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false, reset: true });
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

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
