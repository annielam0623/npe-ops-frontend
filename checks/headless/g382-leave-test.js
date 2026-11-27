// G382 请假框（components/hr/schedule-leave）在临时检查页 /zz-g382-leave-harness 上的检查。
// 页面内拦 fetch（不连任何后端）。跑法：先在本 worktree 起 next dev（API_PROXY_TARGET 指向空端口），再
//   APP_URL=http://localhost:3288 node checks/headless/g382-leave-test.js
// 等 53 的总览挂上这些框以后，改成对总览页跑（换成 mock 后端），检查页删掉。
const puppeteer = require("puppeteer-core");

const BASE = process.env.APP_URL || "http://localhost:3288";
let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (p) => p.evaluate(() => document.body.innerText);

async function open(page, d) {
  await page.goto(`${BASE}/zz-g382-leave-harness?d=${d}`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForSelector('[role="dialog"]', { timeout: 60000 });
}
const disabled = (p, sel) => p.$eval(sel, (b) => b.disabled);
async function selectVal(p, sel, v) {
  await p.$eval(sel, (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, v);
  await sleep(150);
}
const calls = (p) => p.evaluate(() => window.__calls);
const out = (p) => p.evaluate(() => window.__out);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  /* 1. 按小时，已发布周（Q2 A） */
  await open(page, "hour");
  let t = await txt(page);
  check("hour: title", t.includes("Leave request · Nadia"));
  check("hour: published label", t.includes("This week is published"));
  check("hour: asked line", t.includes("Asked Nov 23 · You are their manager · “Doctor appointment”"), t.match(/Asked[^\n]*/)?.[0]);
  check("hour: kind shows Leave (Q8)", await page.$eval("select", (s) => s.selectedOptions[0].textContent === "Leave"));
  check("hour: need cover red box", !!(await page.$("[data-need-cover]")), t.match(/Nobody else is on[^\n]*/)?.[0]);
  check("hour: Approve grey until cover picked", await disabled(page, "[data-leave-approve]"));
  const opts = await page.$$eval("[data-cover-select] option", (o) => o.map((x) => ({ t: x.textContent, d: x.disabled })));
  check("hour: Lizzie (Close 4–9:30) greyed with reason", opts.some((o) => o.d && o.t.startsWith("Lizzie — Already on Close")), JSON.stringify(opts));
  check("hour: Jing (off) pickable", opts.some((o) => !o.d && o.t.startsWith("Jing · Off that day")));
  check("hour: test person not listed", !opts.some((o) => o.t.includes("ZZ Test")));
  check("hour: Adds Close … Cover for Nadia (Q12)", t.includes("Close 3:00–5:00 PM") && t.includes("“Cover for Nadia”"));
  await selectVal(page, "[data-cover-select]", "4");
  check("hour: Approve enabled after cover", !(await disabled(page, "[data-leave-approve]")));
  await page.type('input[maxlength="120"]', "Back by 4 please");
  await page.click("[data-leave-approve]");
  await sleep(400);
  let c = (await calls(page)).pop();
  check("hour: POST approve", c && c.url.endsWith("/leave-requests/71/approve") && c.method === "POST");
  check("hour: body cover + note, no adjust", c && c.body.cover?.employee_id === 4 && c.body.note === "Back by 4 please" && !c.body.adjust, JSON.stringify(c?.body));

  /* 1b. 调整（Q11） */
  await open(page, "hour");
  await selectVal(page, 'select[aria-label="To"]', "16:00");
  check("adjust: Approve grey while asking would-gap", await disabled(page, "[data-leave-approve]"));
  await sleep(700);
  {
    const wg = (await calls(page)).filter((x) => x.url.includes("/would-gap"));
    const q = wg.length ? new URL(wg[wg.length - 1].url, BASE).searchParams : null;
    check("adjust: asks GET leave-requests/71/would-gap?date=2026-11-27&start_time=15:00&end_time=16:00 (one call after the pause)", wg.length === 1 && wg[0].method === "GET" && wg[0].url.includes("/leave-requests/71/would-gap?") && q.get("date") === "2026-11-27" && q.get("start_time") === "15:00" && q.get("end_time") === "16:00", JSON.stringify(wg));
    check("adjust: backend gap ⇒ cover picker + Approve grey", !!(await page.$("[data-cover-select]")) && (await disabled(page, "[data-leave-approve]")));
  }
  t = await txt(page);
  check("adjust: yellow changed-from", !!(await page.$("[data-adjusted]")) && t.includes("Changed from Fri 11/27 3:00–5:00 PM (Leave)") && t.includes("approved as Fri 11/27 3:00–4:00 PM (Leave)"));
  await selectVal(page, "[data-cover-select]", "4");
  await page.click("[data-leave-approve]");
  await sleep(400);
  c = (await calls(page)).pop();
  check("adjust: body.adjust", c && c.body.adjust?.end_time === "16:00" && c.body.adjust.start_time === "15:00" && c.body.adjust.kind === "personal", JSON.stringify(c?.body));

  /* 1b2. would-gap：后端说没空档 / 400 / 409（后端 86：前端不另算） */
  await open(page, "hour");
  await page.evaluate(() => (window.__wg = { status: 200, body: { would_gap: [] } }));
  await selectVal(page, 'select[aria-label="From"]', "15:30");
  await sleep(700);
  check("would-gap []: no cover picker, Approve enabled", !(await page.$("[data-cover-select]")) && !(await disabled(page, "[data-leave-approve]")));
  await page.evaluate(() => (window.__wg = { status: 400, body: { detail: "Pick times on the hour or half hour." } }));
  await selectVal(page, 'select[aria-label="To"]', "16:30");
  await sleep(700);
  t = await txt(page);
  check("would-gap 400: backend text in the red box, Approve grey", t.includes("Pick times on the hour or half hour.") && (await disabled(page, "[data-leave-approve]")), t.match(/Pick[^\n]*/)?.[0]);
  await page.evaluate(() => (window.__wg = { status: 409, body: { detail: { detail: "Someone already decided this request.", code: "already_decided" } } }));
  await selectVal(page, 'select[aria-label="To"]', "17:00");
  await selectVal(page, 'select[aria-label="From"]', "16:00");
  await sleep(700);
  t = await txt(page);
  check("would-gap 409: backend text in the red box, Approve grey", t.includes("Someone already decided this request.") && (await disabled(page, "[data-leave-approve]")));
  {
    const n = (await calls(page)).filter((x) => x.url.includes("/would-gap")).length;
    check("would-gap: quick changes ⇒ one call per pause (3)", n === 3, `n=${n}`);
  }

  /* 1c. 后端 409 原话 */
  await open(page, "hour");
  await page.evaluate(() => (window.__fail = "This change breaks a schedule rule, so it wasn't saved."));
  await selectVal(page, "[data-cover-select]", "4");
  await page.click("[data-leave-approve]");
  await sleep(500);
  t = await txt(page);
  check("409: red box with backend text, dialog stays", t.includes("This change breaks a schedule rule") && !!(await page.$('[role="dialog"]')));

  /* 2. 按小时，草稿周：不要顶班 */
  await open(page, "hourdraft");
  t = await txt(page);
  check("hour draft: no cover select", !(await page.$("[data-cover-select]")));
  check("hour draft: yellow gap note", !!(await page.$("[data-draft-gap]")), t.match(/This leaves[^\n]*/)?.[0]);
  check("hour draft: Approve enabled", !(await disabled(page, "[data-leave-approve]")));

  /* 3. 按天，草稿周（Q1 A） */
  await open(page, "day");
  t = await txt(page);
  check("day: 2 shifts listed", (await page.$$("[data-move-slot]")).length === 2);
  check("day: button text", t.includes("Move shifts and approve"));
  check("day: disabled until handled", await disabled(page, "[data-leave-approve]"));
  const s1 = await page.$$eval("[data-move-slot] select", (ss) => ss.map((s) => [...s.options].map((o) => ({ v: o.value, t: o.textContent, d: o.disabled }))));
  check("day draft: delete option present", s1[0].some((o) => o.v === "delete"));
  check("day: Anita greyed on Mon (has Close)", s1[0].some((o) => o.d && o.t.startsWith("Anita — Already on Close")), JSON.stringify(s1[0]));
  const sels = await page.$$("[data-move-slot] select");
  const firstSel = await sels[0].evaluate((s) => s.getAttribute("aria-label"));
  await selectVal(page, `select[aria-label="${firstSel}"]`, "3");
  const secondSel = await sels[1].evaluate((s) => s.getAttribute("aria-label"));
  await selectVal(page, `select[aria-label="${secondSel}"]`, "delete");
  t = await txt(page);
  check("day: delete gap red note", !!(await page.$("[data-delete-gap]")), t.match(/deleting the[^\n]*/)?.[0]);
  check("day: enabled when all handled", !(await disabled(page, "[data-leave-approve]")));
  await page.click("[data-leave-approve]");
  await sleep(400);
  c = (await calls(page)).pop();
  check("day: body.shifts give + delete", c && c.body.shifts?.length === 2 && c.body.shifts[0].action === "give" && c.body.shifts[0].employee_id === 3 && c.body.shifts[1].action === "delete", JSON.stringify(c?.body));

  /* 3b. 按天，已发布周：不能删 */
  await open(page, "daypub");
  const s2 = await page.$$eval("[data-move-slot] select option", (o) => o.map((x) => x.value));
  check("day published: no delete option", s2.length > 0 && !s2.includes("delete"), JSON.stringify(s2));
  t = await txt(page);
  check("day published: give text", t.includes("Give each one to someone, then approve."));

  /* 3c. Reject */
  await open(page, "daypub");
  await page.click("[data-leave-reject]");
  await sleep(400);
  c = (await calls(page)).pop();
  check("reject: POST reject", c && c.url.endsWith("/leave-requests/74/reject"));

  /* 4. Fill gap */
  await open(page, "fill");
  t = await txt(page);
  check("fill: title", t.includes("Fill gap · Wed 12/2 2:00–4:00 PM"));
  check("fill: why", t.includes("Anita leave 2–4 PM (PTO)") && t.includes("Mid 8:00 AM – 5:00 PM"), t.match(/Why:[^\n]*/)?.[0]);
  const rows = await page.$$eval("[data-candidate]", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  check("fill: candidates", rows.length === 4, JSON.stringify(rows));
  check("fill: summary", t.includes("Adds Mid 2:00–4:00 PM for") && t.includes("“Cover for Anita”"));
  check("fill: green Add", (await page.$eval("[data-fill-add]", (b) => getComputedStyle(b).backgroundColor)) === "rgb(107, 142, 116)");
  await page.click("[data-fill-add]");
  await sleep(200);
  const o = (await out(page)).pop();
  check("fill: staged create op", o && o.op === "create" && o.shift_type === "mid" && o.start_time === "14:00" && o.end_time === "16:00" && o.note === "Cover for Anita" && o.employee_id, JSON.stringify(o));
  check("fill: no network call", (await calls(page)).length === 0);

  /* 5. Add leave */
  await open(page, "add");
  t = await txt(page);
  check("add: title", t.includes("Add leave · Lizzie · Fri 12/11"));
  const kinds = await page.$$eval("select option", (o) => o.map((x) => x.textContent));
  check("add: types PTO/Sick/Leave", kinds.slice(0, 3).join(",") === "PTO,Sick,Leave", kinds.join(","));
  check("add: hint", t.includes("One leave per person per day. Half-hour steps."));
  await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Hours").querySelector("input").click());
  await sleep(150);
  await selectVal(page, 'select[aria-label="From"]', "09:00");
  await selectVal(page, 'select[aria-label="To"]', "11:00");
  await page.click("[data-add-leave]");
  await sleep(200);
  const e = (await out(page)).pop();
  check("add: staged entry hourly", e && e.start_time === "09:00" && e.end_time === "11:00" && e.kind === "pto" && e.employee_id === 2, JSON.stringify(e));

  await open(page, "addday");
  t = await txt(page);
  check("add all-day on a shift day: blocked", (await disabled(page, "[data-add-leave]")) && t.includes("has a shift on Wed 12/2"));

  /* 6. Leave types */
  await open(page, "types");
  const names = await page.$$eval('[data-type-row] input[aria-label="Name"]', (i) => i.map((x) => x.value));
  check("types: PTO/Sick/Leave", names.join(",") === "PTO,Sick,Leave", names.join(","));
  check("types: Save disabled when nothing changed", await disabled(page, "[data-types-save]"));
  await page.type('input[aria-label="New type"]', "Bereavement");
  await page.click("[data-type-add]");
  await page.click('[aria-label="Sick in use"]');
  await page.click('[aria-label="Move Leave up"]');
  check("types: no call before Save (select then save)", (await calls(page)).length === 0);
  await page.click("[data-types-save]");
  await sleep(500);
  const tc = await calls(page);
  check("types: PUT sick inactive", tc.some((x) => x.method === "PUT" && x.url.endsWith("/sick") && x.body.is_active === false && x.body.sort_order === 3), JSON.stringify(tc.map((x) => [x.method, x.url.split("/").pop(), x.body])));
  check("types: PUT personal sort 2", tc.some((x) => x.method === "PUT" && x.url.endsWith("/personal") && x.body.sort_order === 2));
  check("types: POST Bereavement", tc.some((x) => x.method === "POST" && x.body.label === "Bereavement"));
  check("types: PTO untouched", !tc.some((x) => x.url.endsWith("/pto")));
  t = await txt(page);
  check("types: Saved shown", t.includes("Saved"));

  /* 7. Shift change requests（N1） */
  await open(page, "req");
  t = await txt(page);
  check("req: title", t.includes("Shift change request · Jing"));
  check("req: line", t.includes("Jing asks to swap Mon 12/7 Close with Veronica (Veronica has agreed)."), t.match(/Jing asks[^\n]*/)?.[0]);
  check("req: after line", !!(await page.$("[data-request-after]")));
  check("req: Approve enabled", !(await disabled(page, "[data-request-approve]")));
  await page.click("[data-request-approve]");
  await sleep(400);
  c = (await calls(page)).pop();
  check("req: POST approve", c && c.url.endsWith("/confirmation-requests/81/approve") && c.method === "POST");
  check("req: onDone approved", (await out(page)).pop() === "approved");

  await open(page, "reqrest");
  t = await txt(page);
  check("req rest: red rule + Approve disabled", !!(await page.$("[data-request-rest]")) && (await disabled(page, "[data-request-approve]")), t.match(/can't work[^\n]*/)?.[0]);
  await page.click("[data-request-decline]");
  await sleep(400);
  c = (await calls(page)).pop();
  check("req rest: Decline still works", c && c.url.endsWith("/confirmation-requests/82/decline"));

  await open(page, "reqwait");
  t = await txt(page);
  check("req waiting: no Approve, says waiting", !(await page.$("[data-request-approve]")) && t.includes("Waiting for Veronica to agree"));

  await page.goto(`${BASE}/zz-g382-leave-harness?d=bar`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-change-requests-bar]");
  t = await txt(page);
  check("bar: count only open ones", t.includes("Shift change requests · 2"));
  const items = await page.$$eval("[data-change-request]", (b) => b.map((x) => x.textContent));
  check("bar: newest first", items[0].startsWith("Jing asks to add a Mid shift on Wed 12/9"), JSON.stringify(items));
  await page.click('[data-change-request="81"]');
  check("bar: click opens", (await out(page)).pop() === 81);

  /* 8. phone width */
  await page.setViewport({ width: 390, height: 800 });
  await open(page, "day");
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check("phone: no horizontal page scroll", sw <= 390, String(sw));

  // 改班栏手机版（e2 2026-11-26）：标题不叠第一条（ab 报）；收起时「+N」整个在栏里、点得到（fe：原来被整行截断截掉）。
  await page.goto(`${BASE}/zz-g382-leave-harness?d=bar`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-change-requests-bar]");
  const bar = await page.evaluate(() => {
    const b = document.querySelector("[data-change-requests-bar]");
    const br = b.getBoundingClientRect(), t = b.children[0].getBoundingClientRect();
    const first = b.querySelector("[data-change-request]").getBoundingClientRect();
    const more = b.querySelector("[data-change-requests-more]");
    const m = more ? more.getBoundingClientRect() : null;
    return { titleRight: t.right, firstLeft: first.left, more: more?.textContent, moreIn: !!m && m.width > 0 && m.left >= br.left && m.right <= br.right - 1 && m.left >= first.right - 0.5,
      top: m ? document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2) === more : false, oneLine: Math.round(first.top) === Math.round(t.top) };
  });
  check("phone bar: title doesn't overlap the first request", bar.titleRight <= bar.firstLeft + 0.5, JSON.stringify(bar));
  check("phone bar: +1 fully inside the bar and on top (tappable)", bar.more === "+1" && bar.moreIn && bar.top, JSON.stringify(bar));
  await page.click("[data-change-requests-more]");
  const shown = await page.$$eval("[data-change-request]", (b) => b.filter((x) => x.getBoundingClientRect().width > 0).length);
  check("phone bar: tapping +1 shows both requests", shown === 2 && !(await page.$("[data-change-requests-more]")), String(shown));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
