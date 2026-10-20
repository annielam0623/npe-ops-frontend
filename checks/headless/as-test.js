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
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff：Admin access required、不拉设置", (await evaluate("return document.body.textContent.includes('Admin access required') && !$switch();")) && (await since(from, isGet)).length === 0);
  await ctl({ staff: false, fail401: true });
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
