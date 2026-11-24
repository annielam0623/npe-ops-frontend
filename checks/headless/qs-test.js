// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Settings → Quick Stats（/settings/quick-stats，G373）。
// 前提：qs-mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
// 可选：CHROME_PROFILE_DIR（Chrome 用户目录，默认本目录 chrome-profile）；SHOTS_DIR（存截图）。
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9333;
const PROFILE = process.env.CHROME_PROFILE_DIR || path.join(__dirname, "chrome-profile");
const SHOTS = process.env.SHOTS_DIR || "";

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
async function since(from, pred = () => true) {
  return (await mockLog()).slice(from).filter(pred);
}
const mark = async () => (await mockLog()).length;

let ws;
let msgId = 0;
const pending = new Map();
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expr) {
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
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
async function shoot(name) {
  if (!SHOTS) return;
  await sleep(250);
  const m = await cdp("Page.getLayoutMetrics");
  const w = Math.ceil(m.cssContentSize?.width || 1600);
  const h = Math.min(Math.ceil(m.cssContentSize?.height || 1000), 6000);
  const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
}

// 页面里：拦下 <a download>.click()，只记文件名（headless 不真的存文件）。
const HELPERS = SELECT_HELPERS + `
window.__downloads = window.__downloads || [];
if (!window.__dlPatched) {
  window.__dlPatched = true;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__downloads.push(this.download); return; }
    return orig.call(this);
  };
}
window.$q = (s, root=document) => root.querySelector(s);
window.$qa = (s, root=document) => [...root.querySelectorAll(s)];
window.$vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => $vis(b) && b.textContent.trim() === text);
window.$setText = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$cardRow = (title) => $qa('[data-qs-cards-table] tbody tr').find(tr => tr.querySelector('[data-qs-card-title]')?.textContent.includes(title) || tr.querySelector('[data-qs-rename] input')?.value === title);
window.$logRow = (id) => $q('[data-qs-log-id="' + id + '"]');
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage() {
  await goto(`${APP}/settings/quick-stats`);
  await waitFor("document.querySelector('[data-qs-history-table], [data-qs-history-empty], [data-qs-forbidden]')", 60000);
  await helpers();
}
const isQs = (e) => e.path.startsWith("/api/quick-stats/");

const NAV = "document.querySelector('nav[aria-label=Main]')";
async function openNav() {
  await waitFor(`${NAV} && ${NAV}.querySelector('button[aria-label="Open menu"]')`);
  await evaluate(`${NAV}.querySelector('button[aria-label="Open menu"]').click();`);
  await waitFor(`${NAV}.dataset.state === 'open'`);
}
async function closeNav() {
  await evaluate(`${NAV}.querySelector('button[aria-label="Close menu"]')?.click();`);
}
const settingsLinks = `[...${NAV}.querySelectorAll('section[aria-label="Settings"] a')].map(a => a.textContent.trim() + '=' + a.getAttribute('href'))`;

async function ask(question) {
  await evaluate(`$setText($q('#qs-question'), ${JSON.stringify(question)});`);
  await sleep(100);
  await evaluate(`$q('[data-qs-ask-button]').click();`);
}

async function run() {
  // ── 1 第一次打开：没有卡片、没有记录 ──
  await ctl({ role: "superadmin", seed: false, setup503: false, slowMs: 0, many: false, noDisposition: false, fail401: false });
  let from = await mark();
  await openPage();
  await openNav();
  {
    const links = await evaluate(`return ${settingsLinks};`);
    check("Super Admin：侧栏 Settings 最后一项是 Quick Stats（/settings/quick-stats），在 Phone AI Calls 下面",
      links.at(-1) === "Quick Stats=/settings/quick-stats" && links.at(-2) === "Phone AI Calls=/settings/phone-ai-calls", JSON.stringify(links));
  }
  await closeNav();
  check("页头标题 Quick Stats（page-titles）", await evaluate("return [...document.querySelectorAll('span.truncate')].some(h => h.textContent.trim() === 'Quick Stats');"));
  {
    const calls = await since(from, isQs);
    check("打开读 GET /cards 和 GET /history?limit=50", calls.some((e) => e.method === "GET" && e.path === "/api/quick-stats/cards") && calls.some((e) => e.method === "GET" && e.url === "/api/quick-stats/history?limit=50"), JSON.stringify(calls.map((c) => c.url)));
  }
  check("空：Saved cards 写 No saved cards yet…", await evaluate("return $q('[data-qs-cards-empty]')?.textContent.includes('No saved cards yet. Ask a question, then press Save as card');"));
  check("空：History 写 No runs yet.", await evaluate("return $q('[data-qs-history-empty]')?.textContent.trim() === 'No runs yet.';"));
  check("空：Ask 是蓝色、没输入时不能按", await evaluate("const b = $q('[data-qs-ask-button]'); return b.disabled && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
  check("空：3 个例句，点一下填进框里（不自动查）", await evaluate("const ex = $qa('[data-qs-examples] button'); if (ex.length !== 3) return false; ex[0].click(); return true;") &&
    (await waitFor("$q('#qs-question').value === 'Sends in the last 30 days by type and status'")) && (await since(from, (e) => e.path === "/api/quick-stats/ask")).length === 0);
  check("字数 0 / 1,000 跟着变", await waitFor("$q('[data-qs-count]').textContent.replace(/\\s+/g,' ').trim() === '44 / 1,000'"));
  check("How to use 收起，9 条 + 一条提醒", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Quick Stats')); return !!d && !d.open && d.querySelectorAll('ol li').length === 9 && d.textContent.includes('Super Admin only. Queries use a read-only database account and stop after 20 seconds.');"));
  await shoot("01-empty");

  // ── 2 查询中 → 3 有结果 ──
  await ctl({ slowMs: 2500 });
  from = await mark();
  await ask("最近30天发送情况");
  check("查询中：Ask 变 Asking… 不能按，输入框也不能改", await waitFor("$q('[data-qs-ask-button]').textContent.trim() === 'Asking…' && $q('[data-qs-ask-button]').disabled && $q('#qs-question').disabled", 3000));
  check("查询中：转圈 + 通常 5–20 秒", await evaluate("return $q('[data-qs-asking]')?.textContent.includes('This usually takes 5–20 seconds.');"));
  await shoot("02-asking");
  check("有结果：表格出来", await waitFor("$q('[data-qs-result=ok] [data-qs-table]')", 10000));
  await ctl({ slowMs: 0 });
  {
    const asks = await since(from, (e) => e.path === "/api/quick-stats/ask");
    check("POST /ask 只带 {question}", asks.length === 1 && asks[0].method === "POST" && JSON.stringify(asks[0].body) === JSON.stringify({ question: "最近30天发送情况" }), JSON.stringify(asks));
    const hist = await since(from, (e) => e.path === "/api/quick-stats/history");
    check("跑完重读 History", hist.length >= 1);
  }
  check("有结果：表头照接口的列名", (await evaluate("return $qa('[data-qs-table] thead th').map(t => t.textContent.trim()).join('|');")) === "send_type|channel|status|sends");
  check("有结果：7 行，数字右对齐带千分位，null 灰斜体", await evaluate("const rows = $qa('[data-qs-table] tbody tr'); const n = rows[0].children[3]; const nul = rows[6].children[2]; return rows.length === 7 && n.textContent === '1,842' && getComputedStyle(n).textAlign === 'right' && nul.textContent === 'null' && getComputedStyle(nul).fontStyle === 'italic';"));
  check("有结果：一句说明 + 行数 · 用时", await evaluate("return $q('[data-qs-explanation]').textContent.startsWith('Counts every send') && /^7 rows · 0\\.4 s · /.test($q('[data-qs-meta]').textContent);"));
  check("有结果：SQL 收起、用到的表 send_log", await evaluate("const d = $q('[data-qs-sql]'); return d && !d.open && d.textContent.includes('FROM send_log') && $q('[data-qs-tables]').textContent.includes('send_log');"));
  check("有结果：Save as card 蓝色、Download Excel 白色", await evaluate("const s = $q('[data-qs-save-card]'); const x = $q('[data-qs-result] [data-qs-excel]'); return s.textContent.trim() === 'Save as card' && getComputedStyle(s).backgroundColor === 'rgb(59, 130, 246)' && x && getComputedStyle(x).backgroundColor !== 'rgb(59, 130, 246)';"));
  await shoot("03-ok");

  // Save as card
  const askLogId = await evaluate("return Number($qa('[data-qs-log-id]')[0]?.dataset.qsLogId);");
  from = await mark();
  await evaluate("$q('[data-qs-save-card]').click();");
  check("Save as card：绿字 Saved as a card，键变 Saved 不能再按", await waitFor("$q('[data-qs-saved]')?.textContent.trim() === 'Saved as a card' && $q('[data-qs-save-card]').disabled && $q('[data-qs-save-card]').textContent.trim() === 'Saved'"));
  check("Saved 是绿色", await evaluate("return getComputedStyle($q('[data-qs-saved]')).color === 'rgb(30, 107, 67)';"));
  {
    const posts = await since(from, (e) => e.path === "/api/quick-stats/cards" && e.method === "POST");
    check("POST /cards {log_id}（这次提问的 log_id）", posts.length === 1 && posts[0].body.log_id === askLogId && !("title" in posts[0].body), JSON.stringify(posts));
  }
  check("卡片列表多了一张", await waitFor("$qa('[data-qs-cards-table] tbody tr').length === 1"));

  // Download Excel（结果）
  from = await mark();
  await evaluate("$q('[data-qs-result] [data-qs-excel]').click();");
  await waitFor("window.__downloads.length === 1");
  {
    const gets = await since(from, (e) => e.path.endsWith("/export"));
    check("结果的 Download Excel：GET /log/{log_id}/export", gets.length === 1 && gets[0].path === `/api/quick-stats/log/${askLogId}/export`, JSON.stringify(gets));
    check("文件名取 Content-Disposition", (await evaluate("return window.__downloads[0];")) === "quick_stats_2026-11-23_1405.xlsx");
  }
  check("下载后 History 多一行 From = Excel", await waitFor("$qa('[data-qs-source]')[0]?.textContent.trim() === 'Excel'"));
  check("Excel 那行没有 Excel / Save as card 键", await evaluate("const tr = $qa('[data-qs-history-table] tbody tr')[0]; return !tr.querySelector('[data-qs-log-excel]') && !tr.querySelector('[data-qs-log-save]');"));

  // ── 4 超过 5,000 行 ──
  await ask("All orders that include MTLV since Jan 1, 2026");
  check("超过上限：黄框 Showing the first 5,000 rows.", await waitFor("$q('[data-qs-truncated]')?.textContent.startsWith('Showing the first 5,000 rows.')", 10000));
  check("超过上限：meta 写 5,000 rows shown", await evaluate("return $q('[data-qs-meta]').textContent.startsWith('5,000 rows shown');"));
  await shoot("04-truncated");

  // ── 5 被拒 ──
  await ask("把订单 CHDB1HQ7R 删掉，再把客人电话改成 +1 702 555 0100");
  check("被拒：黄框原样显示原因，前面加 Not run.", await waitFor("$q('[data-qs-refused]')?.textContent === 'Not run. This asks to delete an order and change a phone number. Quick Stats can only read data, never change it.'", 10000));
  check("被拒：没有表、没有 Save as card、没有 Excel、没有 SQL", await evaluate("return !$q('[data-qs-table]') && !$q('[data-qs-save-card]') && !$q('[data-qs-result] [data-qs-excel]') && !$q('[data-qs-sql]');"));
  check("被拒：meta 写 Nothing was run", await evaluate("return $q('[data-qs-meta]').textContent.startsWith('Nothing was run');"));
  await shoot("05-refused");

  // ── 6 出错 ──
  await ask("Every send_log row for the last 3 years, timeout");
  check("出错：红框原样显示", await waitFor("$q('[data-qs-error]')?.textContent === 'The query failed: canceling statement due to statement timeout'", 10000));
  check("出错：红字", await evaluate("return getComputedStyle($q('[data-qs-error]')).color === 'rgb(179, 38, 30)';"));
  check("出错：不能存卡片、不能下载", await evaluate("return !$q('[data-qs-save-card]') && !$q('[data-qs-result] [data-qs-excel]');"));
  await shoot("06-error");

  // 400 原话；超过 1,000 字前端先挡
  await ask("bad400 question");
  check("400：detail 原样显示", await waitFor("$q('[data-qs-run-error]')?.textContent === 'Mock 400: this question cannot be asked.'"));
  await evaluate(`$setText($q('#qs-question'), 'x'.repeat(1001));`);
  check("超过 1,000 字：字数红、Ask 不能按", await waitFor("$q('[data-qs-ask-button]').disabled && getComputedStyle($q('[data-qs-count]')).color === 'rgb(179, 38, 30)'"));

  // ── 7 卡片（有种子数据） ──
  await ctl({ seed: true });
  await openPage();
  check("卡片：按名字排，Saved by / Updated", await waitFor("$qa('[data-qs-cards-table] tbody tr').length === 2") &&
    (await evaluate("const r = $qa('[data-qs-cards-table] tbody tr'); return r[0].textContent.includes('+44 numbers') && r[0].children[1].textContent.trim() === 'lxu' && r[1].textContent.includes('Sends last 30 days');")));
  check("卡片：Run 蓝色", await evaluate("const b = $cardRow('+44 numbers').querySelector('[data-qs-card-run]'); return b.textContent.trim() === 'Run' && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));

  from = await mark();
  await evaluate("$cardRow('Sends last 30 days').querySelector('[data-qs-card-run]').click();");
  check("卡片 Run：结果写 Card: 名字，不再给 Save as card", await waitFor("$q('[data-qs-result=ok]')?.textContent.includes('Card: Sends last 30 days by type × status')", 10000) && (await evaluate("return !$q('[data-qs-save-card]');")));
  {
    const runs = await since(from, (e) => e.path === "/api/quick-stats/cards/1/run");
    check("卡片 Run：POST /cards/1/run（不经 /ask）", runs.length === 1 && runs[0].method === "POST" && (await since(from, (e) => e.path === "/api/quick-stats/ask")).length === 0);
  }
  from = await mark();
  await evaluate("$q('[data-qs-result] [data-qs-excel]').click();");
  await sleep(600);
  check("卡片结果的 Download Excel：GET /cards/1/export", (await since(from, (e) => e.path.endsWith("/export"))).map((e) => e.path).join() === "/api/quick-stats/cards/1/export");
  from = await mark();
  await ctl({ noDisposition: true });
  await evaluate("$cardRow('+44 numbers').querySelector('[data-qs-card-excel]').click();");
  await sleep(600);
  await ctl({ noDisposition: false });
  check("卡片行的 Excel：GET /cards/2/export", (await since(from, (e) => e.path.endsWith("/export"))).map((e) => e.path).join() === "/api/quick-stats/cards/2/export");
  check("没有 Content-Disposition：文件名 quick_stats_YYYY-MM-DD_HHMM.xlsx", /^quick_stats_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/.test(await evaluate("return window.__downloads.at(-1);")), await evaluate("return JSON.stringify(window.__downloads);"));

  // Rename：格子里改，按蓝色 Save 才存
  await evaluate("$cardRow('+44 numbers').querySelector('[data-qs-card-rename]').click();");
  check("Rename：格子里出输入框 + 蓝色 Save + Cancel", await waitFor("$q('[data-qs-cards-table] [data-qs-rename] input')") &&
    (await evaluate("const s = $q('[data-qs-cards-table] [data-qs-rename-save]'); return getComputedStyle(s).backgroundColor === 'rgb(59, 130, 246)' && !!$btn('Cancel', $q('[data-qs-cards-table] [data-qs-rename]'));")));
  from = await mark();
  await evaluate("$setText($q('[data-qs-cards-table] [data-qs-rename] input'), '   ');");
  check("Rename：空名字 Save 不能按", await waitFor("$q('[data-qs-cards-table] [data-qs-rename-save]').disabled"));
  await evaluate("$setText($q('[data-qs-cards-table] [data-qs-rename] input'), 'ZZ Test +44 weekly');");
  await sleep(150);
  check("Rename：打字时没有存（先改后存）", (await since(from, (e) => e.method === "PATCH")).length === 0);
  await shoot("07a-rename");
  await evaluate("$q('[data-qs-cards-table] [data-qs-rename-save]').click();");
  check("Rename：存好后显示新名字 + 绿字 Saved", await waitFor("$q('[data-qs-renamed]') && $cardRow('ZZ Test +44 weekly')"));
  {
    const p = await since(from, (e) => e.method === "PATCH");
    check("Rename：PATCH /cards/2 {title}", p.length === 1 && p[0].path === "/api/quick-stats/cards/2" && JSON.stringify(p[0].body) === JSON.stringify({ title: "ZZ Test +44 weekly" }), JSON.stringify(p));
  }

  // Delete：先确认（Q4 A）
  from = await mark();
  await evaluate("$cardRow('ZZ Test +44 weekly').querySelector('[data-qs-card-delete]').click();");
  check("Delete：弹确认框，原文照 preview", await waitFor("$q('[data-qs-delete-text]')") &&
    (await evaluate("return $q('[role=dialog] h2')?.textContent.trim() === 'Delete this card?' && $q('[data-qs-delete-text]').textContent.replace(/\\s+/g,' ').trim() === '“ZZ Test +44 weekly” will be removed for all Super Admins. It cannot be restored from this page. Past runs stay in History.';")));
  check("Delete：确认键红色", await evaluate("const b = $btn('Delete', $q('[role=dialog]')); return !!b && getComputedStyle(b).backgroundColor === 'rgb(163, 45, 45)';"));
  await shoot("07b-delete-confirm");
  await evaluate("$btn('Cancel', $q('[role=dialog]')).click();");
  await sleep(300);
  check("Delete：Cancel 不删", (await since(from, (e) => e.method === "DELETE")).length === 0 && (await evaluate("return !!$cardRow('ZZ Test +44 weekly') && !$q('[role=dialog]');")));
  await evaluate("$cardRow('ZZ Test +44 weekly').querySelector('[data-qs-card-delete]').click();");
  await waitFor("$q('[role=dialog]')");
  await evaluate("$btn('Delete', $q('[role=dialog]')).click();");
  check("Delete：确认后 DELETE /cards/2，卡片不见", await waitFor("!$cardRow('ZZ Test +44 weekly') && !$q('[role=dialog]')") &&
    (await since(from, (e) => e.method === "DELETE")).map((e) => e.path).join() === "/api/quick-stats/cards/2");

  // ── 8 History ──
  await ctl({ seed: true, many: true });
  await openPage();
  check("History：所有人的记录，By 列有 lxu 和 zztest", await waitFor("$qa('[data-qs-by]').length >= 50") &&
    (await evaluate("const by = $qa('[data-qs-by]').map(t => t.textContent.trim()); return by.includes('lxu') && by.includes('zztest');")));
  check("History：表头 When (LA) / By / From / Question / Result / Took", (await evaluate("return $qa('[data-qs-history-table] thead th').slice(0, 6).map(t => t.textContent.trim()).join('|');")) === "When (LA)|By|From|Question|Result|Took");
  check("History：From 写 Ask / Card", await evaluate("const s = $qa('[data-qs-source]').map(t => t.textContent.trim()); return s.includes('Ask') && s.includes('Card');"));
  check("History：ok 绿、refused 黄、出错原因在下面", await evaluate("const o = $qa('[data-qs-outcome]'); const ok = o.find(x => x.textContent === 'ok'); const ref = o.find(x => x.textContent === 'refused'); return getComputedStyle(ok).color === 'rgb(30, 107, 67)' && getComputedStyle(ref).color === 'rgb(138, 90, 0)' && ref.parentElement.textContent.includes('Not run: asks to delete data');"));
  check("History：卡片跑的那行只有 Excel，没有 Save as card", await evaluate("const tr = $qa('[data-qs-history-table] tbody tr').find(t => t.querySelector('[data-qs-source]').textContent.trim() === 'Card'); return !!tr.querySelector('[data-qs-log-excel]') && !tr.querySelector('[data-qs-log-save]');"));
  check("History：问题点开看 SQL", await evaluate("const tr = $qa('[data-qs-history-table] tbody tr').find(t => t.textContent.includes('最近30天发送情况')); const d = tr.querySelector('details'); return !!d && !d.open && d.textContent.includes('FROM send_log');"));
  await shoot("08-history");
  const okLog = await evaluate("const tr = $qa('[data-qs-history-table] tbody tr').find(t => t.querySelector('[data-qs-source]').textContent.trim() === 'Ask' && t.querySelector('[data-qs-outcome]').textContent === 'ok'); return Number(tr.dataset.qsLogId);");
  from = await mark();
  await evaluate(`$logRow(${okLog}).querySelector('[data-qs-log-excel]').click();`);
  await sleep(600);
  check("History 的 Excel：GET /log/{id}/export", (await since(from, (e) => e.path.endsWith("/export"))).map((e) => e.path).join() === `/api/quick-stats/log/${okLog}/export`);
  from = await mark();
  await evaluate(`$logRow(${okLog}).querySelector('[data-qs-log-save]').click();`);
  check("History 的 Save as card：POST /cards {log_id}，绿字", await waitFor(`$logRow(${okLog})?.querySelector('[data-qs-log-saved]')`) &&
    (await since(from, (e) => e.method === "POST" && e.path === "/api/quick-stats/cards")).map((e) => e.body.log_id).join() === String(okLog));
  from = await mark();
  await evaluate("$q('[data-qs-show-more]').click();");
  check("Show more：GET /history?limit=100", await waitFor("$qa('[data-qs-by]').length > 50") && (await since(from, (e) => e.path === "/api/quick-stats/history")).some((e) => e.url === "/api/quick-stats/history?limit=100"));
  check("全部读完（不到 limit）：Show more 不见", await evaluate("return !$q('[data-qs-show-more]');"));

  // 卡片 404（被别人删了）
  await ctl({ seed: true, many: false });
  await openPage();
  await waitFor("$qa('[data-qs-cards-table] tbody tr').length === 2");
  await ctl({ seed: false }); // 后端清空；页面上的卡片还在（模拟别人刚删掉）
  await evaluate("$cardRow('Sends last 30 days').querySelector('[data-qs-card-run]').click();");
  check("卡片已不在：404 原话 That card was not found.", await waitFor("$q('[data-qs-run-error]')?.textContent === 'That card was not found.'"));

  // ── 10 还没设置好（503） ──
  await ctl({ seed: true, setup503: true });
  await openPage();
  await ask("最近30天发送情况");
  check("503：红框原样显示，Ask 不能按", await waitFor("$q('[data-qs-setup-error]')?.textContent === 'Quick Stats is not set up yet: ANTHROPIC_API_KEY is missing'") &&
    (await evaluate("return $q('[data-qs-ask-button]').disabled && $q('#qs-question').disabled;")));
  check("503：卡片和记录照样能看", await evaluate("return $qa('[data-qs-cards-table] tbody tr').length === 2 && $qa('[data-qs-by]').length > 0;"));
  await shoot("10-setup-503");
  await ctl({ setup503: false });

  // ── 9 员工 / admin ──
  for (const role of ["admin", "staff"]) {
    await ctl({ role });
    from = await mark();
    await openPage();
    check(`${role}：页面只有一句 Only a Super Admin can use Quick Stats.`, await waitFor("$q('[data-qs-forbidden]')?.textContent.trim() === 'Only a Super Admin can use Quick Stats.'") &&
      (await evaluate("return !$q('[data-qs-ask]') && !$q('[data-qs-cards]');")));
    await openNav();
    const links = await evaluate(`return ${NAV} ? [...${NAV}.querySelectorAll('a')].map(a => a.getAttribute('href')) : [];`);
    check(`${role}：侧栏没有 Quick Stats`, !links.includes("/settings/quick-stats"), JSON.stringify(links));
    await closeNav();
    if (role === "admin") await shoot("09-admin-403");
  }
  await ctl({ role: "superadmin" });

  // 401
  await ctl({ fail401: true });
  await goto(`${APP}/settings/quick-stats`);
  check("401：跳旧后台登录页", await waitFor("location.pathname === '/auth/login' || document.body.textContent.includes('LOGIN')", 30000));
  await ctl({ fail401: false });

  // ── 手机 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await ctl({ seed: true });
  await openPage();
  await ask("最近30天发送情况");
  await waitFor("$q('[data-qs-table]')", 10000);
  check("手机：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= window.innerWidth + 1;"), await evaluate("return document.documentElement.scrollWidth + ' > ' + window.innerWidth;"));
  check("手机：结果表在卡片里左右滑", await evaluate("const s = $q('[data-qs-table]').parentElement; return getComputedStyle(s).overflowX === 'auto' && s.scrollWidth > s.clientWidth;"));
  check("手机：页头说明收进「i」", await evaluate("const t = [...document.querySelectorAll('main p span')].find(s => s.textContent.startsWith('Ask a question about our data')); return getComputedStyle(t).display === 'none' && !!$q('[data-phone-info]');"));
  check("手机：Download Excel 收进 ⋯（白卡片上 ⋯ 是浅色键、看得见）", await evaluate("const m = $q('[data-qs-result] [data-phone-more]'); return !$vis($q('[data-qs-result] [data-qs-excel]')) && $vis(m) && getComputedStyle(m).color === 'rgb(26, 26, 26)';"));
  await evaluate("$q('[data-qs-result] [data-phone-more]').click();");
  check("手机：点 ⋯ 出 Download Excel", await waitFor("$vis($q('[data-qs-result] [data-phone-more-menu] [data-qs-excel]'))"));
  await shoot("11b-phone-more");
  await evaluate("$q('[data-qs-result] [data-phone-more]').click();");
  await evaluate("$qa('[data-qs-card-phone]').at(-1).querySelector('[data-phone-more]').click();");
  check("手机：最后一张卡片的 ⋯ 菜单不被卡片切掉", await waitFor("(() => { const menu = $qa('[data-qs-card-phone]').at(-1).querySelector('[data-phone-more-menu]'); if (!menu) return false; const del = menu.querySelector('[data-qs-card-delete]'); const r = del.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return del.contains(top) || top === del; })()"));
  await evaluate("$qa('[data-qs-card-phone]').at(-1).querySelector('[data-phone-more]').click();");
  check("手机：卡片一张一张往下排（Run + ⋯）", await evaluate("return !$vis($q('[data-qs-cards-table]')) && $qa('[data-qs-card-phone]').filter($vis).length === 2 && $vis($q('[data-qs-card-phone] [data-qs-card-run]'));"));
  check("手机：How to use 在最下面", await evaluate("const d = [...document.querySelectorAll('main details')].at(-1); return d.textContent.includes('How to use — Quick Stats');"));
  await shoot("11-phone");
  await cdp("Emulation.clearDeviceMetricsOverride");
}

async function main() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
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

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
