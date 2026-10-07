// 模拟后端：/manifests 页。控制：POST /__ctl {fail401, staff, fail}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, fail: false };
const log = [];

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// 4 行：Group A（grouped，sort 1）、Group B（grouped，sort 2，含一行 legacy 和一行门票已发）、
// 没归组但在 Products 里、没进 Products；外加三条发送线的各种状态（未发 / 发过 / 一个渠道失败）。
const rows = [
  {
    order_number: "ORD-A1", product_code: "ANTCANY", product_name: "Antelope Canyon Tour",
    internal_name: "Antelope Canyon", product_label: "Antelope Canyon", in_products: true,
    group_id: 1, group_name: "Antelope Canyon Group", group_sort: 1, category: "Bus Tour",
    first_name: "ZZ", last_name: "Test One", email: "one@example.test", phone: "+15550000001",
    pax: 2, pickup_time: "7:00 AM", pickup_location: "Aria", status: "confirmed", rezdy_status: "CONFIRMED",
    confirmation_no: "CFM-1", special_requirements: "", agent_name: "Website", lane_source: "rezdy_bookings",
    sent: { tour: { at: "2026-10-10T13:00:00+00:00", by: "annie" }, morning: null, tickets: null },
  },
  {
    order_number: "ORD-A2", product_code: "ANTCANY", product_name: "Antelope Canyon Tour",
    internal_name: "Antelope Canyon", product_label: "Antelope Canyon", in_products: true,
    group_id: 1, group_name: "Antelope Canyon Group", group_sort: 1, category: "Bus Tour",
    first_name: "ZZ", last_name: "Test Two", email: "", phone: "+15550000002",
    pax: 4, pickup_time: "7:15 AM", pickup_location: "Resorts World", status: "pending", rezdy_status: "PROCESSING",
    confirmation_no: "", special_requirements: "wheelchair", agent_name: "Expedia", lane_source: "legacy",
    sent: { tour: null, morning: null, tickets: null },
  },
  {
    order_number: "ORD-B1", product_code: "LASHUTT", product_name: "Las Vegas Shuttle",
    internal_name: "LV Shuttle", product_label: "LV Shuttle", in_products: true,
    group_id: 2, group_name: "Shuttle Group", group_sort: 2, category: "Shuttle",
    first_name: "ZZ", last_name: "Test Three", email: "three@example.test", phone: "",
    pax: 1, pickup_time: "6:00 AM", pickup_location: "MGM Grand", status: "confirmed", rezdy_status: "CONFIRMED",
    confirmation_no: "CFM-3", special_requirements: "", agent_name: "Website", lane_source: "rezdy_bookings",
    sent: {
      tour: null,
      morning: { at: "2026-10-10T13:05:00+00:00", by: "annie", partial: { failed: "sms", other: "delivered" } },
      tickets: null,
    },
  },
  {
    order_number: "ORD-C1", product_code: "ZZCODE1", product_name: "ZZ Ungrouped Product",
    internal_name: "", product_label: "ZZ Ungrouped Product", in_products: true,
    group_id: null, group_name: "", group_sort: null, category: "Other",
    first_name: "ZZ", last_name: "Test Four", email: "four@example.test", phone: "+15550000004",
    pax: 3, pickup_time: "", pickup_location: "", status: "unknown", rezdy_status: "AWAITING",
    confirmation_no: "", special_requirements: "", agent_name: "", lane_source: "rezdy_bookings",
    sent: { tour: null, morning: null, tickets: { at: "2026-10-10T13:10:00+00:00", by: "max" } },
  },
  {
    order_number: "ORD-D1", product_code: "ZZNOTIN", product_name: "ZZ Not In Products",
    internal_name: "", product_label: "ZZ Not In Products", in_products: false,
    group_id: null, group_name: "", group_sort: null, category: "",
    first_name: "ZZ", last_name: "Test Five", email: "five@example.test", phone: "+15550000005",
    pax: 5, pickup_time: "8:00 AM", pickup_location: "Treasure Island", status: "confirmed", rezdy_status: "CONFIRMED",
    confirmation_no: "CFM-5", special_requirements: "", agent_name: "Website", lane_source: "rezdy_bookings",
    sent: { tour: null, morning: null, tickets: null },
  },
];

function groupSummary(rows) {
  const out = [];
  const idx = new Map();
  for (const r of rows) {
    const k = r.group_id !== null ? `g:${r.group_id}` : r.in_products ? "ungrouped" : "not-in-products";
    if (!idx.has(k)) {
      idx.set(k, out.length);
      out.push({ group_id: r.group_id, group_name: r.group_name, in_products: r.group_id !== null || r.in_products, rows: 0, orders: new Set(), pax: 0 });
    }
    const g = out[idx.get(k)];
    g.rows += 1;
    g.orders.add(r.order_number);
    g.pax += r.pax || 0;
  }
  return out.map((g) => ({ ...g, orders: g.orders.size }));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      let body = "";
      req.on("data", (c) => (body += c));
      return req.on("end", () => {
        Object.assign(ctl, JSON.parse(body || "{}"));
        send(res, 200, ctl);
      });
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p, query: url.search };
    log.push(entry);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : "admin", is_admin: !ctl.staff, is_superadmin: false });
    if (p === "/api/manifests") {
      if (ctl.staff) return send(res, 403, { detail: "Admin access required" });
      if (ctl.fail) return send(res, 500, { detail: "Internal Server Error" });
      const date = url.searchParams.get("date");
      const dayRows = date === today ? rows : [];
      return send(res, 200, { date, groups: groupSummary(dayRows), rows: dayRows });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(8799, () => console.log("mock on 8799, today", today));
