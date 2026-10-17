// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /schedule（Staff Schedule，排班阶段二，拖拽版）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
// 原生 HTML5 拖拽在 headless 里不好可靠模拟，这里主要测「点人再点格子」——跟手机走的是同一套逻辑
// （见 components/schedule/week-grid.tsx 的 onPlace），测这条就等于两条路径都测了。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:3198";
const MOCK = "http://localhost:8799";
const PORT = 9333;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  → ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ctl(body) {
  await fetch(`${MOCK}/__ctl`, { method: "POST", body: JSON.stringify(body) });
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
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().includes(text));
window.$btns = (text, root=document) => [...root.querySelectorAll('button')].filter(b => b.textContent.trim().includes(text));
window.$setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : (el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage(url) {
  await goto(url);
  await waitFor("document.body.innerText.includes('Staff Schedule')");
  await helpers();
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(__dirname, "chrome-profile")}`,
    "--window-size=1600,1100",
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

/** 每天的时段卡片容器（按出现顺序就是 Sun..Sat 第 dayIndex 天），第 slotIndex 张卡片。 */
function slotSelector(dayIndex, slotIndex) {
  return `document.querySelectorAll('.sch-week-grid > div')[${dayIndex}].querySelectorAll('[class*="min-h-"]')[${slotIndex}]`;
}

async function run() {
  // ── supervisor：验收数据（10/4–10/10）：周一有空档、不能发布 ──
  await ctl({ role: "supervisor", fail401: false });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${slotSelector(0, 0)}`);

  check(
    "页头工作时段",
    (await evaluate("return document.body.innerText;")).includes("2:00 AM – 9:30 PM"),
  );
  check("地址栏带上 ?week=", (await evaluate("return location.search;")) === "?week=2026-10-04");
  check(
    "周范围显示 Oct 4 – Oct 10, 2026",
    (await evaluate("return document.body.innerText;")).includes("Oct 4 – Oct 10, 2026"),
  );
  check(
    "名单条按顺序显示 5 个员工",
    (await evaluate(`
      const bar = [...document.querySelectorAll('div')].find(d => d.firstElementChild && d.firstElementChild.textContent.trim() === 'Employees');
      return [...bar.querySelectorAll('button')].map(b => b.textContent.trim()).join(',');
    `)) === "Veronica,Lizzie,Nadia,Jing,Anita",
  );

  check(
    "发布按钮一开始是灰的、写着 1 day with gaps",
    (await evaluate("return document.body.innerText;")).includes("1 day with gaps") &&
      (await evaluate("return $btn('Publish').disabled;")),
  );

  // 验收第 5 条：绕过前端直接调发布接口，有空档一样被拒，并带上哪几天哪些时段。
  const directPublish = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04/publish`, { method: "POST" })).json();
  check(
    "直接调发布接口（绕过页面）同样 400 + 带空档",
    Array.isArray(directPublish.gaps) &&
      directPublish.gaps.some((g) => g.date === "2026-10-05" && g.start_time === "17:00" && g.end_time === "21:30"),
    JSON.stringify(directPublish),
  );

  // 周一（第二天，index 1）第三张卡片（index 2）是 Jing 的 Close，时间打错，标黄。
  const monCloseSel = slotSelector(1, 2);
  check(
    "周一 Jing 的时段标黄警告",
    await evaluate(`return ${monCloseSel}.className.includes('amber');`),
  );
  check("周一 Jing 的时段写着 11:30 PM", (await evaluate(`return ${monCloseSel}.textContent;`)).includes("11:30 PM"));

  // 点时间（唯一带 font-mono 的按钮），改成 11:30 AM，Save。
  await evaluate(`${monCloseSel}.querySelector('button.font-mono').click();`);
  await waitFor(`${monCloseSel}.querySelector('input[type=time]')`);
  await evaluate(`
    const input = ${monCloseSel}.querySelector('input[type=time]');
    $setValue(input, '11:30');
  `);
  await evaluate(`$btn('Save', ${monCloseSel}).click();`);

  check(
    "改完存上，周一的空档消失、Publish 变可点",
    await waitFor(`!document.body.innerText.includes('day with gaps') && !$btn('Publish').disabled`),
  );

  const weekAfterFix = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check(
    "服务端这一周的 gaps 数组真的空了",
    Array.isArray(weekAfterFix.gaps) && weekAfterFix.gaps.length === 0,
    JSON.stringify(weekAfterFix.gaps),
  );

  // ── 验收第 7 条：10/7（周三）Day timeline 的重叠和空档 ──
  await evaluate(`$btn('Wed').click();`);
  await sleep(200);
  const timelineText = await evaluate("return document.body.innerText;");
  check(
    "10/7 显示 Veronica + Lizzie 重叠",
    timelineText.includes("Veronica + Lizzie") && timelineText.includes("9:30") && timelineText.includes("10:00"),
  );
  check(
    "10/7 显示 Lizzie + Nadia 重叠",
    timelineText.includes("Lizzie + Nadia") && timelineText.includes("1:30") && timelineText.includes("5:30"),
  );
  check("10/7 没有空档", timelineText.includes("Gaps: none — fully covered"));

  // ── 点人再点格子：把 Lizzie 放到周一 Close（原来是 Jing），验证挪人逻辑 ──
  await evaluate(`$btn('Lizzie').click();`); // 名单条里的 Lizzie（不在任何 origin slot）
  await waitFor("document.body.innerText.includes('Lizzie selected')");
  await evaluate(`${monCloseSel}.click();`);
  check(
    "点人再点格子：周一 Close 换成 Lizzie",
    await waitFor(`${monCloseSel}.textContent.includes('Lizzie')`),
  );

  // ── 选中人之后换周：WeekGrid 要整个重挂载，不能带着上一周的「选中谁」「哪个时段在改时间」跑到新的一周 ──
  await evaluate(`$btn('Nadia').click();`);
  await waitFor("document.body.innerText.includes('Nadia selected')");
  await evaluate(`document.querySelector('[aria-label="Next week"]').click();`);
  check(
    "换周后选中状态清掉了（不再显示 selected 提示）",
    await waitFor("!document.body.innerText.includes('Nadia selected')"),
  );
  await evaluate(`document.querySelector('[aria-label="Previous week"]').click();`);
  await waitFor(`${slotSelector(0, 0)}`);

  // ── 加时段 / 删时段（总共 3 种：Open / Mid / Close）──
  await evaluate(`[...document.querySelectorAll('.sch-week-grid > div')[6].querySelectorAll('button')].find(b => b.textContent.trim() === '+ slot').click();`);
  await waitFor(`[...document.querySelectorAll('.sch-week-grid > div')[6].querySelectorAll('button')].some(b => b.textContent.includes('Mid'))`);
  await evaluate(`[...document.querySelectorAll('.sch-week-grid > div')[6].querySelectorAll('button')].find(b => b.textContent.includes('Mid')).click();`);
  check(
    "周六加了一个 Mid 时段",
    await waitFor(`[...document.querySelectorAll('.sch-week-grid > div')[6].querySelectorAll('span')].some(s => s.textContent.trim() === 'Mid')`),
  );
  check("新加的 Mid 时段还没排人", (await evaluate(`return document.querySelectorAll('.sch-week-grid > div')[6].textContent;`)).includes("needs someone"));

  await evaluate(`
    const col = document.querySelectorAll('.sch-week-grid > div')[6];
    const cards = [...col.querySelectorAll('[class*="min-h-"]')];
    const midCard = cards.find(c => c.textContent.includes('Mid'));
    midCard.querySelector('button[title="Remove this slot"]').click();
  `);
  check(
    "删掉周六的 Mid 时段",
    await waitFor(`![...document.querySelectorAll('.sch-week-grid > div')[6].querySelectorAll('span')].some(s => s.textContent.trim() === 'Mid')`),
  );

  // ── 发布：确认框 → Publish，之后看到通知摘要 ──
  await evaluate("$btn('Publish').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate("$btn('Publish', document.querySelector('[role=dialog]')).click();");
  check("发布成功后显示通知了几个人", await waitFor("document.body.innerText.includes('Published. Notified')"));

  const publishedWeek = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端这一周状态变成 published", publishedWeek.status === "published");

  // 已发布的周：Publish 键还在（后端 -84 2026-10-16 定：编辑已发布的周不自动重发，要通知就再点一次 Publish）。
  check(
    "已发布的周 Publish 键变成 Publish again、还能点",
    await evaluate("return !!$btn('Publish again') && !$btn('Publish again').disabled;"),
  );
  await evaluate("$btn('Publish again').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  check(
    "二次发布的确认框文案提到 again",
    (await evaluate("return document.querySelector('[role=dialog]').textContent;")).includes("again"),
  );
  await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
  check("二次发布成功", await waitFor("document.body.innerText.includes('Published. Notified')"));

  // ── staff：只能看已发布的整周，不能编辑，看不到管理按钮 ──
  await ctl({ role: "staff" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${slotSelector(0, 0)}`);
  check(
    "staff 能看已发布的这一周（不是 403 提示）",
    !(await evaluate("return document.body.innerText;")).includes("hasn't been published"),
  );
  check(
    "staff 看不到名单条 / Publish / Add employee / + slot",
    await evaluate(`
      return !document.body.innerText.includes('EMPLOYEES')
        && !$btn('Publish') && !$btn('Add employee') && !$btn('+ slot');
    `),
  );
  check(
    "staff 点时段卡片没反应（不是 placeable、没有编辑时间的按钮）",
    await evaluate(`return !${slotSelector(0, 0)}.querySelector('button[title="Remove this slot"]');`),
  );

  // 另一周（10/11）还没发布：staff 看到的是「还没发布」提示，不是空表。
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor("document.body.innerText.includes('hasn')");
  check(
    "staff 查还没发布的周：显示提示，不是空表",
    (await evaluate("return document.body.innerText;")).includes("hasn't been published yet"),
  );

  // ── supervisor：新的一周自动照上一周排好（不用先点复制）──
  await ctl({ role: "supervisor" });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor(`${slotSelector(0, 0)}`);
  check(
    "新的一周显示「Started from last week」",
    (await evaluate("return document.body.innerText;")).includes("Started from last week"),
  );
  check(
    "周日那格照抄上一周：Veronica Open 2:00–12:00",
    (await evaluate(`return ${slotSelector(0, 0)}.textContent;`)).includes("Veronica") &&
      (await evaluate(`return ${slotSelector(0, 0)}.textContent;`)).includes("2:00 AM"),
  );
  const weekFromServer = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-11`)).json();
  check("服务端 copied_from 指向 2026-10-04", weekFromServer.copied_from === "2026-10-04");

  // ── Add employee ──
  await waitFor("$btn('Add employee')");
  await evaluate("$btn('Add employee').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate(`
    const dlg = document.querySelector('[role=dialog]');
    $setValue(dlg.querySelector('input[type=text]'), 'ZZ Test Helper');
  `);
  await evaluate("document.querySelector('[role=dialog] button[type=submit]').click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  check(
    "新加的员工出现在名单条里",
    await waitFor("$btn('ZZ Test Helper')"),
  );

  // ── superadmin 能改工作时段，别的角色看不到 Edit ──
  await ctl({ role: "admin" });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  check("admin 看不到 Edit 工作时段的入口", !(await evaluate("return document.body.innerText;")).includes("Edit"));

  await ctl({ role: "superadmin" });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await evaluate("$btn('Edit').click();");
  await waitFor("document.querySelectorAll('input[type=time]').length === 2");
  await evaluate(`
    const inputs = document.querySelectorAll('input[type=time]');
    $setValue(inputs[0], '03:00');
  `);
  await evaluate("$btn('Save').click();");
  check(
    "superadmin 改工作时段后立即生效（页头跟着变成 3:00 AM）",
    await waitFor("document.body.innerText.includes('3:00 AM')"),
  );

  // 401：跳旧后台登录页。
  await ctl({ fail401: true, role: "superadmin" });
  await goto(`${APP}/schedule`);
  check(
    "未登录跳旧后台登录页，带 next",
    await waitFor("location.pathname === '/auth/login' && location.search.includes('next=')"),
  );
}

main();
