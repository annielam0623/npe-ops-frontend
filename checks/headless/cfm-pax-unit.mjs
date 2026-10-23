// 单元检查：Cfm # 上传的 Pax 读法（lib/cfm-pax.ts）。node checks/headless/cfm-pax-unit.mjs
import { parsePax } from "../../lib/cfm-pax.ts";

const cases = [
  ["7(6A,1inf)", 7],
  ["11(10A,1inf)", 11],
  ["7 (6A, 1 inf)", 7],
  ["11[10A,1inf]", 11],
  ["7", 7],
  [" 12 ", 12],
  ["2 Adults, 1 Child", 3],
  ["2 Adults", 2],
  ["", null],
  ["  ", null],
  ["n/a", null],
];
let bad = 0;
for (const [input, want] of cases) {
  const got = parsePax(input);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  parsePax(${JSON.stringify(input)}) = ${got}${ok ? "" : `, want ${want}`}`);
}
console.log(`${cases.length - bad}/${cases.length} passed`);
process.exit(bad ? 1 : 0);
