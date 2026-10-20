// 周三确认下周排班（员工这一边，Annie 2026-10-19「现在动手」）：/schedule/confirm 和邮件链接 /schedule/confirm/link/<token>。
// 前提：mock（sc-mock.js）和 app 的端口用 APP_URL / MOCK_URL / CDP_PORT / MOCK_PORT / CHROME_PROFILE 指定。只连 mock，不发任何真实通知 / 邮件。
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
const since = async (n, f) => (await mockLog()).slice(n).filter(f);

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

// 合成一次「把名字条拖到格子上」：同一个 DataTransfer 走 dragover → drop。
const DROP = `
window.$drop = (cellKey) => {
  const cell = document.querySelector('[data-cell="' + cellKey + '"]');
  if (!cell) return false;
  const dt = new DataTransfer();
  dt.setData('text/schedule-confirm-chip', 'me');
  cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  cell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return true;
};
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
`;

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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

const CONFIRM = `${APP}/schedule/confirm?week=2026-10-25`;
const text = () => evaluate("return document.body.innerText;");
const added = "[...document.querySelectorAll('[data-confirm] [data-added]')]";

async function open(url = CONFIRM) {
  await goto(url);
  await waitFor("document.querySelector('[data-confirm]')");
  await evaluate(DROP);
}

