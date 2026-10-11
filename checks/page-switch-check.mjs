// 分批切换（lib/page-switch.ts）的检查：清单为空（现在上线的样子）和切了几页之后的样子。
// 跑法：node checks/page-switch-check.mjs（Node 23.6+ 直接读 .ts）。不连后端、不起页面。
import { makeSwitch, MIGRATED_PAGES, SWITCHED } from "../lib/page-switch.ts";

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  → ${detail}` : ""}`);
}
const j = (v) => JSON.stringify(v);

// ── 现在的清单（一开始是空的）──
check("上线时清单是空的", SWITCHED.length === 0, j(SWITCHED));
const none = makeSwitch([]);
check("没切换：首页进旧后台 dashboard", j(none.redirects()) === j([{ source: "/", destination: "/admin/dashboard", permanent: false }]), j(none.redirects()));
check("没切换：侧栏 / 链接去旧路径（同一个网址下的相对路径）", none.pageHref("/send-log") === "/admin/notifications/send-log" && none.pageHref("/settings/content-studio") === "/admin/settings/templates");
check("没切换：30 Days Forecast 去旧后台的占位页", none.pageHref("/forecast") === "/admin/coming-soon?module=30+Days+Forecast");
check("没切换：dashboard 消息卡片的旧路径原样", none.fromLegacy("/admin/notifications/morning-pickup/tracking?date=2026-10-11") === "/admin/notifications/morning-pickup/tracking?date=2026-10-11");
check("不在对照表里的路径原样", none.pageHref("/orders/CHD1") === "/orders/CHD1");

// ── 切了几页以后 ──
const some = makeSwitch(["/dashboard", "/send-log", "/morning-pickup/tracking", "/forecast"]);
const r = some.redirects();
check("切了 Dashboard：首页进 ops 的 /dashboard", r[0].destination === "/dashboard");
check("切了的页面：旧路径跳 ops 新页面（307，不永久）", r.some((x) => x.source === "/admin/notifications/send-log" && x.destination === "/send-log" && x.permanent === false) && r.some((x) => x.source === "/admin/dashboard" && x.destination === "/dashboard"), j(r));
check("没切的页面不跳（例如 Tour tracking）", !r.some((x) => x.source === "/admin/notifications/tour-confirmation/tracking"));
const fc = r.find((x) => x.destination === "/forecast");
check("带查询串的旧路径：只有 module 对上才跳（别的 coming-soon 不跳）", fc?.source === "/admin/coming-soon" && j(fc?.has) === j([{ type: "query", key: "module", value: "30 Days Forecast" }]), j(fc));
check("切了的：侧栏 / 链接去 ops 新页面；没切的还是旧路径", some.pageHref("/send-log") === "/send-log" && some.pageHref("/order-log") === "/admin/activities/order-log");
check("切了的 tracking：dashboard 消息卡片换成 ops 路径、保留 ?date=", some.fromLegacy("/admin/notifications/morning-pickup/tracking?date=2026-10-11") === "/morning-pickup/tracking?date=2026-10-11");
check("没切的 tracking：消息卡片还是旧路径", some.fromLegacy("/admin/notifications/tickets-reminder/tracking?date=2026-10-11") === "/admin/notifications/tickets-reminder/tracking?date=2026-10-11");

// ── 对照表本身 ──
const ops = MIGRATED_PAGES.map((p) => p.ops);
const legacy = MIGRATED_PAGES.map((p) => p.legacy);
check("对照表：ops 路径、旧路径都不重复", new Set(ops).size === ops.length && new Set(legacy).size === legacy.length);
check("对照表：都是站内路径（不带域名）", [...ops, ...legacy].every((p) => p.startsWith("/") && !p.startsWith("//")));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
