// 用 Chrome DevTools 协议驱动 headless Chrome，检查 G382 HR 排班总览（Settings › HR › Schedule）。
// 前提：g382ov-mock 在 MOCK_PORT，next dev 在 APP_PORT（run-all.js 自动起）。
const { spawn } = require("child_process");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");
const { CONTRAST_HELPERS } = require("./contrast-helper");

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

// ── G382 总览（Settings › HR › Schedule）。页面 = ab 的 components/hr/schedule-overview/*（task/g382-ov-ab），
//    依据 preview v3 https://claude.ai/artifact/B2WxdSVvzdQATs53tkzp7B、后端契约 interface.md @ 77404fa0。
//    骨架（61）的 10 项 SKIP 换成真操作（e2 2026-11-26）。页面打不开时整套照旧报 SKIP（不算通过，退出码 1）。
//    mock 的种子是 2026-11-15 起 4 周、today = 11-25 ⇒ 浏览器里的「现在」固定成 2026-11-25（偏移 Date，时间照走）。
const PAGE = `${APP}/settings/hr?tab=schedule`;
const SEL = {
  root: "[data-schedule-overview]", // 整个总览
  week: "[data-ov-week]", // 一周一块（data-ov-week="2026-11-15"）
  dayCol: "[data-ov-day]", // 每块里的一天一列
  time: "[data-ov-time]", // 班上的时间字
  alerts: "[data-ov-alert]", // 页顶提醒栏
  save: "[data-ov-save]", // 蓝色 Save
  unsaved: "[data-ov-unsaved]", // 红字 Not saved yet · N changes
  saved: "[data-ov-saved]", // 绿字 Saved
  ruleBox: "[data-ov-rule-problems]", // 「Can’t save: rule problems」框（内容；键在框的底栏）
  editKey: "[data-ov-edit]", // 任何编辑键
  shift: "[data-ov-shift]", // 一个班（data-ov-shift=<slot key>）
  cell: "[data-ov-cell]", // 一格（data-ov-cell="<emp>|<date>"，emp 空 = Unassigned 那行 "null|…"）
  pending: "[data-ov-pending]", // 格子里待批的请假
  leaveReqs: "[data-ov-leave-requests]", // Leave requests 栏
  changeReqs: "[data-ov-change-requests]", // Shift change requests 栏
  askSave: "[data-ov-ask-save]", // 「Save your changes first?」框
  howTo: "[data-how-to-use]",
};
const FAKE_NOW = Date.UTC(2026, 10, 25, 19, 0, 0); // LA 2026-11-25 11:00
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
/** 只算写请求里跟编辑锁无关的（占锁 / 心跳 / 放锁不算「存」）。 */
const writes = async (from = 0) =>
  (await mockLog()).slice(from).filter((l) => !/\/edit-lock/.test(l.path));
/** Settings › Rules 弹窗用的几条规则（一条关着，看划掉的那行）。 */
const RULES_FIXTURE = [
  { id: "r1", type: "weekend_rotation", enabled: true, params: { slots: [{ day: 6, shift_type: "open" }, { day: 0, shift_type: "open" }], employee_ids: [1, 2], exclusive: true } },
  { id: "r2", type: "cannot_work", enabled: true, params: { employee_id: 3, shift_type: "close", days: [1, 2] } },
  { id: "r3", type: "fixed_shift", enabled: false, params: { employee_id: 4, shift_type: "mid", days: [3] } },
];
async function openRules() {
  await evaluate("[...document.querySelectorAll('button[data-ov-edit]')].find((b) => b.textContent.trim() === 'Rules')?.click() ?? (() => { const more = [...document.querySelectorAll('button')].find((b) => /More|⋯/.test(b.textContent.trim())); more?.click(); })();");
  if (!(await waitFor("document.querySelector('[data-rules-view] [data-rule-row]')", 3000))) {
    await evaluate("[...document.querySelectorAll('button[data-ov-edit]')].find((b) => b.textContent.trim() === 'Rules')?.click();");
    if (!(await waitFor("document.querySelector('[data-rules-view] [data-rule-row]')", 10000))) throw new Error("Rules dialog did not open");
  }
  await sleep(300);
}
async function openOverview() {
  await goto(PAGE);
  const ok = await waitFor(`document.querySelector('${SEL.root}') && document.querySelectorAll('${SEL.week}').length > 0`, 30000);
  if (ok) await helpers();
  return ok;
}
/** 页面里的拖放：在 from 上 dragstart（班卡自己 setData），把同一个 DataTransfer 拿去 target 上 dragover + drop。 */
async function drag(fromSel, toSel) {
  return evaluate(`
    const a = document.querySelector(${JSON.stringify(fromSel)}), b = document.querySelector(${JSON.stringify(toSel)});
    if (!a || !b) return 'missing ' + (!a ? ${JSON.stringify(fromSel)} : ${JSON.stringify(toSel)});
    const dt = new DataTransfer();
    a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    b.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    a.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return 'ok';`);
}
/**
 * 草稿周里挑一个有人的班，拖到同一天 Unassigned 那一格：只少一个人、不会造出新违规（草稿周的空档也不拦存）。
 * 返回 {key, emp, date}。
 */
