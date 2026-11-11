// 用 Chrome DevTools 协议驱动 headless Chrome，检查 G282 休假：Staff Schedule › Leave 标签（员工申请 / 撤回、批复人批准 / 驳回、手机版）和 Team 页 Reporting lines。
// 前提：leave-mock 在 MOCK_PORT（它自己起 sch-mock / tp-mock 当上游），next dev 在 APP_PORT。
const { spawn } = require("child_process");
const path = require("path");

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
const HELPERS = `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
window.$heads = () => [...document.querySelectorAll('thead th')].map(th => th.textContent.replace('⠿','').trim());
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$setValue = (el, value) => {
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



// ───────────── G282 Leave（leave-mock.js）─────────────
const text = () => evaluate("return document.body.innerText;");
async function openSchedule(q = "") {
  await goto(`${APP}/schedule${q}`);
  await waitFor("document.querySelector('[role=tablist]')", 20000);
  await helpers();
}
async function openLeave() {
  await openSchedule("?tab=leave");
  await waitFor("document.querySelector('[data-leave-view]')");
  await waitFor("!document.body.innerText.includes('Loading…')");
}
const click = (sel) => evaluate(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true;`);
async function setField(sel, value) {
  await evaluate(`const el = document.querySelector(${JSON.stringify(sel)});
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;`);
}
const visible = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none'; })()`;

