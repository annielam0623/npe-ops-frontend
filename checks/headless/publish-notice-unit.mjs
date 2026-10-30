// 单元检查：排班发布后的提示「谁没收到」（components/schedule/publish-notice.ts，Annie 2026-10-30 置顶 15）。
// node checks/headless/publish-notice-unit.mjs
import { publishNotice } from "../../components/schedule/publish-notice.ts";

const ppl = (...names) => names.map((name, i) => ({ employee_id: i + 1, name, channels: ["email"] }));
const miss = (...pairs) => pairs.map(([name, reason], i) => ({ employee_id: 100 + i, name, reason }));
const NO = "no email or login";
const FAIL = "email could not be sent";
const cases = [
  ["都收到（照旧）", { notified: ppl("A", "B", "C", "D", "E", "F") }, { ok: "Published. Notified 6 people.", unreached: null, allFailed: false }],
  ["都收到、后端还没上（没有 not_reached）", { notified: ppl("A") }, { ok: "Published. Notified 1 person.", unreached: null, allFailed: false }],
  [
    "有人没收到（Annie 同意的原文）",
    { notified: ppl("A", "B", "C", "D"), not_reached: miss(["Jing", NO], ["Anita", NO]) },
    { ok: "Published. Notified 4 people.", unreached: "2 couldn't be reached: Jing, Anita (no email or login).", allFailed: false },
  ],
  [
    "两种原因混着：按原因分组",
    { notified: ppl("A", "B"), not_reached: miss(["Jing", NO], ["Nadia", FAIL], ["Anita", NO]) },
    { ok: "Published. Notified 2 people.", unreached: "3 couldn't be reached: Jing, Anita (no email or login); Nadia (email could not be sent).", allFailed: false },
  ],
  [
    "都没收到（Annie 同意的原文）",
    { notified: [], not_reached: miss(["Nadia", NO], ["Veronica", NO]) },
    { ok: "", unreached: "Published, but no one was notified: Nadia, Veronica have no email or login. Add their email in Employees.", allFailed: true },
  ],
  [
    "都没收到、一个人",
    { notified: [], not_reached: miss(["Nadia", NO]) },
    { ok: "", unreached: "Published, but no one was notified: Nadia has no email or login. Add their email in Employees.", allFailed: true },
  ],
  [
    "都没收到、只有发信失败（不写 Add their email）",
    { notified: [], not_reached: miss(["Nadia", FAIL]) },
    { ok: "", unreached: "Published, but no one was notified: Nadia: email could not be sent.", allFailed: true },
  ],
  [
    "Publish again：有人没收到，后面接 schedule editors",
    { republished: true, notified: ppl("A"), notified_supervisors: [{ user_id: 1, name: "S", channels: [] }, { user_id: 2, name: "T", channels: [] }], not_reached: miss(["Jing", NO]) },
    { ok: "Published again. Notified 1 staff member and 2 schedule editors.", unreached: "1 couldn't be reached: Jing (no email or login).", allFailed: false },
  ],
  [
    "Publish again：员工都没收到、主管收到了",
    { republished: true, notified: [], notified_supervisors: [{ user_id: 1, name: "S", channels: [] }], not_reached: miss(["Jing", NO]) },
    { ok: "Published again. Notified 1 schedule editor.", unreached: "1 couldn't be reached: Jing (no email or login).", allFailed: false },
  ],
  [
    "Publish again：谁都没收到",
    { republished: true, notified: [], notified_supervisors: [], not_reached: miss(["Jing", NO]) },
    { ok: "", unreached: "Published again, but no one was notified: Jing has no email or login. Add their email in Employees.", allFailed: true },
  ],
  [
    "Publish again：没人变（照旧）",
    { republished: true, notified: [], notified_supervisors: [] },
    { ok: "Published again. No one's shifts or time off changed, so no one was notified.", unreached: null, allFailed: false },
  ],
];
let bad = 0;
for (const [name, result, want] of cases) {
  const got = publishNotice({ status: "published", published_at: "", published_by: 1, ...result });
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → ${JSON.stringify(got)}`}`);
}
console.log(`\n${cases.length - bad}/${cases.length} passed`);
process.exit(bad ? 1 : 0);
