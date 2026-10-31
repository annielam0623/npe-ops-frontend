// 周三确认下周排班（员工这一边；G138 改版 Annie 2026-10-30「动手」：整张周表、拖自己的卡片换班 / 改天、打开 off 那天加班、周四 12 点期限）：/schedule/confirm 和邮件链接 /schedule/confirm/link/<token>。
// 前提：mock（sc-mock.js）和 app 的端口用 APP_URL / MOCK_URL / CDP_PORT / MOCK_PORT / CHROME_PROFILE 指定。只连 mock，不发任何真实通知 / 邮件。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9333;

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
const since = async (n, f) => (await mockLog()).slice(n).filter(f);

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

// 合成一次「把自己的卡片拖到格子上」：同一个 DataTransfer 走 dragover → drop（拖的是 slot id）。
const DROP = `
window.$drop = (slotId, target) => {
  if (!target) return false;
  const dt = new DataTransfer();
  dt.setData('text/x-slot', String(slotId));
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return true;
};
window.$cell = (k) => document.querySelector('[data-cell="' + k + '"]');
window.$slot = (id) => document.querySelector('[data-slot="' + id + '"]');
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
`;

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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

const CONFIRM = `${APP}/schedule/confirm?week=2026-11-01`;
const reqCards = (k) => `[...$cell('${k}').querySelectorAll('[data-req-card]')]`;
const status = () => evaluate("return document.querySelector('[data-confirm-status]').textContent;");

async function open(url = CONFIRM) {
  await goto(url);
  await waitFor("document.querySelector('[data-confirm-grid]')");
  await evaluate(DROP);
}

