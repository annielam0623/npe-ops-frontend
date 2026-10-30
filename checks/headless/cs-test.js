// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
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
    `--user-data-dir=${path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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
  // 记下页面里的 console.error（检查「不再静默」）。
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "window.__csErrors = []; const e = console.error.bind(console); console.error = (...a) => { window.__csErrors.push(a.map(String).join(' ')); e(...a); };" });

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
// 受控 <select>：直接改 DOM 的 .value 不会触发 React 的 onChange（和原生 input 不一样），要走原型 setter + 派发 change。
window.$setSelect = (el, optionText) => {
  const opt = [...el.options].find(o => o.textContent === optionText);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
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
  // ── G203 第二批：页面最底的 Action Log（共用读接口 /api/template-settings/action-log）──
  await goto(`${APP}/settings/content-studio`);
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'))", 60000);
  {
    const alBefore = (await mockLog()).length;
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
    await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length === 2", 20000);
    const alReqs = (await mockLog()).slice(alBefore).filter((e) => e.path === "/api/template-settings/action-log");
    check("G203 Action Log：页面最底，展开才请求 /api/template-settings/action-log、显示 2 行", alReqs.length === 1 && (await evaluate("return document.querySelectorAll('[data-action-log] tbody tr').length;")) === 2, JSON.stringify(alReqs));
  }
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
  check(
    "Tickets Reminder 卡片：强调色（边框 / 标签）是统一的紫（#6d5bd0），图标是浅灰线条（不是红色表情符号）",
    await evaluate(`const card = [...document.querySelectorAll('button')].find((e) => e.textContent.includes('Tickets Reminder') && e.textContent.includes('Self-Drive')); if (!card) return false; const svg = card.querySelector('svg'); const tag = [...card.querySelectorAll('span')].find((e) => e.textContent === 'Self-Drive'); return card.style.getPropertyValue('--ac') === '#6d5bd0' && getComputedStyle(tag).color === 'rgb(109, 91, 208)' && !!svg && svg.getAttribute('stroke') === '#cbd5e1' && !card.textContent.includes(String.fromCodePoint(0x1F39F));`),
  );

  // ── TC SMS ──
  await evaluate("$open('Tour Confirmation');");
  await sleep(200);
  await evaluate("$tab('SMS');");
  await sleep(200);
  const smsCard = "SMS body — tours WITH lunch";
  check("短信：变量提醒、字数按示例展开、Last edited by", await evaluate(`return $card('${smsCard}').textContent.includes('Do not remove or modify') && /≈ \\d+ \\/ 300 chars \\(with the variables filled in\\)/.test($card('${smsCard}').textContent) && $card('${smsCard}').textContent.includes('Last edited by annie');`));
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
  // 短信模板最多 300 个字符（示例展开后）、只能普通字符（Annie 2026-10-15）。{url} 的示例 49 字。
  const smsCounter = (card) => evaluate(`const p = [...$card(${JSON.stringify(card)}).querySelectorAll('p')].find(p => p.textContent.startsWith('≈ ')); return p ? { text: p.textContent.trim(), red: p.className.includes('c0392b') } : null;`);
  const cardErr = (card) => evaluate(`const t = $card(${JSON.stringify(card)}).textContent; return t.includes('before saving') ? t : '';`);
  const trySave = async (card) => {
    const b = (await mockLog()).length;
    await evaluate(`$btn('Save', $card(${JSON.stringify(card)})).click();`);
    await sleep(300);
    return (await since(b, (e) => e.path.endsWith("/save"))).length;
  };
  await evaluate(`$setValue(${ta}, 'x'.repeat(250) + ' {url}');`);
  await sleep(100);
  let sc = await smsCounter(smsCard);
  check("短信模板：正好 300 字（示例展开后）：≈ 300 / 300 chars (with the variables filled in)、不红", sc && sc.text === "≈ 300 / 300 chars (with the variables filled in)" && !sc.red, JSON.stringify(sc));
  await evaluate(`$setValue(${ta}, 'x'.repeat(251) + ' {url}');`);
  await sleep(100);
  sc = await smsCounter(smsCard);
  check("短信模板：301 字：写 over the 300-character limit、变红", sc && sc.text === "≈ 301 / 300 chars (with the variables filled in) - over the 300-character limit" && sc.red, JSON.stringify(sc));
  let saved = await trySave(smsCard);
  let txt = await evaluate(`return $card('${smsCard}').textContent;`);
  check("超长短信不让存：This SMS template is too long (301 / 300 characters once the variables are filled in). Shorten it before saving.",
    txt.includes("This SMS template is too long (301 / 300 characters once the variables are filled in). Shorten it before saving.") && saved === 0, txt.slice(0, 400));
  await evaluate(`$setValue(${ta}, 'x'.repeat(249) + '€ {url}');`);
  await sleep(100);
  sc = await smsCounter(smsCard);
  check("短信模板：扩展字符 € 算 2 个（249 + € + {url} = 301）、变红", sc && sc.text === "≈ 301 / 300 chars (with the variables filled in) - over the 300-character limit" && sc.red, JSON.stringify(sc));
  await evaluate(`$setValue(${ta}, 'Hola {name}, café señor über Ç {url}');`);
  await sleep(100);
  sc = await smsCounter(smsCard);
  check("短信模板：é ñ ü Ç 不算特殊字符、不红", sc && /^≈ \d+ \/ 300 chars \(with the variables filled in\)$/.test(sc.text) && !sc.red, JSON.stringify(sc));
  for (const ch of ["“", "–", "😀", "中", "á", "ç"]) {
    await evaluate(`$setValue(${ta}, ${JSON.stringify(`Hi {name} ${ch} {url}`)});`);
    await sleep(100);
    sc = await smsCounter(smsCard);
    check(`短信模板特殊字符 ${ch}：计数点名、变红`, sc && sc.text.endsWith(` - SMS can't use these characters: ${ch}`) && sc.red, JSON.stringify(sc));
  }
  await evaluate(`$setValue(${ta}, 'Hi {name} “ok” – {url}');`);
  await sleep(100);
  saved = await trySave(smsCard);
  txt = await evaluate(`return $card('${smsCard}').textContent;`);
  check("特殊字符的短信模板不让存：This SMS template has characters SMS can't use: “ ” –. Remove them before saving.",
    txt.includes("This SMS template has characters SMS can't use: “ ” –. Remove them before saving.") && saved === 0, txt.slice(0, 400));
  await evaluate(`$btn('Cancel', $card('${smsCard}')).click();`);
  await waitFor(dialog);
  await evaluate(`$btn('Discard', ${dialog}).click();`);
  await sleep(200);
  check("Cancel：确认后回到上次保存的", (await evaluate(`return ${ta}.value;`)).includes("{url}") && !(await evaluate(`return ${ta}.value;`)).includes("xxxx"));

  // ── Global + 接客顺序 + 保存失败 ──（同旧页面：Global 是第一个标签页，里面一条可展开的红条）
  await evaluate("$tab('Global');");
  await sleep(100);
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
  await evaluate("[...document.querySelectorAll('main button')].find(b => b.textContent.startsWith('← All modules')).click();");
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
  check("Guest Page 有 Check-in minutes before tour time（不是客人文案，写明 50 的例子）", await evaluate("const c = $card('Check-in minutes before tour time'); return !!c && c.textContent.includes('Not shown to guests') && c.textContent.includes('50 means a 9:40 AM tour checks in at 8:50 AM');"));
  check("How to use 说明 Check-in minutes 不是客人文案", await evaluate("return document.body.textContent.includes('Check-in minutes before tour time (Tickets, Guest Page tab) is not guest text.');"));
  check("门票团接口 403（开关没放给我）：照旧 15 个团，没有 + New tour / ✎ Edit tour", await evaluate("const b = [...document.querySelectorAll('[aria-label=Tour] button')]; return b.length === 15 && b[0].textContent === 'U-Antelope (Tsosie)' && !$btn('+ New tour') && !$btn('✎ Edit tour');"));
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
  await evaluate("[...document.querySelectorAll('main button')].find(b => b.textContent.startsWith('← All modules')).click();");
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

  // 群发模板：最多 300 字（示例展开后）、只能普通字符；已存的有特殊字符照常显示，只在存的时候拦（Annie 2026-10-15）
  const t3 = "Tour template 3";
  sc = await smsCounter(t3);
  check("已存的模板有特殊字符：照常显示原文、计数点名变红、还没报错", (await evaluate(`return $card('${t3}').querySelector('[aria-label="Template 3 body"]').value;`)) === "Hi {first_name} – “3”" &&
    sc && sc.text.endsWith(" - SMS can't use these characters: – “ ”") && sc.red && !(await cardErr(t3)), JSON.stringify(sc));
  await evaluate(`$setValue($card('${t3}').querySelector('[aria-label="Template 3 name"]'), 'ZZ Test renamed');`);
  saved = await trySave(t3);
  txt = await cardErr(t3);
  check("只改名字也拦：This broadcast template has characters SMS can't use: – “ ”. Remove them before saving.", txt.includes("This broadcast template has characters SMS can't use: – “ ”. Remove them before saving.") && saved === 0, txt);
  const t3body = `$card('${t3}').querySelector('[aria-label="Template 3 body"]')`;
  // {first_name} 示例 Sarah（5）："Hi Sarah " 9 + 291 = 300
  await evaluate(`$setValue(${t3body}, 'Hi {first_name} ' + 'x'.repeat(291));`);
  await sleep(100);
  sc = await smsCounter(t3);
  check("群发模板：300 字不红", sc && sc.text === "≈ 300 / 300 chars (with the variables filled in)" && !sc.red, JSON.stringify(sc));
  await evaluate(`$setValue(${t3body}, 'Hi {first_name} ' + 'x'.repeat(292));`);
  await sleep(100);
  sc = await smsCounter(t3);
  check("群发模板：301 字 over the 300-character limit、变红", sc && sc.text === "≈ 301 / 300 chars (with the variables filled in) - over the 300-character limit" && sc.red, JSON.stringify(sc));
  saved = await trySave(t3);
  txt = await cardErr(t3);
  check("群发模板超长不让存：This broadcast template is too long (301 / 300 characters once the variables are filled in). Shorten it before saving.", txt.includes("This broadcast template is too long (301 / 300 characters once the variables are filled in). Shorten it before saving.") && saved === 0, txt);
  await evaluate(`$setValue(${t3body}, 'Hi {first_name}, café señor - "3"');`);
  await sleep(100);
  sc = await smsCounter(t3);
  saved = await trySave(t3);
  await sleep(300);
  const t3saved = (await mockLog()).filter((e) => e.path === "/api/template-settings/save" && e.body?.key === "tmpl__bcast__tour__t3__body").at(-1)?.body.value;
  check("群发模板改成普通字符：不红、能存", sc && !sc.red && saved >= 1 && t3saved === 'Hi {first_name}, café señor - "3"' && !(await cardErr(t3)), JSON.stringify({ sc, saved, t3saved }));

  // ── Farm out Notice（每家合作公司一份）──
  await goto(`${APP}/settings/content-studio`);
  await waitFor("document.body.textContent.includes('Farm out Notice')");
  await h();
  check("首页第四张卡片 Farm out Notice（⇄、Partners）", await evaluate("const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Farm out Notice')); return !!b && b.textContent.includes('⇄') && b.textContent.includes('Partners') && b.textContent.includes('never names the partner');"));
  await evaluate("$open('Farm out Notice');");
  await waitFor("document.body.textContent.includes('Farm out Notice — Email')");
  const foPills = () => evaluate("return [...document.querySelectorAll('[aria-label=Version] button')].map(b => b.textContent.trim());");
  check("两个标签 Email | SMS", JSON.stringify(await evaluate("return [...document.querySelectorAll('[role=tab]')].map(t => t.textContent);")) === JSON.stringify(["Email", "SMS"]));
  check("药丸：Default + 启用的合作公司（Partner B 标 same as Default、停用的不出现）", JSON.stringify(await foPills()) === JSON.stringify(["Default", "Partner A · own wording", "Partner B · same as Default"]), JSON.stringify(await foPills()));
  check("Email 标签：标题 + 正文两张卡片，键名对", await evaluate("return !!$card('Email subject') && !!$card('Email body') && $card('Email subject').textContent.includes('tmpl__farmout__default__email_subject');"));
  check("11 个变量按钮齐全", await evaluate("return [...$card('Email body').querySelectorAll('button')].filter(b => b.textContent.startsWith('+ ')).length === 11;"));
  await evaluate("$card('Email body').querySelector('textarea').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));");
  await sleep(200);
  check("预览：带 Subject 一行，变量换成样例（West Rim / Bellagio）", await evaluate("const t = document.querySelector('aside').textContent; return t.includes('Subject:') && t.includes('Grand Canyon West Rim on Thursday, October 16') && t.includes('https://goo.gl/maps/SpW2EnpwM55Hvr637') && !t.includes('{tour_name}');"));
  check("Variables 说明表：11 行、含含义和样例", await evaluate("const t = document.querySelector('[data-fo-variables]'); return !!t && t.querySelectorAll('tbody tr').length === 11 && t.textContent.includes('Per-tour notice') && t.textContent.includes('Bellagio South Tour Lobby');"));
  check("预览：该团有 PLEASE NOTE 时写出注意事项", await evaluate("return document.querySelector('aside').textContent.includes('PLEASE NOTE:') && document.querySelector('aside').textContent.includes('backpacks');"));
  await evaluate("document.querySelector('aside input[type=checkbox]').click();");
  await sleep(150);
  check("取消勾选 Tour has a PLEASE NOTE：预览里整行消失", await evaluate("const t = document.querySelector('aside').textContent; return !t.includes('PLEASE NOTE:') && !t.includes('backpacks');"));
  await evaluate("document.querySelector('aside input[type=checkbox]').click();");
  // 点 Partner A：自己的标题
  const pill = (name) => evaluate(`[...document.querySelectorAll('[aria-label=Version] button')].find(b => b.textContent.startsWith(${JSON.stringify(name)})).click();`);
  await pill("Partner A");
  await sleep(200);
  check("Partner A：标题是它自己的，键名 partner_a", await evaluate("return $card('Email subject').querySelector('textarea').value === 'A: your {tour_name} pick-up' && $card('Email subject').textContent.includes('tmpl__farmout__partner_a__email_subject');"));
  before = (await mockLog()).length;
  await evaluate(`$setValue($card('Email subject').querySelector('textarea'), 'A2 {tour_name}'); $btn('Save', $card('Email subject')).click();`);
  let fsaves = await waitSaves(before, 1);
  check("保存 Partner A 标题：只写 partner_a 的键", fsaves.length === 1 && fsaves[0].body.key === "tmpl__farmout__partner_a__email_subject" && fsaves[0].body.value === 'A2 {tour_name}', JSON.stringify(fsaves.map((e) => e.body)));
  // Copy from Default
  await evaluate(`$btn('Copy from Default').click();`);
  await sleep(150);
  check("Copy from Default：标题换回 Default 的文字（还没存）", await evaluate("return $card('Email subject').querySelector('textarea').value === 'Your {tour_name} pick-up on {tour_date}';"));
  // 打错的变量：标红、不让存
  await evaluate(`$setValue($card('Email body').querySelector('textarea'), 'Hi {pickup_spt} at {tour_name}');`);
  await sleep(120);
  const foSavesBefore = (await mockLog()).filter((e) => e.path === "/api/template-settings/save").length;
  await evaluate(`$btn('Save', $card('Email body')).click();`);
  await sleep(300);
  check("未知变量 {pickup_spt}：红色提示、不让存", await evaluate("const c = $card('Email body'); return !!c.querySelector('[data-unknown-vars]') && c.querySelector('[data-unknown-vars]').textContent.includes('{pickup_spt}') && c.textContent.includes('Unknown variable(s): {pickup_spt}');") && (await mockLog()).filter((e) => e.path === "/api/template-settings/save").length === foSavesBefore);
  // Copy from Default 时有没存的改动：先问
  await evaluate(`$btn('Copy from Default').click();`);
  await sleep(150);
  check("有没存的改动：Copy from Default 先确认", await evaluate("return !!document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').textContent.includes('Replace your unsaved changes?');"));
  await evaluate("$btn('Replace', document.querySelector('[role=dialog]')).click();");
  await sleep(200);
  check("确认后：正文换回 Default 的文字", await evaluate("return $card('Email body').querySelector('textarea').value.startsWith('Thank you for choosing') && !$card('Email body').querySelector('[data-unknown-vars]');"));
  // Reset to Default（单张卡片）
  await evaluate(`$setValue($card('Email subject').querySelector('textarea'), 'zzz');`);
  await sleep(100);
  await evaluate(`$btn('Reset to Default', $card('Email subject')).click();`);
  await sleep(120);
  check("Reset to Default：这张卡片换回 Default 的文字", await evaluate("return $card('Email subject').querySelector('textarea').value === 'Your {tour_name} pick-up on {tour_date}' && $btn('Reset to Default', $card('Email subject')).disabled === true;"));
  await evaluate("$tab('SMS');");
  await sleep(200);
  check("SMS 标签：一张 SMS text 卡片，药丸还在", await evaluate("return !!$card('SMS text') && document.querySelectorAll('[aria-label=Version] button').length === 3;"));
  await pill("Default");
  await sleep(200);
  sc = await smsCounter("SMS text");
  check("SMS 字数按示例展开、{please_note} 按空算", sc && /^≈ \d+ \/ 300 chars \(with the variables filled in\)$/.test(sc.text) && !sc.red, JSON.stringify(sc));
  await evaluate("$card('SMS text').querySelector('textarea').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));");
  await sleep(150);
  check("SMS 预览是手机气泡，Dear 开头可见变量已替换", await evaluate("const t = document.querySelector('aside').textContent; return t.includes('National Park Express') && t.includes('Dear Wei,') && !t.includes('{first_name}');"));
  check("SMS 字数条：有进度条、1 条短信不提示拆分", await evaluate("const c = $card('SMS text'); return !!c.querySelector('[data-sms-meter]') && !c.textContent.includes('text segments');"));
  await evaluate(`$setValue($card('SMS text').querySelector('textarea'), 'Dear {first_name}, ' + 'x'.repeat(200));`);
  await sleep(100);
  check("SMS 超过 160 字：提示拆成 2 条短信", await evaluate("return $card('SMS text').textContent.includes('Sends as 2 text segments.');"));
  await evaluate(`$setValue($card('SMS text').querySelector('textarea'), 'Dear {first_name}, ' + 'x'.repeat(300));`);
  await sleep(100);
  sc = await smsCounter("SMS text");
  saved = await trySave("SMS text");
  txt = await cardErr("SMS text");
  check("SMS 超 300 字：红字、不让存", sc && sc.red && saved === 0 && txt.includes("too long"), JSON.stringify({ sc, saved, txt }));
  await evaluate(`$setValue($card('SMS text').querySelector('textarea'), 'Dear {first_name}, café “quoted”');`);
  await sleep(100);
  saved = await trySave("SMS text");
  txt = await cardErr("SMS text");
  check("SMS 有特殊字符：不让存", saved === 0 && txt.includes("characters SMS can't use"), txt);
  await evaluate("$tab('Email');");
  await sleep(150);

  // ── Shuttle（G128：路线 = shuttle group × 方向，没有 Global、没有 Preview）──
  await evaluate("$btn('← All modules').click();");
  await sleep(150);
  check(
    "首页第五张卡片 Shuttle（🚐、天蓝色、NEW 不需要——只看文案和 tag）",
    await evaluate(
      "const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Shuttle')); return !!b && b.textContent.includes('🚐') && b.textContent.includes('SMS / Email / Guest Page') && b.textContent.includes('one shared SMS, email and guest page for all routes');",
    ),
  );
  await evaluate("$open('Shuttle');");
  await waitFor("document.body.textContent.includes('Routes') && document.body.textContent.includes('Templates')");
  await h();
  check("Shuttle 没有子标签页（没有 Global，不分 tab）", (await evaluate("return document.querySelectorAll('[role=tab]').length;")) === 0);
  check(
    "Routes 区块：2 行（Boulder City 的 outbound / inbound），都写着 group · 方向、Active 勾着",
    await evaluate(
      "const t = document.body.textContent; return t.includes('Boulder City Shuttle — Outbound') && t.includes('Boulder City Shuttle — Inbound') && t.includes('Boulder City Shuttle · outbound') && t.includes('Boulder City Shuttle · inbound');",
    ),
  );
  check("Add route 表单：group 下拉里有 2 个 shuttle group", await evaluate("return [...document.querySelectorAll('select[aria-label=\"Shuttle group\"] option')].map(o => o.textContent);").then((v) => JSON.stringify(v) === JSON.stringify(["Boulder City Shuttle", "Page Shuttle"])));
  check(
    "Templates 区块：路线药丸 2 个，outbound 默认选中",
    await evaluate(
      "const pills = [...document.querySelectorAll('[aria-label=Route] button')]; return pills.length === 2 && pills[0].getAttribute('aria-pressed') === 'true' && pills[0].textContent.trim() === 'Boulder City Shuttle — Outbound';",
    ),
  );
  check(
    "outbound：SMS / Email body / Guest page 三张可填卡片（键名对、已存的显示内容，没填的是空）；Email subject 是只读说明（Annie 2026-10-26，晚上改回保留 guest page）",
    await evaluate(
      "const f=(l)=>$card(l); return !!f('SMS body') && f('SMS body').textContent.includes('tmpl__shuttle__boulder_city__outbound__sms_body') && f('SMS body').querySelector('textarea').value.includes('departs soon') && !f('Email subject').querySelector('textarea') && f('Email subject').textContent.includes('Shuttle Confirmation — product name — date [order #]') && f('Email body').querySelector('textarea').value === '' && f('Guest confirmation page text').querySelector('textarea').value === '' && f('Guest confirmation page text').textContent.includes('Shuttle has no send feature today');",
    ),
  );
  // 切到 inbound：字段换成那条路线的键，值都是空
  await evaluate("[...document.querySelectorAll('[aria-label=Route] button')][1].click();");
  await sleep(150);
  check(
    "点 inbound 药丸：字段卡片换成 inbound 的键，值都是空",
    await evaluate(
      "return $card('SMS body').textContent.includes('tmpl__shuttle__boulder_city__inbound__sms_body') && $card('SMS body').querySelector('textarea').value === '';",
    ),
  );
  // 编辑 + 保存 inbound 的 Email body
  before = (await mockLog()).length;
  await evaluate("$setValue($card('Email body').querySelector('textarea'), 'Hi, your inbound shuttle is confirmed.'); $btn('Save', $card('Email body')).click();");
  saves = await waitSaves(before, 1);
  check(
    "保存 inbound Email body：请求带正确的 key/value，卡片显示 Saved ✓",
    saves.length === 1 && saves[0].body.key === "tmpl__shuttle__boulder_city__inbound__email_body" && saves[0].body.value === "Hi, your inbound shuttle is confirmed.",
    JSON.stringify(saves.map((e) => e.body)),
  );
  await waitFor("$card('Email body').textContent.includes('Saved')");
  check("卡片显示 Saved ✓", await evaluate("return $card('Email body').textContent.includes('Saved');"));

  // 改名（自动保存盘点 A7，Annie「4项全部动手」）：离开框不存，改了出蓝色 Save，按 Save / Enter 才存；PATCH 只带 label
  const renameEl = "document.querySelector('input[aria-label=\"Rename Boulder City Shuttle — Inbound\"]')";
  const routeSave = `${renameEl}.parentElement.querySelector('[data-route-save]')`;
  check("没改：名字旁没有 Save", await evaluate(`return !${routeSave};`));
  before = (await mockLog()).length;
  await evaluate(`const el = ${renameEl}; window.$setValue(el, 'Boulder City — Return'); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));`);
  await sleep(300);
  check(
    "改名后离开框：不存（A7），名字旁出蓝色 Save",
    (await since(before, (e) => e.method === "PATCH" && e.path === "/api/settings/shuttle-routes/2")).length === 0 &&
      (await evaluate(`const b = ${routeSave}; return !!b && b.textContent === 'Save' && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';`)),
  );
  await evaluate(`const el = ${renameEl}; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  await sleep(150);
  check("Esc：放回原名、Save 收起", await evaluate(`return ${renameEl}.value === 'Boulder City Shuttle — Inbound' && !${routeSave};`));
  await evaluate(`window.$setValue(${renameEl}, 'Boulder City — Return');`);
  await sleep(100);
  await evaluate(`${routeSave}.click();`);
  let patches = [];
  for (let i = 0; i < 30 && !patches.length; i++) {
    patches = await since(before, (e) => e.method === "PATCH" && e.path === "/api/settings/shuttle-routes/2");
    if (!patches.length) await sleep(100);
  }
  check("按 Save：PATCH 只带 {label}，药丸文字跟着变", patches.length === 1 && JSON.stringify(patches[0].body) === JSON.stringify({ label: "Boulder City — Return" }) && (await evaluate("return document.body.textContent.includes('Boulder City — Return');")), JSON.stringify(patches));
  check("存好：名字旁绿字 Saved", await waitFor("[...document.querySelectorAll('[data-route-saved]')].some(s => s.textContent === 'Saved' && getComputedStyle(s).color === 'rgb(4, 120, 87)')"));
  await evaluate(`const el = document.querySelector('input[aria-label=\"Rename Boulder City — Return\"]'); window.$setValue(el, '   '); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await sleep(200);
  check("名字清空按 Enter：红字 Type a name for this route.、不发请求", (await since(before, (e) => e.method === "PATCH" && e.path === "/api/settings/shuttle-routes/2")).length === 1 && (await evaluate("return document.body.textContent.includes('Type a name for this route.');")));
  await evaluate(`const el = document.querySelector('input[aria-label=\"Rename Boulder City — Return\"]'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  await sleep(150);

  // 停用：Active 取消勾选，行还在、不是删除
  before = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('input[type=checkbox]')].find(cb => cb.closest('div').parentElement.textContent.includes('Boulder City Shuttle · inbound')).click();");
  patches = [];
  for (let i = 0; i < 30 && !patches.length; i++) {
    patches = await since(before, (e) => e.method === "PATCH" && e.path === "/api/settings/shuttle-routes/2");
    if (!patches.length) await sleep(100);
  }
  check(
    "停用：PATCH {is_active:false}，路线还在列表里（没被删掉），药丸标 · Off",
    patches.length === 1 && patches[0].body.is_active === false && (await evaluate("return document.body.textContent.includes('Boulder City — Return') && document.body.textContent.includes('· Off');")),
    JSON.stringify(patches),
  );

  // 加一条新路线：选第二个 shuttle group（Page），方向 Outbound
  before = (await mockLog()).length;
  await evaluate(
    "window.$setSelect(document.querySelector('select[aria-label=\"Shuttle group\"]'), 'Page Shuttle'); window.$setValue(document.querySelector('input[aria-label=\"Route label\"]'), 'Page Shuttle — Outbound'); $btn('Add').click();",
  );
  let posts = [];
  for (let i = 0; i < 30 && !posts.length; i++) {
    posts = await since(before, (e) => e.method === "POST" && e.path === "/api/settings/shuttle-routes");
    if (!posts.length) await sleep(100);
  }
  check(
    "加路线：POST 带 group/方向/label，成功后新路线的药丸出现、自动选中",
    posts.length === 1 && posts[0].body.label === "Page Shuttle — Outbound" && posts[0].body.direction === "outbound" && (await evaluate("return [...document.querySelectorAll('[aria-label=Route] button')].some(b => b.textContent.includes('Page Shuttle — Outbound') && b.getAttribute('aria-pressed') === 'true');")),
    JSON.stringify(posts),
  );
  check("新路线的字段卡片是空的、键名用新 group", await evaluate("return $card('SMS body').textContent.includes('tmpl__shuttle__page__outbound__sms_body') && $card('SMS body').querySelector('textarea').value === '';"));

  // 重复的 group+方向：后端拒绝，错误原话显示在 Add 表单下面
  before = (await mockLog()).length;
  await evaluate(
    "window.$setSelect(document.querySelector('select[aria-label=\"Shuttle group\"]'), 'Boulder City Shuttle'); window.$setSelect(document.querySelector('select[aria-label=\"Direction\"]'), 'Outbound'); window.$setValue(document.querySelector('input[aria-label=\"Route label\"]'), 'dup'); $btn('Add').click();",
  );
  await sleep(300);
  check("重复 group+方向：Add 表单下面显示后端原话，没有多出一条路线", await evaluate("return document.body.textContent.includes('A route for this group and direction already exists.') && [...document.querySelectorAll('[aria-label=Route] button')].length === 3;"));

  // 没填 label：前端先拦，不发请求
  before = (await mockLog()).length;
  await evaluate("window.$setValue(document.querySelector('input[aria-label=\"Route label\"]'), ''); $btn('Add').click();");
  await sleep(200);
  check("Add route 不填 label：前端拦住、不发请求", (await mockLog()).length === before && (await evaluate("return document.body.textContent.includes('Pick a group and type a label.');")));

  check("右边 Preview 面板写明 Shuttle 还没有 Preview", await evaluate("return document.querySelector('aside').textContent.includes('No preview for Shuttle yet');"));
  check("How to use（整页）的 Shuttle 提醒改成：三个标签所有线共用，Manifests 发送时用", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Content Studio')).textContent; return t.includes('the Email, SMS and Guest Page tabs are shared by every shuttle route') && !t.includes('no automatic or manual send feature');"));

  // ── Shuttle 两层（Annie 2026-10-27「动手」，preview 第 4 版；接口 = 后端 8a task/g189-shuttle-shared）──
  // 上面整段旧路线面板的检查，就是「新接口 404 时回到旧面板」的检查（mock 默认没有新接口）。
  await ctl({ shuttleProducts: true });
  await openPage(`${APP}/settings/content-studio`);
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Shuttle'))");
  await h();
  await evaluate("$open('Shuttle');");
  await waitFor("document.querySelectorAll('[role=tab]').length === 4");
  await h();
  const tabsOf = "return [...document.querySelectorAll('[role=tab]')].map(b => b.textContent).join('|');";
  check("两层：标签 Email | SMS | Guest Page | Routes，默认 Email；没有旧的 Add route", (await evaluate(tabsOf)) === "Email|SMS|Guest Page|Routes" && (await evaluate("return document.querySelector('[role=tab][aria-selected=true]').textContent === 'Email' && !document.body.textContent.includes('+ Add route');")), await evaluate(tabsOf));
  check("公共部分没填齐：标签栏上面红框写 Guest Page 空着、Manifests 进 Not sent、追加可以空", await evaluate("const b = document.querySelector('[data-shuttle-hold]'); const tl = document.querySelector('[role=tablist]'); return !!b && b.textContent.includes('Shuttle confirmations are on hold') && b.textContent.includes('Guest Page') && !b.textContent.includes('Email,') && b.textContent.includes('Route extras can stay empty') && !!(b.compareDocumentPosition(tl) & Node.DOCUMENT_POSITION_FOLLOWING);"));
  check("Email 标签：Global — all 8 shuttle routes；主题只读说明；Email body 红框 Global、键 = tmpl__global__shuttle_email_body、值来自接口", await evaluate("const t = document.body.textContent; const c = $card('Email body'); return t.includes('Global — all 8 shuttle routes') && !!$card('Email subject') && !$card('Email subject').querySelector('textarea') && $card('Email subject').textContent.includes('Shuttle Confirmation — product name — date [order #]') && c.textContent.includes('⚠ Global') && c.textContent.includes('tmpl__global__shuttle_email_body') && c.querySelector('textarea').value.startsWith('Thank you for booking your shuttle');"));
  const insertsOf = (l) => `return [...$card('${l}').querySelectorAll('button')].filter(x => x.textContent.startsWith('+ ')).map(x => x.textContent).join('|');`;
  const want7 = "+ name|+ date|+ pickup_time|+ pickup_spot|+ map_link|+ url|+ qty";
  check("Email body 有 7 个 Insert（接口给的 vars）", (await evaluate(insertsOf("Email body"))) === want7, await evaluate(insertsOf("Email body")));
  check("右边 Preview（Q2）：邮件样子，主题带示例线路名，正文变量换成示例数据（Excalibur Tour Lobby）", await evaluate("const m = document.querySelector('aside [data-preview=email]'); return !!m && m.textContent.includes('Shuttle Confirmation — One-way Shuttle: Las Vegas to Page — October 28, 2026') && m.textContent.includes('Be at Excalibur Tour Lobby before 5:30 AM') && !document.body.textContent.includes('No preview for Shuttle yet');"));
  await evaluate("$setValue($card('Email body').querySelector('textarea'), 'Hello {name}, see you soon.');");
  await sleep(150);
  check("打字时 Preview 跟着变", await evaluate("return document.querySelector('aside [data-preview=email]').textContent.includes('Hello Dev, see you soon.');"));
  await evaluate("$btn('Cancel', $card('Email body')).click();");
  await sleep(150);
  await evaluate("$btn('Discard', document.querySelector('[role=dialog]')).click();");
  await sleep(150);

  await evaluate("$tab('SMS');");
  await sleep(150);
  check("SMS 标签：SMS body 红框 Global、7 个 Insert、有短信字数；说明短信不带追加；Preview 是短信气泡", (await evaluate(insertsOf("SMS body"))) === want7 && (await evaluate("const c = $card('SMS body'); const a = document.querySelector('aside [data-preview=sms]'); return c.textContent.includes('⚠ Global') && c.textContent.includes('tmpl__global__shuttle_sms_body') && c.textContent.includes('≈') && document.body.textContent.includes('Route extras are not added to the SMS') && !!a && a.textContent.includes('Hi Dev, your shuttle on October 28, 2026');")));

  await evaluate("$tab('Guest Page');");
  await sleep(150);
  check("Guest Page 标签：客人页文字红框 Global、没有 Insert；Preview 是客人页", (await evaluate(insertsOf("Guest page text"))) === "" && (await evaluate("return $card('Guest page text').textContent.includes('tmpl__global__shuttle_guest_page_body') && !!document.querySelector('aside [data-preview=guest]');")));
  const labelsOf = "return [...$card('Route section labels').querySelectorAll('label')].map(l => l.textContent + '=' + l.querySelector('input').value + '/' + l.querySelector('input').placeholder).join('|');";
  check("Route section labels（Q4 可以自定义）：4 格 Section title / Google Maps link / Apple Maps link / Location photo link，值和 placeholder = 默认文字，红框 Global", (await evaluate(labelsOf)) === "Section title=Route Information/Route Information|Google Maps link=Google Maps/Google Maps|Apple Maps link=Apple Maps/Apple Maps|Location photo link=Location photo/Location photo" && (await evaluate("return $card('Route section labels').textContent.includes('⚠ Global');")), await evaluate(labelsOf));
  before = (await mockLog()).length;
  await evaluate("$setValue($card('Guest page text').querySelector('textarea'), 'Be there 10 minutes early.'); $btn('Save', $card('Guest page text')).click();");
  let shSaves = await waitSaves(before, 1);
  check("存客人页文字：键 = tmpl__global__shuttle_guest_page_body", shSaves.length === 1 && shSaves[0].body.key === "tmpl__global__shuttle_guest_page_body" && shSaves[0].body.value === "Be there 10 minutes early.", JSON.stringify(shSaves.map((x) => x.body)));
  await sleep(150);
  check("公共三格都有了：红框消失", await evaluate("return !document.querySelector('[data-shuttle-hold]');"));
  before = (await mockLog()).length;
  await evaluate("const c = $card('Route section labels'); $setValue(c.querySelector('input[data-key=\"tmpl__global__shuttle_route_heading\"]'), 'Good to know'); $setValue(c.querySelector('input[data-key=\"tmpl__global__shuttle_maps_label\"]'), ''); $btn('Save', c).click();");
  shSaves = await waitSaves(before, 4);
  const lbl = Object.fromEntries(shSaves.map((x) => [x.body.key, x.body.value]));
  check("Route section labels 一个 Save 存 4 格（键用接口给的）：标题 Good to know，Google Maps 清空 = 空字符串", shSaves.length === 4 && lbl.tmpl__global__shuttle_route_heading === "Good to know" && lbl.tmpl__global__shuttle_maps_label === "" && lbl.tmpl__global__shuttle_apple_maps_label === "Apple Maps", JSON.stringify(lbl));

  await evaluate("$tab('Routes');");
  await waitFor("document.querySelectorAll('button[aria-pressed][title]').length > 0");
  const pillsOf = "[...document.querySelectorAll('button[aria-pressed][title]')]";
  const pillTexts = `return ${pillsOf}.map(b => b.textContent.trim().replace(/^[→←⇄?]\\s*/, ''));`;
  check("Routes：默认只展开第一条线所在的 Group（Page）", await evaluate(`const gs = [...document.querySelectorAll('button[aria-expanded]')].filter(b => /routes?,/.test(b.getAttribute('aria-label') || '')); return gs.length === 3 && gs[0].getAttribute('aria-expanded') === 'true' && gs[1].getAttribute('aria-expanded') === 'false' && ${pillsOf}.length === 4;`));
  check("Page 里药丸顺序：先所有 out（按线路名字母序），再 in", (await evaluate(pillTexts)).join("|").replace(/\s+/g, " ") === "Page to Bryce Canyon|Page to Vegas|Bryce Canyon to Page|Vegas to Page", JSON.stringify(await evaluate(pillTexts)));
  check("Group 行写 “4 routes · 0 with extras”；没有橙点、没有 Only unfilled（Q3）", await evaluate("const b = [...document.querySelectorAll('button[aria-expanded]')].find(b => (b.getAttribute('aria-label') || '').startsWith('Page:')); return !!b && b.textContent.includes('4 routes · 0 with extras') && !document.body.textContent.includes('Only unfilled') && !document.body.textContent.includes('text not filled');"));
  const style = (code, prop) => evaluate(`const b = [...document.querySelectorAll('button[aria-pressed][title]')].find(b => b.title.includes('(${code})')); const c = b.firstElementChild; return getComputedStyle(c).${prop};`);
  check("inbound 药丸实心：底色 = Products 里 Page 的颜色 #4e617e、字白色", (await style("PGLV", "backgroundColor")) === "rgb(78, 97, 126)" && (await style("PGLV", "color")) === "rgb(255, 255, 255)");
  check("outbound 药丸空心：白底、边框 #4e617e", (await style("PGVG", "backgroundColor")) === "rgb(255, 255, 255)" && (await style("PGVG", "borderTopColor")) === "rgb(78, 97, 126)");
  check("选中第一条线 PGLV：4 张追加卡片（键 = 接口给的 tmpl__shuttle__pglv__…），0 of 4 filled；没有旧的 SMS body / Email body 卡片", await evaluate("const sel = [...document.querySelectorAll('button[aria-pressed=true][title]')]; return sel.length === 1 && sel[0].title.includes('(PGLV)') && ['Route-Specific Information','Google Maps URL','Apple Maps URL (leave blank to hide)','Location photo URL'].every(l => $card(l) && $card(l).textContent.includes('tmpl__shuttle__pglv__')) && document.querySelector('[data-route-filled]').textContent.includes('0 of 4 filled') && !$card('SMS body') && !$card('Email body');"));
  check("全空的线：Preview 写 guests get the shared text only、没有追加块；邮件和客人页都在", await evaluate("const a = document.querySelector('aside'); return a.textContent.includes('guests get the shared text only') && !a.querySelector('[data-preview-extras]') && !!a.querySelector('[data-preview=email]') && !!a.querySelector('[data-preview=guest]');"));
  // Route-Specific Information 不限行数（Annie：「Route-Specific Information 不设上限吧」）
  for (let i = 0; i < 4; i++) {
    await evaluate("$btn('+ Add line', $card('Route-Specific Information')).click();");
    await sleep(80);
  }
  check("Route-Specific Information 加到 5 行仍能 + Add line，没有 Max 提示", await evaluate("const c = $card('Route-Specific Information'); return c.querySelectorAll('input').length === 5 && !!$btn('+ Add line', c) && !c.textContent.includes('Max');"));
  await evaluate("const ins = $card('Route-Specific Information').querySelectorAll('input'); ['Line one','Line two','Line three','Line four','Line five'].forEach((v, i) => $setValue(ins[i], v));");
  await sleep(150);
  check("Preview 追加块：标题用改过的 Good to know、5 行都在（邮件 + 客人页）", await evaluate("const x = [...document.querySelectorAll('aside [data-preview-extras]')]; return x.length === 2 && x.every(e => e.textContent.includes('Good to know') && e.querySelectorAll('li').length === 5);"));
  before = (await mockLog()).length;
  await evaluate("$btn('Save', $card('Route-Specific Information')).click();");
  shSaves = await waitSaves(before, 1);
  check("存 Route-Specific Information：键 = tmpl__shuttle__pglv__route_info，5 行一行一条", shSaves.length === 1 && shSaves[0].body.key === "tmpl__shuttle__pglv__route_info" && shSaves[0].body.value === "Line one\nLine two\nLine three\nLine four\nLine five", JSON.stringify(shSaves.map((x) => x.body)));
  await evaluate("$setValue($card('Google Maps URL').querySelector('textarea'), 'maps.google.com/page');");
  await sleep(150);
  check("链接不是 http(s)：卡片提示客人看不到（不拦）；Preview 不出这个链接", await evaluate("return !!$card('Google Maps URL').querySelector('[data-url-warn]') && !document.querySelector('aside [data-preview=email] [data-preview-extras]').textContent.includes('Google Maps');"));
  await evaluate("$setValue($card('Google Maps URL').querySelector('textarea'), 'https:\\\\x');");
  await sleep(150);
  check("没有主机名的链接（https:\\x）也提示 Must start with https://", await evaluate("const w = $card('Google Maps URL').querySelector('[data-url-warn]'); return !!w && w.textContent.includes('Must start with https://');"));
  await evaluate("$setValue($card('Google Maps URL').querySelector('textarea'), 'https://maps.app.goo.gl/page');");
  await sleep(150);
  check("改成 https：提示消失；Preview 出链接，文字用默认 Google Maps（标签清空了）", await evaluate("return !$card('Google Maps URL').querySelector('[data-url-warn]') && document.querySelector('aside [data-preview=email] [data-preview-extras]').textContent.includes('Google Maps');"));
  before = (await mockLog()).length;
  await evaluate("$btn('Save', $card('Google Maps URL')).click();");
  shSaves = await waitSaves(before, 1);
  await sleep(150);
  check("存 Google Maps URL：键 = tmpl__shuttle__pglv__maps_url；药丸出灰点、Group 行 1 with extras、2 of 4 filled", shSaves.length === 1 && shSaves[0].body.key === "tmpl__shuttle__pglv__maps_url" && (await evaluate("const b = [...document.querySelectorAll('button[aria-pressed][title]')].find(b => b.title.includes('(PGLV)')); const g = [...document.querySelectorAll('button[aria-expanded]')].find(b => (b.getAttribute('aria-label') || '').startsWith('Page:')); return !!b.querySelector('[data-has-extras]') && g.textContent.includes('1 with extras') && document.querySelector('[data-route-filled]').textContent.includes('2 of 4 filled');")), JSON.stringify(shSaves.map((x) => x.body)));
  await evaluate("$btn('Expand all').click();");
  await sleep(150);
  check("Expand all：8 颗药丸；BCRT 4 格都填了有灰点；Boulder City 用接口自带的 color #9d98ae", (await evaluate(`return ${pillsOf}.length;`)) === 8 && (await evaluate("const b = [...document.querySelectorAll('button[aria-pressed][title]')].find(b => b.title.includes('(BCRT)')); return !!b.querySelector('[data-has-extras]');")) && (await style("BCRT", "borderTopColor")) === "rgb(157, 152, 174)");
  check("Products 没设颜色的 Group 用灰 #c8cdd3；没设方向的药丸是虚线空心", (await style("BZSO", "borderTopColor")) === "rgb(200, 205, 211)" && (await style("BZND", "borderTopStyle")) === "dashed");
  await evaluate("[...document.querySelectorAll('button[aria-pressed][title]')].find(b => b.title.includes('(BZSO)')).click();");
  await sleep(200);
  check("BZ Summer：GET 时才建的 key，用接口给的值当初始值", await evaluate("return $card('Route-Specific Information').querySelector('input').value === 'BZ summer line (value only from the products API)' && $card('Route-Specific Information').textContent.includes('tmpl__shuttle__bzso__route_info');"));
  await evaluate("[...document.querySelectorAll('button[aria-pressed][title]')].find(b => b.title.includes('(BZND)')).click();");
  await sleep(200);
  check("接口给的产品 error 照原话红字显示", await evaluate("return document.body.textContent.includes('This product code is not set up for sending.');"));
  await evaluate("$btn('Collapse all').click();");
  await sleep(150);
  check("Collapse all：一颗药丸都不显示", (await evaluate(`return ${pillsOf}.length;`)) === 0);
  await evaluate("window.$setValue(document.querySelector('input[aria-label=\"Search routes\"]'), 'bryce');");
  await sleep(200);
  check("搜索 bryce：只剩名字里有 Bryce 的药丸，有结果的 Group 自动展开", (await evaluate(pillTexts)).join("|") === "Page to Bryce Canyon|Bryce Canyon to Page|Bryce Canyon Area to Zion National Park · Summer|Bryce Canyon Area to Zion National Park · Winter", JSON.stringify(await evaluate(pillTexts)));
  await evaluate("window.$setValue(document.querySelector('input[aria-label=\"Search routes\"]'), 'zzz-no-such');");
  await sleep(200);
  check("没有匹配：写 No route matches.", await evaluate("return document.body.textContent.includes('No route matches.');"));
  check("Shuttle 的 How to use（6 条）：三个公共标签、不限行数、Route section labels、只有公共三格空着才拦", await evaluate("const d = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Shuttle')); return !!d && d.querySelectorAll('li').length === 6 && d.textContent.includes('shared by all shuttle routes') && d.textContent.includes('as many lines as you need') && d.textContent.includes('Route section labels') && d.textContent.includes('Empty route extras never stop a send');"));
  check("没有 Clone 入口", await evaluate("return ![...document.querySelectorAll('button, select, [aria-label]')].some(e => /clone/i.test(e.textContent + (e.getAttribute('aria-label') || '')));"));
  // 新接口不是 404 的错误：红字 + Retry，不回退到旧面板、不出标签
  await ctl({ shuttleProductsFail: 500 });
  await openPage(`${APP}/settings/content-studio`);
  await h();
  await evaluate("$open('Shuttle');");
  await waitFor("document.body.textContent.includes('Could not load Shuttle text')");
  check("新接口 500：写 Could not load Shuttle text + Retry，不退回旧面板、没有标签", await evaluate("return !!$btn('Retry') && !document.body.textContent.includes('+ Add route') && document.querySelectorAll('[role=tab]').length === 0;"));
  await ctl({ shuttleProducts: false, shuttleProductsFail: 0 });

  // ── 门票新建团（G190）：+ New tour（Name + Code）、✎ Edit tour（Name / SMS name / Short name / Active）──
  const tixPills = "[...document.querySelectorAll('[aria-label=Tour] button')].map(b => b.textContent)";
  const openTixGuest = async () => {
    await openPage(`${APP}/settings/content-studio`);
    await h();
    await evaluate("$open('Tickets Reminder');");
    await sleep(200);
    await evaluate("$tab('Guest Page');");
    await waitFor("$card('Prepare for Your Tour')");
  };
  await ctl({ tixTypes: 403 });
  await openTixGuest();
  await sleep(500);
  check("开关没放给我（403）：照旧 15 个团，没有新建 / 编辑入口", await evaluate(`return ${tixPills}.length === 15 && !$btn('+ New tour') && !$btn('✎ Edit tour');`));
  // 其他错误（含 404）：不再静默退回写死名单——照后端原话报错 + Retry，console.error。
  await ctl({ tixTypes: 0 });
  await openTixGuest();
  await waitFor("document.body.textContent.includes('Could not load the tours')");
  check("门票团接口 404：报错写后端原话 + Retry，不退回写死的 15 个团", await evaluate(`return document.body.textContent.includes('Could not load the tours: Not Found') && ${tixPills}.length === 0 && !!$btn('Retry');`), JSON.stringify(await evaluate(`return ${tixPills};`)));
  check("门票团接口 404：console.error 记了一条", await evaluate("return (window.__csErrors || []).some((m) => m.includes('Could not load the ticket tours'));"));
  await ctl({ tixTypes: 500 });
  await evaluate("$btn('Retry').click();");
  await sleep(500);
  check("门票团接口 500：Retry 后仍报错、不退回写死名单", await evaluate(`return document.body.textContent.includes('Could not load the tours:') && ${tixPills}.length === 0;`));
  await ctl({ tixTypes: 200 });
  await evaluate("$btn('Retry').click();");
  await waitFor("$btn('+ New tour')");
  check("接口恢复后 Retry：团列表和 + New tour 出来", await evaluate(`return ${tixPills}.length > 15;`));
  await openTixGuest();
  await waitFor("$btn('+ New tour')");
  check("接口通：现有团照旧用短名、停用的团写 · Off，最后有 + New tour 和 ✎ Edit tour", await evaluate(`const p = ${tixPills}; return p[0] === 'U-Antelope (Tsosie)' && p.includes('Rattlesnake (AACT) · Off') && p.includes('+ New tour') && p.includes('✎ Edit tour');`), JSON.stringify(await evaluate(`return ${tixPills};`)));
  check("现有团的内容卡片不变", await evaluate("return !!$card('Check-in location') && !!$card('Check-in minutes before tour time') && !!$card('Google Maps URL') && !!$card('Prepare for Your Tour');"));
  await evaluate("$btn('+ New tour').click();");
  await waitFor("document.querySelector('form[aria-label=\"New tour\"]')");
  const newForm = "document.querySelector('form[aria-label=\"New tour\"]')";
  check("新建表单只有 Name、Code 两格，写明 Code 建好不能改", await evaluate(`const f = ${newForm}; return f.querySelectorAll('input').length === 2 && f.textContent.includes("The code can't be changed after the tour is created");`));
  await evaluate(`$setValue(${newForm}.querySelectorAll('input')[0], 'ZZ Test Horseshoe Bend');`);
  check("Code 按 Name 自动填（小写、空格变 _）", (await evaluate(`return ${newForm}.querySelectorAll('input')[1].value;`)) === "zz_test_horseshoe_bend");
  await evaluate(`$setValue(${newForm}.querySelectorAll('input')[1], 'canyon_x');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Create', ${newForm}).click();`);
  await waitFor(`${newForm}.querySelector('[role=alert]')`);
  check("Code 重复：表单下写后端的原因，填的内容不清空", await evaluate(`const f = ${newForm}; return f.querySelector('[role=alert]').textContent.includes('already used') && f.querySelectorAll('input')[0].value === 'ZZ Test Horseshoe Bend';`));
  await evaluate(`$setValue(${newForm}.querySelectorAll('input')[1], 'zz_test_horseshoe_bend');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Create', ${newForm}).click();`);
  await waitFor(`!${newForm}`);
  const tixPosts = await since(before, (e) => e.method === "POST" && e.path === "/api/settings/tix-tour-types");
  check("Create：POST {key, label}，只有这两项", tixPosts.length === 1 && JSON.stringify(tixPosts[0].body) === JSON.stringify({ key: "zz_test_horseshoe_bend", label: "ZZ Test Horseshoe Bend" }), JSON.stringify(tixPosts.map((e) => e.body)));
  check("新团按钮接在最后、直接选中，内容卡片和现有团一样（键名是新团的）", await evaluate("const sel = document.querySelector('[aria-label=Tour] button[aria-pressed=true]'); return sel.textContent === 'ZZ Test Horseshoe Bend' && $card('Check-in location').textContent.includes('tmpl__tix__zz_test_horseshoe_bend__checkin_location') && !!$card('Check-in minutes before tour time') && !!$card('Prepare for Your Tour');"));
  await evaluate("$setValue($card('Check-in location').querySelector('textarea'), 'ZZ lobby');");
  before = (await mockLog()).length;
  await evaluate("$btn('Save', $card('Check-in location')).click();");
  saves = await waitSaves(before, 1);
  check("新团的内容卡片能保存（后端已种 key）", saves[0]?.body.key === "tmpl__tix__zz_test_horseshoe_bend__checkin_location" && (await evaluate("return $card('Check-in location').textContent.includes('Saved');")), JSON.stringify(saves.map((x) => x.body)));
  await evaluate("$setValue($card('Check-in minutes before tour time').querySelector('textarea'), '45');");
  before = (await mockLog()).length;
  await evaluate("$btn('Save', $card('Check-in minutes before tour time')).click();");
  saves = await waitSaves(before, 1);
  check("新团的 Check-in minutes 也能保存（不 404）", await evaluate("return $card('Check-in minutes before tour time').textContent.includes('Saved');"));
  await evaluate("$btn('✎ Edit tour').click();");
  await waitFor("document.querySelector('form[aria-label=\"Edit tour\"]')");
  const editForm = "document.querySelector('form[aria-label=\"Edit tour\"]')";
  check("Edit tour：Code 只显示，Name / SMS name / Short name / Active 四项", await evaluate(`const f = ${editForm}; return f.textContent.includes('zz_test_horseshoe_bend') && f.textContent.includes("(code can't be changed)") && f.querySelectorAll('input[type=text]').length === 3 && !!f.querySelector('input[type=checkbox]');`));
  check("SMS name：灰字真实例子 + 说明客人看到的名字、不写供应商", await evaluate(`const f = ${editForm}; const i = f.querySelectorAll('input[type=text]'); return i[1].placeholder === 'e.g. Upper Antelope Canyon Tour' && f.textContent.includes("The tour name guests see on their ticket (SMS and confirmation page). Don't include the supplier name.") && f.textContent.includes('Name: Upper Antelope Canyon – Chief Tsosie Tours → guests see: Upper Antelope Canyon Tour');`));
  check("Short name 灰字 e.g. U-TC；写明填齐哪几项才进发送页", await evaluate(`const f = ${editForm}; return f.querySelectorAll('input[type=text]')[2].placeholder === 'e.g. U-TC' && f.textContent.includes('The tour shows in the Tour list on Tickets Reminder — Send once SMS name, Short name, Check-in location and Google Maps URL are filled in.');`));
  await evaluate(`const i = ${editForm}.querySelectorAll('input[type=text]'); $setValue(i[1], 'ZZ Horseshoe Bend Tour'); $setValue(i[2], 'ZZ-HB');`);
  await evaluate(`${editForm}.querySelector('input[type=checkbox]').click();`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${editForm}).click();`);
  await waitFor(`!${editForm}`);
  const tixPatches = await since(before, (e) => e.method === "PATCH");
  check("Edit Save：只 PATCH 改了的项（不带 key / label）", tixPatches.length === 1 && JSON.stringify(tixPatches[0].body) === JSON.stringify({ sms_label: "ZZ Horseshoe Bend Tour", abbr: "ZZ-HB", is_active: false }), JSON.stringify(tixPatches.map((e) => e.body)));
  check("停用后按钮写 · Off，没有删除按钮", await evaluate(`return ${tixPills}.includes('ZZ Test Horseshoe Bend · Off') && ![...document.querySelectorAll('button')].some(b => /delete/i.test(b.textContent));`));
  await ctl({ tixTypes: 403 });

  // ── 权限 / 未登录 ──
  await ctl({ staff: true });
  await goto(`${APP}/settings/content-studio`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff：Admin access required", true);
  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/content-studio`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
