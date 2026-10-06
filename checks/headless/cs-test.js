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


// ── Content Studio 检查（拼在 harness-head.js 后面运行） ──
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const H2 = `
window.$card = (label) => [...document.querySelectorAll('section')].find(s => s.getAttribute('aria-label') === label);
window.$open = (title) => [...document.querySelectorAll('button')].find(b => b.textContent.includes(title)).click();
window.$tab = (t) => [...document.querySelectorAll('[role=tab]')].find(b => b.textContent === t).click();
`;
async function h() {
  await helpers();
  await evaluate(H2);
}
async function waitSaves(before, n) {
  for (let i = 0; i < 40; i++) {
    const s = await since(before, (e) => e.path === "/api/template-settings/save" && e.body);
    if (s.length >= n) return s;
    await sleep(150);
  }
  return since(before, (e) => e.path === "/api/template-settings/save" && e.body);
}

async function run() {
  // 有没存的改动时离开页面会弹原生确认框：测试里自动点「离开」。
  const origOnMessage = ws.onmessage;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Page.javascriptDialogOpening") {
      void cdp("Page.handleJavaScriptDialog", { accept: true });
      return;
    }
    origOnMessage(ev);
  };
  await goto(`${APP}/settings/content-studio`);
  await waitFor("document.body.textContent.includes('Tour Confirmation') && document.body.textContent.includes('Broadcasting')");
  await h();
  check("首页三个模块和线上生效的警告", await evaluate("return document.body.textContent.includes('Every Save changes the live text right away');"));

  // ── TC SMS ──
  await evaluate("$open('Tour Confirmation');");
  await sleep(200);
  await evaluate("$tab('SMS');");
  await sleep(200);
  const smsCard = "SMS body — tours WITH lunch";
  check("短信：变量提醒、字数按示例展开、Last edited by", await evaluate(`return $card('${smsCard}').textContent.includes('Do not remove or modify') && /≈ \\d+ \\/ 1,600 chars, 1 SMS/.test($card('${smsCard}').textContent) && $card('${smsCard}').textContent.includes('Last edited by annie');`));
  check("没改过的显示 Original", await evaluate("return $card('SMS body — tours WITHOUT lunch').textContent.includes('Original');"));
  const ta = `$card('${smsCard}').querySelector('textarea')`;
  await evaluate(`${ta}.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); $setValue(${ta}, 'Hi {name}\\nline2 {label} {date}');`);
  await sleep(100);
  check("短信不能换行（换行变空格）", (await evaluate(`return ${ta}.value;`)) === "Hi {name} line2 {label} {date}");
  check("去掉变量会提醒", await evaluate(`return $card('${smsCard}').textContent.includes('Removed variable(s): {url}');`));
  check("预览：短信气泡、变量换成示例", (await evaluate("return document.querySelector('aside').textContent;")).includes("Hi Sarah line2 Grand Canyon South Rim Bus Tour January 10, 2026"));
  check("有未保存的改动：页头提示", await evaluate("return document.body.textContent.includes('1 unsaved change(s)');"));
  await evaluate(`$btn('+ url', $card('${smsCard}')).click();`);
  await sleep(100);
  check("Insert 按钮插入变量", (await evaluate(`return ${ta}.value;`)).includes("{url}"));
  let before = (await mockLog()).length;
  await evaluate(`$btn('Save', $card('${smsCard}')).click();`);
  let saves = await waitSaves(before, 1);
  check("保存：POST key + value", saves.length === 1 && saves[0].body.key === "tmpl__global__tc_sms_with_lunch" && saves[0].body.value.includes("{url}"), JSON.stringify(saves));
  await waitFor(`$card('${smsCard}').textContent.includes('Saved ✓')`);
  check("Saved ✓、改为本人编辑", await evaluate(`return $card('${smsCard}').textContent.includes('Last edited by zztest');`));
  await evaluate(`$setValue(${ta}, 'x'.repeat(1601) + ' {url}');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', $card('${smsCard}')).click();`);
  await sleep(300);
  check("超长短信不让存", (await evaluate(`return $card('${smsCard}').textContent;`)).includes("This SMS template is too long") && (await since(before, (e) => e.path.endsWith("/save"))).length === 0);
  await evaluate(`$btn('Cancel', $card('${smsCard}')).click();`);
  await waitFor(dialog);
  await evaluate(`$btn('Discard', ${dialog}).click();`);
  await sleep(200);
  check("Cancel：确认后回到上次保存的", (await evaluate(`return ${ta}.value;`)).includes("{url}") && !(await evaluate(`return ${ta}.value;`)).includes("xxxx"));

  // ── Global + 接客顺序 + 保存失败 ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('⚠ Global — applies to ALL')).click();");
  await sleep(200);
  const pu = "Pick-up steps — order on the guest page";
  check("接客顺序：存的顺序在前，缺的补在后", (await evaluate(`return [...$card('${pu}').querySelectorAll('.flex-1')].map(e => e.textContent).join('|');`)) === "⏰ Head to your pickup location|📱 Morning of your tour — SMS reminder|✅ Check in when you arrive|🗺️ Not sure where to go?");
  await evaluate(`[...$card('${pu}').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Move up').click();`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', $card('${pu}')).click();`);
  saves = await waitSaves(before, 1);
  check("接客顺序保存为逗号分隔", saves[0]?.body.value === "sms,location,checkin,notsure", JSON.stringify(saves[0]?.body));
  const thanks = "Thank you page body text (after submit)";
  await evaluate(`$setValue($card('${thanks}').querySelector('textarea'), 'ZZ');`);
  await evaluate(`$btn('Save', $card('${thanks}')).click();`);
  await waitFor(`$card('${thanks}').querySelector('[role=alert]')`);
  check("没种的键：Error 和原因", (await evaluate(`return $card('${thanks}').textContent;`)).includes("Settings key not seeded"));

  // ── TIX：每行一条 + 准备步骤 + 真实预览 ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '← Back').click();");
  await sleep(200);
  await evaluate("$open('Tickets Reminder');");
  await sleep(200);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('⚠ Global — applies to ALL')).click();");
  await sleep(200);
  const kb = "Know Before You Go — General Reminder (one item per line; 3–4 lines recommended)";
  check("每行一条：读出两行", (await evaluate(`return [...$card('${kb}').querySelectorAll('input')].map(i => i.value).join('|');`)) === "Bring ID|Arrive early");
  await evaluate(`$btn('+ Add line', $card('${kb}')).click();`);
  await sleep(100);
  await evaluate(`$setValue([...$card('${kb}').querySelectorAll('input')][2], 'ZZ new line');`);
  await evaluate(`[...$card('${kb}').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Remove line').click();`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', $card('${kb}')).click();`);
  saves = await waitSaves(before, 1);
  check("每行一条：删一行加一行，换行拼接", saves[0]?.body.value === "Arrive early\nZZ new line", JSON.stringify(saves[0]?.body));
  await evaluate("$tab('Guest Page');");
  await waitFor("$card('Prepare for Your Tour')");
  check("准备步骤：有内容的第 2 步也显示（没标签）", (await evaluate("return [...$card('Prepare for Your Tour').querySelectorAll('input')].map(i => i.value).join('|');")).includes("https://keep-me"));
  await waitFor("document.querySelector('iframe[title=\"Prepare preview\"]')", 10000);
  check("真实预览（后端渲染）", (await evaluate("return document.querySelector('iframe[title=\"Prepare preview\"]').srcdoc;")).includes("Buy permit"));
  await evaluate("$btn('+ Add step', $card('Prepare for Your Tour')).click();");
  await sleep(100);
  check("+ Add step 能加出第 3 步（旧页面有时没反应）", (await evaluate("return $card('Prepare for Your Tour').textContent.includes('Step 3');")));
  await evaluate("$setValue($card('Prepare for Your Tour').querySelector('[aria-label=\"Step 1 label\"]'), 'ZZ permit');");
  before = (await mockLog()).length;
  await evaluate("$btn('Save', $card('Prepare for Your Tour')).click();");
  saves = await waitSaves(before, 1);
  await sleep(500);
  const all = await since(before, (e) => e.path.endsWith("/save"));
  check("准备步骤只存改了的键，没标签的第 2 步不被清空", all.length === 1 && all[0].body.key === "tmpl__tix__upper_antelope_tsosie__prep_1_label", JSON.stringify(all.map((e) => e.body)));

  // ── 群发模板 ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '← Back').click();");
  await sleep(200);
  await evaluate("$open('Broadcasting');");
  await waitFor("$card('Tour template 5')");
  check("显示到最后一个有内容的槽位（5 号）", !(await evaluate("return !!$card('Tour template 6');")));
  check("内置的有 🔒、5 号能删", (await evaluate("return $card('Tour template 1').textContent.includes('🔒') && !!$card('Tour template 5').querySelector('[aria-label=\"Delete template\"]');")));
  await evaluate("$btn('+ Add template').click();");
  await sleep(100);
  check("+ Add template 多出 6 号", await evaluate("return !!$card('Tour template 6');"));
  await evaluate("$setValue($card('Tour template 1').querySelector('[aria-label=\"Template 1 name\"]'), '');");
  before = (await mockLog()).length;
  await evaluate("$btn('Save', $card('Tour template 1')).click();");
  await sleep(300);
  check("内置模板名字不能清空", (await evaluate("return $card('Tour template 1').textContent;")).includes("Built-in templates must keep a name") && (await since(before, (e) => e.path.endsWith("/save"))).length === 0);
  await evaluate("$setValue($card('Tour template 6').querySelector('[aria-label=\"Template 6 body\"]'), 'body only');");
  await evaluate("$btn('Save', $card('Tour template 6')).click();");
  await sleep(300);
  check("有正文没名字不让存", (await evaluate("return $card('Tour template 6').textContent;")).includes("Give this template a name"));
  before = (await mockLog()).length;
  await evaluate("$card('Tour template 5').querySelector('[aria-label=\"Delete template\"]').click();");
  await waitFor(dialog);
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  saves = await waitSaves(before, 2);
  check("删除 5 号：标题和正文都存成空", saves.length === 2 && saves.every((x) => x.body.value === "") && saves[0].body.key === "tmpl__bcast__tour__t5__title", JSON.stringify(saves.map((x) => x.body)));
  check("签名卡", await evaluate("return !!$card('✍ Signature') && $card('✍ Signature').textContent.includes('Appended to the end of every Tour broadcast.');"));

  // ── 权限 / 未登录 ──
  await ctl({ staff: true });
  await goto(`${APP}/settings/content-studio`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff：Admin access required", true);
  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/content-studio`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${MOCK}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