async function run() {
  // ── 员工打开确认页 ──
  await ctl({ reset: true, unavail: false, fail401: false });
  await open();
  const q = (await since(0, (e) => e.path === "/api/schedule/confirmation"))[0]?.q;
  check("登录进来：GET /api/schedule/confirmation?week=2026-10-25", q?.week === "2026-10-25", JSON.stringify(q));
  check("标题 Confirm your schedule · 10/25 – 10/31；状态 Waiting for your answer", await evaluate("const h = document.querySelector('[data-confirm] h2').textContent.replace(/\\s+/g, ' '); return h.includes('Confirm your schedule') && h.includes('10/25') && h.includes('10/31') && document.querySelector('[data-confirm-status]').textContent === 'Waiting for your answer';"), await evaluate("return document.querySelector('[data-confirm] h2').textContent;"));
  check("我的班：Sun Open · Tue Mid · Thu Close · Sat Open", await evaluate("return document.querySelector('[data-confirm-mine]').textContent === \"You're on: Sun Open · Tue Mid · Thu Close · Sat Open\";"), await evaluate("return document.querySelector('[data-confirm-mine]').textContent;"));
  check(
    "班次 × 天 的表：三行 Open / Mid / Close（带时间），七天；格子里列人，我自己的名字有一圈白线",
    await evaluate("const b = document.querySelector('[data-confirm-board]'); const rows = ['Open', 'Mid', 'Close'].every((n) => b.textContent.includes(n)); const sunOpen = b.querySelector('[data-cell=\"2026-10-25|open\"]'); return rows && b.textContent.includes('2:00 AM – 10:00 AM') && b.querySelectorAll('[data-cell]').length === 21 && sunOpen.textContent.trim() === 'Avery' && sunOpen.querySelector('[data-person=Avery]').className.includes('ring-1');"),
  );
  check("Accept（蓝色提交键）、Change；这时没有可拖的名字条，格子不接东西", await evaluate("const a = document.querySelector('[data-confirm-accept]'); return !!a && !!document.querySelector('[data-confirm-change]') && !document.querySelector('[data-confirm-chip]') && getComputedStyle(a).backgroundColor !== 'rgba(0, 0, 0, 0)' && window.$drop('2026-10-26|open') && document.querySelectorAll('[data-confirm] [data-added]').length === 0;"));

  // ── Change：把名字拖到想上的那天 ──
  await evaluate("document.querySelector('[data-confirm-change]').click();");
  await waitFor("document.querySelector('[data-confirm-chip]')");
  check("点 Change：出现亮黄色可拖的名字条 Avery，Accept / Change 收起，Send my changes 灰着", await evaluate("const c = document.querySelector('[data-confirm-chip]'); return c.draggable && c.textContent.includes('Avery') && getComputedStyle(c).backgroundColor === 'rgb(252, 211, 77)' && !document.querySelector('[data-confirm-accept]') && document.querySelector('[data-confirm-send]').disabled;"));
  await evaluate("window.$drop('2026-10-28|mid');");
  await waitFor(`${added}.length === 1`);
  check(
    "拖到 Wed Mid：这个格子里变成两个人（原来的 Brooks + 新加的 Avery），新加的亮黄色底、写 (you)；Send 可点",
    await evaluate("const c = document.querySelector('[data-cell=\"2026-10-28|mid\"]'); const a = c.querySelector('[data-added=draft]'); return c.querySelector('[data-person=Brooks]') && a && a.textContent.includes('Avery') && a.textContent.includes('(you)') && getComputedStyle(a).backgroundColor === 'rgb(252, 211, 77)' && !document.querySelector('[data-confirm-send]').disabled;"),
    await evaluate("return document.querySelector('[data-cell=\"2026-10-28|mid\"]').innerText;"),
  );
  await evaluate("window.$drop('2026-10-28|mid'); window.$drop('2026-10-25|open');");
  await sleep(200);
  check("同一格再拖一次、或拖到原来就排了我的格子（Sun Open）：不重复加", await evaluate(`return ${added}.length === 1;`));
  await evaluate("window.$drop('2026-10-30|open');");
  await waitFor(`${added}.length === 2`);
  await evaluate("document.querySelector('[data-cell=\"2026-10-30|open\"] [data-added] button').click();");
  await waitFor(`${added}.length === 1`);
  check("格子里的 ✕ 撤销刚加的那条", await evaluate(`return ${added}.length === 1 && !document.querySelector('[data-cell="2026-10-30|open"] [data-added]');`));
  // 没有拖拽（手机）：点名字条再点格子
  await evaluate("document.querySelector('[data-confirm-chip]').click();");
  await evaluate("document.querySelector('[data-cell=\"2026-10-31|close\"]').click();");
  await waitFor(`${added}.length === 2`);
  check("没有拖拽时：点名字条（高亮一圈）再点格子也能加", await evaluate(`return ${added}.length === 2 && !!document.querySelector('[data-cell="2026-10-31|close"] [data-added]');`));
  let from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-confirm-send]').click();");
  await waitFor("document.querySelector('[data-confirm-status]').textContent.startsWith('Changes sent')");
  const ch = (await since(from, (e) => e.path === "/api/schedule/confirmation/changes"))[0]?.body;
  check(
    "Send my changes：POST …/changes {week_start, additions: Wed Mid、Sat Close}，只加不减",
    ch?.week_start === "2026-10-25" && JSON.stringify(ch.additions) === JSON.stringify([{ date: "2026-10-28", shift_type: "mid" }, { date: "2026-10-31", shift_type: "close" }]),
    JSON.stringify(ch),
  );
  check(
    "发送后：状态 Changes sent · waiting；Accept / Change / 名字条都没了；想加的两格亮黄色、写 asked（等排班的人）",
    await evaluate(`const s = document.querySelector('[data-confirm-status]').textContent; return s.includes('waiting for the person in charge') && !document.querySelector('[data-confirm-accept]') && !document.querySelector('[data-confirm-change]') && !document.querySelector('[data-confirm-chip]') && ${added}.length === 2 && ${added}.every((a) => a.dataset.added === 'pending' && a.textContent.includes('asked'));`),
    await evaluate("return document.querySelector('[data-confirm]').innerText.slice(0, 400);"),
  );

  // ── Accept ──
  await ctl({ reset: true });
  await open();
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-confirm-accept]').click();");
  await waitFor("document.querySelector('[data-confirm-status]').textContent.startsWith('Accepted')");
  const ac = (await since(from, (e) => e.path === "/api/schedule/confirmation/accept"))[0]?.body;
  check("Accept：POST …/accept {week_start}；状态 Accepted；按钮没了", ac?.week_start === "2026-10-25" && (await evaluate("return !document.querySelector('[data-confirm-accept]') && !document.querySelector('[data-confirm-change]');")), JSON.stringify(ac));

  // ── 取消 Change：什么都不发 ──
  await ctl({ reset: true });
  await open();
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-confirm-change]').click();");
  await waitFor("document.querySelector('[data-confirm-chip]')");
  await evaluate("window.$drop('2026-10-27|close');");
  await waitFor(`${added}.length === 1`);
  await evaluate("document.querySelector('[data-confirm-cancel]').click();");
  await waitFor("document.querySelector('[data-confirm-accept]')");
  check("Cancel：加的东西清掉、回到 Accept / Change，没有发任何请求", (await since(from, (e) => e.method === "POST")).length === 0 && (await evaluate(`return ${added}.length === 0;`)));

  // ── 接口没上线 / 没登录 / 邮件链接 ──
  await ctl({ unavail: true });
  await goto(CONFIRM);
  await waitFor("document.body.innerText.includes('Nothing to confirm right now.')");
  check("接口没上线（404）：只写 Nothing to confirm right now.，不报错", await evaluate("return !document.body.innerText.includes('Could not load') && !document.body.innerText.includes('Request failed');"));
  await ctl({ unavail: false, reset: true });
  const L = `${APP}/schedule/confirm/link/tok-abc`;
  await goto(L);
  await waitFor("document.querySelector('[data-confirm]')");
  check("邮件链接：走 /api/schedule/confirmation/link/tok-abc，没有侧栏 / 顶栏（不套外框）", (await since(0, (e) => e.path === "/api/schedule/confirmation/link/tok-abc")).length >= 1 && (await evaluate("return !document.querySelector('nav[aria-label=Main]') && !document.querySelector('header') && !!document.querySelector('[data-confirm-accept]');")));
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-confirm-accept]').click();");
  await waitFor("document.querySelector('[data-confirm-status]').textContent.startsWith('Accepted')");
  check("邮件链接里 Accept：POST /api/schedule/confirmation/link/tok-abc/accept", (await since(from, (e) => e.path === "/api/schedule/confirmation/link/tok-abc/accept" && e.method === "POST")).length === 1);
  await goto(`${APP}/schedule/confirm/link/expired`);
  await waitFor("document.body.innerText.includes('This link has expired.')");
  check("过期的链接：This link has expired. Ask the office to send you a new one.", await evaluate("return document.body.innerText.includes('Ask the office to send you a new one.');"));
  check("员工点 Change / Accept / 发送都不占用共用的表：整个过程没有任何 edit-lock 请求", (await since(0, (e) => e.path.includes("edit-lock"))).length === 0);
  await ctl({ fail401: true });
  await goto(CONFIRM);
  check("没登录：跳旧后台登录页，带 next", await waitFor("location.pathname === '/auth/login' && location.search.includes('next=')"));
}
main();
