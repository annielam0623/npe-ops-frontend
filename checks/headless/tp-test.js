// Team 权限 v2：Settings › Team 页 + Users 页的四处小改。配 tp-mock.js。
const puppeteer = require("puppeteer-core");

const BASE = process.env.APP_URL || "http://localhost:3198";
const MOCK_PORT = Number(process.env.MOCK_PORT) || 8799;
const PAGE = BASE + "/settings/team";
const ctl = (q) => fetch(`http://127.0.0.1:${MOCK_PORT}/__control?` + q).then((r) => r.json());
let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (page, fn, timeout = 10000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(150)) if (await fn()) return;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, s, timeout = 15000) =>
  page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, s);
const waitNoText = (page, s, timeout = 8000) =>
  page.waitForFunction((s) => !document.body.innerText.includes(s), { timeout }, s);
const dialogText = (page) => page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
const rowText = (page, s) =>
  page.evaluate((s) => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes(s))?.innerText ?? null, s);
async function click(page, label, scope = null) {
  const ok = await page.evaluate(
    (label, scope) => {
      let root = document;
      if (scope === "dialog") root = document.querySelector('[role="dialog"]');
      else if (scope) root = [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes(scope));
      if (!root) return false;
      const btn = [...root.querySelectorAll("button")].find((b) => b.innerText.replace(/\s+/g, " ").trim() === label);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    },
    label,
    scope,
  );
  if (!ok) throw new Error(`button "${label}" not found / disabled in ${scope}`);
}
/** 勾 / 取消一个 label 文字等于 name 的勾选框（弹窗里）。 */
async function tick(page, name) {
  const ok = await page.evaluate((name) => {
    const d = document.querySelector('[role="dialog"]');
    const lab = [...d.querySelectorAll("label")].find((l) => l.innerText.split("\n")[0].trim() === name);
    const box = lab?.querySelector("input");
    if (!box) return false;
    box.click();
    return true;
  }, name);
  if (!ok) throw new Error(`checkbox "${name}" not found`);
}
/** 一行的档位：可选项、按下的那个、Custom 标签。 */
const access = (page, label) =>
  page.evaluate((label) => {
    const g = document.querySelector(`[role="dialog"] [role="group"][aria-label="${label} access"]`);
    if (!g) return null;
    const btns = [...g.querySelectorAll("button")];
    const custom = [...g.parentElement.querySelectorAll("span")].find((x) => x.innerText.startsWith("Custom"));
    return { options: btns.map((x) => x.innerText.trim()), on: btns.find((x) => x.getAttribute("aria-pressed") === "true")?.innerText.trim() ?? null, custom: custom ? custom.innerText.trim() : null };
  }, label);
async function choose(page, label, option) {
  const ok = await page.evaluate((label, option) => {
    const g = document.querySelector(`[role="dialog"] [role="group"][aria-label="${label} access"]`);
    const btn = g && [...g.querySelectorAll("button")].find((x) => x.innerText.trim() === option);
    if (!btn) return false;
    btn.click();
    return true;
  }, label, option);
  if (!ok) throw new Error(`option ${option} not found for ${label}`);
  await sleep(150);
}
const lastBody = async (needle) => {
  const log = await ctl("log=1");
  const hit = [...log].reverse().find((l) => l.startsWith(needle));
  return hit ? JSON.parse(hit.slice(needle.length).trim() || "null") : undefined;
};
async function fill(page, label, value) {
  await page.evaluate((label) => {
    const d = document.querySelector('[role="dialog"]');
    const lab = [...d.querySelectorAll("label")].find((l) => l.innerText.trim() === label);
    document.getElementById(lab.htmlFor).focus();
  }, label);
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type(value);
}