async function pickDraftMove() {
  return evaluate(`
    // 周块页头：「Week of …」后面跟 Published / Draft · not published。
    const draftWeeks = [...document.querySelectorAll('${SEL.week}')].filter((w) => !/Published/.test(w.querySelector('b')?.parentElement?.textContent || ''));
    for (const w of draftWeeks) {
      for (const s of w.querySelectorAll('${SEL.shift}')) {
        const c = s.closest('${SEL.cell}');
        if (!c) continue;
        const [emp, date] = c.dataset.ovCell.split('|');
        if (emp === 'null') continue;
        if (!w.querySelector('[data-ov-cell="null|' + date + '"]')) continue;
        return { key: s.dataset.ovShift, emp, date };
      }
    }
    return null;`);
}
/**
 * 造一个新的 min_rest（要拦的）：草稿周里 P 某天上 Close（9:30 PM 下班），把第二天别人的一个 Open / Mid 拖给 P。
 * 休息 = 2.5 h + 第二天开始时间 < 12 h。返回 {key, to}。
 */
async function pickRestBreak() {
  return evaluate(`
    const add = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const cells = [...document.querySelectorAll('${SEL.cell}')];
    const weekOfCell = (c) => c.closest('${SEL.week}');
    const isDraft = (w) => !/Published/.test(w.querySelector('b')?.parentElement?.textContent || '');
    for (const c of cells) {
      const [emp, date] = c.dataset.ovCell.split('|');
      if (emp === 'null' || !isDraft(weekOfCell(c))) continue;
      const close = [...c.querySelectorAll('${SEL.shift}')].find((s) => /^Close/.test(s.textContent.trim()));
      if (!close) continue;
      const next = add(date, 1);
      const target = document.querySelector('[data-ov-cell="' + emp + '|' + next + '"]');
      if (!target || !isDraft(weekOfCell(target)) || target.querySelector('${SEL.shift}')) continue;
      const donor = cells.find((d) => d.dataset.ovCell.endsWith('|' + next) && !d.dataset.ovCell.startsWith(emp + '|') &&
        [...d.querySelectorAll('${SEL.shift}')].some((s) => /^(Open|Mid)/.test(s.textContent.trim())));
      if (!donor) continue;
      const s = [...donor.querySelectorAll('${SEL.shift}')].find((x) => /^(Open|Mid)/.test(x.textContent.trim()));
      return { key: s.dataset.ovShift, to: emp + '|' + next, from: donor.dataset.ovCell };
    }
    return null;`);
}