async function run() {
  // ── 员工（Jing）打开确认页：就是那张周表 ──
  await ctl({ reset: true, unavail: false, fail401: false, past: false, published: false, peerAsk: false });
  await open();
  const q = (await since(0, (e) => e.path === "/api/schedule/confirmation"))[0]?.q;
  check("登录进来：GET /api/schedule/confirmation?week=2026-11-01", q?.week === "2026-11-01", JSON.stringify(q));
  check(
    "标题 Your schedule · 11/1 – 11/7 (draft)；期限 Please confirm by Thu, Oct 29, 12:00 PM；状态 Waiting for your answer",
    await evaluate("const h = document.querySelector('[data-confirm] h2').textContent.replace(/\\s+/g, ' '); return h.includes('Your schedule · 11/1 – 11/7 (draft)') && document.querySelector('[data-confirm-deadline]').textContent === 'Please confirm by Thu, Oct 29, 12:00 PM' && document.querySelector('[data-confirm-status]').textContent === 'Waiting for your answer';"),
    await evaluate("return document.querySelector('[data-confirm]').innerText.slice(0, 300);"),
  );
  check(
    "同线上周表：一人一行（Jing (you) / Lizzie / Nadia / Veronica）× 7 天，班次卡带时间",
    await evaluate("const names = [...document.querySelectorAll('[data-row-name]')].map(e => e.dataset.rowName); return JSON.stringify(names) === JSON.stringify(['Jing','Lizzie','Nadia','Veronica']) && document.querySelectorAll('[data-cell]').length === 28 && document.querySelector('[data-row-name=Jing]').textContent.includes('(you)') && $cell('Lizzie|2026-11-02').textContent.includes('Open') && $cell('Lizzie|2026-11-02').textContent.includes('2:00 AM – 12:00 PM');"),
  );
  check("别人的休假只写 Off（Veronica Sat）；空班不出现在任何人的行里", await evaluate("return $cell('Veronica|2026-11-07').textContent.trim() === 'Off' && !document.querySelector('[data-slot=\"119\"]');"));
  check(
    "只有自己的卡片能拖（⠿）：Jing 4 张 draggable，别人的都不能拖",
    await evaluate("const all = [...document.querySelectorAll('[data-slot]')]; const drag = all.filter(e => e.draggable).map(e => e.dataset.slot); return JSON.stringify(drag) === JSON.stringify(['100','101','102','103']) && all.filter(e => e.draggable).every(e => e.textContent.includes('⠿'));"),
  );
  check(
    "Looks good 不是蓝的；Send my changes 是蓝色提交键、没改动时点不了",
    await evaluate("const a = document.querySelector('[data-confirm-accept]'); const s = document.querySelector('[data-confirm-send]'); return a.textContent === 'Looks good' && !a.className.includes('3b82f6') && s.className.includes('bg-[#3b82f6]') && s.disabled;"),
  );

  // ── 拖到别人有班的格子 = 换班 ──
  await evaluate("window.$drop(103, $slot(105));");
  await waitFor("document.querySelector('[data-split=\"105\"]')");
  check(
    "Jing 的 Sat Close 拖到 Lizzie 的 Mon Open：那格一分为二「Jing request / Lizzie original」",
    await evaluate("const t = document.querySelector('[data-split=\"105\"]').textContent; return t.includes('Jing request') && t.includes('Lizzie original');"),
  );
  check(
    "Jing 原来的 Sat 变淡「↔ to Lizzie if they agree」；Jing 的 Mon、Lizzie 的 Sat 出亮黄卡片；状态 1 change, not sent yet",
    (await evaluate("return $slot(103).className.includes('opacity-40') && $slot(103).textContent.includes('↔ to Lizzie if they agree');")) &&
      (await evaluate(`return ${reqCards("Jing|2026-11-02")}.some(c => c.textContent.includes('↔ from Lizzie · not sent')) && ${reqCards("Lizzie|2026-11-07")}.some(c => c.textContent.includes('↔ from Jing · not sent'));`)) &&
      (await status()) === "1 change, not sent yet",
    await evaluate("return document.querySelector('[data-confirm-grid]').innerText.slice(0, 600);"),
  );
  check("有没发的改动时 Looks good 点不了、Send 能点", await evaluate("return document.querySelector('[data-confirm-accept]').disabled && !document.querySelector('[data-confirm-send]').disabled;"));

  // ── 拖到自己没班的那天 = 改天上 ──
  await evaluate("window.$drop(102, $cell('Jing|2026-11-06'));");
  await waitFor(`${reqCards("Jing|2026-11-06")}.length === 1`);
  check(
    "Jing 的 Thu Close 拖到她自己的 Fri：Fri 出亮黄「moved here · not sent」，Thu 变淡「moving to Fri」",
    await evaluate(`return ${reqCards("Jing|2026-11-06")}[0].textContent.includes('moved here · not sent') && $slot(102).textContent.includes('moving to Fri');`),
  );

  // ── 别人的卡片不能拖、空班不能当换班目标 ──
  await evaluate("window.$drop(105, $cell('Jing|2026-11-04')); window.$drop(104, $slot(109));");
  await sleep(200);
  check("拿别人的班（Lizzie）去拖：什么都不变", (await status()) === "2 changes, not sent yet");

  // ── 把自己 off 的那天打开 = 加班 ──
  await evaluate("document.querySelector('[data-add-day=\"2026-11-04\"]').click();");
  await waitFor("document.querySelector('[data-add-picker]')");
  check(
    "Wed 点 + Work this day：只能从已有班次选（Open / Mid / Close，带默认时间）",
    await evaluate("const t = [...document.querySelectorAll('[data-add-shift]')].map(b => b.textContent); return JSON.stringify(t) === JSON.stringify(['Open · 2:00 AM – 12:00 PM','Mid · 10:00 AM – 6:00 PM','Close · 11:30 AM – 9:30 PM']);"),
  );
  await evaluate("document.querySelector('[data-add-shift=open]').click();");
  await waitFor(`${reqCards("Jing|2026-11-04")}.length === 1`);
  check("选 Open：Wed 出亮黄「+ extra shift · not sent」；3 changes", (await evaluate(`return ${reqCards("Jing|2026-11-04")}[0].textContent.includes('+ extra shift · not sent');`)) && (await status()) === "3 changes, not sent yet");
  check(
    "Your changes 列出三条（都写 Not sent yet，带 ✕）",
    await evaluate("const t = [...document.querySelectorAll('[data-draft]')].map(d => d.textContent); return t.length === 3 && t[0].includes('⇄ Sat Close ↔ Lizzie\\'s Mon Open — Lizzie is asked first') && t[1].includes('→ Move Thu Close to Fri') && t[2].includes('+ Work Wed 11/4 · Open (extra shift)') && t.every(x => x.includes('Not sent yet'));"),
    await evaluate("return [...document.querySelectorAll('[data-draft]')].map(d => d.textContent).join(' | ');"),
  );
  await evaluate("document.querySelectorAll('[data-draft] button')[2].click();");
  await waitFor("document.querySelectorAll('[data-draft]').length === 2");
  check("✕ 撤回一条：Wed 的亮黄卡片也没了", await evaluate(`return ${reqCards("Jing|2026-11-04")}.length === 0;`));
  await evaluate("document.querySelector('[data-add-day=\"2026-11-04\"]').click();");
  await waitFor("document.querySelector('[data-add-picker]')");
  await evaluate("document.querySelector('[data-add-shift=open]').click();");
  await waitFor("document.querySelectorAll('[data-draft]').length === 3");

  // ── 手机上拖不动：点自己的卡片，再点目标 ──
  await evaluate("$slot(100).click();");
  await sleep(150);
  check("点自己的卡片：高亮一圈，别人的班出虚线框可点", await evaluate("return $slot(100).className.includes('ring-2') && $slot(108).className.includes('outline-dashed');"));
  await evaluate("$slot(100).click();");
  await sleep(150);
  check("再点一次取消高亮", await evaluate("return !$slot(100).className.includes('ring-2');"));

  let from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-confirm-send]').click();");
  await waitFor("document.querySelector('[data-confirm-status]').textContent === 'Your changes were sent.'");
  const ch = (await since(from, (e) => e.path === "/api/schedule/confirmation/changes"))[0]?.body;
  check(
    "Send my changes：POST …/changes {week_start, requests: swap / move / add}",
    ch?.week_start === "2026-11-01" &&
      JSON.stringify(ch.requests) ===
        JSON.stringify([
          { kind: "swap", my_slot_id: 103, their_slot_id: 105 },
          { kind: "move", my_slot_id: 102, date: "2026-11-06" },
          { kind: "add", date: "2026-11-04", shift_type: "open" },
        ]),
    JSON.stringify(ch),
  );
  check(
    "发出后：绿字 ✓ Sent · 时间；Your changes 写状态 Waiting for Lizzie / Waiting for approval；格子里写 asked / waiting for approval",
    (await evaluate("const s = document.querySelector('[data-confirm-sent]'); return !!s && /^✓ Sent · \\d{1,2}:\\d\\d [AP]M$/.test(s.textContent) && s.className.includes('emerald');")) &&
      (await evaluate("const t = [...document.querySelectorAll('[data-sent-request]')].map(d => d.textContent); return t.length === 3 && t[0].includes('Waiting for Lizzie') && t[1].includes('Waiting for approval') && t[2].includes('Waiting for approval') && document.querySelectorAll('[data-draft]').length === 0;")) &&
      (await evaluate(`return ${reqCards("Lizzie|2026-11-07")}.some(c => c.textContent.includes('↔ from Jing · asked')) && ${reqCards("Jing|2026-11-06")}[0].textContent.includes('moved here · waiting for approval');`)),
    await evaluate("return document.querySelector('[data-confirm]').innerText.slice(-400);"),
  );
  check("发出后 Looks good 收起（已经回过了）", await evaluate("return !document.querySelector('[data-confirm-accept]');"));

  // ── Looks good ──
  await ctl({ reset: true });
  await open();
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-confirm-accept]').click();");
  await waitFor("document.querySelector('[data-confirm-status]').textContent === 'You said it looks good.'");
  const ac = (await since(from, (e) => e.path === "/api/schedule/confirmation/accept"))[0]?.body;
  check("Looks good：POST …/accept {week_start}；状态 You said it looks good.", ac?.week_start === "2026-11-01", JSON.stringify(ac));

  // ── 别人找我换班：Accept 在前、Decline 在后 ──
  await ctl({ reset: true, peerAsk: true });
  await open();
  check(
    "Nadia 找我换班：黄色提示写清谁上谁的班；我的 Tue Mid 一分为二「Nadia request / Jing original」",
    await evaluate("const b = document.querySelector('[data-peer-ask]').textContent; return b.includes('Nadia asked to swap with you: you take Nadia\\'s Wed Close 11:30 AM – 9:30 PM, Nadia takes your Tue Mid 10:00 AM – 6:00 PM.') && document.querySelector('[data-split=\"101\"]').textContent.includes('Nadia request');"),
    await evaluate("return document.querySelector('[data-peer-ask]')?.textContent;"),
  );
  check(
    "成对的键 Accept 在前（蓝）、Decline 在后",
    await evaluate("const bs = [...document.querySelector('[data-peer-ask]').querySelectorAll('button')]; return bs.map(b => b.textContent).join('/') === 'Accept/Decline' && bs[0].className.includes('3b82f6') && !bs[1].className.includes('3b82f6');"),
  );
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[data-peer-ask] [data-peer-accept]').click();");
  await waitFor("!document.querySelector('[data-peer-ask]')");
  const ans = (await since(from, (e) => e.path === "/api/schedule/confirmation/requests/900/answer"))[0]?.body;
  check("Accept：POST …/requests/900/answer {answer: accept}；提示和一分为二都没了", ans?.answer === "accept" && (await evaluate("return !document.querySelector('[data-split]');")), JSON.stringify(ans));

  // ── 过了周四 12 点 / 已发布：只能看 ──
  await ctl({ reset: true, peerAsk: false, past: true });
  await open();
  check(
    "过了期限：写 The deadline (Thu, Oct 29, 12:00 PM) has passed…counts as confirmed；没有期限行、按钮、⠿、+ Work this day",
    await evaluate("const t = document.querySelector('[data-confirm-closed]').textContent; return t.includes('The deadline (Thu, Oct 29, 12:00 PM) has passed. If you didn\\'t reply, this schedule counts as confirmed.') && !document.querySelector('[data-confirm-deadline]') && !document.querySelector('[data-confirm-accept]') && !document.querySelector('[data-confirm-send]') && ![...document.querySelectorAll('[data-slot]')].some(e => e.draggable) && !document.querySelector('[data-add-day]');"),
  );
  await evaluate("window.$drop(103, $slot(105));");
  await sleep(200);
  check("过了期限拖也没用", await evaluate("return !document.querySelector('[data-split]');"));
  await ctl({ past: false, published: true });
  await open();
  check("已发布：This week is published, so requests are closed. Ask your supervisor.；标题没有 (draft)", await evaluate("return document.querySelector('[data-confirm-closed]').textContent === 'This week is published, so requests are closed. Ask your supervisor.' && !document.querySelector('[data-confirm] h2').textContent.includes('draft');"));
  await ctl({ published: false });

  // ── 接口没上线 / 没登录 / 邮件链接 ──
  await ctl({ unavail: true });
  await goto(CONFIRM);
  await waitFor("document.body.innerText.includes('Nothing to confirm right now.')");
  check("接口没上线（404）：只写 Nothing to confirm right now.，不报错", await evaluate("return !document.body.innerText.includes('Could not load') && !document.body.innerText.includes('Request failed');"));
  await ctl({ unavail: false, reset: true });
  const L = `${APP}/schedule/confirm/link/tok-abc?week=2026-11-01`;
  await open(L);
  const linkGets = await since(0, (e) => e.path === "/api/schedule/confirmation/link/tok-abc");
  check("邮件链接：走 /api/schedule/confirmation/link/tok-abc，没有侧栏 / 顶栏（不套外框）", linkGets.length >= 1 && (await evaluate("return !document.querySelector('nav[aria-label=Main]') && !document.querySelector('header') && !!document.querySelector('[data-confirm-accept]');")));
  check("邮件链接也带 ?week=（后端要求，不带会 422）", linkGets[0]?.q?.week === "2026-11-01", JSON.stringify(linkGets[0]?.q));
  from = (await mockLog()).length;
  await evaluate("window.$drop(100, $cell('Jing|2026-11-02'));");
  await waitFor("document.querySelectorAll('[data-draft]').length === 1");
  await evaluate("document.querySelector('[data-confirm-send]').click();");
  await waitFor("document.querySelector('[data-confirm-status]').textContent === 'Your changes were sent.'");
  check("邮件链接里发改动：POST /api/schedule/confirmation/link/tok-abc/changes", (await since(from, (e) => e.path === "/api/schedule/confirmation/link/tok-abc/changes" && e.method === "POST")).length === 1);
  await goto(`${APP}/schedule/confirm/link/expired`);
  await waitFor("document.body.innerText.includes('This link has expired.')");
  check("过期的链接：This link has expired. Ask the office to send you a new one.", await evaluate("return document.body.innerText.includes('Ask the office to send you a new one.');"));
  check("员工这页整个过程没有任何 edit-lock 请求（不占共用的表）", (await since(0, (e) => e.path.includes("edit-lock"))).length === 0);
  await ctl({ fail401: true });
  await goto(CONFIRM);
  check("没登录：跳旧后台登录页，带 next", await waitFor("location.pathname === '/auth/login' && location.search.includes('next=')"));
}

main();
