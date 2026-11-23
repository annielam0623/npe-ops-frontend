// 各套 mock 共用：★ Note 打通 + @（Annie 2026-11-21 动手；后端合同 v1，ab）。
// 用法：在 mock 的路由里加一行 `if (await staffNotes(ctl, req, url, res, send, readBody, log)) return;`。
// 控制：ctl.sn = true ⇒ 新后端（有这些接口）；没设 ⇒ 404（旧后端，前端走老路）。
//   ctl.snFail = 404 | 400 ⇒ POST 回这个错（400 detail 照合同原话）。
// 数据：SN_ORDERS[单号] = { products, notes }；POST 成功会加进去（最新在前）。
const DIRECTORY = {
  teams: [
    { id: 31, name: "ZZ Test Dispatch", member_count: 6 },
    { id: 32, name: "ZZ Test Tickets", member_count: 3 },
  ],
  people: [
    { id: 41, display_name: "ZZ Test Lily", teams: ["ZZ Test Ops"], online: true },
    { id: 42, display_name: "ZZ Test Max", teams: ["ZZ Test Dispatch"], online: false },
    { id: 43, display_name: "ZZ Test Sam", teams: ["ZZ Test Tickets"], online: false },
  ],
};
const note = (id, o) => ({
  id,
  order_number: o.order_number,
  product_code: null,
  product_name: null,
  body: "",
  source: null,
  author: { username: "zzannie", display_name: "ZZ Test Annie" },
  created_at: "2026-11-21T17:00:00Z",
  mentions: [],
  mention_teams: [],
  ...o,
});
const SN_ORDERS = {
  // 多产品：Bus + Skywalk；一条整单的旧备注（Order note）。
  CHDSN1: {
    products: [
      { code: "GCW01", name: "Grand Canyon West Bus" },
      { code: "SKY01", name: "Skywalk Ticket" },
    ],
    notes: [
      note(9003, { order_number: "CHDSN1", product_code: "SKY01", product_name: "Skywalk Ticket", body: "Guest wants to upgrade to Skywalk + Lunch", source: "manifest", author: { username: "zzmax", display_name: "ZZ Test Max" }, created_at: "2026-11-21T17:30:00Z" }),
      note(9002, { order_number: "CHDSN1", product_code: "GCW01", product_name: "Grand Canyon West Bus", body: "Bus 3 is full, @ZZ Test Lily please move this order to Bus 4.", source: "order_details", created_at: "2026-11-21T17:14:00Z", mentions: [{ user_id: 41, name: "ZZ Test Lily", notified: true }] }),
      note(9001, { order_number: "CHDSN1", body: "Pickup at main lobby, not porte-cochère.", source: "migrated", created_at: "2026-11-18T18:30:00Z" }),
    ],
  },
  // 单产品。
  CHDSN2: { products: [{ code: "UAC01", name: "Upper Antelope" }], notes: [] },
};
let nextId = 9100;

module.exports = async function staffNotes(ctl, req, url, res, send, readBody, log) {
  const p = url.pathname;
  if (!p.startsWith("/api/staff-notes")) return false;
  if (!ctl.sn) {
    send(res, 404, { detail: "Not Found" });
    return true;
  }
  // 后端 c76644da：/api/staff-notes* 是 require_staff ⇒ partner 一律 403（partner 只在 Order details / Manifest 里读）。
  if (ctl.partner) {
    if (log) log.push({ method: req.method, path: p, partner403: true });
    send(res, 403, { detail: "Access denied" });
    return true;
  }
  if (p === "/api/staff-notes/directory") {
    send(res, 200, DIRECTORY);
    return true;
  }
  if (p === "/api/staff-notes" && req.method === "GET") {
    const on = url.searchParams.get("order_number");
    const o = SN_ORDERS[on];
    if (!o) {
      send(res, 404, { detail: "That order is not in the Order List." });
      return true;
    }
    const pc = url.searchParams.get("product_code");
    const notes = pc ? o.notes.filter((n) => n.product_code === pc || n.product_code === null) : o.notes;
    send(res, 200, { order_number: on, products: o.products, notes });
    return true;
  }
  if (p === "/api/staff-notes" && req.method === "POST") {
    const body = await readBody(req);
    if (log && log.length) log[log.length - 1].body = body;
    if (ctl.snFail === 404) {
      send(res, 404, { detail: "That order is not in the Order List." });
      return true;
    }
    const o = SN_ORDERS[body.order_number];
    if (!o) {
      send(res, 404, { detail: "That order is not in the Order List." });
      return true;
    }
    if (ctl.snFail === 400 || (o.products.length > 1 && !body.product_code)) {
      send(res, 400, { detail: "Pick which product this note is about." });
      return true;
    }
    const code = body.product_code || o.products[0].code;
    const prod = o.products.find((x) => x.code === code);
    const mentions = (body.mentions || []).map((id) => ({ user_id: id, name: DIRECTORY.people.find((x) => x.id === id).display_name, notified: true }));
    const teams = (body.mention_team_ids || []).map((id) => {
      const t = DIRECTORY.teams.find((x) => x.id === id);
      return { team_id: id, name: t.name, notified: t.member_count };
    });
    const n = note(nextId++, { order_number: body.order_number, product_code: code, product_name: prod ? prod.name : null, body: String(body.body).trim(), source: body.source, author: { username: "zzstaff", display_name: "ZZ Test Staff" }, created_at: new Date().toISOString(), mentions, mention_teams: teams });
    o.notes.unshift(n);
    send(res, 201, { note: n });
    return true;
  }
  send(res, 404, { detail: "mock: not found" });
  return true;
};
module.exports.SN_ORDERS = SN_ORDERS;
