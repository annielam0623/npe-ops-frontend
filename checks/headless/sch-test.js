// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /schedule（Staff Schedule，排班阶段二）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
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
window.$rows = () => [...document.querySelectorAll('tbody tr')].map(tr => ({
  name: tr.children[0]?.textContent.trim(),
  cells: [...tr.children].slice(1).map(td => td.textContent.trim()),
}));
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

async function run() {
  // ── supervisor：周四验收数据（10/4–10/10）：周一有空档、不能发布 ──
  await ctl({ role: "supervisor", fail401: false });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelectorAll('tbody tr').length === 5");

  check("页头工作时段", (await evaluate("return document.body.innerText;")).includes("2:00 AM – 9:30 PM"));
  check("地址栏带上 ?week=", (await evaluate("return location.search;")) === "?week=2026-10-04");
  check("周范围显示 Oct 4 – Oct 10, 2026", (await evaluate("return document.body.innerText;")).includes("Oct 4 – Oct 10, 2026"));

  let rows = await evaluate("return $rows();");
  check("5 个员工按名单顺序显示", rows.map((r) => r.name).join(",") === "Veronica,Lizzie,Nadia,Jing,Anita", rows.map((r) => r.name).join(","));

  // 验收第 4 条：周一（第二列）因 Jing 的时间打错报空档，禁止发布。
  check(
    "发布按钮一开始是灰的、写着 1 day with gaps",
    (await evaluate("return document.body.innerText;")).includes("1 day with gaps") &&
      (await evaluate("return $btn('Publish').disabled;")),
  );
  check("周一列标题有红点（有空档）", (await evaluate(`
    const ths = [...document.querySelectorAll('thead th')];
    const mon = ths.find(th => th.textContent.includes('Mon'));
    return !!mon.querySelector('.bg-red-400');
  `)));

  // 验收第 5 条：绕过前端直接调发布接口，有空档一样被拒，并带上哪几天哪些时段。
  const directPublish = await (
    await fetch(`${MOCK}/api/schedule/weeks/2026-10-04/publish`, { method: "POST" })
  ).json();
  check(
    "直接调发布接口（绕过页面）同样 400 + 带空档",
    Array.isArray(directPublish.gaps) &&
      directPublish.gaps.some((g) => g.date === "2026-10-05" && g.start_time === "17:00" && g.end_time === "21:30"),
    JSON.stringify(directPublish),
  );

  // 点开周一 Jing 的格子：显示打错的时间，有标黄提示。
  await evaluate(`
    const row = [...document.querySelectorAll('tbody tr')].find(tr => tr.children[0].textContent.trim() === 'Jing');
    row.children[2].querySelector('button').click();
  `);
  await waitFor("document.querySelector('[role=dialog]')");
  check(
    "打开 Jing 周一的格子，显示 23:30–21:30 并标黄警告",
    (await evaluate("return document.querySelector('[role=dialog]').textContent;")).includes("is not after start"),
  );
  await evaluate(`
    const dlg = document.querySelector('[role=dialog]');
    const start = dlg.querySelector('input[type=time]');
    $setValue(start, '11:30');
  `);
  await evaluate("document.querySelector('[role=dialog] button[type=submit]').click();");
  await waitFor("!document.querySelector('[role=dialog]')");

  check("改完存上，周一的空档消失、Publish 变可点", await waitFor(`
    !document.body.innerText.includes('day with gaps') && !$btn('Publish').disabled
  `));
  check("周一列标题的红点消失", await evaluate(`
    const ths = [...document.querySelectorAll('thead th')];
    const mon = ths.find(th => th.textContent.includes('Mon'));
    return !mon.querySelector('.bg-red-400');
  `));

  // 再从服务端确认（不只是页面显示）：这一周的 gaps 真的空了。
  const weekAfterFix = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端这一周的 gaps 数组真的空了", Array.isArray(weekAfterFix.gaps) && weekAfterFix.gaps.length === 0, JSON.stringify(weekAfterFix.gaps));

  // ── 验收第 7 条：10/7（周三）Day timeline 的重叠和空档 ──
  await evaluate(`$btn('Wed').click();`);
  await sleep(200);
  const timelineText = await evaluate("return document.body.innerText;");
  check("10/7 显示 Veronica + Lizzie 重叠", timelineText.includes("Veronica + Lizzie") && timelineText.includes("9:30") && timelineText.includes("10:00"));
  check("10/7 显示 Lizzie + Nadia 重叠", timelineText.includes("Lizzie + Nadia") && timelineText.includes("1:30") && timelineText.includes("5:30"));
  check("10/7 没有空档", timelineText.includes("Gaps: none — fully covered"));

  // ── 发布：确认框 → Publish，之后看到通知摘要 ──
  await evaluate("$btn('Publish').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate("$btn('Publish', document.querySelector('[role=dialog]')).click();");
  check("发布成功后显示通知了几个人", await waitFor("document.body.innerText.includes('Published. Notified')"));

  const publishedWeek = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端这一周状态变成 published", publishedWeek.status === "published");

  // 已发布的周：Publish 键还在（后端 -84 2026-10-16 定：编辑已发布的周不自动重发，要通知就再点一次 Publish）。
  check("已发布的周 Publish 键变成 Publish again、还能点", await evaluate("return !!$btn('Publish again') && !$btn('Publish again').disabled;"));
  await evaluate("$btn('Publish again').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  check("二次发布的确认框文案提到 again", (await evaluate("return document.querySelector('[role=dialog]').textContent;")).includes("again"));
  await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
  check("二次发布成功", await waitFor("document.body.innerText.includes('Published. Notified')"));

  // ── staff：只能看已发布的整周，不能编辑，看不到管理按钮 ──
  await ctl({ role: "staff" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  check("staff 能看已发布的这一周（不是 403 提示）", !(await evaluate("return document.body.innerText;")).includes("hasn't been published"));
  check(
    "staff 看不到 Publish / Copy / Add employee",
    await evaluate("return !$btn('Publish') && !$btn('Copy last week') && !$btn('Add employee');"),
  );
  check("staff 点格子不弹编辑框（按钮是 disabled）", await evaluate(`
    const btn = document.querySelector('tbody tr td button');
    return btn.disabled;
  `));

  // 另一周（10/11）还没发布：staff 看到的是「还没发布」提示，不是排班内容。
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor("document.body.innerText.includes('hasn') ");
  check("staff 查还没发布的周：显示提示，不是空表", (await evaluate("return document.body.innerText;")).includes("hasn't been published yet"));

  // ── supervisor：Add employee + Copy last week ──
  await ctl({ role: "supervisor" });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor("$btn('Add employee')");
  await evaluate("$btn('Add employee').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate(`
    const dlg = document.querySelector('[role=dialog]');
    $setValue(dlg.querySelector('input[type=text]'), 'ZZ Test Helper');
  `);
  await evaluate("document.querySelector('[role=dialog] button[type=submit]').click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  check("新加的员工出现在表格里", (await evaluate("return $rows();")).some((r) => r.name === "ZZ Test Helper"));

  rows = await evaluate("return $rows();");
  check(
    "新加的一周（10/11）一开始是空的",
    rows.find((r) => r.name === "Veronica").cells.every((c) => !c.includes("AM") && !c.includes("PM")),
  );

  await evaluate("$btn('Copy last week').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate("$btn('Copy', document.querySelector('[role=dialog]')).click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  rows = await evaluate("return $rows();");
  check(
    "复制上一周（10/4）后，周日那格变成 Veronica Open 2:00–12:00（同 10/4 的数据）",
    rows.find((r) => r.name === "Veronica").cells[0].includes("2:00 AM – 12:00 PM"),
    JSON.stringify(rows.find((r) => r.name === "Veronica").cells),
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
  check("superadmin 改工作时段后立即生效（页头跟着变成 3:00 AM）", await waitFor("document.body.innerText.includes('3:00 AM')"));

  // 401：跳旧后台登录页。
  await ctl({ fail401: true, role: "superadmin" });
  await goto(`${APP}/schedule`);
  check("未登录跳旧后台登录页，带 next", await waitFor("location.pathname === '/auth/login' && location.search.includes('next=')"));
}

main();
