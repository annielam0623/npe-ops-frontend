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
  check("标题：My tasks · 9:30 AM–5:30 PM（后端 24 小时 09:30 转成 12 小时）· now 3:30 PM", await evaluate("return $tasksSection().querySelector('h2').textContent.includes('My tasks · 9:30 AM–5:30 PM') && $tasksSection().querySelector('h2').textContent.includes('now 3:30 PM');"), await evaluate("return $tasksSection().querySelector('h2').textContent;"));
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
  check("My tasks 的任务区有竖向细滚动条（overflow-y: auto，scrollbar-width: thin）", await evaluate(`const tl = $tasksSection().querySelector('[data-period-cards]').parentElement; const s = getComputedStyle(tl); return s.overflowY === 'auto' && s.scrollbarWidth === 'thin';`));
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
  await evaluate("$setValue($q('textarea', $dialog()), 'Still waiting on the bus list from Discord.');");
  await evaluate("$btn('Pass over', $dialog()).click();");
  await sleep(700);
  reqs = await since(from, (e) => e.method === "POST" && /\/pass-over$/.test(e.path));
  check("Pass over 提交调 POST …/pass-over，带 note", reqs.length === 1 && reqs[0].body?.note === "Still waiting on the bus list from Discord.", JSON.stringify(reqs));
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
  check("Notice 横排：交接排第一（Annie 2026-10-25「交接排第一」），5 条各一张独立的卡，写 5 new，没有 +N more / Show all", await evaluate(`const t = ${NOTICE}.textContent; const lis = [...${NOTICE}.querySelectorAll('li')]; return lis.length === 5 && lis[0].dataset.noticeKind === 'handover' && t.includes('5 new') && !t.includes('more') && !t.includes('Show all');`), await evaluate(`return ${NOTICE}.textContent;`));
  check("Notice 横排：交接之后的通知按时间倒序（最新在最前）：Fri Oct 23 → Thu Oct 22 → Wed Oct 21 → Oct 18 – Oct 24 那周发布", await evaluate(`const lis = [...${NOTICE}.querySelectorAll('li')].slice(1); return lis.length === 4 && lis[0].textContent.includes('Fri Oct 23') && lis[1].textContent.includes('Thu Oct 22') && lis[2].textContent.includes('Wed Oct 21') && lis[3].textContent.includes('Oct 18 – Oct 24');`));
  check("Notice 横排：卡并排成一行、每张宽 330px 不被挤变形，底部有横向细滚动条（5 张超出一屏就能向右拖）", await evaluate(`const ul = ${NOTICE}.querySelector('[data-notice-row]'); const lis = [...ul.querySelectorAll('li')]; const tops = lis.map((l) => Math.round(l.getBoundingClientRect().top)); const s = getComputedStyle(ul); return lis.every((l) => Math.round(l.getBoundingClientRect().width) === 330) && new Set(tops).size === 1 && s.overflowX === 'auto' && s.scrollbarWidth === 'thin' && ul.scrollWidth > ul.clientWidth + 100 && lis[0].getBoundingClientRect().left < lis[1].getBoundingClientRect().left;`));
  await evaluate(`const ul = ${NOTICE}.querySelector('[data-notice-row]'); ul.scrollLeft = ul.scrollWidth;`);
  await sleep(200);
  check("横条往右移：最后一张卡能完整看到", await evaluate(`const ul = ${NOTICE}.querySelector('[data-notice-row]'); const last = [...ul.querySelectorAll('li')].pop().getBoundingClientRect(); const box = ul.getBoundingClientRect(); return ul.scrollLeft > 0 && last.right <= box.right + 1;`));
  await evaluate(`${NOTICE}.querySelector('[data-notice-row]').scrollLeft = 0;`);


  check("5 条都在；3 天前那条时间前面带星期，今天的只写钟点", await evaluate(`const lis = [...${NOTICE}.querySelectorAll('li')]; const old = lis.find(l => l.textContent.includes('Oct 18 – Oct 24')); const today = lis.find(l => l.textContent.includes('Oct 23')); return lis.length === 5 && /(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \\d{1,2}:\\d{2} (AM|PM)/.test(old.textContent) && /\\d{1,2}:\\d{2} (AM|PM)/.test(today.textContent) && !/(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \\d{1,2}:\\d{2}/.test(today.textContent);`));
  check("排班提醒的正文按文本显示（换行保留），没有正文的不画空行", await evaluate(`const lis = [...${NOTICE}.querySelectorAll('li')]; const a = lis.find(l => l.textContent.includes('Oct 23')); const b = lis.find(l => l.textContent.includes('Oct 22')); return a.textContent.includes('you were added.') && a.textContent.includes('you were removed.') && !!a.querySelector('p.whitespace-pre-line') && !b.querySelector('p.whitespace-pre-line');`));
  check("排班提醒有 See my schedule 链接（去 /schedule）和 Got it", await evaluate(`const li = [...${NOTICE}.querySelectorAll('li')].find(l => l.textContent.includes('Oct 23')); const a = li.querySelector('a'); return !!a && a.textContent.includes('See my schedule') && a.getAttribute('href').includes('schedule') && !!$btn('Got it', li);`));
  from = (await mockLog()).length;
  await evaluate(`$btn('Got it', [...${NOTICE}.querySelectorAll('li')].find(l => l.textContent.includes('Oct 23'))).click();`);
  await sleep(500);
  check("点 Got it：调 POST /api/notices/4/read，这一条从面板拿掉，4 new", (await since(from, (e) => e.method === "POST" && e.path === "/api/notices/4/read")).length === 1 && (await evaluate(`return !${NOTICE}.textContent.includes('Oct 23') && ${NOTICE}.textContent.includes('4 new');`)));
  from = (await mockLog()).length;
  await evaluate(`$btn('Mark all as read', ${NOTICE}).click();`);
  await sleep(500);
  check("Mark all as read：调 POST /api/notices/read-all；排班提醒清空，待接受的交接还在（只能 Accept）", (await since(from, (e) => e.method === "POST" && e.path === "/api/notices/read-all")).length === 1 && (await evaluate(`const t = ${NOTICE}.textContent; return !t.includes('Schedule') && t.includes('Handover') && t.includes('1 new') && !t.includes('Mark all as read');`)));

  // ── Notice：后端 G138 实际发的两类类型字符串 ──
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
  check("标题：Today's tasks · all shifts · now 3:30 PM · 6 of 23 done", await evaluate("const t = $tasksSection().querySelector('h2').textContent; return t.includes(\"Today\\u2019s tasks\") && t.includes('now 3:30 PM') && t.includes('6 of 23 done');"), await evaluate("return $tasksSection().querySelector('h2').textContent;"));
  check("不再按岗位分组：有 All shift 组，没有 Pre-closer / Whole team 标签", await evaluate("const t = $tasksSection().textContent; return t.toUpperCase().includes('ALL SHIFT') && !/Pre-closer|Whole team/i.test(t);"), await evaluate("return $tasksSection().textContent.slice(0, 300);"));
  check("指定给 Veronica 的那条自成一组，写名字和 2:00 AM–10:00 AM", await evaluate("const t = $tasksSection().textContent; return t.includes('Veronica') && t.includes('2:00 AM–10:00 AM');"));
  check("待接受的交接那条写 Passing to Lizzie — not accepted yet", await evaluate("return $tasksSection().textContent.includes('Passing to Lizzie — not accepted yet');"));
  check("交接通知列表：Veronica passed … to Lizzie — waiting for accept", await evaluate("return $tasksSection().textContent.includes('Veronica passed') && $tasksSection().textContent.includes('waiting for accept');"));

  // ── AM / PM 两张卡（Annie 2026-10-24「1 可以，2 上面 3.A 动手」，preview HrofY7AzjRHK6KdfJaC67k 第 2 版）──
  const cardTitles = "[...$tasksSection().querySelectorAll('[data-period]')].map((c) => c.dataset.period).join()";
  check("主管：下午的任务多，上午也有：只有 AM、PM 两张卡（没有 Anytime 条），AM 在左 PM 在右", (await evaluate(`return ${cardTitles};`)) === "am,pm" && (await evaluate("const [a, p] = [...$tasksSection().querySelectorAll('[data-period]')].map((c) => c.getBoundingClientRect()); return a.right <= p.left + 1 && Math.abs(a.top - p.top) < 4;")), await evaluate(`return ${cardTitles};`));
  check("卡片标题 AM · before 12:00 / PM · 12:00 and after，右边是普通灰字 N of M done（不是胶囊，不是蓝色）", await evaluate("const cs = [...$tasksSection().querySelectorAll('[data-period]')]; return cs[0].querySelector('h3').textContent === 'AM' && cs[0].textContent.includes('before 12:00') && cs[1].querySelector('h3').textContent === 'PM' && cs[1].textContent.includes('12:00 and after') && cs.every((c) => { const p = c.querySelector('[data-period-progress]'); const st = getComputedStyle(p); const parts = p.textContent.split(' '); return parts.length === 4 && parts[1] === 'of' && parts[3] === 'done' && st.backgroundColor === 'rgba(0, 0, 0, 0)' && st.borderTopWidth === '0px' && !st.color.includes('59, 130, 246'); });"));
  check("主管 Today's tasks：AM / PM 两张卡各自限高（56vh），卡内竖向细滚动条；PM 卡 18 条超出就滚动，页面不被撑长", await evaluate(`const pm = document.querySelector('[data-period=pm] [data-period-scroll]'); const am = document.querySelector('[data-period=am] [data-period-scroll]'); if (!pm || !am) return false; const s = getComputedStyle(pm); return s.overflowY === 'auto' && s.scrollbarWidth === 'thin' && Math.abs(parseFloat(s.maxHeight) - innerHeight * 0.56) < 1 && pm.scrollHeight > pm.clientHeight + 20 && pm.clientHeight <= innerHeight * 0.56 + 1;`), await evaluate(`const pm = document.querySelector('[data-period=pm] [data-period-scroll]'); return pm ? JSON.stringify([pm.scrollHeight, pm.clientHeight, innerHeight]) : 'none';`));
  check("上午 5 条（6 / 7 / 8 / 10 / 11 点）在 AM 卡，其余在 PM 卡；AM 卡按时间从早到晚", await evaluate("const am = $tasksSection().querySelector('[data-period=am]'); const times = [...am.querySelectorAll('input[type=time]')].map((i) => i.value); return times.length === 5 && times.join() === [...times].sort().join() && times[0] === '06:00' && !am.textContent.includes('Manifest') && $tasksSection().querySelector('[data-period=pm]').textContent.includes('Manifest');"));
  check("每张卡里按人分小标题：PM 卡有 All shift 一组，Veronica 那条（Passing to Lizzie）在她自己的小组、带班次时间", await evaluate("const t = (n) => $tasksSection().querySelector('[data-period=' + n + ']'); const am = t('am'); return !!t('pm').querySelector('[data-person=all-shift]') && !!am.querySelector('[data-person=veronica]') && am.querySelector('[data-person=veronica]').textContent.includes('2:00 AM–10:00 AM') && am.querySelector('[data-person=veronica]').textContent.includes('Passing to Lizzie — not accepted yet');"));
  check("整个 AM + PM 的进度加起来 = 标题里的 6 of 23", await evaluate("const cs = [...$tasksSection().querySelectorAll('[data-period]')]; const m = cs.map((c) => c.querySelector('[data-period-progress]').textContent.split(' ')); return m.reduce((n, x) => n + Number(x[0]), 0) === 6 && m.reduce((n, x) => n + Number(x[2]), 0) === 23;"));
  check("任务行仍只有一个时间（一个 Finish-by 框）", await evaluate("return [...$tasksSection().querySelectorAll('li')].filter((li) => li.querySelector('input[type=checkbox]')).every((li) => li.querySelectorAll('input[type=time]').length === 1);"));

  // 边界：12:00 洛杉矶分界、每小时重复、没有截止时间 → Anytime
  await ctl({ reset: true, edge: true, me: "annie", supervisor: true });
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection() && document.querySelector('[data-period=any]')");
  await helpers();
  check("11:59 AM 的在 AM 卡、12:00 PM 的在 PM 卡（洛杉矶时间）", await evaluate("const t = (n) => $tasksSection().querySelector('[data-period=' + n + ']'); return t('am').textContent.includes('ZZ Edge 11:59 AM') && !t('pm').textContent.includes('ZZ Edge 11:59 AM') && t('pm').textContent.includes('ZZ Edge 12:00 PM') && !t('am').textContent.includes('ZZ Edge 12:00 PM');"));
  check("每小时重复的和没有截止时间的：放在两张卡上面一条虚线 Anytime 卡里，不在 AM / PM 卡里", await evaluate("const a = $tasksSection().querySelector('[data-period=any]'); const am = $tasksSection().querySelector('[data-period=am]'); const pm = $tasksSection().querySelector('[data-period=pm]'); const r = a.getBoundingClientRect(); return a.querySelector('h3').textContent === 'Anytime' && a.textContent.includes('ZZ Hourly check') && a.textContent.includes('ZZ Free task') && !am.textContent.includes('ZZ Hourly check') && !pm.textContent.includes('ZZ Free task') && getComputedStyle(a).borderTopStyle === 'dashed' && r.bottom <= am.getBoundingClientRect().top + 1;"));
  check("Anytime 卡也带 N of M done；没有时间的那条显示 When free", await evaluate("const a = $tasksSection().querySelector('[data-period=any]'); return /^0 of 2 done$/.test(a.querySelector('[data-period-progress]').textContent) && a.textContent.includes('When free');"));
  // 员工视角（Lizzie）：同样 Anytime 在上、AM / PM 两张卡；Pass over 和逾期标红保留
  await ctl({ reset: true, edge: true, me: "lizzie", supervisor: false });
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection() && document.querySelector('[data-period=any]')");
  await helpers();
  const empCards = "[...$tasksSection().querySelectorAll('[data-period]')].map((c) => c.dataset.period).join()";
  check("员工 My tasks：Anytime、AM、PM 三张卡，Anytime 在最上面", (await evaluate(`return ${empCards};`)) === "any,am,pm", await evaluate(`return ${empCards};`));
  check("员工：逾期标红、Pass over 键、勾选都还在（PM 卡里 Send Last mins Confirmation 逾期）", await evaluate("const pm = $tasksSection().querySelector('[data-period=pm]'); const li = [...pm.querySelectorAll('li')].find((l) => l.textContent.includes('Send Last mins Confirmation')); return li.dataset.dueStatus === 'overdue' && [...li.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Pass over') && !!li.querySelector('input[type=checkbox]');"));
  check("员工：每行只有一个时间（By … / Overdue … 小标签），进度是普通灰字", await evaluate("return [...$tasksSection().querySelectorAll('li[data-task-id]')].every((li) => li.querySelectorAll('[data-due-status]').length >= 1) && [...$tasksSection().querySelectorAll('[data-period-progress]')].every((p) => getComputedStyle(p).borderTopWidth === '0px');"));
  // 窄屏：容器不够 640px 宽时 AM 在上、PM 在下
  await evaluate("document.querySelector('[data-period-cards]').style.width = '420px';");
  await sleep(250);
  check("容器窄（420px）：AM 在上、PM 在下（上下叠）", await evaluate("const a = $tasksSection().querySelector('[data-period=am]').getBoundingClientRect(), p = $tasksSection().querySelector('[data-period=pm]').getBoundingClientRect(); return p.top >= a.bottom - 1 && Math.abs(a.left - p.left) < 4;"));
  await evaluate("document.querySelector('[data-period-cards]').style.width = '900px';");
  await sleep(250);
  check("容器宽（900px）：AM 在左、PM 在右并排", await evaluate("const a = $tasksSection().querySelector('[data-period=am]').getBoundingClientRect(), p = $tasksSection().querySelector('[data-period=pm]').getBoundingClientRect(); return a.right <= p.left + 1 && Math.abs(a.top - p.top) < 4;"));
  // 空半边：只有上午任务的人 → 只有 AM 卡，不画空的 PM 卡
  await ctl({ reset: true, me: "veronica", supervisor: false });
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection()");
  await helpers();
  check("一边没有任务：不画空卡（只有 AM 卡，没有 PM、没有 Anytime）", (await evaluate(`return ${empCards};`)) === "am", await evaluate(`return ${empCards};`));
  await ctl({ reset: true, me: "annie", supervisor: true });
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection()");
  await helpers();

  // ── 改截止时间 ──
  from = (await mockLog()).length;
  await evaluate("const li = $li('BZ Lunch'); $setValue(li.querySelector('input[type=time]'), '17:30');");
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
  check("新任务出现在 All shift 组里", await evaluate("return !!$li('ZZ Test one-off task');"));

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
  check("新任务出现在 Lizzie 的分组里（不在 All shift）", await evaluate("const li = $li('ZZ Test for Lizzie'); if (!li) return false; const grp = li.closest('ul').previousElementSibling; return !!grp && grp.textContent.includes('Lizzie');"));
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

  // ── 后端没上线（404，就是现在真实的情况）：整块安静收起，不挡其余 Dashboard ──
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
