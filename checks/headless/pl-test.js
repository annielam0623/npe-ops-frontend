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


// ── Pickup Locations 检查（拼在 harness-head.js 后面运行） ──
const dialog = "document.querySelector('[role=dialog]')";
const rowOf = (name) => `[...document.querySelectorAll('tbody tr')].find(tr => tr.children[0].textContent.startsWith(${JSON.stringify(name)}))`;
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
async function waitRows(n) {
  return waitFor(`document.querySelectorAll('tbody tr').length === ${n} && !document.body.textContent.includes('Loading…')`);
}

async function run() {
  await openPage(`${APP}/settings/pickup-locations`);
  await waitRows(3);
  await helpers();

  // ── 列表 ──
  check("计数 3 locations", await evaluate("return document.body.textContent.includes('3 locations');"));
  const names = (await evaluate("return $rows().map(r => r[0]);")).map((n) => n.replace(/Tour bus departure$/, ""));
  check("按名字排序、停用的带 Inactive", names[0] === "Aria" && names[1] === "Resorts World" && names[2].endsWith("Inactive"), names.join(" | "));
  check("酒店名里的引号和尖括号照原样显示（不当 HTML）", names[2].startsWith('ZZ Test Qzx "Quote" <b>Inn</b>') && !(await evaluate("return !!document.querySelector('tbody b');")));
  const photo = await evaluate(`return ${rowOf("Aria")}.children[1].querySelector('a').getAttribute('href') + '|' + ${rowOf("Aria")}.children[1].textContent;`);
  check("Photo URL 链接、站内地址缩短显示", photo === "https://nationalparkexpress.com/pickup/aria|…/pickup/aria", photo);
  check("javascript: 地址不做成链接", await evaluate(`return !${rowOf("ZZ Test")}.children[1].querySelector('a') && ${rowOf("ZZ Test")}.children[1].textContent === 'javascript:alert(1)';`));
  check("空值显示 —", (await evaluate(`return ${rowOf("Resorts World")}.children[1].textContent;`)) === "—");
  await waitFor(`${rowOf("Aria")}.children[2].textContent.includes('cannot load')`, 10000);
  const map = await evaluate(`return [${rowOf("Aria")}.children[2].querySelectorAll('img').length, ${rowOf("Aria")}.children[2].textContent];`);
  check("两张地图图片；加载失败的写 ⚠ cannot load", map[1].includes("⚠ cannot load"), JSON.stringify(map));
  check("停用的按钮是 Reactivate", await evaluate(`return !!$btn('Reactivate', ${rowOf("ZZ Test")}) && !!$btn('Deactivate', ${rowOf("Aria")});`));

  // ── 搜索 ──
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'rwlv');");
  await sleep(150);
  check("搜索 Aliases", (await evaluate("return $rows().length;")) === 1 && (await evaluate("return document.body.textContent.includes('1 of 3');")));
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'nationalparkexpress.com/pickup');");
  await sleep(150);
  check("Photo URL 不在搜索范围（同旧页面）", (await evaluate("return $rows()[0][0];")) === "No locations found.");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  await sleep(150);

  // ── 新增 ──
  let before = (await mockLog()).length;
  await evaluate("$btn('Add').click();");
  await sleep(150);
  check("没填酒店名：提示、不发请求", (await evaluate("return document.body.textContent.includes('Hotel name is required.');")) && (await since(before, (e) => e.method === "POST")).length === 0);
  check("Short 输入框限 120 字", (await evaluate("return document.getElementById('new-short').maxLength;")) === 120);
  await evaluate("$setValue(document.getElementById('new-name'), '  ZZ Test Qzx Lodge  ');");
  await evaluate("$setValue(document.getElementById('new-short'), 'Front door');");
  await evaluate("$setValue(document.getElementById('new-aliases'), 'rwlv');");
  await evaluate("$setValue(document.getElementById('new-map'), 'https://example.test/a.png');");
  await evaluate("$btn('＋').click();");
  await sleep(100);
  check("＋ 加第二张后变灰", await evaluate("return document.querySelectorAll('[aria-label=\"Second map image\"]').length === 1 && $btn('＋').disabled;"));
  await evaluate("$setValue(document.querySelector('[aria-label=\"Second map image\"]'), ' https://example.test/b.png ');");
  before = (await mockLog()).length;
  await evaluate("$btn('Add').click();");
  await waitFor("document.querySelector('form [role=alert]')");
  let post = (await since(before, (e) => e.method === "POST"))[0];
  check("Alias 冲突：显示后端原因、草稿保留", (await evaluate("return document.querySelector('form [role=alert]').textContent;")).includes('"rwlv" already points to "Resorts World"') && (await evaluate("return document.getElementById('new-name').value;")) === "  ZZ Test Qzx Lodge  ");
  check("请求体：去空格、两张图换行拼接、6 项都传", post && post.body.hotel_name === "ZZ Test Qzx Lodge" && post.body.map_image_url === "https://example.test/a.png\nhttps://example.test/b.png" && post.body.photo_url === "" && post.body.instruction === "" && Object.keys(post.body).length === 6, JSON.stringify(post?.body));
  await evaluate("$setValue(document.getElementById('new-aliases'), 'ZZQ');");
  before = (await mockLog()).length;
  await evaluate("$btn('Add').click();");
  await waitFor("document.body.textContent.includes('✓ Added')");
  await waitRows(4);
  check("新增成功：✓ Added、表单清空、地图回到一行、列表重拉", (await evaluate("return document.getElementById('new-name').value === '' && document.querySelectorAll('[aria-label=\"Second map image\"]').length === 0;")) && (await evaluate("return $rows().some(r => r[0].replace(/Tour bus departure$/, '') === 'ZZ Test Qzx Lodge');")));
  check("计数 4 locations", await evaluate("return document.body.textContent.includes('4 locations');"));

  // ── 编辑（多行同时开、搜索时草稿保留） ──
  await evaluate(`$btn('✏ Edit', ${rowOf("ZZ Test Qzx Lodge")}).click();`);
  await evaluate(`$btn('✏ Edit', ${rowOf("Aria")}).click();`);
  await sleep(150);
  check("可以同时打开两行编辑", (await evaluate("return document.querySelectorAll('tbody input[aria-label=\"Hotel name\"]').length;")) === 2);
  const lodgeInput = "[...document.querySelectorAll('tbody input[aria-label=\"Hotel name\"]')].find(i => i.value.startsWith('ZZ Test Qzx Lodge'))";
  await evaluate(`$setValue(${lodgeInput}, 'ZZ Test Qzx Lodge 2');`);
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'resorts');");
  await sleep(150);
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  await sleep(150);
  check("搜索后草稿还在", (await evaluate("return [...document.querySelectorAll('tbody input[aria-label=\"Hotel name\"]')].map(i => i.value).join('|');")).includes("ZZ Test Qzx Lodge 2"));
  await evaluate(`$btn('✏ Edit', ${rowOf('ZZ Test Qzx "Quote"')}).click();`);
  await sleep(100);
  check("编辑框里引号和尖括号原样（旧页面会截断）", await evaluate(`return [...document.querySelectorAll('tbody input[aria-label="Hotel name"]')].some(i => i.value === 'ZZ Test Qzx "Quote" <b>Inn</b>');`));
  await evaluate(`$btn('Cancel', [...document.querySelectorAll('tbody tr')].find(tr => tr.querySelector('input[aria-label="Hotel name"]')?.value.includes('Quote'))).click();`);
  await sleep(100);
  // Aria 的 Short 太长
  const ariaShort = "[...document.querySelectorAll('tbody tr')].find(tr => tr.querySelector('input[aria-label=\"Hotel name\"]')?.value === 'Aria').querySelector('input[aria-label=\"Short (for SMS)\"]')";
  await evaluate(`${ariaShort}.removeAttribute('maxlength'); $setValue(${ariaShort}, 'x'.repeat(121));`);
  before = (await mockLog()).length;
  await evaluate("$btn('Save', [...document.querySelectorAll('tbody tr')].find(tr => tr.querySelector('input[aria-label=\"Hotel name\"]')?.value === 'Aria')).click();");
  await waitFor("document.querySelector('tbody [role=alert]')");
  check("保存失败：原因写在那一行，行保持打开", (await evaluate("return document.querySelector('tbody [role=alert]').textContent;")).includes("the limit is 120"));
  await evaluate("$btn('Cancel', [...document.querySelectorAll('tbody tr')].find(tr => tr.querySelector('input[aria-label=\"Hotel name\"]')?.value === 'Aria')).click();");
  await sleep(100);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', [...document.querySelectorAll('tbody tr')].find(tr => tr.querySelector('input[aria-label=\"Hotel name\"]')?.value === 'ZZ Test Qzx Lodge 2')).click();`);
  await waitFor("$rows().some(r => r[0].replace(/Tour bus departure$/, '') === 'ZZ Test Qzx Lodge 2')");
  const put = (await since(before, (e) => e.method === "PUT"))[0];
  check("保存：PUT 全部 6 项", put && put.path === "/api/pickup-locations/50" && put.body.hotel_name === "ZZ Test Qzx Lodge 2" && put.body.aliases === "ZZQ" && put.body.map_image_url.includes("\n") && Object.keys(put.body).length === 6, JSON.stringify(put));
  check("Cancel 只关那一行，没有 PUT", (await since(before, (e) => e.method === "PUT" && e.path === "/api/pickup-locations/1")).length === 0 && (await evaluate("return document.querySelectorAll('tbody input[aria-label=\"Hotel name\"]').length;")) === 0);

  // ── 停用 / 恢复 ──
  await evaluate(`$btn('Deactivate', ${rowOf("ZZ Test Qzx Lodge 2")}).click();`);
  await waitFor(dialog);
  check("停用先确认，写明影响", (await evaluate(`return ${dialog}.textContent;`)).includes("It stops appearing when you add hotels in Dispatch."));
  before = (await mockLog()).length;
  await evaluate(`$btn('Deactivate', ${dialog}).click();`);
  await waitFor(`!${dialog} && ${rowOf("ZZ Test Qzx Lodge 2")}.textContent.includes('Inactive')`);
  let patch = (await since(before, (e) => e.method === "PATCH"))[0];
  check("停用：PATCH active=false", patch && patch.path === "/api/pickup-locations/50/active" && patch.body.active === false);
  before = (await mockLog()).length;
  await evaluate(`$btn('Reactivate', ${rowOf("ZZ Test Qzx Lodge 2")}).click();`);
  await waitFor(`!${rowOf("ZZ Test Qzx Lodge 2")}.textContent.includes('Inactive')`);
  patch = (await since(before, (e) => e.method === "PATCH"))[0];
  check("恢复不用确认：PATCH active=true", patch && patch.body.active === true);

  // ── 删除 ──
  await evaluate(`$btn('Delete', ${rowOf("Aria")}).click();`);
  await waitFor(dialog);
  check("删除确认里劝改用 Deactivate", (await evaluate(`return ${dialog}.textContent;`)).includes("click Deactivate instead"));
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  await waitFor(`${dialog}.querySelector('[role=alert]') || ${dialog}.textContent.includes('Dispatch schedule (Oct 3)')`);
  check("在排班里：409 原因留在确认框里", (await evaluate(`return ${dialog}.textContent;`)).includes("Aria is in the Dispatch schedule (Oct 3)"));
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await sleep(100);
  before = (await mockLog()).length;
  await evaluate(`$btn('Delete', ${rowOf("ZZ Test Qzx Lodge 2")}).click();`);
  await waitFor(dialog);
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  await waitRows(3);
  check("删除成功：DELETE、列表少一行", (await since(before, (e) => e.method === "DELETE" && e.path === "/api/pickup-locations/50")).length === 1 && !(await evaluate("return $rows().some(r => r[0].startsWith('ZZ Test Qzx Lodge'));")));

  // ── Action Log ──
  before = (await mockLog()).length;
  await evaluate("$btn('▸').click();");
  await waitFor("document.body.textContent.includes('Annie Z')");
  const logText = await evaluate("return [...document.querySelectorAll('section')].pop().textContent;");
  check("Action Log 展开才拉", (await since(before, (e) => e.path === "/api/pickup-locations/log")).length === 1);
  check("改动：旧值 → 新值", logText.includes("Short (for SMS):Lobby → Tour lobby"), logText.slice(0, 300));
  check("删除：列出全部字段，空的写 (empty)", logText.includes("Details (email & guest page):Gone") && logText.includes("(empty)"));
  check("停用：Active → Inactive；没有显示名用用户名", logText.includes("Active → Inactive") && logText.includes("annie"));
  check("时间按洛杉矶", /Oct 1, 2026, 9:00 AM PDT/.test(logText), logText.slice(0, 200));

  // ── 权限 / 出错 / 未登录 ──
  await ctl({ failList: true });
  await goto(`${APP}/settings/pickup-locations`);
  await waitFor("document.body.textContent.includes('Could not load pickup locations')");
  check("列表拉不到：显示原因和 Retry（旧页面显示 0 locations）", !(await evaluate("return document.body.textContent.includes('0 locations');")));

  // ── Tour bus departure（后端 migrate_v71）──
  await ctl({ failList: false });
  await goto(`${APP}/settings/pickup-locations`);
  // 等真的行出来（Loading… 那一行也是 tbody tr）。
  await waitFor("[...document.querySelectorAll('tbody tr')].some(tr => tr.textContent.includes('Resorts World'))");
  const depBox = (name) => `[...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('${name}')).querySelector('label[title*="Morning Relay"] input')`;
  check("每行有 Tour bus departure 勾选，照库里的值", await evaluate(`return ${depBox("Resorts World")}.checked === false;`));
  let b1 = (await mockLog()).length;
  await evaluate(`${depBox("Resorts World")}.click();`);
  await sleep(600);
  const dep = (await mockLog()).slice(b1).find((e) => e.path === "/api/pickup-locations/2/tour-departure");
  check("勾上：PATCH tour_departure=true，重拉后还勾着", dep?.body.tour_departure === true && (await evaluate(`return ${depBox("Resorts World")}.checked;`)));
  await ctl({ depFail: true });
  await evaluate(`${depBox("Resorts World")}.click();`);
  await sleep(600);
  check("存不了：写原因、勾还原", await evaluate(`return document.body.textContent.includes('Could not change Tour bus departure for Resorts World: Admin access required') && ${depBox("Resorts World")}.checked === true;`));
  await ctl({ depFail: false });
  check("How to use 说明 Tour bus departure", await evaluate("return document.body.textContent.includes('Guests picked up there are left out when you click Pull from manifests in Dispatch.');"));
  await ctl({ failList: false, staff: true });
  await goto(`${APP}/settings/pickup-locations`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff 看到 Admin access required", true);
  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/pickup-locations`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
