// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /schedule（Staff Schedule，排班阶段二，拖拽版）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
// 原生 HTML5 拖拽在 headless 里不好可靠模拟，这里主要测「点人再点格子」——跟手机走的是同一套逻辑
// （见 components/schedule/week-grid.tsx 的 onPlace），测这条就等于两条路径都测了。
const { spawn } = require("child_process");
const STANDARD_SUP = require("./role-standard").STANDARD.supervisor;
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
// 拖行把手（⠿）不算名字。
const rowNames = `[...document.querySelectorAll('[data-sch-grid] .sticky')].map(e => e.textContent.replace('⠿', '').trim())`;

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
  // 空档贴着 Working hours 结尾补一句（Annie 2026-11-02 设置 preview ⑥A：一看就知道是 Working hours 卡住的）
  check("空档贴着 Working hours 结尾（Mon 10/05 5:00–9:30 PM）：Gap 后面补「(working hours end 9:30 PM)」", await evaluate("return document.querySelector('[data-gap-summary] [data-gap-edge]')?.textContent === '(working hours end 9:30 PM)';"), await evaluate("return document.querySelector('[data-gap-summary]')?.textContent;"));
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
  // 「now」竖线（Annie 11-02 Day timeline preview ③A）：看的是今天才画，刻度上写 now 7 PM，离 now 太近的整点（6 PM、8 PM）不写。
  check("Day timeline 看今天（Mon 10/05，现在 7:00 PM）：每行一条 now 竖线，刻度上写「now 7 PM」，6 PM / 8 PM 不写免得叠在一起", await waitFor("document.querySelector('[data-day-tab=\"2026-10-05\"]').getAttribute('aria-selected') === 'true' && document.querySelectorAll('[data-now-line]').length >= 2 && document.querySelector('[data-axis-step=\"2\"] [data-now-label]')?.textContent === 'now 7 PM' && !document.querySelector('[data-axis-step=\"2\"]').textContent.includes('6 PM') && !document.querySelector('[data-axis-step=\"2\"]').textContent.includes('8 PM')"), await evaluate("return document.querySelector('[data-axis-step=\"2\"]')?.textContent;"));
  check("今天跨过「现在」的那段只算后半截：现在 Mon 10/05 7:00 PM ⇒ 只剩 7:00–9:30 PM", await waitFor("document.querySelector('[data-grid-gap=\"2026-10-05\"]')?.textContent.includes('Gap 7–9:30 PM') && document.querySelector('[data-gap-summary]')?.textContent.includes('Mon 10/05 · nobody 7:00–9:30 PM')"), await evaluate("return (document.querySelector('[data-grid-gap=\"2026-10-05\"]')?.textContent || '') + ' | ' + (document.querySelector('[data-gap-summary]')?.textContent || '');"));
  await setNow("2026-09-01T00:00");
  check("换回不是今天：now 竖线和 now 字都没了", await waitFor("!document.querySelector('[data-now-line]') && !document.querySelector('[data-now-label]')"));
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
  // 时间刻度（Annie 2026-11-02「时间条上面应该有个时间线显示时间的」，preview PnnAHTzhtSGD1nQcZmiWzu）
  check("Day timeline 顶上一行刻度：电脑每 2 小时一个整点，两头写 Working hours 2 AM / 9:30 PM；手机那一行藏着", await evaluate(`
    const a = document.querySelector('[data-axis-step="2"]'), p = document.querySelector('[data-axis-step="4"]');
    const labels = [...a.querySelectorAll('span')].map((s) => s.textContent);
    return JSON.stringify(labels) === JSON.stringify(['2 AM', '4 AM', '6 AM', '8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM', '9:30 PM']) && a.offsetWidth > 0 && p.offsetWidth === 0;`), await evaluate("return [...document.querySelectorAll('[data-axis-step=\"2\"] span')].map((s) => s.textContent).join(',');"));
  check("每一行底下有每小时一条淡竖线（2:00–9:30 PM 之间 19 条）", await evaluate("const r = document.querySelector('[data-timeline-row]'); return r.querySelectorAll('[data-hour-line]').length === 19;"));

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
  // 置顶 117：Auto-fill 按 Preview 后先出 Leave 表；没新点的就直接 Continue，照原来的流程往下。
  const leaveContinue = async () => {
    if (await waitFor(`${dlg}?.querySelector('[data-autofill-leave-grid]') || ${dlg}?.textContent.includes('All these weeks are published')`, 30000))
      await evaluate(`$btn('Continue', ${dlg}).click();`);
  };
  await evaluate(`${needsSat}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add shift')`);
  check("Unassigned 的加班窗口标题写 Unassigned，默认勾上点的那一天（Sat 10/10）", await evaluate(`return ${dlg}.textContent.includes('Unassigned') && ${dlg}.querySelectorAll('[data-day][aria-pressed=true]').length === 1 && ${dlg}.querySelector('[data-day="2026-10-10"]').getAttribute('aria-pressed') === 'true';`));
  check("时间默认是工作时段 02:00 – 21:30", await evaluate(`const t = ${dlg}.querySelectorAll('input[data-time-input]'); return t[0].dataset.value === '02:00' && t[1].dataset.value === '21:30';`));
  await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.trim() === 'Mid').click();`);
  check("加班弹窗的 Add shift 只是先排在周表上（整周 Save 才存）⇒ 灰绿添加键（Annie 2026-10-30）", await evaluate(`return getComputedStyle($btn('Add shift', ${dlg})).backgroundColor === 'rgb(107, 142, 116)';`));
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
  // 测试用的人（Annie 2026-10-30「不要把这两个人显示在dashbroad里」，选 A）：勾「Test person — hidden from Dashboard」
  check("Employees 框每个人一个勾「Test person — hidden from Dashboard」，默认不勾", await evaluate(`const r = ${empRow(4)}; const c = r.querySelector('[data-test-person]'); return !!c && !c.checked && r.textContent.includes('Test person — hidden from Dashboard');`));
  let tpFrom = (await mockLog()).length;
  await evaluate(`${empRow(4)}.querySelector('[data-test-person]').click();`);
  check("勾上 Jing：PUT {is_test:true}，名字旁出灰色 Test 标签（不是蓝色）", (await waitFor(`${empRow(4)}.querySelector('[data-test-person]').checked && !!${empRow(4)}.querySelector('[data-test-tag]')`)) && JSON.stringify((await since(tpFrom, (e) => e.method === "PUT" && e.path === "/api/schedule/employees/4"))[0]?.body) === '{"is_test":true}' && (await evaluate(`return !getComputedStyle(${empRow(4)}.querySelector('[data-test-tag]')).color.includes('59, 130, 246');`)));
  await evaluate("$btn('Close', document.querySelector('[role=dialog]')).click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  check("排班表上 Jing 照常显示，名字旁一个 Test；她的班不算覆盖 ⇒ 周一 5:00–9:30 PM 出空档", (await waitFor(`[...document.querySelectorAll('[data-sch-grid] .sticky')].some((r) => r.textContent.includes('Jing') && !!r.querySelector('[data-test-tag]')) && !!document.querySelector('[data-grid-gap="2026-10-05"]')`)) && (await evaluate("return document.querySelector('[data-grid-gap=\"2026-10-05\"]').textContent.includes('Gap 5–9:30 PM');")), await evaluate("return document.querySelector('[data-grid-gap=\"2026-10-05\"]')?.textContent;"));
  await evaluate("$btn('Employees').click();");
  await waitFor(`${empRow(4)}`);
  await evaluate(`${empRow(4)}.querySelector('[data-test-person]').click();`);
  await waitFor(`!${empRow(4)}.querySelector('[data-test-person]').checked`);
  await evaluate("$btn('Close', document.querySelector('[role=dialog]')).click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  check("取消勾：Test 标签没了，周一的空档也没了", await waitFor("![...document.querySelectorAll('[data-sch-grid] [data-test-tag]')].length && !document.querySelector('[data-grid-gap=\"2026-10-05\"]')"));

  // 不算值班人头（Annie 2026-11-02「Anita不算的」「把Anita从统计中拿出来」）：Employees 每人一个勾 Counts toward coverage，默认勾上。
  await evaluate("$btn('Employees').click();");
  await waitFor(`${empRow(5)}`);
  check("Employees 框每个人一个勾「Counts toward coverage」，默认勾上（字段没带 = 算）", await evaluate(`return [1,2,3,4,5].every((id) => { const c = document.querySelector('[role=dialog] [data-employee-row="' + id + '"] [data-counts-coverage]'); return !!c && c.checked; }) && ${empRow(5)}.textContent.includes('Counts toward coverage');`));
  let ncFrom = (await mockLog()).length;
  await evaluate(`${empRow(5)}.querySelector('[data-counts-coverage]').click();`);
  check("取消 Anita：PUT {counts_for_coverage:false}，名字旁出琥珀色 Not counted", (await waitFor(`!${empRow(5)}.querySelector('[data-counts-coverage]').checked && !!${empRow(5)}.querySelector('[data-not-counted-tag]')`)) && JSON.stringify((await since(ncFrom, (e) => e.method === "PUT" && e.path === "/api/schedule/employees/5"))[0]?.body) === '{"counts_for_coverage":false}');
  await evaluate("$btn('Close', document.querySelector('[role=dialog]')).click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  check("排班表：Anita 名字旁 Not counted、她的班卡变淡虚线；周六只有她的 2:00–11:30 AM 出空档", (await waitFor(`!!document.querySelector('[data-grid-gap="2026-10-10"]')`)) && (await evaluate(`const row = [...document.querySelectorAll('[data-sch-grid] .sticky')].find((r) => r.textContent.includes('Anita')); const card = ${cell("5|2026-10-10")}.querySelector('[data-slot-id]'); return !!row.querySelector('[data-not-counted-tag]') && card.dataset.notCounted === 'true' && card.className.includes('border-dashed') && document.querySelector('[data-grid-gap="2026-10-10"]').textContent.includes('Gap 2–11:30 AM');`)), await evaluate("return document.querySelector('[data-grid-gap=\"2026-10-10\"]')?.textContent;"));
  await evaluate("document.querySelector('[data-day-tab=\"2026-10-10\"]').click();");
  // Annie 11-02「我已经说过Anite不参加gap，为什么她的时间仍然出来在时间条里」（preview PnnAHTzhtSGD1nQcZmiWzu ①②A）
  check("Day timeline 周六：Anita 不在时间条里，下面灰字「Not shown (don't count toward coverage): Anita 2:00 AM – 12:00 PM」（她的班）；多一行 Nobody 2:00 AM – 11:30 AM", await waitFor("!document.querySelector('[data-timeline-row=\"5\"]') && document.querySelector('[data-not-shown]')?.textContent === \"Not shown (don't count toward coverage): Anita 2:00 AM – 12:00 PM\" && [...document.querySelectorAll('[data-nobody-row]')].some((r) => r.textContent.includes('2:00 AM') && r.textContent.includes('11:30 AM'))"), await evaluate("return document.querySelector('[data-not-shown]')?.textContent;"));
  await evaluate("$btn('Employees').click();");
  await waitFor(`${empRow(5)}`);
  await evaluate(`${empRow(5)}.querySelector('[data-counts-coverage]').click();`);
  await waitFor(`${empRow(5)}.querySelector('[data-counts-coverage]').checked`);
  await evaluate("$btn('Close', document.querySelector('[role=dialog]')).click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  check("勾回去：Not counted 没了，周六的空档也没了，Anita 回到时间条里、灰字没了", await waitFor("!document.querySelector('[data-sch-grid] [data-not-counted-tag]') && !document.querySelector('[data-grid-gap=\"2026-10-10\"]') && !document.querySelector('[data-not-shown]') && !!document.querySelector('[data-timeline-row=\"5\"]')"));
  await evaluate("$btn('Employees').click();");
  await waitFor(`${empRow(5)}`);
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
  // Annie 2026-10-30「那你要提醒发送人这个班一点都没有变啊，不能静默处理」：整周没变（has_unsent_changes = false）时确认框先说不会通知谁，键照旧能按
  check("整周没变时 Publish again 确认框：写 Nothing has changed since the last publish, so no one will be notified.，Publish again 照旧能按", await evaluate("const d = document.querySelector('[role=dialog]'); const n = d.querySelector('[data-publish-nothing-changed]'); return !!n && n.textContent.replace(/\\s+/g, ' ').trim() === 'Nothing has changed since the last publish, so no one will be notified.' && !$btn('Publish again', d).disabled;"));
  await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
  check("按完（后端带 nothing_changed: true）：写 Nothing has changed since the last publish, so no one was notified.，不写 Notified 0", await waitFor("document.body.innerText.includes('Nothing has changed since the last publish, so no one was notified.') && !document.body.innerText.includes('Notified 0')"));
  // 旧后端（没有 nothing_changed）：照旧那句
  await ctl({ noNothingChanged: true });
  await evaluate("$btn('Publish again').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  await evaluate("$btn('Publish again', document.querySelector('[role=dialog]')).click();");
  check("旧后端没带 nothing_changed：照旧写「Published again. No one's shifts or time off changed, so no one was notified.」，不写 Notified 0", await waitFor("document.body.innerText.includes(\"Published again. No one's shifts or time off changed, so no one was notified.\") && !document.body.innerText.includes('Notified 0')"));
  await ctl({ noNothingChanged: false });

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

  // ── 每个人的往来记录（Annie 2026-10-30「动手」，preview T98GQ9KfQuQfrEcMv6XgzM；后端 ef 约定形状，mock）──
  {
    const KINDS = ["confirm_sent", "answered", "changes_sent", "answer_reset", "answered", "requested", "approved", "declined", "published", "republished"];
    const kindsIn = (root) => `[...${root}.querySelectorAll('[data-history-event]')].map(e => e.dataset.historyEvent)`;
    await ctl({ history: true, jingAnswer: "accepted" });
    await openPage(`${APP}/schedule?week=2026-10-04`);
    await waitFor(`document.querySelector('[data-send-to-confirm="4"]')`);
    await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
    await waitFor(`${DLG} && ${DLG}.querySelector('[data-history-event]')`);
    check(
      "往来记录（位置 A）：发送框里改动表下面、发送原文上面；标题 History with Jing · week of 2026-10-04 · newest at the bottom",
      await evaluate(`const d = ${DLG}; const h = d.querySelector('[data-history]'); const t = d.querySelector('[data-change-row]'); const p = d.querySelector('[data-send-preview]'); return !!h && !!(t.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(h.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) && h.textContent.startsWith('History with Jing · week of 2026-10-04newest at the bottom');`),
    );
    check("从旧到新、最新的在最下面（后端给的顺序照排）", JSON.stringify(await evaluate(`return ${kindsIn(DLG)};`)) === JSON.stringify(KINDS), JSON.stringify(await evaluate(`return ${kindsIn(DLG)};`)));
    check("打开时滚到最下面", await evaluate(`const h = ${DLG}.querySelector('[data-history]'); return h.scrollHeight <= h.clientHeight || h.scrollTop + h.clientHeight >= h.scrollHeight - 2;`));
    {
      const texts = await evaluate(`return [...${DLG}.querySelectorAll('[data-history-event]')].map(e => e.querySelector('[data-history-who]').firstChild.textContent + ' | ' + e.querySelector('[data-history-tag]').textContent + ' | ' + e.querySelector('[data-history-body]').innerText.replace(/\\s+/g, ' ').trim());`);
      const want = [
        ["confirm_sent", "System | system | Sent the weekly confirm (email + in-app): Please confirm your schedule — week of 2026-10-04"],
        ["answered", "Jing | staff | Looks good · from the link"],
        ["changes_sent", "Annie Z | supervisor | Sent to confirm (email + in-app): Mon 11/2: Open 2:00 AM – 12:00 PM → Open 2:00 AM – 11:45 AM Not delivered: in-app"],
        ["answer_reset", "Annie Z | supervisor | Jing’s Looks good was reset to No answer."],
        ["answered", "Jing | staff | Send my changes · logged in"],
        ["requested", "Jing | staff | Asked for Wed 10/7 Mid · logged in"],
        ["approved", "Max | supervisor | Approved Wed 10/7 Mid"],
        ["declined", "Max | supervisor | Declined Fri 10/9 Close"],
        ["published", "Annie Z | supervisor | Published (email). Jing got: Your schedule — week of 2026-10-04"],
        ["republished", "Annie Z | supervisor | Published again (email + in-app). Jing got: Your schedule changed — week of 2026-10-04 Mon 11/2: Open 2:00 AM – 12:00 PM → Open 2:00 AM – 11:45 AM Wed 11/4: not scheduled → Mid 10:00 AM – 6:00 PM"],
      ];
      const bad = want.filter(([, w], i) => texts[i] !== w);
      check("9 种记录的文字（英文）：发的写渠道和原文、回的写 Looks good / Send my changes 和从哪进来、主管写 Approved / Declined 哪天哪个班、重置一句灰字、没发出去的红字", bad.length === 0, JSON.stringify(bad.map(([k, w]) => [k, w, texts[want.findIndex((x) => x[1] === w)]])));
    }
    check(
      "颜色：员工本人那几条绿底、标签 system 灰 / staff 绿 / supervisor 蓝；Looks good / Approved 绿、Send my changes / Asked for 琥珀、Declined / Not delivered 红",
      await evaluate(`
        const d = ${DLG}; const ev = [...d.querySelectorAll('[data-history-event]')];
        const bg = (e) => getComputedStyle(e).backgroundColor; const col = (e) => e && getComputedStyle(e).color;
        const word = (e, w) => [...e.querySelectorAll('span')].find(s => s.textContent === w);
        const mine = ev.filter(e => e.dataset.byKind === 'employee');
        const tags = Object.fromEntries(ev.map(e => [e.dataset.byKind, col(e.querySelector('[data-history-tag]'))]));
        return mine.length === 3 && mine.every(e => bg(e) === 'rgb(242, 248, 246)') && ev.filter(e => e.dataset.byKind !== 'employee').every(e => bg(e) !== 'rgb(242, 248, 246)')
          && tags.system === 'rgb(71, 85, 105)' && tags.employee === 'rgb(15, 118, 110)' && tags.staff === 'rgb(24, 95, 165)'
          && col(word(ev[1], 'Looks good')) === 'rgb(21, 128, 61)' && col(word(ev[6], 'Approved')) === 'rgb(21, 128, 61)'
          && col(word(ev[4], 'Send my changes')) === 'rgb(186, 117, 23)' && col(word(ev[5], 'Asked for')) === 'rgb(186, 117, 23)'
          && col(word(ev[7], 'Declined')) === 'rgb(163, 45, 45)' && col(ev[2].querySelector('[data-history-failed]')) === 'rgb(163, 45, 45)';`),
    );
    // 发出去以后：重读，最新那条（这次的 changes_sent + 重置）排在最下面
    await evaluate(`${DLG}.querySelector('[data-send-changes-go]').click();`);
    await waitFor(`${DLG}?.querySelector('[data-send-ok]')`);
    check("发送成功：记录重读，最下面是这次的 Sent to confirm 和 Looks good 被重置", await waitFor(`(() => { const k = ${kindsIn(DLG)}; return k.length === ${KINDS.length + 2} && k[k.length - 2] === 'changes_sent' && k[k.length - 1] === 'answer_reset'; })()`), JSON.stringify(await evaluate(`return ${kindsIn(DLG)};`)));
    await evaluate(`$btn('Close', ${DLG}).click();`);

    // 位置 B：Responses 卡每人一行 History (N)，点开在下面展开，再点收起
    const histBefore = (await mockLog()).length;
    await openPage(`${APP}/schedule?week=2026-10-04`);
    await waitFor(`document.querySelector('[data-history-toggle="4"]')`);
    await sleep(800);
    check("History (N) 直接用 confirmations 的 history_count：打开页面不逐人读记录（Annie 2026-10-31 嫌慢）", (await mockLog()).slice(histBefore).filter((e) => /\/employees\/\d+\/history$/.test(e.path)).length === 0, JSON.stringify((await mockLog()).slice(histBefore).filter((e) => e.path.endsWith("/history")).map((e) => e.path)));
    const toggles = await evaluate(`return [...document.querySelectorAll('[data-history-toggle]')].map(b => [b.dataset.historyToggle, b.textContent]);`);
    check("Responses 卡：每人一行一个 History (N)（N = 记录条数，没有的写 0），不是蓝色键", toggles.length >= 2 && toggles.some(([id, t]) => id === "4" && t === `History (${KINDS.length + 2})`) && toggles.filter(([id]) => id !== "4").every(([, t]) => t === "History (0)") && (await evaluate(`return getComputedStyle(document.querySelector('[data-history-toggle="4"]')).backgroundColor !== 'rgb(59, 130, 246)';`)), JSON.stringify(toggles));
    await evaluate(`document.querySelector('[data-history-toggle="4"]').click();`);
    await waitFor(`document.querySelector('[data-history-row="4"] [data-history-event]')`);
    check("点开：这一人下面整行展开，同一份记录（同样的顺序），键变 Hide history", JSON.stringify(await evaluate(`return ${kindsIn("document.querySelector('[data-history-row=\"4\"]')")};`)) === JSON.stringify([...KINDS, "changes_sent", "answer_reset"]) && (await evaluate(`return document.querySelector('[data-history-toggle="4"]').textContent === 'Hide history';`)));
    await evaluate(`document.querySelector('[data-history-toggle="4"]').click();`);
    check("再点：收起", await waitFor(`!document.querySelector('[data-history-row="4"]')`));
    check("点开才读这个人的记录：只读了 Jing（4）一次", JSON.stringify((await mockLog()).slice(histBefore).filter((e) => e.path.endsWith("/history")).map((e) => e.path)) === JSON.stringify(["/api/schedule/weeks/2026-10-04/employees/4/history"]), JSON.stringify((await mockLog()).slice(histBefore).filter((e) => e.path.endsWith("/history")).map((e) => e.path)));
    // 旧后端没带 history_count：照旧一进来逐人读、算出 N
    await ctl({ noHistoryCount: true });
    await openPage(`${APP}/schedule?week=2026-10-04`);
    check("旧后端（没有 history_count）：照旧逐人读，Jing 还是 History (N)", await waitFor(`(document.querySelector('[data-history-toggle="4"]')?.textContent || '') === 'History (${KINDS.length + 2})'`));
    await ctl({ noHistoryCount: false });
    const other = toggles.find(([id]) => id !== "4")[0];
    await evaluate(`document.querySelector('[data-history-toggle="${other}"]').click();`);
    check("没有记录的人：展开写一句灰字 Nothing yet for this week.", await waitFor(`(document.querySelector('[data-history-row="${other}"] [data-history-empty]')?.textContent || '').startsWith('Nothing yet for this week.')`));

    // G138 新的 5 种（4e 2026-10-30 晚：change_requested move / add、swap_requested、swap_agreed、swap_declined_by_peer、request_closed_on_publish）
    await ctl({ historyG138: true });
    await openPage(`${APP}/schedule?week=2026-10-04`);
    await waitFor(`document.querySelector('[data-history-toggle="3"]')`);
    await evaluate(`document.querySelector('[data-history-toggle="3"]').click();`);
    await waitFor(`document.querySelectorAll('[data-history-row="3"] [data-history-event]').length === 11`);
    {
      const t = await evaluate(`return [...document.querySelectorAll('[data-history-row="3"] [data-history-event]')].map(e => e.dataset.historyEvent + ' | ' + e.querySelector('[data-history-body]').innerText.replace(/\\s+/g, ' ').trim());`);
      const want = [
        "change_requested | Asked to move Thu 10/8 Close to Fri 10/9 · logged in",
        "change_requested | Asked for an extra shift Wed 10/7 Open · logged in",
        "swap_requested | Asked to swap Sun 10/4 Close ↔ Veronica’s Thu 10/8 Close · waiting for Veronica",
        "swap_agreed | Agreed to swap Thu 10/8 Close ↔ Nadia’s Sun 10/4 Close · waiting for approval",
        "swap_declined_by_peer | Declined the swap Mon 10/5 Mid ↔ Nadia’s Tue 10/6 Close",
        "request_closed_on_publish | Request closed when the week was published: Wed 10/7 Open.",
        "approved | Approved the move to Fri 10/9",
        "declined | Declined the swap",
        "approved | Approved the swap: Nadia’s Sun 10/4 Close ↔ Veronica’s Thu 10/8 Close",
        "declined | Declined the move Thu 10/8 Close to Fri 10/9",
        "request_closed_on_publish | Request closed when the week was published: swap Nadia’s Sun 10/4 Close ↔ Veronica’s Thu 10/8 Close.",
      ];
      check("History（G138）：换班 / 改天上 / 加班 / 发布时关掉，5 种新记录照英文写清楚", JSON.stringify(t) === JSON.stringify(want), JSON.stringify(t));
      check("History（G138）：Asked 琥珀色、Agreed 绿、Declined 红；系统关掉的灰字", await evaluate(`const ev = [...document.querySelectorAll('[data-history-row="3"] [data-history-event]')]; const col = (e, w) => getComputedStyle([...e.querySelectorAll('span')].find(s => s.textContent === w)).color; return col(ev[2], 'Asked to swap') === 'rgb(186, 117, 23)' && col(ev[3], 'Agreed to swap') === 'rgb(21, 128, 61)' && col(ev[4], 'Declined the swap') === 'rgb(163, 45, 45)' && ev[5].dataset.byKind === 'system';`));
    }
    await ctl({ historyG138: false });

    // 读不到：红字写后端原话
    await ctl({ historyFail: "ZZ Test history is down." });
    await openPage(`${APP}/schedule?week=2026-10-04`);
    await waitFor(`document.querySelector('[data-history-toggle="4"]')`);
    await evaluate(`document.querySelector('[data-history-toggle="4"]').click();`);
    check("History 读不到：红字 Could not load the history: + 后端原话", await waitFor(`(() => { const e = document.querySelector('[data-history-row="4"] [data-history-error]'); return !!e && e.textContent === 'Could not load the history: ZZ Test history is down.' && getComputedStyle(e).color === 'rgb(163, 45, 45)'; })()`));
    await ctl({ historyFail: "" });

    // 没有 schedule.edit（staff）：没有 History 键
    await ctl({ role: "staff" });
    await openPage(`${APP}/schedule?week=2026-10-04`);
    await sleep(1500);
    check("staff（不能改排班）：没有 History 键、没有记录", await evaluate("return !document.querySelector('[data-history-toggle]') && !document.querySelector('[data-history]');"));
    await ctl({ role: "supervisor" });

    // 后端还没上（404）：两处都不出，也不报错
    await ctl({ history: false });
    await openPage(`${APP}/schedule?week=2026-10-04`);
    await waitFor(`document.querySelector('[data-responses]')`);
    await sleep(800);
    check("后端还没上（404）：Responses 卡没有 History 键", await evaluate("return !document.querySelector('[data-history-toggle]') && !document.querySelector('[data-history-error]');"));
    await evaluate(`document.querySelector('[data-send-to-confirm="4"]').click();`);
    await waitFor(DLG);
    await sleep(600);
    check("后端还没上（404）：发送框里也没有记录、不报错", await evaluate(`return !${DLG}.querySelector('[data-history]') && !${DLG}.querySelector('[data-history-error]');`));
    await evaluate(`$btn('Cancel', ${DLG}).click();`);
  }
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
  // 置顶 109 W4 第二段：没联系方式（后端 no_contact）= 灰字、不算失败；发失败（failed）= 红字
  await republishWith("11:30", { notReached: { 4: "no email or login" } });
  check(
    "没联系方式：绿字「Published again. Notified 2 schedule editors.」，后面灰字「No email or login: Jing.」，没有红字",
    await evaluate("const b = document.querySelector('[data-publish-banner]'); const ok = b.querySelector('[data-publish-ok]'); const g = b.querySelector('[data-publish-no-contact]'); return b.dataset.publishBanner === 'some-missed' && ok.textContent === 'Published again. Notified 2 schedule editors.' && !!g && g.textContent === 'No email or login: Jing.' && g.className.includes('text-white/55') && !b.querySelector('[data-publish-unreached]');"),
    await evaluate("return document.querySelector('[data-publish-banner]')?.innerText;"),
  );
  await republishWith("11:35", { notReached: { 4: "email could not be sent" } });
  check(
    "发失败：后面红字「1 couldn't be reached: Jing (email could not be sent).」，没有灰字",
    await evaluate("const b = document.querySelector('[data-publish-banner]'); const ok = b.querySelector('[data-publish-ok]'); const r = b.querySelector('[data-publish-unreached]'); return b.dataset.publishBanner === 'some-missed' && !!r && r.textContent === \"1 couldn't be reached: Jing (email could not be sent).\" && getComputedStyle(r).color !== getComputedStyle(ok).color && r.className.includes('text-red') && !b.querySelector('[data-publish-no-contact]');"),
    await evaluate("return document.querySelector('[data-publish-banner]')?.innerText;"),
  );
  await republishWith("11:40", { notReached: { 4: "no email or login" }, legacyNotReached: true });
  check(
    "旧后端（只有 not_reached）：按 reason 拆，没联系方式照样灰字「No email or login: Jing.」",
    await evaluate("const b = document.querySelector('[data-publish-banner]'); const g = b.querySelector('[data-publish-no-contact]'); return !!g && g.textContent === 'No email or login: Jing.' && !b.querySelector('[data-publish-unreached]');"),
    await evaluate("return document.querySelector('[data-publish-banner]')?.innerText;"),
  );
  await ctl({ legacyNotReached: false });
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
  check("红字写后端原话、逐段写哪天几点 + 哪个改动造成的（Mon 10/05, 2:00–11:15 AM is not covered — caused by your change to Veronica's Open shift.），Not saved yet 留着", await evaluate("const e = document.querySelector('[data-save-error]').textContent; return e.includes(\"This change would leave a gap in coverage, so it wasn't saved.\") && e.includes(\"Mon 10/05, 2:00–11:15 AM is not covered — caused by your change to Veronica's Open shift.\") && !!document.querySelector('[data-unsaved-summary]');"), await evaluate("return document.querySelector('[data-save-status]')?.textContent;"));
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
  await evaluate("const d = document.querySelector('[role=dialog]'); if (d) $btn('Cancel', d).click();");
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
  // 不算值班人头只在管理面标（Annie 11-02「Anita-not counted只在管理面出现，员工界面不要显示这个说明，就放正常的名字就好」）。
  await ctl({ role: "supervisor" });
  await fetch(`${MOCK}/api/schedule/employees/5`, { method: "PUT", body: JSON.stringify({ counts_for_coverage: false }) });
  await ctl({ role: "staff" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor(`${cell("5|2026-10-10")}?.querySelector('[data-slot-id]')`);
  check("staff：Anita 设成不算人头，员工看到的排班表 / Day timeline 只有正常名字，没有 Not counted、班卡和条子照常", await evaluate("return !document.querySelector('[data-not-counted-tag]') && !document.querySelector('[data-not-counted]') && !document.body.innerText.includes('not counted') && !document.body.innerText.includes('Not counted') && [...document.querySelectorAll('[data-sch-grid] .sticky')].some((r) => r.textContent.trim() === 'Anita');"));
  await evaluate("document.querySelector('[data-day-tab=\"2026-10-10\"]').click();");
  check("staff：Day timeline 周六 Anita 照常在时间条里，没有「Not shown」灰字（Annie：员工界面不显示这个说明）", await waitFor("!!document.querySelector('[data-timeline-row=\"5\"]') && !document.querySelector('[data-not-shown]')"));
  await ctl({ role: "supervisor" });
  await fetch(`${MOCK}/api/schedule/employees/5`, { method: "PUT", body: JSON.stringify({ counts_for_coverage: true }) });
  await ctl({ role: "staff" });
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

  // ── 工作时段在 ⚙ Settings 里改（Annie 2026-11-02 preview 97MgNcpw28p7W4DxXmpgrM）；能改照 settings.schedule 勾 ──
  await ctl({ role: "admin", tick: { switchOn: false, codes: STANDARD_SUP.filter((c) => c !== "settings.schedule") } });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor("document.querySelector('[data-open-settings]')");
  await evaluate("document.querySelector('[data-open-settings]').click();");
  await waitFor("document.querySelector('[data-schedule-settings]')");
  check("没勾 settings.schedule：⚙ Settings 里工作时段只读，没有输入框、没有 Save", await evaluate("const d = document.querySelector('[data-schedule-settings]'); return !d.querySelector('input') && !d.querySelector('[data-settings-save]');"));
  await ctl({ role: "superadmin", tick: null });
  await openPage(`${APP}/schedule?week=2026-10-11`);
  await waitFor("document.querySelector('[data-open-settings]')");
  await evaluate("document.querySelector('[data-open-settings]').click();");
  await waitFor("document.querySelector('[data-schedule-settings] input[aria-label=\"Working hours start\"]')");
  await evaluate(`$setValue(document.querySelector('[data-schedule-settings] input[aria-label="Working hours start"]'), '03:00');`);
  await waitFor("!document.querySelector('[data-settings-save]').disabled");
  await evaluate("document.querySelector('[data-settings-save]').click();");
  await waitFor("!!document.querySelector('[data-settings-saved]')");
  await evaluate("$btn('Close', document.querySelector('[data-schedule-settings]')).click();");
  check("superadmin 在 ⚙ Settings 改工作时段后立即生效（Day timeline 卡头变成 3:00 AM）", await waitFor("document.querySelector('[data-working-hours]')?.textContent.includes('3:00 AM')"));

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

  // ───────── 置顶 110（Annie「110动手」，题 1–8 全 A）─────────
  const putRules = async (rules) => (await fetch(`${MOCK}/api/schedule/rules`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, rules }) })).ok;
  const getRules = async () => (await (await fetch(`${MOCK}/api/schedule/rules`)).json()).rules;
  const rulesTab = async () => {
    await openPage(`${APP}/schedule?week=2026-10-11`);
    await waitFor(`${cell("1|2026-10-11")} && [...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Rules')`);
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Rules').click();");
    await waitFor("document.querySelector('[data-rules-view]')");
  };
  // ① 新规则 Max people on a shift：Every shift、最多 1 人 ⇒ 存的是 {max: 1}（不带 shift_type，后端 40 核过的形状）
  await evaluate("$btn('Add rule').click();");
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add rule')`);
  await evaluate(`$setValue(${dlg}.querySelector('select[aria-label="Rule type"]'), 'max_per_shift_day');`);
  await waitFor(`${dlg}.querySelector('input[aria-label="max"]')`);
  check("110 ①：类型下拉有 Max people on a shift；Shift 默认 Every shift、At most 1；预览 Every shift: at most 1 person a day, every day", await evaluate(`const sh = ${dlg}.querySelector('select[aria-label="Shift"]'); return sh.options[sh.selectedIndex].text === 'Every shift' && ${dlg}.querySelector('input[aria-label="max"]').value === '1' && ${dlg}.querySelector('[data-rule-preview]').textContent === 'Every shift: at most 1 person a day, every day';`), await evaluate(`return ${dlg}.querySelector('[data-rule-preview]')?.textContent;`));
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  await waitFor(`!${dlg} && document.querySelector('[data-rules-view]').textContent.includes('Every shift: at most 1 person a day')`);
  let saved = (await getRules()).find((r) => r.type === "max_per_shift_day");
  check("110 ①：存的形状 {max: 1}，没有 shift_type、没有 days", !!saved && JSON.stringify(saved.params) === '{"max":1}', JSON.stringify(saved));

  // 题 8 A：Coverage Close 至少 2 跟 Max people 最多 1 打架 ⇒ 两条下面各一行琥珀字；改规则弹窗里也写，不拦
  const conflictRules = [...fullRules.map((x) => (x.id === "c2" ? R("c2", "coverage", { shift_type: "close", min: 2 }) : x)), R("m1", "max_per_shift_day", { max: 1 }), R("m2", "max_per_shift_day", { shift_type: "close", max: 2, days: [6] })];
  check("（存一套打架的规则）", await putRules(conflictRules));
  await rulesTab();
  check("题 8 A：Coverage 下面琥珀字 Conflicts with “Max people on a shift” (at most 1 Close)…；Max people 下面 Conflicts with “Coverage” (at least 2 Close).", await evaluate(`const c = document.querySelector('[data-rule-conflict="c2"]'), m = document.querySelector('[data-rule-conflict="m1"]'); return !!c && c.textContent === 'Conflicts with “Max people on a shift” (at most 1 Close). Auto-fill places at most 1 and lists the shortfall.' && !!m && m.textContent === 'Conflicts with “Coverage” (at least 2 Close).' && getComputedStyle(c).color === 'rgb(252, 211, 77)';`), await evaluate("return [...document.querySelectorAll('[data-rule-conflict]')].map(e => e.dataset.ruleConflict + ':' + e.textContent).join(' | ');"));
  check("题 8 A：同一种班两条 Max people ⇒ 大的那条写 Auto-fill uses the smaller number (1)", await evaluate(`const t = [...document.querySelectorAll('[data-rule-conflict="m2"]')].map(e => e.textContent).join('|'); return t.includes('Another rule also limits Close on Sat. Auto-fill uses the smaller number (1).');`), await evaluate(`return [...document.querySelectorAll('[data-rule-conflict="m2"]')].map(e => e.textContent).join('|');`));
  await evaluate(`$btn('Edit', document.querySelector('[data-rule-row="c2"]')).click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Edit rule')`);
  check("题 8 A：改规则弹窗里同一句琥珀字，Save rule 照样能按", await evaluate(`const n = ${dlg}.querySelector('[data-rule-dialog-conflict]'); return !!n && n.textContent.startsWith('Conflicts with “Max people on a shift”') && !$btn('Save rule', ${dlg}).disabled;`));
  await evaluate(`$btn('Cancel', ${dlg}).click();`);
  await waitFor(`!${dlg}`);

  // ② 题 7 A：Who 下拉三选一；Everyone except ⇒ 存 exclude_employee_ids；没点人 ⇒ 提示先点人
  check("（规则恢复）", await putRules(fullRules));
  await rulesTab();
  await evaluate("$btn('Add rule').click();");
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add rule')`);
  await evaluate(`$setValue(${dlg}.querySelector('select[aria-label="Rule type"]'), 'min_days_on_shift');`);
  await waitFor(`${dlg}.querySelector('select[aria-label="Who"]')`);
  check("题 7 A：Who 下拉 Everyone / Only these people / Everyone except", await evaluate(`return [...${dlg}.querySelector('select[aria-label="Who"]').options].map(o => o.text).join('|') === 'Everyone|Only these people|Everyone except';`));
  await evaluate(`$setValue(${dlg}.querySelector('select[aria-label="Who"]'), 'except');`);
  await waitFor(`${dlg}.textContent.includes('Leave out')`);
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  check("题 7：Everyone except 但一个都没点 ⇒ 红字 Pick at least one person.，不发请求", await waitFor(`${dlg}?.querySelector('[role=alert]')?.textContent === 'Pick at least one person.'`));
  await evaluate(`[...${dlg}.querySelectorAll('button[aria-pressed]')].find(b => b.textContent === 'Anita').click();`);
  await sleep(100);
  check("题 7：预览 Everyone except Anita works at least 2 Open days per week", await evaluate(`return ${dlg}.querySelector('[data-rule-preview]').textContent.startsWith('Everyone except Anita works at least 2');`), await evaluate(`return ${dlg}.querySelector('[data-rule-preview]').textContent;`));
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  await waitFor(`!${dlg}`);
  saved = (await getRules()).find((r) => r.type === "min_days_on_shift");
  check("题 7：存 exclude_employee_ids: [5]，没有 employee_id / employee_ids", !!saved && JSON.stringify(saved.params.exclude_employee_ids) === "[5]" && !("employee_id" in saved.params) && !("employee_ids" in saved.params), JSON.stringify(saved));

  // 旧规则（employee_id）打开 ⇒ Only these people [那个人]，存的时候换成 employee_ids
  check("（存一条旧写法的 min_days_on_shift）", await putRules([...fullRules, R("k9", "min_days_on_shift", { employee_id: 2, shift_type: "close", n: 2, per: "week" })]));
  await rulesTab();
  await evaluate(`$btn('Edit', document.querySelector('[data-rule-row="k9"]')).click();`);
  await waitFor(`${dlg} && ${dlg}.querySelector('select[aria-label="Who"]')`);
  check("旧规则 employee_id：打开是 Only these people、Lizzie 选上", await evaluate(`return ${dlg}.querySelector('select[aria-label="Who"]').value === 'only' && [...${dlg}.querySelectorAll('button[aria-pressed=true]')].some(b => b.textContent === 'Lizzie');`));
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  await waitFor(`!${dlg}`);
  saved = (await getRules()).find((r) => r.id === "k9");
  check("旧规则存回去：employee_ids: [2]，employee_id 去掉", JSON.stringify(saved?.params.employee_ids) === "[2]" && !("employee_id" in (saved?.params ?? {})), JSON.stringify(saved));

  // 题 6 A + 题 3 A：手动排班不拦，只标出——Lizzie、Nadia 都排周一 Close（最多 1）；Veronica 周一到周五 8:30–5:00 = 42.5 小时（提醒 40）
  check("（存 Max people 1 + Weekly hours alert 40）", await putRules([...fullRules, R("m1", "max_per_shift_day", { max: 1 }), R("h1", "weekly_hours_alert", { hours: 40 })]));
  const W = "2026-12-06";
  const D = (n) => `2026-12-${String(6 + n).padStart(2, "0")}`;
  const bulk = await fetch(`${MOCK}/api/schedule/weeks/${W}/slots/bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replace: true, slots: [
    ...[1, 2, 3, 4, 5].map((n) => ({ date: D(n), shift_type: "mid", start_time: "08:30", end_time: "17:00", employee_id: 1 })),
    { date: D(1), shift_type: "close", start_time: "13:30", end_time: "21:30", employee_id: 2 },
    { date: D(1), shift_type: "close", start_time: "13:30", end_time: "21:30", employee_id: 3 },
  ] }) });
  check("（建一周测试班）", bulk.ok, String(bulk.status));
  await openPage(`${APP}/schedule?week=${W}`);
  await waitFor(`${cell(`1|${D(1)}`)}`);
  check("题 6 A：周一日期下面琥珀一行 Close 2 (max 1)；别的日子没有", await waitFor(`document.querySelector('[data-over-cap="${D(1)}|close"]')?.textContent.trim() === 'Close 2 (max 1)' && document.querySelectorAll('[data-over-cap]').length === 1`), await evaluate("return [...document.querySelectorAll('[data-over-cap]')].map(e => e.dataset.overCap + ':' + e.textContent).join('|');"));
  check("题 6 A：那两张 Close 卡琥珀框（outline #f59e0b），Mid 卡没有", await evaluate(`const c = [...document.querySelectorAll('[data-slot-over-cap]')]; return c.length === 2 && c.every(x => getComputedStyle(x).outlineColor === 'rgb(245, 158, 11)') && ![...${cell(`1|${D(1)}`)}.querySelectorAll('[data-slot-id]')].some(x => x.dataset.slotOverCap);`), await evaluate("return document.querySelectorAll('[data-slot-over-cap]').length;"));
  check("题 3 A：Veronica 名字下面琥珀字 42.5 h this week；没超的人没有", await evaluate(`const v = document.querySelector('[data-over-hours="1"]'); return !!v && v.textContent === '42.5 h this week' && getComputedStyle(v).color === 'rgb(252, 211, 77)' && document.querySelectorAll('[data-over-hours]').length === 1;`), await evaluate("return [...document.querySelectorAll('[data-over-hours]')].map(e => e.dataset.overHours + ':' + e.textContent).join('|');"));
  // ───────── 置顶 118（Annie「全部同意A」+「动手」）：新规则 Maximum days on a shift。
  // 后端还没加进白名单 ⇒ 存的时候弹窗红字原样是后端 400 原话、不关、没存；后端加好以后（ctl.maxDaysOk）照常存。
  await rulesTab();
  const before118 = (await getRules()).length;
  await evaluate("$btn('Add rule').click();");
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Add rule')`);
  check("118：Rule type 下拉里有 Maximum days on a shift", await evaluate(`return [...${dlg}.querySelector('select[aria-label="Rule type"]').options].some(o => o.value === 'max_days_on_shift' && o.textContent.startsWith('Maximum days on a shift'));`));
  await evaluate(`$setValue(${dlg}.querySelector('select[aria-label="Rule type"]'), 'max_days_on_shift');`);
  await sleep(150);
  check("118：选了 Maximum days 以后 Who 默认 Only（一个人），不是 Everyone", await evaluate(`return ${dlg}.querySelector('select[aria-label="Who"]')?.value === 'only';`), await evaluate(`return ${dlg}.querySelector('select[aria-label="Who"]')?.value;`));
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  check("118：后端没加白名单 ⇒ 弹窗红字原样是后端原话（Rule N (id …): type must be one of: …）、不关", await waitFor(`((t) => t.startsWith('Rule ') && t.includes(' (id "') && t.includes('"): type must be one of: shift_times, ') && t.endsWith('weekly_hours_alert.'))(${dlg}?.querySelector('[role=alert]')?.textContent ?? '') &&${dlg}.querySelector('[role=alert]').className.includes('text-red')`), await evaluate(`return ${dlg}?.querySelector('[role=alert]')?.textContent;`));
  check("118：400 时没存", (await getRules()).length === before118);
  await ctl({ maxDaysOk: true });
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  await waitFor(`!${dlg}`);
  const md118 = (await getRules()).find((x) => x.type === "max_days_on_shift");
  check("118：后端加好白名单后照常存：{employee_ids, shift_type, n: 1}", !!md118 && Array.isArray(md118.params.employee_ids) && md118.params.employee_ids.length === 1 && typeof md118.params.shift_type === "string" && md118.params.n === 1, JSON.stringify(md118));
  await ctl({ maxDaysOk: false });
  // ───────── 置顶 110 续：Max people 的例外（Annie「1 A 2 B 3 A 4C 5A 6A 7 A。动手」）─────────
  // 题 4 C（Rules 那边）：Edit Max people → + Add exception → 班次 Close、12/08、最多 2 ⇒ 存 exceptions [{from, max, shift_type}]（不带 to）
  check("（存 Max people 1 + 一条过期的例外 10/31）", await putRules([...fullRules, R("m1", "max_per_shift_day", { max: 1, exceptions: [{ from: "2026-10-31", max: 2, shift_type: "close" }] })]));
  await rulesTab();
  check("题 5 A：过期的例外灰掉写 (past)，还留着", await evaluate(`const e = document.querySelector('[data-rule-exceptions="m1"]'); const p = e?.querySelector('[data-exception-past]'); return !!e && e.textContent.startsWith('Exceptions:') && !!p && p.textContent.includes('Close: at most 2 on Oct 31 (past)') && p.className.includes('text-white/40');`), await evaluate(`return document.querySelector('[data-rule-exceptions="m1"]')?.outerHTML;`));
  await evaluate(`$btn('Edit', document.querySelector('[data-rule-row="m1"]')).click();`);
  await waitFor(`${dlg} && ${dlg}.textContent.includes('Exceptions')`);
  await evaluate(`$btn('+ Add exception', ${dlg}).click();`);
  await waitFor(`${dlg}.querySelectorAll('[data-exception-row]').length === 2`);
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  check("例外没填日期 ⇒ 红字 Exception 2: pick the date.，不存", await waitFor(`${dlg}?.querySelector('[role=alert]')?.textContent === 'Exception 2: pick the date.'`));
  await evaluate(`const row = ${dlg}.querySelector('[data-exception-row="1"]'); $setValue(row.querySelector('select[aria-label="Exception shift"]'), 'close'); $setValue(row.querySelector('input[aria-label="Exception from"]'), '2026-12-08');`);
  await sleep(150);
  // 1a 11-10：后端 G272 回 400 ⇒ 弹窗里红字原样是后端原话，弹窗不关、没存
  const EXC400 = 'Rule 14 (max_per_shift_day, id "m1"): params.exceptions item 2: to must be on or after from.';
  await ctl({ rulesFailDetail: EXC400 });
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  check("后端 400（G272 原话）⇒ Rules 弹窗红字原样 + 不关", await waitFor(`${dlg}?.querySelector('[role=alert]')?.textContent === ${JSON.stringify(EXC400)} && ${dlg}.querySelector('[role=alert]').className.includes('text-red')`), await evaluate(`return ${dlg}?.querySelector('[role=alert]')?.textContent;`));
  check("400 时没存（还是只有一条过期例外）", (await getRules()).find((r) => r.id === "m1")?.params.exceptions?.length === 1);
  await ctl({ rulesFailDetail: null });
  await sleep(150);
  await evaluate(`$btn('Save rule', ${dlg}).click();`);
  await waitFor(`!${dlg}`);
  saved = (await getRules()).find((r) => r.id === "m1");
  check("题 4 C：存 exceptions 两条，新的 {from: 2026-12-08, max: 2, shift_type: close}，没有 to", JSON.stringify(saved?.params.exceptions?.[1]) === '{"from":"2026-12-08","max":2,"shift_type":"close"}', JSON.stringify(saved?.params));
  check("清单写 Exceptions: … Close: at most 2 on Dec 8", await waitFor(`document.querySelector('[data-rule-exceptions="m1"]')?.textContent.includes('Close: at most 2 on Dec 8')`));

  // 题 4 C（Schedule 那边）+ 题 7 A：Lizzie、Nadia 都排 12/07 Close ⇒ 先是琥珀；点日期选 Allow 2 people on Close this day → Save ⇒ 琥珀没了、灰字 Close max 2 today
  check("（例外清空）", await putRules([...fullRules, R("m1", "max_per_shift_day", { max: 1 })]));
  const W2 = "2026-12-06";
  const D2 = (n) => `2026-12-${String(6 + n).padStart(2, "0")}`;
  await fetch(`${MOCK}/api/schedule/weeks/${W2}/slots/bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replace: true, slots: [
    { date: D2(1), shift_type: "close", start_time: "13:30", end_time: "21:30", employee_id: 2 },
    { date: D2(1), shift_type: "close", start_time: "13:30", end_time: "21:30", employee_id: 3 },
  ] }) });
  await openPage(`${APP}/schedule?week=${W2}`);
  await waitFor(`${cell(`2|${D2(1)}`)} && document.querySelector('[data-over-cap="${D2(1)}|close"]')`);
  check("没有例外：12/07 日期下琥珀 Close 2 (max 1)，日期可以点", await evaluate(`return !!document.querySelector('[data-over-cap="${D2(1)}|close"]') && !!document.querySelector('[data-day-rule="${D2(1)}"]');`));
  await evaluate(`document.querySelector('[data-day-rule="${D2(1)}"]').click();`);
  await waitFor(`document.querySelector('[data-day-rule-dialog="${D2(1)}"]')`);
  const dd = `document.querySelector('[data-day-rule-dialog="${D2(1)}"]')`;
  check("日期小窗：标题 Max people on Mon, Dec 7；有 Allow 2 people on Close this day / every shift / Back to the rule (at most 1)；没改时 Save 灰着", await evaluate(`const d = ${dd}; return d.textContent.includes('Max people on Mon, Dec 7') && d.textContent.includes('Allow 2 people on Close this day') && d.textContent.includes('Allow 2 people on every shift this day') && d.textContent.includes('Back to the rule (at most 1)') && $btn('Save', d).disabled;`), await evaluate(`return ${dd}?.textContent;`));
  await evaluate(`${dd}.querySelector('[data-day-rule-option="close"]').click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dd}).click();`);
  await waitFor(`!${dd}`);
  saved = (await getRules()).find((r) => r.id === "m1");
  check("按 Save 才存：同一份 exceptions 多一条 {from: 2026-12-07, max: 2, shift_type: close}", JSON.stringify(saved?.params.exceptions) === '[{"from":"2026-12-07","max":2,"shift_type":"close"}]', JSON.stringify(saved?.params));
  check("题 7 A：存完琥珀没了，日期下灰字 Close max 2 today", await waitFor(`!document.querySelector('[data-over-cap="${D2(1)}|close"]') && document.querySelector('[data-day-exception="${D2(1)}"]')?.textContent === 'Close max 2 today'`), await evaluate(`return document.querySelector('[data-day-exception="${D2(1)}"]')?.textContent + ' / ' + !!document.querySelector('[data-over-cap]');`));
  await evaluate(`document.querySelector('[data-day-rule="${D2(1)}"]').click();`);
  await waitFor(`document.querySelector('[data-day-rule-dialog="${D2(1)}"]')`);
  await evaluate(`${dd}.querySelector('[data-day-rule-option="rule"]').click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dd}).click();`);
  await waitFor(`!${dd}`);
  saved = (await getRules()).find((r) => r.id === "m1");
  check("Back to the rule：这一天的例外去掉（exceptions 整个不带），琥珀又出来", !("exceptions" in (saved?.params ?? {})) && (await waitFor(`!!document.querySelector('[data-over-cap="${D2(1)}|close"]')`)), JSON.stringify(saved?.params));
  // 1a 11-10：Schedule 日期小窗存的时候后端 400 ⇒ 小窗红字原样、不关、没存
  await ctl({ rulesFailDetail: EXC400 });
  await evaluate(`document.querySelector('[data-day-rule="${D2(1)}"]').click();`);
  await waitFor(`document.querySelector('[data-day-rule-dialog="${D2(1)}"]')`);
  await evaluate(`${dd}.querySelector('[data-day-rule-option="close"]').click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dd}).click();`);
  check("后端 400（G272 原话）⇒ 日期小窗红字原样 + 不关", await waitFor(`${dd}?.querySelector('[role=alert]')?.textContent === ${JSON.stringify(EXC400)}`), await evaluate(`return ${dd}?.querySelector('[role=alert]')?.textContent;`));
  check("400 时没存（exceptions 还是没有）", !("exceptions" in ((await getRules()).find((r) => r.id === "m1")?.params ?? {})));
  await ctl({ rulesFailDetail: null });
  await evaluate(`$btn('Cancel', ${dd}).click();`);
  await waitFor(`!${dd}`);
  check("（规则恢复）", await putRules(fullRules));
  // 题 3 A：后面的 Auto-fill 预览带一条「每周超 39 小时提醒」（Veronica 固定 Open 8 小时 × 5 = 40）。
  check("（规则恢复 + Weekly hours alert 39）", await putRules([...fullRules, R("h1", "weekly_hours_alert", { hours: 39 })]));

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
  await leaveContinue(); // 置顶 117：先过 Leave 那一步
  check("这周已经有班 ⇒ 问怎么处理（Replace them / Add to them）", await waitFor(`${dlg}.querySelector('[data-autofill-existing]')`));
  check("决定页写明 Replace 会先删现有的班", await evaluate(`return ${dlg}.textContent.includes('Replace them') && ${dlg}.textContent.includes('Add to them') && ${dlg}.textContent.includes('deletes the existing shifts');`));
  await evaluate(`$btn('Preview', ${dlg}).click();`);
  check("预览：所有规则都满足", await waitFor(`${dlg}.querySelector('[data-autofill-ok]') && ${dlg}.querySelector('[data-autofill-week]')`));
  check("题 3 A：黄框 / 绿框下面琥珀一行 Over 39 hours: …，写 Veronica 40 h this week（只提醒，仍是所有规则都满足）", await evaluate(`const n = ${dlg}.querySelector('[data-autofill-over-hours]'); return !!n && n.textContent.startsWith('Over 39 hours:') && n.textContent.includes('Veronica 40 h this week') && getComputedStyle(n).color === 'rgb(252, 211, 77)';`), await evaluate(`return ${dlg}.querySelector('[data-autofill-over-hours]')?.textContent;`));
  check("（规则恢复：去掉 Weekly hours alert，后面 Period 的勾选数照旧）", await putRules(fullRules));
  const previewShifts = await evaluate(`return ${dlg}.querySelectorAll('[data-autofill-week] [class*="rounded-[6px]"][class*="border"]:not([data-off])').length;`);
  check("预览表里的班数 = 活跃的人数 × 5", previewShifts >= 30, String(previewShifts));
  await evaluate(`$btn('Create draft', ${dlg}).click();`);
  // 当前这一周（B9 Q6）：填出来的班先放在页面上等 Save，不直接建；Replace = 原来的班标删掉。
  check("建好：绿条写「Put 30 shifts on this week. Click Save to keep them. … Nothing is published」，没发 bulk", (await waitFor("document.querySelector('[data-autofill-banner]')?.textContent.includes('Put 30 shifts on this week. Click Save to keep them.') && document.querySelector('[data-autofill-banner]').textContent.includes('Nothing is published')")) && (await (await fetch(`${MOCK}/__log`)).json()).filter((e) => e.path.endsWith("/2026-10-11/slots/bulk")).length === 0, await evaluate("return document.querySelector('[data-autofill-banner]')?.textContent;"));
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
  await leaveContinue(); // 置顶 117：先过 Leave 那一步
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

  // ── 置顶 117（Annie「点击哪些天是已经申请的Leave，不是平时每周的两天」「leave另外加」「今晚就先放Leave」「117动手」，Q1 A）──
  // Auto-fill 按 Preview 先出 Leave 表：已存的休假列出来（写 Leave、只读），点空格标 Leave；排班跳过 Leave 的天，Days per week 扣掉 Leave 天数，两天 Off 照给；
  // 后端同一人同一天不能既有班又有休假 ⇒ Create draft 时：那天原来没班的马上存；原来有班（Replace）的等整周 Save 删掉旧班后再存；Cancel 什么都不存。
  {
    await ctl({ phase2: true });
    const W117 = "2026-10-18";
    const days117 = Array.from({ length: 7 }, (_, i) => { const [y, m, d] = W117.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10); });
    const wk0 = await (await fetch(`${MOCK}/api/schedule/weeks/${W117}`)).json();
    const has = (id, date) => wk0.slots.some((x) => x.employee_id === id && x.date === date);
    // 已存的休假：Nadia（3）那周没班的一天；新点的：Lizzie（2）那周有班的一天（存的时候要等 Save）。
    const nadiaDay = days117.find((d) => !has(3, d));
    const lizzieDay = days117.find((d) => has(2, d) && new Date(`${d}T12:00:00Z`).getUTCDay() >= 1 && new Date(`${d}T12:00:00Z`).getUTCDay() <= 5);
    const pre = await fetch(`${MOCK}/api/schedule/time-off`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: 3, dates: [nadiaDay], kind: "pto", note: null }) });
    check(`117（准备）已存一条休假：Nadia ${nadiaDay}；Lizzie ${lizzieDay} 那天原来有班`, pre.ok && !!nadiaDay && !!lizzieDay, `${pre.status} ${nadiaDay} ${lizzieDay}`);
    const openLeaveStep = async (four) => {
      await openPage(`${APP}/schedule?week=${W117}`);
      await waitFor("!!$btn('Auto-fill') && !$btn('Auto-fill').disabled", 30000);
      await evaluate("$btn('Auto-fill').click();");
      await waitFor(`${dlg} && ${dlg}.textContent.includes('Auto-fill schedule')`);
      if (four) await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.includes('Next 4 weeks')).click();`);
      await evaluate(`$btn('Preview', ${dlg}).click();`);
      return waitFor(`${dlg}.querySelector('[data-autofill-leave-grid]')`, 30000);
    };
    // 4 周：Leave 表盖住要排的 4 周（28 天）；已发布的周不出。
    await openLeaveStep(true);
    const cols4 = await evaluate(`return [...${dlg}.querySelectorAll('[data-autofill-leave-grid] .font-mono')].map(x => x.textContent);`);
    check("117 选 Next 4 weeks：Leave 表 28 天（4 周）、从 10/18 起", cols4.length === 28 && cols4[0] === "10/18", JSON.stringify(cols4.slice(0, 3)) + " … " + cols4.length);
    await evaluate(`$btn('Back', ${dlg}).click();`);
    await waitFor(`$btn('Cancel', ${dlg})`);
    await evaluate(`$btn('Cancel', ${dlg}).click();`);
    await sleep(200);
    // 已发布的周（10/04）不出
    await openPage(`${APP}/schedule?week=2026-10-04`);
    await waitFor("!!$btn('Auto-fill') && !$btn('Auto-fill').disabled", 30000);
    await evaluate("$btn('Auto-fill').click();");
    await waitFor(`${dlg} && ${dlg}.textContent.includes('Auto-fill schedule')`);
    await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.includes('Next 4 weeks')).click();`);
    await evaluate(`$btn('Preview', ${dlg}).click();`);
    await waitFor(`${dlg}.querySelector('[data-autofill-leave-grid]')`, 30000);
    const cols4p = await evaluate(`return [...${dlg}.querySelectorAll('[data-autofill-leave-grid] .font-mono')].map(x => x.textContent);`);
    check("117 已发布的周不出：从 10/04 起 4 周，10/04 那周（已发布）不在 Leave 表里", cols4p.length === 21 && !cols4p.includes("10/04") && cols4p[0] === "10/11", JSON.stringify(cols4p.slice(0, 2)) + " … " + cols4p.length);
    await evaluate(`$btn('Back', ${dlg}).click();`);
    await waitFor(`$btn('Cancel', ${dlg})`);
    await evaluate(`$btn('Cancel', ${dlg}).click();`);
    await sleep(200);

    check("117 Auto-fill 按 Preview：先出 Leave 表（这一周 7 天）、写明 Leave 是在每周休息之外", (await openLeaveStep(false)) && (await evaluate(`return [...${dlg}.querySelectorAll('[data-autofill-leave-grid] .font-mono')].length === 7 && ${dlg}.textContent.includes('Leave is on top of the weekly days off');`)));
    check(`117 已存的休假先列出来：Nadia ${nadiaDay} 写 Leave（今晚一律 Leave，不写 PTO）、不是按钮（只读）`, await evaluate(`const c = ${dlg}.querySelector('[data-leave-saved="3|${nadiaDay}"]'); return !!c && c.textContent.trim() === 'Leave' && c.tagName !== 'BUTTON';`));
    const cellSel = `${dlg}.querySelector('[data-leave-cell="2|${lizzieDay}"]')`;
    await evaluate(`${cellSel}.click();`);
    await sleep(150);
    const st1 = await evaluate(`const c = ${cellSel}; return c.getAttribute('aria-pressed') === 'true' && c.textContent === 'Leave' && ${dlg}.querySelector('[data-autofill-leave-count]').textContent === '1 new leave day. They are saved when you create the draft.';`);
    await evaluate(`${cellSel}.click();`);
    await sleep(150);
    const st2 = await evaluate(`return ${cellSel}.getAttribute('aria-pressed') === 'false' && ${dlg}.querySelector('[data-autofill-leave-count]').textContent === 'No new leave picked.';`);
    await evaluate(`${cellSel}.click();`);
    await sleep(150);
    const st3 = await evaluate(`return ${cellSel}.getAttribute('aria-pressed') === 'true';`);
    check("117 点空格标 Leave、写「1 new leave day. They are saved when you create the draft.」；再点取消、再点又标上", st1 && st2 && st3, JSON.stringify({ st1, st2, st3 }));
    await evaluate(`$btn('Continue', ${dlg}).click();`);
    await waitFor(`${dlg}.querySelector('[data-autofill-week]') || ${dlg}.querySelector('[data-autofill-existing]')`, 30000);
    if (await evaluate(`return !!${dlg}.querySelector('[data-autofill-existing]');`)) {
      await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.includes('Replace them')).click();`);
      await evaluate(`$btn('Preview', ${dlg}).click();`);
    }
    await waitFor(`${dlg}.querySelector('[data-autofill-week="${W117}"]')`, 30000);
    const wk = `${dlg}.querySelector('[data-autofill-week="${W117}"]')`;
    check("117 预览：Nadia、Lizzie 那两天写 Leave（不是 Off、没有班）", await evaluate(`return ${wk}.querySelectorAll('[data-autofill-leave="Leave"]').length === 2;`), await evaluate(`return ${wk}.querySelectorAll('[data-autofill-leave]').length;`));
    const rowOf = (name) => `(() => { const g = ${wk}.querySelector('.grid'); const kids = [...g.children]; const i = kids.findIndex(k => k.textContent.trim() === '${name}'); return kids.slice(i + 1, i + 8); })()`;
    for (const name of ["Nadia", "Lizzie"])
      check(`117 leave另外加：${name} 这周 1 天 Leave ⇒ 排 4 天（5 − 1），照样 2 天 Off`, await evaluate(`const r = ${rowOf(name)}; return r.filter(c => c.querySelector('[data-autofill-leave]')).length === 1 && r.filter(c => c.querySelector('[data-off]')).length === 2 && r.filter(c => !c.querySelector('[data-autofill-leave]') && !c.querySelector('[data-off]')).length === 4;`), await evaluate(`return ${rowOf(name)}.map(c => c.textContent.trim()).join(' | ');`));
    const b0 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate(`$btn('Create draft', ${dlg}).click();`);
    await waitFor("document.querySelector('[data-autofill-banner]')", 30000);
    let lg = (await (await fetch(`${MOCK}/__log`)).json()).slice(b0);
    check("117 Create draft（这一周的班放在页面上等 Save）：Lizzie 那天原来有班 ⇒ 还没存 Leave（没有 PUT time-off）", !lg.some((e) => e.path === "/api/schedule/time-off"), JSON.stringify(lg.map((e) => e.method + " " + e.path)));
    check("117 结果条写「Leave saved: 1 day.」", await evaluate("return document.querySelector('[data-autofill-banner]').textContent.includes('Leave saved: 1 day.');"), await evaluate("return document.querySelector('[data-autofill-banner]')?.textContent;"));
    const b1 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate(`${SAVE}.click();`);
    // 等页面 Save 之后的那次 PUT time-off（Nadia 的休假卡本来就在页面上，不能拿它当信号）。
    for (let t = 0; t < 60; t++) {
      lg = (await (await fetch(`${MOCK}/__log`)).json()).slice(b1);
      if (lg.some((e) => e.path === "/api/schedule/time-off" && e.method === "PUT")) break;
      await sleep(250);
    }
    await sleep(500);
    lg = (await (await fetch(`${MOCK}/__log`)).json()).slice(b1);
    const iSave = lg.findIndex((e) => e.path.includes(`/weeks/${W117}/`) && e.method !== "GET" && !e.path.endsWith("edit-lock"));
    const iPut = lg.findIndex((e) => e.path === "/api/schedule/time-off" && e.method === "PUT");
    const put = lg[iPut];
    check(`117 按整周 Save：先存班（旧班删掉），再 PUT time-off {employee_id 2, dates [${lizzieDay}], kind pto}`, iSave >= 0 && iPut > iSave && put.body?.employee_id === 2 && JSON.stringify(put.body?.dates) === JSON.stringify([lizzieDay]) && put.body?.kind === "pto", JSON.stringify(lg.map((e) => e.method + " " + e.path)));
    check(`117 存好后排班页 Lizzie ${lizzieDay} 那格是休假卡、写 Leave`, await waitFor(`[...document.querySelectorAll('[data-time-off]')].some(x => x.textContent.includes('Leave'))`, 10000));
    // 后面几周（直接建草稿）：先建班，再存 Leave。
    await openLeaveStep(true);
    const nextDay = "2026-10-27";
    await evaluate(`${dlg}.querySelector('[data-leave-cell="4|${nextDay}"]').click();`);
    await evaluate(`$btn('Continue', ${dlg}).click();`);
    await waitFor(`${dlg}.querySelector('[data-autofill-week]') || ${dlg}.querySelector('[data-autofill-existing]')`, 30000);
    if (await evaluate(`return !!${dlg}.querySelector('[data-autofill-existing]');`)) {
      await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.includes('Replace them')).click();`);
      await evaluate(`$btn('Preview', ${dlg}).click();`);
    }
    await waitFor(`${dlg}.querySelector('[data-autofill-week="2026-10-25"]')`, 30000);
    const b2 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate(`$btn('Create draft', ${dlg}).click();`);
    await waitFor("document.querySelector('[data-autofill-banner]')", 30000);
    lg = (await (await fetch(`${MOCK}/__log`)).json()).slice(b2);
    const iBulk = lg.findIndex((e) => e.path === "/api/schedule/weeks/2026-10-25/slots/bulk");
    const iPut2 = lg.findIndex((e) => e.path === "/api/schedule/time-off" && e.method === "PUT" && e.body?.employee_id === 4);
    check(`117 后面的周（直接建草稿）：先建 10/25 那周的班（bulk），再 PUT time-off Jing ${nextDay}`, iBulk >= 0 && iPut2 > iBulk && JSON.stringify(lg[iPut2].body.dates) === JSON.stringify([nextDay]), JSON.stringify(lg.map((e) => e.method + " " + e.path)));
    const w25 = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-25`)).json();
    check(`117 10/25 那周 Jing ${nextDay} 没有班、有休假`, !w25.slots.some((x) => x.employee_id === 4 && x.date === nextDay) && (w25.time_off ?? []).some((t) => t.employee_id === 4 && t.date === nextDay));
    // Cancel：什么都不存
    await openLeaveStep(false);
    await evaluate(`${dlg}.querySelector('[data-leave-cell]').click();`);
    const b3 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate(`$btn('Back', ${dlg}).click();`);
    await waitFor(`$btn('Cancel', ${dlg})`);
    await evaluate(`$btn('Cancel', ${dlg}).click();`);
    await sleep(300);
    check("117 点了 Leave 又 Cancel：不发 time-off 请求", (await (await fetch(`${MOCK}/__log`)).json()).slice(b3).every((e) => e.path !== "/api/schedule/time-off"));
    // 手机：Leave 表左右滑，整页不左右晃
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await openLeaveStep(true);
    check("117 手机：Leave 表在框里左右滑，整页不左右晃", await evaluate(`const g = ${dlg}.querySelector('[data-autofill-leave-grid]'); return g.scrollWidth > g.clientWidth && document.documentElement.scrollWidth <= 390;`), await evaluate(`return document.documentElement.scrollWidth;`));
    await evaluate(`$btn('Back', ${dlg}).click();`);
    await waitFor(`$btn('Cancel', ${dlg})`);
    await evaluate(`$btn('Cancel', ${dlg}).click();`);
    await cdp("Emulation.clearDeviceMetricsOverride");
    await sleep(200);
    await ctl({ phase2: false });
  }

  // ── 置顶 119（Annie「3个问题都同意A，动手」）：Overview 标签——只看和分析。默认 4 周、可切 1 周、‹ › 翻；
  //    每人每周几天几小时（对不上红字）、每天每种班几个人（少于 Coverage / 多于 Max 红）；Analysis 照 Rules 逐条 ✓ / ✗；不写任何数据。
  {
    await ctl({ phase2: true });
    check("119（准备）规则：照 fullRules（Veronica 周一到周五固定 Open、每人每周 5 天、Open / Close 每天至少 1 人、周末轮值）", await putRules(fullRules));
    const OW = "2027-05-02";
    const dOf = (i) => { const [y, m, d] = OW.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10); };
    // 名单里在职的前三位（前面的检查会增删人）：A 周一到周五 Open、B 周一到周四 Close、C 休 1 天。
    const empList = await (await fetch(`${MOCK}/api/schedule/employees`)).json();
    const [EA, EB, EC] = (empList.employees ?? []).filter((e) => e.is_active).sort((a, b) => a.id - b.id);
    const slots = [
      ...[1, 2, 3, 4, 5].map((i) => ({ date: dOf(i), shift_type: "open", start_time: "02:00", end_time: "10:00", employee_id: EA.id })),
      ...[1, 2, 3, 4].map((i) => ({ date: dOf(i), shift_type: "close", start_time: "13:30", end_time: "21:30", employee_id: EB.id })),
    ];
    await fetch(`${MOCK}/api/schedule/weeks/${OW}`);
    const bk = await fetch(`${MOCK}/api/schedule/weeks/${OW}/slots/bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replace: true, slots }) });
    const lvp = await fetch(`${MOCK}/api/schedule/time-off`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: EC.id, dates: [dOf(2)], kind: "pto", note: null }) });
    check("119（准备）5/2 那周：Veronica 周一到周五 Open、Lizzie 周一到周四 Close；Nadia 5/4 休假", bk.ok && lvp.ok, `${bk.status} ${await bk.text()} / ${lvp.status}`);
    await openPage(`${APP}/schedule?week=${OW}`);
    await waitFor("[...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Overview')", 30000);
    check("119 标签：Schedule | Overview | … | Rules，Overview 在 Schedule 后面", await evaluate("const t = [...document.querySelectorAll('[role=tab]')].map(b => b.textContent.trim()); return t[0] === 'Schedule' && t[1] === 'Overview' && t.includes('Rules');"), await evaluate("return [...document.querySelectorAll('[role=tab]')].map(b => b.textContent.trim()).join('|');"));
    const l0 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Overview').click();");
    await waitFor("document.querySelectorAll('[data-overview-week]').length === 4", 30000);
    check("119 默认 4 周：4 个周块、标题 May 2 – May 29, 2027", await evaluate("return document.querySelectorAll('[data-overview-week]').length === 4 && document.querySelector('[data-overview-range]').textContent === 'May 2 – May 29, 2027' && document.querySelector('[data-overview-count=\"4\"]').getAttribute('aria-checked') === 'true';"), await evaluate("return document.querySelector('[data-overview-range]')?.textContent;"));
    const wk = `document.querySelector('[data-overview-week="${OW}"]')`;
    check("119 格子：Veronica 5/3 是 Open（排班页的班次色）、5/2 是 Off；Nadia 5/4 是 Leave", await evaluate(`const c = (k) => ${wk}.querySelector('[data-overview-cell="' + k + '"]'); return c('${EA.id}|${dOf(1)}').textContent.includes('Open') && c('${EA.id}|${dOf(1)}').textContent.includes('2:00') && !!c('${EA.id}|${dOf(0)}').querySelector('[data-off]') && !!c('${EC.id}|${dOf(2)}').querySelector('[data-overview-leave]');`));
    check("119 每人每周：Veronica 5 d / 40 h 不红；Lizzie 4 d 红字「should be 5」；Nadia 休 1 天 ⇒ 该上 4 天", await evaluate(`const s = (id) => ${wk}.querySelector('[data-overview-week-sum="' + id + '"]'); return s(${EA.id}).textContent.replace(/\\s+/g, '').startsWith('5d40h') && !s(${EA.id}).dataset.wrong && s(${EB.id}).dataset.wrong === 'true' && s(${EB.id}).textContent.includes('should be 5') && s(${EC.id}).textContent.includes('should be 4');`), await evaluate(`return [${EA.id},${EB.id},${EC.id}].map(id => ${wk}.querySelector('[data-overview-week-sum="' + id + '"]').textContent).join(' | ');`));
    check("119 每天人数：Open 周一到周五 1、周日 0 红（Coverage 至少 1）；Close 周五 0 红", await evaluate(`const n = (k) => ${wk}.querySelector('[data-overview-count="' + k + '"]'); return n('open|${dOf(1)}').textContent === '1' && !n('open|${dOf(1)}').dataset.bad && n('open|${dOf(0)}').textContent === '0' && n('open|${dOf(0)}').dataset.bad === 'true' && n('close|${dOf(5)}').dataset.bad === 'true';`));
    const markOf = (type, col) => `[...document.querySelectorAll('[data-overview-rule="${type}"]')].map(tr => tr.children[${col} + 1].dataset.mark)`;
    check("119 Analysis：Fixed shift ✓；Days per week ✗；Coverage ✗；Weekend rotation 写 —（不是能查对错的）", await evaluate(`return ${markOf("fixed_shift", 0)}[0] === 'ok' && ${markOf("days_per_week", 0)}[0] === 'no' && ${markOf("coverage", 0)}.every(m => m === 'no') && ${markOf("weekend_rotation", 0)}[0] === 'na';`), await evaluate(`return [...document.querySelectorAll('[data-overview-rule]')].map(tr => tr.dataset.overviewRule + ':' + tr.children[1].dataset.mark).join(' ');`));
    check("119 Analysis：「Shifts that could not be filled」第一周列出 Sun Open、Sat Close…（红）", await evaluate("const c = document.querySelector('[data-overview-unfilled]').children[1]; return c.textContent.includes('Sun Open') && c.textContent.includes('Sat Close') && c.className.includes('red');"), await evaluate("return document.querySelector('[data-overview-unfilled]').children[1].textContent;"));
    check("119 Analysis：✗ 的原因直接列出来（Week of 5/2 — …），不藏在悬停里", await evaluate(`const d = document.querySelector('[data-overview-details]'); return !!d && d.textContent.includes('Week of 5/2') && d.textContent.includes('${EB.name}');`));
    check("119 每人合计（4 周）：Veronica 20 天 160 小时、Open 20；Nadia Leave 1", await evaluate("const r = (id) => [...document.querySelector('[data-overview-total=\"' + id + '\"]').children].map(x => x.textContent.trim()); const v = r(" + EA.id + "), n = r(" + EC.id + "); return v[1] === '20' && v[2] === '160' && v[3] === '20' && n[n.length - 1] === '1';"), await evaluate("return [" + EA.id + "," + EC.id + "].map(id => document.querySelector('[data-overview-total=\"' + id + '\"]').textContent).join(' | ');"));
    check("119 一目了然：Overview 里没有 ⋯ / i 收起的菜单", await evaluate("const o = document.querySelector('[data-schedule-overview]'); return !o.querySelector('[data-phone-more], [data-phone-info], details');"));
    // 1 周 / ‹ ›
    await evaluate("document.querySelector('[data-overview-count=\"1\"]').click();");
    await waitFor("document.querySelectorAll('[data-overview-week]').length === 1", 15000);
    check("119 切 1 周：只剩 5/2 那一周", await evaluate(`return document.querySelectorAll('[data-overview-week]').length === 1 && !!${wk} && document.querySelector('[data-overview-range]').textContent === 'May 2 – May 8, 2027';`));
    await evaluate("document.querySelector('button[aria-label=\"Next weeks\"]').click();");
    check("119 › 往后一周：May 9 – May 15", await waitFor("document.querySelector('[data-overview-range]')?.textContent === 'May 9 – May 15, 2027' && !!document.querySelector('[data-overview-week=\"2027-05-09\"]')", 15000));
    await evaluate("document.querySelector('button[aria-label=\"Previous weeks\"]').click();");
    await waitFor("document.querySelector('[data-overview-range]')?.textContent === 'May 2 – May 8, 2027'", 15000);
    await evaluate("document.querySelector('[data-overview-count=\"4\"]').click();");
    await waitFor("document.querySelectorAll('[data-overview-week]').length === 4", 15000);
    await evaluate("document.querySelector('button[aria-label=\"Next weeks\"]').click();");
    check("119 4 周时 › 一次翻 4 周：May 30 – Jun 26", await waitFor("document.querySelector('[data-overview-range]')?.textContent === 'May 30 – Jun 26, 2027' && document.querySelectorAll('[data-overview-week]').length === 4", 15000));
    const writes = (await (await fetch(`${MOCK}/__log`)).json()).slice(l0).filter((e) => e.method !== "GET" && e.path.startsWith("/api/schedule") && !e.path.endsWith("edit-lock"));
    check("119 只读：开 Overview、切 1 / 4 周、‹ › 都没有写请求", writes.length === 0, JSON.stringify(writes.map((e) => e.method + " " + e.path)));
    // 手机
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await openPage(`${APP}/schedule?week=${OW}`);
    await waitFor("[...document.querySelectorAll('[role=tab]')].some((b) => b.textContent.trim() === 'Overview')", 30000);
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Overview').click();");
    await waitFor("document.querySelectorAll('[data-overview-week]').length === 4", 30000);
    await sleep(300);
    check("119 手机：整页不左右晃；周表在自己框里左右滑；名字列固定（sticky）", await evaluate(`const box = ${wk}.querySelector('.overflow-x-auto'); const name = ${wk}.querySelector('tbody th'); return document.documentElement.scrollWidth <= 390 && box.scrollWidth > box.clientWidth && getComputedStyle(name).position === 'sticky';`), await evaluate("return document.documentElement.scrollWidth;"));
    await cdp("Emulation.clearDeviceMetricsOverride");
    await sleep(200);
    await ctl({ phase2: false });
  }

  // ── 按基础周排（Annie 2026-11-02「用上周的排班为基数，来自动排班，遵守定好的这些role，然后把整个月的班都排出来」；
  //    preview https://claude.ai/artifact/L3gCgqBPvDLBxAC2ToDVxp 照推荐）：默认基础周 = 上周、从下周起 4 周，存草稿、只填空格 ──
  {
    const laToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const add = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
    const dow = new Date(`${laToday}T12:00:00Z`).getUTCDay();
    const thisWeek = add(laToday, -dow);
    const lastWeek = add(thisWeek, -7);
    const nextWeek = add(thisWeek, 7);
    // 基础周：Veronica（id 1，规则固定周一到周五 Open）排成 Mid ⇒ 该被改回 Open；id 2 周一到周三 Close ⇒ 照抄。
    const baseSlots = [
      ...[1, 2, 3, 4, 5].map((d) => ({ date: add(lastWeek, d), shift_type: "mid", start_time: "08:00", end_time: "17:00", employee_id: 1 })),
      ...[1, 2, 3].map((d) => ({ date: add(lastWeek, d), shift_type: "close", start_time: "13:30", end_time: "21:30", employee_id: 2 })),
    ];
    await fetch(`${MOCK}/api/schedule/weeks/${lastWeek}/slots/bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replace: true, slots: baseSlots }) });
    // 第二周先有一份不是复制来的草稿（bulk 建的，copied_from null）：id 3 周一 Mid ⇒ 只填空格，这一格留着。
    const week2 = add(nextWeek, 7);
    await fetch(`${MOCK}/api/schedule/weeks/${week2}/slots/bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replace: true, slots: [{ date: add(week2, 1), shift_type: "mid", start_time: "08:00", end_time: "17:00", employee_id: 3 }] }) });
    await openPage(`${APP}/schedule?week=${thisWeek}`);
    await waitFor("!!$btn('Auto-fill') && !$btn('Auto-fill').disabled", 30000);
    await evaluate("$btn('Auto-fill').click();");
    await waitFor(`${dlg} && ${dlg}.textContent.includes('Auto-fill schedule')`);
    await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.includes('Copy a base week')).click();`);
    await waitFor(`${dlg}.querySelector('[data-autofill-base]')`);
    check("按基础周排：默认基础周 = 上周、从下周起 4 周；照 Rules 排的 This week / Next 4 weeks 收起来", await evaluate(`const d = ${dlg}; return d.querySelector('[data-base-week]').value === '${lastWeek}' && d.querySelector('[data-base-start]').value === '${nextWeek}' && d.querySelector('[data-base-count]').value === '4' && d.querySelector('[data-base-count]').options.length === 6 && ![...d.querySelectorAll('button[role=radio]')].some(b => b.offsetParent !== null && b.textContent.includes('Next 4 weeks'));`));
    let b0 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate(`$btn('Preview', ${dlg}).click();`);
    await leaveContinue(); // 置顶 117：先过 Leave 那一步
    await waitFor(`${dlg}.querySelectorAll('[data-autofill-week]').length === 4`, 30000);
    check("按基础周排：不问 Replace / Add，直接预览 4 周；每周写明是换掉复制来的班还是只填空格", await evaluate(`return !${dlg}.querySelector('[data-autofill-existing]') && !!${dlg}.querySelector('[data-autofill-base-note]') && ${dlg}.querySelector('[data-autofill-week="${nextWeek}"] [data-base-mode]').dataset.baseMode === 'replace' && ${dlg}.querySelector('[data-autofill-week="${week2}"] [data-base-mode]').dataset.baseMode === 'fill';`));
    const wk1 = `${dlg}.querySelector('[data-autofill-week="${nextWeek}"]')`;
    check("照抄基础周：id 2 周一 Close 照抄、没标琥珀框", await evaluate(`const cells = [...${wk1}.querySelectorAll('[class*="min-h-[56px]"][class*="flex-col"]')]; return cells.length > 0 && ${wk1}.textContent.includes('Close');`));
    check("按规则修正：Veronica 基础周是 Mid，固定班规则是 Open ⇒ 排 Open、琥珀框写 Fixed shift", await evaluate(`return [...${wk1}.querySelectorAll('[data-changed]')].some(c => c.dataset.changed === 'Fixed shift' && c.textContent.includes('Open'));`));
    check("按基础周排：键写 Create drafts for 4 weeks", await evaluate(`return !!$btn('Create drafts for 4 weeks', ${dlg});`));
    b0 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate(`$btn('Create drafts for 4 weeks', ${dlg}).click();`);
    check("建好：绿条写 for 4 weeks、Nothing is published", await waitFor("document.querySelector('[data-autofill-banner]')?.textContent.includes('for 4 weeks') && document.querySelector('[data-autofill-banner]').textContent.includes('Nothing is published')", 30000), await evaluate("return document.querySelector('[data-autofill-banner]')?.textContent;"));
    const bulks = (await (await fetch(`${MOCK}/__log`)).json()).slice(b0).filter((e) => e.path.endsWith("/slots/bulk"));
    const rep = (ws) => bulks.find((e) => e.path.includes(ws))?.body?.replace;
    check("一周一个 POST …/slots/bulk：打开时自动复制来的周 replace:true（整周换成按基础周排的）；不是复制来的草稿 replace:false（只填空格）", bulks.length === 4 && rep(nextWeek) === true && rep(week2) === false, JSON.stringify(bulks.map((e) => [e.path, e.body?.replace])));
    const w2 = await (await fetch(`${MOCK}/api/schedule/weeks/${week2}`)).json();
    check("不是复制来的草稿：原来 id 3 周一 Mid 留着，空的天按基础周补上（id 2 周一 Close）", w2.slots.filter((x) => x.employee_id === 3 && x.date === add(week2, 1)).length === 1 && w2.slots.some((x) => x.employee_id === 3 && x.date === add(week2, 1) && x.shift_type === "mid") && w2.slots.some((x) => x.employee_id === 2 && x.date === add(week2, 1) && x.shift_type === "close"), JSON.stringify(w2.slots.filter((x) => x.date === add(week2, 1))));
    const nw = await (await fetch(`${MOCK}/api/schedule/weeks/${nextWeek}`)).json();
    check("下周存成草稿：id 2 周一 Close（照抄）、Veronica 周一 Open（按规则），状态 draft", nw.status === "draft" && nw.slots.some((x) => x.employee_id === 2 && x.date === add(nextWeek, 1) && x.shift_type === "close") && nw.slots.some((x) => x.employee_id === 1 && x.date === add(nextWeek, 1) && x.shift_type === "open"), JSON.stringify(nw.slots.filter((x) => x.date === add(nextWeek, 1))));
    // Working hours 按星期几（后端 work_hours）：周日 off ⇒ 按基础周排时周日一格都不排。
    await ctl({ sundayOff: true });
    await openPage(`${APP}/schedule?week=${thisWeek}`);
    await waitFor("!!$btn('Auto-fill') && !$btn('Auto-fill').disabled", 30000);
    await evaluate("$btn('Auto-fill').click();");
    await waitFor(`${dlg} && ${dlg}.textContent.includes('Auto-fill schedule')`);
    await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.includes('Copy a base week')).click();`);
    await waitFor(`${dlg}.querySelector('[data-autofill-base]')`);
    const b1 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate(`$btn('Preview', ${dlg}).click();`);
    await leaveContinue(); // 置顶 117：先过 Leave 那一步
    await waitFor(`${dlg}.querySelectorAll('[data-autofill-week]').length === 4`, 30000);
    await evaluate(`$btn('Create drafts for 4 weeks', ${dlg}).click();`);
    await waitFor("document.querySelector('[data-autofill-banner]')?.textContent.includes('for 4 weeks')", 30000);
    const offBulks = (await (await fetch(`${MOCK}/__log`)).json()).slice(b1).filter((e) => e.path.endsWith("/slots/bulk"));
    check("Working hours 周日 off：按基础周排的 4 周都没有周日的班", offBulks.length === 4 && offBulks.every((e) => (e.body?.slots || []).every((x) => new Date(`${x.date}T12:00:00Z`).getUTCDay() !== 0)), JSON.stringify(offBulks.map((e) => (e.body?.slots || []).filter((x) => new Date(`${x.date}T12:00:00Z`).getUTCDay() === 0).length)));
    await ctl({ sundayOff: false });
    // 收尾：排过的几周清空（后面「二期」那周打开时会复制前一周，要的是空周）。
    for (let k = 1; k <= 4; k++) await fetch(`${MOCK}/api/schedule/weeks/${add(thisWeek, k * 7)}/slots/bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replace: true, slots: [] }) });
  }

  // ── Period（Annie 2026-11-08「动手吧」，preview HnBVL6wANcCZYs1r1enq3W 全 A + 「最重要一点，可以选择执行哪些rules」）──
  //    开关 schedule_period 没登记 ⇒ 默认只 Super Admin；多周只读表；Auto-fill these weeks 勾选这次执行哪些规则（不改 Rules 标签）。
  {
    const tabNames = "[...document.querySelectorAll('[role=tab]')].map((b) => b.textContent.trim())";
    await ctl({ role: "supervisor", meName: "" });
    await openPage(`${APP}/schedule?week=2026-10-11`);
    await waitFor(`${cell("1|2026-10-11")} && ${tabNames}.includes('Rules')`);
    check("Period：supervisor 看不到 Period 标签（开关没登记 ⇒ 默认只 Super Admin）", await evaluate(`return !${tabNames}.includes('Period');`), await evaluate(`return ${tabNames}.join('|');`));
    await ctl({ role: "superadmin", meName: "" });
    await openPage(`${APP}/schedule?week=2026-10-11`);
    await waitFor(`${cell("1|2026-10-11")} && ${tabNames}.includes('Period')`);
    check("Period：Super Admin 有 Schedule / Overview / Period / Rules（119 Overview 在 Schedule 后面）", await evaluate(`return ${tabNames}.slice(0, 4).join('|') === 'Schedule|Overview|Period|Rules';`), await evaluate(`return ${tabNames}.join('|');`));
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Period').click();");
    await waitFor("document.querySelector('[data-period]')");
    await evaluate("$setValue(document.querySelector('[data-period-start]'), '2026-10-07');");
    await evaluate("$setValue(document.querySelector('[data-period-weeks]'), '3');");
    await waitFor("document.querySelectorAll('[data-period-week]').length === 3 && document.querySelector('[data-period-grid]')", 30000);
    check("Period：Start 选 10/7（周三）⇒ 对齐到周日 10/4；3 周 ⇒ 标题 Oct 4 – Oct 24, 2026 · 3 weeks、三个周头", await evaluate("return document.querySelector('[data-period-title]').textContent.trim() === 'Oct 4 – Oct 24, 2026 · 3 weeks' && document.querySelector('[data-period-start]').value === '2026-10-04' && [...document.querySelectorAll('[data-period-week]')].map(t => t.dataset.periodWeek).join() === '2026-10-04,2026-10-11,2026-10-18';"), await evaluate("return document.querySelector('[data-period-title]').textContent;"));
    check("Period：每周写 Published / Draft（10/4 已发布）", await evaluate("return document.querySelector('[data-period-week=\"2026-10-04\"] [data-period-status]').dataset.periodStatus === 'published' && document.querySelector('[data-period-week=\"2026-10-04\"]').textContent.includes('Published');"));
    check("Period：每人一行、21 天，有班的格子写短时间（例如 2a–10a）", await evaluate("const rows = [...document.querySelectorAll('[data-period-row]')]; return rows.length > 0 && rows.every(r => r.querySelectorAll('td').length === 22) && [...document.querySelectorAll('[data-period-shift]')].some(s => /^\\d{1,2}(:\\d{2})?[ap]–\\d{1,2}(:\\d{2})?[ap]$/.test(s.textContent.trim()));"), await evaluate("return [...document.querySelectorAll('[data-period-shift]')].slice(0,3).map(s=>s.textContent).join(' ');"));
    check("Period：Super Admin 有蓝色 Share with staff（提交类）", await evaluate("const b = document.querySelector('[data-period-share]'); return !!b && !b.disabled && b.textContent.trim() === 'Share with staff' && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
    // 后端没上线（404）：框里写 not available yet，没有 Send
    await evaluate("document.querySelector('[data-period-share]').click();");
    check("Share：后端没上线（404）⇒ 写 Share with staff is not available yet.，没有 Send 键", await waitFor("!!document.querySelector('[data-share-unavailable]') && !document.querySelector('[data-share-send]')"));
    await evaluate("$btn('Cancel', document.querySelector('[data-share-period]')).click();");
    await ctl({ periodShare: true, periodShared: false });
    const s0 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate("document.querySelector('[data-period-share]').click();");
    await waitFor("document.querySelector('[data-share-recipients]')", 30000);
    const shareCalls = (await (await fetch(`${MOCK}/__log`)).json()).slice(s0).filter((e) => e.path === "/api/schedule/period/share");
    check("Share 确认框：打开时只发 dry_run（JSON 布尔 true，开发模式下 React 会读两次），标题 Share Oct 4 – Oct 24 with staff?", shareCalls.length >= 1 && shareCalls.every((e) => e.body.dry_run === true && e.body.start === "2026-10-04" && e.body.weeks === 3) && (await evaluate("return document.querySelector('[data-share-period] h2').textContent.trim() === 'Share Oct 4 – Oct 24 with staff?';")), JSON.stringify(shareCalls.map((e) => e.body)));
    check("有没发布的周：红框写 Week of Oct 11, Week of Oct 18 are not published yet…，Send 灰掉", await evaluate("const u = document.querySelector('[data-share-unpublished]'); return !!u && u.textContent.includes('Week of Oct 11, Week of Oct 18 are not published yet. Publish them on the Schedule tab first.') && document.querySelector('[data-share-send]').disabled;"), await evaluate("return document.querySelector('[data-share-unpublished]')?.textContent;"));
    check("列出会收到的人（2 staff will get it: Veronica, Lizzie）和没邮箱的（置顶 109 Q1 / Q6：灰字 No email: Anita.，不进红字 Not sent）", await evaluate("const d = document.querySelector('[data-share-period]'); const g = d.querySelector('[data-share-no-email]'); return d.querySelector('[data-share-recipients]').textContent.includes('2 staff will get it:') && d.querySelector('[data-share-recipients]').textContent.includes('Veronica, Lizzie') && !!g && g.textContent === 'No email: Anita.' && getComputedStyle(g).color === 'rgb(107, 107, 107)' && !d.querySelector('[data-share-not-reached]');"));
    await evaluate("$btn('Cancel', document.querySelector('[data-share-period]')).click();");
    // 只看已发布的 10/4 那一周 ⇒ 能发
    await evaluate("$setValue(document.querySelector('[data-period-weeks]'), '1');");
    await waitFor("document.querySelectorAll('[data-period-week]').length === 1", 30000);
    await evaluate("document.querySelector('[data-period-share]').click();");
    await waitFor("document.querySelector('[data-share-send]') && !document.querySelector('[data-share-send]').disabled", 30000);
    check("全部已发布：Send 键蓝色、写 Send to 2 staff", await evaluate("const b = document.querySelector('[data-share-send]'); return b.textContent.trim() === 'Send to 2 staff' && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
    const s1 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate("document.querySelector('[data-share-send]').click();");
    check("Send：POST dry_run:false，结果绿字 Sent to 2 staff.（#3B6D11）、灰字 No email: Anita.，键变 Close", (await waitFor("(document.querySelector('[data-share-done]')?.textContent || '') === 'Sent to 2 staff.' && getComputedStyle(document.querySelector('[data-share-done]')).color === 'rgb(59, 109, 17)' && document.querySelector('[data-share-period] [data-share-no-email]')?.textContent === 'No email: Anita.' && !document.querySelector('[data-share-period] [data-share-not-reached]') && !!$btn('Close', document.querySelector('[data-share-period]'))", 30000)) && (await (await fetch(`${MOCK}/__log`)).json()).slice(s1).filter((e) => e.path === "/api/schedule/period/share").map((e) => e.body.dry_run).join() === "false");
    check("Sent to 2 staff. 是绿字（全站成功绿 #3B6D11，置顶 109 Q7）", await evaluate("const c = getComputedStyle(document.querySelector('[data-share-done]')).color; return c === 'rgb(74, 222, 128)' || c === 'rgb(59, 109, 17)';"), await evaluate("return getComputedStyle(document.querySelector('[data-share-done]')).color;"));
    await evaluate("$btn('Close', document.querySelector('[data-share-period]')).click();");
    await evaluate("document.querySelector('[data-period-share]').click();");
    check("同一段再分享：黄框写 Already shared: by Annie on Oct 3, 3:15 PM. Sending again emails everyone again.", await waitFor("(document.querySelector('[data-share-already]')?.textContent || '').includes('Already shared: by Annie on Oct 3, 3:15 PM. Sending again emails everyone again.')", 30000), await evaluate("return document.querySelector('[data-share-already]')?.textContent;"));
    await evaluate("$btn('Cancel', document.querySelector('[data-share-period]')).click();");
    // 置顶 109 W4 第二段（后端 f30d895a）：读 no_contact / failed；发失败红字 Not sent + 原因，没邮箱灰字；旧后端退回 not_reached
    await ctl({ periodFailed: true });
    await evaluate("document.querySelector('[data-period-share]').click();");
    await waitFor("document.querySelector('[data-share-recipients]')", 30000);
    check("后端 failed：红字 Not sent: Bo — link could not be made；没邮箱的 Anita 仍是灰字、不进红字", await evaluate("const d = document.querySelector('[data-share-period]'); const r = d.querySelector('[data-share-not-reached]'); const g = d.querySelector('[data-share-no-email]'); return !!r && r.textContent.includes('Not sent:') && r.textContent.includes('Bo — link could not be made') && !r.textContent.includes('Anita') && getComputedStyle(r).color === 'rgb(163, 45, 45)' && g?.textContent === 'No email: Anita.';"), await evaluate("return document.querySelector('[data-share-period]')?.innerText;"));
    await evaluate("$btn('Cancel', document.querySelector('[data-share-period]')).click();");
    await ctl({ periodFailed: true, periodLegacy: true });
    await evaluate("document.querySelector('[data-period-share]').click();");
    await waitFor("document.querySelector('[data-share-recipients]')", 30000);
    check("旧后端（只有 not_reached）：照样拆成红字 Bo、灰字 No email: Anita.", await evaluate("const d = document.querySelector('[data-share-period]'); const r = d.querySelector('[data-share-not-reached]'); return !!r && r.textContent.includes('Bo — link could not be made') && !r.textContent.includes('Anita') && d.querySelector('[data-share-no-email]')?.textContent === 'No email: Anita.';"), await evaluate("return document.querySelector('[data-share-period]')?.innerText;"));
    await evaluate("$btn('Cancel', document.querySelector('[data-share-period]')).click();");
    await ctl({ periodFailed: false, periodLegacy: false });
    await ctl({ periodShare: false, periodShared: false });
    await evaluate("$setValue(document.querySelector('[data-period-weeks]'), '3');");
    await waitFor("document.querySelectorAll('[data-period-week]').length === 3", 30000);
    check("Period：How to use 写了 Auto-fill 只管这一次、Rules 标签不变、Share 先发布每周", await evaluate("const t = document.querySelector('[data-period]').textContent; return t.includes('Unticking a rule here only affects this fill. The Rules tab does not change.') && t.includes('Publish every week first. Then click Share with staff');"));

    // Auto-fill these weeks：规则清单（6 条可选 + 3 条 shift_times 固定 + Settings 那行），取消 Fixed shift
    await evaluate("document.querySelector('[data-period-autofill]').click();");
    await waitFor(`${dlg} && ${dlg}.querySelector('[data-autofill-rules]')`);
    check("Auto-fill these weeks：标题写这一段 Oct 4 – Oct 24；不出 This week / Next 4 weeks", await evaluate(`return ${dlg}.textContent.includes('Auto-fill Oct 4 – Oct 24') && ![...${dlg}.querySelectorAll('button[role=radio]')].some(b => b.offsetParent !== null && b.textContent.includes('Next 4 weeks'));`), await evaluate(`return ${dlg}.querySelector('h2').textContent;`));
    check("规则清单：默认全勾、写 6 of 6 rules ticked；Shift times 勾着、灰掉、写 always used", await evaluate(`const d = ${dlg}; const opt = [...d.querySelectorAll('[data-autofill-rule]')].filter(l => l.dataset.autofillRule !== 'shift_times'); const st = [...d.querySelectorAll('[data-autofill-rule=shift_times]')]; return opt.length === 6 && opt.every(l => l.querySelector('input').checked && !l.querySelector('input').disabled) && st.length === 3 && st.every(l => l.querySelector('input').checked && l.querySelector('input').disabled && l.textContent.includes('always used')) && d.querySelector('[data-autofill-rules-count]').textContent.trim() === '6 of 6 rules ticked.';`), await evaluate(`return ${dlg}.querySelector('[data-autofill-rules]').textContent;`));
    await evaluate(`${dlg}.querySelector('[data-autofill-rule=fixed_shift] input').click();`);
    check("取消 Fixed shift：写 5 of 6 rules ticked", await waitFor(`${dlg}.querySelector('[data-autofill-rules-count]').textContent.trim() === '5 of 6 rules ticked.'`));
    const r0 = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await evaluate(`$btn('Preview', ${dlg}).click();`);
    await leaveContinue(); // 置顶 117：先过 Leave 那一步
    await waitFor(`${dlg}.querySelector('[data-autofill-week]') || ${dlg}.querySelector('[data-autofill-existing]')`, 30000);
    if (await evaluate(`return !!${dlg}.querySelector('[data-autofill-existing]');`)) {
      await evaluate(`[...${dlg}.querySelectorAll('button[role=radio]')].find(b => b.textContent.includes('Replace them')).click();`);
      await evaluate(`$btn('Preview', ${dlg}).click();`);
    }
    await waitFor(`${dlg}.querySelectorAll('[data-autofill-week]').length === 3`, 30000);
    check("预览 3 周：10/4 已发布 ⇒ published — skipped", await evaluate(`return ${dlg}.querySelector('[data-autofill-week="2026-10-04"]').textContent.includes('published — skipped');`));
    const createBtn = `[...${dlg}.querySelectorAll('button')].find(b => /^Create/.test(b.textContent.trim()))`;
    await evaluate(`${createBtn}.click();`);
    check("建好：绿条写 for 2 weeks、1 published week skipped（Period 标签上也看得到）", await waitFor("document.querySelector('[data-autofill-banner]')?.textContent.includes('for 2 weeks') && document.querySelector('[data-autofill-banner]').textContent.includes('1 published week skipped') && !!document.querySelector('[data-period]')", 30000), await evaluate("return document.querySelector('[data-autofill-banner]')?.textContent;"));
    const pb = (await (await fetch(`${MOCK}/__log`)).json()).slice(r0).filter((e) => e.path.endsWith("/slots/bulk"));
    check("一周一个 bulk（10/11、10/18），10/11 也直接建（不放到页面上等 Save）", pb.length === 2 && pb.some((e) => e.path.includes("2026-10-11")) && pb.some((e) => e.path.includes("2026-10-18")), JSON.stringify(pb.map((e) => e.path)));
    const vWeek = (ws) => {
      const [y, m, dd] = ws.split("-").map(Number);
      const days = [1, 2, 3, 4, 5].map((d) => new Date(Date.UTC(y, m - 1, dd + d)).toISOString().slice(0, 10));
      return (pb.find((e) => e.path.includes(ws))?.body?.slots || []).filter((x) => x.employee_id === 1 && days.includes(x.date) && x.shift_type === "open").length;
    };
    check("取消的 Fixed shift 这次没执行：Veronica 不是两周周一到周五都 Open", !(vWeek("2026-10-11") === 5 && vWeek("2026-10-18") === 5), `${vWeek("2026-10-11")} ${vWeek("2026-10-18")}`);
    const rd = await (await fetch(`${MOCK}/api/schedule/rules`)).json();
    check("Rules 标签不变：Fixed shift 仍开着", rd.rules.find((r) => r.id === "f1")?.enabled === true);
    await waitFor("document.querySelector('[data-period-grid]')", 30000);
    // 点周名 ⇒ 回 Schedule 标签看那一周
    await evaluate("document.querySelector('[data-period-week=\"2026-10-18\"] button').click();");
    check("点 Week of Oct 18 ⇒ 回 Schedule 标签、看 10/18 那周", await waitFor("[...document.querySelectorAll('[role=tab]')].find(b => b.getAttribute('aria-selected') === 'true')?.textContent.trim() === 'Schedule' && !!document.querySelector('[data-cell$=\"|2026-10-18\"]')", 30000));
    await ctl({ role: "supervisor", meName: "" });
  }

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

  // 休假：Lizzie 周二录休假 + 备注（置顶 117 今晚只有一种 Leave，存成 pto）
  await evaluate(`${cell("2|2026-12-08")}.querySelector('button[aria-label="Add a shift"]').click();`);
  await waitFor(`${dlg} && ${dlg}.querySelector('[data-mode=off]')`);
  await evaluate(`${dlg}.querySelector('[data-mode=off]').click();`);
  check("二期 / 117：Time off 模式：标题 Add time off、只有一种 Leave（今晚不分 PTO / Sick / Personal）", await evaluate(`return ${dlg}.textContent.includes('Add time off') && !!$btn('Leave', ${dlg}) && !$btn('PTO', ${dlg}) && !$btn('Sick', ${dlg}) && !$btn('Personal', ${dlg}) && ${dlg}.querySelectorAll('[data-kind]').length === 1 && !${dlg}.querySelector('input[data-time-input]');`));
  await evaluate(`${dlg}.querySelector('[data-kind=pto]').click(); $setValue(${dlg}.querySelector('[data-note-input]'), 'Back Thursday');`);
  check("Add day off 直接存进系统 ⇒ 照旧蓝色提交键（Annie 2026-10-30）", await evaluate(`return getComputedStyle($btn('Add day off', ${dlg})).backgroundColor === 'rgb(59, 130, 246)';`));
  await evaluate(`$btn('Add day off', ${dlg}).click();`);
  check("二期 / 117：录好 ⇒ 格子写 Leave + 备注 Back Thursday，窗口关了", await waitFor(`${hasText(`${cell("2|2026-12-08")}.querySelector('[data-time-off=pto]')`, "Leave")} && ${hasText(`${cell("2|2026-12-08")}.querySelector('[data-time-off=pto]')`, "Back Thursday")} && !${dlg}`));
  check("二期：休假格子比 Off 深一档的黄、主管有 ×", await evaluate(`const el = ${cell("2|2026-12-08")}.querySelector('[data-time-off]'); return getComputedStyle(el).backgroundColor.includes('0.28') && !!el.querySelector('[data-remove-time-off]');`));
  check("二期：同一天没有 Off 格子", await evaluate(`return !${cell("2|2026-12-08")}.querySelector('[data-off]');`));
  const toCall = (await (await fetch(`${MOCK}/__log`)).json()).filter((e) => e.path === "/api/schedule/time-off");
  // 置顶 117：前面 117 的检查也会 PUT time-off，这里只看这一次（2026-12-08）；今晚只有一种，存成 pto。
  const toThis = toCall.filter((e) => e.body?.dates?.includes("2026-12-08"));
  check("二期 / 117：PUT /api/schedule/time-off body 对（employee 2、dates、kind pto、note）", toThis.length === 1 && toThis[0].body.employee_id === 2 && toThis[0].body.kind === "pto" && toThis[0].body.note === "Back Thursday" && toThis[0].body.dates.join() === "2026-12-08", JSON.stringify(toCall));

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
  check("二期 / 117：员工看得到别人的休假和备注（存的是 personal，今晚一律写 Leave / Family）", await waitFor(`${hasText(`${cell("4|2026-09-28")}.querySelector('[data-time-off=personal]')`, "Leave")} && ${hasText(`${cell("4|2026-09-28")}.querySelector('[data-time-off=personal]')`, "Family")}`));
  check("二期：员工没有 ×、没有 + note、没有加班键", await evaluate(`return !document.querySelector('[data-remove-time-off]') && !document.querySelector('[data-add-note]') && !document.querySelector('button[aria-label="Add a shift"]');`));

  // ── ⚙ Settings：Working hours / Default shift times 集中一处（Annie 2026-11-02「所以两个edit，到底哪个管用」「可以集中在一起管各自不同的功能么」；
  //    preview 97MgNcpw28p7W4DxXmpgrM 第 3 版「同意全部推荐。动手」；能改照 Team 页的勾 settings.schedule）──
  const SD = "document.querySelector('[data-schedule-settings]')";
  const openSettings = async () => {
    await evaluate("document.querySelector('[data-open-settings]').click();");
    await waitFor(SD);
  };
  await ctl({ role: "supervisor", meName: "" });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor("document.querySelector('[data-open-settings]')");
  check("页面上没有原来那两个 Edit（Working hours / Default shift times 两行都搬进 ⚙ Settings）", await evaluate("return !document.querySelector('[data-default-times]') && ![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Edit' && b.closest('main') && /Working hours|Default shift times/.test(b.parentElement.textContent));"));
  check("Day timeline 卡头一行只读：Working hours 3:00 AM – 9:30 PM — gaps are checked inside these hours.（前面已改成 3:00 AM）", await waitFor("document.querySelector('[data-working-hours]')?.textContent.replace(/\\s+/g, ' ').trim() === 'Working hours 3:00 AM – 9:30 PM — gaps are checked inside these hours.'"), await evaluate("return document.querySelector('[data-working-hours]')?.textContent;"));
  // 有 schedule.edit、没有 settings.schedule 勾的排班人：能打开、只读
  await ctl({ tick: { switchOn: false, codes: STANDARD_SUP.filter((c) => c !== "settings.schedule") } });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor("document.querySelector('[data-open-settings]')");
  await openSettings();
  const roText = await evaluate(`return ${SD}.textContent;`);
  check("没勾 settings.schedule 的排班人：⚙ Settings 打开只读——时间是字、没有 Save，底下写怎么要权限", ["3:00 AM – 9:30 PM", "Open 2:00 AM – 10:00 AM", "Mid 8:00 AM – 5:00 PM", "Close 1:30 PM – 9:30 PM", "Gaps are checked inside these hours.", "Default times pre-fill new shifts only.", "Settings: Schedule work window and shift types"].every((t) => roText.includes(t)) && (await evaluate(`return !${SD}.querySelector('[data-settings-save]') && !${SD}.querySelector('input');`)), roText);
  await evaluate(`$btn('Close', ${SD}).click();`);
  await waitFor(`!${SD}`);
  await ctl({ tick: null, role: "staff", meName: "Veronica" });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor(`${cell("4|2026-09-28")}`);
  check("只能看的员工：没有 ⚙ Settings 键，也没有 Working hours 那一行", await evaluate("return !document.querySelector('[data-open-settings]') && !document.querySelector('[data-working-hours]');"));
  // Super Admin（supervisor 的角色标准里也有 settings.schedule）：能改
  await ctl({ role: "superadmin", meName: "" });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor("document.querySelector('[data-open-settings]')");
  await openSettings();
  check("能改的人：两块时间都是输入框，Save 灰着（没改）", await evaluate(`return !!${SD}.querySelector('input[aria-label="Working hours start"]') && !!${SD}.querySelector('input[aria-label="Open start"]') && ${SD}.querySelector('[data-settings-save]').disabled;`));
  let setFrom = (await mockLog()).length;
  await evaluate(`const f = ${SD}; $setValue(f.querySelector('input[aria-label="Open start"]'), '03:00'); $setValue(f.querySelector('input[aria-label="Open end"]'), '11:00');`);
  check("改了 Open：先暂存，黄字 Not saved yet: default times for Open changed，没发请求", (await waitFor(`${SD}.querySelector('[data-settings-unsaved]')?.textContent === 'Not saved yet: default times for Open changed'`)) && (await since(setFrom, (e) => e.method === "PUT")).length === 0, await evaluate(`return ${SD}.querySelector('[data-settings-unsaved]')?.textContent;`));
  await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
  check("按 Save：绿字 Saved；只发了 open 一个 PUT（03:00 / 11:00），没碰 work-window", (await waitFor(`!!${SD}.querySelector('[data-settings-saved]')`)) && JSON.stringify((await since(setFrom, (e) => e.method === "PUT")).map((e) => [e.path, e.body.default_start_time, e.body.default_end_time])) === JSON.stringify([["/api/settings/schedule/shift-types/open", "03:00", "11:00"]]), JSON.stringify((await since(setFrom, (e) => e.method === "PUT")).map((e) => [e.path, e.body])));
  setFrom = (await mockLog()).length;
  await evaluate(`$setValue(${SD}.querySelector('input[aria-label="Working hours end"]'), '21:00');`);
  await waitFor(`${SD}.querySelector('[data-settings-unsaved]')?.textContent === 'Not saved yet: working hours changed'`);
  await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
  check("改 Working hours 结束 9:00 PM 按 Save：PUT work-window {03:00, 21:00}，卡头那一行跟着变 9:00 PM", (await waitFor(`!!${SD}.querySelector('[data-settings-saved]')`)) && JSON.stringify((await since(setFrom, (e) => e.method === "PUT"))[0]?.body) === JSON.stringify({ start_time: "03:00", end_time: "21:00" }) && (await waitFor("document.querySelector('[data-working-hours]')?.textContent.includes('9:00 PM')")), JSON.stringify((await since(setFrom, (e) => e.method === "PUT"))[0]?.body));
  // 没存就关：先问
  await evaluate(`$setValue(${SD}.querySelector('input[aria-label="Open end"]'), '12:00');`);
  await waitFor(`!!${SD}.querySelector('[data-settings-unsaved]')`);
  await evaluate(`${SD}.querySelector('button[aria-label="Close"]').click();`);
  check("有没存的改动时点 ×：不关，问 Keep editing / Discard / Save", await waitFor(`!!${SD}?.querySelector('[data-settings-ask-close]')`));
  await evaluate(`$btn('Discard', ${SD}.querySelector('[data-settings-ask-close]')).click();`);
  await waitFor(`!${SD}`);
  await openSettings();
  check("Discard 后再打开：Open 还是存好的 11:00 AM", await evaluate(`return ${SD}.querySelector('input[aria-label="Open end"]').value === '11:00 AM';`), await evaluate(`return ${SD}.querySelector('input[aria-label="Open end"]').value;`));
  // 后端 400：红字写哪一块、后端原话，改动留在页面上
  setFrom = (await mockLog()).length;
  // 清空要按 Enter / 离开输入框才生效（TimePicker：读不懂 / 清空等收起时再整理）
  await evaluate(`const el = ${SD}.querySelector('input[aria-label="Mid start"]'); el.focus(); $setValue(el, ''); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await waitFor(`!!${SD}.querySelector('[data-settings-unsaved]')`);
  await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
  // 置顶 85 起页面上先查（默认时间只填一个），不送后端。
  check("只清了 Mid 的开始：红字「Enter both default times for Mid, or leave both empty.」，没发请求，没存的还在（输入框还是空的、Save 能按）", (await waitFor(`${SD}.querySelector('[data-settings-error]')?.textContent === 'Enter both default times for Mid, or leave both empty.'`)) && (await since(setFrom, (e) => e.method === "PUT")).length === 0 && (await evaluate(`return ${SD}.querySelector('input[aria-label="Mid start"]').value === '' && !${SD}.querySelector('[data-settings-save]').disabled;`)), await evaluate(`return ${SD}.querySelector('[data-settings-error]')?.textContent;`));
  // 后端 400：红字写哪一种、后端原话，改动留在页面上
  await evaluate(`$setValue(${SD}.querySelector('input[aria-label="Mid start"]'), '08:00');`);
  await evaluate(`$setValue(${SD}.querySelector('input[aria-label="Mid end"]'), '08:00');`);
  await waitFor(`!!${SD}.querySelector('[data-settings-unsaved]')`);
  await ctl({ shiftTypePutFail: "mid" });
  await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
  check("后端 400（Mid）：红字「Shift type not saved — Mid: 后端原话」，改动留着、Save 能再按", (await waitFor(`${SD}.querySelector('[data-settings-error]')?.textContent === 'Shift type not saved — Mid: default_start_time and default_end_time cannot be the same.'`)) && (await evaluate(`return ${SD}.querySelector('input[aria-label="Mid end"]').value !== '' && !${SD}.querySelector('[data-settings-save]').disabled;`)), await evaluate(`return ${SD}.querySelector('input[aria-label="Mid start"]').value + ' / ' + ${SD}.querySelector('input[aria-label="Mid end"]').value + ' / save disabled ' + ${SD}.querySelector('[data-settings-save]').disabled;`));
  await ctl({ shiftTypePutFail: null });
  await evaluate(`$btn('Cancel', ${SD}).click();`);
  await waitFor(`!!${SD}.querySelector('[data-settings-ask-close]')`);
  await evaluate(`$btn('Discard', ${SD}.querySelector('[data-settings-ask-close]')).click();`);
  await waitFor(`!${SD}`);
  await fetch(`${MOCK}/api/settings/schedule/work-window`, { method: "PUT", body: JSON.stringify({ start_time: "03:00", end_time: "21:30" }) });
  await fetch(`${MOCK}/api/settings/schedule/shift-types/open`, { method: "PUT", body: JSON.stringify({ default_start_time: "02:00", default_end_time: "10:00" }) });

  // ── Working hours 按星期几（Annie 2026-11-02「可以选择一周的时间，也可以分别设置几天的时间不同」，⑦⑧⑨ A；后端 v144 work_hours）──
  await ctl({ workHours: true, role: "superadmin", meName: "" });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor("document.querySelector('[data-open-settings]')");
  await openSettings();
  check("后端带 work_hours：Working hours 两个选项，默认 Same every day（一组 3:00 AM – 9:30 PM），没有七行", await evaluate(`return ${SD}.querySelector('[data-hours-mode="same"]').checked && !${SD}.querySelector('[data-work-day]') && ${SD}.querySelector('input[aria-label="Working hours start"]').value === '3:00 AM';`));
  await evaluate(`${SD}.querySelector('[data-hours-mode="by-day"]').click();`);
  await waitFor(`${SD}.querySelectorAll('[data-work-day]').length === 7`);
  check("点 Different by day：Mon–Sun 七行都先填上那一组，每行一个 No coverage needed，下面 Copy Monday to all days；换了方式也算改动（黄字 Not saved yet）", await evaluate(`return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].every((d) => ${SD}.querySelector('input[aria-label="' + d + ' start"]').value === '3:00 AM' && ${SD}.querySelector('input[aria-label="' + d + ' end"]').value === '9:30 PM') && ${SD}.querySelectorAll('[data-day-off]').length === 7 && !!${SD}.querySelector('[data-copy-monday]') && ${SD}.querySelector('[data-settings-unsaved]')?.textContent === 'Not saved yet: working hours changed';`));
  let whFrom = (await mockLog()).length;
  await evaluate(`$setValue(${SD}.querySelector('input[aria-label="Sat start"]'), '04:00'); $setValue(${SD}.querySelector('input[aria-label="Sat end"]'), '21:00'); ${SD}.querySelector('[data-day-off="6"]').click();`);
  await waitFor(`${SD}.querySelector('[data-settings-unsaved]')?.textContent === 'Not saved yet: working hours changed'`);
  await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
  await waitFor(`!!${SD}.querySelector('[data-settings-saved]') || !!${SD}.querySelector('[data-settings-error]')`);
  const whBody = (await since(whFrom, (e) => e.method === "PUT" && e.path === "/api/settings/schedule/work-hours"))[0]?.body;
  check("Sat 改 4:00 AM – 9:00 PM、Sun 勾 No coverage needed，按 Save：一次 PUT /work-hours，7 天整份（same_every_day=false），绿字 Saved；没碰 work-window", !!whBody && whBody.same_every_day === false && whBody.days.length === 7 && JSON.stringify(whBody.days[5]) === JSON.stringify({ weekday: 5, start_time: "04:00", end_time: "21:00", off: false }) && whBody.days[6].off === true && whBody.days[0].start_time === "03:00" && whBody.days[0].end_time === "21:30" && (await since(whFrom, (e) => e.path === "/api/settings/schedule/work-window")).length === 0 && (await evaluate(`return !!${SD}.querySelector('[data-settings-saved]');`)), JSON.stringify(whBody));
  await evaluate(`$btn('Close', ${SD}).click();`);
  await waitFor(`!${SD}`);
  check("Day timeline 卡头那行按天写：Mon–Fri 3:00 AM – 9:30 PM · Sat 4:00 AM – 9:00 PM · Sun no coverage needed", await waitFor("document.querySelector('[data-working-hours]')?.textContent.replace(/\\s+/g, ' ').trim() === 'Working hours Mon–Fri 3:00 AM – 9:30 PM · Sat 4:00 AM – 9:00 PM · Sun no coverage needed — gaps are checked inside these hours.'"), await evaluate("return document.querySelector('[data-working-hours]')?.textContent.replace(/\\s+/g, ' ').trim();"));
  check("空档按当天：Sun 12/06（No coverage needed）没有红点，Sat 12/12 有", await waitFor(`!document.querySelector('[data-day-tab="${P2}"][data-has-gap]') && !!document.querySelector('[data-day-tab="2026-12-12"][data-has-gap]')`));
  await evaluate("document.querySelector('[data-day-tab=\"2026-12-12\"]').click();");
  check("Day timeline 看 Sat：刻度两头 4 AM / 9 PM，Nobody 4:00 AM – 9:00 PM", await waitFor("[...document.querySelectorAll('[data-nobody-row]')].some((r) => r.textContent.includes('4:00 AM – 9:00 PM')) && document.querySelector('[data-axis-step=\"2\"] span')?.textContent === '4 AM' && [...document.querySelectorAll('[data-axis-step=\"2\"] span')].pop().textContent === '9 PM'"), await evaluate("return [...document.querySelectorAll('[data-axis-step=\"2\"] span')].map((x) => x.textContent).join(',');"));
  await evaluate(`document.querySelector('[data-day-tab="${P2}"]').click();`);
  check("Day timeline 看 Sun：Gaps 那一句写 none — no coverage needed on this day", await waitFor("!!document.querySelector('[data-gaps-line] [data-no-coverage]')"));
  // 只读的人看到的也是按天那一句
  await ctl({ role: "admin", tick: { switchOn: false, codes: STANDARD_SUP.filter((c) => c !== "settings.schedule") } });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor("document.querySelector('[data-open-settings]')");
  await openSettings();
  check("没勾 settings.schedule 的人：Working hours 只读一句，按天写", await evaluate(`return ${SD}.querySelector('[data-settings-hours]').textContent.includes('Mon–Fri 3:00 AM – 9:30 PM · Sat 4:00 AM – 9:00 PM · Sun no coverage needed') && !${SD}.querySelector('input');`));
  await evaluate(`$btn('Close', ${SD}).click();`);
  await ctl({ role: "superadmin", tick: null });
  await openPage(`${APP}/schedule?week=${P2}`);
  await waitFor("document.querySelector('[data-open-settings]')");
  await openSettings();
  check("再打开：Different by day 选着，Sat 4:00 AM、Sun 勾着", await evaluate(`return ${SD}.querySelector('[data-hours-mode="by-day"]').checked && ${SD}.querySelector('input[aria-label="Sat start"]').value === '4:00 AM' && ${SD}.querySelector('[data-day-off="6"]').checked;`));
  // 400：后端原话红字
  await evaluate(`$setValue(${SD}.querySelector('input[aria-label="Mon end"]'), '03:00');`);
  await waitFor(`!!${SD}.querySelector('[data-settings-unsaved]')`);
  await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
  check("Mon 开始 = 结束：后端 400，红字「Working hours not saved — Monday: start and end time cannot be the same.」，改动留着", await waitFor(`${SD}.querySelector('[data-settings-error]')?.textContent.includes('Working hours not saved — Monday: start and end time cannot be the same.')`), await evaluate(`return ${SD}.querySelector('[data-settings-error]')?.textContent;`));
  await evaluate(`$setValue(${SD}.querySelector('input[aria-label="Mon end"]'), '21:30');`);
  // Copy Monday + 切回 Same every day
  await evaluate(`${SD}.querySelector('[data-copy-monday]').click();`);
  check("Copy Monday to all days：Sat 变回 3:00 AM – 9:30 PM（Sun 的勾不动）", await waitFor(`${SD}.querySelector('input[aria-label="Sat start"]').value === '3:00 AM' && ${SD}.querySelector('input[aria-label="Sat end"]').value === '9:30 PM' && ${SD}.querySelector('[data-day-off="6"]').checked`));
  await evaluate(`${SD}.querySelector('[data-hours-mode="same"]').click();`);
  check("切回 Same every day：用 Monday 那一组，黄字 All days will use 3:00 AM – 9:30 PM.", await waitFor(`${SD}.textContent.includes('All days will use 3:00 AM – 9:30 PM.') && !${SD}.querySelector('[data-work-day]')`));
  whFrom = (await mockLog()).length;
  await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
  await waitFor(`!!${SD}.querySelector('[data-settings-saved]')`);
  const sameBody = (await since(whFrom, (e) => e.method === "PUT" && e.path === "/api/settings/schedule/work-hours"))[0]?.body;
  check("按 Save：same_every_day=true，7 天都是 03:00–21:30、都不勾", !!sameBody && sameBody.same_every_day === true && sameBody.days.every((d) => d.start_time === "03:00" && d.end_time === "21:30" && d.off === false), JSON.stringify(sameBody));
  await evaluate(`$btn('Close', ${SD}).click();`);
  await ctl({ workHours: false });
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

  // ── 置顶 85：⚙ Settings › Shift types（Annie 2026-11-04「排班这个全部同意推荐，动手吧」，preview v4 9LFRCau1uBg5sQ5aPbdSZt）──
  //    新增 / 改名 / 停用（+ 还有规则在用的黄字）/ 排序 / 颜色；全部暂存、按 Save 一起存；Unassigned 不上色。
  {
    const ST = `${SD}.querySelector('[data-shift-types]')`;
    const rowOf = (id) => `${SD}.querySelector('[data-shift-type-row="${id}"]')`;
    const newRow = `[...${SD}.querySelectorAll('[data-shift-type-row][data-new]')].pop()`;
    const savedTypes = async () => (await (await fetch(`${MOCK}/api/settings/schedule`)).json()).shift_types;
    const waitSaved = () => waitFor(`!!${SD}.querySelector('[data-settings-saved]') || !!${SD}.querySelector('[data-settings-error]')`);
    const unsavedText = () => evaluate(`return ${SD}.querySelector('[data-settings-unsaved]')?.textContent;`);
    const errText = () => evaluate(`return ${SD}.querySelector('[data-settings-error]')?.textContent;`);
    const order = () => evaluate(`return [...${SD}.querySelectorAll('[data-shift-type-row]')].map((r) => r.dataset.shiftTypeRow).join(',');`);
    const writes = (from) => since(from, (e) => (e.method === "POST" || e.method === "PUT") && e.path.startsWith("/api/settings/schedule/shift-types"));
    await ctl({ phase2: true, role: "superadmin", tick: null, resetShiftTypes: true, shiftColors: false });
    const rulesBefore = await (await fetch(`${MOCK}/api/schedule/rules`)).json();
    await openPage(`${APP}/schedule?week=${P2}`);
    await waitFor("document.querySelector('[data-open-settings]')");
    await openSettings();
    check(
      "85 Shift types：标题 Shift types，三行 Open / Mid / Close（⋮⋮、色块、名字框、两格默认时间、Active 勾着），说明里有 How to use 那段",
      (await order()) === "open,mid,close" &&
        (await evaluate(`const s = ${SD}.querySelector('[data-settings-defaults]'); return s.querySelector('h3').textContent.trim().startsWith('Shift types') && [...s.querySelectorAll('[data-shift-type-row]')].every((r) => r.querySelector('[data-shift-type-grip]') && r.querySelector('[data-shift-type-color]') && r.querySelector('input[data-shift-type-name]') && r.querySelectorAll('input:not([data-shift-type-name]):not([type=checkbox])').length === 2 && r.querySelector('[data-shift-type-active]').checked) && s.querySelector('[data-shift-types-help]').textContent.includes('Drag ⋮⋮ to change the order of the buttons in Add shift.') && s.textContent.includes('Default times pre-fill new shifts only.');`)),
      await evaluate(`const s = ${SD}.querySelector('[data-settings-defaults]'); return JSON.stringify({ labels: [...s.querySelector('[data-shift-type-row]').querySelectorAll('input')].map((i) => i.getAttribute('aria-label') + ':' + i.type), all: [...${SD}.querySelectorAll('input')].map((i) => i.getAttribute('aria-label')).join('|'), h3: s.querySelector('h3').textContent, rows: [...s.querySelectorAll('[data-shift-type-row]')].map((r) => [!!r.querySelector('[data-shift-type-grip]'), !!r.querySelector('[data-shift-type-color]'), !!r.querySelector('input[data-shift-type-name]'), r.querySelectorAll('input:not([data-shift-type-name]):not([type=checkbox])').length, r.querySelector('[data-shift-type-active]')?.checked]), help: s.querySelector('[data-shift-types-help]')?.textContent });`),
    );
    check("85 旧后端没 color：色块按 key 给 Open 绿 / Mid 蓝 / Close 紫", await evaluate(`return [...${SD}.querySelectorAll('[data-shift-type-color]')].map((b) => b.dataset.shiftTypeColor).join(',') === 'open,mid,close';`));
    check(
      "85 「+ Add shift type」是灰绿 #6b8e74、白字",
      await evaluate(`const b = ${SD}.querySelector('[data-add-shift-type]'); const cs = getComputedStyle(b); return b.textContent.trim() === '+ Add shift type' && cs.backgroundColor === 'rgb(107, 142, 116)' && cs.color === 'rgb(255, 255, 255)';`),
      await evaluate(`return getComputedStyle(${SD}.querySelector('[data-add-shift-type]')).backgroundColor;`),
    );
    // 后端还不存颜色（settings 没带 color 键，2c 2026-11-04「现在就合，不等 color」）：只显示默认色，不给挑；新类型灰白；POST 不带 color。
    check("85 旧后端没 color：色块只是显示（不是按钮），没有选色小窗", await evaluate(`return [...${SD}.querySelectorAll('[data-shift-type-row]')].every((r) => { const s = [...r.querySelectorAll('[data-shift-type-color]')]; return s.length === 1 && s[0].tagName === 'SPAN' && s[0].hasAttribute('data-color-fixed'); }) && !${SD}.querySelector('[data-shift-color-pop]');`));
    let ncFrom = (await mockLog()).length;
    await evaluate(`${SD}.querySelector('[data-add-shift-type]').click();`);
    await waitFor(`!!${newRow}`);
    check("85 旧后端没 color：新加的一行是灰白色块", await evaluate(`return ${newRow}.querySelector('[data-shift-type-color]').dataset.shiftTypeColor === 'grey';`));
    await evaluate(`$setValue(${newRow}.querySelector('input[data-shift-type-name]'), 'ZZ Test Nocolor');`);
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    await waitSaved();
    let ncw = await writes(ncFrom);
    check("85 旧后端没 color：按 Save 的 POST 不带 color", ncw.length === 1 && ncw[0].method === "POST" && !("color" in ncw[0].body) && ncw[0].body.key === "zz_test_nocolor", JSON.stringify(ncw.map((e) => e.body)));
    // 下面照后端上了 color 列来测（选色小窗、存颜色）。
    await evaluate(`$btn('Close', ${SD}).click();`);
    await waitFor(`!${SD}`);
    await ctl({ resetShiftTypes: true, shiftColors: true });
    await openPage(`${APP}/schedule?week=${P2}`);
    await waitFor("document.querySelector('[data-open-settings]')");
    await openSettings();
    check("85 后端带 color：色块是按钮，能点开选色", await evaluate(`return [...${SD}.querySelectorAll('[data-shift-type-row] [data-shift-type-color]')].every((b) => b.tagName === 'BUTTON');`));
    // 新增：空名字挡住
    let stFrom = (await mockLog()).length;
    await evaluate(`${SD}.querySelector('[data-add-shift-type]').click();`);
    check(
      "85 点 + Add shift type：多一行空的（颜色 = 还没人用的黄），名字框拿到焦点，黄字 Not saved yet: new shift type added",
      (await waitFor(`!!${newRow}`)) &&
        (await evaluate(`const r = ${newRow}; return r.querySelector('[data-shift-type-color]').dataset.shiftTypeColor === 'amber' && document.activeElement === r.querySelector('input[data-shift-type-name]');`)) &&
        (await unsavedText()) === "Not saved yet: new shift type added",
      await unsavedText(),
    );
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    check(
      "85 名字空着按 Save：红字「Enter a name for the new shift type.」、名字框红框，没发请求",
      (await waitFor(`${SD}.querySelector('[data-settings-error]')?.textContent === 'Enter a name for the new shift type.'`)) &&
        (await evaluate(`return ${newRow}.querySelector('input[data-shift-type-name]').className.includes('border-red-400');`)) &&
        (await writes(stFrom)).length === 0,
      await errText(),
    );
    // 重名挡住
    await evaluate(`$setValue(${newRow}.querySelector('input[data-shift-type-name]'), 'open');`);
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    check(
      "85 跟已有的重名（不分大小写）：红字「There is already a shift type called “open”.」，没发请求",
      (await waitFor(`${SD}.querySelector('[data-settings-error]')?.textContent === 'There is already a shift type called “open”.'`)) && (await writes(stFrom)).length === 0,
      await errText(),
    );
    // 填好：名字、颜色、默认时间
    await evaluate(`$setValue(${newRow}.querySelector('input[data-shift-type-name]'), 'ZZ Test Training');`);
    await evaluate(`${newRow}.querySelector('[data-shift-type-color]').click();`);
    check(
      "85 点色块：出 8 种颜色（绿蓝紫黄粉青橙灰），标题 Colour for ZZ Test Training",
      (await waitFor(`!!${SD}.querySelector('[data-shift-color-pop]')`)) &&
        (await evaluate(`const p = ${SD}.querySelector('[data-shift-color-pop]'); return [...p.querySelectorAll('[data-pick-color]')].map((b) => b.dataset.pickColor).join(',') === 'open,mid,close,amber,rose,teal,orange,grey' && p.textContent.includes('Colour for ZZ Test Training');`)),
    );
    await evaluate(`${SD}.querySelector('[data-shift-color-pop] [data-pick-color="teal"]').click();`);
    await evaluate(`const r = ${newRow}; $setValue(r.querySelector('input[aria-label="ZZ Test Training start"]'), '13:00'); $setValue(r.querySelector('input[aria-label="ZZ Test Training end"]'), '16:00');`);
    check(
      "85 选了青色、填了 1:00 PM – 4:00 PM：小窗收起，黄字 Not saved yet: new shift type ZZ Test Training added",
      (await waitFor(`!${SD}.querySelector('[data-shift-color-pop]') && ${newRow}.querySelector('[data-shift-type-color]').dataset.shiftTypeColor === 'teal'`)) &&
        (await unsavedText()) === "Not saved yet: new shift type ZZ Test Training added",
      await unsavedText(),
    );
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    await waitSaved();
    let w = await writes(stFrom);
    check(
      "85 按 Save：一个 POST（key 从名字来 zz_test_training、sort_order 接在最后 13、teal、13:00–16:00），没 PUT 别的类型，绿字 Saved，那一行变成已存的",
      w.length === 1 &&
        w[0].method === "POST" &&
        JSON.stringify(w[0].body) === JSON.stringify({ label: "ZZ Test Training", sort_order: 13, default_start_time: "13:00", default_end_time: "16:00", color: "teal", key: "zz_test_training" }) &&
        (await evaluate(`return !!${SD}.querySelector('[data-settings-saved]') && !!${rowOf("zz_test_training")} && !${SD}.querySelector('[data-shift-type-row][data-new]');`)),
      JSON.stringify(w.map((e) => [e.method, e.body])) + " " + (await errText()),
    );
    // × 去掉没存的新行
    await evaluate(`${SD}.querySelector('[data-add-shift-type]').click();`);
    await waitFor(`!!${newRow}`);
    await evaluate(`${newRow}.querySelector('[data-remove-new-type]').click();`);
    check("85 没存的新行点 ×：去掉，黄字没了", await waitFor(`!${SD}.querySelector('[data-shift-type-row][data-new]') && !${SD}.querySelector('[data-settings-unsaved]')`));
    // key 重了加 _2
    stFrom = (await mockLog()).length;
    await evaluate(`${SD}.querySelector('[data-add-shift-type]').click();`);
    await waitFor(`!!${newRow}`);
    await evaluate(`$setValue(${newRow}.querySelector('input[data-shift-type-name]'), 'ZZ Test  Training!');`);
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    await waitSaved();
    w = await writes(stFrom);
    check(
      "85 名字生成的 key 已经有了：加 _2（zz_test_training_2），没填时间送 null",
      w.length === 1 && w[0].body.key === "zz_test_training_2" && w[0].body.default_start_time === null && w[0].body.default_end_time === null,
      JSON.stringify(w.map((e) => e.body)),
    );
    // 改名
    stFrom = (await mockLog()).length;
    await evaluate(`$setValue(${rowOf("mid")}.querySelector('input[data-shift-type-name]'), 'Midday');`);
    check(
      "85 改名 Mid → Midday：名字框黄框，下面黄字「Was “Mid” — not saved yet」，页脚 Not saved yet: Mid renamed",
      (await waitFor(`${rowOf("mid")}.querySelector('[data-shift-type-was]')?.textContent === 'Was “Mid” — not saved yet'`)) &&
        (await evaluate(`return ${rowOf("mid")}.querySelector('input[data-shift-type-name]').className.includes('border-amber-400');`)) &&
        (await unsavedText()) === "Not saved yet: Mid renamed",
      await unsavedText(),
    );
    await evaluate(`${SD}.querySelector('button[aria-label="Close"]').click();`);
    check("85 改了名没存就点 ×：不关，问 Keep editing / Discard / Save", await waitFor(`!!${SD}?.querySelector('[data-settings-ask-close]')`));
    await evaluate(`$btn('Keep editing', ${SD}.querySelector('[data-settings-ask-close]')).click();`);
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    await waitSaved();
    w = await writes(stFrom);
    check(
      "85 改名按 Save：只 PUT mid 一个（label Midday；sort_order / Active / 默认时间照旧；key 不变），绿字 Saved，黄字没了",
      w.length === 1 &&
        w[0].path === "/api/settings/schedule/shift-types/mid" &&
        w[0].body.label === "Midday" &&
        w[0].body.sort_order === 2 &&
        w[0].body.is_active === true &&
        w[0].body.default_start_time === "08:00" &&
        (await evaluate(`return !!${SD}.querySelector('[data-settings-saved]') && !${rowOf("mid")}.querySelector('[data-shift-type-was]');`)),
      JSON.stringify(w.map((e) => [e.path, e.body])),
    );
    // 排序（键盘 ↑，同拖 ⋮⋮）
    stFrom = (await mockLog()).length;
    await evaluate(`const g = ${rowOf("close")}.querySelector('[data-shift-type-grip]'); g.focus(); g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));`);
    check(
      "85 ⋮⋮ 把 Close 挪到 Midday 前面：先暂存（没发请求），黄字 order of shift types changed",
      (await waitFor(`[...${SD}.querySelectorAll('[data-shift-type-row]')].map((r) => r.dataset.shiftTypeRow).join(',') === 'open,close,mid,zz_test_training,zz_test_training_2'`)) &&
        (await unsavedText()) === "Not saved yet: order of shift types changed" &&
        (await writes(stFrom)).length === 0,
      (await order()) + " / " + (await unsavedText()),
    );
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    await waitSaved();
    const so = (await savedTypes()).map((t) => `${t.key}:${t.sort_order}`).join(",");
    check("85 排序按 Save：整份按 10、20、30… 重排，库里顺序 Open, Close, Midday, ZZ Test Training…", so === "open:10,close:20,mid:30,zz_test_training:40,zz_test_training_2:50", so);
    await evaluate(`$btn('Close', ${SD}).click();`);
    await waitFor(`!${SD}`);
    // Add shift 弹窗：顺序 + 改名
    const addDlg = "[...document.querySelectorAll('[role=dialog]')].find((d) => d.textContent.includes('Add shift'))";
    const shiftButtons = `const d = ${addDlg}; return d ? [...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => ['Open', 'Close', 'Midday', 'Mid', 'ZZ Test Training', 'ZZ Test  Training!'].includes(t)).join(',') : '';`;
    await evaluate(`${cell("needs|" + P2)}.querySelector('button[aria-label="Add a shift"]').click();`);
    await waitFor(addDlg);
    const btns1 = await evaluate(shiftButtons);
    check("85 Add shift 弹窗：Shift 那一排按新顺序 Open, Close, Midday, ZZ Test Training…（改名跟着变）", btns1.startsWith("Open,Close,Midday,ZZ Test Training"), btns1);
    await evaluate(`const d = ${addDlg}; $btn('Cancel', d)?.click();`);
    await waitFor(`!${addDlg}`);
    // 停用 + 还有规则在用的黄字
    const coverageRule = { id: "zz85", type: "coverage", enabled: true, params: { shift_type: "zz_test_training", min: 1, days: [5] } };
    await fetch(`${MOCK}/api/schedule/rules`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rulesBefore, rules: [...(rulesBefore.rules || []), coverageRule] }) });
    await openPage(`${APP}/schedule?week=${P2}`);
    await waitFor("document.querySelector('[data-open-settings]')");
    await openSettings();
    stFrom = (await mockLog()).length;
    await evaluate(`${rowOf("zz_test_training")}.querySelector('[data-shift-type-active]').click();`);
    check(
      "85 停用 ZZ Test Training（还有一条规则用它）：那一行变淡，名单下面黄字写哪条规则、Auto-fill 还会照规则排",
      (await waitFor(`!!${SD}.querySelector('[data-inactive-rule-note="zz_test_training"]')`)) &&
        (await evaluate(`return ${SD}.querySelector('[data-inactive-rule-note="zz_test_training"]').textContent === 'ZZ Test Training is still used by 1 rule (Coverage: Fri has at least 1 ZZ Test Training). Auto-fill keeps using it until you change that rule in Rules.' && ${rowOf("zz_test_training")}.dataset.inactive === 'true';`)) &&
        (await unsavedText()) === "Not saved yet: ZZ Test Training turned off",
      (await evaluate(`return ${SD}.querySelector('[data-inactive-rule-note]')?.textContent;`)) + " / " + (await unsavedText()),
    );
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    await waitSaved();
    w = await writes(stFrom);
    check(
      "85 停用按 Save：PUT zz_test_training is_active=false；停用的还列着（能勾回来），黄字还在",
      w.length === 1 && w[0].body.is_active === false && (await evaluate(`return !!${rowOf("zz_test_training")} && !${rowOf("zz_test_training")}.querySelector('[data-shift-type-active]').checked && !!${SD}.querySelector('[data-inactive-rule-note="zz_test_training"]');`)),
      JSON.stringify(w.map((e) => e.body)),
    );
    await evaluate(`$btn('Close', ${SD}).click();`);
    await waitFor(`!${SD}`);
    await evaluate(`${cell("needs|" + P2)}.querySelector('button[aria-label="Add a shift"]').click();`);
    await waitFor(addDlg);
    const btns2 = await evaluate(shiftButtons);
    check("85 停用以后 Add shift 弹窗里没有 ZZ Test Training", !btns2.split(",").includes("ZZ Test Training") && btns2.includes("Midday"), btns2);
    await evaluate(`const d = ${addDlg}; $btn('Cancel', d)?.click();`);
    await waitFor(`!${addDlg}`);
    // 颜色：后端上了 color 列
    await ctl({ shiftColors: true });
    const zzNeeds = await (await fetch(`${MOCK}/api/schedule/weeks/2026-10-04/slots`, { method: "POST", body: JSON.stringify({ date: "2026-10-08", shift_type: "close", start_time: "13:30", end_time: "21:30" }) })).json();
    await openPage(`${APP}/schedule?week=2026-10-04`);
    await waitFor(`${cell("1|2026-10-04")}`);
    const openCard = "[...document.querySelectorAll('[data-cell]:not([data-needs-cell]) [data-slot-id]')].find((c) => c.querySelector('b')?.textContent.trim() === 'Open')";
    check("85 后端带 color、Open 存的是 open：周表 Open 卡片照旧绿色", await evaluate(`const c = ${openCard}; return !!c && c.className.includes('border-emerald-400/40');`), await evaluate(`return ${openCard}?.className;`));
    await openSettings();
    stFrom = (await mockLog()).length;
    await evaluate(`${rowOf("open")}.querySelector('[data-shift-type-color]').click();`);
    await waitFor(`!!${SD}.querySelector('[data-shift-color-pop]')`);
    await evaluate(`${SD}.querySelector('[data-shift-color-pop] [data-pick-color="rose"]').click();`);
    check(
      "85 改 Open 的颜色：色块琥珀圈，黄字 Not saved yet: colour for Open changed",
      (await waitFor(`${SD}.querySelector('[data-settings-unsaved]')?.textContent === 'Not saved yet: colour for Open changed'`)) && (await evaluate(`return ${rowOf("open")}.querySelector('[data-shift-type-color]').className.includes('ring-amber-400');`)),
      await unsavedText(),
    );
    await evaluate(`${SD}.querySelector('[data-settings-save]').click();`);
    await waitSaved();
    w = await writes(stFrom);
    await evaluate(`$btn('Close', ${SD}).click();`);
    await waitFor(`!${SD}`);
    check(
      "85 存了 Open = rose：PUT open color rose；周表 Open 卡片马上变粉（不用刷新）",
      w.length === 1 && w[0].body.color === "rose" && (await waitFor(`${openCard}?.className.includes('border-rose-400/45')`)),
      JSON.stringify(w.map((e) => e.body)) + " " + (await evaluate(`return ${openCard}?.className;`)),
    );
    // Unassigned 不上色
    check(
      "85 Unassigned 行头：不是暗红底，底色同员工行，「Unassigned」白字",
      await evaluate(`const h = document.querySelector('[data-unassigned-head]'); const n = [...document.querySelectorAll('[data-sch-grid] .sticky')][1]; return !!h && h !== n && getComputedStyle(h).backgroundColor === getComputedStyle(n).backgroundColor && getComputedStyle(h.querySelector('span')).color === 'rgb(255, 255, 255)';`),
      await evaluate(`const h = document.querySelector('[data-unassigned-head]'); return h ? getComputedStyle(h).backgroundColor + ' ' + getComputedStyle(h.querySelector('span')).color : 'none';`),
    );
    const needsCard = "document.querySelector('[data-needs-cell] [data-slot-id]')";
    check(
      "85 Unassigned 的格子不上底色；里头的卡片整张不上色：白色虚线框、透明底、白字（不按班次颜色）",
      await evaluate(`const c = ${needsCard}; if (!c) return false; const cellEl = c.closest('[data-needs-cell]'); const cs = getComputedStyle(c); return getComputedStyle(cellEl).backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderTopStyle === 'dashed' && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.color === 'rgb(255, 255, 255)' && (cs.borderTopColor === 'rgba(255, 255, 255, 0.75)' || (cs.borderTopColor.startsWith('oklab(0.99') && cs.borderTopColor.endsWith('/ 0.75)')));`),
      await evaluate(`const c = ${needsCard}; if (!c) return 'no needs card'; const cs = getComputedStyle(c); return [getComputedStyle(c.closest('[data-needs-cell]')).backgroundColor, cs.borderTopStyle, cs.backgroundColor, cs.color, cs.borderTopColor].join(' | ');`),
    );
    // Rules 标签那句
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Rules')?.click();");
    check(
      "85 Rules 卡片灰字后面接一句：New shift types show up in the Shift list of every rule. …",
      await waitFor("document.querySelector('[data-rules-shift-types-note]')?.textContent.trim() === 'New shift types show up in the Shift list of every rule. Auto-fill uses the times from the Shift times rule, so add one for a new shift type; without it, Auto-fill uses the whole working hours.'"),
      await evaluate("return document.querySelector('[data-rules-shift-types-note]')?.textContent;"),
    );
    // 只读的人：看不到改的地方
    await ctl({ role: "admin", tick: { switchOn: false, codes: STANDARD_SUP.filter((c) => c !== "settings.schedule") } });
    await openPage(`${APP}/schedule?week=${P2}`);
    await waitFor("document.querySelector('[data-open-settings]')");
    await openSettings();
    check(
      "85 没勾 settings.schedule（非 Super Admin）：Shift types 只读一句（只列在用的），没有 + Add shift type、⋮⋮、色块、名字框",
      await evaluate(`const s = ${SD}.querySelector('[data-settings-defaults]'); return !${ST} && !s.querySelector('[data-add-shift-type]') && !s.querySelector('input') && s.textContent.includes('Midday') && !s.textContent.includes('ZZ Test Training ');`),
      await evaluate(`return ${SD}.querySelector('[data-settings-defaults]').textContent;`),
    );
    await evaluate(`$btn('Close', ${SD}).click();`);
    // 收尾：规则、班次类型、颜色开关、加的 Unassigned 班都放回去
    await fetch(`${MOCK}/api/schedule/weeks/2026-10-04/slots/${zzNeeds.id}`, { method: "DELETE" });
    await fetch(`${MOCK}/api/schedule/rules`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rulesBefore) });
    await ctl({ phase2: false, role: "superadmin", tick: null, resetShiftTypes: true, shiftColors: false });
  }

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
  check("一行一个人：自己（Jing）在最上面，其他人按名字排（接口按排班表的 sort_order 回，Dashboard 照旧按名字，拖行题 ⑦B）", dashNames === "Jing,Anita,Lizzie,Nadia,Veronica,ZZ Test Helper", dashNames);
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
    "Responses（G138）：Veronica Accepted、Lizzie Wants changes + 每条请求和状态、Nadia 过了期限写 No answer — counted as Looks good；表头写 Answer by 期限、2 requests",
    await evaluate(`const r = (id) => document.querySelector('[data-response="' + id + '"]')?.textContent ?? ''; const meta = document.querySelector('[data-responses-meta]').textContent; return r(1).includes('Accepted') && r(2).includes('Wants changes') && r(2).includes('+ Wed Mid (extra shift): Waiting for you') && r(2).includes('+ Fri Open (extra shift): Waiting for you') && r(3).includes('No answer — counted as Looks good') && meta.includes('Answer by Thu, Oct 1, 12:00 PM') && meta.includes('2 requests');`),
    await evaluate("return document.querySelector('[data-responses]')?.textContent ?? 'none';"),
  );
  check(
    "同线上周表的亮黄卡片：Lizzie 那行周三、周五各一张「Lizzie asked · extra shift」，下面 Approve（蓝）在前、Decline 在后",
    await evaluate(`const a = [...document.querySelectorAll('[data-responses-grid] [data-req-card=pending]')]; const btns = [...a[0].parentElement.querySelectorAll('button')].map((b) => b.textContent); return a.length === 2 && a.every((e) => e.textContent.includes('Lizzie asked · extra shift')) && a[0].className.includes('bg-[rgba(253,224,71,.28)]') && !!document.querySelector('[data-rcell="2|2026-10-07"] [data-req-card]') && !!document.querySelector('[data-rcell="2|2026-10-09"] [data-req-card]') && btns.join('/') === 'Approve/Decline' && document.querySelector('[data-approve="901"]').className.includes('3b82f6') && !document.querySelector('[data-decline="901"]').className.includes('3b82f6');`),
    await evaluate("return document.querySelector('[data-responses-grid]')?.innerText.slice(0, 500) ?? 'none';"),
  );
  // 第一次 Publish 的确认框：列出还没处理完的请求（G138，前端从 confirmations 自己数 pending + awaiting_peer）；Publish again 不列
  await evaluate("$btn('Publish').click();");
  await waitFor("document.querySelector('[role=dialog]')");
  check("已发布的周 Publish again：确认框不列还没处理的请求", await evaluate("return document.querySelector('[role=dialog]').textContent.includes('again') && !document.querySelector('[data-publish-open-requests]');"));
  await evaluate("$btn('Cancel', document.querySelector('[role=dialog]')).click();");
  await ctl({ draftWeek: "2026-10-04" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelector('[data-responses-grid]')");
  await evaluate("$btn('Publish').click();");
  await waitFor("document.querySelector('[data-publish-open-requests]')");
  check(
    "第一次 Publish 确认框：2 requests are still open. Publishing closes them and tells each person: Lizzie 两条",
    await evaluate("const t = document.querySelector('[data-publish-open-requests]')?.innerText ?? ''; return t.includes('2 requests are still open. Publishing closes them and tells each person:') && t.includes('Lizzie: + Wed Mid (extra shift)') && t.includes('Lizzie: + Fri Open (extra shift)');"),
    await evaluate("return document.querySelector('[data-publish-open-requests]')?.innerText ?? document.querySelector('[role=dialog]')?.innerText ?? 'no dialog';"),
  );
  await evaluate("const d = document.querySelector('[role=dialog]'); if (d) $btn('Cancel', d).click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  await ctl({ restoreWeek: true });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelector('[data-approve=\"901\"]')");
  let from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-approve=\"901\"]').click();");
  await waitFor("!document.querySelector('[data-approve=\"901\"]')");
  check("Approve：发 POST …/confirmation-requests/901/approve；那一条不再是亮黄色，表里写 Approved", (await since(from, (e) => e.path === "/api/schedule/confirmation-requests/901/approve")).length === 1 && (await evaluate("return document.querySelectorAll('[data-responses-grid] [data-req-card=pending]').length === 1 && document.querySelector('[data-response=\"2\"]').textContent.includes('+ Wed Mid (extra shift): Approved');")));
  check("Approve 之后这一周重新拉了一次（周三 Mid 多了 Lizzie 的正式时段）", (await since(from, (e) => e.path === "/api/schedule/weeks/2026-10-04")).length >= 1);
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-decline=\"902\"]').click();");
  await waitFor("document.querySelector('[data-responses] [data-asked=declined]')");
  check("Decline：发 POST …/902/decline；表里写红字 Declined，周表没有亮黄卡片了（没有要处理的就不出表）", (await since(from, (e) => e.path === "/api/schedule/confirmation-requests/902/decline")).length === 1 && (await evaluate("const d = document.querySelector('[data-responses] [data-asked=declined]'); return d.textContent.includes('+ Fri Open (extra shift): Declined') && d.querySelector('span').className.includes('red') && !document.querySelector('[data-responses-grid]') && !document.querySelector('[data-approve]');")));
  // 换班（G138）：903 Veronica 已同意 → 一分为二 + Veronica agreed + Approve / Decline；904 还在等 Jing → 只写 Waiting for Jing，不能批
  await ctl({ confirmSwaps: true, confirmReset: true });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelector('[data-split=\"903\"]')");
  check(
    "换班等批：Veronica 的 Thu 一分为二「Nadia request / Veronica original」，写 Veronica agreed，下面 Approve 在前、Decline 在后",
    await evaluate("const c = document.querySelector('[data-split=\"903\"]'); const t = c.textContent; return t.includes('Nadia request') && t.includes('Veronica original') && t.includes('Veronica agreed') && [...c.querySelectorAll('button')].map((b) => b.textContent).join('/') === 'Approve/Decline';"),
    await evaluate("return document.querySelector('[data-split=\"903\"]')?.textContent ?? 'none';"),
  );
  check(
    "换班两边：Nadia 原来的 Sun 变淡「↔ Veronica」；Veronica 那行 Sun、Nadia 那行 Thu 出亮黄「↔ from …」",
    await evaluate("const nSun = document.querySelector('[data-rcell=\"3|2026-10-04\"]'); const vSun = document.querySelector('[data-rcell=\"1|2026-10-04\"]'); const nThu = document.querySelector('[data-rcell=\"3|2026-10-08\"]'); return [...nSun.querySelectorAll('div')].some((d) => d.className.includes('opacity-40') && d.textContent.includes('↔ Veronica')) && vSun.querySelector('[data-req-card]').textContent.includes('↔ from Nadia') && nThu.querySelector('[data-req-card]').textContent.includes('↔ from Veronica');"),
  );
  check(
    "还在等对方的换班：格子写 Waiting for Jing、没有 Approve；表里 Nadia 那条写 Veronica agreed — waiting for you",
    await evaluate("const c = document.querySelector('[data-split=\"904\"]'); return c.textContent.includes('Waiting for Jing') && !c.querySelector('button') && !document.querySelector('[data-approve=\"904\"]') && document.querySelector('[data-response=\"3\"]').textContent.includes('⇄ Sun Close ↔ Veronica\\'s Thu Close: Veronica agreed — waiting for you') && document.querySelector('[data-response=\"2\"]').textContent.includes('Waiting for Jing');"),
    await evaluate("return document.querySelector('[data-response=\"3\"]')?.textContent + ' | ' + document.querySelector('[data-split=\"904\"]')?.textContent;"),
  );
  check(
    "改天上（move）：Jing 的 Mon 变淡「asked to move」，Wed 出亮黄「Jing asked · moved from Mon」，下面 Approve / Decline",
    await evaluate("const mon = document.querySelector('[data-rcell=\"4|2026-10-05\"]'); const wed = document.querySelector('[data-rcell=\"4|2026-10-07\"]'); const card = wed.querySelector('[data-req-card=pending]'); return [...mon.querySelectorAll('div')].some((d) => d.className.includes('opacity-40') && d.textContent.includes('asked to move')) && !!card && card.textContent.includes('Jing asked · moved from Mon') && !!document.querySelector('[data-approve=\"905\"]') && !!document.querySelector('[data-decline=\"905\"]');"),
    await evaluate("return document.querySelector('[data-rcell=\"4|2026-10-07\"]')?.textContent ?? 'none';"),
  );
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-approve=\"903\"]').click();");
  await waitFor("!document.querySelector('[data-split=\"903\"]')");
  check("Approve 换班：POST …/903/approve；那格不再一分为二，表里写 Approved", (await since(from, (e) => e.path === "/api/schedule/confirmation-requests/903/approve")).length === 1 && (await evaluate("return document.querySelector('[data-response=\"3\"]').textContent.includes('Approved');")));
  await ctl({ confirmSwaps: false });
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

  // ── 409 coverage_gap：同一次 Save 里别的日子开了口子（Annie 11-02「7号的gap已经填了，但始终报错不让保存」）──
  // 已发布的 9/27 周（没有空档）：Mon 9/28 Veronica Open 改成 2:00–10:30 AM（开口子 10:30–11:30），Sat 10/03 Anita 改时间（没事）。
  await ctl({ role: "supervisor", changesLocked: false, inactiveEmployee: 0 });
  await openPage(`${APP}/schedule?week=2026-09-27`);
  await waitFor(`${cell("1|2026-09-28")}?.querySelector('[data-slot-id]')`, 30000);
  await evaluate("window.__scheduleNow = '2026-09-01T00:00'; window.dispatchEvent(new Event('focus'));");
  await sleep(300);
  const gVer = `${cell("1|2026-09-28")}.querySelector('[data-slot-id]')`;
  const gAnita = `${cell("5|2026-10-03")}.querySelector('[data-slot-id]')`;
  await setTime(gVer, null, "10:30");
  await setTime(gAnita, null, "12:30");
  const gapLine = "Mon 09/28, 10:30–11:30 AM is not covered — caused by your change to Veronica's Open shift.";
  check("409 coverage_gap：红框逐段写哪天几点、是哪个改动造成的", !(await saveWeek()) && (await evaluate(`const e = document.querySelector('[data-save-error]'); return e.textContent.includes('Nothing was saved') && [...e.querySelectorAll('[data-rejected-gaps] li')].map(li => li.textContent).join('|') === ${JSON.stringify(gapLine)};`)), await evaluate("return document.querySelector('[data-save-error]')?.textContent;"));
  // 再改别的日子（Annie 当时改的是 7 号）：红字收起，但后端说的那一段还留着，写明上次 Save 为什么被拒。
  await setTime(gAnita, null, "12:15");
  check("再改别的地方：后端列的空档还留着（Your last Save was refused…），没有混成别的红字", await waitFor(`!document.querySelector('[data-save-error]') && document.querySelector('[data-save-rejected]')?.textContent.includes('Your last Save was refused because of these gaps.') && document.querySelector('[data-save-rejected] li')?.textContent === ${JSON.stringify(gapLine)}`), await evaluate("return document.querySelector('[data-save-status]')?.textContent;"));
  check("还是没补：再按 Save 照样被拒（以后端为准）", !(await saveWeek()));
  // 把口子补上（Veronica 改到 11:45，盖住 10:30–11:30）：存得上，红框没了。
  await setTime(gVer, null, "11:45");
  check("补上以后 Save 存得上，上次被拒的红框也没了", (await saveWeek()) && (await evaluate("return !document.querySelector('[data-save-rejected]') && !document.querySelector('[data-save-error]');")), await evaluate("return document.querySelector('[data-save-status]')?.textContent;"));
  // 还原，后面的「按勾」检查要这一周干净。
  await setTime(gVer, null, "11:30");
  await setTime(gAnita, null, "12:00");
  check("还原 9/27 周（Veronica 11:30、Anita 12:00）", await saveWeek());
  // Discard 也清掉：再造一次被拒，按 Discard ⇒ 红框没了。
  await setTime(gVer, null, "10:30");
  await saveWeek();
  await evaluate("document.querySelector('[data-week-discard]').click();");
  check("Discard：改动和上次被拒的红框一起清掉", await waitFor("!document.querySelector('[data-unsaved-summary]') && !document.querySelector('[data-save-rejected]') && !document.querySelector('[data-save-error]')"));

  // ── 拖员工行排顺序（Annie 2026-11-02「第7按B，其他都按推荐」「动手」，preview PCJkqu6KRWreA1EzMkJRk8）──
  // 全公司一份、每周一样（②③A），跟 schedule.edit 走（①A），手机不拖（⑤A），自己那行固定最上面不拖（⑥A），只排班表照这个顺序（⑦B）。
  await ctl({ role: "supervisor", meName: "", orderFail: false });
  await openPage(`${APP}/schedule?week=2026-09-27`);
  await waitFor("document.querySelector('[data-row-handle]')", 30000);
  const activeIds = (await (await fetch(`${MOCK}/api/schedule/employees`)).json()).employees.map((e) => e.id);
  const gridIds = () => evaluate("return [...document.querySelectorAll('[data-person-row]')].map((r) => Number(r.dataset.personRow));");
  check("排班表的行照接口的 sort_order 排；能改排班的人每行名字左边一个把手 ⠿", JSON.stringify(await gridIds()) === JSON.stringify(activeIds) && (await evaluate(`return ${JSON.stringify(activeIds)}.every((id) => document.querySelector('[data-row-handle="' + id + '"]')?.textContent.trim() === '⠿');`)), JSON.stringify(await gridIds()));
  // headless 里原生拖拽不好模拟：用同一个 DataTransfer 依次派 dragstart → dragover → drop → dragend。
  const dragRow = (from, to, after) => evaluate(`
    const dt = new DataTransfer();
    const h = document.querySelector('[data-row-handle="${from}"]');
    h.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise((res) => setTimeout(res, 100));
    const t = document.querySelector('[data-person-row="${to}"]');
    const r = t.getBoundingClientRect();
    const y = ${after ? "r.bottom - 2" : "r.top + 2"};
    t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: y }));
    await new Promise((res) => setTimeout(res, 150));
    const line = !!document.querySelector('[data-row-drop-line]');
    t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: y }));
    h.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise((res) => setTimeout(res, 150));
    return line;`);
  let roFrom = (await mockLog()).length;
  const lineShown = await dragRow(5, 2, false);
  const movedOrder = [1, 5, 2, ...activeIds.filter((id) => ![1, 5, 2].includes(id))];
  check("拖 Anita 到 Lizzie 前面：拖的时候出蓝线；放下后 Anita 排到第 2 行、带琥珀框，没发请求", lineShown && (await waitFor(`JSON.stringify([...document.querySelectorAll('[data-person-row]')].map((r) => Number(r.dataset.personRow))) === ${JSON.stringify(JSON.stringify(movedOrder))}`)) && (await evaluate("return !!document.querySelector('[data-person-row=\"5\"][data-row-moved]') && !document.querySelector('[data-row-drop-line]');")) && (await since(roFrom, (e) => e.method !== "GET" && !e.path.includes("edit-lock"))).length === 0, `line=${lineShown} ${JSON.stringify(await gridIds())}`);
  check("没存：Not saved yet: staff order changed，Save / Discard 能点", await evaluate(`return document.querySelector('[data-unsaved-summary]')?.textContent === 'Not saved yet: staff order changed' && !${SAVE}.disabled && !document.querySelector('[data-week-discard]').disabled;`), await evaluate("return document.querySelector('[data-unsaved-summary]')?.textContent;"));
  check("拖班不受影响：格子不接员工行", await evaluate(`
    const dt = new DataTransfer();
    document.querySelector('[data-row-handle="3"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const c = document.querySelector('[data-cell="3|2026-09-28"]');
    const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    c.dispatchEvent(ev);
    document.querySelector('[data-row-handle="3"]').dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return !ev.defaultPrevented;`));
  await evaluate("$btn('Employees').click();");
  await waitFor("document.querySelector('[role=dialog] [data-employee-row]')");
  check("Employees 窗口照旧按名字排（⑦B）", await evaluate("const ns = [...document.querySelectorAll('[role=dialog] [data-employee-row]')].map((r) => r.querySelector('span').textContent.trim()); return ns[0].startsWith('Anita') && ns[1].startsWith('Jing');"), await evaluate("return [...document.querySelectorAll('[role=dialog] [data-employee-row]')].map((r) => r.querySelector('span').textContent.trim()).join(',');"));
  await evaluate("$btn('Close', document.querySelector('[role=dialog]')).click();");
  await waitFor("!document.querySelector('[role=dialog]')");
  roFrom = (await mockLog()).length;
  check("按 Save：一次 PUT /api/schedule/employees/order，整份新顺序；绿色 Saved，琥珀框没了；不碰这一周的班", (await saveWeek()) && JSON.stringify((await since(roFrom, (e) => e.method === "PUT" && e.path === "/api/schedule/employees/order"))[0]?.body) === JSON.stringify({ employee_ids: movedOrder }) && (await since(roFrom, (e) => e.path.endsWith("/changes"))).length === 0 && (await evaluate("return !document.querySelector('[data-row-moved]');")), JSON.stringify((await since(roFrom, (e) => e.method === "PUT"))[0]?.body));
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelector('[data-person-row]')", 30000);
  check("别的周也是这个顺序（全公司一份、每周一样）", JSON.stringify(await gridIds()) === JSON.stringify(movedOrder), JSON.stringify(await gridIds()));
  // Discard：拖了不存，按 Discard 回到原样
  await dragRow(3, 1, false);
  await waitFor("!!document.querySelector('[data-row-moved]')");
  await evaluate("document.querySelector('[data-week-discard]').click();");
  check("Discard：顺序回到存好的样子", (await waitFor(`!document.querySelector('[data-row-moved]') && !document.querySelector('[data-unsaved-summary]')`)) && JSON.stringify(await gridIds()) === JSON.stringify(movedOrder));
  // 拖回原位：当没改
  await dragRow(5, 1, true);
  check("拖回原来的位置：当没改（没有 Not saved yet）", await evaluate("return !document.querySelector('[data-unsaved-summary]') && !document.querySelector('[data-row-moved]');"));
  // 400：后端原话红字，顺序留在页面上
  await dragRow(3, 1, false);
  await ctl({ orderFail: true });
  check("后端 400：红字照后端原话，拖过的顺序还在页面上", !(await saveWeek()) && (await evaluate("return document.querySelector('[data-save-error]')?.textContent.includes('employee_ids must list every active employee exactly once.') && !!document.querySelector('[data-row-moved]');")), await evaluate("return document.querySelector('[data-save-status]')?.textContent;"));
  await ctl({ orderFail: false });
  await evaluate("document.querySelector('[data-week-discard]').click();");
  await waitFor("!document.querySelector('[data-row-moved]')");
  // 自己那一行（⑥A）：固定在最上面、没有把手
  await ctl({ role: "supervisor", meName: "Nadia" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelector('[data-person-row]')", 30000);
  check("自己（Nadia）那一行固定在最上面、没有把手；其他人照排好的顺序、有把手", JSON.stringify(await gridIds()) === JSON.stringify([3, ...movedOrder.filter((id) => id !== 3)]) && (await evaluate("return !document.querySelector('[data-row-handle=\"3\"]') && !!document.querySelector('[data-row-handle=\"1\"]');")), JSON.stringify(await gridIds()));
  // 员工（只能看）：照同一个顺序，没有把手
  await ctl({ role: "staff", meName: "Jing" });
  await openPage(`${APP}/schedule?week=2026-10-04`);
  await waitFor("document.querySelector('[data-person-row]')", 30000);
  check("员工看到同一个顺序（自己在最上面），没有把手", JSON.stringify(await gridIds()) === JSON.stringify([4, ...movedOrder.filter((id) => id !== 4)]) && (await evaluate("return !document.querySelector('[data-row-handle]');")), JSON.stringify(await gridIds()));
  // 还原，后面的检查要原来的顺序
  await ctl({ role: "supervisor", meName: "" });
  await fetch(`${MOCK}/api/schedule/employees/order`, { method: "PUT", body: JSON.stringify({ employee_ids: activeIds }) });

  // ── 手机版第 ③ 批（Annie 2026-11-01 手机版规则）：一行 ‹ 日期 ›，This week / Next week / Auto-fill / Employees / + Add employee 收进「⋯」，Save 露在外面，整页不横晃 ──
  await ctl({ fail401: false, role: "superadmin" });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(`${APP}/schedule`);
  await waitFor("document.querySelector('[data-week-save]')", 30000);
  await sleep(600);
  check("手机：员工行没有拖动把手（拖行题 ⑤A：手机上只看顺序）", await evaluate("const hs = [...document.querySelectorAll('[data-row-handle]')]; return hs.length > 0 && hs.every((h) => getComputedStyle(h).display === 'none');"));
  check("手机：Schedule 整页不左右晃", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); return noSway;`), await evaluate("return document.documentElement.scrollWidth + ' > ' + innerWidth;"));
  // 127（Annie 2026-11-12「把日期和this week， next week 单独放一行」+「全部同意推荐，动手」）：手机上 This week / Next week 跟日期一行露在外面，Auto-fill 等照旧收进 ⋯（Q5 A）。
  check("手机：‹ 日期 › This week / Next week 在外面（不在 ⋯ 里）；Save 和 ⋯ 看得见；Visible to 在最上面", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const p = document.querySelector('[aria-label="Previous week"]').getBoundingClientRect(), n = document.querySelector('[aria-label="Next week"]').getBoundingClientRect(); const outside = (t) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === t && vis(b) && !b.closest('[data-phone-more-menu]')); const vc = document.querySelector('[data-schedule-head] [data-visibility-control]'); return Math.abs(p.top - n.top) < 2 && outside('This week') && outside('Next week') && vis(document.querySelector('[data-week-save]')) && vis(document.querySelector('[data-phone-more]')) && !!vc && vc.getBoundingClientRect().top < p.top;`));
  await evaluate("document.querySelector('[data-phone-more]').click();");
  await sleep(300);
  check("手机：点 ⋯ 列出 Auto-fill、Employees、+ Add employee、⚙ Settings（This week / Next week 不在里面）", await evaluate(`const m = document.querySelector('[data-phone-more-menu]'); const has = (t) => [...m.querySelectorAll('button')].some((b) => b.textContent.trim() === t && b.getBoundingClientRect().height > 0); return !!m && ['Auto-fill', 'Employees', '+ Add employee', '⚙ Settings'].every(has) && !has('This week') && !has('Next week');`));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await goto(`${APP}/schedule`);
  await waitFor("document.querySelector('[data-week-save]')", 30000);
  await sleep(500);
  // ── 127 页头（电脑）：两行；键 28px；选中页签不是蓝底；Visible to 在日期那一行右边，不另占一行 ──
  {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto(`${APP}/schedule`);
    await waitFor("document.querySelector('[data-week-save]') && document.querySelector('[data-schedule-head] [data-visibility-control]')", 30000);
    await sleep(500);
    const head = await evaluate(`
      const top = (el) => Math.round(el.getBoundingClientRect().top);
      const btn = (t) => [...document.querySelectorAll('[data-schedule-head] button')].find((b) => b.textContent.trim() === t);
      const tabOn = document.querySelector('[role=tab][aria-selected=true]');
      const all = [...document.querySelectorAll('[data-schedule-head] button')].filter((b) => b.getBoundingClientRect().height > 0 && !b.closest('[data-visibility-control]'));
      return {
        r1: [top(document.querySelector('[aria-label="Previous week"]')), top(btn('This week')), top(btn('Next week')), top(document.querySelector('[data-schedule-head] [data-visibility-control]'))],
        r2: [top(tabOn), top(document.querySelector('[data-week-discard]')), top(document.querySelector('[data-week-save]')), top(btn('Auto-fill')), top(btn('Employees')), top(btn('+ Add employee')), top(btn('⚙ Settings'))],
        heights: [...new Set(all.map((b) => Math.round(b.getBoundingClientRect().height)))],
        tabBg: getComputedStyle(tabOn).backgroundColor, tabFw: getComputedStyle(tabOn).fontWeight, saveBg: getComputedStyle(document.querySelector('[data-week-save]')).backgroundColor,
        loneVis: [...document.querySelectorAll('[data-visibility-control]')].filter((v) => !v.closest('[data-schedule-head]')).length,
      };`);
    const same = (a) => a.every((x) => x === a[0]);
    check("127：第 1 行 ‹ 日期 › This week / Next week …… Visible to（同一行）", same(head.r1.slice(0, 3)) && Math.abs(head.r1[3] - head.r1[0]) <= 8, JSON.stringify(head));
    check("127：第 2 行 页签 + Discard / Save / Auto-fill / Employees / + Add employee / ⚙ Settings（同一行，在第 1 行下面）", same(head.r2) && head.r2[0] > head.r1[0], JSON.stringify(head));
    check("127：页头的键都是 28px", head.heights.length === 1 && head.heights[0] === 28, JSON.stringify(head.heights));
    check("127：选中的页签不是蓝底（亮白框、粗字），Save 还是蓝", head.tabBg !== "rgb(59, 130, 246)" && Number(head.tabFw) >= 700 && head.saveBg === "rgb(59, 130, 246)", JSON.stringify(head));
    check("127：Visible to 没有单独占一行（只在页头里）", head.loneVis === 0, JSON.stringify(head));
    await evaluate("[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === 'Overview')?.click();");
    await sleep(500);
    check("127：切到 Overview：页签一行，Visible to 在同一行右边", await evaluate(`const h = document.querySelector('[data-schedule-head]'); const t = h && h.querySelector('[role=tablist]'), v = h && h.querySelector('[data-visibility-control]'); return !!t && !!v && Math.abs(t.getBoundingClientRect().top - v.getBoundingClientRect().top) < 12 && !document.querySelector('[data-week-save]');`));
    await evaluate("[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === 'Schedule')?.click();");
    await sleep(300);
    await cdp("Emulation.clearDeviceMetricsOverride");
  }

  check("电脑：This week / Next week 照旧排在日期后面，没有 ⋯", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); return vis(btn('This week')) && vis(btn('Next week')) && !vis(document.querySelector('[data-phone-more]'));`));

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
    // 只看勾（Annie 2026-11-01「动手」）：前端不读开关、不按角色兜底，只认 /api/me/permissions 回的列表。
    ["开关关着、主管没勾 ⇒ 也都不能（不兜底）", "supervisor", false, [], false, false, false],
    ["开关关着、员工勾了 ⇒ 都能（只看勾）", "staff", false, ALL, true, true, true],
    ["员工勾 edit + publish（同 ZZTest）⇒ 能改、能发布；不能加人", "staff", false, ["schedule.edit", "schedule.publish"], true, false, true],
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
