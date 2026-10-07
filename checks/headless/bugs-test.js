// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:3198";
const MOCK = "http://localhost:8799";
const PORT = 9333;
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


// ── Bug Reports 检查（拼在 harness-head.js 后面运行） ──
const DIR = __dirname.replace(/\\/g, "/");
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
async function setFiles(selector, files) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: files.map((f) => `${DIR}/${f}`) });
}
const H2 = `
window.$sel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
window.$cards = () => [...document.querySelectorAll('article')].map(a => a.querySelector('.font-semibold.text-stone-900')?.textContent);
window.$card = (name) => [...document.querySelectorAll('article')].find(a => a.textContent.includes(name));
`;
async function h() {
  await helpers();
  await evaluate(H2);
}

async function run() {
  await goto(`${APP}/bug-reports`);
  await waitFor("document.querySelectorAll('article').length === 4");
  await h();

  const stats = await evaluate("return $t('section[aria-label=Summary] button');");
  check("统计（中文默认）：全部 4 / 未关闭 2 / P0 2 / P1 0 / P2 1 / 无负责人 1", stats.join("|") === "全部 Bug4|未关闭2|P02|P10|P21|无负责人1", stats.join("|"));
  check("默认排序：没关闭的在前，按严重程度", (await evaluate("return $cards().join('|');")) === "ZZ <b>Login</b> fails|ZZ Typo|ZZ Old done|ZZ Rejected");
  check("标题照原样显示（不当 HTML）", !(await evaluate("return !!document.querySelector('article b');")));
  check("javascript: 链接不做成链接", (await evaluate("return [...$card('ZZ Typo').querySelectorAll('a')].length;")) === 0 && (await evaluate("return $card('ZZ <b>Login').querySelector('a').getAttribute('href');")) === "https://app.clickup.com/t/t1");
  check("javascript: 头像不显示成图片，用首字母", (await evaluate("return $card('ZZ Old done').querySelectorAll('img').length;")) === 0 && (await evaluate("return $card('ZZ Old done').textContent.includes('B');")));
  check("超过 7 天没关闭的天数标红", (await evaluate("return $card('ZZ <b>Login').textContent.includes('已 10 天');")) && (await evaluate("return [...$card('ZZ <b>Login').querySelectorAll('span')].some(s => s.textContent === '已 10 天' && s.className.includes('red'));")));
  const pills = await evaluate("return $t('[aria-label=Status] button');");
  check("状态按钮的数字", pills[0] === "全部4" && pills.includes("新建 New1") && pills.includes("已拒绝 Rejected1") && pills.includes("转为需求 Moved to Backlog0"), pills.join("|"));

  // ── 筛选 ──
  await evaluate("[...document.querySelectorAll('section[aria-label=Summary] button')][1].click();");
  await sleep(100);
  check("点「未关闭」只剩 2 条", (await evaluate("return $cards().length;")) === 2);
  await evaluate("[...document.querySelectorAll('section[aria-label=Summary] button')][1].click();");
  await evaluate("[...document.querySelectorAll('[aria-label=Status] button')].find(b => b.textContent.startsWith('已拒绝')).click();");
  await sleep(100);
  check("状态按钮筛选、按钮亮着", (await evaluate("return $cards().join('|');")) === "ZZ Rejected" && (await evaluate("return [...document.querySelectorAll('[aria-label=Status] button')].find(b => b.textContent.startsWith('已拒绝')).getAttribute('aria-pressed');")) === "true");
  await evaluate("[...document.querySelectorAll('[aria-label=Status] button')].find(b => b.textContent.startsWith('转为需求')).click();");
  await sleep(100);
  check("空的状态：目前为空", await evaluate("return document.body.textContent.includes('目前为空');"));
  await evaluate("[...document.querySelectorAll('[aria-label=Status] button')][0].click();");
  await evaluate("$sel(document.querySelector('[aria-label=Reporter]'), 'Annie');");
  await sleep(100);
  check("提交人筛选（从描述里读）", (await evaluate("return $cards().join('|');")) === "ZZ <b>Login</b> fails");
  check("提交人下拉不重复", (await evaluate("return [...document.querySelectorAll('[aria-label=Reporter] option')].map(o => o.textContent).join('|');")) === "所有提交人|Annie|Max");
  await evaluate("$sel(document.querySelector('[aria-label=Reporter]'), '');");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'bob');");
  await sleep(100);
  check("搜索负责人", (await evaluate("return $cards().join('|');")) === "ZZ Old done");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  await evaluate("$sel(document.querySelector('[aria-label=Sort]'), 'days-desc');");
  await sleep(100);
  check("天数最多优先（关闭的仍在后）", (await evaluate("return $cards().join('|');")) === "ZZ <b>Login</b> fails|ZZ Typo|ZZ Old done|ZZ Rejected");
  await evaluate("$sel(document.querySelector('[aria-label=Sort]'), 'priority');");

  // ── 展开、评论 ──
  let before = (await mockLog()).length;
  await evaluate("$card('ZZ <b>Login').querySelector('[role=button]').click();");
  await waitFor("$card('ZZ <b>Login').textContent.includes('评论历史')");
  const t1 = await since(before, (e) => e.path.startsWith("/api/bug-reports/task/t1"));
  // 开发模式下 React 会把 effect 跑两遍（第一遍被中止），请求数可能是 4；只看两个接口都请求到了。
  check("展开才拉评论和任务详情", t1.some((e) => e.path === "/api/bug-reports/task/t1/comment") && t1.some((e) => e.path === "/api/bug-reports/task/t1"), JSON.stringify(t1.map((e) => e.path)));
  const card = await evaluate("return $card('ZZ <b>Login').textContent;");
  check("描述、最新一条（日报标记）、历史", card.includes("[Reported by: Annie]") && card.includes("📅 Daily: still broken") && card.includes("日报") && card.includes("Amy: looking"));
  check("附件按上传人和时间配到最新一条评论", (await evaluate("return $card('ZZ <b>Login').querySelectorAll('img[alt=Attachment]').length;")) === 1);
  await evaluate("$card('ZZ <b>Login').querySelector('img[alt=Attachment]').closest('button').click();");
  await waitFor(dialog);
  check("点缩略图放大", (await evaluate(`return ${dialog}.querySelector('img').src;`)) === "https://example.test/shot.png");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));");
  await sleep(100);
  await evaluate("$btn('发送', $card('ZZ <b>Login')).click();");
  await sleep(100);
  check("空评论：请输入内容或选择文件", (await evaluate("return $card('ZZ <b>Login').textContent;")).includes("请输入内容或选择文件"));
  await evaluate("$setValue($card('ZZ <b>Login').querySelector('textarea'), 'ZZ hello');");
  await setFiles("article input[type=file]", ["manifest.csv"]);
  await sleep(100);
  before = (await mockLog()).length;
  await evaluate("$btn('发送', $card('ZZ <b>Login')).click();");
  await waitFor("$card('ZZ <b>Login').textContent.includes('✓ 已提交到 ClickUp')");
  let log = await since(before, (e) => e.method === "POST");
  check("先传附件、再发评论，正文前加当前用户名", log.length === 2 && log[0].path.endsWith("/attachment") && log[0].filename === "manifest.csv" && log[1].body.comment_text === "ZZ Tester: ZZ hello", JSON.stringify(log));
  await ctl({ failComment: true });
  await evaluate("$setValue($card('ZZ <b>Login').querySelector('textarea'), 'ZZ keep me');");
  await evaluate("$btn('发送', $card('ZZ <b>Login')).click();");
  await waitFor("$card('ZZ <b>Login').querySelector('[role=alert]')");
  check("评论发失败：说明原因、保留原文", (await evaluate("return $card('ZZ <b>Login').querySelector('[role=alert]').textContent;")).includes("提交失败：HTTP 502 (ClickUp returned 500)") && (await evaluate("return $card('ZZ <b>Login').querySelector('textarea').value;")) === "ZZ keep me");
  await ctl({ failComment: false, failUpload: true });
  await evaluate("$setValue($card('ZZ <b>Login').querySelector('textarea'), '');");
  await setFiles("article input[type=file]", ["BADFILE.csv"]);
  await sleep(100);
  before = (await mockLog()).length;
  await evaluate("$btn('发送', $card('ZZ <b>Login')).click();");
  await waitFor("($card('ZZ <b>Login').querySelector('[role=alert]')?.textContent || '').includes('附件上传失败')");
  check("只有附件且上传失败：写明哪个文件和原因，不发空评论", (await evaluate("return $card('ZZ <b>Login').querySelector('[role=alert]').textContent;")).includes("BADFILE.csv (HTTP 502: File too large)") && (await since(before, (e) => e.path.endsWith("/comment") && e.method === "POST")).length === 0);
  await ctl({ failUpload: false });

  // ── 附件传上去但评论发失败：草稿空着再点发送，补发「上传了 N 张附件」 ──
  await ctl({ failComment: true });
  await evaluate("$setValue($card('ZZ <b>Login').querySelector('textarea'), '');");
  await setFiles("article input[type=file]", ["manifest.csv"]);
  await sleep(100);
  before = (await mockLog()).length;
  await evaluate("$btn('发送', $card('ZZ <b>Login')).click();");
  await waitFor("($card('ZZ <b>Login').querySelector('[role=alert]')?.textContent || '').includes('提交失败')");
  check("附件已传、评论失败：提示提交失败", (await since(before, (e) => e.path.endsWith("/attachment"))).length === 1);
  await ctl({ failComment: false });
  before = (await mockLog()).length;
  await evaluate("$btn('发送', $card('ZZ <b>Login')).click();");
  await waitFor("$card('ZZ <b>Login').textContent.includes('✓ 已提交到 ClickUp')");
  log = await since(before, (e) => e.method === "POST");
  check("重试：草稿空也补发「上传了 1 张附件」，不重复上传", log.length === 1 && log[0].path.endsWith("/comment") && Buffer.from(log[0].body.comment_text, "latin1").toString("utf8") === "📎 ZZ Tester 上传了 1 张附件", JSON.stringify(log));
  await sleep(300);
  before = (await mockLog()).length;
  await evaluate("$btn('发送', $card('ZZ <b>Login')).click();");
  await sleep(300);
  check("补发成功后清掉：再点发送提示请输入内容", (await evaluate("return $card('ZZ <b>Login').textContent;")).includes("请输入内容或选择文件") && (await since(before, (e) => e.method === "POST")).length === 0);

  // ── 刷新时列表不卸载，展开卡片里没发的评论草稿保留 ──
  await evaluate("$setValue($card('ZZ <b>Login').querySelector('textarea'), 'ZZ draft stays');");
  await ctl({ listDelay: 1500 });
  await evaluate("$btn('刷新数据').click();");
  await waitFor("document.body.textContent.includes('正在从 ClickUp 拉取数据')", 3000);
  check("刷新中：卡片和草稿还在", (await evaluate("return $card('ZZ <b>Login')?.querySelector('textarea')?.value;")) === "ZZ draft stays");
  await waitFor("!document.body.textContent.includes('正在从 ClickUp 拉取数据')", 8000);
  await ctl({ listDelay: 0 });
  check("刷新完：草稿保留", (await evaluate("return $card('ZZ <b>Login')?.querySelector('textarea')?.value;")) === "ZZ draft stays");
  await evaluate("$setValue($card('ZZ <b>Login').querySelector('textarea'), '');");

  // ── 语言 ──
  await evaluate("$btn('EN').click();");
  await sleep(100);
  check("切英文", (await evaluate("return $t('section[aria-label=Summary] button').join('|');")) === "All Bugs4|Open2|P02|P10|P21|No Assignee1" && (await evaluate("return document.body.textContent.includes('Comment History') && !!$btn('中文');")));

  // ── 新建 ──
  await evaluate("$btn('＋ New Bug').click();");
  await waitFor(dialog);
  check("Severity 选项来自 Bug Severity 字段（P0/P1/P2）", (await evaluate(`return [...${dialog}.querySelector('[aria-label=Severity]').options].map(o => o.textContent).join('|');`)) === "— Select —|P0|P1|P2");
  check("Reported By 默认填当前用户", (await evaluate(`return [...${dialog}.querySelectorAll('input')].find(i => i.placeholder === 'Your name').value;`)) === "ZZ Tester");
  await evaluate(`$btn('Submit', ${dialog}).click();`);
  await sleep(100);
  check("没标题：Please enter a title", (await evaluate(`return ${dialog}.textContent;`)).includes("Please enter a title"));
  await evaluate(`$setValue(${dialog}.querySelector('input[placeholder="Bug title"]'), 'BAD');`);
  await evaluate(`$btn('Submit', ${dialog}).click();`);
  await waitFor(`${dialog}.querySelector('[role=alert]')?.textContent.includes('Task name invalid')`);
  check("ClickUp 拒绝：显示 ClickUp 给的原因", (await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent;`)) === "Submit failed: HTTP 502: Task name invalid");
  await evaluate(`$setValue(${dialog}.querySelector('input[placeholder="Bug title"]'), 'ZZ Test new bug');`);
  const sels = `[...${dialog}.querySelectorAll('select')]`;
  await evaluate(`$sel(${sels}[0], 'p1'); $sel(${sels}[1], 'Tour'); $sel(${sels}[2], '1');`);
  await evaluate(`$setValue(${dialog}.querySelector('input[type=date]'), '2026-10-20');`);
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), 'Desc here');`);
  await setFiles("[role=dialog] input[type=file]", ["manifest.csv"]);
  await ctl({ failUpload: true });
  before = (await mockLog()).length;
  await evaluate(`$btn('Submit', ${dialog}).click();`);
  await waitFor(`${dialog}.querySelector('[role=alert]')?.textContent.includes('did not upload')`);
  log = await since(before, (e) => e.method === "POST");
  const created = log.find((e) => e.path === "/api/bug-reports/tasks");
  const due = await evaluate("return new Date(2026, 9, 20).getTime();");
  check("新建请求体：描述带提交人、负责人、本地零点截止日、Bug Severity（自定义字段）、Workstream", created && created.body.description === "[Reported by: ZZ Tester]\n\nDesc here" && created.body.assignees[0] === 1 && created.body.due_date === due && created.body.priority === null && created.body.custom_fields[0].value === "fe3e41eb-4f5c-41fc-acc7-5924618baacb" && created.body.custom_fields[1].id === "sev" && created.body.custom_fields[1].value === "p1", JSON.stringify(created?.body));
  await ctl({ failUpload: false });
  before = (await mockLog()).length;
  await evaluate(`$btn('Submit', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('✓ Bug submitted to ClickUp')`);
  log = await since(before, (e) => e.method === "POST");
  check("附件失败后重试：只补传附件，不重复建任务", log.length === 1 && log[0].path.endsWith("/attachment"), JSON.stringify(log));
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await waitFor("document.querySelectorAll('article').length === 5");
  check("建好后列表刷新", true);

  // ── /api/me 晚到：Reported By 到了再填；人已经改过就不动 ──
  await ctl({ meDelay: 2500 });
  await goto(`${APP}/bug-reports`);
  await waitFor("document.querySelectorAll('article').length === 5");
  await h();
  if (await evaluate("return !$btn('＋ New Bug');")) { await evaluate("$btn('EN').click();"); await waitFor("!!$btn('＋ New Bug')"); }
  await evaluate("$btn('＋ New Bug').click();");
  await waitFor(dialog);
  const reportedBy = `[...${dialog}.querySelectorAll('input')].find(i => i.placeholder === 'Your name')`;
  await waitFor(`${reportedBy}.value === 'ZZ Tester'`, 8000);
  check("/api/me 晚到：Reported By 自动填上", (await evaluate(`return ${reportedBy}.value;`)) === "ZZ Tester");
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await goto(`${APP}/bug-reports`);
  await waitFor("document.querySelectorAll('article').length === 5");
  await h();
  if (await evaluate("return !$btn('＋ New Bug');")) { await evaluate("$btn('EN').click();"); await waitFor("!!$btn('＋ New Bug')"); }
  await evaluate("$btn('＋ New Bug').click();");
  await waitFor(dialog);
  await evaluate(`$setValue(${reportedBy}, 'ZZ Typed');`);
  await sleep(3500);
  check("/api/me 晚到：已经手填的不被覆盖", (await evaluate(`return ${reportedBy}.value;`)) === "ZZ Typed");
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await ctl({ meDelay: 0 });

  // ── 出错 / 截断 / 未登录 ──
  await ctl({ truncated: true });
  await evaluate("$btn('Refresh').click();");
  await waitFor("document.body.textContent.includes('may be incomplete')");
  check("数据被截断：提示", true);
  await ctl({ truncated: false, failList: true });
  await evaluate("$btn('Refresh').click();");
  await waitFor("document.body.textContent.includes('This does not mean there are no bugs')");
  check("拉取失败：写明不是没有 bug", await evaluate("return document.body.textContent.includes('This does not mean there are no bugs') && document.body.textContent.includes('ClickUp returned 503');"));
  await ctl({ failList: false, fail401: true });
  await goto(`${APP}/bug-reports`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
