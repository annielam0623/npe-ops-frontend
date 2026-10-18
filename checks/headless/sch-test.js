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
    "一行一个人：Needs someone 在最上面，后面 5 个人按名单顺序",
    (await evaluate(`return ${rowNames}[0];`)).startsWith("Needs someone") &&
      (await evaluate(`return ${rowNames}.slice(1).map(t => t.replace(/[0-9]+ days?$/, '')).join(',');`)) === "Veronica,Lizzie,Nadia,Jing,Anita",
  );
  check("没有「You」标签", !(await text()).includes("You"));
  check("没有旧的名单条（表格里没有 Employees 名单条；Employees 只是页头的一个按钮）", await evaluate("return !document.querySelector('[data-sch-grid]').textContent.toUpperCase().includes('EMPLOYEES') && !!$btn('Employees');"));
  check("Veronica 这一行写着天数（这周 4 天）", (await evaluate(`return ${rowNames}[1];`)).includes("4 days"));
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

  // 没有班的格子是浅黄色 Off（色卡 A），Needs someone 行的空格不是。
  check(
    "没有班的人 / 天：浅黄 Off 格（周日 Jing 没班）",
    await evaluate(`const o = ${cell("4|2026-10-04")}.querySelector('[data-off]'); return !!o && o.textContent.trim() === 'Off' && getComputedStyle(o).color === 'rgb(253, 230, 138)';`),
  );
  check("Needs someone 行的空格不画 Off", await evaluate(`return !${cell("needs|2026-10-04")}.querySelector('[data-off]');`));
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
  // 点 Needs someone 同一天的格子 = 清空。
  await evaluate(`${cell("needs|2026-10-05")}.click();`);
  check("点 Needs someone 的格子：这个时段清空", await waitFor(`${cell("needs|2026-10-05")}.textContent.includes('Mid')`));
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

  // ── 加时段：Needs 那行周六点 +，选 Mid；时间先用工作时段起止 ──
  const needsSat = cell("needs|2026-10-10");
  await evaluate(`${needsSat}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`[...${needsSat}.querySelectorAll('button')].some(b => b.textContent.includes('+ Mid'))`);
  await evaluate(`[...${needsSat}.querySelectorAll('button')].find(b => b.textContent.includes('+ Mid')).click();`);
  check("Needs someone 周六加了一个 Mid 时段", await waitFor(`${needsSat}.textContent.includes('Mid')`));
  check("新时段的时间 = 工作时段 2:00 AM – 9:30 PM", (await evaluate(`return ${needsSat}.textContent;`)).includes("2:00 AM – 9:30 PM"));
  check("Needs someone 里的时段是红色虚线", await evaluate(`return ${needsSat}.querySelector('[data-slot-id]').className.includes('border-dashed');`));

  // 在 Anita(5) 的周六格里直接加一个 Close ⇒ 先建再派给 Anita。
  const anitaSat = cell("5|2026-10-10");
  await evaluate(`${anitaSat}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`[...${anitaSat}.querySelectorAll('button')].some(b => b.textContent.includes('+ Close'))`);
  await evaluate(`[...${anitaSat}.querySelectorAll('button')].find(b => b.textContent.includes('+ Close')).click();`);
  check("在 Anita 的格子里加的 Close 直接是她的", await waitFor(`${anitaSat}.querySelectorAll('[data-slot-id]').length === 2`));
  w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端：新 Close 的 employee_id = 5", w.slots.filter((s) => s.date === "2026-10-10" && s.shift_type === "close" && s.employee_id === 5).length === 1);

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
    "staff 看不到 Publish / Add employee / + / × / Needs someone",
    await evaluate(`
      return !$btn('Publish') && !$btn('Add employee')
        && !document.querySelector('button[aria-label="Add a shift"]')
        && !document.querySelector('button[title="Remove this shift"]')
        && !document.body.innerText.includes('Needs someone');
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

  // 401：跳旧后台登录页。
  await ctl({ fail401: true, role: "superadmin" });
  await goto(`${APP}/schedule`);
  check("未登录跳旧后台登录页，带 next", await waitFor("location.pathname === '/auth/login' && location.search.includes('next=')"));
}

main();
