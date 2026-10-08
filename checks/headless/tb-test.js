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


// ── Task Board 检查（拼在 harness-head.js 后面运行） ──
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
window.$cards = () => [...document.querySelectorAll('article')].map(a => a.querySelector('[data-card-title]')?.textContent);
window.$card = (n) => [...document.querySelectorAll('article')].find(a => a.textContent.includes(n));
window.$tab = (n) => [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.startsWith(n));
`;

async function run() {
  await goto(`${APP}/task-board`);
  await waitFor("document.querySelectorAll('article').length >= 2");
  await helpers();
  await evaluate(H2);

  check("默认选包含今天的 Sprint（Supplier 02）", (await evaluate("return document.querySelector('[aria-label=Sprint]').value;")) === "s2");
  check("只拉当前标签（Sprint 02）", (await mockLog()).filter((e) => e.path === "/api/task-board/tasks").every((e) => e.query === "?list_id=s2"));
  check("排序：urgent 在前，已完成默认隐藏", (await evaluate("return $cards().join('|');")) === "ZZ Urgent task|ZZ Normal task");
  check("隐藏已完成的提示", await evaluate("return document.body.textContent.includes('显示 2 / 3 条（已隐藏 1 条已完成）');"));
  check("标签上的数字：未完成数", (await evaluate("return $tab('Supplier Sprint').textContent;")) === "Supplier Sprint2");
  check("截止日、负责人", (await evaluate("return $card('ZZ Urgent').textContent.includes('截止:') && $card('ZZ Normal').textContent.includes('Amy');")));
  await evaluate("[...document.querySelectorAll('input[type=checkbox]')][0].click();");
  await sleep(100);
  check("显示已完成", (await evaluate("return $cards().length;")) === 3);
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'amy');");
  await sleep(100);
  check("搜索负责人", (await evaluate("return $cards().join('|');")) === "ZZ Normal task");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  let before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=Sprint]'), 's1');");
  await waitFor("$cards().includes('ZZ old sprint task')");
  check("换 Sprint 拉对应列表", (await since(before, (e) => e.query === "?list_id=s1")).length >= 1);

  // ── 评论（🧩 前缀） ──
  await evaluate("$sel(document.querySelector('[aria-label=Sprint]'), 's2');");
  await waitFor("!!$card('ZZ Normal')");
  await evaluate("$card('ZZ Normal').querySelector('[role=button]').click();");
  await waitFor("$card('ZZ Normal').textContent.includes('Task Board')");
  check("🧩 开头的评论高亮并带 Task Board 标签", (await evaluate("return $card('ZZ Normal').textContent;")).includes("🧩 Amy: hi"));
  await evaluate("$setValue($card('ZZ Normal').querySelector('textarea'), 'ZZ hello');");
  before = (await mockLog()).length;
  await evaluate("$btn('发送', $card('ZZ Normal')).click();");
  await waitFor("$card('ZZ Normal').textContent.includes('✓ 已提交到 ClickUp')");
  let post = (await since(before, (e) => e.method === "POST"))[0];
  check("评论正文：🧩 + 当前用户名", post && post.body.comment_text === "🧩 ZZ Tester: ZZ hello", JSON.stringify(post));
  await ctl({ failUpload: true });
  await setFiles("article input[type=file]", ["manifest.csv"]);
  await sleep(100);
  before = (await mockLog()).length;
  await evaluate("$btn('发送', $card('ZZ Normal')).click();");
  await waitFor("($card('ZZ Normal').querySelector('[role=alert]')?.textContent || '').includes('附件上传失败')");
  check("只传附件且失败：写原因、不发空评论", (await since(before, (e) => e.path.endsWith("/comment") && e.method === "POST")).length === 0);
  await ctl({ failUpload: false });

  // ── 池子 / 新建 ──
  await evaluate("$tab('Requirement pool').click();");
  await waitFor("!!$card('ZZ Req')");
  check("Requirement pool 有新建按钮", await evaluate("return !!$btn('+ 新建到 Requirement pool');"));
  await evaluate("$btn('+ 新建到 Requirement pool').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Max')`);
  check("提交人只读、显示当前用户", (await evaluate(`return [...${dialog}.querySelectorAll('input')].find(i => i.readOnly).value;`)) === "ZZ Tester");
  await evaluate(`$btn('Submit', ${dialog}).click();`);
  await sleep(100);
  check("没标题：请填写 Title", (await evaluate(`return ${dialog}.textContent;`)).includes("请填写 Title"));
  await evaluate(`$setValue(${dialog}.querySelector('input[placeholder="标题"]'), 'ZZ Test new'); $sel([...${dialog}.querySelectorAll('select')][0], '2'); $sel([...${dialog}.querySelectorAll('select')][1], '7'); $setValue(${dialog}.querySelector('input[type=date]'), '2026-10-20');`);
  await setFiles("[role=dialog] input[type=file]", ["manifest.csv"]);
  await ctl({ failUpload: true });
  before = (await mockLog()).length;
  await evaluate(`$btn('Submit', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('任务已建好，但附件上传失败')`);
  post = (await since(before, (e) => e.path === "/api/task-board/tasks" && e.method === "POST"))[0];
  const due = await evaluate("return new Date(2026, 9, 20).getTime();");
  check("新建请求体（不带提交人，本地零点截止日）", post && post.body.list_id === "req" && post.body.title === "ZZ Test new" && post.body.priority === 2 && post.body.assignee_id === 7 && post.body.due_date === due && !("reporter" in post.body), JSON.stringify(post?.body));
  check("建好但附件失败：按钮锁住，不能再提交", await evaluate(`return $btn('任务已建好', ${dialog}).disabled;`));
  await ctl({ failUpload: false });
  await evaluate(`$btn('关闭', ${dialog}).click();`);
  await waitFor("!!$card('ZZ Test new')");
  check("建好后列表刷新", true);
  await evaluate("$tab('Backlog').click();");
  await sleep(300);
  check("Backlog 没有新建按钮", !(await evaluate("return !!$btn('+ 新建到');")));
  await evaluate("$tab('Bug pool').click();");
  await waitFor("!!$card('ZZ Bug pool item')");
  check("截断提示", await evaluate("return document.body.textContent.includes('数据可能不完整');"));

  // ── 指派给我 / 文档 ──
  await evaluate("$tab('Assigned to me').click();");
  await waitFor("!!$card('ZZ assigned')");
  check("指派给我：找不到邮箱的警告、列表名", (await evaluate("return document.body.textContent.includes('在 ClickUp 成员里找不到 azhou@example.test');")) && (await evaluate("return $card('ZZ assigned').textContent.includes('Bug pool');")));
  await evaluate("$tab('📄 文档').click();");
  await waitFor("document.body.textContent.includes('Overview')");
  const doc = await evaluate("return document.querySelector('nav[aria-label=文档]').nextElementSibling.innerHTML;");
  check("文档：Markdown 标题 / 粗体 / 代码 / 列表 / 表格", doc.includes("<h3") && doc.includes("<strong>Bold</strong>") && doc.includes("<code") && doc.includes("<li>one</li>") && doc.includes("<table"), doc.slice(0, 300));
  check("文档：只有 https 链接可点，<script> 原样显示不执行", doc.includes('href="https://example.test/"') && !doc.includes('href="javascript:') && doc.includes("&lt;script&gt;"));
  check("取不到的文档写原因", await evaluate("return document.body.textContent.includes('⚠️ 内容取不到（ClickUp 500）');"));
  await evaluate("[...document.querySelectorAll('nav[aria-label=文档] button')].find(b => b.textContent === 'Child').click();");
  await sleep(100);
  check("空页面：这一页没有内容。", await evaluate("return document.body.textContent.includes('这一页没有内容。');"));

  // ── 出错 / 刷新 / 未登录 ──
  await ctl({ failBacklog: true });
  await evaluate("$tab('Backlog').click();");
  await evaluate("$btn('刷新数据').click();");
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('ClickUp returned 503'))");
  check("取不到：写明不代表没有任务，带原因", await evaluate("return document.body.textContent.includes('这不代表这里没有任务') && document.body.textContent.includes('ClickUp returned 503');"), await evaluate("return [...document.querySelectorAll('[role=alert]')].map(a => a.textContent).join(' | ');"));
  await ctl({ failBacklog: false });
  await evaluate("$btn('刷新数据').click();");
  await waitFor("document.body.textContent.includes('暂无任务')");
  check("刷新后重新拉取成功", true);
  await ctl({ fail401: true });
  await goto(`${APP}/task-board`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
