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
