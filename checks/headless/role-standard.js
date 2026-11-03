// 角色标准（后端 app/services/permissions.py ROLE_STANDARD，64 a987105a，2026-11-01 照抄；2026-11-02 补 orders.money_view，后端 8e9a9a58）。
// 模拟后端的 GET /api/me/permissions 默认按这份回：特批开关关着时，一个人勾的 ∩ 他角色的标准；这里当作「标准里的全勾了」。
const STAFF = [
  "dashboard.view", "forecast.view", "forecast.edit", "manifests.view", "manifests.edit", "manifests.send", "manifests.export",
  "orders.view", "orders.edit", "dispatch.view", "dispatch.edit", "dispatch.send", "forms.view", "forms.edit",
  "morning.view", "morning.send", "tour.view", "tour.send", "tickets.view", "tickets.send", "broadcast.send",
  "messages.view", "messages.reply", "logs.view", "logs.export", "reports.view", "reports.send_daily",
  "schedule.view", "tasks.view_own", "report.view", "report.create", "workspace.use", "quotation.create",
  "orders.export", "taskboard.use", "bugs.use",
  // G231 第 8 题：员工本来就看得到价格；CCL 的人靠「没勾」藏，不靠 role 标准。
  "orders.money_view",
];
const SUPERVISOR = [
  ...STAFF,
  "schedule.edit", "schedule.publish", "tasks.view_all", "tasks.manage", "report.edit", "team.staff_add", "settings.hr.view",
  "settings.schedule",
];
const ADMIN = [
  ...SUPERVISOR,
  "forms.edit", "logs.delete", "reports.export", "quotation.rates_edit",
  "settings.content", "settings.pickup", "settings.products", "settings.forecast", "settings.farm_out", "settings.vehicles",
  "settings.test_orders", "settings.users", "settings.hr.edit", "settings.promotions",
].filter((c, i, a) => a.indexOf(c) === i);
const STANDARD = { staff: STAFF, supervisor: SUPERVISOR, admin: ADMIN };

/** GET /api/me/permissions 的回包。role：staff / supervisor / admin / superadmin（Super Admin 回 is_superadmin=true）。 */
function permsBody(role, codes) {
  const list = codes ?? STANDARD[role] ?? STAFF;
  return {
    is_superadmin: role === "superadmin",
    permissions: list.map((code) => ({ code, module: code.split(".")[0], wired: true })),
    default_home: "/dashboard",
  };
}

module.exports = { STANDARD, permsBody };
