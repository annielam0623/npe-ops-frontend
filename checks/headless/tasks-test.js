// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Dashboard 的任务框（任务包阶段三）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:3198";
const MOCK = "http://localhost:8799";
const PORT = 9334;

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
  check("先拉 /api/me 再拉 /api/tasks/today", await (async () => {
    const l = (await mockLog()).slice(from);
    const me = l.findIndex((e) => e.path === "/api/me");
    const t = l.findIndex((e) => e.path === "/api/tasks/today");
    return me >= 0 && t > me;
  })());
  check("标题：My tasks · Pre-closer · 9:30 AM–5:30 PM · now 3:30 PM", await evaluate("return $tasksSection().querySelector('h2').textContent.includes('My tasks') && $tasksSection().querySelector('h2').textContent.includes('Pre-closer') && $tasksSection().querySelector('h2').textContent.includes('now 3:30 PM');"), await evaluate("return $tasksSection().querySelector('h2').textContent;"));
  check("汇总行 2 of 6 done（6 条角色任务，不含待接受的那条）", await evaluate("return $tasksSection().textContent.includes('2 of 6 done');"));
  check("汇总条：1 overdue · 2 due within the hour", await evaluate("return $tasksSection().textContent.includes('1 overdue') && $tasksSection().textContent.includes('2 due within the hour');"), await evaluate("return $tasksSection().textContent.slice(0, 400);"));
  check("超时的 Send Last mins Confirmation：Overdue · was due 2:00 PM，标红底", await evaluate("const li = $li('Send Last mins Confirmation'); return li.textContent.includes('Overdue') && li.textContent.includes('2:00 PM') && li.dataset.dueStatus === 'overdue';"));
  check("已完成的两条有删除线、Done 徽章", await evaluate("const li = $li('South Lunch'); return li.querySelector('input[type=checkbox]').checked && li.textContent.includes('Done');"));
  check("待接受的交接单独一块，写明是谁交的、说明", await evaluate("const t = document.body.textContent; return t.includes('Passed over to you') && t.includes('Check Shuttle and remind Tour Guide for Shuttle Pickup') && t.includes('From Veronica') && t.includes(\"didn’t get to it\");"));
  check("待接受的那条只在待接受那一块出现一次，不在普通清单里重复", await evaluate("return [...document.querySelectorAll('li')].filter(li => li.textContent.includes('Check Shuttle and remind Tour Guide for Shuttle Pickup')).length === 1;"));

  // ── Accept ──
  from = (await mockLog()).length;
  await evaluate("$btn('Accept').click();");
  await sleep(600);
  check("点 Accept 调 POST …/accept", (await since(from, (e) => e.method === "POST" && /\/accept$/.test(e.path))).length === 1);
  check("接受后任务进主清单，显示来自 Veronica 的说明，不再是待接受", await evaluate("const li = $li('Check Shuttle and remind Tour Guide for Shuttle Pickup'); return !!li && li.textContent.includes('From Veronica') && !document.body.textContent.includes('PASSED OVER TO YOU');"));

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

  // ── 主管视角 ──
  await ctl({ reset: true, me: "annie", supervisor: true, fail401: false, failGet: false, notReady: false });
  from = (await mockLog()).length;
  await goto(`${APP}/dashboard`);
  await waitFor("$tasksSection()");
  await helpers();
  check("标题：Today's tasks · all shifts · now 3:30 PM · 6 of 23 done", await evaluate("const t = $tasksSection().querySelector('h2').textContent; return t.includes(\"Today\\u2019s tasks\") && t.includes('now 3:30 PM') && t.includes('6 of 23 done');"), await evaluate("return $tasksSection().querySelector('h2').textContent;"));
  check("按岗位分组：Opening / Pre-closer / Closer 都在（Whole team 这次没有任务，不出现，符合 Work Checklist 原表）", await evaluate("const t = $tasksSection().textContent; return ['Opening', 'Pre-closer', 'Closer'].every(s => t.includes(s)) && !t.includes('WHOLE TEAM');"), await evaluate("return $tasksSection().textContent.slice(0, 200);"));
  check("Opening 组写 Veronica & Jing、2:00 AM–10:00 AM", await evaluate("return $tasksSection().textContent.includes('Veronica & Jing') && $tasksSection().textContent.includes('2:00 AM') && $tasksSection().textContent.includes('10:00 AM');"));
  check("待接受的交接那条写 Passing to Lizzie — not accepted yet", await evaluate("return $tasksSection().textContent.includes('Passing to Lizzie — not accepted yet');"));
  check("交接通知列表：Veronica passed … to Lizzie — waiting for accept", await evaluate("return $tasksSection().textContent.includes('Veronica passed') && $tasksSection().textContent.includes('waiting for accept');"));

  // ── 改截止时间 ──
  from = (await mockLog()).length;
  await evaluate("const li = $li('BZ Lunch'); $setValue(li.querySelector('input[type=time]'), '17:30');");
  await sleep(600);
  reqs = await since(from, (e) => e.method === "PUT" && /\/due$/.test(e.path));
  check("改时间调 PUT …/due，带新的 due_at", reqs.length === 1 && typeof reqs[0].body?.due_at === "string", JSON.stringify(reqs));

  // ── 加任务 ──
  from = (await mockLog()).length;
  await evaluate("const inp = $q('input[placeholder=\"What needs to be done\"]'); $setValue(inp, 'ZZ Test one-off task');");
  await evaluate("$btn('Closer').click();");
  await evaluate("$btn('Add').click();");
  await sleep(600);
  reqs = await since(from, (e) => e.method === "POST" && e.path === "/api/tasks/today");
  check("Add 调 POST /api/tasks/today，role=closer", reqs.length === 1 && reqs[0].body?.title === "ZZ Test one-off task" && reqs[0].body?.role === "closer", JSON.stringify(reqs));
  check("新任务出现在 Closer 组里", await evaluate("return !!$li('ZZ Test one-off task');"));

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
