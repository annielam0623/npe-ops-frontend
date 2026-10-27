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
  check("no role column / word on the page", !/\bRole\b/.test(t));
  const annie = await rowText(page, "@annie");
  check("Super Admin row: All + locked, no Edit", annie.includes("All") && annie.includes("Cannot be edited") && !/\bEdit\b/.test(annie), annie);
  check("staff row: 19 modules, 2 read only, 2 custom", /19 modules[\s\S]*2 read only[\s\S]*2 custom/.test(await rowText(page, "@ben")), await rowText(page, "@ben"));
  check("admin row: 21 modules, no custom; duties by name", (await rowText(page, "@grace")).includes("21 modules") && !(await rowText(page, "@grace")).includes("custom") && (await rowText(page, "@grace")).includes("Complaints, Refunds"));
  check("supervisor row: 21 modules, 1 custom (Logs)", (await rowText(page, "@daniel")).includes("21 modules") && (await rowText(page, "@daniel")).includes("1 custom"));
  check("Super Admin row: All modules", annie.includes("All modules"));
  check("home page label shown", (await rowText(page, "@ben")).includes("Morning Pickup · Tracking") && (await rowText(page, "@kevin")).includes("Dispatch"));
  check("deactivated row says Cannot sign in", (await rowText(page, "@uma")).includes("Cannot sign in"));
  const pend = await page.$$eval("tbody tr", (rows) => rows.filter((r) => r.innerText.includes("Pending registration")).length);
  check("two pending invite rows", pend === 2, `got ${pend}`);
  const mail = await rowText(page, "reservations@");
  check("mailbox row: Department mailbox + Edit duties only", mail.includes("Department mailbox") && mail.includes("Edit duties") && mail.includes("Complaints"));
  check("How to use is folded", await page.$eval("details", (d) => !d.open && d.innerText.includes("How to use — Team")));
  check("Add person button is the green one (not blue)", await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("Add person"));
    return getComputedStyle(b).backgroundImage.includes("linear-gradient");
  }));
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
  await tick(page, "Quotations");
  await click(page, "Create invite link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  const link = await page.$eval('[role="dialog"] input[readonly]', (i) => i.value);
  check("invite link uses this site's own address", link === BASE + "/register/tptok29", link);
  b = await lastBody("POST /api/team/invites");
  check("invite POST carries ticks", b && b.items.length === 37 && JSON.stringify(b.duties) === '["quotations"]' && b.home_path === null);
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
  check("create POST body", b && b.username === "zz.test.new" && b.password === "secret1" && b.display_name === "ZZ Test New" && b.initials === "" && b.email === null && b.items.length === 37, JSON.stringify(b && { ...b, items: b.items.length }));
  await waitText(page, "ZZ Test New");

  // ── 后端没带 default_items / home_path（G184 前的形状）：不崩、不预勾、首页列空 ──
  await ctl("reset=1&nodefault=1&nohome=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  // G184 起首页只读列表的 home_path，不再从每人详情补（详情只给 Access 列用）。
  const homeCell = (who) => page.$$eval("tbody tr", (rows, who) => [...rows].find((r) => r.innerText.includes(who)).cells[5].innerText.trim(), who);
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
  await page.keyboard.press("Escape");
  await waitNoText(page, "Copy access from");

  // ── 某个人的详情拿不到：只那一行 Access 写「—」，页面照常 ──
  await ctl("reset=1&detailfail=7");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  const benAccess = await page.$$eval("tbody tr", (rows) => [...rows].find((r) => r.innerText.includes("@ben")).cells[3].innerText.trim());
  check("one detail fails → that row shows —, others fine", benAccess === "—" && (await rowText(page, "@chloe")).includes("19 modules"), benAccess);

  // ── 非 Super Admin ──
  await ctl("reset=1&viewer=admin");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Super Admin access required", 60000);
  const teamCalls = (await ctl("log=1")).filter((l) => l.includes("/api/team/")).length;
  check("admin: forbidden, Team API never called", teamCalls === 0, `got ${teamCalls}`);
  await page.click('button[aria-label="Open menu"]');
  await page.waitForSelector('a[href="/settings/users"]', { timeout: 15000 });
  check("admin: sidebar shows Users but no Team link", (await page.$('a[href="/settings/team"]')) === null);
  await page.click('button[aria-label="Close menu"]').catch(() => {});
  await ctl("reset=1&team403=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Super Admin access required", 60000);
  check("backend 403 → forbidden panel", true);
  await ctl("reset=1&team500=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Failed to load the team", 60000);
  check("backend 500 → error + Retry", (await text(page)).includes("Retry"));

  // ── Users 页 ──
  await ctl("reset=1");
  await page.goto(BASE + "/settings/users", { waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  check("Users how-to: role change keeps the Team ticks", (await text(page)).includes("Changing the role does not change the permissions ticked in Settings › Team"));
  await click(page, "+ Invite Staff");
  await waitText(page, "How will they sign in?");
  check("Super Admin Invite Staff → Add person form", (await dialogText(page)).includes("Copy access from") && (await dialogText(page)).includes("19 modules"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "How will they sign in?");
  await ctl("team500=1");
  await click(page, "+ Invite Staff");
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
  check("role confirm says Team ticks stay", (await dialogText(page)).includes("Their permissions ticked in Settings › Team stay as they are."));
  const roleOptions = await page.$$eval("tbody select option", (o) => o.map((x) => x.value));
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
  await click(page, "+ Invite Staff");
  await waitText(page, "Generate Invite Link");
  check("admin Invite Staff: basic dialog + default note", (await dialogText(page)).includes("New staff get the default staff permissions"));
  const teamCalls2 = (await ctl("log=1")).slice(logStart).filter((l) => l.includes("/api/team/")).length;
  check("admin Invite Staff never calls Team API", teamCalls2 === 0, `got ${teamCalls2}`);

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