async function run() {
  // 「现在」固定成 2026-11-25（mock 的 today），偏移着走，计时器照常。
  await cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => { const R = Date; const delta = ${FAKE_NOW} - R.now();
      class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + delta); } static now() { return R.now() + delta; } }
      globalThis.Date = D; })();`,
  });
  await ctl({ reset: true, viewer: "editor", canPublish: true });
  if (!(await openOverview())) skipAll = true;

  // ── 版面 ──
  await maybe("4 周 = 4 块往下排，每块 7 列（Nov 15 – Dec 12）", async () => {
    const m = await evaluate(`const w = [...document.querySelectorAll('${SEL.week}')]; return { n: w.length, cols: w.map((x) => x.querySelectorAll('${SEL.dayCol}').length), down: w.every((x, i) => i === 0 || x.getBoundingClientRect().top > w[i - 1].getBoundingClientRect().top), weeks: w.map((x) => x.dataset.ovWeek) };`);
    check("4 周 = 4 块往下排，每块 7 列（Nov 15 – Dec 12）", m.n === 4 && m.cols.every((c) => c === 7) && m.down && m.weeks.join(",") === "2026-11-15,2026-11-22,2026-11-29,2026-12-06", JSON.stringify(m));
  });
  await maybe("页顶 4 条提醒栏", async () => {
    const n = await evaluate(`return document.querySelectorAll('${SEL.alerts}').length;`);
    check("页顶 4 条提醒栏", n === 4, `n=${n}`);
  });
  await maybe("半屏 950：时间字 ≥ 6px、不折行", async () => {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 950, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const m = await evaluate(`const t = [...document.querySelectorAll('${SEL.time}')]; const fs = t.map((e) => parseFloat(getComputedStyle(e).fontSize)); return { n: t.length, min: Math.min(...fs), multi: t.filter((e) => e.getClientRects().length !== 1 || e.scrollHeight > e.clientHeight + 1).length };`);
    check("半屏 950：时间字 ≥ 6px、不折行", m.n > 0 && m.min >= 6 && m.multi === 0, JSON.stringify(m));
    await cdp("Emulation.clearDeviceMetricsOverride");
    await sleep(300);
  });

  // ── 先选后存 ──
  let moved = null;
  await maybe("拖班只改草稿，没调接口；红字 Not saved yet · 1 change", async () => {
    moved = await pickDraftMove();
    if (!moved) throw new Error("no draft-week shift to move");
    const before = (await mockLog()).length;
    const r = await drag(`[data-ov-shift="${moved.key}"]`, `[data-ov-cell="null|${moved.date}"]`);
    const shown = await waitFor(`document.querySelector('${SEL.unsaved}')`, 8000);
    const text = await evaluate(`return document.querySelector('${SEL.unsaved}')?.textContent ?? '';`);
    const where = await evaluate(`return document.querySelector('[data-ov-shift="${moved.key}"]')?.closest('${SEL.cell}')?.dataset.ovCell ?? '';`);
    const w = await writes(before);
    check("拖班只改草稿，没调接口；红字 Not saved yet · 1 change", r === "ok" && shown && text === "Not saved yet · 1 change" && where === `null|${moved.date}` && w.length === 0, JSON.stringify({ r, text, where, writes: w.map((x) => x.method + " " + x.path), moved }));
  });
  await maybe("按 Save 才发一次 range/changes（weeks + ops，assign 给 Unassigned，base_version 字符串），绿字 Saved", async () => {
    const before = (await mockLog()).length;
    await evaluate(`document.querySelector('${SEL.save}').click(); return 1;`);
    await waitFor(`document.querySelector('${SEL.saved}') || document.querySelector('[data-ov-save-error]')`, 10000);
    const posts = (await writes(before)).filter((l) => l.path === "/api/schedule/range/changes");
    const b = posts[0]?.body;
    const ok =
      posts.length === 1 &&
      Array.isArray(b?.weeks) && Array.isArray(b?.ops) &&
      b.ops.length === 1 && b.ops[0].op === "assign" && b.ops[0].employee_id == null && String(b.ops[0].slot) === String(moved?.key) &&
      b.weeks.some((w) => typeof w.base_version === "string" && typeof w.lock_token === "string") &&
      (await evaluate(`const s = document.querySelector('${SEL.saved}'); return !!s && s.textContent.trim() === 'Saved' && getComputedStyle(s).color === 'rgb(21, 128, 61)' && !document.querySelector('${SEL.unsaved}');`));
    check("按 Save 才发一次 range/changes（weeks + ops，assign 给 Unassigned，base_version 字符串），绿字 Saved", ok, JSON.stringify(posts).slice(0, 400));
  });
  await maybe("409 rule_violation：出「Can’t save: rule problems」框，列后端原话，只有 Back to edit；没存", async () => {
    const pick = await pickRestBreak();
    if (!pick) throw new Error("no Close → next-day Open/Mid pair in the draft weeks");
    await drag(`[data-ov-shift="${pick.key}"]`, `[data-ov-cell="${pick.to}"]`);
    await waitFor(`document.querySelector('${SEL.unsaved}')`, 8000);
    const before = (await mockLog()).length;
    await evaluate(`document.querySelector('${SEL.save}').click(); return 1;`);
    await waitFor(`document.querySelector('${SEL.ruleBox}')`, 10000);
    const m = await evaluate(`
      const b = document.querySelector('${SEL.ruleBox}'); if (!b) return null;
      const h = document.getElementById('ov-rule-box');
      let panel = h; while (panel && !panel.contains(b)) panel = panel.parentElement;
      const btns = [...panel.querySelectorAll('button')].filter((x) => x.getAttribute('aria-label') !== 'Close').map((x) => x.textContent.trim());
      return { title: h?.textContent, btns, items: [...b.querySelectorAll('li')].map((li) => li.textContent), unsaved: !!document.querySelector('${SEL.unsaved}') };`);
    const post = (await writes(before)).filter((l) => l.path === "/api/schedule/range/changes");
    check("409 rule_violation：出「Can’t save: rule problems」框，列后端原话，只有 Back to edit；没存",
      !!m && m.title === "Can’t save: rule problems" && m.btns.length === 1 && m.btns[0] === "Back to edit" && m.items.some((t) => /rest between/.test(t)) && m.unsaved && post.length === 1,
      JSON.stringify({ m, pick }));
    await evaluate("[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Back to edit')?.click(); return 1;");
    await waitFor(`!document.querySelector('${SEL.ruleBox}')`, 5000);
  });
  await maybe("先问要不要存 → Save → 409 rule_violation：问存框关掉，「Can’t save: rule problems」框留着、列后端原话", async () => {
    // 上一条 Back to edit 以后，违规的改动还在草稿里。
    if (!(await evaluate(`return !!document.querySelector('${SEL.unsaved}');`))) throw new Error("rule-breaking change not in the draft");
    const pend = await evaluate(`return document.querySelector('${SEL.pending}')?.dataset.ovPending ?? null;`);
    if (!pend) throw new Error("no pending leave in the grid");
    const before = (await mockLog()).length;
    await evaluate(`document.querySelector('[data-ov-pending="${pend}"]').click(); return 1;`);
    const asked = await waitFor(`document.querySelector('${SEL.askSave}')`, 5000);
    await evaluate("document.querySelector('[data-ov-ask-save-btn]').click(); return 1;");
    const boxed = await waitFor(`document.querySelector('${SEL.ruleBox}')`, 10000);
    await sleep(400); // 关框的 setState 要是有，也已经跑完
    const m = await evaluate(`return { box: !!document.querySelector('${SEL.ruleBox}'), ask: !!document.querySelector('${SEL.askSave}'), items: [...(document.querySelector('${SEL.ruleBox}')?.querySelectorAll('li') ?? [])].map((li) => li.textContent), leave: [...document.querySelectorAll('h2')].some((h) => h.textContent.startsWith('Leave request')), unsaved: !!document.querySelector('${SEL.unsaved}') };`);
    const post = (await writes(before)).filter((l) => l.path === "/api/schedule/range/changes");
    check("先问要不要存 → Save → 409 rule_violation：问存框关掉，「Can’t save: rule problems」框留着、列后端原话",
      asked && boxed && m.box && !m.ask && !m.leave && m.items.some((t) => /rest between/.test(t)) && m.unsaved && post.length === 1,
      JSON.stringify({ asked, boxed, m, posts: post.length }));
    await evaluate("[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Back to edit')?.click(); return 1;");
    await waitFor(`!document.querySelector('${SEL.ruleBox}')`, 5000);
  });
  await maybe("有没存的改动时点请假：先问要不要存；Don't save 以后打开批假框、改动丢掉", async () => {
    if (!(await evaluate(`return !!document.querySelector('${SEL.unsaved}');`))) {
      const mv = await pickDraftMove();
      await drag(`[data-ov-shift="${mv.key}"]`, `[data-ov-cell="null|${mv.date}"]`);
      await waitFor(`document.querySelector('${SEL.unsaved}')`, 8000);
    }
    const pend = await evaluate(`return document.querySelector('${SEL.pending}')?.dataset.ovPending ?? null;`);
    if (!pend) throw new Error("no pending leave in the grid");
    await evaluate(`document.querySelector('[data-ov-pending="${pend}"]').click(); return 1;`);
    const asked = await waitFor(`document.querySelector('${SEL.askSave}')`, 5000);
    const askText = await evaluate(`return document.querySelector('${SEL.askSave}')?.textContent ?? '';`);
    await evaluate("document.querySelector('[data-ov-ask-discard]').click(); return 1;");
    const opened = await waitFor("[...document.querySelectorAll('h2')].some((h) => h.textContent.startsWith('Leave request'))", 8000);
    const clean = await waitFor(`!document.querySelector('${SEL.unsaved}')`, 8000);
    check("有没存的改动时点请假：先问要不要存；Don't save 以后打开批假框、改动丢掉", asked && /unsaved change/.test(askText) && opened && clean, JSON.stringify({ asked, askText, opened, clean }));
    await evaluate("[...document.querySelectorAll('button[aria-label=Close]')].forEach((b) => b.click()); return 1;");
    await sleep(300);
  });
  await maybe("有没存的改动时离开页面（点侧栏链接）：拦下来问，网址不变；Cancel 以后改动还在", async () => {
    const mv = await pickDraftMove();
    await drag(`[data-ov-shift="${mv.key}"]`, `[data-ov-cell="null|${mv.date}"]`);
    await waitFor(`document.querySelector('${SEL.unsaved}')`, 8000);
    const href = await evaluate(`const a = [...document.querySelectorAll('a[href]')].find((x) => { const h = x.getAttribute('href'); return h && h.startsWith('/') && !h.startsWith('/settings/hr') && x.offsetParent; }); if (!a) return null; a.click(); return a.getAttribute('href');`);
    const asked = await waitFor(`document.querySelector('${SEL.askSave}')`, 5000);
    const stay = await evaluate("return location.pathname + location.search;");
    await evaluate("[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Cancel')?.click(); return 1;");
    await sleep(300);
    const kept = await evaluate(`return !!document.querySelector('${SEL.unsaved}');`);
    check("有没存的改动时离开页面（点侧栏链接）：拦下来问，网址不变；Cancel 以后改动还在", !!href && asked && stay === "/settings/hr?tab=schedule" && kept, JSON.stringify({ href, asked, stay, kept }));
    await evaluate("document.querySelector('[data-ov-discard]')?.click(); return 1;");
    await waitFor(`!document.querySelector('${SEL.unsaved}')`, 8000);
  });

  // ── Q-1 B：没建的周（后端 86 bf80cd51）──
  await ctl({ reset: true, viewer: "editor", canPublish: true });
  if (!skipAll && !(await openOverview())) skipAll = true;
  await maybe("没建的周：第一次改班先 GET weeks/{w} 建周（复制上一周的班、不带人），改动叠在上面；Save 一次存成", async () => {
    await evaluate("document.querySelector('button[aria-label=Later]').click(); return 1;");
    if (!(await waitFor("document.querySelector('[data-ov-week=\"2026-12-13\"]')", 15000))) throw new Error("week 12/13 not shown");
    await sleep(300);
    const nb = "[data-ov-week=\"2026-12-13\"] [data-ov-shift]";
    const before0 = await evaluate("return document.querySelectorAll('" + nb + "').length;");
    const pick = await evaluate("for (const c of document.querySelectorAll('[data-ov-cell$=\"|2026-12-12\"]')) { const emp = c.dataset.ovCell.split('|')[0]; if (emp === 'null') continue; const sh = c.querySelector('[data-ov-shift]'); if (sh) return { key: sh.dataset.ovShift, emp }; } return null;");
    if (!pick) throw new Error("no assigned Sat 12/12 shift");
    const before = (await mockLog()).length;
    const r = await drag('[data-ov-shift="' + pick.key + '"]', '[data-ov-cell="' + pick.emp + '|2026-12-13"]');
    await waitFor("document.querySelector('" + SEL.unsaved + "')", 10000);
    const builtLog = (await mockLog()).slice(before).filter((l) => l.op === "build");
    const after = await evaluate("return { n: document.querySelectorAll('" + nb + "').length, unassigned: document.querySelectorAll('[data-ov-week=\"2026-12-13\"] [data-ov-cell^=\"null|\"] [data-ov-shift]').length, moved: document.querySelector('[data-ov-cell=\"" + pick.emp + "|2026-12-13\"] [data-ov-shift]') ? 1 : 0, unsaved: document.querySelector('" + SEL.unsaved + "')?.textContent ?? '' };");
    const b2 = (await mockLog()).length;
    await evaluate("document.querySelector('" + SEL.save + "').click(); return 1;");
    await waitFor("document.querySelector('" + SEL.saved + "') || document.querySelector('[data-ov-save-error]')", 10000);
    const post = (await writes(b2)).filter((l) => l.path === "/api/schedule/range/changes");
    const body = post[0]?.body;
    const wk = body?.weeks?.find((w) => w.week_start === "2026-12-13");
    const saved = await evaluate("return !!document.querySelector('" + SEL.saved + "');");
    const ops = (body?.ops || []).map((o) => o.op + (o.date ? "@" + o.date : ""));
    check("没建的周：第一次改班先 GET weeks/{w} 建周（复制上一周的班、不带人），改动叠在上面；Save 一次存成",
      before0 === 0 && r === "ok" && builtLog.length === 1 && builtLog[0].path === "/api/schedule/weeks/2026-12-13" &&
        after.unassigned > 0 && after.moved === 1 && after.unsaved === "Not saved yet · 2 changes" &&
        post.length === 1 && typeof wk?.base_version === "string" && ops.includes("create@2026-12-13") && ops.includes("delete") && ops.length === 2 && saved,
      JSON.stringify({ before0, r, builtLog: builtLog.length, after, ops, wk, saved }));
  });

  // ── 只能批假的人 ──
  await ctl({ reset: true, viewer: "approver" });
  if (!skipAll && !(await openOverview())) skipAll = true;
  await maybe("can_edit=false：没有任何编辑键、没有 Save、只有 Leave requests 能点、没有 Shift change requests 栏", async () => {
    const m = await evaluate(`return { edit: document.querySelectorAll('${SEL.editKey}').length, save: !!document.querySelector('${SEL.save}'), leave: !!document.querySelector('${SEL.leaveReqs}'), change: !!document.querySelector('${SEL.changeReqs}'), cells: document.querySelectorAll('${SEL.cell}').length, viewOnly: document.querySelector('[data-ov-view-only]')?.textContent ?? '' };`);
    check("can_edit=false：没有任何编辑键、没有 Save、只有 Leave requests 能点、没有 Shift change requests 栏", m.edit === 0 && !m.save && m.leave && !m.change && m.cells === 0 && /View only/.test(m.viewOnly), JSON.stringify(m));
  });

  // ── Settings › Rules 弹窗：浅色底板上的字看得清（Annie 2026-11-27「检查所有浅色底板，这个是staff schedule的rules」）──
  // 以前弹窗是浅色 bg-paper、里面的 RulesView 是深色外框的白字 ⇒ 规则名、说明、Edit / Delete、标题都几乎看不见。
  await ctl({ reset: true, viewer: "editor", canPublish: true, rules: RULES_FIXTURE });
  // 班卡右上角的「!」（规则问题）：白字 9px，底色同一个橙色系里深一档（orange-700），对比度 ≥ 4.5（fe 转 f2 量的 orange-600 只有 3.58）。
  await maybe("班卡「!」：白字对比度 ≥ 4.5、还是 13px 圆点", async () => {
    if (!(await openOverview())) throw new Error("overview did not open");
    await evaluate(CONTRAST_HELPERS);
    const m = await evaluate(`const b = [...document.querySelectorAll('${SEL.shift} > span')].filter((s) => s.textContent.trim() === '!'); return { n: b.length, marks: b.map((x) => ({ r: $contrastOf(x).ratio, w: Math.round(x.getBoundingClientRect().width), round: getComputedStyle(x).borderRadius })) };`);
    check("班卡「!」：白字对比度 ≥ 4.5、还是 13px 圆点", m.n > 0 && m.marks.every((x) => x.r >= 4.5 && x.w === 13 && x.round !== "0px"), JSON.stringify(m));
  });
  for (const w of [1600, 390]) {
    await maybe(`Rules 弹窗 ${w}：浅色底上的字对比度都 ≥ 4.5（标题、说明、规则名、说明行、Edit / Delete）`, async () => {
      if (w === 390) await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      if (!(await openOverview())) throw new Error("overview did not open");
      await evaluate(CONTRAST_HELPERS);
      await openRules();
      const m = await evaluate(`const d = document.querySelector('[data-rules-view]').closest('[role=dialog]'); return { rows: document.querySelectorAll('[data-rule-row]').length, bad: $lowContrast(d), edit: [...d.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Edit').map((b) => $contrastOf(b).ratio), title: $contrastOf(d.querySelector('#ov-rules')).ratio, paper: getComputedStyle(d).backgroundColor };`);
      check(`Rules 弹窗 ${w}：浅色底上的字对比度都 ≥ 4.5（标题、说明、规则名、说明行、Edit / Delete）`, m.rows === RULES_FIXTURE.length && m.bad.length === 0 && m.edit.length === RULES_FIXTURE.length && m.edit.every((r) => r >= 4.5) && m.title >= 4.5, JSON.stringify(m));
      if (w === 390) await cdp("Emulation.clearDeviceMetricsOverride");
    });
  }
  await maybe("Rules 弹窗 ?theme=night：照旧深色底、白字", async () => {
    await goto(`${PAGE}&theme=night`);
    await waitFor(`document.querySelector('${SEL.root}') && document.querySelectorAll('${SEL.week}').length > 0`, 30000);
    await helpers();
    await evaluate(CONTRAST_HELPERS);
    await openRules();
    const m = await evaluate(`const d = document.querySelector('[data-rules-view]').closest('[role=dialog]'); const name = d.querySelector('[data-rule-row] b'); return { theme: document.documentElement.dataset.theme, panel: $contrastOf(name).bg, light: $contrastOf(name).light, name: getComputedStyle(name).color, title: getComputedStyle(d.querySelector('#ov-rules')).color, ratio: $contrastOf(name).ratio };`);
    check("Rules 弹窗 ?theme=night：照旧深色底、白字", m.theme === "night" && !m.light && m.name === "rgb(255, 255, 255)" && m.title === "rgb(255, 255, 255)" && m.ratio >= 4.5, JSON.stringify(m));
    await goto(`${PAGE}&theme=day`);
  });

  // ── 过去的问题不提醒（Annie 2026-11-27「过去的周有任何问题都不要再来做现在的限制或提醒了」「动手」）：
  //    日期全在今天（11-25）以前的违规 / 空档不出卡片 ! 和橙框、不进 Rule problems / Gaps 栏；跨天的（昨天 Close + 今天早班、min_rest 12h）留着；以后的留着。
  await ctl({ reset: true, viewer: "editor", canPublish: true });
  if (!skipAll && !(await openOverview())) skipAll = true;
  await maybe("过去的问题不提醒：只全在过去的藏、跨到今天的和以后的留", async () => {
    const TODAY = "2026-11-25";
    const rng = await (await fetch(`${MOCK}/api/schedule/range?from=2026-11-15&weeks=4`)).json();
    const bad0 = await evaluate(`return [...document.querySelectorAll('[data-ov-shift][data-ov-bad]')].map((e) => e.dataset.ovShift);`);
    const free = rng.slots.filter((s) => s.employee_id != null && !bad0.includes(String(s.id)));
    const past = free.filter((s) => s.date < "2026-11-24").slice(0, 2);
    const yest = free.find((s) => s.date === "2026-11-24");
    const tod = free.find((s) => s.date === TODAY);
    const fut = free.find((s) => s.date > TODAY);
    if (past.length < 2 || !yest || !tod || !fut) throw new Error("mock has no free slots for the fixture: " + JSON.stringify({ past: past.length, yest: !!yest, tod: !!tod, fut: !!fut }));
    const rest = (a, b, msg) => ({ rule: "min_rest", rule_id: "zz-rest", blocking: true, employee_id: a.employee_id, employee_name: "ZZ", dates: [a.date, b.date].sort(), slot_ids: [a.id, b.id], message: msg });
    const countOf = (sel) => evaluate(`const t = document.querySelector('${sel}')?.textContent ?? ''; const m = t.match(/· (\\d+)/); return m ? Number(m[1]) : 0;`);
    const rules0 = await countOf("[data-ov-rules]");
    const gaps0 = await countOf("[data-ov-gaps]");
    await ctl({
      extraViolations: [
        rest(past[0], past[1], "ZZ PAST pair: 8 h rest (needs 12)."),
        rest(yest, tod, "ZZ CROSS pair: yesterday Close then today early, 8 h rest (needs 12)."),
        { rule: "max_per_shift_day", rule_id: "zz-max", blocking: true, employee_id: null, employee_name: null, dates: [fut.date], slot_ids: [fut.id], message: "ZZ FUTURE: 3 people on Morning (max 2)." },
        { rule: "weekly_hours_alert", rule_id: "zz-hours", blocking: false, employee_id: past[0].employee_id, employee_name: "ZZ", dates: ["2026-11-16", "2026-11-17"], slot_ids: [], week: "2026-11-15", message: "ZZ PAST WEEK hours alert." },
        // 86 细化（2026-11-27）：按周的看整周过完没有。当前周（11-22 那周）的「不够天数」dates = [那个周日] 也要留；上一周的藏。
        { rule: "min_days_on_shift", rule_id: "zz-min", blocking: false, employee_id: past[0].employee_id, employee_name: "ZZ", dates: ["2026-11-22"], slot_ids: [], week: "2026-11-22", message: "ZZ CURRENT WEEK min days." },
        { rule: "min_days_on_shift", rule_id: "zz-min", blocking: false, employee_id: past[0].employee_id, employee_name: "ZZ", dates: ["2026-11-15"], slot_ids: [], week: "2026-11-15", message: "ZZ LAST WEEK min days." },
      ],
      extraGaps: [
        { date: "2026-11-20", start_time: "03:00", end_time: "04:00", reason: { kind: "nobody" } },
        { date: "2026-11-27", start_time: "03:00", end_time: "04:00", reason: { kind: "nobody" } },
      ],
    });
    await openOverview();
    await sleep(300);
    const rulesText = await evaluate(`return document.querySelector('[data-ov-rules]')?.textContent ?? '';`);
    check("过去的问题不提醒 · Rule problems：多了跨天的、以后的、当前周 min days（dates = 周日）三条（+3）；全在过去的那对、上周的 hours alert 和 min days 不出", (await countOf("[data-ov-rules]")) === rules0 + 3 && rulesText.includes("ZZ CROSS pair") && rulesText.includes("ZZ FUTURE") && rulesText.includes("ZZ CURRENT WEEK min days") && !rulesText.includes("ZZ PAST") && !rulesText.includes("ZZ LAST WEEK"), `${rules0} → ${await countOf("[data-ov-rules]")} · ${rulesText}`);
    const bad = await evaluate(`return [...document.querySelectorAll('[data-ov-shift][data-ov-bad]')].map((e) => e.dataset.ovShift);`);
    check("过去的问题不提醒 · 卡片 ! 和橙框：过去那对的两张没有；跨天那对（昨天 + 今天）和以后那张有", !bad.includes(String(past[0].id)) && !bad.includes(String(past[1].id)) && bad.includes(String(yest.id)) && bad.includes(String(tod.id)) && bad.includes(String(fut.id)), JSON.stringify({ bad, past: past.map((s) => s.id), yest: yest.id, tod: tod.id, fut: fut.id }));
    const gapsText = await evaluate(`return document.querySelector('[data-ov-gaps]')?.textContent ?? '';`);
    check("过去的问题不提醒 · Gaps：只多以后那个（+1），11/20 那个不出", (await countOf("[data-ov-gaps]")) === gaps0 + 1 && !/11\/20/.test(gapsText) && /11\/27/.test(gapsText), `${gaps0} → ${await countOf("[data-ov-gaps]")} · ${gapsText}`);
    const pastWeekGaps = await evaluate(`return document.querySelector('[data-ov-week="2026-11-15"]')?.textContent.includes('3:00') ?? null;`);
    check("过去的问题不提醒 · 过去那周的 Gaps 行没有 11/20 那个", pastWeekGaps === false, String(pastWeekGaps));
    await ctl({ extraViolations: [], extraGaps: [] });
  });

  // ── 过去的请求不列、不计数（Annie 2026-11-27「P1选A，动手」）：请假 date_to 早于今天（11-25）的不列；跨过今天的、以后的照旧。
  //    改班请求看它的日子（取最晚那天）；页面上虚线的待批请假卡过去的日子也不出。
  await ctl({ reset: true, viewer: "editor", canPublish: true });
  if (!skipAll && !(await openOverview())) skipAll = true;
  await maybe("过去的请求不列、不计数：只全在过去的藏，跨过今天的和以后的留", async () => {
    const countOf = (sel) => evaluate(`const t = document.querySelector('${sel}')?.textContent ?? ''; const m = t.match(/· (\\d+)/); return m ? Number(m[1]) : 0;`);
    const leave0 = await countOf("[data-ov-leave-requests]");
    const change0 = await evaluate(`return document.querySelectorAll('[data-change-request]').length;`);
    const changeN0 = await countOf("[data-change-requests-bar]");
    await ctl({
      extraLeave: [
        [901, 5, "2026-11-18", "2026-11-20", "pto", null, null, "ZZ PAST leave"],
        [902, 5, "2026-11-23", "2026-11-26", "pto", null, null, "ZZ SPANNING leave"],
        [903, 2, "2026-11-30", "2026-11-30", "pto", null, null, "ZZ FUTURE leave"],
      ],
      extraChange: [
        { id: 911, kind: "move", status: "pending", from: { employee_id: 2, name: "ZZ" }, my_slot: { date: "2026-11-18", shift_type: "morning" }, their_slot: null, peer: null, date: "2026-11-19", shift_type: "morning", peer_timed_out: false, created_at: "2026-11-17T18:00:00+00:00", decided_at: null },
        { id: 912, kind: "swap", status: "awaiting_peer", from: { employee_id: 2, name: "ZZ" }, my_slot: { date: "2026-11-24", shift_type: "close" }, their_slot: { date: "2026-11-26", shift_type: "close" }, peer: { employee_id: 5, name: "ZZ Peer" }, date: null, shift_type: null, peer_timed_out: false, created_at: "2026-11-23T18:00:00+00:00", decided_at: null },
      ],
    });
    await openOverview();
    await sleep(300);
    check("过去的请求 · Leave requests · N waiting：只多跨过今天的和以后的两条（+2），全在过去的不算", (await countOf("[data-ov-leave-requests]")) === leave0 + 2, `${leave0} → ${await countOf("[data-ov-leave-requests]")} · ${await evaluate("return document.querySelector('[data-ov-leave-requests]')?.textContent;")}`);
    const cards = await evaluate(`return [...document.querySelectorAll('[data-ov-pending]')].map((e) => e.dataset.ovPending);`);
    check("过去的请求 · 格子里虚线待批卡：过去那条（901）一张都没有；跨过今天的（902）和以后的（903）有", !cards.includes("901") && cards.includes("902") && cards.includes("903"), JSON.stringify(cards));
    const ids = await evaluate(`return [...document.querySelectorAll('[data-change-request]')].map((e) => e.dataset.changeRequest);`);
    check("过去的请求 · Shift change requests：过去那条（911，11/19）不列、不计数；跨过今天的换班（912，11/24 ↔ 11/26）留", !ids.includes("911") && ids.includes("912") && (await countOf("[data-change-requests-bar]")) === changeN0 + 1, JSON.stringify({ change0, ids, n0: changeN0, n: await countOf("[data-change-requests-bar]") }));
    await ctl({ extraLeave: [], extraChange: [] });
  });

  // ── 手机 390 ──
  await ctl({ reset: true, viewer: "editor", canPublish: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  if (!skipAll && !(await openOverview())) skipAll = true;
  await maybe("手机 390：没有横向滚动条、How to use 在最底", async () => {
    await sleep(500);
    const m = await evaluate(`const h = document.querySelector('${SEL.howTo}'); const d = document.documentElement; // 收起的 <details> 里的列表项在新版 Chrome 里照样有尺寸（content-visibility 藏着）⇒ How to use 自己的子孙不算。
    const bottom = Math.max(...[...document.querySelectorAll('${SEL.root} *')].filter((e) => !h || !h.contains(e)).map((e) => e.getBoundingClientRect().bottom)); return { sw: d.scrollWidth, cw: d.clientWidth, how: !!h, howBottom: h ? Math.round(h.getBoundingClientRect().bottom) : null, maxBottom: Math.round(bottom) };`);
    check("手机 390：没有横向滚动条、How to use 在最底", m.sw <= m.cw && m.how && m.howBottom >= m.maxBottom - 1, JSON.stringify(m));
  });
  await cdp("Emulation.clearDeviceMetricsOverride");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
