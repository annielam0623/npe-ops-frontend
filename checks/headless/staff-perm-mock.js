// 各套 mock 共用：模拟「员工权限总开关 staff_permissions 对这个人开着」的员工 / Super Admin（Annie 2026-10-30 置顶 10c「全部按照勾选」）。
// 控制：ctl.staffPerms = 这个员工勾了的项（数组）；ctl.superAdmin = true ⇒ Super Admin（勾不勾都全给）。都没设 ⇒ 不管，交给原来的 mock。
// 用法：在 mock 回 /api/me 之前加一行 `if (staffPerm(ctl, p, res, send)) return;`。
module.exports = function staffPerm(ctl, p, res, send) {
  if (!ctl.staffPerms && !ctl.superAdmin) return false;
  const superAdmin = !!ctl.superAdmin;
  if (p === "/api/me") {
    send(res, 200, { id: 5, username: "zzstaff", display_name: "ZZ Test Staff", initials: "ZS", role: superAdmin ? "admin" : "staff", is_admin: superAdmin, is_superadmin: superAdmin, is_supervisor: false });
    return true;
  }
  if (p === "/api/settings/dashboard-widgets") {
    send(res, 200, { readable: true, widgets: [{ key: "staff_permissions", label: "Staff permissions", visibility: "staff", default: "super_admin_only", visible_to_me: true }] });
    return true;
  }
  if (p === "/api/me/permissions") {
    send(res, 200, { is_superadmin: superAdmin, permissions: (ctl.staffPerms || []).map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: null });
    return true;
  }
  return false;
};
