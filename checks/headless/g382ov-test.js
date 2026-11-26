// 用 Chrome DevTools 协议驱动 headless Chrome，检查 G382 HR 排班总览（Settings › HR › Schedule）。
// 前提：g382ov-mock 在 MOCK_PORT，next dev 在 APP_PORT（run-all.js 自动起）。
const { spawn } = require("child_process");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9333;
const SKIP_POLL = process.argv.includes("--skip-poll");

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
const HELPERS = SELECT_HELPERS + `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
window.$heads = () => [...document.querySelectorAll('thead th')].map(th => th.textContent.replace('⠿','').trim());
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$setValue = (el, value) => {
  if ($isSelectMenu(el)) return $sel(el, value);
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage(url) {
  await goto(url);
  await waitFor("document.querySelector('thead th')");
  await helpers();
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
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: SELECT_HELPERS });
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

// ── G382 总览（Settings › HR › Schedule）检查骨架。页面在 53 的分支上（components/hr/schedule-overview/*），
//    选择器先写成 SEL 里的占位，53 给了真的再换。页面还没好时整套报 SKIP，退出码 1（不算 clean）。
//    依据：preview v2 https://claude.ai/artifact/B2WxdSVvzdQATs53tkzp7B；契约 interface.md（后端 task/g382-hr-schedule @ f77fbb57）。
const PAGE = `${APP}/settings/hr?tab=schedule`;
const SEL = {
  root: "[data-schedule-overview]", // 整个总览
  week: "[data-ov-week]", // 一周一块（data-ov-week="2026-11-15"）
  dayCol: "[data-ov-day]", // 每块里的一天一列
  time: "[data-ov-time]", // 班上的时间字
  alerts: "[data-ov-alert]", // 页顶提醒栏（4 条）
  save: "[data-ov-save]", // 蓝色 Save
  unsaved: "[data-ov-unsaved]", // 红字 Not saved yet
  ruleBox: "[data-ov-rule-problems]", // 「Can’t save: rule problems」框
  editKey: "[data-ov-edit]", // 任何编辑键（拖、Fill、Add leave 等都挂这个）
  fill: "[data-ov-fill]",
  addLeave: "[data-ov-add-leave]",
  shift: "[data-ov-shift]", // 一个班（data-ov-shift=<slot id>）
  leaveReqs: "[data-ov-leave-requests]", // Leave requests 栏
  changeReqs: "[data-ov-change-requests]", // Shift change requests 栏
  askSave: "[data-ov-ask-save]", // 有没存的改动时点请假：先问要不要存
  howTo: "[data-how-to-use]",
};
let skipAll = false;
function todo(name) {
  results.push({ name, ok: false, detail: "SKIP: page not built yet" });
  console.log(`SKIP  ${name}`);
}
async function maybe(name, fn) {
  if (skipAll) return todo(name);
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e && e.message ? e.message : e));
  }
}

async function run() {
  await ctl({ reset: true });
  await goto(PAGE);
  if (!(await waitFor(`document.querySelector('${SEL.root}')`, 20000))) skipAll = true;
  if (!skipAll) await helpers();

  // ── 版面 ──
  await maybe("4 周 = 4 块往下排，每块 7 列", async () => {
    check("4 周 = 4 块往下排，每块 7 列", await evaluate(`const w = [...document.querySelectorAll('${SEL.week}')]; return w.length === 4 && w.every(x => x.querySelectorAll('${SEL.dayCol}').length === 7) && w.every((x, i) => i === 0 || x.getBoundingClientRect().top > w[i - 1].getBoundingClientRect().top);`));
  });
  await maybe("页顶 4 条提醒栏", async () => {
    check("页顶 4 条提醒栏", await evaluate(`return document.querySelectorAll('${SEL.alerts}').length === 4;`));
  });
  await maybe("半屏 950：时间字 ≥ 6px、不折行", async () => {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 950, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    check("半屏 950：时间字 ≥ 6px、不折行", await evaluate(`const t = [...document.querySelectorAll('${SEL.time}')]; return t.length > 0 && t.every(e => parseFloat(getComputedStyle(e).fontSize) >= 6 && e.getClientRects().length === 1);`));
    await cdp("Emulation.clearDeviceMetricsOverride");
    await sleep(300);
  });

  // ── 先选后存 ──
  await maybe("拖班 / Fill / Add leave 只改草稿，没调接口；红字 Not saved yet", async () => {
    // TODO(53 给选择器后)：拖一个班到另一天、点 Fill 选人、Add leave 填一条
    const before = (await mockLog()).length;
    check("拖班 / Fill / Add leave 只改草稿，没调接口；红字 Not saved yet", !!(await evaluate(`return !!document.querySelector('${SEL.unsaved}');`)) && (await mockLog()).length === before);
  });
  await maybe("按 Save 才发一次 range/changes（含跨周的 weeks 和 ops）", async () => {
    await evaluate(`document.querySelector('${SEL.save}').click(); return 1;`);
    await sleep(800);
    const posts = (await mockLog()).filter((l) => l.path === "/api/schedule/range/changes");
    check("按 Save 才发一次 range/changes（含跨周的 weeks 和 ops）", posts.length === 1 && Array.isArray(posts[0].body.weeks) && Array.isArray(posts[0].body.ops), JSON.stringify(posts).slice(0, 300));
  });
  await maybe("409 rule_violation：出「Can’t save: rule problems」框，只有 Back to edit", async () => {
    // TODO：造一个新违规（Thu 12/10 Close 的人放到 Fri 12/11 Mid），Save
    check("409 rule_violation：出「Can’t save: rule problems」框，只有 Back to edit", await evaluate(`const b = document.querySelector('${SEL.ruleBox}'); if (!b) return false; const btns = [...b.querySelectorAll('button')].map(x => x.textContent.trim()); return b.textContent.includes('Can’t save: rule problems') && btns.length === 1 && btns[0] === 'Back to edit';`));
  });
  await maybe("有没存的改动时点请假：先问要不要存", async () => {
    check("有没存的改动时点请假：先问要不要存", await evaluate(`return !!document.querySelector('${SEL.askSave}');`));
  });
  await maybe("有没存的改动时离开页面：拦下来问", async () => {
    check("有没存的改动时离开页面：拦下来问", await evaluate(`return !!document.querySelector('[data-leave-guard], [role=dialog]');`));
  });

  // ── 只能批假的人 ──
  await ctl({ reset: true, viewer: "approver" });
  await goto(PAGE);
  if (!skipAll) {
    await waitFor(`document.querySelector('${SEL.root}')`, 20000);
    await helpers();
  }
  await maybe("can_edit=false：没有任何编辑键、只有 Leave requests 能点、没有 Shift change requests 栏", async () => {
    check("can_edit=false：没有任何编辑键、只有 Leave requests 能点、没有 Shift change requests 栏", await evaluate(`return !document.querySelector('${SEL.editKey}') && !document.querySelector('${SEL.save}') && !!document.querySelector('${SEL.leaveReqs}') && !document.querySelector('${SEL.changeReqs}');`));
  });

  // ── 手机 390 ──
  await ctl({ reset: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(PAGE);
  if (!skipAll) {
    await waitFor(`document.querySelector('${SEL.root}')`, 20000);
    await helpers();
  }
  await maybe("手机 390：没有横向滚动条、How to use 在最底", async () => {
    check("手机 390：没有横向滚动条、How to use 在最底", await evaluate(`const h = document.querySelector('${SEL.howTo}'); const d = document.documentElement; return d.scrollWidth <= d.clientWidth && !!h && h.getBoundingClientRect().bottom >= Math.max(...[...document.querySelectorAll('${SEL.root} *')].map(e => e.getBoundingClientRect().bottom)) - 1;`));
  });
  await cdp("Emulation.clearDeviceMetricsOverride");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
