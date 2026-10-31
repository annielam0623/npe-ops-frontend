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
    // 有没存的改动时跳页，浏览器自己的「离开此页？」：检查里一律放行（页面里的 Save / Don't save 框另外测）。
    if (msg.method === "Page.javascriptDialogOpening") {
      void cdp("Page.handleJavaScriptDialog", { accept: true });
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  // 空档只算洛杉矶「现在以后」（Annie 2026-10-30）：模拟数据的周都在过去，每次打开页面先把「现在」固定在 2026-09-01 0:00。
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "window.__scheduleNow = '2026-09-01T00:00';" });

  try {
    await run();
    await runTicks();
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

const mockLog = async () => (await fetch(`${MOCK}/__log`)).json();
const since = async (n, f) => (await mockLog()).slice(n).filter(f);

// 整周一个 Save（Annie 2026-10-29 B9 Q1–Q7、A8；后端 G218）：改动先在页面上，按 Save 才存。
const SAVE = "document.querySelector('[data-week-save]')";
const changesLog = async () => (await fetch(`${MOCK}/__changes`)).json();
/** 按整周 Save，等绿色 Saved 或红字。返回 true = 存好了。 */
async function saveWeek() {
  // 第一次动手要先占锁（一个请求），改动落到页面上之前 Save 还是灰的：等它能点。
  await waitFor(`${SAVE} && !${SAVE}.disabled`);
  await evaluate(`${SAVE}.click();`);
  await waitFor("!!document.querySelector('[data-saved]') || !!document.querySelector('[data-save-error]')");
  return evaluate("return !!document.querySelector('[data-saved]') && !document.querySelector('[data-save-error]');");
}
/** 点卡片上的时间 → 改时间小窗（A8）→ 填 Start / End → Done（只放到页面上）。 */
async function setTime(slotExpr, start, end) {
  await evaluate(`${slotExpr}.querySelector('button.font-mono').click();`);
  await waitFor("document.querySelector('[data-time-popup]')");
  if (start) await evaluate(`$setValue(document.querySelector('[data-time-popup] input[aria-label="Start time"]'), '${start}');`);
  if (end) await evaluate(`$setValue(document.querySelector('[data-time-popup] input[aria-label="End time"]'), '${end}');`);
  await evaluate("document.querySelector('[data-time-popup-done]').click();");
  await waitFor("!document.querySelector('[data-time-popup]')");
  // 第一次动手要先占锁（一个请求），改动落到页面上要等一下。
  await sleep(400);
}

async function run() {
  // ── supervisor：验收数据（10/4–10/10）：周一有空档、不能发布 ──
  await ctl({ role: "supervisor", fail401: false, meName: "" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")}`);
  const text = () => evaluate("return document.body.innerText;");

  check("页头工作时段", (await text()).includes("2:00 AM – 9:30 PM"));
  // CenteredPage（Annie 2026-10-19「10% 动手」）：内容区左右各留 10%，不再是 max-w-[1400px]。
  check("内容区左右各留约 10%", await evaluate(`const el = document.querySelector('[data-centered-page]'); if (!el) return false; const par = el.parentElement; const ps = getComputedStyle(par); const w = par.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight); const cs = getComputedStyle(el); return Math.abs(parseFloat(cs.paddingLeft) / w - 0.1) < 0.005 && Math.abs(parseFloat(cs.paddingRight) / w - 0.1) < 0.005 && Math.abs(el.getBoundingClientRect().width - w) < 1;`));
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
  // 空档提醒（Annie 2026-10-29「你要提醒是哪一天有问题」，preview CJaXdFkBS5S4g97gjtxuD8，「Q1-5 同意推荐，动手」）
  check(
    "空档：Publish 左边直接写哪天哪段（Gap: Mon 10/05 · nobody 5:00–9:30 PM），不再写「1 day with gaps」",
    await evaluate("const g = document.querySelector('[data-gap-summary]'); return !!g && g.textContent.includes('Gap:') && g.textContent.includes('Mon 10/05 · nobody 5:00–9:30 PM') && !document.body.innerText.includes('day with gaps');"),
    await evaluate("return document.querySelector('[data-gap-summary]')?.textContent;"),
  );
  check(
    "supervisor 有空档：Publish 灰着，鼠标停上去写「Only admins can publish with a gap」（Q1）",
    await evaluate("const b = $btn('Publish'); return b.disabled && b.title.includes('Only admins can publish with a gap');"),
  );
  check("Day timeline：有空档的 Mon 10/05 日期键带红点，别的日子没有", await evaluate("const t = [...document.querySelectorAll('[data-day-tab]')]; return t.filter(x => x.dataset.hasGap).map(x => x.dataset.dayTab).join(',') === '2026-10-05' && !!t.find(x => x.dataset.dayTab === '2026-10-05').querySelector('.bg-red-500');"));
  check("周表列头：Mon 10/05 下面红点「Gap 5–9:30 PM」（Q5），别的列没有", await evaluate("const g = [...document.querySelectorAll('[data-grid-gap]')]; return g.length === 1 && g[0].dataset.gridGap === '2026-10-05' && g[0].textContent.includes('Gap 5–9:30 PM');"), await evaluate("return [...document.querySelectorAll('[data-grid-gap]')].map(x => x.textContent).join('|');"));
  await evaluate("$btn('Sun').click();");
  await sleep(200);
  check(
    "选着别的日子（Sun 10/04）：下面写「Gaps on Sun 10/04: none · Other days: Mon 10/05 ›」，不再写「none — fully covered」",
    await evaluate("const l = document.querySelector('[data-gaps-line]').textContent; return l.includes('Gaps on Sun 10/04: none') && l.includes('Other days: Mon 10/05 ›') && !l.includes('fully covered');"),
    await evaluate("return document.querySelector('[data-gaps-line]')?.textContent;"),
  );
  await evaluate("document.querySelector('[data-gap-link=\"2026-10-05\"]').click();");
  await sleep(300);
  check(
    "点「Gap: Mon 10/05 …」：Day timeline 跳到 Mon 10/05",
    await evaluate("return document.querySelector('[data-day-tab=\"2026-10-05\"]').getAttribute('aria-selected') === 'true';"),
  );
  check(
    "跳过去的那天：时间轴多一行红色 Nobody（5:00 PM – 9:30 PM），下面写 Gaps on Mon 10/05: Nobody on 5:00 PM–9:30 PM 和原因",
    await evaluate("const r = document.querySelector('[data-nobody-row]'); const l = document.querySelector('[data-gaps-line]').textContent; return !!r && r.textContent.includes('Nobody') && r.textContent.includes('5:00 PM – 9:30 PM') && l.includes('Gaps on Mon 10/05: Nobody on 5:00 PM–9:30 PM') && !!document.querySelector('[data-gap-reason]');"),
    await evaluate("return document.querySelector('[data-gaps-line]')?.textContent;"),
  );
  await evaluate("$btn('Sun').click();");
  await sleep(200);
  await evaluate("document.querySelector('[data-grid-gap=\"2026-10-05\"]').click();");
  await sleep(300);
  check("点周表列头的红点：也跳到 Mon 10/05", await evaluate("return document.querySelector('[data-day-tab=\"2026-10-05\"]').getAttribute('aria-selected') === 'true';"));

  // 空档只算洛杉矶「现在以后」（Annie 2026-10-30「schedule里对gap的要求，之应该对此刻起的将来设置，对过去的应该彻底放行」）
  const setNow = async (v) => { await evaluate(`window.__scheduleNow = '${v}'; window.dispatchEvent(new Event('focus'));`); await sleep(300); };
  await setNow("2026-10-06T08:00");
  check("过去的空档不标：现在是 Tue 10/06，Mon 10/05 的空档（5:00–9:30 PM）列头红点、Gap 提示、Day timeline 红点都没了", await waitFor("!document.querySelector('[data-grid-gap=\"2026-10-05\"]') && !document.querySelector('[data-gap-summary]') && !document.querySelector('[data-day-tab=\"2026-10-05\"][data-has-gap]')"));
  await setNow("2026-10-05T19:00");
  check("今天跨过「现在」的那段只算后半截：现在 Mon 10/05 7:00 PM ⇒ 只剩 7:00–9:30 PM", await waitFor("document.querySelector('[data-grid-gap=\"2026-10-05\"]')?.textContent.includes('Gap 7–9:30 PM') && document.querySelector('[data-gap-summary]')?.textContent.includes('Mon 10/05 · nobody 7:00–9:30 PM')"), await evaluate("return (document.querySelector('[data-grid-gap=\"2026-10-05\"]')?.textContent || '') + ' | ' + (document.querySelector('[data-gap-summary]')?.textContent || '');"));
  await setNow("2026-09-01T00:00");
  await waitFor("document.querySelector('[data-grid-gap=\"2026-10-05\"]')?.textContent.includes('Gap 5–9:30 PM')");

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

  // 整周一个 Save（B9）：没改动时 Save / Discard 灰着，没有「Not saved yet」。
  check("整周 Save：在周导航那一排（Auto-fill 左边），没改动时 Save / Discard 灰着，Save 是蓝色提交键", await evaluate(`const s = ${SAVE}; const d = document.querySelector('[data-week-discard]'); return !!s && s.disabled && d.disabled && getComputedStyle(s).backgroundColor === 'rgb(59, 130, 246)' && !document.querySelector('[data-unsaved-summary]');`));

  // 点时间 → 改时间小窗（A8）：Start / End 并排、谁 · 哪天 · 什么班；Done 白色（只放到页面上），时间列表开在小窗里面。
  let before = (await mockLog()).length;
  await evaluate(`${jingMon}.querySelector('button.font-mono').click();`);
  await waitFor("document.querySelector('[data-time-popup]')");
  const tpop = "document.querySelector('[data-time-popup]')";
  check("A8：点时间弹独立小窗，标题写 Jing · Mon 10/5 · Close，有 Start / End 两格、Done（白色）/ Cancel", await evaluate(`const p = ${tpop}; const done = p.querySelector('[data-time-popup-done]'); return p.textContent.includes('Jing · Mon 10/5 · Close') && !!p.querySelector('input[aria-label="Start time"]') && !!p.querySelector('input[aria-label="End time"]') && done.textContent.trim() === 'Done' && getComputedStyle(done).backgroundColor === 'rgb(255, 255, 255)' && !!p.querySelector('[data-time-popup-cancel]');`), await evaluate(`return ${tpop}.textContent;`));
  await evaluate(`${tpop}.querySelector('input[aria-label="Start time"]').click();`);
  await waitFor(`${tpop}.querySelector('[data-time-pop-inline]')`);
  check("A8：时间列表开在小窗里面（不浮在最上层），Done 被往下推、没被盖住", await evaluate(`const p = ${tpop}; const list = p.querySelector('[data-time-pop-inline]'); const done = p.querySelector('[data-time-popup-done]'); return !!list && !document.querySelector('body > [data-time-pop]') && list.getBoundingClientRect().bottom <= done.getBoundingClientRect().top;`));
  await evaluate(`${tpop}.querySelector('[data-time-pop-inline] [data-period="AM"]').click();`);
  check("A8：选了 AM / PM 列表就收起；11:30 PM 点 AM 变 11:30 AM", (await waitFor(`!${tpop}.querySelector('[data-time-pop-inline]')`)) && (await evaluate(`return ${tpop}.querySelector('input[aria-label="Start time"]').dataset.value === '11:30';`)));
  // 改了没按 Done 就点外面：不关，出黄框 Unsaved changes，键换成 Done / Discard。
  await evaluate("document.querySelector('[data-time-popup-backdrop]').click();");
  check("A8：改了没按 Done 就点外面：小窗不关，出黄框 Unsaved changes，Cancel 变 Discard", await waitFor(`${tpop} && ${tpop}.querySelector('[data-time-popup-unsaved]') && ${tpop}.querySelector('[data-time-popup-cancel]').textContent.trim() === 'Discard'`));
  await evaluate(`${tpop}.querySelector('[data-time-popup-done]').click();`);
  await waitFor(`!${tpop}`);
  const doneReqs = await since(before, (e) => e.method !== "GET" && !e.path.includes("edit-lock"));
  check("Done：小窗收起，格子里换成新时间、标琥珀色「time」；没发任何请求", (await evaluate(`const c = ${jingMon}; return c.textContent.includes('11:30 AM') && c.dataset.mark === 'time' && c.querySelector('[data-mark-words]').textContent === 'time';`)) && doneReqs.length === 0, `${await evaluate(`const c = ${jingMon}; return c.textContent + ' | mark=' + c.dataset.mark;`)} | reqs=${JSON.stringify(doneReqs.map((e) => e.method + " " + e.path))}`);
  check("没存的改动：周表上方琥珀色「Not saved yet: 1 change (1 time changed)」，Save / Discard 能点", await evaluate(`const n = document.querySelector('[data-unsaved-summary]'); return !!n && n.textContent === 'Not saved yet: 1 change (1 time changed)' && getComputedStyle(n).color === 'rgb(252, 211, 77)' && !${SAVE}.disabled && !document.querySelector('[data-week-discard]').disabled;`), await evaluate("return document.querySelector('[data-unsaved-summary]')?.textContent;"));
  check("空档照页面上的改动算（Q3）：还没存，周一的空档已经消失、Publish 可点", await waitFor(`!document.querySelector('[data-gap-summary]') && !document.querySelector('[data-grid-gap]') && !document.querySelector('[data-has-gap]') && !$btn('Publish').disabled`));
  let wNow = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("还没存：服务端那一格还是 11:30 PM、gaps 还在", wNow.gaps.length > 0);
  const baseV = wNow.version;
  before = (await mockLog()).length;
  check("按 Save：绿色「✓ Saved · 时间」，琥珀色标记和 Not saved yet 都没了", (await saveWeek()) && (await evaluate(`const s = document.querySelector('[data-saved]'); return s.textContent.startsWith('✓ Saved · ') && s.className.includes('emerald') && !document.querySelector('[data-unsaved-summary]') && !${jingMon}.dataset.mark && ${SAVE}.disabled;`)), await evaluate(`return (document.querySelector('[data-save-status]')?.textContent || '') + ' | ' + getComputedStyle(document.querySelector('[data-saved]') || document.body).color;`));
  const firstSave = (await changesLog()).at(-1)?.body;
  check("Save 一次 POST …/changes：base_version = 打开时的 version，ops 只有一条 time（11:30–21:30）", firstSave?.base_version === baseV && firstSave.ops.length === 1 && firstSave.ops[0].op === "time" && firstSave.ops[0].start_time === "11:30" && firstSave.ops[0].end_time === "21:30" && (await since(before, (e) => e.method !== "GET" && !e.path.includes("edit-lock"))).length === 1, JSON.stringify(firstSave));
  const weekAfterFix = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端这一周的 gaps 数组真的空了", Array.isArray(weekAfterFix.gaps) && weekAfterFix.gaps.length === 0);

  // 线上 bug（Annie 10-30「save了以后，没有saved的提示还在那里，需要我自己去刷新浏览器」）：
  // ① 生产后端还没有 …/changes（404）：红字写清楚、改动留着，服务端没变；② 有了以后 Save：琥珀色那行马上消失、出绿字，不用刷新。
  await setTime(jingMon, "11:15");
  await ctl({ changes404: true });
  const v404 = (await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json()).version;
  check("后端没有这条路由（404）：红字 Not saved: Not Found … Nothing was saved，Not saved yet 还在、服务端没变", !(await saveWeek()) && (await evaluate("const e = document.querySelector('[data-save-error]'); return e.textContent.includes('Not saved: Not Found') && e.textContent.includes('Nothing was saved') && !!document.querySelector('[data-unsaved-summary]');")) && (await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json()).version === v404, await evaluate("return document.querySelector('[data-save-status]')?.textContent;"));
  await ctl({ changes404: false });
  check("后端回 200（真实形状 {week, created, applied, notified: [], lock_token}）：Save 后 Not saved yet 和红字马上消失、出绿色 ✓ Saved，不用刷新", (await saveWeek()) && (await evaluate("return !document.querySelector('[data-unsaved-summary]') && !document.querySelector('[data-save-error]') && document.querySelector('[data-saved]')?.textContent.startsWith('✓ Saved · ');")), await evaluate("return document.querySelector('[data-save-status]')?.textContent;"));
  // 改回 11:30，后面的检查照原来的时间
  await setTime(jingMon, "11:30");
  await saveWeek();

  // ── 卡片上直接标空档（Annie 2026-10-30「17 全按推荐，动手」，preview WVNc5X87zYyKyY6k47qyKU）──
  // 周一：Veronica Open 2:00–11:30、Lizzie Mid 11:30–5 PM、Jing Close 11:30 AM–9:30 PM。
  const vOpen = `${cell("1|2026-10-05")}.querySelector('[data-slot-id]')`;
  const vOpenId = await evaluate(`return Number(${vOpen}.dataset.slotId);`);
  const vCard = `document.querySelector('[data-slot-id="${vOpenId}"]')`;
  await setTime(vOpen, null, "10:30");
  check("改时间造成 1 小时空档：卡片变红，写「This leaves a 1 hour gap (10:30 – 11:30 AM).」", await waitFor(`${vCard}.querySelector('[data-gap-note]')?.textContent === 'This leaves a 1 hour gap (10:30 – 11:30 AM).'`) && (await evaluate(`return ${vCard}.className.includes('border-red-500') && !${cell("2|2026-10-05")}.querySelector('[data-gap-note]');`)), await evaluate(`return ${vCard}.textContent;`));
  await setTime(vCard, "03:00", null);
  check("一张卡造成两段空档：写「This leaves 2 gaps: 2:00 – 3:00 AM (1 hour) and 10:30 – 11:30 AM (1 hour).」", await waitFor(`${vCard}.querySelector('[data-gap-note]')?.textContent === 'This leaves 2 gaps: 2:00 – 3:00 AM (1 hour) and 10:30 – 11:30 AM (1 hour).'`), await evaluate(`return ${vCard}.querySelector('[data-gap-note]')?.textContent;`));
  await setTime(vCard, "02:00", "11:30");
  check("补上以后：红色和那一句马上消失（改回原样，也没有没存的改动）", await waitFor(`!${vCard}.querySelector('[data-gap-note]') && !${vCard}.className.includes('border-red-500') && !document.querySelector('[data-unsaved-summary]')`));
  // 删班也标（Q1 A）：删掉的那张（灰掉、带 Undo）变红写同一句；Undo 就没了
  await evaluate(`${vCard}.querySelector('button[title="Remove this shift"]').click();`);
  check("删班造成空档：删掉的那张变红，写「This leaves a 9 hour 30 minute gap (2:00 – 11:30 AM).」", await waitFor(`${vCard}?.dataset.mark === 'deleted' && ${vCard}.querySelector('[data-gap-note]')?.textContent === 'This leaves a 9 hour 30 minute gap (2:00 – 11:30 AM).'`), await evaluate(`return ${vCard}?.textContent;`));
  await evaluate(`${vCard}.querySelector('[data-undo-delete]').click();`);
  check("Undo：红色没了", await waitFor(`!${vCard}.dataset.mark && !${vCard}.querySelector('[data-gap-note]')`));
  // 拖班也标：点卡片再点 Unassigned 同一天 ⇒ 在 Unassigned 的那张变红；只标那张卡，列头照旧红点（Q2 A）
  await evaluate(`${vCard}.click();`);
  await waitFor("document.body.innerText.includes('Card selected')");
  await evaluate(`${cell("needs|2026-10-05")}.click();`);
  check("拖到 Unassigned 造成空档：那张卡（现在在 Unassigned）变红，列头 Mon 10/05 红点", await waitFor(`${cell("needs|2026-10-05")}.querySelector('[data-slot-id="${vOpenId}"] [data-gap-note]')`) && (await evaluate("return !!document.querySelector('[data-grid-gap=\"2026-10-05\"]');")));
  await evaluate("document.querySelector('[data-week-discard]').click();");
  await waitFor("!document.querySelector('[data-unsaved-summary]')");

  // ── Day timeline：10/7（周三）重叠 ──
  await evaluate(`$btn('Wed').click();`);
  await sleep(200);
  const timelineText = await text();
  check("10/7 显示 Veronica + Lizzie 重叠", timelineText.includes("Veronica + Lizzie"));
  check("10/7 显示 Lizzie + Nadia 重叠", timelineText.includes("Lizzie + Nadia"));
  check("10/7 没有空档：写「Gaps on Wed 10/07: none」", timelineText.includes("Gaps on Wed 10/07: none"));

  // ── 点卡片再点同一天别人的格子：Lizzie(2) 周一 Mid → Nadia(3) ──
  const lizMid = `${cell("2|2026-10-05")}.querySelector('[data-slot-id]')`;
  const lizMidId = await evaluate(`return Number(${lizMid}.dataset.slotId);`);
  await evaluate(`${lizMid}.click();`);
  await waitFor("document.body.innerText.includes('Card selected')");
  await evaluate(`${cell("3|2026-10-05")}.click();`);
  check(
    "点卡片再点同一天别人的格子：Mid 换到 Nadia 那一格，标琥珀色「moved」；Lizzie 那一格留一个淡的琥珀虚线影子",
    await waitFor(`${cell("3|2026-10-05")}.querySelector('[data-slot-id="${lizMidId}"]')?.dataset.mark === 'moved' && !${cell("2|2026-10-05")}.querySelector('[data-slot-id]') && !!${cell("2|2026-10-05")}.querySelector('[data-moved-from="${lizMidId}"]')`),
  );
  check("没存：Not saved yet: 1 change (1 shift moved)", await evaluate("return document.querySelector('[data-unsaved-summary]')?.textContent === 'Not saved yet: 1 change (1 shift moved)';"));
  let w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("还没存：服务端这个时段还是 Lizzie", w.slots.find((s) => s.id === lizMidId)?.employee_id === 2);
  await saveWeek();
  w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("Save 以后服务端这个时段的 employee_id = 3（一条 assign，时段 id 没变）；影子没了", w.slots.find((s) => s.id === lizMidId)?.employee_id === 3 && JSON.stringify((await changesLog()).at(-1).body.ops) === JSON.stringify([{ op: "assign", slot: lizMidId, employee_id: 3 }]) && (await evaluate("return !document.querySelector('[data-moved-from]');")));

  // 选中后点别的天的格子：不能放。
  await evaluate(`${cell("3|2026-10-05")}.querySelector('[data-slot-id]').click();`);
  await waitFor("document.body.innerText.includes('Card selected')");
  check("选中后别的天的格子点不了（没有 targetable 外框）", await evaluate(`return !${cell("3|2026-10-06")}.className.includes('outline');`));
  // 点 Unassigned 同一天的格子 = 清空。
  await evaluate(`${cell("needs|2026-10-05")}.click();`);
  check("点 Unassigned 的格子：这个时段清空", await waitFor(`${cell("needs|2026-10-05")}.textContent.includes('Mid')`));
  await saveWeek();
  w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("Save 以后服务端 employee_id = null", w.slots.find((s) => s.id === lizMidId)?.employee_id === null);

  // 拖拽（原生 drop 事件）：把它拖回 Lizzie。
  await evaluate(`
    const dt = new DataTransfer();
    dt.setData('text/slot', '${lizMidId}');
    ${cell("2|2026-10-05")}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    ${cell("2|2026-10-05")}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  `);
  check("拖到 Lizzie 的格子：换回 Lizzie", await waitFor(`${cell("2|2026-10-05")}.textContent.includes('Mid')`));
  await saveWeek();
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
  check("时间默认是工作时段 02:00 – 21:30", await evaluate(`const t = ${dlg}.querySelectorAll('input[data-time-input]'); return t[0].dataset.value === '02:00' && t[1].dataset.value === '21:30';`));
  await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.trim() === 'Mid').click();`);
  await evaluate(`$btn('Add shift', ${dlg}).click();`);
  check("Unassigned 周六加了一个 Mid 时段（先放在页面上，标琥珀色 new）", await waitFor(`${needsSat}.textContent.includes('Mid') && ${needsSat}.querySelector('[data-slot-id]').dataset.mark === 'new'`));
  check("新时段的时间 = 工作时段 2:00 AM – 9:30 PM", (await evaluate(`return ${needsSat}.textContent;`)).includes("2:00 AM – 9:30 PM"));
  check("Unassigned 里的时段是红色虚线", await evaluate(`return ${needsSat}.querySelector('[data-slot-id]').className.includes('border-dashed');`));

  // 在 Anita(5) 的周六格里加一个 Close，自己填时间 8:00–17:00 ⇒ 先建再派给 Anita。
  const anitaSat = cell("5|2026-10-10");
  await evaluate(`${anitaSat}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Anita')`);
  await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.trim() === 'Close').click();`);
  await evaluate(`const t = ${dlg}.querySelectorAll('input[data-time-input]'); $setValue(t[0], '08:00'); $setValue(t[1], '17:00');`);
  await evaluate(`$btn('Add shift', ${dlg}).click();`);
  check("在 Anita 的格子里加的 Close 直接是她的、时间是自己填的 8:00 AM – 5:00 PM", await waitFor(`${anitaSat}.querySelectorAll('[data-slot-id]').length === 2 && ${anitaSat}.textContent.includes('8:00 AM – 5:00 PM')`));
  check("两个新班都没存：Not saved yet: 2 changes (2 shifts added)", await evaluate("return document.querySelector('[data-unsaved-summary]')?.textContent === 'Not saved yet: 2 changes (2 shifts added)';"));
  await saveWeek();
  const addSave = (await changesLog()).at(-1)?.body;
  check("Save：两条 create（ref n1 / n2），Anita 那条直接带 employee_id 5", addSave?.ops.length === 2 && addSave.ops.every((o) => o.op === "create") && addSave.ops[0].ref === "n1" && addSave.ops[1].ref === "n2" && addSave.ops[1].employee_id === 5 && addSave.ops[0].employee_id === null, JSON.stringify(addSave?.ops));
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
  check("勾了三天，按钮写 Add 3 shifts、时间被 Recent 填成 08:00 – 17:00", await evaluate(`const t = ${dlg}.querySelectorAll('input[data-time-input]'); return !!$btn('Add 3 shifts', ${dlg}) && t[0].dataset.value === '08:00' && t[1].dataset.value === '17:00';`));
  await evaluate(`$btn('Add 3 shifts', ${dlg}).click();`);
  check("三天都加上了（周日 / 周一 / 周二 Anita 都有 Mid 8:00 AM – 5:00 PM）", await waitFor(`['2026-10-04','2026-10-05','2026-10-06'].every((d) => { const c = document.querySelector('[data-cell="5|' + d + '"]'); return c && c.textContent.includes('Mid') && c.textContent.includes('8:00 AM – 5:00 PM'); })`));
  await saveWeek();
  w = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04`)).json();
  check("服务端：Anita 这三个 Mid 都是 08:00–17:00", w.slots.filter((s) => s.employee_id === 5 && s.shift_type === "mid" && s.start_time === "08:00" && s.end_time === "17:00").length === 3);
  const anitaExtraIds = w.slots.filter((s) => s.employee_id === 5 && s.shift_type === "mid" && s.start_time === "08:00").map((s) => s.id);
  for (const id of anitaExtraIds) {
    await evaluate(`document.querySelector('[data-slot-id="${id}"] button[title="Remove this shift"]').click();`);
    await sleep(250);
  }
  // 删掉的班先不消失（Q5）：灰掉、划线、琥珀虚线、带 Undo，按 Save 才真的删。
  const delCard = `document.querySelector('[data-slot-id="${anitaExtraIds[0]}"]')`;
  check("删班先不消失：灰掉、名字划线、写 Removed · not saved yet，× 换成 Undo；Off 格不出来", await waitFor(`${delCard}?.dataset.mark === 'deleted'`) && (await evaluate(`const c = ${delCard}; return getComputedStyle(c.querySelector('b')).textDecorationLine === 'line-through' && c.textContent.includes('Removed · not saved yet') && !!c.querySelector('[data-undo-delete]') && !c.querySelector('button[title="Remove this shift"]');`)));
  check("Not saved yet: 3 changes (3 shifts removed)", await evaluate("return document.querySelector('[data-unsaved-summary]')?.textContent === 'Not saved yet: 3 changes (3 shifts removed)';"));
  await evaluate(`${delCard}.querySelector('[data-undo-delete]').click();`);
  check("Undo：这一张恢复（没有标记），剩 2 个删除", (await waitFor(`!${delCard}.dataset.mark`)) && (await evaluate("return document.querySelector('[data-unsaved-summary]')?.textContent === 'Not saved yet: 2 changes (2 shifts removed)';")));
  await evaluate(`${delCard}.querySelector('button[title="Remove this shift"]').click();`);
  await waitFor(`${delCard}?.dataset.mark === 'deleted'`);
  await saveWeek();
  check("测完把这三个 Mid 删掉（Save 以后才从格子里拿掉；三条 delete）", (await waitFor(`![...document.querySelectorAll('[data-slot-id]')].some(e => ['2026-10-04','2026-10-05','2026-10-06'].some(d => e.closest('[data-cell]')?.dataset.cell === '5|' + d) && e.textContent.includes('Mid'))`)) && (await changesLog()).at(-1).body.ops.filter((o) => o.op === "delete").length === 3);

  // 删时段：先删 Needs 里的 Mid，再删 Anita 多出来的 Close。
  await evaluate(`${needsSat}.querySelector('button[title="Remove this shift"]').click();`);
  await evaluate(`${anitaSat}.querySelectorAll('[data-slot-id]')[1].querySelector('button[title="Remove this shift"]').click();`);
  const delSaved = await saveWeek();
  check("删掉 Needs 里的 Mid", (await waitFor(`!${needsSat}.textContent.includes('Mid')`)) && delSaved, await evaluate("return (document.querySelector('[data-save-status]')?.textContent || '');"));
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
  check("刚发布、还没改：没有「Changes are not sent」提醒", await evaluate("return !document.querySelector('[data-unsent-changes]');"));
  check("Publish again 鼠标提示：写只通知班有变化的人和所有主管（后端 G217）", await evaluate("return $btn('Publish again').title === 'Publish again: people whose shifts or time off changed, and people who can edit the schedule, are notified.';"));
  await evaluate("$btn('Publish again').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  check(
    "二次发布的确认框：只通知班有变化的人 + 所有主管（除了自己，后端 G217），别人不通知；不出「没有邮箱」提醒",
    await evaluate("const t = document.querySelector('[role=dialog]').textContent; return t.includes('People whose shifts or time off changed since the last publish will get a system notification and an email. People who can edit the schedule (except you) get a notice listing the changes. No one else is notified.') && !t.includes('their supervisor') && !t.includes('Everyone scheduled this week') && !t.includes('No notifications are sent') && !document.querySelector('[role=dialog] [data-publish-no-email]');"),
  );
  await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
  check("没改就重新发布：写「Published again. No one's shifts or time off changed, so no one was notified.」，不写 Notified 0", await waitFor("document.body.innerText.includes(\"Published again. No one's shifts or time off changed, so no one was notified.\") && !document.body.innerText.includes('Notified 0')"));

  // 改完再发（Annie 10-29「改完再发」）：已发布的周改了，提醒按 Publish again 才发出去
  const jingMonPub = `${cell("4|2026-10-05")}.querySelector('[data-slot-id]')`;
  await setTime(jingMonPub, '11:45');
  await saveWeek();
  check("已发布的周改了一处：Publish again 旁边琥珀色「Changes are not sent until you publish again.」", await waitFor("document.querySelector('[data-unsent-changes]')?.textContent === 'Changes are not sent until you publish again.' && getComputedStyle(document.querySelector('[data-unsent-changes]')).color === 'rgb(252, 211, 77)'"));

  // 发布前单独发给本人确认（Annie 10-29「员工确认，同意推荐，动手」）
  const DLG = "document.querySelector('[data-send-changes-dialog]')";
  check(
    "改了的人那一行：琥珀色「1 change」+「Send to confirm」，改过的格子标琥珀色框；没改的人没有",
    await waitFor(`document.querySelector('[data-person-changes="4"]')?.textContent === '1 changeSend to confirm' && document.querySelector('[data-cell="4|2026-10-05"]').hasAttribute('data-changed') && document.querySelectorAll('[data-person-changes]').length === 1 && document.querySelectorAll('[data-changed]').length === 1`),
    await evaluate("return [...document.querySelectorAll('[data-person-changes]')].map(e => e.textContent).join('|');"),
  );
  // 置顶 12（Annie 10-30「同意」，方案 A）：页面上有没存的改动时，Send to confirm 灰着、旁边灰字 Save first；Save 后恢复。
  const stc = "document.querySelector('[data-send-to-confirm=\"4\"]')";
  const jingSlot = `${cell("4|2026-10-05")}.querySelector('[data-slot-id]')`;
  await setTime(jingSlot, "11:50");
  await waitFor("!!document.querySelector('[data-unsaved-summary]')");
  check("有没存的改动：Send to confirm 灰着，旁边灰字 Save first，鼠标提示 Save your changes first.", await evaluate(`const b = ${stc}; const n = document.querySelector('[data-person-changes="4"] [data-send-save-first]'); return b.disabled && b.title === 'Save your changes first.' && !!n && n.textContent === 'Save first';`), await evaluate("return document.querySelector('[data-person-changes=\"4\"]')?.outerHTML.slice(0, 400);"));
  await evaluate(`${stc}.click();`);
  await sleep(200);
  check("灰着点不开发送框", await evaluate(`return !${DLG};`));
  await saveWeek();
  check("按 Save 存好：Send to confirm 恢复能点，Save first 没了", await waitFor(`!${stc}.disabled && !document.querySelector('[data-send-save-first]') && !${stc}.title`));
  // 改回 11:45 存好，后面的检查照原来的时间
  await setTime(jingSlot, "11:45");
  await saveWeek();
  await waitFor(`!${stc}.disabled`);
  await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
  await waitFor(DLG);
  check(
    "Send to confirm：发送框标题写人名，表格只列改了的那天（原来划线 → 现在 11:45 AM），写 To 邮箱 + 站内，只发本人",
    await evaluate(`const d = ${DLG}; const r = d.querySelector('[data-change-row="2026-10-05"]'); return d.querySelector('h2').textContent === 'Send Jing their changes to confirm' && d.querySelectorAll('[data-change-row]').length === 1 && r.textContent.startsWith('Mon 10/5') && !r.textContent.startsWith('Mon 10/05') && r.children[2].textContent.includes('11:45 AM') && getComputedStyle(r.children[1]).textDecorationLine === 'line-through' && d.textContent.includes('To: 📧') && d.textContent.includes('in-app notice') && d.textContent.includes('Only Jing gets this.');`),
    await evaluate(`return ${DLG}.textContent;`),
  );
  // 后端 G217（ef 10-30）：对方收到的是后端的原文，前端不另写一套
  check(
    "发送框「What Jing gets」照后端原文：标题 Please confirm your schedule changes — week of 2026-10-04、Hi Jing、每行「Mon 10/5:（不补零，同后端）原来 → 现在」、Please check and confirm、[Confirm my schedule]；底下写能改排班的主管和 admin、不写 their supervisor",
    await evaluate(`const d = ${DLG}; const p = d.querySelector('[data-send-preview]').innerText; const lines = p.split('\\n').map((l) => l.trim()); return lines.includes('Subject: Please confirm your schedule changes — week of 2026-10-04') && lines.includes('Hi Jing,') && lines.includes('Your schedule for the week of 2026-10-04 has changed:') && lines.some((l) => /^• Mon 10\\/5: .+ → .*11:45 AM/.test(l)) && lines.includes('Please check and confirm:') && lines.includes('[Confirm my schedule]') && !p.includes('Looks good') && d.textContent.replace(/\\s+/g, ' ').includes('When you publish again, Jing and the people who can edit the schedule still get the normal notice.') && !d.textContent.includes('their supervisor');`),
    await evaluate(`return ${DLG}.querySelector('[data-send-preview]')?.innerText;`),
  );
  // has_login:false（没有登录账号）：只写邮箱，不写站内
  await evaluate(`$btn('Cancel', ${DLG}).click();`);
  await ctl({ noLogin: [4] });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`document.querySelector('[data-send-to-confirm="4"]')`);
  await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
  await waitFor(DLG);
  check("没有登录账号（has_login:false）：To 只写 📧 邮箱，不写 in-app notice；原文照样在", await evaluate(`const d = ${DLG}; const to = d.querySelector('[data-send-to]').textContent; return to.includes('📧') && !to.includes('in-app') && !d.querySelector('[data-send-preview]').textContent.includes('in-app') && d.querySelector('[data-send-preview]').textContent.includes('[Confirm my schedule]');`), await evaluate(`return ${DLG}.textContent;`));
  await evaluate(`$btn('Cancel', ${DLG}).click();`);
  await ctl({ noLogin: [] });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`document.querySelector('[data-send-to-confirm="4"]')`);
  await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
  await waitFor(DLG);
  check(
    "发送框：蓝色只有 Send to Jing",
    await evaluate(`const d = ${DLG}; const blues = [...d.querySelectorAll('button')].filter(b => ['rgb(59, 130, 246)', 'rgb(24, 95, 165)'].includes(getComputedStyle(b).backgroundColor)).map(b => b.textContent.trim()); return JSON.stringify(blues) === '["Send to Jing"]';`),
    await evaluate(`const d = ${DLG}; return JSON.stringify([...d.querySelectorAll('button')].map(b => [b.textContent.trim(), getComputedStyle(b).backgroundColor]));`),
  );
  // 后端 G217 的原话：400 没变化、409 要先 Publish again（ef，10-30）。
  await ctl({ sendFail: "Jing's schedule hasn't changed since the last publish, so there is nothing to send.", sendFailStatus: 400 });
  await evaluate(`${DLG}.querySelector('[data-send-changes-go]').click();`);
  check(
    "发送失败 400：红字「Could not send: 后端原话 Nothing was sent.」，框还在、可以再按",
    await waitFor(`(() => { const d = ${DLG}; const e = d.querySelector('[data-send-error]'); return !!e && e.textContent === "Could not send: Jing's schedule hasn't changed since the last publish, so there is nothing to send. Nothing was sent." && getComputedStyle(e).color === 'rgb(163, 45, 45)' && !d.querySelector('[data-send-changes-go]').disabled; })()`),
  );
  await ctl({ sendFail: "Publish again first, then send changes.", sendFailStatus: 409 });
  await evaluate(`${DLG}.querySelector('[data-send-changes-go]').click();`);
  check(
    "发送失败 409：红字「Could not send: Publish again first, then send changes. Nothing was sent.」",
    await waitFor(`(() => { const e = ${DLG}.querySelector('[data-send-error]'); return !!e && e.textContent === 'Could not send: Publish again first, then send changes. Nothing was sent.' && getComputedStyle(e).color === 'rgb(163, 45, 45)'; })()`),
  );
  await ctl({ sendFail: "", sendFailStatus: 0 });
  const sendsBefore = (await (await fetch(`${MOCK}/__sends`)).json()).length;
  await evaluate(`${DLG}.querySelector('[data-send-changes-go]').click();`);
  check(
    "发好：绿字「✓ Sent to Jing · 时间 (email + in-app)」、淡黄「Sent by … on …」、键变 Close",
    await waitFor(`(() => { const d = ${DLG}; const ok = d.querySelector('[data-send-ok]'); return !!ok && ok.textContent.startsWith('✓ Sent to Jing · ') && ok.textContent.endsWith(' (email + in-app)') && getComputedStyle(ok).color === 'rgb(21, 128, 61)' && d.querySelector('[data-sent-by]').textContent.startsWith('Sent by ZZ Test on') && !!$btn('Close', d) && !d.querySelector('[data-send-changes-go]'); })()`),
    await evaluate(`return ${DLG}.textContent;`),
  );
  const sends = (await (await fetch(`${MOCK}/__sends`)).json()).slice(sendsBefore);
  check("只发本人：POST …/employees/4/send-changes 一次", sends.length === 1 && sends[0].employee_id === 4 && sends[0].week === "2026-10-04", JSON.stringify(sends));
  await evaluate(`$btn('Close', ${DLG}).click();`);
  check(
    "关掉以后：那一行写淡黄「Sent to Jing 时间」，键变 Send again",
    await waitFor(`(document.querySelector('[data-person-changes="4"]')?.textContent || '').startsWith('Sent to Jing ') && document.querySelector('[data-person-changes="4"]').textContent.endsWith('Send again')`),
    await evaluate(`return document.querySelector('[data-person-changes="4"]')?.textContent;`),
  );
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")}`);
  check("重新打开页面：提醒照样在（后端 has_unsent_changes）", await waitFor("!!document.querySelector('[data-unsent-changes]')"));
  check("重新打开页面：Sent to Jing / Send again 照样在（后端 sent_at）", await evaluate(`return (document.querySelector('[data-person-changes="4"]')?.textContent || '').includes('Send again');`));
  // 后端 G217：channels 也可能只有 ["email"]，绿字照返回的写。
  await ctl({ sendEmailOnly: true });
  await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
  await waitFor(`${DLG}`);
  await evaluate(`${DLG}.querySelector('[data-send-changes-go]').click();`);
  check("Send again、后端只回 email：绿字结尾写 (email)，不写 in-app", await waitFor(`(() => { const ok = ${DLG}?.querySelector('[data-send-ok]'); return !!ok && ok.textContent.endsWith(' (email)'); })()`), await evaluate(`return ${DLG}?.textContent;`));
  await evaluate(`$btn('Close', ${DLG}).click();`);
  await ctl({ sendEmailOnly: false });
  // G217 ef（Annie 定「重置」）：Jing 原来点了 Looks good，Send to confirm 发送成功后 Responses 卡变回 No answer（发送后重拉 confirmations）
  await ctl({ confirm: true, jingAccepted: true });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`(document.querySelector('[data-response="4"]')?.textContent || '').includes('Accepted')`);
  await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
  await waitFor(DLG);
  // 7b（Annie 10-30「6 7 7b 按推荐 动手」）：当前是 Looks good ⇒ 发送框多一行灰字提醒会重置
  check("7b：Jing 当前是 Looks good，发送框灰字「Jing answered Looks good before. Sending this resets the answer to No answer, so Jing confirms again.」", await evaluate(`const n = ${DLG}.querySelector('[data-answer-reset-note]'); return !!n && n.textContent.replace(/\\s+/g, ' ').trim() === 'Jing answered Looks good before. Sending this resets the answer to No answer, so Jing confirms again.' && getComputedStyle(n).color === 'rgb(107, 114, 128)';`), await evaluate(`return ${DLG}.textContent;`));
  let confFrom = (await mockLog()).length;
  await evaluate(`${DLG}.querySelector('[data-send-changes-go]').click();`);
  await waitFor(`${DLG}?.querySelector('[data-send-ok]')`);
  check("7b：发好以后那行提醒收起", await evaluate(`return !${DLG}.querySelector('[data-answer-reset-note]');`));
  await evaluate(`$btn('Close', ${DLG}).click();`);
  check("发送成功后重拉 Responses：原来 Accepted 的 Jing 变回 No answer yet", await waitFor(`(document.querySelector('[data-response="4"]')?.textContent || '').includes('No answer yet')`) && (await since(confFrom, (e) => e.path === "/api/schedule/weeks/2026-10-04/confirmations")).length >= 1, await evaluate(`return document.querySelector('[data-response="4"]')?.textContent;`));
  // 没回（刚被重置）：再打开发送框不出提醒
  await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
  await waitFor(DLG);
  check("7b：Jing 没回（No answer）时发送框不出提醒", await evaluate(`return !${DLG}.querySelector('[data-answer-reset-note]');`));
  await evaluate(`$btn('Cancel', ${DLG}).click();`);
  // Send my changes（wants_changes）：也不出
  await ctl({ jingAnswer: "wants_changes" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`(document.querySelector('[data-response="4"]')?.textContent || '').includes('Wants changes')`);
  await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
  await waitFor(DLG);
  check("7b：Jing 是 Wants changes 时发送框不出提醒", await evaluate(`return !${DLG}.querySelector('[data-answer-reset-note]');`));
  await evaluate(`$btn('Cancel', ${DLG}).click();`);
  await ctl({ confirm: false, jingAnswer: null });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`document.querySelector('[data-send-to-confirm="4"]')`);
  await evaluate("$btn('Publish again').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
  check("改过再 Publish again：只通知班变了的那一个人 + 2 位主管，写「Published again. Notified 1 staff member and 2 schedule editors.」，提醒没了", await waitFor("document.body.innerText.includes('Published again. Notified 1 staff member and 2 schedule editors.') && !document.querySelector('[data-unsent-changes]')"));
  check("Publish again 以后：行上的标记、改过的格子框都清掉", await waitFor("!document.querySelector('[data-person-changes]') && !document.querySelector('[data-changed]')"));
  // 除了按的人没有别的主管：后半句不写
  await ctl({ noSupervisors: true });
  await setTime(jingMonPub, '11:15');
  await saveWeek();
  await waitFor("!!document.querySelector('[data-unsent-changes]')");
  await evaluate("$btn('Publish again').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
  check("主管 0 人：只写「Published again. Notified 1 staff member.」，不写 and 0 supervisors", await waitFor("document.body.innerText.includes('Published again. Notified 1 staff member.') && !document.body.innerText.includes('schedule editor')"));
  check("都收到：提示条绿色、没有红字那段", await evaluate("const b = document.querySelector('[data-publish-banner]'); return !!b && b.dataset.publishBanner === 'ok' && !b.querySelector('[data-publish-unreached]');"));
  await ctl({ noSupervisors: false });

  // ── 置顶 15（Annie 2026-10-30「同意」「以上内容全都动手」）：发布后列出谁没收到（后端 ef not_reached，mock）──
  async function republishWith(time, opts) {
    await ctl(opts);
    await setTime(jingMonPub, time);
    await saveWeek();
    await waitFor("!!document.querySelector('[data-unsent-changes]')");
    await evaluate("$btn('Publish again').click();");
    await waitFor("document.querySelector('[role=dialog]')");
    await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
    await waitFor("!!document.querySelector('[data-publish-banner]') && !document.querySelector('[role=dialog]')");
  }
  // 有人没收到：绿字照旧写通知了谁，后面红字写没收到的人和原因
  await republishWith("11:30", { notReached: { 4: "no email or login" } });
  check(
    "有人没收到：绿字「Published again. Notified 2 schedule editors.」，后面红字「1 couldn't be reached: Jing (no email or login).」",
    await evaluate("const b = document.querySelector('[data-publish-banner]'); const ok = b.querySelector('[data-publish-ok]'); const r = b.querySelector('[data-publish-unreached]'); return b.dataset.publishBanner === 'some-missed' && ok.textContent === 'Published again. Notified 2 schedule editors.' && !!r && r.textContent === \"1 couldn't be reached: Jing (no email or login).\" && getComputedStyle(r).color !== getComputedStyle(ok).color && r.className.includes('text-red');"),
    await evaluate("return document.querySelector('[data-publish-banner]')?.innerText;"),
  );
  // 谁都没收到：整句红字
  await republishWith("11:45", { notReached: { 4: "no email or login" }, noneReached: true });
  check(
    "谁都没收到：红框整句红字「Published again, but no one was notified: Jing has no email or login. Add their email in Employees.」",
    await evaluate("const b = document.querySelector('[data-publish-banner]'); return b.dataset.publishBanner === 'none-notified' && b.getAttribute('role') === 'alert' && b.textContent.trim() === '⚠️ Published again, but no one was notified: Jing has no email or login. Add their email in Employees.' && b.className.includes('text-red') && b.className.includes('border-red');"),
    await evaluate("return document.querySelector('[data-publish-banner]')?.innerText;"),
  );
  // 放回原样（后面的检查按 Jing 周一 11:15 写）
  await republishWith("11:15", { notReached: null, noneReached: false });

  // 线上 bug（Annie 10-30「其实刚才是不让我存，因为有gap，但是这个提醒要到publish才能看到」）：
  // 已发布的周，Save 会造成新空档 ⇒ 后端 409 {detail:{detail, code:"coverage_gap", gaps}}。红字原话 + 列出哪天几点，Not saved yet 留着。
  const vMon = `${cell("1|2026-10-05")}.querySelector('[data-slot-id]')`;
  await evaluate(`${vMon}.querySelector('button[title="Remove this shift"]').click();`);
  await waitFor(`${vMon}?.dataset.mark === 'deleted'`);
  // 人在页面下面（周表 / Day timeline）按的 Save：先滚到底。
  await evaluate("window.scrollTo(0, document.body.scrollHeight);");
  await sleep(200);
  const gapSaved = await saveWeek();
  await sleep(600);
  check("已发布的周 Save 造成新空档：后端 409 coverage_gap ⇒ 没存上", !gapSaved);
  check("红字自己滚到屏幕中间（人在页面下面也看得到）", await evaluate("const r = document.querySelector('[data-save-error]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight;"), await evaluate("const r = document.querySelector('[data-save-error]')?.getBoundingClientRect(); return JSON.stringify([r?.top, r?.bottom, window.innerHeight, window.scrollY]);"));
  check("红字写后端原话、列出空档（Mon 10/05 · nobody 2:00–11:15 AM），Not saved yet 留着", await evaluate("const e = document.querySelector('[data-save-error]').textContent; return e.includes(\"This change would leave a gap in coverage, so it wasn't saved.\") && e.includes('Mon 10/05 · nobody 2:00–11:15 AM') && !!document.querySelector('[data-unsaved-summary]');"), await evaluate("return document.querySelector('[data-save-status]')?.textContent;"));
  check("被拒的空档在页面上也标出来：周表列头 Mon 10/05 红点、Day timeline 的 Mon 带红点", await evaluate("return !!document.querySelector('[data-grid-gap=\"2026-10-05\"]') && !!document.querySelector('[data-day-tab=\"2026-10-05\"][data-has-gap]');"));
  await evaluate("document.querySelector('[data-week-discard]').click();");
  check("Discard：红字、Not saved yet 都没了，周表列头的红点也没了", await waitFor("!document.querySelector('[data-save-error]') && !document.querySelector('[data-unsaved-summary]') && !document.querySelector('[data-grid-gap=\"2026-10-05\"]')"));
  // 没有邮箱：黄框、Send 灰着
  const jingEmail = (await (await fetch(`${MOCK}/api/schedule/employees`)).json()).employees.find((e) => e.id === 4).email;
  await fetch(`${MOCK}/api/schedule/employees/4`, { method: "PUT", body: JSON.stringify({ email: "" }) });
  const jingMonPub2 = `${cell("4|2026-10-05")}.querySelector('[data-slot-id]')`;
  await setTime(jingMonPub2, '11:30');
  await saveWeek();
  await waitFor(`document.querySelector('[data-send-to-confirm="4"]')`);
  // 名单是打开页面时读的（真用时在 Employees 里改会刷新）：重新打开。
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`document.querySelector('[data-send-to-confirm="4"]')`);
  await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
  await waitFor(DLG);
  check("没有邮箱：黄框「No email for Jing. Add it in Employees, then send.」，Send to Jing 灰着", await evaluate(`const d = ${DLG}; return !!d.querySelector('[data-no-email]') && d.querySelector('[data-no-email]').textContent.startsWith('No email for Jing. Add it in Employees, then send.') && d.querySelector('[data-send-changes-go]').disabled;`));
  await evaluate(`$btn('Cancel', ${DLG}).click();`);
  await fetch(`${MOCK}/api/schedule/employees/4`, { method: "PUT", body: JSON.stringify({ email: jingEmail }) });

  // ── Publish anyway（Q1 admin 及以上）：整周空的 2027-01-03（7 天都是空档）──
  await ctl({ role: "admin", meName: "" });
  await openPage(`${APP}/schedule?week=2027-01-03`);
  if (!(await waitFor("document.querySelector('[data-gap-summary]')", 30000))) console.log("DEBUG page:", (await evaluate("return document.body.innerText.replace(/\s+/g, ' ').slice(0, 600);")));
  check(
    "多段空档：写前 3 段 +4 more（Gaps: Sun 01/03 …）",
    await evaluate("const g = document.querySelector('[data-gap-summary]').textContent; return g.includes('Gaps:') && g.includes('Sun 01/03 · nobody 2:00 AM–9:30 PM') && g.includes('+4 more') && document.querySelectorAll('[data-gap-link]').length === 3;"),
    await evaluate("return document.querySelector('[data-gap-summary]')?.textContent;"),
  );
  check("admin 有空档：Publish 能点（蓝色）", await evaluate("const b = $btn('Publish'); return !b.disabled && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
  await evaluate("$btn('Publish').click();");
  await waitFor("document.querySelector('[role=dialog] [data-publish-gaps]')");
  check(
    "Publish anyway 确认框：标题 Publish with a coverage gap?，逐段列出 7 段空档，写会记进 Action Log",
    await evaluate("const d = document.querySelector('[role=dialog]'); return d.querySelector('h2').textContent === 'Publish with a coverage gap?' && d.querySelectorAll('[data-publish-gaps] li').length === 7 && d.textContent.includes('Sat 01/09 · nobody 2:00 AM–9:30 PM') && d.textContent.includes('written in the Action Log');"),
  );
  check(
    "确认框：蓝色只有 Publish anyway，Cancel 不是蓝色",
    await evaluate("const d = document.querySelector('[role=dialog]'); const blues = [...d.querySelectorAll('button')].filter(b => getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)').map(b => b.textContent.trim()); return JSON.stringify(blues) === '[\"Publish anyway\"]';"),
    await evaluate("const d = document.querySelector('[role=dialog]'); return JSON.stringify([...d.querySelectorAll('button')].map(b => [b.textContent.trim(), getComputedStyle(b).backgroundColor]));"),
  );
  const pubsBefore = (await (await fetch(`${MOCK}/__publishes`)).json()).length;
  await evaluate("$btn('Publish anyway', document.querySelector('[role=dialog]')).click();");
  check("Publish anyway：发布成功", await waitFor("document.body.innerText.includes('Published. Notified')"));
  const pubs = (await (await fetch(`${MOCK}/__publishes`)).json()).slice(pubsBefore);
  check("Publish anyway 送的是 POST publish {allow_gaps: true}", pubs.length === 1 && pubs[0].body?.allow_gaps === true && pubs[0].week === "2027-01-03", JSON.stringify(pubs));
  check(
    "带空档发布以后，admin 打开照样提醒：「Published with a gap: …」、红点还在（Q4，补上人后端 gaps 变空就消失）",
    await waitFor("document.querySelector('[data-gap-summary]')?.textContent.includes('Published with a gap') && !!document.querySelector('[data-has-gap]') && !!$btn('Publish again') && !$btn('Publish again').disabled"),
  );
  await evaluate("$btn('Publish again').click();");
  await waitFor("document.querySelector('[role=dialog] [data-publish-gaps]')");
  check(
    "已发布的周还有空档：Publish again 也走同一个确认框（Publish again with a coverage gap? / Publish again anyway，Q6 保留 Publish again）",
    await evaluate("const d = document.querySelector('[role=dialog]'); return d.querySelector('h2').textContent === 'Publish again with a coverage gap?' && !!$btn('Publish again anyway', d);"),
  );
  await evaluate("$btn('Cancel', document.querySelector('[role=dialog]')).click();");
  await sleep(200);
  // supervisor 打开同一周：照样看到提醒，但 Publish again 灰着
  await ctl({ role: "supervisor", meName: "" });
  await openPage(`${APP}/schedule?week=2027-01-03`);
  await waitFor("document.querySelector('[data-gap-summary]')");
  check("supervisor：有空档时 Publish again 灰着、写原因", await evaluate("const b = $btn('Publish again'); return !!b && b.disabled && b.title.includes('Only admins can publish with a gap');"));
  const supDirect = await fetch(`${MOCK}/api/schedule/weeks/2027-01-03/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allow_gaps: true }) });
  check("supervisor 绕过页面带 allow_gaps：403 + 后端原话（mock 照后端 d2bc2cf）", supDirect.status === 403 && (await supDirect.json()).detail === "Only admins can publish with a gap. Fill the gap first.");
  // staff：已发布的这一周看得到，但看不到任何空档提示（Q3）
  await ctl({ role: "staff", meName: "Jing" });
  await openPage(`${APP}/schedule?week=2027-01-03`);
  await waitFor("document.body.innerText.includes('Day timeline') || document.body.innerText.includes('Nov') || document.querySelector('[data-day-tab]')");
  await sleep(500);
  check(
    "staff 看已发布的周：没有 Gap 提示、日期键没有红点、周表列头没有红点、没有 Gaps 那一句、没有 Nobody 行（Q3）",
    await evaluate("return !document.querySelector('[data-gap-summary]') && !document.querySelector('[data-has-gap]') && !document.querySelector('[data-grid-gap]') && !document.querySelector('[data-gaps-line]') && !document.querySelector('[data-nobody-row]');"),
  );

  // ── staff：只读，能翻周 ──
  await ctl({ role: "staff", meName: "Jing" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("4|2026-10-05")}`);
  check("staff 能看已发布的这一周（不是 403 提示）", !(await text()).includes("hasn't been published"));
  check("staff 看不到 Send to confirm、N changes、改过的格子框", await evaluate("return !document.querySelector('[data-person-changes]') && !document.querySelector('[data-send-to-confirm]') && !document.querySelector('[data-changed]');"));
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
  await waitFor("document.querySelectorAll('input[data-time-input]').length === 2");
  await evaluate(`$setValue(document.querySelectorAll('input[data-time-input]')[0], '03:00');`);
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
  check("Add rule 弹窗里下拉框的选项背景色和文字色不同（不是白底白字）", await evaluate(`const sels = [...${dlg}.querySelectorAll('select')]; return sels.length > 0 && sels.every(s => { const o = s.querySelector('option'); const c = getComputedStyle(o); return c.backgroundColor !== c.color && getComputedStyle(s).colorScheme.includes('dark'); });`));
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
  // 等的是删除确认框（上一个 Edit rule 框可能还没关掉）：框里出现 Delete 键再点。
  await waitFor(`${dlg} && !${dlg}.textContent.includes('Edit rule') && !!$btn('Delete', ${dlg})`);
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
  // 当前这一周（B9 Q6）：填出来的班先放在页面上等 Save，不直接建；Replace = 原来的班标删掉。
  check("建好：绿条写「Put 30 shifts on this week. Click Save to keep them. … Nothing is published」，没发 bulk", (await waitFor("document.querySelector('[data-autofill-banner]')?.textContent.includes('Put 30 shifts on this week. Click Save to keep them.') && document.querySelector('[data-autofill-banner]').textContent.includes('Nothing is published')")) && (await (await fetch(`${MOCK}/__log`)).json()).filter((e) => e.path.endsWith("/slots/bulk")).length === 0, await evaluate("return document.querySelector('[data-autofill-banner]')?.textContent;"));
  check("页面上：新班标 new、原来的班灰掉划线；Not saved yet 写 30 shifts added", await evaluate("const n = document.querySelector('[data-unsaved-summary]')?.textContent || ''; return n.includes('30 shifts added') && n.includes('shifts removed') && document.querySelectorAll('[data-mark=new]').length === 30 && document.querySelectorAll('[data-mark=deleted]').length > 0;"), await evaluate("return document.querySelector('[data-unsaved-summary]')?.textContent;"));
  let wk;
  await saveWeek();
  wk = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-11`)).json();
  check("Save 以后服务端这周 30 个班、都有人、状态还是 draft（没发布）", wk.slots.length === 30 && wk.slots.every((x) => x.employee_id != null) && wk.status === "draft", `${wk.slots.length} ${wk.status}`);
  const afSave = (await changesLog()).at(-1)?.body;
  check("一次 POST …/changes：30 条 create + 原来每个班一条 delete", afSave?.ops.filter((o) => o.op === "create").length === 30 && afSave.ops.filter((o) => o.op === "delete").length > 0, JSON.stringify(afSave?.ops.map((o) => o.op)));
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
  const timeVals = () => evaluate(`return [...${dlg}.querySelectorAll('input[data-time-input]')].map(i => i.dataset.value).join('|');`);
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
  await saveWeek();
  let p2 = await (await fetch(`${MOCK}/api/schedule/weeks/${P2}`)).json();
  check("二期：创建请求带 note", p2.slots.some((x) => x.employee_id === 1 && x.note === "Train open w/Veronica"));
  check("二期：周数据带 time_off（空数组）", Array.isArray(p2.time_off) && p2.time_off.length === 0);

  // 改备注：点备注文字 → 输入框 → 存
  await evaluate(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]').click();`);
  await waitFor(`${cell("1|2026-12-07")}.querySelector('[data-note-editor]')`);
  await evaluate(`const i = ${cell("1|2026-12-07")}.querySelector('[data-note-editor]'); $setValue(i, 'Standby'); ${cell("1|2026-12-07")}.querySelector('[data-note-save]').click();`);
  check("二期：改备注 ⇒ 格子显示新备注 Standby、标琥珀色 note（键叫 Done，白色）", (await waitFor(`${hasText(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]')`, "Standby")}`)) && (await evaluate(`return ${cell("1|2026-12-07")}.querySelector('[data-slot-id]').dataset.mark === 'note';`)));
  await saveWeek();
  const noteOps = (await changesLog()).at(-1)?.body.ops;
  check("二期：Save 一次、ops 只有一条 {op:'note', note:'Standby'}；不再单独 PUT …/note", noteOps?.length === 1 && noteOps[0].op === "note" && noteOps[0].note === "Standby" && (await (await fetch(`${MOCK}/__log`)).json()).filter((e) => e.path.endsWith("/note")).length === 0, JSON.stringify(noteOps));
  // 清空 = 删除
  await evaluate(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]').click();`);
  await waitFor(`${cell("1|2026-12-07")}.querySelector('[data-note-editor]')`);
  await evaluate(`const i = ${cell("1|2026-12-07")}.querySelector('[data-note-editor]'); $setValue(i, ''); ${cell("1|2026-12-07")}.querySelector('[data-note-save]').click();`);
  check("二期：清空再 Done ⇒ 备注没了，出现「+ note」", await waitFor(`!${cell("1|2026-12-07")}.querySelector('[data-slot-note]') && !!${cell("1|2026-12-07")}.querySelector('[data-add-note]')`));
  await saveWeek();
  check("二期：清空存的是 note:null", (await changesLog()).at(-1)?.body.ops[0]?.note === null);
  // + note
  await evaluate(`${cell("1|2026-12-07")}.querySelector('[data-add-note]').click();`);
  await waitFor(`${cell("1|2026-12-07")}.querySelector('[data-note-editor]')`);
  await evaluate(`const i = ${cell("1|2026-12-07")}.querySelector('[data-note-editor]'); $setValue(i, 'Pre close'); i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));`);
  check("二期：+ note → Enter ⇒ 显示 Pre close", await waitFor(`${hasText(`${cell("1|2026-12-07")}.querySelector('[data-slot-note]')`, "Pre close")}`));
  await saveWeek();

  // 休假：Lizzie 周二录 Sick + 备注
  await evaluate(`${cell("2|2026-12-08")}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.querySelector('[data-mode=off]')`);
  await evaluate(`${dlg}.querySelector('[data-mode=off]').click();`);
  check("二期：Time off 模式：标题 Add time off、有 PTO / Sick / Personal 三个选项", await evaluate(`return ${dlg}.textContent.includes('Add time off') && ['PTO', 'Sick', 'Personal'].every(t => $btn(t, ${dlg})) && !${dlg}.querySelector('input[data-time-input]');`));
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

  // 冲突（排班 ⇒ 这天有休假）：整周 Save 时后端整批拒（400 op_index），红字原话、那一张标红，一样都不存，改动留着。
  const beforeCount = (await (await fetch(`${MOCK}/api/schedule/weeks/${P2}`)).json()).slots.length;
  await evaluate(`${cell("2|2026-12-08")}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add shift')`);
  await evaluate(`$btn('Add shift', ${dlg}).click();`);
  await waitFor(`${cell("2|2026-12-08")}.querySelector('[data-mark=new]')`);
  check("二期：给有休假的人排班 ⇒ Save 时红字写后端原话（Change 1: …）、说一样都没存", !(await saveWeek()) && (await evaluate(`const e = document.querySelector('[data-save-error]'); return !!e && e.textContent.includes("Change 1: Lizzie has time off on 2026-12-08, so they can't be scheduled that day.") && e.textContent.includes('Nothing was saved') && e.className.includes('text-red-200');`)), await evaluate("return document.querySelector('[data-save-error]')?.textContent;"));
  check("二期：后端指出的那一张（op_index → 这张新班）标红，改动还在页面上", await evaluate(`const c = ${cell("2|2026-12-08")}.querySelector('[data-slot-id]'); return c.dataset.slotError === 'true' && c.dataset.mark === 'new' && !!document.querySelector('[data-unsaved-summary]');`));
  p2 = await (await fetch(`${MOCK}/api/schedule/weeks/${P2}`)).json();
  check("二期：被拦时服务端什么都没存", p2.slots.length === beforeCount, `${beforeCount} → ${p2.slots.length}`);
  await evaluate("document.querySelector('[data-week-discard]').click();");
  check("Discard：放弃没存的改动，回到已存的样子（Lizzie 那天又是休假格）", await waitFor(`!document.querySelector('[data-unsaved-summary]') && !document.querySelector('[data-save-error]') && !!${cell("2|2026-12-08")}.querySelector('[data-time-off]')`));

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
  // 「Loading…」本来也是个 <p>，只等「有 p 或 data-off」会在表格还没渲染出来时就提前放行（系统忙的时候更容易撞上）；
  // 要么真等到表格（.w-max）出来，要么等到一个不是 Loading 的 <p>（not published / 出错）。
  await waitFor(`
    document.querySelector('[data-dashboard-schedule] .w-max') ||
    (() => { const p = document.querySelector('[data-dashboard-schedule] p');
      return p && !p.textContent.includes('Loading'); })()
  `);
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

  // ── 周三确认下周排班的回应（Annie 2026-10-19「现在动手」）──
  // 接口没上线（404）：整块不显示、不报错，排班页照旧（上面所有检查都是在这个状态下跑的）。
  await ctl({ role: "supervisor", confirm: false, meName: "" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")}`);
  await sleep(500);
  check("周三确认的接口没上线（404）：Responses 整块不显示、也不报错", await evaluate("return !document.querySelector('[data-responses]') && !document.body.innerText.includes('schedule responses');"));
  // 接口上线：主管看到各人的回应 + 亮黄色想加的班，Approve / Decline。
  await ctl({ confirm: true });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelector('[data-responses]')");
  check(
    "Responses：三个人的回应（Veronica Accepted、Lizzie Wants changes、Nadia No answer yet），写想加的班",
    await evaluate(`const r = (id) => document.querySelector('[data-response="' + id + '"]')?.textContent ?? ''; return r(1).includes('Accepted') && r(2).includes('Wants changes') && r(2).includes('Wed Mid') && r(2).includes('Fri Open') && r(3).includes('No answer yet');`),
    await evaluate("return document.querySelector('[data-responses]')?.textContent ?? 'none';"),
  );
  check(
    "亮黄色想加的班：Lizzie 两条，在周三 Mid、周五 Open 的格子里，各有 Approve / Decline",
    await evaluate(`const a = [...document.querySelectorAll('[data-responses] [data-added=pending]')]; const bg = getComputedStyle(a[0] ?? document.body).backgroundColor; return a.length === 2 && a.every((e) => e.textContent.includes('Lizzie') && e.textContent.includes('asked')) && bg === 'rgb(252, 211, 77)' && document.querySelectorAll('[data-approve]').length === 2 && document.querySelectorAll('[data-decline]').length === 2;`),
    await evaluate("return [...document.querySelectorAll('[data-responses] [data-added]')].map((e) => e.dataset.added + ':' + e.textContent).join(' | ');"),
  );
  let from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-approve=\"901\"]').click();");
  await waitFor("!document.querySelector('[data-approve=\"901\"]')");
  check("Approve：发 POST …/confirmation-requests/901/approve；那一条不再是亮黄色，只剩周五 Open 一条", (await since(from, (e) => e.path === "/api/schedule/confirmation-requests/901/approve")).length === 1 && (await evaluate("return document.querySelectorAll('[data-responses] [data-added=pending]').length === 1;")));
  check("Approve 之后这一周重新拉了一次（周三 Mid 多了 Lizzie 的正式时段）", (await since(from, (e) => e.path === "/api/schedule/weeks/2026-10-04")).length >= 1);
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-decline=\"902\"]').click();");
  await waitFor("document.querySelector('[data-responses] [data-added=declined]')");
  check("Decline：发 POST …/902/decline；那一条变成划掉的 declined，没有 Approve / Decline 键", (await since(from, (e) => e.path === "/api/schedule/confirmation-requests/902/decline")).length === 1 && (await evaluate("const d = document.querySelector('[data-responses] [data-added=declined]'); return d.textContent.includes('declined') && !d.querySelector('button') && !document.querySelector('[data-approve]');")));
  // 员工（只读）不显示 Responses。
  await ctl({ role: "staff", meName: "Jing" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await sleep(800);
  check("员工看排班页：没有 Responses", await evaluate("return !document.querySelector('[data-responses]');"));
  await ctl({ role: "supervisor", confirm: false, meName: "" });

  // ── 一周同时只能一个人动手改（Annie 2026-10-19「动手改才提示」）──
  // 一次改动：点一张卡片，再点同一天别人的格子（换人）。
  const swapOnce = async () => {
    const pair = await evaluate(`
      const cells = [...document.querySelectorAll('[data-cell]')].filter((c) => /^\d+\|/.test(c.dataset.cell));
      for (const c of cells) {
        const card = c.querySelector('[data-slot-id]');
        if (!card) continue;
        const [emp, date] = c.dataset.cell.split('|');
        const target = cells.find((t) => t.dataset.cell.endsWith('|' + date) && t.dataset.cell.split('|')[0] !== emp && !t.querySelector('[data-slot-id]'));
        if (target) return { slot: Number(card.dataset.slotId), target: target.dataset.cell };
      }
      return null;`);
    if (!pair) return null;
    await evaluate(`document.querySelector('[data-slot-id="${pair.slot}"]').click();`);
    await waitFor("document.body.innerText.includes('Card selected')");
    await evaluate(`${cell(pair.target)}.click();`);
    return pair;
  };
  // 默认（接口没上线 404）：上面所有改动检查都是在这个状态下跑的，没有任何占用请求报错；这里再确认一次不弹。
  await ctl({ role: "supervisor", lockMode: "", confirm: false, meName: "" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")}`);
  from = (await mockLog()).length;
  const p404 = await swapOnce();
  await waitFor(`${cell(p404.target)}.querySelector('[data-slot-id]')`);
  check("占用接口没上线(404)：照常能改、不弹、不报错（改动先在页面上，没有单项 assign）", !!p404 && (await evaluate("return !document.querySelector('[data-schedule-locked]') && !document.body.innerText.includes('Request failed') && !!document.querySelector('[data-unsaved-summary]');")) && (await since(from, (e) => e.method === "PUT" && e.path.endsWith("/assign"))).length === 0);
  await evaluate("document.querySelector('[data-week-discard]').click();");
  await waitFor("!document.querySelector('[data-unsaved-summary]')");

  // 占得到：打开不占；第一次动手前占一次；后面的改动不再占；15 分钟（检查里改成 2 秒）没动手就放开。
  await ctl({ lockMode: "ok" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")}`);
  await evaluate("window.__scheduleIdleExitS = 2; window.__scheduleIdleRemindS = 2;");
  from = (await mockLog()).length;
  check("打开周表：不占用（没有 edit-lock 请求）", (await since(from, (e) => e.path.includes("/edit-lock"))).length === 0 && (await evaluate("return !document.querySelector('[data-schedule-locked]');")));
  const lp1 = await swapOnce();
  await waitFor(`${cell(lp1.target)}.querySelector('[data-slot-id]')`);
  const acq = await since(from, (e) => e.method === "POST" && e.path === "/api/schedule/weeks/2026-10-04/edit-lock");
  check("第一次动手改：先 POST …/weeks/2026-10-04/edit-lock 占住，改动放在页面上（没有单项 assign）；没有弹提示", acq.length === 1 && (await since(from, (e) => e.method === "PUT" && e.path.endsWith("/assign"))).length === 0 && (await evaluate("return !document.querySelector('[data-schedule-locked]');")));
  const lp2 = await swapOnce();
  if (lp2) await waitFor(`${cell(lp2.target)}.querySelector('[data-slot-id]')`);
  check("接着改第二次：不再去占（还是只有一次 edit-lock）", (await since(from, (e) => e.method === "POST" && e.path === "/api/schedule/weeks/2026-10-04/edit-lock")).length === 1);
  // 第二次挪可能刚好挪回原样（暂存里就没有改动了）：再改一个时间，确保有没存的改动。
  await setTime(`${cell("1|2026-10-04")}.querySelector('[data-slot-id]')`, "02:05");
  await waitFor("!!document.querySelector('[data-unsaved-summary]')");
  from = (await mockLog()).length;
  await waitFor(`false`, 4500);
  // B9 Q4（Annie「Q1–Q7 照推荐」）：有没存的改动时，没动作也不放开锁、不自动存，只出一行琥珀色提醒。
  check("有没存的改动、一段时间没动（检查里 2 秒）：不放开锁、不自动存，出琥珀色提醒", (await since(from, (e) => e.path.endsWith("/edit-lock/release") || e.path.endsWith("/changes"))).length === 0 && (await evaluate("const n = document.querySelector('[data-idle-nudge]'); return !!n && n.textContent.includes('Click Save to keep your changes; they are not saved automatically.');")));
  await saveWeek();
  check("按 Save 存好：放开锁（POST …/edit-lock/release），提醒没了", (await waitFor("!document.querySelector('[data-idle-nudge]')")) && (await since(from, (e) => e.path === "/api/schedule/weeks/2026-10-04/edit-lock/release")).length >= 1);
  from = (await mockLog()).length;
  const lp3 = await swapOnce();
  if (lp3) await waitFor(`${cell(lp3.target)}.querySelector('[data-slot-id]')`);
  check("放开之后再动手：重新去占", (await since(from, (e) => e.method === "POST" && e.path === "/api/schedule/weeks/2026-10-04/edit-lock")).length === 1);

  // 别人在改：打开照常能看；动手改那一下弹「🔒 Sam is editing this schedule. Please try again later.」+ Back，不生效。
  await ctl({ lockMode: "busy" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("1|2026-10-04")}`);
  check("别人在改：打开周表照常能看、不弹", await evaluate("return !!document.querySelector('[data-sch-grid]') && !document.querySelector('[data-schedule-locked]');"));
  from = (await mockLog()).length;
  const pb = await swapOnce();
  await waitFor("document.querySelector('[data-schedule-locked]')");
  check(
    "动手改：弹深色面板 Sam is editing this schedule. + Please try again later. + Back；这一下没发 assign",
    await evaluate("const d = document.querySelector('[data-schedule-locked]'); return d.textContent.includes('Sam is editing this schedule.') && d.textContent.includes('Please try again later.') && !!d.querySelector('button') && d.querySelector('button').textContent === 'Back';") && (await since(from, (e) => e.method === "PUT" && e.path.endsWith("/assign"))).length === 0,
    await evaluate("return document.querySelector('[data-schedule-locked]')?.textContent ?? 'none';"),
  );
  await evaluate("document.querySelector('[data-schedule-locked] button').click();");
  check("点 Back：面板关掉；刚才想挪的卡片还在原处", !!pb && (await evaluate("return !document.querySelector('[data-schedule-locked]');")) && (await evaluate(`return !!${cell(pb.target)} && !${cell(pb.target)}.querySelector('[data-slot-id="${pb.slot}"]');`)));
  // Approve / Decline 也要先占：别人在改时弹同样的提示、不发请求。
  await ctl({ confirm: true, confirmReset: true });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelector('[data-approve]')");
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-approve]').click();");
  await waitFor("document.querySelector('[data-schedule-locked]')");
  check("别人在改时点 Approve：弹同样的提示，没发 approve 请求", (await since(from, (e) => e.path.includes("confirmation-requests"))).length === 0);
  await ctl({ lockMode: "", confirm: false });

  // ── 改时间小窗（A8，Annie 2026-10-29「根本点不了」，Q1–Q4 照推荐）+ 整周 Save（B9 Q1：小窗的键叫 Done，只放到页面上）──
  // 取代 10-20 的「点外面保留」：点外面不再存；没改直接关，改过出黄框 Unsaved changes（Done / Discard）。Esc 同点外面。
  await ctl({ lockMode: "", confirm: false, phase2: true, role: "supervisor", meName: "" });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor(`${cell("1|2026-12-07")}`);
  const slotA = `${cell("1|2026-12-07")}.querySelector('[data-slot-id]')`;
  const popup = "document.querySelector('[data-time-popup]')";
  const startIn = `${popup}.querySelector('input[aria-label="Start time"]')`;
  const anyWrite = async (n) => since(n, (e) => e.method !== "GET" && !e.path.includes("edit-lock"));
  const openTime = async (slot) => {
    await evaluate(`${slot}.querySelector('button.font-mono').click();`);
    await waitFor(popup);
  };
  from = (await mockLog()).length;
  await openTime(slotA);
  check("小窗开着时，周表上别的格子被透明遮罩挡住（点不到）", await evaluate(`const b = document.querySelector('[data-time-popup-backdrop]'); const r = ${cell("2|2026-12-07")}.getBoundingClientRect(); return !!b && document.elementFromPoint(r.left + 5, r.top + 5) === b;`));
  await evaluate("document.querySelector('[data-time-popup-backdrop]').click();");
  check("没改就点外面：小窗直接收起，不发请求", (await waitFor(`!${popup}`)) && (await anyWrite(from)).length === 0);

  await openTime(slotA);
  await evaluate(`$setValue(${startIn}, '09:15');`);
  await evaluate(`${popup}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  check("改过按 Esc（同点外面）：不关，出黄框 Unsaved changes", await waitFor(`${popup} && ${popup}.querySelector('[data-time-popup-unsaved]')`));
  await evaluate(`${popup}.querySelector('[data-time-popup-cancel]').click();`);
  check("Discard：小窗收起，时间不变、没标记、不发请求", (await waitFor(`!${popup}`)) && (await evaluate(`return !${slotA}.textContent.includes('9:15 AM') && !${slotA}.dataset.mark;`)) && (await anyWrite(from)).length === 0);

  await openTime(slotA);
  await evaluate(`$setValue(${startIn}, '07:00');`);
  await evaluate(`${popup}.querySelector('[data-time-popup-cancel]').click();`);
  check("没点外面、直接按 Cancel：放弃，时间不变", (await waitFor(`!${popup}`)) && (await evaluate(`return !${slotA}.textContent.includes('7:00 AM');`)));

  // ── 自绘时间选择器（Annie 2026-10-20「排班时间选择器 - 动手」）：在小窗里，列表开在输入框下面（inline）──
  await openTime(slotA);
  const pickPop = `${popup}.querySelector('[data-time-pop]')`;
  const clickEl = (sel) => evaluate(`${pickPop}.querySelector('${sel}').click();`);
  await evaluate(`${startIn}.click();`);
  await waitFor(pickPop);
  check("时间框是自绘的文字输入（不是浏览器自带的 type=time），点一下弹出列表", await evaluate(`return ${startIn}.type === 'text' && !document.querySelector('input[type=time]') && !!${pickPop};`));
  check(
    "尺寸：输入框 ≥ 36px 高，下拉每行 40px 高",
    await evaluate(`return ${startIn}.getBoundingClientRect().height >= 36 && ${pickPop}.querySelector('[data-hour="3"]').getBoundingClientRect().height === 40 && ${pickPop}.querySelector('[data-min="15"]').getBoundingClientRect().height === 40;`),
  );
  const startNow = await evaluate(`return ${startIn}.dataset.value;`);
  await evaluate(`const col = ${pickPop}.querySelector('[aria-label="Hour"]'); col.scrollTop = 120; window.__st = col.scrollTop;`);
  await clickEl('[data-hour="3"]');
  await sleep(150);
  check(
    "点小时 3：值的小时变 03、列表还开着、滚动位置不变（不会自己滑走）",
    await evaluate(`const col = ${pickPop}.querySelector('[aria-label="Hour"]'); return ${startIn}.dataset.value.startsWith('03:') && col.scrollTop === window.__st && window.__st > 0;`),
    await evaluate(`const col = ${pickPop}?.querySelector('[aria-label="Hour"]'); return ${startIn}.dataset.value + ' / ' + col?.scrollTop + ' / ' + window.__st;`),
  );
  await clickEl('[data-min="45"]');
  await sleep(100);
  // Esc：先只收起列表并退回打开时的时间，小窗还在
  await evaluate(`${startIn}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  await sleep(100);
  check("列表开着按 Esc：列表收起、时间退回打开时的值、小窗还开着", await evaluate(`return !${pickPop} && ${startIn}.dataset.value === '${startNow}' && !!${popup};`), await evaluate(`return ${startIn}.dataset.value;`));
  await evaluate(`${startIn}.click();`);
  await waitFor(pickPop);
  await clickEl('[data-hour="8"]');
  await clickEl('[data-min="30"]');
  await clickEl('[data-period="AM"]');
  check("点 8、30、AM：值变 08:30，选了 AM 列表就收起", (await waitFor(`!${pickPop}`)) && (await evaluate(`return ${startIn}.dataset.value === '08:30' && ${startIn}.value === '8:30 AM';`)));
  await evaluate(`${popup}.querySelector('[data-time-popup-done]').click();`);
  check("Done：格子写 8:30 AM、标 time；不发请求（等整周 Save）", (await waitFor(`!${popup} && ${slotA}.textContent.includes('8:30 AM') && ${slotA}.dataset.mark === 'time'`)) && (await anyWrite(from)).length === 0);
  // 直接打字
  await openTime(slotA);
  await evaluate(`$setValue(${startIn}, '9:45 pm');`);
  check("打字 9:45 pm：值立刻变 21:45", await evaluate(`return ${startIn}.dataset.value === '21:45';`));
  await evaluate(`${popup}.querySelector('[data-time-popup-done]').click();`);
  await waitFor(`!${popup} && ${slotA}.textContent.includes('9:45 PM')`);
  // 读不懂的字：退回原来的时间
  await openTime(slotA);
  await evaluate(`${startIn}.click(); $setValue(${startIn}, 'abc');`);
  await evaluate(`${popup}.querySelector('div').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));`);
  await sleep(150);
  check("打了读不懂的字：输入框退回 9:45 PM，值不变", await evaluate(`return ${startIn}.dataset.value === '21:45' && ${startIn}.value === '9:45 PM';`), await evaluate(`return ${startIn}.dataset.value + ' / ' + ${startIn}.value;`));
  await evaluate(`${popup}.querySelector('[data-time-popup-cancel]').click();`);
  await waitFor(`!${popup}`);
  const slotAId = Number(await evaluate(`return ${slotA}.dataset.slotId;`));
  const endBefore = (await (await fetch(`${MOCK}/api/schedule/weeks/${P2}`)).json()).slots.find((s) => s.id === slotAId)?.end_time;
  await saveWeek();
  const tOps = (await changesLog()).at(-1)?.body.ops;
  check("整周 Save：一条 time（start 21:45、end 不变）", tOps?.length === 1 && tOps[0].op === "time" && tOps[0].start_time === "21:45" && tOps[0].end_time === endBefore, JSON.stringify(tOps));

  // ── 离开页面 / 换周：有没存的改动先问 Save / Don't save / Cancel（B9 ⑥）──
  await setTime(slotA, "08:00");
  await evaluate("document.querySelector('[aria-label=\"Next week\"]').click();");
  check("有没存的改动时点 Next week：弹 Leave without saving?，写没存的改动", await waitFor("document.querySelector('[data-leave-dialog]')?.textContent.includes('1 change (1 time changed)')"));
  await evaluate("$btn('Cancel', document.querySelector('[data-leave-dialog]')).click();");
  check("Cancel：留在这一周，改动还在", (await waitFor("!document.querySelector('[data-leave-dialog]')")) && (await evaluate(`return location.search.includes('${P2}') && !!document.querySelector('[data-unsaved-summary]');`)));
  await evaluate("document.querySelector('[aria-label=\"Next week\"]').click();");
  await waitFor("document.querySelector('[data-leave-dialog]')");
  await evaluate("document.querySelector('[data-leave-save]').click();");
  check("Save：先存再换周", (await waitFor(`!document.querySelector('[data-leave-dialog]') && !location.search.includes('${P2}')`)) && (await changesLog()).at(-1)?.body.ops[0]?.start_time === "08:00", `${await evaluate("return location.search + ' | ' + (document.querySelector('[data-leave-dialog]')?.textContent || 'no dialog') + ' | ' + (document.querySelector('[data-save-status]')?.textContent || '');")} | ${JSON.stringify((await changesLog()).at(-1)?.body.ops)}`);
  await evaluate("document.querySelector('[aria-label=\"Previous week\"]').click();");
  await waitFor(`location.search.includes('${P2}') && ${slotA} && ${slotA}.textContent.includes('8:00 AM')`);
  await setTime(slotA, "08:15");
  await evaluate("document.querySelector('[aria-label=\"Next week\"]').click();");
  check("改了再点 Next week：又弹 Leave without saving?", await waitFor("document.querySelector('[data-leave-dialog]')"), await evaluate("return (document.querySelector('[data-unsaved-summary]')?.textContent || 'clean') + ' | ' + location.search;"));
  const nChanges = (await changesLog()).length;
  await evaluate("document.querySelector('[data-leave-discard]').click();");
  check("Don't save：不存，直接换周", (await waitFor(`!location.search.includes('${P2}')`)) && (await changesLog()).length === nChanges);

  // ── 有没存的改动时 Publish：确认框写会先存，键叫 Save and publish（B9 Q2）。这一周有空档 ⇒ 用 admin（Publish anyway）──
  await ctl({ role: "admin", meName: "" });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor(`${slotA}`);
  await setTime(slotA, "08:20");
  await evaluate("$btn('Publish').click();");
  await waitFor("document.querySelector('[role=dialog] [data-publish-unsaved]')");
  check("Publish 确认框：You have 1 unsaved change. They are saved first, then the week is published.；键 Save and publish…", await evaluate("const d = document.querySelector('[role=dialog]'); return d.querySelector('[data-publish-unsaved]').textContent.replace(/\\s+/g, ' ').includes('You have 1 unsaved change. They are saved first, then the week is published.') && !!$btn('Save and publish', d);"), await evaluate("return document.querySelector('[role=dialog]')?.textContent;"));
  const nBefore = (await changesLog()).length;
  await evaluate("$btn('Save and publish', document.querySelector('[role=dialog]')).click();");
  check("Save and publish：先 POST …/changes，再发布", (await waitFor("!document.querySelector('[role=dialog]')")) && (await changesLog()).length === nBefore + 1);

  // ── 409 stale：别人在我打开以后存过（Q7）：红字原话 + Reload / Keep editing ──
  await setTime(slotA, "08:15");
  await fetch(`${MOCK}/__bump?week=${P2}`);
  check("409 stale：红字写后端原话，带 Reload（放弃我的改动）和 Keep editing", !(await saveWeek()) && (await evaluate("const e = document.querySelector('[data-save-error]'); return e.textContent.includes('This week was changed by someone else at 8:47 PM, after you opened it.') && !!e.querySelector('[data-stale-reload]') && !!e.querySelector('[data-stale-keep]');")));
  await evaluate("document.querySelector('[data-stale-keep]').click();");
  check("Keep editing：再按 Save 用库里最新的 version，存上", await saveWeek());

  // ── 409 locked：别人占着锁（锁过期期间被别人拿走）：红字原话，改动留着 ──
  await setTime(slotA, "08:10");
  await ctl({ changesLocked: true });
  check("409 locked：红字写后端原话，改动还在", !(await saveWeek()) && (await evaluate("return document.querySelector('[data-save-error]').textContent.includes('Sam is editing this week') && !!document.querySelector('[data-unsaved-summary]');")));
  await ctl({ changesLocked: false });

  // ── 指派的员工不在职：后端 400 原话（G218 新加），那一张标红。加一个 Veronica 的新班（create 带 employee_id，排第 1 条）──
  await evaluate(`${cell("1|2026-12-09")}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add shift')`);
  await evaluate(`$btn('Add shift', ${dlg}).click();`);
  await waitFor(`${cell("1|2026-12-09")}.querySelector('[data-mark=new]')`);
  await ctl({ inactiveEmployee: 1 });
  check("员工不在职：400 红字照后端原话（Change 1: Veronica is not an active employee…）", !(await saveWeek()) && (await evaluate("return document.querySelector('[data-save-error]').textContent.includes('Change 1: Veronica is not an active employee') && !!document.querySelector('[data-slot-error]');")), await evaluate("return document.querySelector('[data-save-error]')?.textContent;"));
  await ctl({ inactiveEmployee: 0 });
  await evaluate("document.querySelector('[data-week-discard]').click();");
  await waitFor("!document.querySelector('[data-unsaved-summary]')");

  // 401：跳旧后台登录页。
  await ctl({ fail401: true, role: "superadmin" });
  await goto(`${APP}/schedule`);
  check("未登录跳旧后台登录页，带 next", await waitFor("location.pathname === '/auth/login' && location.search.includes('next=')"));
}

main();

// ── 全部按照勾选（Annie 2026-10-30 置顶 10c）B 类：Staff Schedule 开关开着按勾，关着照旧按角色，Super Admin 全过 ──
// 改 = Auto-fill 键（schedule.edit）；加人 = + Add employee（team.staff_add 和 schedule.edit 都要）；发布 = Publish 键能点（schedule.publish）。
async function runTicks() {
  const BASE = ["dashboard.view", "schedule.view"];
  const ALL = ["schedule.edit", "schedule.publish", "team.staff_add"];
  const CASES = [
    // [说明, role, 开关开着?, 勾, 能改, 能加人, 能发布]
    ["开关开着、员工没勾 ⇒ 不能改、不能加人、不能发布", "staff", true, [], false, false, false],
    ["开关开着、员工三个都勾了 ⇒ 都能", "staff", true, ALL, true, true, true],
    ["开关开着、员工只勾 schedule.edit ⇒ 能改；不能加人（还要 team.staff_add）、不能发布", "staff", true, ["schedule.edit"], true, false, false],
    ["开关开着、admin 没勾 ⇒ 都不能", "admin", true, [], false, false, false],
    ["Super Admin 没勾 ⇒ 都能", "superadmin", true, [], true, true, true],
    ["开关关着、主管 ⇒ 照旧都能", "supervisor", false, [], true, true, true],
    ["开关关着、员工勾了 ⇒ 照旧都不能", "staff", false, ALL, false, false, false],
  ];
  for (const [name, role, switchOn, codes, edit, add, publish] of CASES) {
    await ctl({ fail401: false, rulesMissing: false, changesLocked: false, inactiveEmployee: 0, role, meName: "", tick: { switchOn, codes: [...BASE, ...codes] } });
    // 2026-09-27：已发布、没有空档（有空档时只有 admin 能发布，会把「按勾」和「空档」混在一起）。
    await goto(`${APP}/schedule?week=2026-09-27`);
    await waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Next week')");
    await sleep(800);
    const got = await evaluate(`
      const bs = [...document.querySelectorAll('button')];
      const pub = bs.find((b) => /^Publish/.test(b.textContent.trim()));
      return {
        edit: bs.some((b) => b.textContent.trim() === 'Auto-fill'),
        add: bs.some((b) => b.textContent.trim() === '+ Add employee'),
        publish: !!pub && !pub.disabled,
      };`);
    check(`全部按照勾选 · Staff Schedule：${name}`, got.edit === edit && got.add === add && got.publish === publish, JSON.stringify(got));
  }
  await ctl({ role: "supervisor", meName: "", tick: null });
}
