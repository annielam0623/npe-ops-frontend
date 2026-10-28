// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Dashboard 的任务框（任务包阶段三）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9334;

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
window.$q = (s, root=document) => root.querySelector(s);
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
window.$tasksSection = () => document.querySelector('section[aria-label="My tasks"]') || document.querySelector('section[aria-label="Today\\'s tasks"]');
window.$li = (text, root=document) => [...root.querySelectorAll('li')].find(li => li.textContent.includes(text));
window.$dialog = () => document.querySelector('[role=dialog]');
window.$msgs = () => document.getElementById('messages-title')?.closest('section');
window.$vcur = (root) => root?.querySelector('[data-visibility-control] [role=radio][aria-checked=true]')?.dataset.visibility;
window.$vset = (root, v) => root.querySelector('[data-visibility-control] [data-visibility="' + v + '"]').click();
// 时间线框里完整看得见的任务行（G202：一次露 3 条）。
window.$visibleRows = (root) => {
  const box = root.querySelector('[data-timeline-scroll]');
  const r = box.getBoundingClientRect();
  return [...box.querySelectorAll('li[data-task-id]')].filter((li) => {
    const b = li.getBoundingClientRect();
    return b.height > 0 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
  }).map((li) => li.textContent);
};
// 任务行（不含 Handovers / Notice 里同名的那几行）。
window.$row = (text, root = document) => [...root.querySelectorAll('li[data-task-id]')].find((li) => li.textContent.includes(text));
window.$part = (name, root = $tasksSection()) => root.querySelector('[data-timeline-part=' + name + ']');
window.$parts = (root = $tasksSection()) => [...root.querySelectorAll('[data-timeline-part]')].map((c) => c.dataset.timelinePart).join();
window.$setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openDashboard() {
  await goto(`${APP}/dashboard`);
  await waitFor(
    "document.querySelector('section[aria-label=\"My tasks\"]') || document.querySelector('section[aria-label=\"Today\\'s tasks\"]') || document.body.textContent.includes('Staff access required')",
  );
  await helpers();
}

async function run() {
  await ctl({ reset: true, me: "lizzie", supervisor: false, fail401: false, failGet: false, notReady: false, now: null });
  let from = (await mockLog()).length;
  await openDashboard();

  // ── 员工视角：Lizzie（Pre-closer） ──
  // Dashboard 改版（Annie 2026-10-20，preview v15）：My tasks 和 Notice 在 My shortcuts / Messages 下面，My tasks 标题带蓝点。
  check(
    "改版（2026-10-24）：My tasks 在 Messages 下面（员工视角，Annie 原顺序：Messages 在前）、Daily Operation Report 上面；标题带蓝色强调点",
    await evaluate(`const secs = [...document.querySelectorAll('main section')]; const idx = (f) => secs.findIndex(f); const sc = idx((s) => s.getAttribute('aria-label') === 'My shortcuts'); const ms = idx((s) => s.getAttribute('aria-labelledby') === 'messages-title'); const mt = idx((s) => s.getAttribute('aria-label') === 'My tasks'); const dr = idx((s) => s.getAttribute('aria-label') === 'Daily Operation Report'); const dot = document.querySelector('section[aria-label="My tasks"] h2 > span[aria-hidden]'); return sc === 0 && ms > sc && mt > ms && dr > mt && !!dot;`),
  );
  check("先拉 /api/me 再拉 /api/tasks/today", await (async () => {
    const l = (await mockLog()).slice(from);
    const me = l.findIndex((e) => e.path === "/api/me");
    const t = l.findIndex((e) => e.path === "/api/tasks/today");
    return me >= 0 && t > me;
  })());
  check("标题：My tasks · 9:30 AM–5:30 PM（后端 24 小时 09:30 转成 12 小时），不写现在几点、没有 NOW（G202）", await evaluate("const t = $tasksSection().querySelector('h2').textContent; return t.includes('My tasks · 9:30 AM–5:30 PM') && !/now/i.test(t) && !$tasksSection().textContent.includes('NOW');"), await evaluate("return $tasksSection().querySelector('h2').textContent;"));
  check("汇总行 2 of 6 done（6 条角色任务，不含待接受的那条）", await evaluate("return $tasksSection().textContent.includes('2 of 6 done');"));
  check("汇总条：1 overdue · 2 due within the hour", await evaluate("return $tasksSection().textContent.includes('1 overdue') && $tasksSection().textContent.includes('2 due within the hour');"), await evaluate("return $tasksSection().textContent.slice(0, 400);"));
  check("超时的 Send Last mins Confirmation：Overdue · was due 2:00 PM，标红底", await evaluate("const li = $li('Send Last mins Confirmation'); return li.textContent.includes('Overdue') && li.textContent.includes('2:00 PM') && li.dataset.dueStatus === 'overdue';"));
  check("已完成的两条有删除线、Done 徽章", await evaluate("const li = $li('South Lunch'); return li.querySelector('input[type=checkbox]').checked && li.textContent.includes('Done');"));
  // ── Notice 面板（Annie 2026-10-19）：待接受的交接在这里，不在 My tasks 里 ──
  const NOTICE = "document.querySelector('aside[aria-label=\"Notice\"]')";
  check("待接受的交接在 Notice 面板里：Handover 标签、谁交的、说明", await evaluate(`const t = ${NOTICE}?.textContent ?? ''; return t.includes('Handover') && t.includes('Veronica passed you') && t.includes('Check Shuttle and remind Tour Guide for Shuttle Pickup') && t.includes('From Veronica') && t.includes("didn’t get to it");`), await evaluate(`return ${NOTICE}?.textContent ?? 'no notice panel';`));
  check("My tasks 里没有黄色「Passed over to you」那一块，待接受的那条也不在清单里", await evaluate("return !$tasksSection().textContent.includes('Passed over to you') && !$li('Check Shuttle and remind Tour Guide for Shuttle Pickup', $tasksSection());"));
  check("Notice 里只有 Accept 一个按钮，没有 Decline", await evaluate(`const b = [...${NOTICE}.querySelectorAll('button')].map(x => x.textContent.trim()); return b.includes('Accept') && !b.some(t => /decline/i.test(t));`));
  check("后端没有排班提醒接口（404）：Notice 只有交接这一条、写 1 new，没有 Mark all as read", await evaluate(`const t = ${NOTICE}.textContent; return t.includes('1 new') && !t.includes('Mark all as read') && !t.includes('Schedule');`));
  check("区块顺序（Annie 2026-10-24 定死）：My shortcuts → Notice（紧挨着、整行宽）→ 统计块 → Messages → My tasks（员工）", await evaluate(`const s = document.querySelector('section[aria-label="My shortcuts"]').getBoundingClientRect(); const n = ${NOTICE}.getBoundingClientRect(); const st = document.querySelector('[data-stats-row]').getBoundingClientRect(); const t = $tasksSection().getBoundingClientRect(); const m = document.getElementById('messages-title').getBoundingClientRect(); const main = document.querySelector('main').getBoundingClientRect(); return s.bottom <= n.top + 1 && n.top - s.bottom < 40 && n.width > main.width * 0.75 && n.bottom <= st.top + 1 && st.bottom <= m.top + 1 && m.bottom <= t.top + 1 && t.width > main.width * 0.75;`), await evaluate(`const g = (e) => Math.round(e.getBoundingClientRect().top); return JSON.stringify([g(document.querySelector('section[aria-label="My shortcuts"]')), g(${NOTICE}), g(document.querySelector('[data-stats-row]')), g($tasksSection()), g(document.getElementById('messages-title'))]);`));
  // ── Today's team（Annie 2026-10-24「可以只显示今日，整周的放在页面最下面」；05 2026-10-25 定整行宽、Full week 滚到底部整周块）──
  await waitFor("document.querySelectorAll('[data-team-row]').length === 5", 8000);
  check("Today's team：整行宽，在 My tasks 下面、Daily Operation Report 上面；整周 Schedule 在最底部", await evaluate(`const g = (s) => document.querySelector(s).getBoundingClientRect(); const team = g('[data-today-team]'); const t = $tasksSection().getBoundingClientRect(); const dor = g('section[aria-label="Daily Operation Report"]'); const sch = g('[data-dashboard-schedule]'); const main = document.querySelector('main').getBoundingClientRect(); const secs = [...document.querySelectorAll('main section')]; return t.bottom <= team.top + 1 && team.bottom <= dor.top + 1 && dor.bottom <= sch.top + 1 && team.width > main.width * 0.75 && secs[secs.length - 1].hasAttribute('data-dashboard-schedule');`));
  check("Today's team：每人一行（5 人），今天上班的在前；Lizzie Mid 9:30 AM – 5:30 PM，没排班的写 Off", await evaluate("const rows = [...document.querySelectorAll('[data-team-row]')]; const l = document.querySelector('[data-team-row=Lizzie]'); const offs = rows.filter((r) => r.querySelector('[data-team-off]')); const firstOff = rows.findIndex((r) => r.querySelector('[data-team-off]')); return rows.length === 5 && l.textContent.includes('Mid') && l.textContent.includes('9:30 AM – 5:30 PM') && offs.length === 2 && offs.every((r) => r.textContent.includes('Off')) && firstOff === 3;"), await evaluate("return [...document.querySelectorAll('[data-team-row]')].map((r) => r.textContent).join(' | ');"));
  check("Today's team：自己那一行（Lizzie）淡蓝底", await evaluate("return document.querySelector('[data-team-row=Lizzie]').className.includes('bg-sky-400');"));
  await evaluate("window.scrollTo(0, 0); [...document.querySelectorAll('[data-today-team] button')].find((b) => b.textContent.includes('Full week')).click();");
  await sleep(1200);
  check("点「Full week ↗」：页内滚到最底部的整周排班块（滚到块顶，或页面已到底），不跳页", await evaluate("const r = document.querySelector('[data-dashboard-schedule]').getBoundingClientRect(); const atEnd = window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2; return location.pathname === '/dashboard' && window.scrollY > 0 && r.top > -10 && (r.top < 200 || atEnd);"), await evaluate("return Math.round(document.querySelector('[data-dashboard-schedule]').getBoundingClientRect().top);"));
  await evaluate("window.scrollTo(0, 0);");

  // ── 统计块（Annie 2026-10-24）：四个可点的普通文字，数字小，点了页内滚到对应那块 ──
  check("统计块：Messages need reply / Tasks remaining / Handover to accept / Open reports 四项，数字对得上（6 / 4 / 1 / 0）", await evaluate(`const g = (k) => document.querySelector('[data-stat=' + k + ']')?.textContent.replace('→', '').trim(); return g('messages') === '6Messages need reply' && g('tasks') === '4Tasks remaining' && g('handovers') === '1Handover to accept' && g('reports') === '0Open reports';`), await evaluate(`return document.querySelector('[data-stats-row]')?.textContent;`));
  check("统计块是普通文字：没有底色、没有边框、不是胶囊、不用蓝色；数字 17px", await evaluate(`return [...document.querySelectorAll('[data-stat]')].every((b) => { const s = getComputedStyle(b); const n = b.querySelector('span'); return s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.borderTopWidth === '0px' && s.borderRadius === '0px' && s.color === 'rgb(255, 255, 255)' && getComputedStyle(n).fontSize === '17px'; });`));
  check("统计块占地很小：整行高度 < 40px，在 Notice 和 My tasks 之间", await evaluate(`const r = document.querySelector('[data-stats-row]').getBoundingClientRect(); const n = ${NOTICE}.getBoundingClientRect(); const t = $tasksSection().getBoundingClientRect(); return r.height < 40 && r.top >= n.bottom - 1 && r.bottom <= t.top + 1;`));
  await evaluate("window.scrollTo(0, 0);");
  await evaluate("document.querySelector('[data-stat=messages]').click();");
  await sleep(900);
  check("点 Messages need reply：页内滚到 Messages 那一块（滚到页面底也到不了顶栏下面时，至少在窗口上半屏）", await evaluate("const t = document.getElementById('messages-title').closest('section').getBoundingClientRect().top; return window.scrollY > 0 && t > 40 && t < innerHeight * 0.5;"), await evaluate("return document.getElementById('messages-title').closest('section').getBoundingClientRect().top + ' / ' + scrollY;"));
  await evaluate("window.scrollTo(0, document.body.scrollHeight);");
  await evaluate("document.querySelector('[data-stat=handovers]').click();");
  await sleep(900);
  check("点 Handover to accept：滚到 Notice", await evaluate("const t = document.querySelector('aside[aria-label=\"Notice\"]').getBoundingClientRect().top; return t > 40 && t < 200;"), await evaluate("return document.querySelector('aside[aria-label=\"Notice\"]').getBoundingClientRect().top + '';"));
  await evaluate("window.scrollTo(0, 0);");
  check("My tasks 高度上限是屏幕高度的比例（68vh，不写死像素）", await evaluate(`const a = $tasksSection(); return a.getBoundingClientRect().height <= innerHeight * 0.68 + 1 && Math.abs(parseFloat(getComputedStyle(a).maxHeight) - innerHeight * 0.68) < 1;`), await evaluate(`return JSON.stringify([$tasksSection().getBoundingClientRect().height, innerHeight]);`));
  check("Notice 标题旁是红点（有未读 = 红，Annie 2026-10-24 全站规则），不是琥珀", await evaluate(`const d = ${NOTICE}.querySelector('h2 > span[aria-hidden]'); return !!d && getComputedStyle(d).backgroundColor === 'rgb(220, 53, 69)';`));
  check("My tasks 的任务区有竖向细滚动条（overflow-y: auto，scrollbar-width: thin）", await evaluate(`const tl = $tasksSection().querySelector('[data-timeline]').parentElement; const s = getComputedStyle(tl); return s.overflowY === 'auto' && s.scrollbarWidth === 'thin';`));
  // ── 说明文字收起键：在右边（「N of M done」旁），点了收起 / 展开 ──
  check("Hide 键在标题行右边，和「2 of 6 done」挨着", await evaluate("const h = $q('button[aria-controls=my-tasks-copy]'); const d = [...$tasksSection().querySelectorAll('span')].find(s => /\\d+ of \\d+ done/.test(s.textContent)); const t = $tasksSection().querySelector('h2').getBoundingClientRect(); return !!h && !!d && h.getBoundingClientRect().left > t.right - 4 && h.getBoundingClientRect().left > d.getBoundingClientRect().left;"));
  await evaluate("$q('button[aria-controls=\"my-tasks-copy\"]').click();");
  await sleep(150);
  check("点 Hide：两句说明收起，键变 Show", await evaluate("return $q('#my-tasks-copy').hidden && $q('button[aria-controls=my-tasks-copy]').textContent.includes('Show');"));
  await evaluate("$q('button[aria-controls=\"my-tasks-copy\"]').click();");
  await sleep(150);
  check("点 Show：说明回来", await evaluate("return !$q('#my-tasks-copy').hidden && $q('button[aria-controls=my-tasks-copy]').textContent.includes('Hide');"));

  // ── Accept（在 Notice 里点） ──
  from = (await mockLog()).length;
  await evaluate(`[...${NOTICE}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Accept').click();`);
  await sleep(700);
  check("点 Accept 调 POST …/accept", (await since(from, (e) => e.method === "POST" && /\/accept$/.test(e.path))).length === 1);
  check("接受后任务进 My tasks 清单，显示来自 Veronica 的说明；Notice 变 No new notices", await evaluate("const li = $li('Check Shuttle and remind Tour Guide for Shuttle Pickup', $tasksSection()); return !!li && li.textContent.includes('From Veronica') && document.querySelector('[aria-label=\"Notice\"]').textContent.includes('No new notices') && !document.body.textContent.includes('Passed over to you');"));

  // ── 勾完成 ──
  from = (await mockLog()).length;
  await evaluate("const li = $li('BZ Lunch'); li.querySelector('input[type=checkbox]').click();");
  await sleep(600);
  let reqs = await since(from, (e) => e.method === "PUT" && /\/done$/.test(e.path));
  check("勾选调 PUT …/done，body {done:true}", reqs.length === 1 && reqs[0].body?.done === true, JSON.stringify(reqs));

  // ── Pass over ──
  from = (await mockLog()).length;
  await evaluate("const li = $li('CCL - Bus Assignments on 7 Days'); $btn('Pass over', li).click();");
  await waitFor("$dialog()");
  check("后端 G202 没上线（shifts 没有 next_shift_start）：弹窗没有 Finish by 一格", await evaluate("return !$dialog().querySelector('input[type=time]') && !$dialog().textContent.includes('Finish by');"));
  await evaluate("$setValue($q('textarea', $dialog()), 'Still waiting on the bus list from Discord.');");
  await evaluate("$btn('Pass over', $dialog()).click();");
  await sleep(700);
  reqs = await since(from, (e) => e.method === "POST" && /\/pass-over$/.test(e.path));
  check("Pass over 提交调 POST …/pass-over，带 note；后端没上线时不带 finish_by", reqs.length === 1 && reqs[0].body?.note === "Still waiting on the bus list from Discord." && !("finish_by" in (reqs[0].body || {})), JSON.stringify(reqs));
  check("交出去的任务灰掉、写 Waiting for Nadia to accept，checkbox 禁用", await evaluate("const li = $li('CCL - Bus Assignments on 7 Days'); return li.textContent.includes('Waiting for Nadia to accept') && li.querySelector('input[type=checkbox]').disabled;"));

  // ── 提醒弹窗 ──
  check("右下角提醒弹窗列出到期 / 超时的任务，有 Got it", await evaluate("const el = document.querySelector('[aria-label=\"Task reminder\"]'); return !!el && el.textContent.includes('Got it') && el.textContent.includes('Overdue');"));
  await evaluate("document.querySelector('[aria-label=\"Task reminder\"] button').click();");
  await sleep(200);
  check("点 Got it 关掉提醒弹窗", !(await evaluate("return !!document.querySelector('[aria-label=\"Task reminder\"]');")));

  // ── Notice：后端有排班提醒时（模拟接口 /api/notices） ──
  await ctl({ reset: true, me: "lizzie", supervisor: false, fail401: false, failGet: false, notReady: false, notices: true });
  from = (await mockLog()).length;
  await goto(`${APP}/dashboard`);
  await waitFor(`${NOTICE} && ${NOTICE}.textContent.includes('Schedule')`);
  await helpers();
  // 2026-10-25 修：后端真实形状是 {unread_count, notices:[{kind, href, read, …}]}，以前前端读 items / type，线上通知一直是空的。
  check("真实形状（notices / kind / href / read，后端 main 的样子）下排班通知能显示，请求带 include_read=false", await (async () => {
    const wire = await evaluate("const r = await fetch('/api/notices?include_read=false&limit=50'); return await r.json();");
    const req = (await since(from, (e) => e.path === "/api/notices"))[0];
    return Array.isArray(wire.notices) && !("items" in wire) && wire.notices.every((n) => "kind" in n && "read" in n && !("type" in n)) &&
      (req?.query || "").includes("include_read=false") &&
      await evaluate(`const t = ${NOTICE}.textContent; return t.includes('Schedule changed') && t.includes('Your shift on Fri Oct 23 changed') && t.includes('4 new');`);
  })());
  check("Notice 横排：默认只放今天的通知 + 24 小时内的交接（Annie 2026-10-25），交接排第一；3 天前那条不在，写 4 new", await evaluate(`const t = ${NOTICE}.textContent; const lis = [...${NOTICE}.querySelectorAll('li')]; return lis.length === 4 && lis[0].dataset.noticeKind === 'handover' && t.includes('4 new') && !t.includes('Oct 18 – Oct 24') && !t.includes('more') && !t.includes('Show all');`), await evaluate(`return ${NOTICE}.textContent;`));
  check("Notice 横排：交接之后的通知按时间倒序（最新在最前）：Fri Oct 23 → Thu Oct 22 → Wed Oct 21", await evaluate(`const lis = [...${NOTICE}.querySelectorAll('li')].slice(1); return lis.length === 3 && lis[0].textContent.includes('Fri Oct 23') && lis[1].textContent.includes('Thu Oct 22') && lis[2].textContent.includes('Wed Oct 21');`));
  check("Notice 横排：卡并排成一行、每张宽 330px 不被挤变形，底部有横向细滚动条（超出一屏就能向右拖）", await evaluate(`const ul = ${NOTICE}.querySelector('[data-notice-row]'); const lis = [...ul.querySelectorAll('li')]; const tops = lis.map((l) => Math.round(l.getBoundingClientRect().top)); const s = getComputedStyle(ul); return lis.every((l) => Math.round(l.getBoundingClientRect().width) === 330) && new Set(tops).size === 1 && s.overflowX === 'auto' && s.scrollbarWidth === 'thin' && ul.scrollWidth > ul.clientWidth && lis[0].getBoundingClientRect().left < lis[1].getBoundingClientRect().left;`));
  check("今天的通知、今天的交接只写钟点（没有日期、没有星期）", await evaluate(`const lis = [...${NOTICE}.querySelectorAll('li')]; return lis.every((l) => /\\d{1,2}:\\d{2} (AM|PM)/.test(l.textContent) && !/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2}, \\d{1,2}:\\d{2}/.test(l.textContent) && !/(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \\d{1,2}:\\d{2}/.test(l.textContent));`));
  check("右上角有 Check history（白边框普通按钮，不是蓝色），在 Mark all as read 旁边", await evaluate(`const b = ${NOTICE}.querySelector('[data-check-history]'); if (!b) return false; const c = getComputedStyle(b).color; return b.textContent.trim() === 'Check history' && !/rgb\\(56, 189, 248\\)|rgb\\(59, 130, 246\\)/.test(c) && ${NOTICE}.textContent.includes('Mark all as read');`));
  // ── Check history：弹窗，最近 30 天，按天分组，最新在最前；红点没读、绿点读过；只列通知不列交接 ──
  from = (await mockLog()).length;
  await evaluate(`${NOTICE}.querySelector('[data-check-history]').click();`);
  await waitFor("document.querySelector('[data-notice-history] [data-history-item]')", 8000);
  check("Check history：请求 include_read=true&limit=200，弹窗标题 Notice history，底部写 Showing the last 30 days.", (await since(from, (e) => e.path === "/api/notices" && (e.query || "").includes("include_read=true") && (e.query || "").includes("limit=200"))).length >= 1 && await evaluate("const d = document.querySelector('[data-notice-history]'); return d.textContent.includes('Notice history') && d.textContent.includes('Showing the last 30 days.');"));
  check("历史：4 条通知都在（含 3 天前那条），没有交接；按天分组，第一组是 Today", await evaluate("const d = document.querySelector('[data-notice-history]'); const days = [...d.querySelectorAll('[data-history-day]')]; return d.querySelectorAll('[data-history-item]').length === 4 && !d.textContent.includes('Handover') && !d.textContent.includes('passed you') && days.length === 2 && days[0].querySelector('h3').textContent.startsWith('Today') && days[1].textContent.includes('Oct 18 – Oct 24');"), await evaluate("return document.querySelector('[data-notice-history]').textContent;"));
  check("历史：不是今天的写日期 + 钟点（如 Oct 22, 10:42 AM），不只写星期", await evaluate("const li = [...document.querySelectorAll('[data-history-item]')].find((l) => l.textContent.includes('Oct 18 – Oct 24')); return /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2}, \\d{1,2}:\\d{2} (AM|PM)/.test(li.textContent) && !/(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \\d{1,2}:\\d{2}/.test(li.textContent);"), await evaluate("return [...document.querySelectorAll('[data-history-item]')].map((l) => l.textContent).join(' | ');"));
  check("历史：最新在最前（Fri Oct 23 → Thu Oct 22 → Wed Oct 21 → 3 天前的发布），没读的红点", await evaluate("const items = [...document.querySelectorAll('[data-history-item]')]; return items[0].textContent.includes('Fri Oct 23') && items[1].textContent.includes('Thu Oct 22') && items[2].textContent.includes('Wed Oct 21') && items[3].textContent.includes('Oct 18 – Oct 24') && items.every((l) => l.querySelector('[data-status-dot=unhandled]'));"));
  from = (await mockLog()).length;
  await evaluate("const li = [...document.querySelectorAll('[data-history-item]')].find((l) => l.textContent.includes('Oct 18 – Oct 24')); [...li.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Got it').click();");
  await sleep(500);
  check("历史里点 Got it：POST /api/notices/1/read，这条变绿点、Got it 消失", (await since(from, (e) => e.method === "POST" && e.path === "/api/notices/1/read")).length === 1 && await evaluate("const li = [...document.querySelectorAll('[data-history-item]')].find((l) => l.textContent.includes('Oct 18 – Oct 24')); return !!li.querySelector('[data-status-dot=handled]') && ![...li.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Got it');"));
  await evaluate("document.querySelector('[data-notice-history]').closest('[role=dialog]').querySelector('[aria-label=Close]').click();");
  await sleep(200);
  check("关掉历史回到 Notice（今天的 4 条还在）", await evaluate(`return !document.querySelector('[data-notice-history]') && [...${NOTICE}.querySelectorAll('li')].length === 4;`));
  check("排班提醒的正文按文本显示（换行保留），没有正文的不画空行", await evaluate(`const lis = [...${NOTICE}.querySelectorAll('li')]; const a = lis.find(l => l.textContent.includes('Oct 23')); const b = lis.find(l => l.textContent.includes('Oct 22')); return a.textContent.includes('you were added.') && a.textContent.includes('you were removed.') && !!a.querySelector('p.whitespace-pre-line') && !b.querySelector('p.whitespace-pre-line');`));
  check("排班提醒有 See my schedule 链接（去 /schedule）和 Got it", await evaluate(`const li = [...${NOTICE}.querySelectorAll('li')].find(l => l.textContent.includes('Oct 23')); const a = li.querySelector('a'); return !!a && a.textContent.includes('See my schedule') && a.getAttribute('href').includes('schedule') && !!$btn('Got it', li);`));
  from = (await mockLog()).length;
  await evaluate(`$btn('Got it', [...${NOTICE}.querySelectorAll('li')].find(l => l.textContent.includes('Oct 23'))).click();`);
  await sleep(500);
  check("点 Got it：调 POST /api/notices/4/read，这一条从面板拿掉，3 new", (await since(from, (e) => e.method === "POST" && e.path === "/api/notices/4/read")).length === 1 && (await evaluate(`return !${NOTICE}.textContent.includes('Oct 23') && ${NOTICE}.textContent.includes('3 new');`)));
  from = (await mockLog()).length;
  await evaluate(`$btn('Mark all as read', ${NOTICE}).click();`);
  await sleep(500);
  check("Mark all as read：调 POST /api/notices/read-all；排班提醒清空，待接受的交接还在（只能 Accept）", (await since(from, (e) => e.method === "POST" && e.path === "/api/notices/read-all")).length === 1 && (await evaluate(`const t = ${NOTICE}.textContent; return !t.includes('Schedule') && t.includes('Handover') && t.includes('1 new') && !t.includes('Mark all as read') && !!${NOTICE}.querySelector('[data-check-history]');`)));

  // ── 交接超过 24 小时不显示（Annie 2026-10-25「交接就是24小时内的」）；今天什么都没有：No new notices today. + Check history ──
  await ctl({ handoverAgeH: 25 }); // 先设好：reset 时按它重建交接
  await ctl({ reset: true, me: "lizzie", supervisor: false, fail401: false, failGet: false, notReady: false, notices: true });
  await goto(`${APP}/dashboard`);
  await waitFor(`${NOTICE} && ${NOTICE}.textContent.includes('Schedule')`, 8000);
  await helpers();
  check("交接是 25 小时前交出的：Notice 里不显示（只剩今天的 3 条通知），统计行的 Handover to accept 不算它", await evaluate(`const t = ${NOTICE}.textContent; return !t.includes('Handover') && !t.includes('passed you') && [...${NOTICE}.querySelectorAll('li')].length === 3;`), await evaluate(`return ${NOTICE}.textContent;`));
  await evaluate(`$btn('Mark all as read', ${NOTICE}).click();`);
  await sleep(500);
  check("今天什么都没有：写 No new notices today.，右上角 Check history 还在", await evaluate(`const n = document.querySelector('[aria-label="Notice"]'); return !!n && n.textContent.includes('No new notices today.') && !!n.querySelector('[data-check-history]');`), await evaluate(`return document.querySelector('[aria-label="Notice"]')?.textContent;`));
  await ctl({ handoverAgeH: null });

  // ── Notice：后端 G138 实际发的两类类型字符串 ──
  // 旧草案形状（items / type / is_read / link）也还认得（兼容，后端没用过）
  await ctl({ reset: true, me: "lizzie", supervisor: false, fail401: false, failGet: false, notReady: false, notices: true, legacyShape: true });
  await goto(`${APP}/dashboard`);
  await waitFor(`${NOTICE} && ${NOTICE}.textContent.includes('Schedule')`, 8000);
  check("旧草案形状（items / type / link）也照样显示排班通知（兼容）", await evaluate(`const t = ${NOTICE}.textContent; return t.includes('Your shift on Fri Oct 23 changed') && !!${NOTICE}.querySelector('a[href*="/schedule"]');`));
  await ctl({ legacyShape: false });
  await ctl({ reset: true, me: "lizzie", supervisor: false, fail401: false, failGet: false, notReady: false, notices: true, confirmNotices: true });
  await goto(`${APP}/dashboard`);
  await waitFor(`${NOTICE} && ${NOTICE}.textContent.includes('Confirm your schedule')`);
  await helpers();
  await evaluate(`const b = [...${NOTICE}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Show all'); if (b) b.click();`);
  await sleep(150);
  check("schedule_confirm_request：标签 Confirm your schedule，链接 Review my schedule →（去 /schedule）", await evaluate(`const li = [...${NOTICE}.querySelectorAll('li')].find(l => l.textContent.includes('Oct 25 – Oct 31')); if (!li) return false; const a = li.querySelector('a'); return li.textContent.includes('Confirm your schedule') && !!a && a.textContent.includes('Review my schedule') && a.getAttribute('href').includes('/schedule');`), await evaluate(`return ${NOTICE}.textContent;`));
  check("schedule_confirm_declined：标签 Notice，按后端 title + body 通用显示，链接 See my schedule →", await evaluate(`const li = [...${NOTICE}.querySelectorAll('li')].find(l => l.textContent.includes('Mon Oct 26')); if (!li) return false; const a = li.querySelector('a'); return li.textContent.includes('Notice') && !li.textContent.includes('Confirm your schedule') && li.textContent.includes('was not approved.') && !!a && a.textContent.includes('See my schedule') && !!$btn('Got it', li);`), await evaluate(`return ${NOTICE}.textContent;`));

  check("operation_report：标签 Incident logged，链接 Open report → 去 /daily-report?id=12，有 Got it", await evaluate(`const li = [...${NOTICE}.querySelectorAll('li')].find(l => l.textContent.includes('Accident logged')); if (!li) return false; const a = li.querySelector('a'); return li.textContent.includes('Incident logged') && !!a && a.textContent.includes('Open report') && a.getAttribute('href') === '/daily-report?id=12' && !!$btn('Got it', li);`), await evaluate(`return ${NOTICE}.textContent;`));
  check("不认识的类型、缺 body / link / actions：不崩，标签 Notice + 标题，有 Got it，没有链接", await evaluate(`const li = [...${NOTICE}.querySelectorAll('li')].find(l => l.textContent.includes('ZZ Unknown kind notice')); if (!li) return false; return li.textContent.includes('Notice') && !li.querySelector('a') && !!$btn('Got it', li);`), await evaluate(`return ${NOTICE}.textContent;`));

  // ── 主管视角、有 Notice：Notice 只占左半，右半先留空；整行任务框在 Messages 下面 ──
  await ctl({ reset: true, me: "annie", supervisor: true, fail401: false, failGet: false, notReady: false, notices: true, confirmNotices: true });
  await goto(`${APP}/dashboard`);
  await waitFor(`${NOTICE} && $tasksSection()`);
  await helpers();
  check("主管视角：统计块没有 Handover to accept（主管没有这个概念），其余三项在", await evaluate("const keys = [...document.querySelectorAll('[data-stat]')].map((b) => b.dataset.stat); return keys.join() === 'messages,tasks,reports';"), await evaluate("return document.querySelector('[data-stats-row]')?.textContent;"));
  check("主管视角：Notice 整行宽、在 shortcuts 下面，统计块在它下面，整行任务框在 Messages 下面", await evaluate(`const s = document.querySelector('section[aria-label="My shortcuts"]').getBoundingClientRect(); const n = ${NOTICE}.getBoundingClientRect(); const st = document.querySelector('[data-stats-row]').getBoundingClientRect(); const m = document.getElementById('messages-title').getBoundingClientRect(); const t = $tasksSection().getBoundingClientRect(); const main = document.querySelector('main').getBoundingClientRect(); return n.top >= s.bottom - 1 && n.width > main.width * 0.75 && st.top >= n.bottom - 1 && m.top >= st.bottom - 1 && t.top >= m.bottom - 1 && t.width > main.width * 0.7;`), await evaluate(`const n = ${NOTICE}.getBoundingClientRect(); const main = document.querySelector('main').getBoundingClientRect(); return JSON.stringify([n.width, main.width]);`));

  // ── 主管视角 ──
  await ctl({ reset: true, me: "annie", supervisor: true, fail401: false, failGet: false, notReady: false, notices: false, confirmNotices: false });
  from = (await mockLog()).length;
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection()");
  await helpers();
  check("标题：Today's tasks · all shifts · 6 of 23 done，不写现在几点", await evaluate("const t = $tasksSection().querySelector('h2').textContent; return t.includes('Today\u2019s tasks') && !/now/i.test(t) && t.includes('6 of 23 done');"), await evaluate("return $tasksSection().querySelector('h2').textContent;"));
  check("每条写是谁的：没指定人的写 All shift，没有 Pre-closer / Whole team 标签", await evaluate("const t = $tasksSection().textContent; const who = [...$tasksSection().querySelectorAll('[data-task-who]')].map((w) => w.textContent); return who.length === 23 && who.filter((w) => w === 'All shift').length === 22 && !/Pre-closer|Whole team/i.test(t);"), await evaluate("return [...$tasksSection().querySelectorAll('[data-task-who]')].map((w) => w.textContent).join();"));
  check("指定给 Veronica 的那条写 Veronica（不再按人分组）", await evaluate("return [...$tasksSection().querySelectorAll('li[data-task-id]')].find((l) => l.textContent.includes('Check Shuttle')).querySelector('[data-task-who]').textContent === 'Veronica' && !$tasksSection().querySelector('[data-person]');"));
  check("待接受的交接那条写 Passing to Lizzie — not accepted yet", await evaluate("return $tasksSection().textContent.includes('Passing to Lizzie — not accepted yet');"));
  check("Handovers 块：Veronica passed … to Lizzie — waiting for accept；后端没 B4 字段时不写 finish by、没有 YESTERDAY", await evaluate("const h = document.querySelector('[data-handovers]'); return !!h && h.querySelector('h3').textContent === 'Handovers' && h.textContent.includes('Veronica passed') && h.textContent.includes('waiting for accept') && !h.textContent.includes('finish by') && !/yesterday/i.test(h.textContent);"));

  // ── 时间线（G202，preview 3ktywUdNA5AHHP5zY47a2w 第 3 版：一列、不分段、一次露 3 条、停在下一条）──
  check("主管：没有 AM / PM 卡；Overdue 红框 → Earlier today（收起）→ 时间线（3:30 PM 时没有 Anytime）", !(await evaluate("return !!document.querySelector('[data-period]');")) && (await evaluate("return $parts();")) === "overdue,earlier,list", await evaluate("return $parts();"));
  check("Overdue 红框置顶：过了时间没做的两条（11 AM Check Shuttle、2 PM Send Last mins）全显示，标题红字，写 2 to do", await evaluate("const o = $part('overdue'); const st = getComputedStyle(o.querySelector('h3')); return o.querySelectorAll('li[data-task-id]').length === 2 && o.textContent.includes('Check Shuttle') && o.textContent.includes('Send Last mins') && st.color === 'rgb(248, 113, 113)' && o.querySelector('[data-timeline-count]').textContent === '2 to do';"));
  check("Earlier today：过了时间做完的 6 条收成一行（默认收起），写 Earlier today · 6 done", await evaluate("const e = $part('earlier'); return !e.open && e.querySelector('summary').textContent.includes('Earlier today · 6 done') && e.querySelectorAll('li[data-task-id]').length === 6;"));
  check("时间线：其余 15 条按截止时间从早到晚排成一列（不分段）", await evaluate("const l = $part('list'); const times = [...l.querySelectorAll('input[type=time]')].map((i) => i.value); return times.length === 15 && times.join() === [...times].sort().join() && times[0] === '16:00';"), await evaluate("return [...$part('list').querySelectorAll('input[type=time]')].map((i) => i.value).join();"));
  check("时间线框里一次露 3 条（4 PM 的 CCL / Check which tour / Manifest），其余在框里竖向细滚动条往下滚", await evaluate("const v = $visibleRows($tasksSection()); const box = $tasksSection().querySelector('[data-timeline-scroll]'); const s = getComputedStyle(box); return v.length === 3 && v[0].includes('CCL') && v[1].includes('Check which tour') && v[2].includes('Manifest') && box.scrollHeight > box.clientHeight + 20 && s.overflowY === 'auto' && s.scrollbarWidth === 'thin';"), await evaluate("return JSON.stringify($visibleRows($tasksSection()).map((t) => t.slice(0, 30)));"));
  check("过期的那几条行本身也标红（Overdue · was due …）", await evaluate("const li = [...$part('overdue').querySelectorAll('li')].find((l) => l.textContent.includes('Send Last mins')); return li.dataset.dueStatus === 'overdue' && li.textContent.includes('Overdue · was due 2:00 PM');"));
  check("任务行仍只有一个时间（一个 Finish-by 框）", await evaluate("return [...$tasksSection().querySelectorAll('li')].filter((li) => li.querySelector('input[type=checkbox]')).every((li) => li.querySelectorAll('input[type=time]').length === 1);"));

  // 边界：每小时重复、没有截止时间 → Anytime；11:59 AM / 12:00 PM 不再分卡，过期一起进 Overdue 按时间排
  await ctl({ reset: true, edge: true, me: "annie", supervisor: true });
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection() && document.querySelector('[data-timeline-part=any]')");
  await helpers();
  check("Anytime 虚线框在最上面：每小时重复的、没有截止时间的在这里，不在时间线里", await evaluate("const a = $part('any'); return $parts().startsWith('any,') && a.querySelector('h3').textContent === 'Anytime' && a.textContent.includes('ZZ Hourly check') && a.textContent.includes('ZZ Free task') && !$part('list').textContent.includes('ZZ Hourly') && getComputedStyle(a).borderTopStyle === 'dashed';"), await evaluate("return $parts();"));
  check("Anytime 带 0 of 2 done；没有时间的那条显示 When free", await evaluate("const a = $part('any'); return a.querySelector('[data-timeline-count]').textContent === '0 of 2 done' && a.textContent.includes('When free');"));
  check("11:59 AM、12:00 PM 两条不再分 AM / PM，过了时间都在 Overdue，按时间排（11:59 在前）", await evaluate("const t = $part('overdue').textContent; return t.indexOf('ZZ Edge 11:59 AM') >= 0 && t.indexOf('ZZ Edge 11:59 AM') < t.indexOf('ZZ Edge 12:00 PM');"));

  // 员工（Lizzie）12:30 PM：时间线停在下一条还没做的，前面做完的滚出框外
  await ctl({ reset: true, me: "lizzie", supervisor: false, now: "2026-10-16T19:30:00.000Z" });
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection() && document.querySelector('[data-timeline-scroll] li')");
  await helpers();
  await sleep(300);
  check("员工 12:30 PM：只有时间线一块（没有过期、没有 Earlier、没有 Anytime），没有 AM / PM 卡", (await evaluate("return $parts();")) === "list" && !(await evaluate("return !!document.querySelector('[data-period]');")), await evaluate("return $parts();"));
  check("员工：打开时自动停在下一条没做的（Send Last mins），露 3 条；1 PM / 2 PM 已做完的两条在框上面滚出去了", await evaluate("const v = $visibleRows($tasksSection()); const box = $tasksSection().querySelector('[data-timeline-scroll]'); return v.length === 3 && v[0].includes('Send Last mins') && v[1].includes('CCL') && v[2].includes('BZ Lunch') && box.scrollTop > 0;"), await evaluate("return JSON.stringify($visibleRows($tasksSection()).map((t) => t.slice(0, 30)));"));
  check("员工：Pass over 键、勾选、By … 小标签都还在", await evaluate("const li = $li('Send Last mins Confirmation', $tasksSection()); return [...li.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Pass over') && !!li.querySelector('input[type=checkbox]') && li.textContent.includes('2:00 PM');"));
  await evaluate("$li('Send Last mins Confirmation', $tasksSection()).querySelector('input[type=checkbox]').click();");
  await sleep(700);
  check("勾掉下一条：自动停到再下一条（CCL），框里露 CCL / BZ Lunch / Driver manifests", await evaluate("const v = $visibleRows($tasksSection()); return v.length === 3 && v[0].includes('CCL') && v[2].includes('Driver manifests');"), await evaluate("return JSON.stringify($visibleRows($tasksSection()).map((t) => t.slice(0, 30)));"));

  // 员工 2:30 PM：2 PM 那条没做 → 移进 Overdue 置顶，做完的收进 Earlier today，时间线从 4 PM 起
  await ctl({ reset: true, me: "lizzie", supervisor: false, now: "2026-10-16T21:30:00.000Z" });
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection() && document.querySelector('[data-timeline-scroll] li')");
  await helpers();
  await sleep(300);
  check("员工 2:30 PM：Overdue 红框在 Earlier today、时间线上面；2 PM 没做的 Send Last mins 在 Overdue", (await evaluate("return $parts();")) === "overdue,earlier,list" && (await evaluate("return $part('overdue').textContent.includes('Send Last mins') && !$part('list').textContent.includes('Send Last mins');")), await evaluate("return $parts();"));
  check("员工 2:30 PM：时间线露 CCL / BZ Lunch / Driver manifests 3 条（Overdue、Earlier 不算在 3 条里）", await evaluate("const v = $visibleRows($tasksSection()); return v.length === 3 && v[0].includes('CCL') && v[2].includes('Driver manifests');"), await evaluate("return JSON.stringify($visibleRows($tasksSection()).map((t) => t.slice(0, 30)));"));

  // ── G202 后端字段（B1–B5，字段名暂定）到了以后 ──
  await ctl({ reset: true, me: "lizzie", supervisor: false, g202: true, notices: false, now: null });
  await goto(`${APP}/dashboard`);
  await waitFor(`$tasksSection() && ${NOTICE}?.textContent.includes('Accept')`);
  await helpers();
  check("G202 · Notice 里待接受的交接写 Finish by 4:00 PM", await evaluate(`return !!${NOTICE}.querySelector('[data-finish-by]')?.textContent.includes('Finish by 4:00 PM');`), await evaluate(`return ${NOTICE}.textContent.slice(0, 300);`));
  await evaluate(`[...${NOTICE}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Accept').click();`);
  await sleep(800);
  check("G202 · Accept 后按交出人设的 4:00 PM 排进时间线（原 11 AM 不算过期），不另放 Handed over 块", await evaluate("const li = $li('Check Shuttle and remind Tour Guide', $tasksSection()); return !!li && $part('list').contains(li) && li.dataset.dueStatus === 'due_soon' && li.textContent.includes('4:00 PM') && !$tasksSection().textContent.includes('Handed over');"), await evaluate("return $parts();"));
  check("G202 · 时间线停在它（4:00 PM 最早、还没做）", await evaluate("return !!$visibleRows($tasksSection())[0]?.includes('Check Shuttle');"), await evaluate("return JSON.stringify($visibleRows($tasksSection()).map((t) => t.slice(0, 30)));"));
  from = (await mockLog()).length;
  await evaluate("const li = $li('BZ Lunch', $tasksSection()); $btn('Pass over', li).click();");
  await waitFor("$dialog()");
  check("G202 · Pass over 弹窗有 Finish by：默认 Nadia 上班后 1 小时（14:30），只能选她的班次 13:30–21:30", await evaluate("const i = $dialog().querySelector('input[type=time]'); return !!i && i.value === '14:30' && i.min === '13:30' && i.max === '21:30' && i.required;"), await evaluate("const i = $dialog().querySelector('input[type=time]'); return i ? JSON.stringify([i.value, i.min, i.max]) : 'none';"));
  check("G202 · 弹窗写 Goes to Nadia (next shift, 1:30 PM–9:30 PM)，灰字写排在对方列表的 2:30 PM", await evaluate("const t = $dialog().textContent; return t.includes('Goes to Nadia (next shift, 1:30 PM–9:30 PM)') && $dialog().querySelector('[data-finish-by-hint]').textContent.includes('Shows in Nadia’s list at 2:30 PM');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$setValue($dialog().querySelector('input[type=time]'), '22:00');");
  await evaluate("$btn('Pass over', $dialog()).click();");
  await sleep(400);
  check("G202 · 选了班次外的时间（10 PM）：红字提示，不发请求", (await since(from, (e) => /\/pass-over$/.test(e.path))).length === 0 && (await evaluate("return !!$dialog().querySelector('[role=alert]')?.textContent.includes('within Nadia');")));
  await evaluate("$setValue($dialog().querySelector('input[type=time]'), '15:00');");
  await evaluate("$btn('Pass over', $dialog()).click();");
  await sleep(700);
  reqs = await since(from, (e) => e.method === "POST" && /\/pass-over$/.test(e.path));
  check("G202 · 提交带 finish_by（3:00 PM 洛杉矶 = 22:00Z）", reqs.length === 1 && reqs[0].body?.finish_by === "2026-10-16T22:00:00.000Z", JSON.stringify(reqs));

  await ctl({ reset: true, me: "annie", supervisor: true, g202: true });
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('[data-handovers]')");
  await helpers();
  check("G202 · 主管 Handovers：昨晚的那条标 YESTERDAY、写 finish by 10:00 AM、accepted, not done", await evaluate("const li = document.querySelector('[data-handover=\"50\"]'); return !!li && li.textContent.includes('Yesterday') && li.textContent.includes('finish by 10:00 AM') && li.textContent.includes('accepted, not done');"), await evaluate("return document.querySelector('[data-handovers]').textContent;"));
  check("G202 · 超过 24 小时还没 Done 的也列出来：写日期 Oct 14 · 8:10 PM、older than 24 h", await evaluate("const li = document.querySelector('[data-handover=\"51\"]'); return !!li && li.textContent.includes('Oct 14 · 8:10 PM') && li.textContent.includes('older than 24 h');"), await evaluate("return document.querySelector('[data-handover=\"51\"]')?.textContent;"));
  check("G202 · 主管 Handovers 右上写条数（N handovers，和列出来的行数一致）", await evaluate("const h = document.querySelector('[data-handovers]'); const n = h.querySelectorAll('[data-handover]').length; return n >= 4 && h.textContent.includes(n + ' handovers');"));

  await ctl({ reset: true, me: "annie", supervisor: true });
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection()");
  await helpers();

  // ── 改截止时间 ──
  from = (await mockLog()).length;
  await evaluate("const li = $row('BZ Lunch'); $setValue(li.querySelector('input[type=time]'), '17:30');");
  await sleep(600);
  reqs = await since(from, (e) => e.method === "PUT" && /\/due$/.test(e.path));
  check("改时间调 PUT …/due，带新的 due_at", reqs.length === 1 && typeof reqs[0].body?.due_at === "string", JSON.stringify(reqs));

  // ── 加任务 ──
  from = (await mockLog()).length;
  await evaluate("const inp = $q('input[placeholder=\"What needs to be done\"]'); $setValue(inp, 'ZZ Test one-off task');");
  await evaluate("$btn('Add').click();");
  await sleep(600);
  reqs = await since(from, (e) => e.method === "POST" && e.path === "/api/tasks/today");
  check("Add 调 POST /api/tasks/today：title + assigned_admin_user_id=null，不再带 role / assigned_to_username", reqs.length === 1 && reqs[0].body?.title === "ZZ Test one-off task" && reqs[0].body?.assigned_admin_user_id === null && !("role" in reqs[0].body) && !("assigned_to_username" in reqs[0].body), JSON.stringify(reqs));
  check("新任务（没设时间）在 Anytime 里，写 All shift", await evaluate("const li = $row('ZZ Test one-off task'); return !!li && $part('any').contains(li) && li.querySelector('[data-task-who]').textContent === 'All shift';"));

  // ── 主管加任务：可指定今天在班的某个人（后端 G160；Annie 2026-10-23「主管加任务：动手」）──
  const forSel = "$q('select[aria-label=\"For\"]')";
  check("加任务下拉：第一项 Everyone on shift today（默认选中），后面是今天在班的每个人带班次时间", await evaluate(`const s = ${forSel}; const o = [...s.options].map((x) => x.textContent); return s.value === '' && o[0] === 'Everyone on shift today' && o.length === 6 && o.includes('Lizzie · 9:30 AM–5:30 PM') && o.includes('Veronica · 2:00 AM–10:00 AM');`), await evaluate(`return [...${forSel}.options].map((x) => x.textContent).join('|');`));
  check("下拉没有蓝色底（蓝色只给 Add 键）", await evaluate(`const bg = getComputedStyle(${forSel}).backgroundColor; return !bg.includes('24, 95, 165');`));
  const setFor = (v) => evaluate(`const s = ${forSel}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${v}'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await setFor("lizzie");
  from = (await mockLog()).length;
  await evaluate("const inp = $q('input[placeholder=\"What needs to be done\"]'); $setValue(inp, 'ZZ Test for Lizzie');");
  await evaluate("$btn('Add').click();");
  await sleep(600);
  reqs = await since(from, (e) => e.method === "POST" && e.path === "/api/tasks/today");
  check("选 Lizzie 再 Add：POST 带 assigned_to_username=lizzie", reqs.length === 1 && reqs[0].body?.assigned_to_username === "lizzie" && reqs[0].body?.title === "ZZ Test for Lizzie", JSON.stringify(reqs));
  check("加好之后下拉回到 Everyone on shift today、标题清空", await evaluate(`return ${forSel}.value === '' && $q('input[placeholder="What needs to be done"]').value === '';`));
  check("新任务写 Lizzie（不是 All shift）", await evaluate("const li = $row('ZZ Test for Lizzie'); return !!li && li.querySelector('[data-task-who]').textContent === 'Lizzie';"));
  // 400：后端原话，红字在标题框下面；输入和选择都留着，改好能直接再点 Add
  await ctl({ inactive: ["jing"] });
  await setFor("jing");
  await evaluate("const inp = $q('input[placeholder=\"What needs to be done\"]'); $setValue(inp, 'ZZ Test for Jing');");
  await evaluate("$btn('Add').click();");
  await sleep(600);
  check("指定的人被停用（400）：后端原话写在标题框下的红字里", await evaluate("const a = [...document.querySelectorAll('section[aria-label=\"Today\\'s tasks\"] [role=alert]')].map((x) => x.textContent); return a.includes(\"No active staff account with username 'jing'\");"), await evaluate("return [...document.querySelectorAll('[role=alert]')].map((x) => x.textContent).join('|');"));
  check("400 之后标题和选择都留着，没有新任务", await evaluate(`return ${forSel}.value === 'jing' && $q('input[placeholder="What needs to be done"]').value === 'ZZ Test for Jing' && !$li('ZZ Test for Jing');`));
  await ctl({ inactive: [] });
  await evaluate("$btn('Add').click();");
  await sleep(600);
  check("改好后再点 Add：加上了、红字消失", await evaluate("return !!$li('ZZ Test for Jing') && ![...document.querySelectorAll('section[aria-label=\"Today\\'s tasks\"] [role=alert]')].some((x) => x.textContent.includes('No active staff'));"));

  // ── 本批新板块 / 功能的开关（Annie 2026-10-25「从 my task 开始的所有新板块都要有这个开关，只有 super admin 可以控制」）──
  // 三档：Everyone（staff）/ Admins（admin）/ Super Admin only。后端还没登记 key 时按前端默认值算（统计行、Today's team、Reply 只 Super Admin）。
  await ctl({ reset: true, me: "lizzie", supervisor: false, admin: false, notices: true, gates: "unregistered", superadmin: false, gateVis: {} });
  await openDashboard();
  await waitFor("document.querySelector('[data-message-card]')", 8000);
  await sleep(800);
  check("开关（key 未登记）· 员工：统计行、Today's team 都不画；整周排班照旧在", await evaluate("return !document.querySelector('[data-stats-row]') && !document.querySelector('[data-today-team]') && !!document.querySelector('[data-dashboard-schedule]');"));
  check("开关（key 未登记）· 员工：没有任何「Visible to」控件", await evaluate("return !document.querySelector('[data-visibility-control]');"));
  check("开关（key 未登记）· 员工：消息卡没有小的 Tracking page 链接，说明写 reply on its tracking page", await evaluate("return !document.querySelector('[data-message-card] a') && document.body.textContent.includes('Click a message to reply on its tracking page.');"));
  await evaluate("document.querySelector('[data-message-card]').click();");
  await waitFor("location.pathname.includes('tracking')", 8000);
  check("开关（key 未登记）· 员工：点消息卡照旧跳 tracking 页，不弹对话框", await evaluate("return location.pathname.includes('morning-pickup/tracking');"), await evaluate("return location.href;"));
  // Super Admin：key 未登记时照样看得到，黄色虚线框 + 控件选在 Super Admin only。
  await ctl({ reset: true, me: "annie", supervisor: true, admin: false, notices: false, gates: "unregistered", superadmin: true, gateVis: {} });
  await openDashboard();
  await waitFor("document.querySelector('[data-stats-row]') && document.querySelectorAll('[data-team-row]').length === 5", 8000);
  check("开关（key 未登记）· Super Admin：统计行、Today's team 都在，黄色虚线框（还没放给员工）", await evaluate("return document.querySelector('[data-stats-row]').hasAttribute('data-staff-hidden') && document.querySelector('[data-today-team]').hasAttribute('data-staff-hidden');"));
  check("开关 · Super Admin：统计行、Today's team、Messages（Reply pop-up）各一个三档控件，都选在 Super Admin only，写着谁看得到", await evaluate("const st = document.querySelector('[data-stats-row]'), tm = document.querySelector('[data-today-team]'), ms = $msgs(); return [st, tm, ms].every((x) => $vcur(x) === 'super_admin_only' && x.querySelectorAll('[data-visibility-control] [role=radio]').length === 3) && ms.textContent.includes('Reply pop-up:') && tm.textContent.includes('Only Super Admin can see this.');"));
  check("开关 · 控件不用蓝色（蓝色只给提交键）", await evaluate("return [...document.querySelectorAll('[data-visibility-control] [role=radio]')].every((b) => !b.className.includes('3b82f6') && getComputedStyle(b).backgroundColor !== 'rgb(59, 130, 246)');"));
  check("开关 · Super Admin：点消息卡直接弹对话框（Reply 弹框对 Super Admin 可用）", await (async () => { await evaluate("document.querySelector('[data-message-card]').click();"); await sleep(1200); const ok = await evaluate("return location.pathname === '/dashboard' && !!document.querySelector('[data-conversation-context], [role=dialog]');"); await evaluate("document.querySelector('[aria-label=Close]')?.click(); [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close')?.click();"); await sleep(300); return ok; })());
  from = (await mockLog()).length;
  await evaluate("$vset(document.querySelector('[data-today-team]'), 'staff');");
  await waitFor("$vcur(document.querySelector('[data-today-team]')) === 'staff'", 5000);
  check("开关 · Super Admin 把 Today's team 设成 Everyone：PUT {widgets:{dashboard_today_team:'staff'}}，虚线框消失、写 Everyone can see this", (await since(from, (e) => e.method === "PUT" && e.path === "/api/settings/dashboard-widgets" && e.body?.widgets?.dashboard_today_team === "staff")).length > 0 && await evaluate("const s = document.querySelector('[data-today-team]'); return !s.hasAttribute('data-staff-hidden') && s.textContent.includes('Everyone can see this');"));
  from = (await mockLog()).length;
  await evaluate("$vset($msgs(), 'staff');");
  await waitFor("$vcur($msgs()) === 'staff'", 5000);
  check("开关 · Super Admin 把 Reply pop-up 设成 Everyone：PUT {widgets:{dashboard_reply:'staff'}}", (await since(from, (e) => e.method === "PUT" && e.body?.widgets?.dashboard_reply === "staff")).length > 0);
  from = (await mockLog()).length;
  await evaluate("$vset(document.querySelector('[data-stats-row]'), 'admin');");
  await waitFor("$vcur(document.querySelector('[data-stats-row]')) === 'admin'", 5000);
  check("开关 · Super Admin 把统计行设成 Admins：PUT {widgets:{dashboard_stats:'admin'}}，仍是虚线框（员工看不到）、写 Only admins and Super Admin", (await since(from, (e) => e.method === "PUT" && e.body?.widgets?.dashboard_stats === "admin")).length > 0 && await evaluate("const s = document.querySelector('[data-stats-row]'); return s.hasAttribute('data-staff-hidden') && s.textContent.includes('Only admins and Super Admin can see this.');"));
  // 放给员工后：员工看得到 Today's team、能在 Dashboard 里直接回复；统计行是 Admins，员工仍看不到。没有控件。
  await ctl({ me: "lizzie", supervisor: false, admin: false, superadmin: false });
  await openDashboard();
  await waitFor("document.querySelectorAll('[data-team-row]').length === 5", 8000);
  check("放给员工后 · 员工：Today's team 在（实线框、没有控件），统计行（Admins）仍看不到", await evaluate("const s = document.querySelector('[data-today-team]'); return !s.hasAttribute('data-staff-hidden') && !document.querySelector('[data-visibility-control]') && !document.querySelector('[data-stats-row]');"));
  check("放给员工后 · 员工：消息卡有小的 Tracking page 链接，说明写 reply right here", await evaluate("return !!document.querySelector('[data-message-card] a') && document.body.textContent.includes('Click a message to reply right here.');"));
  // Admins 这一档：admin 看得到统计行，supervisor 看不到；两人都没有控件。
  await ctl({ me: "lizzie", supervisor: true, admin: false, superadmin: false });
  await openDashboard();
  await waitFor("document.querySelectorAll('[data-team-row]').length === 5", 8000);
  check("统计行设成 Admins · supervisor：看不到统计行、没有控件", await evaluate("return !document.querySelector('[data-stats-row]') && !document.querySelector('[data-visibility-control]');"));
  await ctl({ me: "lizzie", supervisor: true, admin: true, superadmin: false });
  await openDashboard();
  await waitFor("document.querySelector('[data-stats-row]')", 8000);
  check("统计行设成 Admins · admin：看得到统计行、没有控件", await evaluate("return !!document.querySelector('[data-stats-row]') && !document.querySelector('[data-visibility-control]');"));
  // ── Notice / 任务块的开关（Annie 2026-10-25「把task和notice都加上开关」）：默认 Everyone，key 读不到也当 Everyone ──
  check("Notice / 任务开关（key 未登记）· 员工：Notice、My tasks 照旧都在（默认 Everyone）", await (async () => { await ctl({ admin: false, supervisor: false, gateVis: {} }); await openDashboard(); return evaluate(`return !!${NOTICE} && !!document.querySelector('section[aria-label="My tasks"]') && !document.querySelector('[data-visibility-control]');`); })());
  await ctl({ reset: true, me: "annie", supervisor: true, admin: false, notices: true, gates: "unregistered", superadmin: true, gateVis: {} });
  await openDashboard();
  await waitFor(`${NOTICE} && $vcur($tasksSection())`, 8000);
  check("Notice / 任务开关 · Super Admin：Notice、Today's tasks 标题行各一个控件，默认选在 Everyone、实线框", await evaluate(`const t = $tasksSection(); return $vcur(${NOTICE}) === 'staff' && $vcur(t) === 'staff' && ${NOTICE}.textContent.includes('Everyone can see this') && !t.hasAttribute('data-staff-hidden') && !${NOTICE}.hasAttribute('data-staff-hidden');`));
  from = (await mockLog()).length;
  await evaluate(`$vset($tasksSection(), 'super_admin_only');`);
  await waitFor(`$vcur($tasksSection()) === 'super_admin_only'`, 5000);
  check("Notice / 任务开关 · Super Admin 把任务块设成 Super Admin only：PUT {widgets:{dashboard_tasks:'super_admin_only'}}，自己仍看得到、变黄色虚线框", (await since(from, (e) => e.method === "PUT" && e.body?.widgets?.dashboard_tasks === "super_admin_only")).length > 0 && await evaluate(`return $tasksSection().hasAttribute('data-staff-hidden');`));
  from = (await mockLog()).length;
  await evaluate(`$vset(${NOTICE}, 'super_admin_only');`);
  await waitFor(`$vcur(${NOTICE}) === 'super_admin_only'`, 5000);
  check("Notice / 任务开关 · Super Admin 把 Notice 设成 Super Admin only：PUT {widgets:{dashboard_notice:'super_admin_only'}}", (await since(from, (e) => e.method === "PUT" && e.body?.widgets?.dashboard_notice === "super_admin_only")).length > 0);
  // 员工（统计行放开，好看依赖的那两项是否跟着藏）：任务块、Notice 都不画，Tasks remaining / Handover to accept 不显示，任务提醒小窗也不出
  await ctl({ me: "lizzie", supervisor: false, admin: false, superadmin: false, gateVis: { dashboard_tasks: "super_admin_only", dashboard_notice: "super_admin_only", dashboard_stats: "staff" } });
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('[data-stats-row]')", 10000);
  await sleep(2500);
  await helpers();
  check("关掉后 · 员工：没有 My tasks、没有 Notice、没有 Task reminder 小窗；统计行里没有 Tasks remaining、Handover to accept，Messages need reply 还在", await evaluate(`const s = document.querySelector('[data-stats-row]'); return !document.querySelector('section[aria-label="My tasks"]') && !${NOTICE} && !document.querySelector('[aria-label="Task reminder"]') && !s.querySelector('[data-stat=tasks]') && !s.querySelector('[data-stat=handovers]') && !!s.querySelector('[data-stat=messages]');`), await evaluate("return document.querySelector('[data-stats-row]')?.textContent;"));
  await ctl({ reset: true, gates: "open", superadmin: false, admin: false, gateVis: {} });

  // ── 后端没上线（404，就是现在真实的情况）：整块安静收起，不挡其余 Dashboard ──
  // ── 任务块按 tasks.view_own 显示（后端 d7 d51b9111：/api/tasks/today 只认它）──
  await ctl({ reset: true, me: "lizzie", supervisor: false, admin: false, superadmin: false, notices: false, gates: "open", gateVis: {}, perms: ["dashboard.view", "tasks.view_all"] });
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('section[aria-label=\"My shortcuts\"]')");
  await sleep(1500);
  await helpers();
  check("权限开着、只勾 tasks.view_all（没有 view_own）：不出任务块、统计行没有 Tasks remaining", await evaluate("return !$tasksSection() && !document.querySelector('[data-stat=tasks]');"));
  await ctl({ perms: ["dashboard.view", "tasks.view_own"] });
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('section[aria-label=\"My tasks\"]')");
  check("勾了 tasks.view_own：任务块照常（员工样子不变）", await evaluate("return !!document.querySelector('section[aria-label=\"My tasks\"]');"));
  await ctl({ perms: null });

  await ctl({ reset: true, notReady: true, failGet: false, fail401: false });
  await goto(`${APP}/dashboard`);
  await waitFor("document.body.textContent.includes('My shortcuts')");
  await helpers();
  check("Dashboard 其余部分照常显示，任务框安静收起（不写错误、不占位）", await evaluate("return document.body.textContent.includes('My shortcuts') && !document.querySelector('section[aria-label=\"My tasks\"]') && !document.querySelector('section[aria-label=\"Today\\'s tasks\"]') && !document.body.textContent.includes('Could not load today');"));

  // ── 500：错误提示 + 不影响页面其余部分 ──
  await ctl({ reset: true, notReady: false, failGet: true, fail401: false });
  from = (await mockLog()).length;
  await goto(`${APP}/dashboard`);
  await waitFor("document.body.textContent.includes('Could not load')");
  check("接口 500：写 Could not load today's tasks", await evaluate("return document.body.textContent.includes(\"Could not load today\\u2019s tasks\");"));

  // ── 401：跳旧后台登录页 ──
  await ctl({ reset: true, notReady: false, failGet: false, fail401: true });
  await goto(`${APP}/dashboard`);
  await waitFor("location.href.includes('/auth/login')", 8000);
  check("401 跳登录页，带 next", await evaluate("return location.href.includes('/auth/login') && location.href.includes('next=');"), await evaluate("return location.href;"));
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, "chrome-profile")}`,
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
