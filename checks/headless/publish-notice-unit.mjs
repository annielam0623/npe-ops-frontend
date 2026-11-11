// 单元检查：排班发布后的提示「谁没收到」（components/schedule/publish-notice.ts，Annie 2026-10-30 置顶 15）。
// 置顶 109 W4 第二段（后端 f30d895a）：没联系方式（no_contact）灰字、不算失败；发失败（failed）红字；旧后端只有 not_reached 时按 reason 拆。
// node checks/headless/publish-notice-unit.mjs
import { publishNotice } from "../../components/schedule/publish-notice.ts";

const ppl = (...names) => names.map((name, i) => ({ employee_id: i + 1, name, channels: ["email"] }));
const miss = (...pairs) => pairs.map(([name, reason], i) => ({ employee_id: 100 + i, name, reason }));
const nc = (...names) => names.map((name, i) => ({ employee_id: 200 + i, name, why: "No email or login" }));
const fl = (...names) => names.map((name, i) => ({ employee_id: 300 + i, name, reason: "email could not be sent" }));
const NO = "no email or login";
const FAIL = "email could not be sent";
const want = (ok, unreached = null, noContact = null, allFailed = false) => ({ ok, unreached, noContact, allFailed });
const cases = [
  ["都收到（照旧）", { notified: ppl("A", "B", "C", "D", "E", "F") }, want("Published. Notified 6 people.")],
  ["都收到、后端还没上（没有 not_reached）", { notified: ppl("A") }, want("Published. Notified 1 person.")],
  ["新后端：都收到（no_contact / failed 都空）", { notified: ppl("A"), no_contact: [], failed: [], not_reached: [] }, want("Published. Notified 1 person.")],
  [
    "新后端：没联系方式 = 灰字，不进红字",
    { notified: ppl("A", "B", "C", "D"), no_contact: nc("Jing", "Anita"), failed: [], not_reached: miss(["Jing", NO], ["Anita", NO]) },
    want("Published. Notified 4 people.", null, "No email or login: Jing, Anita."),
  ],
  [
    "新后端：两种都有，红字只列发失败的、灰字列没联系方式的",
    { notified: ppl("A", "B"), no_contact: nc("Jing", "Anita"), failed: fl("Nadia"), not_reached: miss(["Nadia", FAIL], ["Jing", NO], ["Anita", NO]) },
    want("Published. Notified 2 people.", "1 couldn't be reached: Nadia (email could not be sent).", "No email or login: Jing, Anita."),
  ],
  [
    "新后端优先：not_reached 写的不一样时不看它",
    { notified: ppl("A"), no_contact: [], failed: fl("Nadia"), not_reached: miss(["Nadia", NO]) },
    want("Published. Notified 1 person.", "1 couldn't be reached: Nadia (email could not be sent)."),
  ],
  [
    "旧后端：not_reached 按 reason 拆，没联系方式灰字",
    { notified: ppl("A", "B"), not_reached: miss(["Jing", NO], ["Nadia", FAIL], ["Anita", NO]) },
    want("Published. Notified 2 people.", "1 couldn't be reached: Nadia (email could not be sent).", "No email or login: Jing, Anita."),
  ],
  [
    "都没收到（Annie 同意的原文，照旧整句红框）",
    { notified: [], no_contact: nc("Nadia", "Veronica"), failed: [] },
    want("", "Published, but no one was notified: Nadia, Veronica have no email or login. Add their email in Employees.", null, true),
  ],
  [
    "都没收到、一个人（旧后端）",
    { notified: [], not_reached: miss(["Nadia", NO]) },
    want("", "Published, but no one was notified: Nadia has no email or login. Add their email in Employees.", null, true),
  ],
  [
    "都没收到、只有发信失败（不写 Add their email）",
    { notified: [], no_contact: [], failed: fl("Nadia") },
    want("", "Published, but no one was notified: Nadia: email could not be sent.", null, true),
  ],
  [
    "都没收到、两种混着",
    { notified: [], no_contact: nc("Jing"), failed: fl("Nadia") },
    want("", "Published, but no one was notified: Nadia: email could not be sent; Jing has no email or login. Add their email in Employees.", null, true),
  ],
  [
    "Publish again：有人没联系方式，后面接 schedule editors",
    { republished: true, notified: ppl("A"), notified_supervisors: [{ user_id: 1, name: "S", channels: [] }, { user_id: 2, name: "T", channels: [] }], no_contact: nc("Jing"), failed: [] },
    want("Published again. Notified 1 staff member and 2 schedule editors.", null, "No email or login: Jing."),
  ],
  [
    "Publish again：员工发失败、主管收到了",
    { republished: true, notified: [], notified_supervisors: [{ user_id: 1, name: "S", channels: [] }], no_contact: [], failed: fl("Jing") },
    want("Published again. Notified 1 schedule editor.", "1 couldn't be reached: Jing (email could not be sent)."),
  ],
  [
    "Publish again：谁都没收到",
    { republished: true, notified: [], notified_supervisors: [], no_contact: nc("Jing"), failed: [] },
    want("", "Published again, but no one was notified: Jing has no email or login. Add their email in Employees.", null, true),
  ],
  [
    "Publish again：没人变（照旧）",
    { republished: true, notified: [], notified_supervisors: [], no_contact: [], failed: [] },
    want("Published again. No one's shifts or time off changed, so no one was notified."),
  ],
];
let bad = 0;
for (const [name, result, w] of cases) {
  const got = publishNotice({ status: "published", published_at: "", published_by: 1, ...result });
  const ok = JSON.stringify(got) === JSON.stringify(w);
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → ${JSON.stringify(got)}`}`);
}
console.log(`\n${cases.length - bad}/${cases.length} passed`);
process.exit(bad ? 1 : 0);
