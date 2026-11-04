// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Supplier › Restaurant（/supplier/restaurant，G199）：
// 卡片（店名、Lunch for、两行页脚 + 亮黄印出来的样子、员工备注）、+ Add a restaurant、改 / 挪团 / 删、400 原话、404 不报错、侧栏 Soon。
// 前提：mock（restaurant-mock.js）在 MOCK_PORT，next dev 在 APP_URL（run-all.js 起好）。只用 ZZ Test 的假数据。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = `http://localhost:${process.env.MOCK_PORT || 8799}`;
const PORT = Number(process.env.CDP_PORT || process.env.CHROME_PORT) || 9411;
const URL = `${APP}/supplier/restaurant`;
const BLUE = "rgb(59, 130, 246)";

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
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function waitFor(expr, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      // 写成语句（带 return）的原样跑，表达式套 return !!(…)。
      if (await evaluate(/\breturn\b/.test(expr) ? expr : `return !!(${expr});`)) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}
const HELPERS = `
window.$txt = () => document.querySelector('main').textContent;
window.$card = (name) => document.querySelector('section[data-restaurant="' + name + '"]');
window.$btn = (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
window.$set = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$field = (card, label) => { const l = [...card.querySelectorAll('label')].find(x => x.textContent.trim() === label); return l && document.getElementById(l.htmlFor); };
window.$tour = (card, name) => card.querySelector('label[data-tour="' + name + '"] input');
window.$bg = (el) => getComputedStyle(el).backgroundColor;
window.$dialog = () => document.querySelector('[role=dialog]');
`;
async function open(ready) {
  await cdp("Page.navigate", { url: URL });
  await sleep(300);
  const ok = await waitFor(ready, 90000);
  await evaluate(HELPERS);
  return ok;
}
const calls = async (method, re) => (await mockLog()).filter((l) => l.method === method && re.test(l.path));
const lastCall = async (method, re) => (await calls(method, re)).pop();
async function waitCall(method, re, n, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await calls(method, re)).length >= n) return true;
    await sleep(100);
  }
  return false;
}

