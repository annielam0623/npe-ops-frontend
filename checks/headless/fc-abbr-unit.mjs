// 单元检查：Forecast 每档的简称（components/forecast/config.ts 的 allotmentAbbreviations）。
// node checks/headless/fc-abbr-unit.mjs
// Annie 2026-11-05「session里的X为什么又变成C了」：10-31 生产数据把 X Canyon 改成 Canyon X 后，取第一个字母变成了 C。
import { allotmentAbbreviations } from "../../components/forecast/config.ts";

const abbr = (labels) => {
  const m = allotmentAbbreviations(labels.map((label) => ({ label })));
  return labels.map((l) => m.get(l));
};
const cases = [
  ["生产现在的名字：UPPER / LOWER / Canyon X ⇒ U / L / X", ["UPPER", "LOWER", "Canyon X"], ["U", "L", "X"]],
  ["原来的名字：Upper / Lower / X ⇒ U / L / X", ["Upper", "Lower", "X"], ["U", "L", "X"]],
  ["旧名字 X Canyon 也是 X", ["Upper", "Lower", "X Canyon"], ["U", "L", "X"]],
  ["小写单字母也认：Canyon x ⇒ X", ["Upper", "Canyon x"], ["U", "X"]],
  ["没有单字母的词：照旧第一个字母", ["Morning", "Afternoon"], ["M", "A"]],
  ["首字母撞了：那几档写全名", ["Sunset", "Sunrise", "Canyon X"], ["Sunset", "Sunrise", "X"]],
  ["单字母和别的档首字母撞了：也写全名", ["Canyon X", "Xtra"], ["Canyon X", "Xtra"]],
];
let bad = 0;
for (const [name, input, want] of cases) {
  const got = abbr(input);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → ${JSON.stringify(got)}`}`);
}
console.log(`\n${cases.length - bad}/${cases.length} passed`);
process.exit(bad ? 1 : 0);