(async () => {
  await ctl("reset=1");
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // ── 列表 ──
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 90000);
  let t = await text(page);
  const userRows = await page.$$eval("tbody tr", (rows) => rows.length);
  check("28 accounts + mailbox row", userRows === 29, `got ${userRows}`);
  // 合并后（Annie 2026-10-28「动手」）：Users 的 Role / Status 并进来，Sign-in 并进 Status。
  check("merged columns: Person / Role / Status / Teams / Access / Notification duties / Home page / Actions", await page.evaluate(() => [...document.querySelectorAll("thead th")].map((th) => th.innerText.trim().toLowerCase()).join("|") === "person|role|status|teams|access|notification duties|home page|actions"));
  const annie = await rowText(page, "@annie");
  check("Super Admin row (self): All modules, no Edit", annie.includes("All") && !/\bEdit\b/.test(annie), annie);
  check("staff row: 19 modules, 2 read only, 2 custom", /19 modules[\s\S]*2 read only[\s\S]*2 custom/.test(await rowText(page, "@ben")), await rowText(page, "@ben"));
  check("admin row: 21 modules, no custom; duties by name", (await rowText(page, "@grace")).includes("21 modules") && !(await rowText(page, "@grace")).includes("custom") && (await rowText(page, "@grace")).includes("Complaints, Refunds"));
  check("supervisor row: 21 modules, 1 custom (Logs)", (await rowText(page, "@daniel")).includes("21 modules") && (await rowText(page, "@daniel")).includes("1 custom"));
  check("Super Admin row: All modules", annie.includes("All modules"));
  check("home page label shown", (await rowText(page, "@ben")).includes("Morning Pickup · Tracking") && (await rowText(page, "@kevin")).includes("Dispatch"));
  check("deactivated row says Inactive + Reactivate", (await rowText(page, "@uma")).includes("Inactive") && (await rowText(page, "@uma")).includes("Reactivate"));
  check("email shown under the name (from /api/team)", (await rowText(page, "@grace")).includes("grace@example.com"));
  check("no 🗑 on account rows (Delete is in the Edit box)", !(await rowText(page, "@uma")).includes("🗑") && !(await rowText(page, "@ben")).includes("Delete"));
  const pend = await page.$$eval("tbody tr", (rows) => rows.filter((r) => r.innerText.includes("Pending registration")).length);
  check("two pending invite rows", pend === 2, `got ${pend}`);
  const mail = await rowText(page, "reservations@");
  check("mailbox row: Department mailbox + Edit duties only", mail.includes("Department mailbox") && mail.includes("Edit duties") && mail.includes("Complaints"));
  check("How to use is folded", await page.$eval("details", (d) => !d.open && d.innerText.includes("How to use — Team")));
  check("Add person button is the green one (not blue)", await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("Add person"));
    return getComputedStyle(b).backgroundImage.includes("linear-gradient");
  }));
  // G203 第二批：页面最底的 Action Log（共用读接口 /api/team/action-log）。
  {
    const alBefore = (await ctl("log=1")).length;
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Action Log")).click());
    await page.waitForFunction(() => document.querySelectorAll("[data-action-log] tbody tr").length === 2, { timeout: 20000 }).catch(() => {});
    const alReqs = (await ctl("log=1")).slice(alBefore).filter((l) => l.startsWith("GET /api/team/action-log"));
    const alRows = await page.$$eval("[data-action-log] tbody tr", (rows) => rows.length);
    check("G203 Action Log：页面最底，展开才请求 /api/team/action-log、显示 2 行", alReqs.length === 1 && alRows === 2, `${alReqs.length} req, ${alRows} rows`);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Action Log")).click());
  }
  // 侧栏默认收起成窄条：先点开。
  await page.click('button[aria-label="Open menu"]');
  const teamLink = await page.waitForSelector('a[href="/settings/team"]', { timeout: 15000 }).catch(() => null);
  await page.click('button[aria-label="Close menu"]').catch(() => {});
  check("sidebar has Team link for Super Admin", teamLink !== null,
    teamLink ? "" : (await page.$$eval("a", (as) => as.map((a) => a.getAttribute("href")).filter((h) => h && h.includes("settings")).join(","))));

  // ── 编辑 Daniel（Supervisor 44 项）：每个模块三选一 / 两档 ──
  await click(page, "Edit", "@daniel");
  await waitText(page, "Copy access from");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  let d = await dialogText(page);
  check("dialog header: 21 modules", d.includes("21 modules"), d.slice(0, 300));
  const notActive = (d.match(/Not active yet/g) || []).length;
  check("20 modules Not active yet (only Daily Operation Report wired)", notActive === 20, `got ${notActive}`);
  check("Supervisor DOR = Read & edit, note about staff", (await access(page, "Daily Operation Report")).on === "Read & edit" && d.includes("Everyone can edit the report entries they logged themselves. Read & edit adds Edit report entries: edit everyone's report entries."));
  check("Supervisor Staff Schedule = Read & edit", (await access(page, "Staff Schedule")).on === "Read & edit");
  check("Supervisor Tasks = Read & edit", (await access(page, "Tasks")).on === "Read & edit");
  let lg = await access(page, "Logs");
  check("Logs: view + export, no delete → Custom: 2 of 3, no option pressed", lg.custom === "Custom: 2 of 3" && lg.on === null, JSON.stringify(lg));
  check("Dashboard / Broadcast only None / Full access", (await access(page, "Dashboard")).options.join() === "None,Full access" && (await access(page, "Broadcast")).options.join() === "None,Full access");
  check("My Workspace = Full access (two options)", JSON.stringify(await access(page, "My Workspace / Quotation")) === JSON.stringify({ options: ["None", "Full access"], on: "Full access", custom: null }));
  check("Settings folded: 1 of 13 pages", d.includes("1 of 13 pages"));
  check("selected option is dark grey, not blue", await page.evaluate(() => {
    const b = document.querySelector('[role="group"][aria-label="Forms access"] button[aria-pressed="true"]');
    return getComputedStyle(b).backgroundColor === "rgb(55, 65, 81)";
  }));
  check("home page select shows Manifests", await page.$eval('select[aria-label="Home page"]', (s) => s.value === "/manifests"));
  // what's included（Reports 带 reports.export 的说明）
  await page.evaluate(() => {
    const g = document.querySelector('[role="group"][aria-label="Reports access"]');
    [...g.closest("div.grid").querySelectorAll("button")].find((x) => x.innerText.includes("what's included")).click();
  });
  await waitText(page, "Read & edit adds");
  d = await dialogText(page);
  check("what's included lists items + reports.export note", d.includes("Read only: View Reports") && d.includes("Export Reports") && d.includes("The old pages can still export until export moves to the server."));
  // 改档位
  await choose(page, "Staff Schedule", "Read only");
  check("Staff Schedule → Read only", (await access(page, "Staff Schedule")).on === "Read only");
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button[aria-expanded]')].find((x) => x.innerText.includes("pages")).click());
  await page.waitForSelector('[role="group"][aria-label="Human Resource (HR profiles) access"]');
  check("HR row: Read only now", (await access(page, "Human Resource (HR profiles)")).on === "Read only");
  check("Quotation rates row in Settings: None / Full access, None now", JSON.stringify(await access(page, "Quotation rates (rate card and event calendar)")) === JSON.stringify({ options: ["None", "Full access"], on: "None", custom: null }));
  await choose(page, "Human Resource (HR profiles)", "Read & edit");
  await choose(page, "Quotation rates (rate card and event calendar)", "Full access");
  check("Settings group now 2 of 13 pages", (await dialogText(page)).includes("2 of 13 pages"));
  await tick(page, "Refunds");
  await tick(page, "Tickets");
  await page.select('select[aria-label="Home page"]', "");
  await click(page, "Save", "dialog");
  await waitNoText(page, "Copy access from");
  let b = await lastBody("PUT /api/team/members/5");
  const want = b?.items || [];
  check("PUT: schedule edit/publish removed, HR edit + rates added, 44 items", want.length === 44 && !want.includes("schedule.edit") && !want.includes("schedule.publish") && want.includes("schedule.view") && want.includes("settings.hr.edit") && want.includes("quotation.rates_edit"), String(want.length));
  check("PUT: Custom Logs kept exactly (view + export, no delete)", want.includes("logs.view") && want.includes("logs.export") && !want.includes("logs.delete"));
  check("PUT: items sorted", JSON.stringify(want) === JSON.stringify([...want].sort()));
  check("PUT body: duties + teams + home null", b && JSON.stringify(b.duties) === '["guest_messages","refunds"]' && JSON.stringify(b.team_ids) === "[2,3,4]" && b.home_path === null, JSON.stringify(b && { ...b, items: undefined }));
  await page.waitForFunction(() => [...document.querySelectorAll("tr")].find((r) => r.innerText.includes("@daniel"))?.innerText.includes("1 read only"), { timeout: 15000 });
  check("list refreshed after save", (await rowText(page, "@daniel")).includes("1 read only") && (await rowText(page, "@daniel")).includes("Dashboard"));

  // ── 员工 Ben：迁移后的样子 ──
  await click(page, "Edit", "@ben");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  check("staff Tasks = Read only (own tasks)", (await access(page, "Tasks")).on === "Read only");
  check("staff DOR = Custom 2 of 3 (view + log, cannot change yet)", (await access(page, "Daily Operation Report")).custom === "Custom: 2 of 3");
  check("staff My Workspace = Full access (no Custom)", (await access(page, "My Workspace / Quotation")).on === "Full access");
  check("staff Settings 0 of 13 pages", (await dialogText(page)).includes("0 of 13 pages"));
  // 照某人复制，取消不保存
  await page.evaluate(() => {
    const s = document.querySelector('[role="dialog"] select');
    s.value = [...s.options].find((o) => o.text.startsWith("Grace Liu")).value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  check("copy list shows module counts", await page.evaluate(() => [...document.querySelector('[role="dialog"] select').options].some((o) => o.text === "Grace Liu (21 modules)")));
  await click(page, "Copy", "dialog");
  await waitText(page, "Copied access for 21 modules from Grace Liu");
  check("copy fills Grace's levels, says nothing saved", (await access(page, "Logs")).on === "Read & edit" && (await dialogText(page)).includes("Nothing is saved until you click Save"));
  check("copy did not change duties / teams", (await dialogText(page)).includes("0 duties · 1 teams"));
  const putsBefore = (await ctl("log=1")).filter((l) => l.startsWith("PUT")).length;
  await click(page, "Cancel", "dialog");
  await waitNoText(page, "Copy access from");
  const putsAfter = (await ctl("log=1")).filter((l) => l.startsWith("PUT")).length;
  check("cancel after copy: nothing saved", putsAfter === putsBefore && (await rowText(page, "@ben")).includes("2 custom"));
  // 复制 Super Admin = 全部
  await click(page, "Edit", "@ben");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  await page.evaluate(() => {
    const s = document.querySelector('[role="dialog"] select');
    s.value = [...s.options].find((o) => o.text.startsWith("Annie")).value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(page, "Copy", "dialog");
  await waitText(page, "Copied access for 21 modules from Annie");
  check("copy from Super Admin = everything", (await dialogText(page)).includes("13 of 13 pages"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Copy access from");

  // ── 保存出错留在弹窗 ──
  await click(page, "Edit", "@chloe");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  await ctl("team500=1");
  await click(page, "Save", "dialog");
  await waitText(page, "Internal Server Error");
  check("save error shown in the dialog, dialog stays", (await dialogText(page)).includes("Internal Server Error"));
  await ctl("team500=0");
  await click(page, "Cancel", "dialog");
  await waitNoText(page, "Copy access from");

  // ── 部门邮箱 ──
  await click(page, "Edit duties", "reservations@");
  await waitText(page, "Reservations mailbox");
  d = await dialogText(page);
  check("mailbox dialog: duties only", d.includes("Notification duties") && !d.includes("Permissions") && !d.includes("Home page"));
  await tick(page, "Accidents & emergencies");
  await click(page, "Save", "dialog");
  await waitNoText(page, "Reservations mailbox");
  b = await lastBody("PUT /api/team/contacts/1/duties");
  check("mailbox PUT duties", b && JSON.stringify(b.duties) === '["complaints","accidents_emergencies"]', JSON.stringify(b));
  await waitText(page, "Complaints, Accidents");

  // ── 新增：发邀请（预填默认组 37）──
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  check("add: default set prefilled (19 modules, Tasks read only)", (await dialogText(page)).includes("19 modules") && (await access(page, "Tasks")).on === "Read only");
  check("add: submit says Create invite link", (await dialogText(page)).includes("Create invite link"));
  check("backend without account_type: no Account type section (page as before)", !(await dialogText(page)).includes("Account type"));
  await tick(page, "Quotations");
  await click(page, "Create invite link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  const link = await page.$eval('[role="dialog"] input[readonly]', (i) => i.value);
  check("invite link uses this site's own address", link === BASE + "/register/tptok29", link);
  b = await lastBody("POST /api/team/invites");
  check("invite POST carries ticks", b && b.items.length === 37 && JSON.stringify(b.duties) === '["quotations"]' && b.home_path === null);
  check("backend without account_type: invite body has no account_type", b && !("account_type" in b), JSON.stringify(b && Object.keys(b)));
  await click(page, "Done", "dialog");
  await waitNoText(page, "Share this link");
  // 保存后整表重拉（含每个人的详情），等新的待注册行出来。
  await page.waitForFunction(() => [...document.querySelectorAll("tbody tr")].filter((r) => r.innerText.includes("Pending registration")).length === 3, { timeout: 15000 }).catch(() => {});
  const pend2 = await page.$$eval("tbody tr", (rows) => rows.filter((r) => r.innerText.includes("Pending registration")).length);
  check("new pending row in the list", pend2 === 3, `got ${pend2}`);

  // ── 新增：直接建号 ──
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.innerText.includes("Create the account now"));
    lab.querySelector("input").click();
  });
  await waitText(page, "Display name (optional)");
  await fill(page, "Username", "ben");
  await fill(page, "Password", "secret1");
  await click(page, "Create account", "dialog");
  await waitText(page, "That username is already taken");
  check("duplicate username: backend reason shown, dialog stays", (await dialogText(page)).includes("That username is already taken"));
  await fill(page, "Username", "zz.test.new");
  await fill(page, "Display name (optional)", "ZZ Test New");
  await click(page, "Create account", "dialog");
  await waitNoText(page, "How will they sign in?");
  b = await lastBody("POST /api/team/members");
  check("create POST body", b && b.username === "zz.test.new" && b.password === "secret1" && b.display_name === "ZZ Test New" && b.initials === "" && b.email === null && b.items.length === 37 && !("account_type" in b), JSON.stringify(b && { ...b, items: b.items.length }));
  await waitText(page, "ZZ Test New");

  // ── 后端没带 default_items / home_path（G184 前的形状）：不崩、不预勾、首页列空 ──
  await ctl("reset=1&nodefault=1&nohome=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  // G184 起首页只读列表的 home_path，不再从每人详情补（详情只给 Access 列用）。
  const homeCell = (who) => page.$$eval("tbody tr", (rows, who) => [...rows].find((r) => r.innerText.includes(who)).cells[6].innerText.trim(), who);
  const homes = [await homeCell("@ben"), await homeCell("@kevin"), await homeCell("@annie")];
  check("no home_path in list → Home column empty, not filled from each person's detail", homes.every((h) => h === ""), JSON.stringify(homes));
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  d = await dialogText(page);
  check("no default_items → nothing prefilled + hint", d.includes("0 modules") && d.includes("The default staff set is not available yet"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "How will they sign in?");
  await click(page, "Edit", "@kevin");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  check("edit still reads home from detail", await page.$eval('select[aria-label="Home page"]', (s) => s.value === "/dispatch"));
  check("backend without account_type: Edit has no Account type line", !(await dialogText(page)).includes("Account type"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Copy access from");

  // ── 账号类型（Annie 2026-10-26「账号类型按建议，动手」，1–5 题都选 A）：后端列表带 account_type 才出现 ──
  check("backend without account_type: no Partner tag on the list", !(await page.$eval("tbody", (b) => b.innerText)).includes("Partner"));
  await ctl("reset=1&acctype=1&staffonly=1"); // 后端 d7 已上线：catalog 带 staff_only、存外部账号时去掉发送项
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "CCL Transportation", 60000);
  const ccl = await rowText(page, "@ccl");
  const tagColor = await page.evaluate(() => { const tag = [...document.querySelectorAll("tbody span")].find((x) => x.innerText.trim() === "Partner"); return tag ? getComputedStyle(tag).color : null; });
  check("partner row: Partner tag next to the name (orange, not blue); staff rows have none",
    ccl.includes("CCL Transportation") && ccl.includes("Partner") && !(await rowText(page, "@ben")).includes("Partner") && tagColor === "rgb(154, 52, 18)", ccl + " / " + tagColor);
  // partner 不选首页（Annie 2026-10-27 Q7 A）：列表里 partner 那一行的 Home page 格子空着。
  const cclHome = await page.evaluate(() => { const tr = [...document.querySelectorAll("tbody tr")].find((t) => t.innerText.includes("@ccl")); return tr ? tr.querySelectorAll("td")[6].innerText.trim() : null; });
  check("partner row: Home page cell is empty", cclHome === "", JSON.stringify(cclHome));
  const pickRadio = (label) => page.evaluate((label) => {
    const lab = [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.innerText.trim() === label);
    lab.querySelector("input").click();
  }, label);
  const homeValue = () => page.$eval('[role="dialog"] select[aria-label="Home page"]', (x) => x.value);
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  d = await dialogText(page);
  const staffChecked = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.innerText.trim() === "Staff").querySelector("input").checked);
  check("add: Account type is the first section, Staff by default, staff default set",
    d.indexOf("Account type") >= 0 && d.indexOf("Account type") < d.indexOf("How will they sign in?") && d.includes("A normal back-office account") && d.includes("19 modules") && staffChecked);
  await pickRadio("External partner");
  await waitText(page, "they can open only the pages ticked below");
  d = await dialogText(page);
  check("partner: ticks start empty, orange note, duties and teams say Not for external partners",
    /\b0 modules\b/.test(d) && (d.match(/Not for external partners/g) || []).length === 2 && d.includes("New external partner account"));
  check("partner: duties block greyed out, disabled, nothing ticked", await page.evaluate(() => { const f = document.querySelector('[role="dialog"] fieldset[aria-label="Notification duties"]'); return !!f && f.disabled && [...f.querySelectorAll('input')].every((i) => !i.checked) && Number(getComputedStyle(f).opacity) < 1; }));
  check("partner note: asked to change the password on first sign-in", d.includes("They'll be asked to change the password on first sign-in."));
  check("partner: no Home page section (home is fixed to the partner home)", !(await page.$('[role="dialog"] select[aria-label="Home page"]')) && !d.includes("The page they see after signing in"));
  await pickRadio("Staff");
  await waitText(page, "A normal back-office account");
  check("back to Staff: default set and duties come back", (await dialogText(page)).includes("19 modules") && (await dialogText(page)).includes("Guest messages") && (await homeValue()) === "");
  await pickRadio("External partner");
  await waitText(page, "they can open only the pages ticked below");
  await page.evaluate(() => {
    const sel = document.querySelector('[role="dialog"] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "29");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(page, "Copy", "dialog");
  await waitText(page, "Copied access");
  check("partner: Copy access from someone fills their ticks (CCL: 30 Days Forecast read only)", (await access(page, "30 Days Forecast")).on === "Read only" && (await dialogText(page)).includes("from CCL Transportation"));
  await click(page, "Create invite link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  b = await lastBody("POST /api/team/invites");
  check("partner invite body: account_type partner, copied ticks, no duties key at all, no teams, home /dashboard (partner home)",
    b && b.account_type === "partner" && JSON.stringify(b.items) === '["forecast.view"]' && !("duties" in b) && b.team_ids.length === 0 && b.home_path === "/dashboard", JSON.stringify(b));
  await click(page, "Done", "dialog");
  await waitNoText(page, "Share this link");
  // ── partner 不能发送（Annie 2026-10-27「要我定的那3个全按推荐，动手吧」）Q2 A：从员工复制来的发送项照实显示 Custom + 黄条，保存时去掉 ──
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  await pickRadio("External partner");
  await waitText(page, "they can open only the pages ticked below");
  await page.evaluate(() => {
    const sel = document.querySelector('[role="dialog"] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "7");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(page, "Copy", "dialog");
  await waitText(page, "Copied access");
  d = await dialogText(page);
  const man = await access(page, "Manifests");
  check("no-send Q2: partner copied from staff Ben → Manifests shows Custom (send ticked), yellow line says it is removed when you save",
    man.custom !== null && man.on === null && await page.evaluate(() => { const y = document.querySelector('[role="dialog"] [data-send-ticked="manifests"]'); return !!y && y.innerText.includes("Send from Manifests is ticked, but partners can't send. It will be removed when you save."); }), JSON.stringify(man));
  check("no-send Q2: footer says how many send permissions will be removed", /\d+ send permissions will be removed when you save/.test(d), d.slice(-300));
  check("no-send: partner note says sending is for internal staff only; legend has Send: internal staff only",
    d.includes("Sending is for internal staff only: partners can't send") && d.includes("Send: internal staff only") && d.includes("can also change, publish, export and delete"));
  await click(page, "Create invite link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  b = await lastBody("POST /api/team/invites");
  check("no-send Q2: partner invite body has none of the send items (copied view / edit stay)",
    b && b.account_type === "partner" && !b.items.some((c) => ['dispatch.send','manifests.send','tour.send','morning.send','tickets.send','broadcast.send','messages.reply'].includes(c)) && b.items.includes("manifests.view") && b.items.includes("manifests.edit"), JSON.stringify(b && b.items));
  await click(page, "Done", "dialog");
  await waitNoText(page, "Share this link");
  // 后端支持时，新增 Staff 也带 account_type。
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  await click(page, "Create invite link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  b = await lastBody("POST /api/team/invites");
  check("staff invite body: account_type staff", b && b.account_type === "staff" && b.items.length === 37, JSON.stringify(b && Object.keys(b)));
  await click(page, "Done", "dialog");
  await waitNoText(page, "Share this link");
  // 已有账号：抬头写类型，Change… 二次确认 → PUT /api/team/members/{id}/account-type（后端 8a）。
  check("Super Admin row: no Partner tag even with account_type on", !(await rowText(page, "@annie")).includes("Partner"));
  const lastDialog = () => page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"]')];
    const c = ds[ds.length - 1];
    const btn = [...c.querySelectorAll("button")].find((x) => /^Change to (staff|partner)$/.test(x.innerText.trim()));
    return { n: ds.length, text: c.innerText, disabled: btn ? btn.disabled : null, bg: btn ? getComputedStyle(btn).backgroundColor : null };
  });
  const confirmChange = () => page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"]')];
    [...ds[ds.length - 1].querySelectorAll("button")].find((x) => /^Change to (staff|partner)$/.test(x.innerText.trim())).click();
  });
  await click(page, "Edit", "@ccl");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  d = await dialogText(page);
  check("edit partner: header says Account type External partner + Change…; duties / teams hidden", d.includes("Account type:") && d.includes("External partner") && d.includes("Change…") && (d.match(/Not for external partners/g) || []).length === 2);
  check("edit partner: duties greyed out and disabled", await page.evaluate(() => { const f = document.querySelector('[role="dialog"] fieldset[aria-label="Notification duties"]'); return !!f && f.disabled && [...f.querySelectorAll('input')].every((i) => !i.checked) && Number(getComputedStyle(f).opacity) < 1; }));
  // 保存 partner：PUT 不带 duties（后端对 partner 的职责 400）。
  await click(page, "Save", "dialog");
  await waitNoText(page, "Copy access from");
  b = await lastBody("PUT /api/team/members/29");
  check("save partner: PUT body has no duties key, saved fine", b && !("duties" in b) && JSON.stringify(b.items) === '["forecast.view"]', JSON.stringify(b));
  // ── partner 不能发送 Q1 A：Read & edit 自动不含发送，灰字 Internal staff only；只有看 + 发送的模块只能 None / Read only ──
  await click(page, "Edit", "@ccl");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  await sleep(800);
  await choose(page, "Manifests", "Read & edit");
  check("no-send Q1: partner Manifests Read & edit → pressed, no Custom", (await access(page, "Manifests")).on === "Read & edit" && (await access(page, "Manifests")).custom === null, JSON.stringify(await access(page, "Manifests")));
  check("no-send Q1: grey line under Manifests: Internal staff only · Send from Manifests — not included in Read & edit for partners",
    await page.evaluate(() => { const l = document.querySelector('[role="dialog"] [data-staff-only="manifests"]'); return !!l && l.innerText.includes("Internal staff only") && l.innerText.includes("Send from Manifests") && l.innerText.includes("not included in Read & edit for partners"); }));
  const locked = await page.evaluate(() => ["Morning Pickup", "Guest messages", "Broadcast"].map((label) => {
    const g = document.querySelector(`[role="dialog"] [role="group"][aria-label="${label} access"]`);
    const b = g && [...g.querySelectorAll("button")].find((x) => /Read & edit|Full access/.test(x.innerText));
    const line = g && g.parentElement.parentElement.querySelector("[data-staff-only]");
    return !!b && b.disabled && b.title === "Internal staff only" && !!line && line.innerText.includes("partners can only look at this page");
  }));
  check("Team page: the Messages row is labelled Guest messages", !!(await access(page, "Guest messages")) && !(await access(page, "Messages")));
  check("no-send Q1: view + send only modules (Morning Pickup, Guest messages) and send-only Broadcast: Read & edit / Full access greyed out, Internal staff only", locked.every(Boolean), JSON.stringify(locked));
  await choose(page, "Morning Pickup", "Read only");
  check("no-send Q1: Morning Pickup Read only works for partner", (await access(page, "Morning Pickup")).on === "Read only");
  await page.evaluate(() => {
    const g = document.querySelector('[role="dialog"] [role="group"][aria-label="Manifests access"]');
    [...g.parentElement.parentElement.querySelectorAll("button")].find((x) => x.innerText.includes("what's included")).click();
  });
  const struck = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"] s')].some((x) => x.innerText === "Send from Manifests"));
  await waitFor(page, struck, 3000);
  check("no-send Q1: what's included strikes the send item", await struck());
  await click(page, "Save", "dialog");
  await waitNoText(page, "Copy access from");
  b = await lastBody("PUT /api/team/members/29");
  check("no-send Q1: save partner → Manifests view / edit / export saved, no manifests.send; Morning Pickup view only",
    b && b.items.includes("manifests.view") && b.items.includes("manifests.edit") && b.items.includes("manifests.export") && !b.items.includes("manifests.send") && b.items.includes("morning.view") && !b.items.includes("morning.send"), JSON.stringify(b && b.items));
  await click(page, "Edit", "@ccl");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  await click(page, "Change…", "dialog");
  await waitText(page, "Change CCL Transportation to Staff?");
  let conf = await lastDialog();
  check("Change… opens a confirm on top: says ticks stay and the old Admin / Supervisor role does not come back; amber button enabled",
    conf.n === 2 && !conf.text.includes("Not available yet") && conf.text.includes("not only the ticked pages") && conf.text.includes("Their ticks stay") && conf.text.includes("Send permissions are not added back") &&
    conf.text.includes("An earlier Admin or Supervisor role does not come back") && conf.disabled === false && conf.bg === "rgb(180, 83, 9)", JSON.stringify(conf));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Change CCL Transportation to Staff?");
  check("Escape closes only the confirm; the Edit dialog stays", (await page.$$('[role="dialog"]')).length === 1 && (await dialogText(page)).includes("Edit CCL Transportation"));
  // 后端报错：照原话写在确认框里，框不关。
  await ctl("typefail=1");
  await click(page, "Change…", "dialog");
  await waitText(page, "Change CCL Transportation to Staff?");
  await confirmChange();
  await waitText(page, "Member not found");
  conf = await lastDialog();
  check("switch fails → backend words in the confirm, confirm stays open", conf.n === 2 && conf.text.includes("Member not found") && conf.disabled === false, JSON.stringify(conf));
  await confirmChange();
  await waitNoText(page, "Change CCL Transportation to Staff?");
  b = await lastBody("PUT /api/team/members/29/account-type");
  check("confirm sends PUT account-type {account_type: staff}", b && JSON.stringify(b) === '{"account_type":"staff"}', JSON.stringify(b));
  check("no-send Q3: partner → staff does not add send back: Manifests is Custom (view / edit / export, no send) for staff now", (await access(page, "Manifests")).custom !== null, JSON.stringify(await access(page, "Manifests")));
  d = await dialogText(page);
  check("after switch: Edit dialog stays, header now Staff, duties / teams back, ticks unchanged",
    (await page.$$('[role="dialog"]')).length === 1 && /Account type:\s*Staff/.test(d) && !d.includes("Not for external partners") && (await access(page, "30 Days Forecast")).on === "Read only", d.slice(0, 200));
  await waitFor(page, async () => !(await rowText(page, "@ccl")).includes("Partner"), 10000);
  check("after switch: list row refreshed (no Partner tag)", !(await rowText(page, "@ccl")).includes("Partner"), await rowText(page, "@ccl"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Copy access from");
  await click(page, "Edit", "@ben");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  d = await dialogText(page);
  check("edit staff: Account type Staff, duties and teams shown as before", /Account type:\s*Staff/.test(d) && d.includes("Guest messages") && !d.includes("Not for external partners"));
  await click(page, "Change…", "dialog");
  await waitText(page, "to External partner?");
  conf = await lastDialog();
  check("edit staff: no Internal staff only lines, Read & edit includes send as before", !(await dialogText(page)).includes("Internal staff only") && (await access(page, "Manifests")).on === "Read & edit");
  check("staff → partner confirm: says even an Admin loses actions not linked to a tick", conf.text.includes("even for an Admin") && conf.text.includes("Their other ticks stay"), conf.text);
  const removing = await page.evaluate(() => [...document.querySelectorAll("[data-removing-send] li")].map((x) => x.innerText));
  check("no-send Q3: staff → partner confirm lists the send items that will be removed", conf.text.includes("Sending is for internal staff only. These will be removed:") && removing.includes("Send from Manifests") && removing.includes("Send from Dispatch") && removing.includes("Reply to Messages"), JSON.stringify(removing));
  await confirmChange();
  await waitNoText(page, "to External partner?");
  check("no-send Q3: the switch uses the items the backend returns (send ticks removed server-side): footer no longer says anything will be removed",
    !(await dialogText(page)).includes("will be removed when you save"), (await dialogText(page)).slice(-200));
  check("no-send Q3: dialog after switch: no yellow send lines, Manifests Read & edit (no send)", await page.evaluate(() => !document.querySelector('[role="dialog"] [data-send-ticked]')) && (await access(page, "Manifests")).on === "Read & edit");
  b = await lastBody("PUT /api/team/members/7/account-type");
  d = await dialogText(page);
  check("staff → partner: PUT partner, header now External partner, duties / teams say Not for external partners",
    b && b.account_type === "partner" && d.includes("External partner") && (d.match(/Not for external partners/g) || []).length === 2, JSON.stringify(b));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Copy access from");
  await waitFor(page, async () => (await rowText(page, "@ben")).includes("Partner"), 10000);
  check("list row for Ben now has the Partner tag", (await rowText(page, "@ben")).includes("Partner"));
  // 后端 d7：catalog 带 staff_only 时按标记走（reports.send_daily 不是 staff_only，partner 的 Reports 照常 Read & edit）。
  await click(page, "Edit", "@ben");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  await sleep(800);
  await choose(page, "Reports", "Read & edit");
  const rep = await access(page, "Reports");
  check("staff_only flag: partner Reports Read & edit includes the nightly Excel send (not staff_only), no Internal staff only line",
    rep.on === "Read & edit" && rep.custom === null && await page.evaluate(() => !document.querySelector('[role="dialog"] [data-staff-only="reports"]')) && await page.evaluate(() => !!document.querySelector('[role="dialog"] [data-staff-only="manifests"]')), JSON.stringify(rep));
  await click(page, "Save", "dialog");
  await waitNoText(page, "Copy access from");
  b = await lastBody("PUT /api/team/members/7 ");
  check("staff_only flag: save keeps reports.send_daily, drops manifests.send", b && b.items.includes("reports.send_daily") && !b.items.includes("manifests.send"), JSON.stringify(b && b.items));
  // catalog 没带 staff_only（d7 之前的后端）：退回 isSendCode（对外发送的 7 项，同后端），reports.send_daily 不算发送。
  await ctl("staffonly=0");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "@ben", 60000);
  await click(page, "Edit", "@ben");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  await sleep(800);
  const repOld = await access(page, "Reports");
  check("no staff_only in catalog → isSendCode (7 outward sends): Reports is not internal-only, no Custom / removed-on-save",
    repOld.custom === null && await page.evaluate(() => !document.querySelector('[role="dialog"] [data-staff-only="reports"]') && !document.querySelector('[role="dialog"] [data-send-ticked="reports"]')),
    JSON.stringify(repOld));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Copy access from");
  await ctl("staffonly=1");

  // ── 某个人的详情拿不到：只那一行 Access 写「—」，页面照常 ──
  await ctl("reset=1&detailfail=7");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  const benAccess = await page.$$eval("tbody tr", (rows) => [...rows].find((r) => r.innerText.includes("@ben")).cells[4].innerText.trim());
  check("one detail fails → that row shows —, others fine", benAccess === "—" && (await rowText(page, "@chloe")).includes("19 modules"), benAccess);

  // ── 非 Super Admin ──
  // 合并后 admin 也能进（同原来 Users 页）：不读 /api/team（后端只给 Super Admin），看不到 Super Admin 的行（Annie Qa）。
  await ctl("reset=1&viewer=admin");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  const teamCalls = (await ctl("log=1")).filter((l) => l.includes("/api/team/")).length;
  check("admin: page opens, Team API never called", teamCalls === 0, `got ${teamCalls}`);
  t = await text(page);
  check("admin: no Super Admin row, no Access / duties / Home columns, no Edit, no mailbox", !t.includes("@annie") && !t.includes("Notification duties") && !/\bEdit\b/.test(t) && !t.includes("Department mailbox"));
  check("admin: staff row keeps Reset password / ✏️ Name / Deactivate", /Reset password[\s\S]*✏️ Name[\s\S]*Deactivate/.test(await rowText(page, "@ben")));
  await page.click('button[aria-label="Open menu"]');
  const adminTeamLink = await page.waitForSelector('a[href="/settings/team"]', { timeout: 15000 }).catch(() => null);
  check("admin: sidebar shows Team, no Users link", adminTeamLink !== null && (await page.$('a[href="/settings/users"]')) === null);
  await page.click('button[aria-label="Close menu"]').catch(() => {});
  // Super Admin、/api/team 出错：名单和 Users 的操作照常，表上方写一句（不整页报错）。
  await ctl("reset=1&team403=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Could not load permissions", 60000);
  check("backend 403 on /api/team → list still shown + message", (await text(page)).includes("Grace Liu"));
  await ctl("reset=1&team500=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Could not load permissions", 60000);
  check("backend 500 on /api/team → message + Retry, list still shown", (await text(page)).includes("Retry") && (await text(page)).includes("Grace Liu"));

  // ── 彻底删除（Edit 框最下面，Annie 2026-10-28）──
  await ctl("reset=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  await click(page, "Edit", "@zz.test");
  await page.waitForSelector("[data-delete-person]");
  check("Delete is in the Edit box, bottom left, red (not blue)", await page.evaluate(() => {
    const b = document.querySelector("[data-delete-person]");
    const save = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.innerText.trim() === "Save");
    const c = getComputedStyle(b).color;
    return b.innerText.trim() === "Delete" && c === "rgb(185, 28, 28)" && !!save && b.getBoundingClientRect().left < save.getBoundingClientRect().left;
  }));
  await page.click("[data-delete-person]");
  await page.waitForSelector("[data-delete-person-confirm]");
  check("confirm (G212): Delete ZZ Test Staff permanently? + This can't be undone. + Yes / Cancel, no username to type", await page.evaluate(() => {
    const d = document.querySelector("[data-delete-person-confirm]");
    const labels = [...d.querySelectorAll("button")].map((b) => b.innerText.trim());
    return d.querySelector("h2").innerText.trim() === "Delete ZZ Test Staff permanently?" && !d.innerText.includes("Delete this person?") && d.innerText.includes("This can't be undone.") && labels.includes("Yes") && labels.includes("Cancel") && !d.querySelector("input");
  }));
  await click(page, "Cancel", "dialog");
  await page.waitForSelector("[data-delete-person]");
  check("Cancel goes back to the Edit box, nothing deleted", (await ctl("log=1")).every((l) => !l.startsWith("DELETE")));
  // 删不掉的其他几种（G212 后端原话）：原样显示、Yes 灰掉、不给 Deactivate instead；Cancel 回 Edit 框再试下一种。
  for (const [mode, words] of [
    ["super", "Cannot delete a superadmin account"],
    ["self", "Cannot delete yourself"],
    ["403", "Superadmin access required"],
    ["404", "User not found"],
  ]) {
    await ctl("delfail=" + mode);
    await page.click("[data-delete-person]");
    await page.waitForSelector("[data-delete-person-confirm]");
    await click(page, "Yes", "dialog");
    await waitText(page, words);
    check(`delete ${mode}: "${words}" shown as is, Yes greyed out, no Deactivate instead, box stays`, await page.evaluate(() => {
      const d = document.querySelector("[data-delete-person-confirm]");
      if (!d) return false;
      const yes = [...d.querySelectorAll("button")].find((b) => b.innerText.trim() === "Yes");
      return d.innerText.includes("Could not delete.") && yes.disabled && ![...d.querySelectorAll("button")].some((b) => b.innerText.trim() === "Deactivate instead");
    }));
    await click(page, "Cancel", "dialog");
    await page.waitForSelector("[data-delete-person]");
  }
  // 还连着 Dispatch / 任务记录：后端原话 + Deactivate instead
  await ctl("delfail=linked");
  await page.click("[data-delete-person]");
  await page.waitForSelector("[data-delete-person-confirm]");
  await click(page, "Yes", "dialog");
  await waitText(page, "still linked to dispatch or task records");
  check("delete blocked (still linked): backend words shown as they are, Yes greyed out, Deactivate instead offered", await page.evaluate(() => {
    const d = document.querySelector("[data-delete-person-confirm]");
    const yes = [...d.querySelectorAll("button")].find((b) => b.innerText.trim() === "Yes");
    return d.innerText.includes("Could not delete.") && d.innerText.includes("This account is still linked to dispatch or task records, so it cannot be deleted. Deactivate it instead.") && yes.disabled && [...d.querySelectorAll("button")].some((b) => b.innerText.trim() === "Deactivate instead");
  }));
  await click(page, "Deactivate instead", "dialog");
  await waitText(page, "ZZ Test Staff was deactivated.");
  await page.waitForFunction(() => [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes("@zz.test"))?.innerText.includes("Inactive"), { timeout: 15000 }).catch(() => {});
  check("Deactivate instead: box closes, row now Inactive", !(await page.$("[data-delete-person-confirm]")) && (await rowText(page, "@zz.test")).includes("Inactive"));
  await ctl("delfail=0");
  await click(page, "Edit", "@zz.test");
  await page.waitForSelector("[data-delete-person]");
  await page.click("[data-delete-person]");
  await page.waitForSelector("[data-delete-person-confirm]");
  await click(page, "Yes", "dialog");
  await waitText(page, "ZZ Test Staff was deleted.");
  await page.waitForFunction(() => ![...document.querySelectorAll("tbody tr")].some((r) => r.innerText.includes("@zz.test")), { timeout: 15000 }).catch(() => {});
  const delReqs = (await ctl("log=1")).filter((l) => l.startsWith("DELETE"));
  check("Yes deletes: DELETE /api/users/{id} with no body, both boxes close, row gone", delReqs.filter((l) => l.startsWith("DELETE /api/users/26")).length === 6 && delReqs.every((l) => l.trim() === l.split(" ").slice(0, 2).join(" ")) && !(await page.$('[role="dialog"]')) && (await rowText(page, "@zz.test")) === null, JSON.stringify(delReqs));
  await click(page, "Edit", "@grace");
  await page.waitForSelector('[role="group"][aria-label="Logs access"]');
  check("Edit on another account has Delete", !!(await page.$("[data-delete-person]")));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Copy access from");

  // ── Users 页 ──
  await ctl("reset=1");
  await page.goto(BASE + "/settings/users", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => location.pathname === "/settings/team", { timeout: 30000 }).catch(() => {});
  check("/settings/users goes to /settings/team", await page.evaluate(() => location.pathname === "/settings/team"));
  await waitText(page, "Grace Liu", 60000);
  check("how-to: role change keeps the ticks", await page.$eval("details", (d) => d.textContent.includes("Changing the role does not change the permissions ticked under Edit")));
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  check("Super Admin Add person → permission form", (await dialogText(page)).includes("Copy access from") && (await dialogText(page)).includes("19 modules"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "How will they sign in?");
  await ctl("team500=1");
  await click(page, "+ Add person");
  await waitText(page, "Use the basic invite");
  await click(page, "Use the basic invite", "dialog");
  await waitText(page, "Generate Invite Link");
  check("fallback to the basic invite", (await dialogText(page)).includes("New staff get the default staff permissions"));
  await page.keyboard.press("Escape");
  await ctl("team500=0");
  // 改角色确认框
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes("Kevin Ho"));
    const s = tr.querySelector("select");
    s.value = "staff";
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector('[role="dialog"]');
  check("role confirm says the ticks stay", (await dialogText(page)).includes("Their permissions ticked under Edit stay as they are."));
  const roleOptions = await page.$$eval('tbody select[aria-label^="Role for"] option', (o) => o.map((x) => x.value));
  check("role dropdown never offers Super Admin", !roleOptions.includes("superadmin"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "stay as they are");
  // 改成外勤角色：只有原来的警告，不写「勾选不变」那句。
  await page.evaluate(() => {
    const s = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes("Kevin Ho")).querySelector("select");
    s.value = "driver";
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector('[role="dialog"]');
  check("field role confirm: warning only", (await dialogText(page)).includes("LOSE access") && !(await dialogText(page)).includes("stay as they are"));
  await page.keyboard.press("Escape");
  // Admin 看 Invite Staff：原来的弹窗 + 说明
  await ctl("viewer=admin");
  const logStart = (await ctl("log=1")).length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  await click(page, "+ Add person");
  await waitText(page, "Generate Invite Link");
  check("admin Invite Staff: basic dialog + default note", (await dialogText(page)).includes("New staff get the default staff permissions"));
  const teamCalls2 = (await ctl("log=1")).slice(logStart).filter((l) => l.includes("/api/team/")).length;
  check("admin Invite Staff never calls Team API", teamCalls2 === 0, `got ${teamCalls2}`);

  // ── Columns（10-28 合并 preview v3「动手」那批；后端 92 的 team_list_layout，同 HR 的 hr_list_layout）──
  {
    const heads = () => page.$$eval("th[data-team-col]", (ths) => ths.map((t) => t.dataset.teamCol));
    const savedLayout = async () => {
      const v = (await ctl("teamlayout=get")).value;
      return v ? JSON.parse(v) : null;
    };
    const dragHead = (from, to) =>
      page.evaluate(
        async (from, to) => {
          const src = document.querySelector(`th[data-team-col="${from}"]`);
          const dst = document.querySelector(`th[data-team-col="${to}"]`);
          const dt = new DataTransfer();
          const r = dst.getBoundingClientRect();
          src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
          await new Promise((res) => setTimeout(res, 50));
          dst.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 2 }));
          await new Promise((res) => setTimeout(res, 50));
          dst.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 2 }));
          src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
        },
        from,
        to,
      );
    const DEFAULT = ["person", "role", "status", "teams", "access", "duties", "home"];
    await ctl("reset=1");
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("npe.team_list_layout"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitText(page, "Grace Liu", 60000);
    await page.waitForSelector("th[data-team-col]");
    check("Columns: default order Person / Role / Status / Teams / Access / Notification duties / Home page", JSON.stringify(await heads()) === JSON.stringify(DEFAULT), JSON.stringify(await heads()));
    check(
      "Columns: note says saved to your account; Reset columns is a plain button (not blue)",
      await page.evaluate(() => {
        const n = document.querySelector("[data-team-columns-note]");
        const b = document.querySelector("[data-team-columns-reset]");
        return !!n && n.textContent.includes("saved to your account.") && !!b && getComputedStyle(b).backgroundColor !== "rgb(59, 130, 246)";
      }),
    );
    // 拖表头：Status 拖到 Person 前面
    await dragHead("status", "person");
    await waitFor(page, async () => (await savedLayout())?.order?.[0] === "status");
    const afterDrag = await savedLayout();
    check("drag Status onto Person: saved order starts with status (PUT team_list_layout {value: JSON string})", afterDrag?.order?.join(",") === "status,person,role,teams,access,duties,home", JSON.stringify(afterDrag));
    check("drag: headers and cells move together (first cell of Grace's row is her Status)", JSON.stringify((await heads()).slice(0, 2)) === '["status","person"]' && (await page.evaluate(() => [...document.querySelectorAll("tr")].find((r) => r.innerText.includes("Grace Liu")).cells[0].innerText.includes("Active"))));
    // 改宽：拖 Teams 右边 +80px
    const before = await page.$eval('th[data-team-col="teams"]', (t) => t.getBoundingClientRect().width);
    await page.evaluate(async () => {
      const h = document.querySelector('[data-resizer="teams"]');
      const r = h.getBoundingClientRect();
      h.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.left, clientY: r.top }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + 80, clientY: r.top }));
      await new Promise((res) => setTimeout(res, 50));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.left + 80, clientY: r.top }));
    });
    await waitFor(page, async () => (await savedLayout())?.widths?.teams > 0);
    const afterResize = await savedLayout();
    check("drag the Teams edge: width saved (about 80px wider)", Math.abs((afterResize?.widths?.teams ?? 0) - (before + 80)) <= 12 && afterResize.order[0] === "status", `${before} → ${JSON.stringify(afterResize)}`);
    // 重开还在（清掉本机缓存，确定是从账号读回来的）
    await page.evaluate(() => localStorage.removeItem("npe.team_list_layout"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitText(page, "Grace Liu", 60000);
    await waitFor(page, async () => (await heads())[0] === "status");
    check(
      "reopen: order and width come back from the account",
      (await heads())[0] === "status" && (await page.$eval('col[data-col="teams"]', (c) => parseInt(c.style.width, 10))) === afterResize.widths.teams,
      JSON.stringify(await heads()),
    );
    // Reset columns
    await page.click("[data-team-columns-reset]");
    await waitFor(page, async () => (await savedLayout())?.order?.[0] === "person");
    check("Reset columns: default order, no widths, saved", JSON.stringify(await heads()) === JSON.stringify(DEFAULT) && JSON.stringify((await savedLayout())?.widths) === "{}");
    // admin（不是 Super Admin）：没有那三列，存的顺序照用
    await dragHead("teams", "person");
    await waitFor(page, async () => (await savedLayout())?.order?.[0] === "teams");
    await ctl("viewer=admin");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitText(page, "Grace Liu", 60000);
    await waitFor(page, async () => (await heads())[0] === "teams");
    check("admin: no Access / duties / Home page columns, saved order still used", JSON.stringify(await heads()) === '["teams","person","role","status"]', JSON.stringify(await heads()));
    // 后端还没认这个键（404）：存在本机，写 saved in this browser.
    await ctl("reset=1&teamlayout404=1");
    await page.evaluate(() => localStorage.removeItem("npe.team_list_layout"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitText(page, "Grace Liu", 60000);
    await waitFor(page, async () => (await page.$eval("[data-team-columns-note]", (n) => n.textContent)).includes("saved in this browser."));
    await dragHead("role", "person");
    await sleep(400);
    check(
      "backend without team_list_layout (404): note says saved in this browser, order kept in this browser",
      (await page.$eval("[data-team-columns-note]", (n) => n.textContent)).includes("saved in this browser.") &&
        (await page.evaluate(() => JSON.parse(localStorage.getItem("npe.team_list_layout") || "{}").order?.[0])) === "role",
    );
    // partner：Team 页打不开，也就没有 Columns
    await ctl("reset=1&viewer=partner");
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await sleep(2500);
    check("partner: no Columns (no Reset columns, no draggable titles)", !(await page.$("[data-team-columns-reset]")) && !(await page.$('th[data-team-col][draggable="true"]')));
    await ctl("reset=1");
    await page.evaluate(() => localStorage.removeItem("npe.team_list_layout"));
  }

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
