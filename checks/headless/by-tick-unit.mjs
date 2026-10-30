// 单元检查：「全部按照勾选」的共用判断 byTick（lib/by-tick.ts，Annie 2026-10-30 置顶 10c）。node checks/headless/by-tick-unit.mjs
import { byTick } from "../../lib/by-tick.ts";

const perms = (active, codes) => ({ active, canAny: (cs) => cs.some((c) => codes.includes(c)) });
const cases = [
  // [说明, perms, codes, opts, 应得]
  ["开关开着、没勾 ⇒ 看不到", perms(true, []), "settings.pickup", { legacy: false, superAdmin: false }, false],
  ["开关开着、勾了 ⇒ 看得到", perms(true, ["settings.pickup"]), "settings.pickup", { legacy: false, superAdmin: false }, true],
  ["开关开着、admin 没勾 ⇒ 也看不到", perms(true, []), "settings.pickup", { legacy: true, superAdmin: false }, false],
  ["开关开着、勾了的不是 admin ⇒ 看得到", perms(true, ["settings.pickup"]), "settings.pickup", { legacy: false, superAdmin: false }, true],
  ["Super Admin ⇒ 一律看得到（开关开着、没勾）", perms(true, []), "settings.pickup", { legacy: false, superAdmin: true }, true],
  ["Super Admin ⇒ 一律看得到（开关关着）", perms(false, []), "settings.pickup", { legacy: false, superAdmin: true }, true],
  ["开关关着 ⇒ 照旧：admin 看得到", perms(false, []), "settings.pickup", { legacy: true, superAdmin: false }, true],
  ["开关关着 ⇒ 照旧：不是 admin 看不到（勾了也一样）", perms(false, ["settings.pickup"]), "settings.pickup", { legacy: false, superAdmin: false }, false],
  ["几个码任一勾了就行", perms(true, ["manifests.edit"]), ["dispatch.edit", "manifests.edit"], { legacy: false, superAdmin: false }, true],
  ["几个码都没勾 ⇒ 看不到", perms(true, ["dispatch.view"]), ["dispatch.edit", "manifests.edit"], { legacy: true, superAdmin: false }, false],
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
