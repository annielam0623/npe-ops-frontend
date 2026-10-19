// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /schedule（Staff Schedule，排班阶段二，拖拽版）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
// 原生 HTML5 拖拽在 headless 里不好可靠模拟，这里主要测「点人再点格子」——跟手机走的是同一套逻辑
// （见 components/schedule/week-grid.tsx 的 onPlace），测这条就等于两条路径都测了。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT || 9333);

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
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, "chrome-profile")}`,
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

const cell = (key) => `document.querySelector('[data-cell="${key}"]')`;
const rowNames = `[...document.querySelectorAll('[data-sch-grid] .sticky')].map(e => e.textContent.trim())`;

async function run() {
  // ── supervisor：验收数据（10/4–10/10）：周一有空档、不能发布 ──
  await ctl({ role: "supervisor", fail401: false, meName: "" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")}`);
  const text = () => evaluate("return document.body.innerText;");

  check("页头工作时段", (await text()).includes("2:00 AM – 9:30 PM"));
  check("地址栏带上 ?week=", (await evaluate("return location.search;")) === "?week=2026-10-04");
  check("周范围显示 Oct 4 – Oct 10, 2026", (await text()).includes("Oct 4 – Oct 10, 2026"));
  check(
    "一行一个人：Unassigned 在最上面，后面 5 个人按名单顺序",
    (await evaluate(`return ${rowNames}[0];`)).startsWith("Unassigned") &&
      (await evaluate(`return ${rowNames}.slice(1).map(t => t).join(',');`)) === "Veronica,Lizzie,Nadia,Jing,Anita",
  );
  check("没有「You」标签", !(await text()).includes("You"));
  check("没有旧的名单条（表格里没有 Employees 名单条；Employees 只是页头的一个按钮）", await evaluate("return !document.querySelector('[data-sch-grid]').textContent.toUpperCase().includes('EMPLOYEES') && !!$btn('Employees');"));
  check("名字下面没有「N days」，名字字号 17px", (await evaluate(`return ${rowNames}[1];`)) === "Veronica" && (await evaluate(`const n = [...document.querySelectorAll('[data-sch-grid] .sticky')][1].querySelector('span span:last-child'); return getComputedStyle(n).fontSize;`)) === "17px");
  check(
    "Staff 表头和名字文字左边对齐（偏差 ≤ 1px）",
    await evaluate(`
      const head = document.querySelector('[data-sch-grid] > div > div');
      const nameEl = [...document.querySelectorAll('[data-sch-grid] .sticky')][1].querySelector('span span:last-child');
      const hr = document.createRange(); hr.selectNodeContents(head);
      const nr = document.createRange(); nr.selectNodeContents(nameEl);
      return Math.abs(hr.getBoundingClientRect().left - nr.getBoundingClientRect().left) <= 1;
    `),
  );
  check(
    "发布按钮一开始是灰的、写着 1 day with gaps",
    (await text()).includes("1 day with gaps") && (await evaluate("return $btn('Publish').disabled;")),
  );

  // 验收第 5 条：绕过前端直接调发布接口，有空档一样被拒；后端形状 {detail:{detail,gaps}}。
  const directPublish = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04/publish`, { method: "POST" })).json();
  check(
    "直接调发布接口（绕过页面）同样 400 + 带空档（detail.gaps）",
    Array.isArray(directPublish.detail?.gaps) &&
      directPublish.detail.gaps.some((g) => g.date === "2026-10-05" && g.start_time === "17:00" && g.end_time === "21:30"),
    JSON.stringify(directPublish),
  );

  // 没有班的格子是浅黄色 Off（色卡 A），Unassigned 行的空格不是。
  check(
    "没有班的人 / 天：浅黄 Off 格（周日 Jing 没班）",
    await evaluate(`const o = ${cell("4|2026-10-04")}.querySelector('[data-off]'); return !!o && o.textContent.trim() === 'Off' && getComputedStyle(o).color === 'rgb(253, 230, 138)';`),
  );
  check("Unassigned 行的空格不画 Off", await evaluate(`return !${cell("needs|2026-10-04")}.querySelector('[data-off]');`));
  check("有班的格子没有 Off", await evaluate(`return !${cell("1|2026-10-04")}.querySelector('[data-off]');`));

  // 周一 Jing(4) 的 Close 时间打错，标黄。
  const jingMon = `${cell("4|2026-10-05")}.querySelector('[data-slot-id]')`;
  check("周一 Jing 的时段标黄警告", await evaluate(`return ${jingMon}.className.includes('amber');`));
  check("周一 Jing 的时段写着 11:30 PM", (await evaluate(`return ${jingMon}.textContent;`)).includes("11:30 PM"));

  // 点时间，改成 11:30 AM，Save。
  await evaluate(`${jingMon}.querySelector('button.font-mono').click();`);
  await waitFor(`${jingMon}.querySelector('input[type=time]')`);
  await evaluate(`$setValue(${jingMon}.querySelector('input[type=time]'), '11:30');`);
  await evaluate(`$btn('Save', ${jingMon}).click();`);
  check(
    "改完存上，周一的空档消失、Publish 变可点",
    await waitFor(`!document.body.innerText.includes('day with gaps') && !$btn('Publish').disabled`),
  );
  const weekAfterFix = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端这一周的 gaps 数组真的空了", Array.isArray(weekAfterFix.gaps) && weekAfterFix.gaps.length === 0);

  // ── Day timeline：10/7（周三）重叠 ──
  await evaluate(`$btn('Wed').click();`);
  await sleep(200);
  const timelineText = await text();
  check("10/7 显示 Veronica + Lizzie 重叠", timelineText.includes("Veronica + Lizzie"));
  check("10/7 显示 Lizzie + Nadia 重叠", timelineText.includes("Lizzie + Nadia"));
  check("10/7 没有空档", timelineText.includes("Gaps: none — fully covered"));

  // ── 点卡片再点同一天别人的格子：Lizzie(2) 周一 Mid → Nadia(3) ──
  const lizMid = `${cell("2|2026-10-05")}.querySelector('[data-slot-id]')`;
  const lizMidId = await evaluate(`return Number(${lizMid}.dataset.slotId);`);
  await evaluate(`${lizMid}.click();`);
  await waitFor("document.body.innerText.includes('Card selected')");
  await evaluate(`${cell("3|2026-10-05")}.click();`);
  check(
    "点卡片再点同一天别人的格子：Mid 换成 Nadia",
    await waitFor(`${cell("3|2026-10-05")}.textContent.includes('Mid') && !${cell("2|2026-10-05")}.textContent.includes('Mid')`),
  );
  let w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端这个时段的 employee_id = 3（只调了 assign，时段 id 没变）", w.slots.find((s) => s.id === lizMidId)?.employee_id === 3);

  // 选中后点别的天的格子：不能放。
  await evaluate(`${cell("3|2026-10-05")}.querySelector('[data-slot-id]').click();`);
  await waitFor("document.body.innerText.includes('Card selected')");
  check("选中后别的天的格子点不了（没有 targetable 外框）", await evaluate(`return !${cell("3|2026-10-06")}.className.includes('outline');`));
  // 点 Unassigned 同一天的格子 = 清空。
  await evaluate(`${cell("needs|2026-10-05")}.click();`);
  check("点 Unassigned 的格子：这个时段清空", await waitFor(`${cell("needs|2026-10-05")}.textContent.includes('Mid')`));
  w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端 employee_id = null", w.slots.find((s) => s.id === lizMidId)?.employee_id === null);

  // 拖拽（原生 drop 事件）：把它拖回 Lizzie。
  await evaluate(`
    const dt = new DataTransfer();
    dt.setData('text/slot', '${lizMidId}');
    ${cell("2|2026-10-05")}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    ${cell("2|2026-10-05")}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  `);
  check("拖到 Lizzie 的格子：换回 Lizzie", await waitFor(`${cell("2|2026-10-05")}.textContent.includes('Mid')`));
  // 拖到别的天：不动。
  await evaluate(`
    const dt = new DataTransfer();
    dt.setData('text/slot', '${lizMidId}');
    ${cell("2|2026-10-06")}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  `);
  await sleep(400);
  w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  const lizSlot = w.slots.find((s) => s.id === lizMidId);
  check("拖到别的天：时段还在原来的人和日期", lizSlot?.employee_id === 2 && lizSlot?.date === "2026-10-05");
  await waitFor("!$btn('Publish').disabled");

  // ── 选中卡片后换周：选中状态清掉 ──
  await evaluate(`${cell("2|2026-10-05")}.querySelector('[data-slot-id]').click();`);
  await waitFor("document.body.innerText.includes('Card selected')");
  await evaluate(`document.querySelector('[aria-label="Next week"]').click();`);
  check("换周后选中状态清掉了", await waitFor("!document.body.innerText.includes('Card selected')"));
  await evaluate(`document.querySelector('[aria-label="Previous week"]').click();`);
  await waitFor(`${cell("1|2026-10-04")}`);

  // ── 加时段：点 + 打开「Add shift」窗口：选班次、填时间、可以勾多天（Annie 2026-10-18）──
  const needsSat = cell("needs|2026-10-10");
  const dlg = "document.querySelector('[role=dialog]')";
  await evaluate(`${needsSat}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add shift')`);
  check("Unassigned 的加班窗口标题写 Unassigned，默认勾上点的那一天（Sat 10/10）", await evaluate(`return ${dlg}.textContent.includes('Unassigned') && ${dlg}.querySelectorAll('[data-day][aria-pressed=true]').length === 1 && ${dlg}.querySelector('[data-day="2026-10-10"]').getAttribute('aria-pressed') === 'true';`));
  check("时间默认是工作时段 02:00 – 21:30", await evaluate(`const t = ${dlg}.querySelectorAll('input[type=time]'); return t[0].value === '02:00' && t[1].value === '21:30';`));
  await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.trim() === 'Mid').click();`);
  await evaluate(`$btn('Add shift', ${dlg}).click();`);
  check("Unassigned 周六加了一个 Mid 时段", await waitFor(`${needsSat}.textContent.includes('Mid')`));
  check("新时段的时间 = 工作时段 2:00 AM – 9:30 PM", (await evaluate(`return ${needsSat}.textContent;`)).includes("2:00 AM – 9:30 PM"));
  check("Unassigned 里的时段是红色虚线", await evaluate(`return ${needsSat}.querySelector('[data-slot-id]').className.includes('border-dashed');`));

  // 在 Anita(5) 的周六格里加一个 Close，自己填时间 8:00–17:00 ⇒ 先建再派给 Anita。
  const anitaSat = cell("5|2026-10-10");
  await evaluate(`${anitaSat}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Anita')`);
  await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.trim() === 'Close').click();`);
  await evaluate(`const t = ${dlg}.querySelectorAll('input[type=time]'); $setValue(t[0], '08:00'); $setValue(t[1], '17:00');`);
  await evaluate(`$btn('Add shift', ${dlg}).click();`);
  check("在 Anita 的格子里加的 Close 直接是她的、时间是自己填的 8:00 AM – 5:00 PM", await waitFor(`${anitaSat}.querySelectorAll('[data-slot-id]').length === 2 && ${anitaSat}.textContent.includes('8:00 AM – 5:00 PM')`));
  w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端：新 Close 的 employee_id = 5、时间 08:00–17:00", w.slots.filter((s) => s.date === "2026-10-10" && s.shift_type === "close" && s.employee_id === 5 && s.start_time === "08:00" && s.end_time === "17:00").length === 1);

  // 一次勾好几天：Anita 周日 / 周一 / 周二都加同一个 Mid 8:00–17:00（她这三天原来是 Off）。点「Recent」里的 8:00–17:00 一下就填好。
  const anitaSun = cell("5|2026-10-04");
  await evaluate(`${anitaSun}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.querySelector('[data-recent-shift]')`);
  check("加班窗口上面有 Recent：Anita 刚用过的 Close · 8:00 AM – 5:00 PM", await evaluate(`return [...${dlg}.querySelectorAll('[data-recent-shift]')].some(b => b.textContent.includes('8:00 AM – 5:00 PM'));`));
  await evaluate(`[...${dlg}.querySelectorAll('[data-recent-shift]')].find(b => b.textContent.includes('8:00 AM – 5:00 PM')).click();`);
  await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.trim() === 'Mid').click();`);
  await evaluate(`${dlg}.querySelector('[data-day="2026-10-05"]').click(); ${dlg}.querySelector('[data-day="2026-10-06"]').click();`);
  check("勾了三天，按钮写 Add 3 shifts、时间被 Recent 填成 08:00 – 17:00", await evaluate(`const t = ${dlg}.querySelectorAll('input[type=time]'); return !!$btn('Add 3 shifts', ${dlg}) && t[0].value === '08:00' && t[1].value === '17:00';`));
  await evaluate(`$btn('Add 3 shifts', ${dlg}).click();`);
  check("三天都加上了（周日 / 周一 / 周二 Anita 都有 Mid 8:00 AM – 5:00 PM）", await waitFor(`['2026-10-04','2026-10-05','2026-10-06'].every((d) => { const c = document.querySelector('[data-cell="5|' + d + '"]'); return c && c.textContent.includes('Mid') && c.textContent.includes('8:00 AM – 5:00 PM'); })`));
  w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端：Anita 这三个 Mid 都是 08:00–17:00", w.slots.filter((s) => s.employee_id === 5 && s.shift_type === "mid" && s.start_time === "08:00" && s.end_time === "17:00").length === 3);
  const anitaExtraIds = w.slots.filter((s) => s.employee_id === 5 && s.shift_type === "mid" && s.start_time === "08:00").map((s) => s.id);
  for (const id of anitaExtraIds) {
    await evaluate(`document.querySelector('[data-slot-id="${id}"] button[title="Remove this shift"]').click();`);
    await sleep(250);
  }
  check("测完把这三个 Mid 删掉", await waitFor(`![...document.querySelectorAll('[data-slot-id]')].some(e => ['2026-10-04','2026-10-05','2026-10-06'].some(d => e.closest('[data-cell]')?.dataset.cell === '5|' + d) && e.textContent.includes('Mid'))`));

  // 删时段：先删 Needs 里的 Mid，再删 Anita 多出来的 Close。
  await evaluate(`${needsSat}.querySelector('button[title="Remove this shift"]').click();`);
  check("删掉 Needs 里的 Mid", await waitFor(`!${needsSat}.textContent.includes('Mid')`));
  await evaluate(`${anitaSat}.querySelectorAll('[data-slot-id]')[1].querySelector('button[title="Remove this shift"]').click();`);
  check("删掉 Anita 多出来的 Close", await waitFor(`${anitaSat}.querySelectorAll('[data-slot-id]').length === 1`));

  // ── Employees：补邮箱 / 改名 / 停用 / 加人（Annie 2026-10-18）──
  await evaluate("$btn('Employees').click();");
  await waitFor("document.querySelector('[role=dialog] [data-employee-row]')");
  check("Employees 窗口列出 5 个人，都有邮箱（没有 No email 提示）", await evaluate(`
    const d = document.querySelector('[role=dialog]');
    return d.querySelectorAll('[data-employee-row]').length === 5 && !d.querySelector('[data-no-email]');
  `));
  const empRow = (id) => `document.querySelector('[role=dialog] [data-employee-row="${id}"]')`;
  await evaluate(`$btn('Edit', ${empRow(5)}).click();`);
  await waitFor("document.querySelector('[role=dialog] [data-employee-edit]')");
  await evaluate(`$setValue(document.querySelector('[role=dialog] [data-employee-edit] input[type=email]'), '');`);
  await evaluate("$btn('Save', document.querySelector('[role=dialog] [data-employee-edit]')).click();");
  check("Anita 清掉邮箱：这一行出现 No email 提示", await waitFor(`${empRow(5)} && ${empRow(5)}.querySelector('[data-no-email]')`));
  let emps = (await (await fetch(`${MOCK}/api/schedule/employees`)).json()).employees;
  check("服务端 Anita 的邮箱变成 null", emps.find((e) => e.id === 5)?.email === null);
  // 加人
  await evaluate(`
    const f = document.querySelector('[role=dialog] [data-employee-add]');
    $setValue(f.querySelector('input[aria-label="New employee name"]'), 'ZZ Test Dlg');
    $setValue(f.querySelector('input[aria-label="New employee email"]'), 'zzdlg@example.com');
  `);
  await evaluate("$btn('Add', document.querySelector('[role=dialog] [data-employee-add]')).click();");
  check("在窗口里加人：新的一行出现", await waitFor(`[...document.querySelectorAll('[role=dialog] [data-employee-row]')].some(r => r.textContent.includes('ZZ Test Dlg') && r.textContent.includes('zzdlg@example.com'))`));
  // 停用 / 恢复
  const zzId = (await (await fetch(`${MOCK}/api/schedule/employees`)).json()).employees.find((e) => e.name === 'ZZ Test Dlg').id;
  await evaluate(`$btn('Deactivate', ${empRow(zzId)}).click();`);
  check("停用：这一行写 (deactivated)、键变 Reactivate", await waitFor(`${empRow(zzId)}.textContent.includes('(deactivated)') && !!$btn('Reactivate', ${empRow(zzId)})`));
  emps = (await (await fetch(`${MOCK}/api/schedule/employees?include_inactive=1`)).json()).employees;
  check("服务端 is_active = false", emps.find((e) => e.id === zzId)?.is_active === false);
  await evaluate(`$btn('Reactivate', ${empRow(zzId)}).click();`);
  check("恢复", await waitFor(`!${empRow(zzId)}.textContent.includes('(deactivated)')`));
  // 重复邮箱：后端原话
  await evaluate(`$btn('Edit', ${empRow(zzId)}).click();`);
  await waitFor("document.querySelector('[role=dialog] [data-employee-edit]')");
  await evaluate(`$setValue(document.querySelector('[role=dialog] [data-employee-edit] input[type=email]'), 'veronica@nationalparkexpress.com');`);
  await evaluate("$btn('Save', document.querySelector('[role=dialog] [data-employee-edit]')).click();");
  check("邮箱重复：显示后端原话、编辑框还在", await waitFor("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('already on the schedule roster') && !!document.querySelector('[role=dialog] [data-employee-edit]')"));
  await evaluate("$btn('Cancel', document.querySelector('[role=dialog] [data-employee-edit]')).click();");
  await evaluate(`$btn('Deactivate', ${empRow(zzId)}).click();`);
  await waitFor(`${empRow(zzId)}.textContent.includes('(deactivated)')`);
  await evaluate("$btn('Close', document.querySelector('[role=dialog]')).click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  check("停用的人从排班表里消失", await waitFor(`!${rowNames}.some(t => t.startsWith('ZZ Test Dlg'))`));

  // ── 发布：确认框 → Publish（这周 Anita 有班、没邮箱 ⇒ 弹窗里提醒）──

  await waitFor("!$btn('Publish').disabled");
  await evaluate("$btn('Publish').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  check(
    "Publish 弹窗：这周有人没邮箱时黄色提醒点名（只提醒，Publish 键还能点）",
    await evaluate(`
      const d = document.querySelector('[role=dialog]');
      const w = d.querySelector('[data-publish-no-email]');
      return !!w && w.textContent.includes('Anita') && !w.textContent.includes('Veronica') && !$btn('Publish', d).disabled;
    `),
  );
  await evaluate("$btn('Publish', document.querySelector('[role=dialog]')).click();");
  check("发布成功后显示通知了几个人", await waitFor("document.body.innerText.includes('Published. Notified')"));
  const publishedWeek = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端这一周状态变成 published", publishedWeek.status === "published");
  check(
    "已发布的周 Publish 键变成 Publish again、还能点",
    await evaluate("return !!$btn('Publish again') && !$btn('Publish again').disabled;"),
  );
  await evaluate("$btn('Publish again').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  check("二次发布的确认框文案提到 again", (await evaluate("return document.querySelector('[role=dialog]').textContent;")).includes("again"));
  await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
  check("二次发布成功", await waitFor("document.body.innerText.includes('Published. Notified')"));

  // ── staff：只读，能翻周 ──
  await ctl({ role: "staff", meName: "Jing" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("4|2026-10-05")}`);
  check("staff 能看已发布的这一周（不是 403 提示）", !(await text()).includes("hasn't been published"));
  check(
    "staff 看不到 Publish / Add employee / + / × / Unassigned",
    await evaluate(`
      return !$btn('Publish') && !$btn('Add employee')
        && !document.querySelector('button[aria-label="Add a shift"]')
        && !document.querySelector('button[title="Remove this shift"]')
        && !document.body.innerText.includes('Unassigned');
    `),
  );
  const firstRow = await evaluate(`return ${rowNames}[0];`);
  check("自己（Jing）这一行固定在最上面，只写名字、没有 You", firstRow.startsWith("Jing") && !firstRow.includes("You"));
  check("staff 点时间不能改（时间按钮是 disabled）", await evaluate(`return document.querySelector('[data-slot-id] button.font-mono').disabled;`));
  check("staff 有 This week / Next week 键", await evaluate("return !!$btn('This week') && !!$btn('Next week');"));

  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor("document.body.innerText.includes('hasn')");
  check("staff 查还没发布的周：显示提示，不是空表", (await text()).includes("hasn't been published yet"));

  // ── supervisor：新的一周自动照上一周排好 ──
  await ctl({ role: "supervisor", meName: "" });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor(`${cell("1|2026-10-11")}`);
  check("新的一周显示「Started from last week」", (await text()).includes("Started from last week"));
  check(
    "周日那格照抄上一周：Veronica Open 2:00 AM",
    (await evaluate(`return ${cell("1|2026-10-11")}.textContent;`)).includes("Open") &&
      (await evaluate(`return ${cell("1|2026-10-11")}.textContent;`)).includes("2:00 AM"),
  );
  const weekFromServer = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-11`)).json();
  check("服务端 copied_from 指向 2026-10-04", weekFromServer.copied_from === "2026-10-04");

  // ── Add employee：新员工多一行 ──
  await waitFor("$btn('Add employee')");
  await evaluate("$btn('Add employee').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate(`$setValue(document.querySelector('[role=dialog] input[type=text]'), 'ZZ Test Helper');`);
  await evaluate("document.querySelector('[role=dialog] button[type=submit]').click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  check("新加的员工出现在表里（多一行）", await waitFor(`${rowNames}.some(t => t.startsWith('ZZ Test Helper'))`));

  // ── superadmin 能改工作时段，别的角色看不到 Edit ──
  await ctl({ role: "admin" });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  check("admin 看不到 Edit 工作时段的入口", !(await text()).includes("Edit"));
  await ctl({ role: "superadmin" });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await evaluate("$btn('Edit').click();");
  await waitFor("document.querySelectorAll('input[type=time]').length === 2");
  await evaluate(`$setValue(document.querySelectorAll('input[type=time]')[0], '03:00');`);
  await evaluate("$btn('Save').click();");
  check("superadmin 改工作时段后立即生效（页头变成 3:00 AM）", await waitFor("document.body.innerText.includes('3:00 AM')"));

  // ── Rules 标签 + Auto-fill（Annie 2026-10-18）──
  // 后端没上线（rules 接口 404）⇒ 页面一切照旧，没有 Rules 标签、没有 Auto-fill 键。
  await ctl({ role: "supervisor", meName: "", rulesMissing: true });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor(`${cell("1|2026-10-11")}`);
  check("规则接口 404：没有 Rules 标签、没有 Auto-fill 键（页面照常）", await evaluate("return ![...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Rules') && !$btn('Auto-fill');"), await evaluate("return [...document.querySelectorAll('[role=tab]')].map(b=>b.textContent).join('|') + ' / ' + !!$btn('Auto-fill');"));
  await ctl({ rulesMissing: false });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor(`${cell("1|2026-10-11")} && [...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Rules')`);
  check("规则接口有：出现 Schedule / Rules 两个标签，Auto-fill 灰着（还没有打开的规则）", await evaluate("return ['Schedule', 'Rules'].every((t) => [...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === t)) && !!$btn('Auto-fill') && $btn('Auto-fill').disabled;"), await evaluate("return [...document.querySelectorAll('[role=tab]')].map(b=>b.textContent).join('|') + ' / ' + !!$btn('Auto-fill') + ' / ' + ($btn('Auto-fill')||{}).disabled;"));

  // 规则页：空状态 → 用 + Add rule 加一条「Rest between shifts 12 小时」
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Rules').click();");
  await waitFor("document.querySelector('[data-rules-view]')");
  check("Rules 标签：空状态写 No rules yet", await evaluate("return document.querySelector('[data-rules-view]').textContent.includes('No rules yet');"));
  await evaluate("$btn('Add rule').click();");
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add rule')`);
  await evaluate(`$setValue(${dlg}.querySelector('select[aria-label="Rule type"]'), 'min_rest');`);
  await waitFor(`${dlg}.querySelector('input[aria-label="hours"]')`);
  check("Rest between shifts：预览句子写 At least 12 hours between two shifts", await evaluate(`return ${dlg}.querySelector('[data-rule-preview]').textContent.includes('At least 12 hours between two shifts');`));
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  check("保存后列表里出现这条规则、开关是开的", await waitFor("document.querySelector('[data-rules-view]').textContent.includes('At least 12 hours between two shifts') && document.querySelector('[data-rule-row] [role=switch]').getAttribute('aria-checked') === 'true'"));
  let rulesDoc = await (await fetch(`${MOCK}/api/schedule/rules`)).json();
  check("服务端存了 1 条 min_rest、hours = 12", rulesDoc.rules.length === 1 && rulesDoc.rules[0].type === "min_rest" && rulesDoc.rules[0].params.hours === 12);
  await evaluate("document.querySelector('[data-rule-row] [role=switch]').click();");
  check("关掉开关：开关变灰", await waitFor("document.querySelector('[data-rule-row] [role=switch]').getAttribute('aria-checked') === 'false'"));
  rulesDoc = await (await fetch(`${MOCK}/api/schedule/rules`)).json();
  check("服务端 enabled 真的变 false", rulesDoc.rules[0].enabled === false);
  await evaluate("$btn('Edit', document.querySelector('[data-rule-row]')).click();");
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Edit rule')`);
  await evaluate(`$setValue(${dlg}.querySelector('input[aria-label="hours"]'), '10');`);
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  check("编辑：改成 10 小时", await waitFor("document.querySelector('[data-rules-view]').textContent.includes('At least 10 hours between two shifts')"));
  await evaluate("$btn('Delete', document.querySelector('[data-rule-row]')).click();");
  await waitFor(`${dlg}`);
  await evaluate(`$btn('Delete', ${dlg}).click();`);
  check("删除：列表回到空状态", await waitFor("document.querySelector('[data-rules-view]').textContent.includes('No rules yet')"));

  // 把 Annie 说的那套规则整份存进去（直接调接口，页面里的各种表单上面已经走过一遍）
  const R = (id, type, params, enabled = true) => ({ id, type, enabled, params });
  const fullRules = [
    R("t1", "shift_times", { shift_type: "open", start: "02:00", end: "10:00" }),
    R("t2", "shift_times", { shift_type: "mid", start: "08:00", end: "17:00" }),
    R("t3", "shift_times", { shift_type: "close", start: "13:30", end: "21:30" }),
    R("f1", "fixed_shift", { employee_id: 1, days: [1, 2, 3, 4, 5], shift_type: "open" }),
    R("w1", "weekend_rotation", { slots: [{ day: 6, shift_type: "open" }, { day: 6, shift_type: "close" }, { day: 0, shift_type: "open" }, { day: 0, shift_type: "close" }], employee_ids: [2, 3, 4, 5] }),
    R("d1", "days_per_week", { mode: "exactly", n: 5 }),
    R("g1", "min_rest", { hours: 12 }),
    R("c1", "coverage", { shift_type: "open", min: 1 }),
    R("c2", "coverage", { shift_type: "close", min: 1 }),
  ];
  const put = await fetch(`${MOCK}/api/schedule/rules`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, rules: fullRules }) });
  check("整份规则存进去", put.ok);
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor(`${cell("1|2026-10-11")} && [...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Rules')`);
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Rules').click();");
  await waitFor("document.querySelector('[data-rules-view]')");
  const rulesText = await evaluate("return document.querySelector('[data-rules-view]').textContent;");
  check("规则列表里每条都是人话（Veronica always works Open on Mon–Fri / Weekend rotation / exactly 5 days / Close coverage）", rulesText.includes("Veronica always works Open on Mon–Fri") && rulesText.includes("Sat Open, Sat Close, Sun Open, Sun Close") && rulesText.includes("Everyone works exactly 5 days a week") && rulesText.includes("Every day has at least 1 Close"), rulesText.slice(0, 400));

  // 员工只读：看得到规则，没有 Add rule / Edit / Delete，开关点不了
  await ctl({ role: "staff", meName: "Jing" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("[...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Rules')");
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Rules').click();");
  await waitFor("document.querySelector('[data-rules-view]')");
  check("员工：能看规则但是只读（没有 Add rule / Edit / Delete、开关是灰的）", await evaluate("const v = document.querySelector('[data-rules-view]'); return v.textContent.includes('Only supervisors and admins can change them') && ![...v.querySelectorAll('button')].some(b => ['Edit', 'Delete', '+ Add rule'].includes(b.textContent.trim())) && [...v.querySelectorAll('[role=switch]')].every(b => b.disabled);"));
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Schedule').click();");
  check("员工没有 Auto-fill 键", await evaluate("return !$btn('Auto-fill');"));

  // Auto-fill：10/11 这周原来是复制来的草稿（有时段）⇒ 先问 Replace / Add；预览 → Create draft
  await ctl({ role: "supervisor", meName: "" });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor(`${cell("1|2026-10-11")} && [...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Rules')`);
  check("有打开的规则 ⇒ Auto-fill 键可点", await evaluate("return !$btn('Auto-fill').disabled;"));
  await waitFor("!!$btn('Auto-fill') && !$btn('Auto-fill').disabled");
  await evaluate("$btn('Auto-fill').click();");
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Auto-fill schedule')`);
  check("Auto-fill 窗口：选 This week / Next 4 weeks，写明只建草稿不通知", await evaluate(`return ${dlg}.textContent.includes('This week') && ${dlg}.textContent.includes('Next 4 weeks') && ${dlg}.textContent.includes('nobody is notified');`));
  await evaluate(`$btn('Preview', ${dlg}).click();`);
  check("这周已经有班 ⇒ 问怎么处理（Replace them / Add to them）", await waitFor(`${dlg}.querySelector('[data-autofill-existing]')`));
  check("决定页写明 Replace 会先删现有的班", await evaluate(`return ${dlg}.textContent.includes('Replace them') && ${dlg}.textContent.includes('Add to them') && ${dlg}.textContent.includes('deletes the existing shifts');`));
  await evaluate(`$btn('Preview', ${dlg}).click();`);
  check("预览：所有规则都满足", await waitFor(`${dlg}.querySelector('[data-autofill-ok]') && ${dlg}.querySelector('[data-autofill-week]')`));
  const previewShifts = await evaluate(`return ${dlg}.querySelectorAll('[data-autofill-week] [class*="rounded-[6px]"][class*="border"]:not([data-off])').length;`);
  check("预览表里的班数 = 活跃的人数 × 5", previewShifts >= 30, String(previewShifts));
  await evaluate(`$btn('Create draft', ${dlg}).click();`);
  check("建好草稿：页面上出现绿条「Created 30 draft shifts … Nothing is published」", await waitFor("document.querySelector('[data-autofill-banner]')?.textContent.includes('Created 30 draft shifts') && document.querySelector('[data-autofill-banner]').textContent.includes('Nothing is published')"));
  let wk = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-11`)).json();
  check("服务端这周 30 个班、都有人、状态还是 draft（没发布）", wk.slots.length === 30 && wk.slots.every((x) => x.employee_id != null) && wk.status === "draft", `${wk.slots.length} ${wk.status}`);
  const bulkCalls = (await (await fetch(`${MOCK}/__log`)).json()).filter((e) => e.path.endsWith("/slots/bulk"));
  check("只发了一次 bulk 请求、replace = true", bulkCalls.length === 1 && bulkCalls[0].body.replace === true && bulkCalls[0].body.slots.length === 30);
  check("Veronica（id 1）周一到周五都是 Open", [1, 2, 3, 4, 5].every((d) => wk.slots.some((x) => x.employee_id === 1 && x.date === `2026-10-${11 + d}` && x.shift_type === "open")));
  check("页面表格刷新了（Veronica 周一是 Open 2:00 AM – 10:00 AM）", await waitFor(`${cell("1|2026-10-12")}.textContent.includes('Open') && ${cell("1|2026-10-12")}.textContent.includes('2:00 AM – 10:00 AM')`));

  // Next 4 weeks 从 10/04 开始：10/04 已发布 ⇒ 跳过并写明；后面三周是新的草稿
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")} && [...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Rules')`);
  await waitFor("!!$btn('Auto-fill') && !$btn('Auto-fill').disabled");
  await evaluate("$btn('Auto-fill').click();");
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Auto-fill schedule')`);
  await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.includes('Next 4 weeks')).click();`);
  await evaluate(`$btn('Preview', ${dlg}).click();`);
  await waitFor(`${dlg}.querySelector('[data-autofill-week]') || ${dlg}.querySelector('[data-autofill-existing]')`);
  if (await evaluate(`return !!${dlg}.querySelector('[data-autofill-existing]');`)) {
    await evaluate(`$btn('Preview', ${dlg}).click();`);
  }
  await waitFor(`${dlg}.querySelector('[data-autofill-week]')`);
  check("4 周预览：第一周（10/4，已发布）写 published — skipped", await evaluate(`return ${dlg}.querySelector('[data-autofill-week="2026-10-04"]').textContent.includes('published — skipped');`));
  check("4 周预览：一共 4 个周块", await evaluate(`return ${dlg}.querySelectorAll('[data-autofill-week]').length === 4;`));
  await evaluate(`$btn('Create draft', ${dlg}).click();`);
  check("建好：写明「3 weeks … (1 published week skipped)」", await waitFor("document.querySelector('[data-autofill-banner]')?.textContent.includes('for 3 weeks') && document.querySelector('[data-autofill-banner]').textContent.includes('1 published week skipped')"));
  const pub = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("已发布的 10/4 仍是 published", pub.status === "published");
  const w18 = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-18`)).json();
  const w25 = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-25`)).json();
  check("10/18、10/25 两周都建好了、各 30 个班", w18.slots.length === 30 && w25.slots.length === 30, `${w18.slots.length} ${w25.slots.length}`);
  check("10/18 周末只有轮值的班：周六 / 周日各 1 Open + 1 Close（轮值的 4 个人里）", [6, 0].every((d) => ["open", "close"].every((t) => w18.slots.filter((x) => x.date === (d === 6 ? "2026-10-24" : "2026-10-18") && x.shift_type === t && [2, 3, 4, 5].includes(x.employee_id)).length === 1)));

  // ── 二期：时段备注 / 休假 / 班次默认时间（后端 ①②③，Annie 2026-10-18「可以，动手」）──
  await ctl({ phase2: true, role: "supervisor", meName: "" });
  const P2 = "2026-12-06"; // 离种子数据很远：一周全空的草稿
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor(`${cell("1|2026-12-07")}`);
  const hasText = (sel, t) => `!!(${sel}) && (${sel}).textContent.includes(${JSON.stringify(t)})`;
  // 默认时间预填：Veronica 周一 → Add shift 窗口一打开就是 Open 的默认时间
  await evaluate(`${cell("1|2026-12-07")}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add shift')`);
  const timeVals = () => evaluate(`return [...${dlg}.querySelectorAll('input[type=time]')].map(i => i.value).join('|');`);
  check("二期：加班窗口打开 = Open 的默认时间 02:00|10:00（不再是整个工作时段）", (await timeVals()) === "02:00|10:00", await timeVals());
  await evaluate(`$btn('Mid', ${dlg}).click();`);
  check("二期：点 Mid 自动填 Mid 的默认时间 08:00|17:00", (await timeVals()) === "08:00|17:00", await timeVals());
  await evaluate(`$btn('Close', ${dlg}).click();`);
  check("二期：点 Close 自动填 13:30|21:30", (await timeVals()) === "13:30|21:30", await timeVals());
  await evaluate(`$btn('Open', ${dlg}).click(); $setValue(${dlg}.querySelector('[data-note-input]'), 'Train open w/Veronica');`);
  check("二期：有可选 Note 输入框、最多 120 字", await evaluate(`const n = ${dlg}.querySelector('[data-note-input]'); return n && n.maxLength === 120 && n.value === 'Train open w/Veronica';`));
  check("二期：有 Shift | Time off 切换（排到具体的人才有）", await evaluate(`return !!${dlg}.querySelector('[data-mode=off]') && !!${dlg}.querySelector('[data-mode=shift]');`));
  await evaluate(`$btn('Add shift', ${dlg}).click();`);
  check("二期：加好的班在时间下面显示备注小黄字", await waitFor(`${hasText(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]')`, "Train open w/Veronica")}`));
  let p2 = await (await fetch(`${MOCK}/api/schedule/weeks/${P2}`)).json();
  check("二期：创建请求带 note", p2.slots.some((x) => x.employee_id === 1 && x.note === "Train open w/Veronica"));
  check("二期：周数据带 time_off（空数组）", Array.isArray(p2.time_off) && p2.time_off.length === 0);

  // 改备注：点备注文字 → 输入框 → 存
  await evaluate(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]').click();`);
  await waitFor(`${cell("1|2026-12-07")}.querySelector('[data-note-editor]')`);
  await evaluate(`const i = ${cell("1|2026-12-07")}.querySelector('[data-note-editor]'); $setValue(i, 'Standby'); ${cell("1|2026-12-07")}.querySelector('[data-note-save]').click();`);
  check("二期：改备注 ⇒ 格子显示新备注 Standby", await waitFor(`${hasText(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]')`, "Standby")}`));
  const noteCalls = (await (await fetch(`${MOCK}/__log`)).json()).filter((e) => e.path.endsWith("/note"));
  check("二期：PUT …/note 只发一次、body {note:'Standby'}", noteCalls.length === 1 && noteCalls[0].body.note === "Standby", JSON.stringify(noteCalls));
  // 清空 = 删除
  await evaluate(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]').click();`);
  await waitFor(`${cell("1|2026-12-07")}.querySelector('[data-note-editor]')`);
  await evaluate(`const i = ${cell("1|2026-12-07")}.querySelector('[data-note-editor]'); $setValue(i, ''); ${cell("1|2026-12-07")}.querySelector('[data-note-save]').click();`);
  check("二期：清空再存 ⇒ 备注没了，出现「+ note」", await waitFor(`!${cell("1|2026-12-07")}.querySelector('[data-slot-note]') && !!${cell("1|2026-12-07")}.querySelector('[data-add-note]')`));
  // + note
  await evaluate(`${cell("1|2026-12-07")}.querySelector('[data-add-note]').click();`);
  await waitFor(`${cell("1|2026-12-07")}.querySelector('[data-note-editor]')`);
  await evaluate(`const i = ${cell("1|2026-12-07")}.querySelector('[data-note-editor]'); $setValue(i, 'Pre close'); i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));`);
  check("二期：+ note → Enter 存 ⇒ 显示 Pre close", await waitFor(`${hasText(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]')`, "Pre close")}`));

  // 休假：Lizzie 周二录 Sick + 备注
  await evaluate(`${cell("2|2026-12-08")}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.querySelector('[data-mode=off]')`);
  await evaluate(`${dlg}.querySelector('[data-mode=off]').click();`);
  check("二期：Time off 模式：标题 Add time off、有 PTO / Sick / Personal 三个选项", await evaluate(`return ${dlg}.textContent.includes('Add time off') && ['PTO', 'Sick', 'Personal'].every(t => $btn(t, ${dlg})) && !${dlg}.querySelector('input[type=time]');`));
  await evaluate(`${dlg}.querySelector('[data-kind=sick]').click(); $setValue(${dlg}.querySelector('[data-note-input]'), 'Back Thursday'); $btn('Add day off', ${dlg}).click();`);
  check("二期：录好 ⇒ 格子写 Sick + 备注 Back Thursday，窗口关了", await waitFor(`${hasText(`${cell("2|2026-12-08")}.querySelector('[data-time-off=sick]')`, "Sick")} && ${hasText(`${cell("2|2026-12-08")}.querySelector('[data-time-off=sick]')`, "Back Thursday")} && !${dlg}`));
  check("二期：休假格子比 Off 深一档的黄、主管有 ×", await evaluate(`const el = ${cell("2|2026-12-08")}.querySelector('[data-time-off]'); return getComputedStyle(el).backgroundColor.includes('0.28') && !!el.querySelector('[data-remove-time-off]');`));
  check("二期：同一天没有 Off 格子", await evaluate(`return !${cell("2|2026-12-08")}.querySelector('[data-off]');`));
  const toCall = (await (await fetch(`${MOCK}/__log`)).json()).filter((e) => e.path === "/api/schedule/time-off");
  check("二期：PUT /api/schedule/time-off body 对（employee 2、dates、kind sick、note）", toCall.length === 1 && toCall[0].body.employee_id === 2 && toCall[0].body.kind === "sick" && toCall[0].body.note === "Back Thursday" && toCall[0].body.dates.join() === "2026-12-08", JSON.stringify(toCall));

  // 冲突（录休假 ⇒ 这天已有班）：红框原样显示后端原话，窗口不关
  await evaluate(`${cell("1|2026-12-07")}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.querySelector('[data-mode=off]')`);
  await evaluate(`${dlg}.querySelector('[data-mode=off]').click();`);
  await waitFor(`!!$btn('Add day off', ${dlg})`);
  await evaluate(`$btn('Add day off', ${dlg}).click();`);
  check("二期：给已有班的人录休假 ⇒ 窗口里红框显示后端原话、窗口不关", await waitFor(`${dlg} && ${hasText(`${dlg}.querySelector('[data-dialog-error]')`, "Veronica already has a shift on 2026-12-07, so time off can't be set for that day.")}`));
  await evaluate(`$btn('Cancel', ${dlg}).click();`);

  // 冲突（排班 ⇒ 这天有休假）：横幅显示后端原话，不留没人的空时段
  const beforeCount = (await (await fetch(`${MOCK}/api/schedule/weeks/${P2}`)).json()).slots.length;
  await evaluate(`${cell("2|2026-12-08")}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add shift')`);
  await evaluate(`$btn('Add shift', ${dlg}).click();`);
  check("二期：给有休假的人排班 ⇒ 页面横幅显示后端原话", await waitFor(`document.body.innerText.includes("Lizzie has time off on 2026-12-08, so they can't be scheduled that day.")`));
  p2 = await (await fetch(`${MOCK}/api/schedule/weeks/${P2}`)).json();
  check("二期：被拦时没有留下没人的空时段", p2.slots.length === beforeCount, `${beforeCount} → ${p2.slots.length}`);

  // 删休假
  await evaluate(`${cell("2|2026-12-08")}.querySelector('[data-remove-time-off]').click();`);
  check("二期：点 × ⇒ 休假没了、变回 Off", await waitFor(`!${cell("2|2026-12-08")}.querySelector('[data-time-off]') && !!${cell("2|2026-12-08")}.querySelector('[data-off]')`));

  // 员工：看得到类型和备注，不能改
  await fetch(`${MOCK}/api/schedule/time-off`, { method: "PUT", body: JSON.stringify({ employee_id: 4, dates: ["2026-09-28"], kind: "personal", note: "Family" }) });
  await ctl({ role: "staff", meName: "Veronica" });
  await openPage(`${APP}/schedule?week=2026-09-27`);
  await waitFor(`${cell("4|2026-09-28")}`);
  check("二期：员工看得到别人的休假类型和备注（Personal / Family）", await waitFor(`${hasText(`${cell("4|2026-09-28")}.querySelector('[data-time-off=personal]')`, "Personal")} && ${hasText(`${cell("4|2026-09-28")}.querySelector('[data-time-off=personal]')`, "Family")}`));
  check("二期：员工没有 ×、没有 + note、没有加班键", await evaluate(`return !document.querySelector('[data-remove-time-off]') && !document.querySelector('[data-add-note]') && !document.querySelector('button[aria-label="Add a shift"]');`));

  // 默认时间：所有人只读文字，superadmin 才有 Edit
  await ctl({ role: "supervisor", meName: "" });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor("document.querySelector('[data-default-times]')");
  const dt = () => evaluate("return document.querySelector('[data-default-times]')?.textContent || '';");
  const dtText = await dt();
  check("二期：页头有 Default shift times 一行（Open 2:00 AM – 10:00 AM / Mid 8:00 AM – 5:00 PM / Close 1:30 PM – 9:30 PM）", ["Open 2:00 AM – 10:00 AM", "Mid 8:00 AM – 5:00 PM", "Close 1:30 PM – 9:30 PM"].every((t) => (dtText || "").includes(t)), dtText);
  check("二期：主管只读（没有 Edit）", await evaluate(`return ![...document.querySelector('[data-default-times]').querySelectorAll('button')].some(b => b.textContent.trim() === 'Edit');`));
  await ctl({ role: "superadmin", meName: "" });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor("document.querySelector('[data-default-times]')");
  await evaluate(`[...document.querySelector('[data-default-times]').querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit').click();`);
  await waitFor("document.querySelector('[data-default-times-form]')");
  await evaluate(`const f = document.querySelector('[data-default-times-form]'); $setValue(f.querySelector('input[aria-label="Open start"]'), '03:00'); $setValue(f.querySelector('input[aria-label="Open end"]'), '11:00'); $btn('Save', f).click();`);
  check("二期：superadmin 改 Open 默认时间 ⇒ 页头变 3:00 AM – 11:00 AM", await waitFor("document.querySelector('[data-default-times]')?.textContent.includes('Open 3:00 AM – 11:00 AM')"));
  const stCalls = (await (await fetch(`${MOCK}/__log`)).json()).filter((e) => e.path === "/api/settings/schedule/shift-types/open");
  check("二期：只发了 open 一个 PUT，带 default_start_time 03:00 / default_end_time 11:00", stCalls.length === 1 && stCalls[0].body.default_start_time === "03:00" && stCalls[0].body.default_end_time === "11:00", JSON.stringify(stCalls));
  await ctl({ phase2: false, role: "supervisor", meName: "" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")}`);
  check("二期：后端没带二期字段时（旧版）：没有 Default shift times 行、加班窗口没有 Time off 切换", await evaluate(`
    if (document.querySelector('[data-default-times]')) return false;
    document.querySelector('[data-cell="1|2026-10-04"] button[aria-label="Add a shift"]').click();
    await new Promise(r => setTimeout(r, 300));
    const d = document.querySelector('[role=dialog]');
    const ok = !!d && !d.querySelector('[data-mode=off]');
    $btn('Cancel', d).click();
    return ok;
  `));

  // ── Dashboard 上的排班表（单独一块、只读、只给看已发布的周；Annie 2026-10-18）──
  // 把「今天」固定在 2026-10-06（周二）：这一周 10/4–10/10 前面已经发布过。
  await ctl({ role: "staff", meName: "Jing", fail401: false });
  const fake = await cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => { const R = Date; const F = Date.UTC(2026, 9, 6, 19, 0, 0);
      class D extends R { constructor(...a) { if (a.length) super(...a); else super(F); } static now() { return F; } }
      globalThis.Date = D; })();`,
  });
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('[data-dashboard-schedule] [data-off], [data-dashboard-schedule] p')");
  await helpers();
  const dash = `document.querySelector('[data-dashboard-schedule]')`;
  check("Dashboard 有单独的 Schedule 区块、标题带日期范围", await waitFor(`${dash} && ${dash}.textContent.includes('Schedule · Oct 4 – Oct 10')`));
  const dashNames = await evaluate(`return [...${dash}.querySelectorAll('.w-max > div')].filter((d) => d.className.includes('min-h-[56px]') && d.className.includes('px-2')).map((d) => d.textContent.trim()).join(',');`);
  check("一行一个人：自己（Jing）在最上面，其他人在后面", dashNames === "Jing,Veronica,Lizzie,Nadia,Anita,ZZ Test Helper", dashNames);
  check(
    "列宽 122px、格子高 ≥ 56px（Annie 看预览定的）",
    await evaluate(`
      const c = ${dash}.querySelector('[data-off]').parentElement.getBoundingClientRect();
      return Math.round(c.width) === 122 && c.height >= 56;
    `),
  );
  check("没有班的格子是浅黄 Off", await evaluate(`return ${dash}.querySelectorAll('[data-off]').length > 0;`));
  check("今天那一列（周二 10/06）表头高亮", await evaluate(`
    const h = [...${dash}.querySelectorAll('.text-sky-300')].map(e => e.textContent);
    return h.some(t => t.includes('TUE') || t.includes('Tue'));
  `));
  check("Open schedule → 链到 /schedule?week=2026-10-04", await evaluate(`return [...${dash}.querySelectorAll('a')].find(a => a.textContent.includes('Open schedule'))?.getAttribute('href') === '/schedule?week=2026-10-04';`));
  check("只读：没有 Publish / + / × / 拖拽", await evaluate(`return !${dash}.querySelector('[draggable=true]') && ![...${dash}.querySelectorAll('button')].some((b) => ['Publish', '+', '×'].includes(b.textContent.trim()));`));
  await evaluate(`[...${dash}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Next week').click();`);
  check(
    "Next week：下一周还没发布 ⇒ 写 Next week's schedule hasn't been published yet.",
    await waitFor(`${dash}.textContent.includes("Next week's schedule hasn't been published yet.")`),
  );
  await evaluate(`[...${dash}.querySelectorAll('button')].find(b => b.textContent.trim() === 'This week').click();`);
  check("切回 This week 又看到表", await waitFor(`!!${dash}.querySelector('[data-off]')`));
  await ctl({ role: "supervisor", meName: "" });
  await goto(`${APP}/dashboard`);
  check("主管在 Dashboard 也只是看：同一张只读表", await waitFor(`${dash} && !!${dash}.querySelector('[data-off]') && ![...${dash}.querySelectorAll('button')].some(b => b.textContent.includes('Publish'))`));
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: fake.identifier });

  // 401：跳旧后台登录页。
  await ctl({ fail401: true, role: "superadmin" });
  await goto(`${APP}/schedule`);
  check("未登录跳旧后台登录页，带 next", await waitFor("location.pathname === '/auth/login' && location.search.includes('next=')"));
}

main();