async function run() {
  // ── G203 第二批：页面最底的 Action Log（共用读接口 /api/supplier/restaurants/action-log）──
  await cdp("Page.navigate", { url: URL });
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'))", 60000);
  {
    const alBefore = (await mockLog()).length;
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
    await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length === 2", 20000);
    const alReqs = (await mockLog()).slice(alBefore).filter((e) => e.path === "/api/supplier/restaurants/action-log");
    check("G203 Action Log：页面最底，展开才请求 /api/supplier/restaurants/action-log、显示 2 行", alReqs.length === 1 && (await evaluate("return document.querySelectorAll('[data-action-log] tbody tr').length;")) === 2, JSON.stringify(alReqs));
  }
  await ctl({ reset: true, fail401: false, staff: false, superadmin: false, unavailable: false, fail500: false });
  check("Restaurant 页打开：一张卡 ZZ Test Bee's、计数 1 restaurant", await open("document.querySelector('section[data-restaurant]')") && (await evaluate("return !!$card(\"ZZ Test Bee's\") && $txt().includes('1 restaurant');")));
  check("说明一行：Lunch vendors and how to order…", await evaluate("return $txt().includes(\"Lunch vendors and how to order. The footer text prints at the bottom of each bus's lunch sheet.\");"));
  check("卡片抬头：店名 + Lunch for: Antelope", await evaluate("const c = $card(\"ZZ Test Bee's\"); return c.querySelector('h3').textContent === \"ZZ Test Bee's\" && c.querySelector('[data-lunch-for]').textContent === 'Lunch for: Antelope';"));
  check("四个字段照 preview：Vendor name / Lunch for (tours) / Contact / how to order / Notes for staff", await evaluate("const t = $card(\"ZZ Test Bee's\").textContent; return ['Vendor name','Lunch for (tours)','Contact / how to order','Notes for staff','Not printed.','Two lines at most.'].every(s => t.includes(s));"));
  check("Vendor name 下面写午餐表抬头：NPE Lunch Box - 店名", await evaluate("return $card(\"ZZ Test Bee's\").textContent.includes(\"Lunch sheet title: NPE Lunch Box - ZZ Test Bee's\");"));
  check("页脚亮黄（#ffff00）、粗体、居中、两行照印", await evaluate("const p = $card(\"ZZ Test Bee's\").querySelector('[data-footer-preview]'); const s = getComputedStyle(p); return $bg(p) === 'rgb(255, 255, 0)' && Number(s.fontWeight) >= 700 && s.textAlign === 'center' && s.whiteSpace === 'pre-line' && p.textContent.split('\\n').length === 2;"));
  check("团的勾选：Antelope 勾着；停用的 Grand Canyon West 不列", await evaluate("const c = $card(\"ZZ Test Bee's\"); return $tour(c, 'Antelope').checked && !$tour(c, 'Bryce Zion').checked && !$tour(c, 'Grand Canyon West');"));
  check("Saved by 谁 · 时间（洛杉矶）", await evaluate("return $card(\"ZZ Test Bee's\").querySelector('[data-updated]').textContent === 'Saved by Annie · Oct 27, 4:12 PM';"), await evaluate("return $card(\"ZZ Test Bee's\").querySelector('[data-updated]')?.textContent;"));
  check("没改动：Save / Cancel 灰着；蓝色只有 Save；+ Add a restaurant 不是蓝色", await evaluate("const c = $card(\"ZZ Test Bee's\"); const blues = [...document.querySelectorAll('main button')].filter(b => $bg(b) === '" + BLUE + "').map(b => b.textContent); return $btn('Save', c).disabled && $btn('Cancel', c).disabled && JSON.stringify(blues) === '[\"Save\"]' && $bg(document.querySelector('[data-add-restaurant]')) !== '" + BLUE + "';"));

  // 改页脚：第三行并回第二行；预览跟着变
  await evaluate("$set($field($card(\"ZZ Test Bee's\"), 'Contact / how to order'), 'ZZ line one\\nZZ line two\\nZZ line three'); return 1;");
  check("页脚打第三行：并回第二行（最多两行）、预览跟着变", await waitFor("$field($card(\"ZZ Test Bee's\"), 'Contact / how to order').value === 'ZZ line one\\nZZ line two ZZ line three' && $card(\"ZZ Test Bee's\").querySelector('[data-footer-preview]').textContent === 'ZZ line one\\nZZ line two ZZ line three'"));
  check("改了：Save / Cancel 能点", await evaluate("const c = $card(\"ZZ Test Bee's\"); return !$btn('Save', c).disabled && !$btn('Cancel', c).disabled;"));
  await evaluate("$btn('Cancel', $card(\"ZZ Test Bee's\")).click(); return 1;");
  check("Cancel：改回存好的、没发请求", (await waitFor("$field($card(\"ZZ Test Bee's\"), 'Contact / how to order').value.startsWith('(TEXT) POC')")) && (await calls("PUT", /restaurants\/1$/)).length === 0);

  // 加团 + 改备注 → Save
  await evaluate("const c = $card(\"ZZ Test Bee's\"); $tour(c, 'South Rim').click(); $set($field(c, 'Notes for staff'), 'ZZ note'); return 1;");
  await sleep(200);
  await evaluate("$btn('Save', $card(\"ZZ Test Bee's\")).click(); return 1;");
  check("Save：PUT 带 name / footer / staff_note / manifest_ids（整组）", await waitCall("PUT", /restaurants\/1$/, 1));
  const put1 = (await lastCall("PUT", /restaurants\/1$/))?.body;
  check("PUT 内容：manifest_ids [3,5]、staff_note、页脚原样", put1 && JSON.stringify(put1.manifest_ids) === "[3,5]" && put1.staff_note === "ZZ note" && put1.footer.startsWith("(TEXT) POC") && put1.name === "ZZ Test Bee's", JSON.stringify(put1));
  check("存好：✓ Saved、重读后 Lunch for: Antelope, South Rim、按键又灰了", await waitFor("const c = $card(\"ZZ Test Bee's\"); return c && c.textContent.includes('✓ Saved') && c.querySelector('[data-lunch-for]').textContent === 'Lunch for: Antelope, South Rim' && $btn('Save', c).disabled"), await evaluate("const c = $card(\"ZZ Test Bee's\"); return JSON.stringify({saved: c.textContent.includes('✓ Saved'), lf: c.querySelector('[data-lunch-for]').textContent, dis: $btn('Save', c).disabled, foot: $field(c, 'Contact / how to order').value, note: $field(c, 'Notes for staff').value});"));

  // ── 四栏联系方式（导游页 v9 ④，Annie 10-29 动手；后端 20 3bcf395）──
  {
    const C = `$card("ZZ Test Bee's")`;
    const labels = await evaluate(`return [...${C}.querySelectorAll('label')].filter(l => l.htmlFor).map(l => l.textContent.trim());`);
    check("四栏放在 Lunch for 和页脚之间：Vendor name / Address / Phone / Text / Email / Contact / how to order / Notes for staff", JSON.stringify(labels) === JSON.stringify(["Vendor name", "Address", "Phone", "Text", "Email", "Contact / how to order", "Notes for staff"]), JSON.stringify(labels));
    check(
      "带出存好的：Address 原样，Phone 显示成好读的 (928) 555-0110，Text / Email 空着；下面写用在哪",
      await evaluate(`const c = ${C}; return $field(c, 'Address').value === '1201 ZZ Test Ave, Tusayan, AZ 86023' && $field(c, 'Phone').value === '(928) 555-0110' && $field(c, 'Text').value === '' && $field(c, 'Email').value === '' && c.textContent.includes("The guide's Call button rings this number.") && c.textContent.includes("Mobile number for lunch updates by text.");`),
    );
    const putsBefore = (await calls("PUT", /restaurants\/1$/)).length;
    await evaluate(`const c = ${C}; $set($field(c, 'Phone'), '555-01'); $set($field(c, 'Email'), 'orders@'); return 1;`);
    await sleep(150);
    await evaluate(`$btn('Save', ${C}).click(); return 1;`);
    await sleep(300);
    check(
      "格式不对：Phone / Email 下面红字、框标红，上面红字 Not saved: …，没发请求",
      (await calls("PUT", /restaurants\/1$/)).length === putsBefore &&
        (await evaluate(`const c = ${C}; const pe = c.querySelector('[data-contact-error=phone]'); const ee = c.querySelector('[data-contact-error=email]'); return !!pe && pe.textContent.startsWith('Phone must be a phone number') && getComputedStyle(pe).color === 'rgb(163, 45, 45)' && !!ee && ee.textContent.startsWith("Email doesn't look like an email address") && !c.querySelector('[data-contact-error=text_number]') && c.textContent.includes('Not saved: Phone must be a phone number');`)),
      await evaluate(`return ${C}.textContent;`),
    );
    await evaluate(`const c = ${C}; $set($field(c, 'Phone'), '(928) 555-0110'); $set($field(c, 'Text'), '928.555.0123'); $set($field(c, 'Email'), 'zz-orders@example.com'); return 1;`);
    await sleep(150);
    await evaluate(`$btn('Save', ${C}).click(); return 1;`);
    check("改对了按 Save：发 PUT", await waitCall("PUT", /restaurants\/1$/, putsBefore + 1));
    const putC = (await lastCall("PUT", /restaurants\/1$/))?.body;
    check("PUT 带四栏（照打的送，后端存 E.164）", putC && putC.address === "1201 ZZ Test Ave, Tusayan, AZ 86023" && putC.phone === "(928) 555-0110" && putC.text_number === "928.555.0123" && putC.email === "zz-orders@example.com", JSON.stringify(putC));
    check(
      "存好：绿字 ✓ Saved，重读后 Text 显示成 (928) 555-0123、Email 照存",
      await waitFor(`return (() => { const c = ${C}; return !!c && c.textContent.includes('✓ Saved') && $field(c, 'Text').value === '(928) 555-0123' && $field(c, 'Email').value === 'zz-orders@example.com' && $btn('Save', c).disabled; })()`),
    );
    // 清空：带 "" = 清掉
    await evaluate(`const c = ${C}; $set($field(c, 'Address'), ''); $set($field(c, 'Email'), ''); return 1;`);
    await sleep(150);
    await evaluate(`$btn('Save', ${C}).click(); return 1;`);
    await waitCall("PUT", /restaurants\/1$/, putsBefore + 2);
    const putClear = (await lastCall("PUT", /restaurants\/1$/))?.body;
    check("清空 Address / Email：PUT 带 \"\"（= 清掉），其余照送", putClear && putClear.address === "" && putClear.email === "" && putClear.text_number === "(928) 555-0123", JSON.stringify(putClear));
    check("清空存好：重读后两栏空着、Phone / Text 还在", await waitFor(`return (() => { const c = ${C}; return !!c && $field(c, 'Address').value === '' && $field(c, 'Email').value === '' && $field(c, 'Phone').value === '(928) 555-0110' && $btn('Save', c).disabled; })()`));
  }

  // 400 原话：名字清空 → 前端先拦；名字太长 → 后端原话
  await evaluate("$set($field($card(\"ZZ Test Bee's\"), 'Vendor name'), '   '); return 1;");
  await sleep(150);
  await evaluate("$btn('Save', $card(\"ZZ Test Bee's\")).click(); return 1;");
  check("名字空着：写 Enter the restaurant name.、没发请求", (await waitFor("$card(\"ZZ Test Bee's\").textContent.includes('Enter the restaurant name.')")) && (await calls("PUT", /restaurants\/1$/)).length === 3);
  await evaluate("$btn('Cancel', $card(\"ZZ Test Bee's\")).click(); return 1;");
  await ctl({ fail500: true });
  await evaluate("$set($field($card(\"ZZ Test Bee's\"), 'Notes for staff'), 'ZZ note 2'); return 1;");
  await sleep(150);
  await evaluate("$btn('Save', $card(\"ZZ Test Bee's\")).click(); return 1;");
  check("500：红字写后端原话，输入的不丢", await waitFor("const c = $card(\"ZZ Test Bee's\"); return c.querySelector('[role=alert]')?.textContent.includes('Could not save. Nothing was changed - try again.') && $field(c, 'Notes for staff').value === 'ZZ note 2'"), await evaluate("const c = $card(\"ZZ Test Bee's\"); return JSON.stringify({alert: c.querySelector('[role=alert]')?.textContent, note: $field(c, 'Notes for staff').value});"));
  await ctl({ fail500: false });
  await evaluate("$btn('Cancel', $card(\"ZZ Test Bee's\")).click(); return 1;");

  // + Add a restaurant：新卡片在最上面，把 Antelope 挪过来
  await evaluate("document.querySelector('[data-add-restaurant]').click(); return 1;");
  check("+ Add a restaurant：最上面出一张新卡（New restaurant），键灰掉", await waitFor("const n = document.querySelector('section[data-restaurant=new]'); return n && n.querySelector('h3').textContent === 'New restaurant' && document.querySelector('section[data-restaurant]') === n && document.querySelector('[data-add-restaurant]').disabled"), await evaluate("return document.querySelector('main').innerText.slice(0, 300);"));
  check("新卡：别家的团写 (now 店名)", await evaluate("const n = document.querySelector('section[data-restaurant=new]'); return n.querySelector('label[data-tour=Antelope]').textContent.includes(\"(now ZZ Test Bee's)\");"));
  check("新卡页脚空：写 Nothing prints under the lunch sheet.", await evaluate("return document.querySelector('section[data-restaurant=new]').textContent.includes('Nothing prints under the lunch sheet.');"));
  await evaluate("const n = document.querySelector('section[data-restaurant=new]'); $set($field(n, 'Vendor name'), 'zz test bee\\'s'); $set($field(n, 'Contact / how to order'), 'ZZ BZ POC 555-0199'); return 1;");
  await sleep(150);
  await evaluate("$btn('Save', document.querySelector('section[data-restaurant=new]')).click(); return 1;");
  check("重名（不分大小写）：红字写后端原话、卡片留着", await waitFor("document.querySelector('section[data-restaurant=new]')?.textContent.includes(\"There is already a restaurant called zz test bee's.\")"));
  await evaluate("const n = document.querySelector('section[data-restaurant=new]'); $set($field(n, 'Vendor name'), 'ZZ Test BZ Deli'); $tour(n, 'Bryce Zion').click(); $tour(n, 'Antelope').click(); return 1;");
  await sleep(150);
  await evaluate("$btn('Save', document.querySelector('section[data-restaurant=new]')).click(); return 1;");
  check("新建：POST 带 name / footer / manifest_ids", await waitCall("POST", /restaurants$/, 2));
  const post = (await lastCall("POST", /restaurants$/))?.body;
  check("POST 内容：ZZ Test BZ Deli、[3,4]、页脚一行", post && post.name === "ZZ Test BZ Deli" && JSON.stringify(post.manifest_ids) === "[3,4]" && post.footer === "ZZ BZ POC 555-0199", JSON.stringify(post));
  check("建好：新卡片按名字排、✓ Added + 写 Antelope 从哪家挪过来；Bee's 只剩 South Rim；计数 2", await waitFor("const c = $card('ZZ Test BZ Deli'); const b = $card(\"ZZ Test Bee's\"); return c && !document.querySelector('section[data-restaurant=new]') && c.textContent.includes(\"✓ Added Antelope moved here from ZZ Test Bee's.\") && c.querySelector('[data-lunch-for]').textContent === 'Lunch for: Antelope, Bryce Zion' && b.querySelector('[data-lunch-for]').textContent === 'Lunch for: South Rim' && $txt().includes('2 restaurants') && !document.querySelector('[data-add-restaurant]').disabled"), await evaluate("return document.querySelector('main').innerText.slice(0, 900);"));

  // 新卡片 Cancel = 收掉
  await evaluate("document.querySelector('[data-add-restaurant]').click(); return 1;");
  await waitFor("document.querySelector('section[data-restaurant=new]')");
  await evaluate("$btn('Cancel', document.querySelector('section[data-restaurant=new]')).click(); return 1;");
  check("新卡片 Cancel：收掉、没发请求", (await waitFor("!document.querySelector('section[data-restaurant=new]')")) && (await calls("POST", /restaurants$/)).length === 2);

  // 删：还有团 → 弹窗先说，后端 400 原话留在弹窗里
  await evaluate("$btn('Delete', $card(\"ZZ Test Bee's\")).click(); return 1;");
  check("Delete 弹窗：还有团时写是哪几个团、先取消勾", await waitFor("$dialog() && $dialog().textContent.includes(\"Delete \\\"ZZ Test Bee's\\\"?\") && $dialog().textContent.includes('It is still the lunch vendor for South Rim. Untick those tours and Save first.')"));
  await evaluate("$btn('Delete', $dialog()).click(); return 1;");
  check("还有团硬删：弹窗里红字写后端原话", await waitFor("$dialog()?.querySelector('[role=alert]')?.textContent === \"ZZ Test Bee's is still the lunch restaurant for South Rim. Remove those tours from it first.\""));
  await evaluate("$btn('Cancel', $dialog()).click(); return 1;");
  await waitFor("!$dialog()");
  // 取消 South Rim → Save → 再删
  await evaluate("$tour($card(\"ZZ Test Bee's\"), 'South Rim').click(); return 1;");
  await sleep(150);
  await evaluate("$btn('Save', $card(\"ZZ Test Bee's\")).click(); return 1;");
  check("取消最后一个团：Lunch for: no tours", await waitFor("$card(\"ZZ Test Bee's\")?.querySelector('[data-lunch-for]').textContent === 'Lunch for: no tours'"));
  const put2 = (await lastCall("PUT", /restaurants\/1$/))?.body;
  check("PUT manifest_ids []（整组替换成空）", put2 && Array.isArray(put2.manifest_ids) && put2.manifest_ids.length === 0, JSON.stringify(put2));
  await evaluate("$btn('Delete', $card(\"ZZ Test Bee's\")).click(); return 1;");
  await waitFor("$dialog()");
  check("没有团时弹窗写 No tour uses it.", await evaluate("return $dialog().textContent.includes('No tour uses it.');"));
  await evaluate("$btn('Delete', $dialog()).click(); return 1;");
  check("删好：DELETE /restaurants/1、卡片没了、计数 1", (await waitCall("DELETE", /restaurants\/1$/, 2)) && (await waitFor("!$dialog() && !$card(\"ZZ Test Bee's\") && $txt().includes('1 restaurant')")));

  // ── ⬆ Import（全站「上传表格自动填」preview ③-4，Annie 2026-10-29「批量导游同意推荐。动手」；需要后端 B6）──
  await ctl({ reset: true });
  await open("document.querySelector('section[data-restaurant]')");
  await evaluate(`
    window.__blob = null; window.__download = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
    return 1;
  `);
  check("Import：+ Add a restaurant 左边有 ⬆ Import，样子同 Add（不是蓝的），收着时没有 Import 块", await evaluate("const b = document.querySelector('[data-import-restaurants]'); const a = document.querySelector('[data-add-restaurant]'); return !!b && b.textContent.trim() === '⬆ Import' && b.nextElementSibling === a && $bg(b) !== '" + BLUE + "' && b.className === a.className && !document.querySelector('[data-bulk-import]');"));
  await evaluate("document.querySelector('[data-import-restaurants]').click(); return 1;");
  check("点开：卡片列表上方展开 Import restaurants 块、键灰掉；说明写按 Name 对上、空格不清、页脚不导入", await waitFor("const s = document.querySelector('[data-bulk-import]'); return s && s.getAttribute('aria-label') === 'Import restaurants' && document.querySelector('[data-import-restaurants]').disabled && (s.compareDocumentPosition(document.querySelector('section[data-restaurant]')) & Node.DOCUMENT_POSITION_FOLLOWING) && s.textContent.includes('Name finds the restaurant') && s.textContent.includes('A blank cell never clears what is stored') && s.textContent.includes('The lunch sheet footer is not imported.')"));
  await evaluate("$btn('⬇ Download template').click(); return 1;");
  await waitFor("window.__download");
  {
    const tpl = await evaluate("return (await window.__blob.text()).replace(/^\\uFEFF/, '');");
    const lines = tpl.split("\r\n").filter(Boolean);
    check(
      "模板：Name / Address / Phone / Text / Email / Notes for staff，带上现有的店（电话写 (928) 555-0110，不带页脚），文件名 restaurants_template_<日期>.csv",
      lines[0] === "Name,Address,Phone,Text,Email,Notes for staff" && lines.length === 2 && lines[1] === "ZZ Test Bee's,\"1201 ZZ Test Ave, Tusayan, AZ 86023\",(928) 555-0110,,," && /^restaurants_template_\d{4}-\d{2}-\d{2}\.csv$/.test(await evaluate("return window.__download;")),
      JSON.stringify({ lines, file: await evaluate("return window.__download;") }),
    );
  }
  const setFile = async (selector, file) => {
    const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
    await cdp("DOM.setFileInputFiles", { nodeId, files: [`${__dirname.replace(/\\/g, "/")}/${file}`] });
  };
  const impCalls = async () => (await mockLog()).filter((e) => e.path.startsWith("/api/supplier/restaurants/import/"));
  await setFile("[data-bulk-import] input[type=file]", "restaurant-import.csv");
  await waitFor("document.querySelector('[data-bulk-counts]')");
  let ireqs = await impCalls();
  check("预览：上传文件、只调 /api/supplier/restaurants/import/preview（不写）", ireqs.length === 1 && ireqs[0].path === "/api/supplier/restaurants/import/preview" && ireqs[0].method === "POST" && ireqs[0].hasFile, JSON.stringify(ireqs));
  check(
    "预览：New 1 / Will update 1 / No change 0 / Errors 3，栏名用页面上的",
    await evaluate("const t = document.querySelector('[data-bulk-counts]').textContent; const h = [...document.querySelectorAll('[data-bulk-import] thead th')].map(th => th.textContent); return t.includes('New: 1') && t.includes('Will update: 1') && t.includes('No change: 0') && t.includes('Errors: 3') && JSON.stringify(h) === JSON.stringify(['Import','Name','Address','Phone','Text','Email','Notes for staff']);"),
    await evaluate("return JSON.stringify({c: document.querySelector('[data-bulk-counts]').textContent, h: [...document.querySelectorAll('[data-bulk-import] thead th')].map(th => th.textContent)});"),
  );
  check("预览：改了的格子写 旧 → 新（— → zz.bees@example.com）、空格写 blank in file — left as is", await evaluate("const ch = [...document.querySelectorAll('[data-bulk-changed]')].map(e => e.textContent); return ch.includes('— → zz.bees@example.com') && document.querySelector('[data-bulk-import] tr[data-status=update]').textContent.includes('blank in file — left as is');"), await evaluate("return JSON.stringify([...document.querySelectorAll('[data-bulk-changed]')].map(e => e.textContent));"));
  check("预览：有错的红字写原因（电话格式、店名空、文件里重复）", await evaluate("const es = [...document.querySelectorAll('[data-bulk-error]')].map(e => e.textContent); return es.includes(\"Phone doesn't look like a phone number. Use digits, e.g. (928) 555-0110.\") && es.includes('Enter the restaurant name.') && es.includes('Repeated above — skipped.');"));
  check("Save 键：蓝色 Save 2 rows（有错的 3 行不存）", await evaluate("const b = $btn('Save 2 rows'); return !!b && $bg(b) === '" + BLUE + "';"));
  await ctl({ importFail: true });
  await evaluate("$btn('Save 2 rows').click(); return 1;");
  await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent.includes('Not saved')");
  check("存不上（500）：红字 Not saved — nothing was changed.，预览留着", await evaluate("const a = document.querySelector('[data-bulk-import] [role=alert]'); return a.textContent.startsWith('Not saved — nothing was changed.') && getComputedStyle(a).color === 'rgb(179, 38, 30)' && !!$btn('Save 2 rows');"), await evaluate("return document.querySelector('[data-bulk-import] [role=alert]')?.textContent;"));
  await ctl({ importFail: false, importConflict: true });
  await evaluate("$btn('Save 2 rows').click(); return 1;");
  await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent.includes('Someone changed')");
  check("存的时候撞上别人改（409）：红字照后端原话，预览留着", await evaluate("const a = document.querySelector('[data-bulk-import] [role=alert]'); return a.textContent === 'Not saved — Someone changed the restaurant list while this file was being saved. Nothing was saved — check the preview again.' && !!$btn('Save 2 rows');"), await evaluate("return document.querySelector('[data-bulk-import] [role=alert]')?.textContent;"));
  await ctl({ importConflict: false });
  await evaluate("$btn('Save 2 rows').click(); return 1;");
  await waitFor("document.querySelector('[data-bulk-import] [role=status]')?.textContent.includes('Saved')");
  ireqs = (await impCalls()).filter((e) => e.path.endsWith("/commit"));
  check(
    "Save：commit 传同一个文件；绿字 Saved — 1 new, 1 updated. 3 rows with errors were not saved.；预览表收起",
    ireqs.length === 3 && ireqs.every((e) => e.hasFile) && (await evaluate("const s = document.querySelector('[data-bulk-import] [role=status]'); return s.textContent.includes('Saved — 1 new, 1 updated. 3 rows with errors were not saved.') && getComputedStyle(s).color === 'rgb(30, 107, 67)' && !document.querySelector('[data-bulk-import] table');")),
    await evaluate("return document.querySelector('[data-bulk-import] [role=status]')?.textContent;"),
  );
  check("存好：页面重读——新店 ZZ Test Grill 出卡片（没分团）、Bee's 的 Email 是新的、计数 2", await waitFor("const g = $card('ZZ Test Grill'); const b = $card(\"ZZ Test Bee's\"); return g && b && g.querySelector('[data-lunch-for]').textContent === 'Lunch for: no tours' && $field(g, 'Phone').value === '(435) 555-0101' && $field(b, 'Email').value === 'zz.bees@example.com' && $txt().includes('2 restaurants')"), await evaluate("const g = $card('ZZ Test Grill'); const b = $card(\"ZZ Test Bee's\"); return JSON.stringify({g: !!g, lf: g?.querySelector('[data-lunch-for]')?.textContent, ph: g && $field(g, 'Phone')?.value, em: b && $field(b, 'Email')?.value, two: $txt().includes('2 restaurants')});"));
  await evaluate("$btn('Close', document.querySelector('[data-bulk-import]')).click(); return 1;");
  check("Close：Import 块收起，⬆ Import 又能点", await waitFor("!document.querySelector('[data-bulk-import]') && !document.querySelector('[data-import-restaurants]').disabled"));
  await ctl({ importFileError: "Missing column: Name" });
  await evaluate("document.querySelector('[data-import-restaurants]').click(); return 1;");
  await waitFor("document.querySelector('[data-bulk-import]')");
  await setFile("[data-bulk-import] input[type=file]", "restaurant-import.csv");
  check("文件读不了（400）：红字照后端原话，没有预览表、没有 Save", await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent === 'Missing column: Name' && !document.querySelector('[data-bulk-import] table') && ![...document.querySelectorAll('[data-bulk-import] button')].some(b => b.textContent.startsWith('Save'))"), await evaluate("return document.querySelector('[data-bulk-import]')?.textContent;"));
  await ctl({ importFileError: "" });

  // 后端还没上线（404）：不报错
  await ctl({ unavailable: true });
  check("后端 404：写 Restaurant isn't available yet，没有红字 / Retry", (await open("$txt().includes(\"Restaurant isn't available yet\")")) && (await evaluate("return !document.querySelector('main [role=alert]') && !$btn('Retry');")), await evaluate("return document.querySelector('main')?.innerText.slice(0, 300);"));
  await ctl({ unavailable: false });

  // staff：Admin access required
  await ctl({ reset: true, staff: true });
  check("staff：Admin access required，不读接口", (await open("$txt().includes('Admin access required')")) && (await calls("GET", /\/api\/supplier\/restaurants$/)).length === 0, await evaluate("return document.querySelector('main')?.innerText.slice(0, 300);"));
  await ctl({ staff: false });

  // 侧栏：Super Admin 看得到 Restaurant（Coming soon、不能点），admin 看不到
  await ctl({ reset: true, superadmin: true });
  await open("document.querySelector('section[data-restaurant]')");
  await evaluate("const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Open menu'); if (b) b.click(); return 1;");
  await sleep(400);
  check("Super Admin 侧栏：Supplier › Restaurant 是链接到 /supplier/restaurant、没有 Coming soon（后端已上 main）", await evaluate("const sup = document.querySelector('section[aria-label=Supplier]'); return !!sup && !sup.textContent.includes('Coming soon') && [...sup.querySelectorAll('a')].some(a => a.getAttribute('href') === '/supplier/restaurant' && a.textContent.trim() === 'Restaurant');"), await evaluate("return document.querySelector('section[aria-label=Supplier]')?.textContent;"));
  await ctl({ superadmin: false });
  await open("document.querySelector('section[data-restaurant]')");
  await evaluate("const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Open menu'); if (b) b.click(); return 1;");
  await sleep(400);
  check("admin 侧栏：没有 Restaurant（仅 Super Admin）", await evaluate("const sup = document.querySelector('section[aria-label=Supplier]'); return !!sup && !sup.textContent.includes('Restaurant');"), await evaluate("return document.querySelector('section[aria-label=Supplier]')?.textContent;"));
}

async function main() {
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, "restaurant-prof-tmp")}`, "--window-size=1600,1000", "about:blank"]);
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
  // 每次打开新页面先装好 $txt / $card 等（等页面好的条件里就要用）。
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
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
