// 单元检查：共用判断 byTick（lib/by-tick.ts）。只看勾（Annie 2026-10-31「只看勾，不兜底」，2026-11-01「动手」）。node checks/headless/by-tick-unit.mjs
import { byTick } from "../../lib/by-tick.ts";

// usePermissions 的样子：读到了（active）只认列表；读不到（active=false）员工照旧不藏。
const perms = (active, codes) => ({ active, canAny: (cs) => !active || cs.some((c) => codes.includes(c)) });
const cases = [
  // [说明, perms, codes, opts, 应得]
  ["没勾 ⇒ 看不到", perms(true, []), "settings.pickup", { superAdmin: false }, false],
  ["勾了 ⇒ 看得到", perms(true, ["settings.pickup"]), "settings.pickup", { superAdmin: false }, true],
  ["勾的是别的项 ⇒ 看不到", perms(true, ["settings.vehicles"]), "settings.pickup", { superAdmin: false }, false],
  ["Super Admin ⇒ 一律看得到", perms(true, []), "settings.pickup", { superAdmin: true }, true],
  ["权限读不到 ⇒ 员工照旧不藏（后端照样挡）", perms(false, []), "settings.pickup", { superAdmin: false }, true],
  ["几个码任一勾了就行", perms(true, ["manifests.edit"]), ["dispatch.edit", "manifests.edit"], { superAdmin: false }, true],
  ["几个码都没勾 ⇒ 看不到", perms(true, ["dispatch.view"]), ["dispatch.edit", "manifests.edit"], { superAdmin: false }, false],
];
let bad = 0;
for (const [name, p, codes, opts, want] of cases) {
  const got = byTick(p, codes, opts);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → got ${got}`}`);
}
console.log(`\n${cases.length - bad}/${cases.length} passed`);
process.exit(bad ? 1 : 0);