async function run() {
  await ctl({ reset: true, upstream: "sch", viewer: "staff", sch: { role: "staff", meName: "Nadia", fail401: false } });

  // ── 员工 Nadia ──
  await openSchedule();
  const tabs = await evaluate("return $t('[role=tab]');");
  check("标签里有 Leave（员工也有）", tabs.includes("Leave"), JSON.stringify(tabs));
  check("员工不是批复人：标签只写 Leave，没有 waiting", !tabs.some((t) => t.includes("waiting")), JSON.stringify(tabs));
  await openLeave();
  check("?tab=leave 直接打开 Leave 标签", await evaluate("return !!document.querySelector('[data-leave-view]');"));
  check("员工看不到 Waiting for approval / Handled", await evaluate("return !document.querySelector('[data-leave-section=waiting]') && !document.querySelector('[data-leave-section=handled]');"));
  check("有 Request leave 表单和 My leave requests", await evaluate("return !!document.querySelector('[data-leave-form]') && !!document.querySelector('[data-leave-section=mine]');"));
  const rows = await evaluate("return [...document.querySelectorAll('[data-leave-mine]')].map(tr => tr.innerText.replace(/\\s+/g,' '));");
  check("My leave requests 三条，新的在前", rows.length === 3 && rows[0].includes("Nov 24") && rows[0].includes("Pending"), JSON.stringify(rows));
  check("驳回那条写 by Tessa 和理由", rows.some((r) => r.includes("Rejected") && r.includes("by Tessa") && r.includes("Short-staffed")), JSON.stringify(rows));
  check("天数：3 days / 1 day", rows[0].includes("3 days") && rows.some((r) => r.includes("1 day")));
  check("状态颜色：Pending 黄、Approved 绿、Rejected 红", await evaluate(`
    const c = (s) => document.querySelector('[data-leave-mine] [data-leave-status='+s+']').className;
    return c('pending').includes('amber') && c('approved').includes('emerald') && c('rejected').includes('red');`));
  check("Withdraw 只在 Pending 那条", (await evaluate("return [...new Set([...document.querySelectorAll('[data-leave-withdraw]')].map(b => b.dataset.leaveWithdraw))];")).join() === "1");
  check("Send request 是蓝色提交键", await evaluate("const b = document.querySelector('[data-leave-send]'); return getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));

  // 前端先挡：最后一天在第一天前
  await setField("#leave-from", "2026-12-10");
  await setField("#leave-to", "2026-12-08");
  await waitFor("document.querySelector('[data-leave-form-msg]')");
  check("最后一天在第一天前：红字 + Send 灰", (await evaluate("return document.querySelector('[data-leave-form-msg]').textContent;")) === "The last day is before the first day." && (await evaluate("return document.querySelector('[data-leave-send]').disabled;")));
  await setField("#leave-to", "2027-01-20");
  await sleep(200);
  check("超过 31 天：红字", (await evaluate("return document.querySelector('[data-leave-form-msg]')?.textContent || '';")).includes("up to 31 days"));

  // 发一条
  await setField("#leave-from", "2026-12-10");
  await setField("#leave-to", "2026-12-11");
  await setField("#leave-kind", "personal");
  await setField("#leave-note", "Dentist");
  await sleep(150);
  check("填好后显示 2 days", (await evaluate("return document.querySelector('[data-leave-days]').textContent;")) === "2 days");
  await click("[data-leave-send]");
  await waitFor("(document.querySelector('[data-leave-form-msg]')?.textContent || '').startsWith('Sent')");
  const sent = (await mockLog()).filter((l) => l.op === "create").pop();
  check("POST 带 date_from / date_to / kind / note", sent && sent.body.date_from === "2026-12-10" && sent.body.date_to === "2026-12-11" && sent.body.kind === "personal" && sent.body.note === "Dentist", JSON.stringify(sent));
  check("发完绿字 Sent", await evaluate("const m = document.querySelector('[data-leave-form-msg]'); return m.textContent.startsWith('Sent') && m.className.includes('emerald');"));
  await waitFor("document.querySelectorAll('[data-leave-mine]').length === 4");
  check("新申请出现在 My leave requests 最上面", (await evaluate("return document.querySelector('[data-leave-mine]').innerText;")).includes("Dec 10"));

  // 撤回（要确认一下）
  await click("[data-leave-withdraw='1']");
  await waitFor("document.querySelector(\"[data-leave-withdraw-yes='1']\")");
  check("Withdraw 先问一句再撤", (await text()).includes("Withdraw this request?"));
  await click("[data-leave-withdraw-yes='1']");
  await waitFor("document.querySelector(\"[data-leave-mine='1'] [data-leave-status=withdrawn]\")");
  check("撤回后那条变 Withdrawn、变灰", await evaluate("const tr = document.querySelector(\"[data-leave-mine='1']\"); return tr.innerText.includes('Withdrawn') && parseFloat(getComputedStyle(tr).opacity) < 1;"));
  check("撤回调了 withdraw 接口", (await mockLog()).some((l) => l.op === "withdraw" && l.id === 1));

  // 撤回时已经被批了 ⇒ 409 原话红字、状态跟着变
  await ctl({ race: true });
  const newId = await evaluate("return Number(document.querySelector('[data-leave-withdraw]')?.dataset.leaveWithdraw || 0);");
  await click(`[data-leave-withdraw='${newId}']`);
  await waitFor(`document.querySelector("[data-leave-withdraw-yes='${newId}']")`);
  await click(`[data-leave-withdraw-yes='${newId}']`);
  await waitFor(`document.querySelector("[data-leave-mine='${newId}'] [data-leave-status=approved]")`);
  check("撤回撞上已批：红字后端原话 + 状态变 Approved", (await text()).includes("This request was already approved by Tessa."));
  await ctl({ race: false });

  // 不在排班名单上
  await ctl({ notOnSchedule: true });
  await openLeave();
  check("不在排班名单上：不出表单，显示提示", await evaluate("return !document.querySelector('[data-leave-form]') && !!document.querySelector('[data-leave-not-on-schedule]');"));
  await ctl({ notOnSchedule: false });

  // ── 批复人 Tessa ──
  await ctl({ reset: true, viewer: "approver", sch: { role: "admin", meName: "Tessa" } });
  await openSchedule();
  await waitFor("$t('[role=tab]').some(t => t.includes('waiting'))");
  check("批复人标签写 Leave · 3 waiting（Nadia、Lizzie、Jing）", (await evaluate("return $t('[role=tab]');")).includes("Leave · 3 waiting"));
  await openLeave();
  check("批复人有 Waiting for approval 和 Handled，在申请表单上面", await evaluate(`
    const w = document.querySelector('[data-leave-section=waiting]'), h = document.querySelector('[data-leave-section=handled]'), r = document.querySelector('[data-leave-section=request]');
    return !!w && !!h && (w.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);`));
  const q = await evaluate("return [...document.querySelectorAll('[data-leave-queue]')].map(tr => tr.innerText.replace(/\\s+/g,' '));");
  check("待批三条：Nadia、Lizzie、Jing，都写 You are their manager", q.filter((r) => r.includes("Approve Reject")).length === 3 && ["Nadia", "Lizzie", "Jing"].every((n) => q.some((r) => r.startsWith(n) && r.includes("You are their manager"))), JSON.stringify(q));
  check("Lizzie 那天有班：黄框写班名和时间", await evaluate("const w = document.querySelector(\"[data-leave-queue='11'] [data-leave-shift-warn=warn]\"); return !!w && w.textContent.includes('Close 14:00–22:00') && w.textContent.includes(\"won't change the schedule\");"));
  check("Q7 A：有班也能点 Approve", await evaluate("return !document.querySelector(\"[data-leave-approve='11']\").disabled;"));
  check("Jing 没班：没有黄框", await evaluate("return !document.querySelector(\"[data-leave-queue='12'] [data-leave-shift-warn]\");"));
  check("Approve 蓝、Reject 不是蓝", await evaluate("const a = getComputedStyle(document.querySelector(\"[data-leave-approve='11']\")).backgroundColor, r = getComputedStyle(document.querySelector(\"[data-leave-reject='11']\")).backgroundColor; return a === 'rgb(59, 130, 246)' && r !== a;"));
  check("Handled 里 Veronica：Approved by Tessa", (await evaluate("return document.querySelector('[data-leave-section=handled]').innerText;")).includes("by Tessa"));

  await click("[data-leave-approve='11']");
  await waitFor("document.querySelector(\"[data-leave-section=handled] [data-leave-queue='11']\")");
  check("批准后 Lizzie 移到 Handled，绿字 Approved. Lizzie has been emailed.", await evaluate("const d = document.querySelector(\"[data-leave-done='11']\"); return !!d && d.textContent === 'Approved. Lizzie has been emailed.' && d.className.includes('emerald');"));
  check("标签条数跟着变 2 waiting", (await evaluate("return $t('[role=tab]');")).includes("Leave · 2 waiting"));

  // Reject：理由可空，填了就带上
  await click("[data-leave-reject='12']");
  await waitFor("document.querySelector(\"[data-leave-reason='12']\")");
  check("Reject 先出理由框（写明可不填）", (await evaluate("return document.querySelector(\"[data-leave-reason='12']\").placeholder;")) === "Reason (optional, sent to Jing)");
  await setField("[data-leave-reason='12']", "Too many people off that weekend");
  await click("[data-leave-reject-send='12']");
  await waitFor("document.querySelector(\"[data-leave-section=handled] [data-leave-queue='12']\")");
  const rj = (await mockLog()).filter((l) => l.op === "reject").pop();
  check("驳回带 note", rj && rj.body.note === "Too many people off that weekend", JSON.stringify(rj));
  check("Handled 里 Jing 写 Rejected + 理由", (await evaluate("return document.querySelector(\"[data-leave-section=handled] [data-leave-queue='12']\").innerText;")).includes("Too many people off"));
  await click("[data-leave-approve='1']");
  await waitFor("document.querySelector(\"[data-leave-section=handled] [data-leave-queue='1']\")");
  check("没有待批了：Nothing waiting", (await evaluate("return document.querySelector('[data-leave-section=waiting]').innerText;")).includes("Nothing waiting."));

  // 别人先批了 ⇒ 409 原话红字放 Handled
  await ctl({ reset: true, race: true });
  await openLeave();
  await click("[data-leave-approve='12']");
  await waitFor("document.querySelector(\"[data-leave-done='12']\")");
  check("别人先批了：红字后端原话，那条进 Handled", await evaluate("const d = document.querySelector(\"[data-leave-done='12']\"); return d.textContent === 'This request was already approved by Annie.' && d.className.includes('red');"));
  await ctl({ race: false, failDecide: "Jing already has a shift on Sat, Nov 15, so time off can't be set for that day." });
  await openLeave();
  await click("[data-leave-approve='11']");
  await waitFor("document.querySelector(\"[data-leave-decide-error='11']\")");
  check("后端 400 原话红字留在那一行", (await evaluate("return document.querySelector(\"[data-leave-decide-error='11']\").textContent;")).includes("time off can't be set"));
  await ctl({ failDecide: "" });

  // ── 手机 ──
  await ctl({ reset: true, viewer: "staff", sch: { role: "staff", meName: "Nadia" } });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openLeave();
  check("手机：申请表单默认收起，有 + Request leave", (await evaluate(`return ${visible("[data-leave-form]")};`)) === false && (await evaluate(`return ${visible("[data-leave-form-toggle]")};`)));
  await click("[data-leave-form-toggle]");
  await sleep(200);
  check("手机：点开后出表单", await evaluate(`return ${visible("[data-leave-form]")};`));
  check("手机：说明收进 i", await evaluate("return !!document.querySelector('[data-leave-section=request] [data-phone-info]');"));
  check("手机：My leave requests 是卡片，不是表格", (await evaluate(`return ${visible("[data-leave-mine-card]")};`)) && !(await evaluate(`return ${visible("[data-leave-mine]")};`)));
  check("手机：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= window.innerWidth + 1;"));
  await ctl({ viewer: "approver", sch: { role: "admin", meName: "Tessa" } });
  await openLeave();
  check("手机：待批也是卡片，黄框照出", (await evaluate(`return ${visible("[data-leave-queue-card]")};`)) && (await evaluate("return !!document.querySelector(\"[data-leave-queue-card='11'] [data-leave-shift-warn]\");")));
  check("手机（批复人）：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= window.innerWidth + 1;"));
  await cdp("Emulation.clearDeviceMetricsOverride");

  // ── Team 页：Manager + Reporting lines ──
  await ctl({ reset: true, upstream: "tp", viewer: "superadmin", tp: "reset=1&viewer=superadmin" });
  await goto(`${APP}/settings/team`);
  await waitFor("document.querySelector('[data-reporting-lines]')", 25000);
  await helpers();
  const tree = await evaluate("return document.querySelector('[data-reporting-tree]')?.innerText || '';");
  check("Reporting lines：Tessa 下面 5 人、CLIN 下面 Anita", tree.includes("Tessa") && tree.includes("CLIN") && tree.includes("Anita") && tree.includes("Jessica"), tree);
  check("Team leads：Tour Guides 是 Lizzie、0 人有灰字", await evaluate("const r = document.querySelector(\"[data-team-lead-row='6']\"); return document.querySelector(\"[data-team-lead='6']\").value === '12' && r.innerText.includes('No one is in this team yet');"));
  check("没改时 Save 灰", await evaluate("return document.querySelector('[data-team-lead-save]').disabled;"));
  await setField("[data-team-lead='1']", "2");
  await sleep(150);
  check("改了下拉：红字 Not saved yet，Save 能按，没调接口（先暂存）", (await evaluate("return document.querySelector('[data-team-lead-msg]').textContent;")) === "Not saved yet" && !(await evaluate("return document.querySelector('[data-team-lead-save]').disabled;")) && !(await mockLog()).some((l) => l.op === "team-leads"));
  await click("[data-team-lead-save]");
  await waitFor("(document.querySelector('[data-team-lead-msg]')?.textContent || '') === 'Saved'");
  const tl = (await mockLog()).filter((l) => l.op === "team-leads");
  check("Save 后只存改了的那个 team，绿字 Saved", tl.length === 1 && tl[0].id === 1 && tl[0].body.lead_user_id === 2 && (await evaluate("return document.querySelector('[data-team-lead-msg]').className;")).includes("#15803d"), JSON.stringify(tl));
  await ctl({ failLead: true });
  await setField("[data-team-lead='2']", "3");
  await click("[data-team-lead-save]");
  await waitFor("(document.querySelector('[data-team-lead-msg]')?.textContent || '').includes('Pick an active')");
  check("存失败：红字后端原话", await evaluate("const m = document.querySelector('[data-team-lead-msg]'); return m.className.includes('#c0392b');"));
  await ctl({ failLead: false });

  // 成员弹窗：Manager 下拉（Super Admin），跟弹窗同一个 Save，Manager 变了才单独 PUT
  const clickRowBtn = (label, scope) => evaluate(`const tr = [...document.querySelectorAll('tr')].find(t => t.innerText.includes(${JSON.stringify(scope)})); const b = tr && [...tr.querySelectorAll('button')].find(b => b.innerText.replace(/\\s+/g,' ').trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true;`);
  const dialogSave = () => evaluate("const b = [...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Save'); if (!b) return false; b.click(); return true;");
  check("Team 页 @grace 那行有 Edit", await clickRowBtn("Edit", "@grace"));
  await waitFor("document.querySelector('[data-member-manager]')");
  const opts = await evaluate("return [...document.querySelectorAll('[data-member-manager] option')].map(o => o.textContent);");
  check("Manager 下拉：No manager + 候选人，不含自己（grace = 2 = Tessa）", opts[0] === "No manager (use team lead)" && opts.includes("CLIN") && !opts.includes("Tessa"), JSON.stringify(opts));
  const dlg = await evaluate("return document.querySelector('[role=dialog]').innerText;");
  check("Manager 说明：没设时写发给 team lead / Super Admin", dlg.includes("go to the team lead of each of their teams"));
  check("Manager 下面列出 Reports to（Tessa 管的人）", dlg.includes("Jessica, Jing, Lizzie, Nadia, Veronica"), dlg.slice(0, 200));
  await setField("[data-member-manager]", "3");
  await sleep(100);
  check("选了以后没马上存（先暂存）", !(await mockLog()).some((l) => l.op === "managers"));
  await dialogSave();
  await waitFor("!document.querySelector('[data-member-manager]')", 10000);
  const mg = (await mockLog()).filter((l) => l.op === "managers");
  check("按 Save：PUT managers/2 {manager_user_id: 3}", mg.length === 1 && mg[0].id === 2 && mg[0].body.manager_user_id === 3, JSON.stringify(mg));
  await clickRowBtn("Edit", "@grace");
  await waitFor("document.querySelector('[data-member-manager]')");
  const mv = await evaluate("return document.querySelector('[data-member-manager]').value;");
  await dialogSave();
  await waitFor("!document.querySelector('[data-member-manager]')", 10000);
  check("再打开显示 CLIN；没改就 Save 不再 PUT managers", mv === "3" && (await mockLog()).filter((l) => l.op === "managers").length === 1, mv);

  // admin 打开：只读
  await ctl({ viewer: "admin", tp: "viewer=admin&g212=1" });
  await goto(`${APP}/settings/team`);
  await waitFor("document.querySelector('[data-reporting-lines]')", 25000);
  check("admin：Reporting lines 照出", await evaluate("return !!document.querySelector('[data-reporting-lines]');"), await evaluate("return document.body.innerText.slice(0, 400);"));
  check("admin：Team leads 只读、没有 Save", await evaluate("return !document.querySelector('[data-team-lead]') && !!document.querySelector('[data-team-lead-ro]') && !document.querySelector('[data-team-lead-save]');"));
  if (await clickRowBtn("Edit", "@daniel")) {
    await waitFor("document.querySelector('[data-member-manager-ro]')", 10000);
    check("admin：成员弹窗里 Manager 只读（没有下拉）", await evaluate("return !!document.querySelector('[data-member-manager-ro]') && !document.querySelector('[data-member-manager]');"));
  } else check("admin：能打开 @daniel 的 Edit", false);
  // 不能读 leave-routing ⇒ 整块不出
  await ctl({ viewer: "approver" });
  await goto(`${APP}/settings/team`);
  await sleep(2500);
  check("读不到 leave-routing（403）：Reporting lines 整块不出", await evaluate("return !document.querySelector('[data-reporting-lines]');"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
