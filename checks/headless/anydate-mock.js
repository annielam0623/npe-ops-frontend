// tt / tk mock 共用：Tracking「搜索不限日期」（Annie 2026-11-23「Tracking搜索全部同意推荐，动手」）的两个只读接口。
// 形状照后端合同 docs/interfaces/tracking-find-order-2026-11-23.md（后端窗口 47，main 3bfd9440）。
// tt 的行只在 2026-10-10；tk 的行只在今天（洛杉矶）。
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const tour = (o) => ({ product_code: "ANTL", product_name: "Lower Antelope Canyon", product_type: "bus_tour", tour_date: "2026-10-10", status: "confirmed", page: "tour", ...o });
const ticket = (o) => ({ product_code: "UTC01", product_name: "Upper Antelope – Tsosie", product_type: "ticket", tour_date: today, status: "confirmed", page: "tickets", ...o });
const FIND = {
  T02: [tour({})],
  // 多产品：团在 Tour Tracking（10-10），门票在 Tickets Tracking（今天）。
  T03: [tour({ product_code: "GCS01", product_name: "Grand Canyon South Rim" }), ticket({})],
  // 只有门票：在 Tour Tracking 搜 ⇒ 带去 Tickets Tracking（Q4 A）。
  CHDZZ1: [ticket({})],
  // Order List 里取消了、两页都没有（Q5 A）。
  CHD7001: [tour({ product_code: "GCW01", product_name: "Grand Canyon West Rim", tour_date: "2026-10-11", status: "cancelled", page: null })],
  // Order List 说在 Tour Tracking 的 10-10，那天的表里却没有。
  T09: [tour({ product_code: "GCW01", product_name: "Grand Canyon West Rim" })],
  // 合同例子：Admin fee 那一项 page null、在前（日期早）；团那一项 page tour。
  T01: [tour({ product_code: "PFYF01", product_name: "Manual Admin Item", product_type: "unmapped", tour_date: "2026-10-01", page: null }), tour({})],
};
const SEARCH = {
  "zz two": [{ order_number: "T02", name: "ZZ Two", ...tour({}) }],
  "zz test alpha": [{ order_number: "CHDZZ1", name: "ZZ Test Alpha", ...ticket({}) }],
};
module.exports = function anyDate(p, url, res, send) {
  if (p === "/api/notifications/tracking/find-order") {
    const q = String(url.searchParams.get("order") || "").trim().toUpperCase();
    if (!q) { send(res, 400, { detail: "Type an order number." }); return true; }
    const products = FIND[q];
    if (!products) { send(res, 404, { detail: "No order with that number in the Order List." }); return true; }
    send(res, 200, { order_number: q, products });
    return true;
  }
  if (p === "/api/notifications/tracking/search-all-dates") {
    const raw = String(url.searchParams.get("q") || "").trim();
    const phone = /^[+\d\s().-]+$/.test(raw);
    if (phone && raw.replace(/\D/g, "").length < 4) { send(res, 400, { detail: "Type at least 4 digits of the phone number." }); return true; }
    if (!phone && raw.replace(/[^A-Za-z]/g, "").length < 2) { send(res, 400, { detail: "Type at least 2 letters of the name." }); return true; }
    const q = raw.toLowerCase().replace(/\s+/g, " ");
    // "zz many"：超过 20 行（truncated）。
    if (q === "zz many") {
      const matches = Array.from({ length: 20 }, (_, i) => ({ order_number: `ZZM${i + 1}`, name: "ZZ Many", ...tour({}) }));
      send(res, 200, { matches, truncated: true });
      return true;
    }
    send(res, 200, { matches: SEARCH[q] ?? [], truncated: false });
    return true;
  }
  return false;
};
module.exports.today = today;
