// 版式设置（置顶 92 第 1 批）的模拟接口：GET / PUT /api/settings/print-layout?page=bus_manifest|relay_list。
// 形状照后端 07 定的（78 转）：{page, palette, colours, ticket_rules, text, page_setup, defaults, boxes, tours?}；PUT 只带改了的顶层键，null = 回默认，返回 {ok, …整份}。
// 用法：const layoutMock = require("./print-layout-mock"); 在 mock 里 `if (await layoutMock(ctl, p, q, req, res, send, readRaw, entry)) return;`
// ctl.layout = true 才有这个接口（不开 = 后端没上线，404）；ctl.layoutFail = PUT 400 的原话。
const BM_BOXES = [
  ["bus_header", "Bus header", false, true, null],
  ["section", "Section title and Cfm # box", false, true, null],
  ["shuttle_out", "Shuttle out section", true, true, "#f8c9a0"],
  ["shuttle_in", "Shuttle back section", true, true, "#b9d3f0"],
  ["hotel_group", "Every other hotel group", true, true, null],
  ["extra_row", "Extra guests, whole row", true, true, "#f0c59a"],
  ["notes", "Special Requirements with text", true, true, "#fffc11"],
  ["column_titles", "Column titles", true, true, "#e6eaee"],
  ["foot_head", "Footer titles", true, true, "#dbdcde"],
  ["foot_custom", "Custom footer cell", true, true, "#ddd0f0"],
  ["confirm_box", "Cfm # box", true, true, "#fff704"],
  ["lunch_bar", "Lunch sheet date bar", true, true, "#fffa08"],
  ["lunch_notes", "Lunch sheet notes", true, true, "#fff909"],
  ["lunch_default_row", "Lunch sheet Turkey row", true, true, "#fff200"],
  ["lunch_total_row", "Lunch sheet total row", true, true, "#dfe5ea"],
  ["lunch_mismatch", "Lunch doesn't match Pax", true, true, "#ffe1e1"],
  ["sandwich_head", "TOTAL SANDWICH", true, true, "#fff200"],
  ["ticket_plus", "Other tickets with +", true, true, "#fff200"],
  ...["order_number", "pickup_time", "pickup_location", "last_name", "first_name", "phone", "pax", "ticket", "notes", "boarding", "lunch", "assist"]
    .map((k) => [`col_${k}`, `${k} column`, true, false, null]),
];
const RL_BOXES = [
  ["hotel_cell", "Hotel cell", false, true, null],
  ["column_titles", "Column titles", true, true, "#d9d9d9"],
];
const PALETTE = ["#fff200", "#ffc05b", "#83b7e8", "#c5e8b7", "#d9c8f0", "#f6c6d6", "#dbeafe"];
const RULES = [
  { contains: "Premium", color: null },
  { contains: "Grab and Go", color: "#dbddde" },
  { contains: "+ Generator", color: "#fffa0c" },
  { contains: "No Lunch", color: "#fdfeda" },
];
const DEFAULTS = {
  bus_manifest: { palette: PALETTE, colours: { all: {}, tours: {} }, ticket_rules: RULES, text: {}, page_setup: { paper: "a4", margin_mm: null, sheets: { bus: "landscape", lunch: "portrait" } } },
  relay_list: { palette: PALETTE, colours: { all: {}, tours: {} }, ticket_rules: null, text: {}, page_setup: { paper: "a4", margin_mm: null } },
};
const KEYS = ["palette", "colours", "ticket_rules", "text", "page_setup"];
const stored = { bus_manifest: {}, relay_list: {} };

function full(page) {
  const s = stored[page];
  const boxes = (page === "bus_manifest" ? BM_BOXES : RL_BOXES).map(([key, label, has_color, default_on, default_color]) => ({ key, label, has_color, default_on, default_color }));
  return {
    page,
    palette: s.palette ?? null,
    colours: s.colours ?? { all: {}, tours: {} },
    ticket_rules: page === "bus_manifest" ? (s.ticket_rules ?? null) : null,
    text: s.text ?? {},
    page_setup: s.page_setup ?? null,
    defaults: DEFAULTS[page],
    boxes,
    ...(page === "bus_manifest" ? { tours: [{ manifest_id: 3, name: "Antelope Canyon" }] } : {}),
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
function bad(body) {
  if (body.palette && (!Array.isArray(body.palette) || body.palette.some((c) => !HEX.test(c)))) return "Each colour must look like #rrggbb.";
  if (body.page_setup?.margin_mm != null && (body.page_setup.margin_mm < 5 || body.page_setup.margin_mm > 25)) return "Margins must be from 5 to 25 mm.";
  if (Array.isArray(body.ticket_rules) && body.ticket_rules.length > 30) return "Up to 30 ticket colours.";
  return null;
}

module.exports = async function layoutMock(ctl, p, q, req, res, send, readRaw, entry) {
  if (p !== "/api/settings/print-layout") return false;
  if (!ctl.layout) return send(res, 404, { detail: "Not Found" }), true;
  const page = q.page;
  if (!stored[page]) return send(res, 400, { detail: "page must be bus_manifest or relay_list." }), true;
  if (req.method === "PUT") {
    const body = JSON.parse((await readRaw(req)) || "{}");
    if (entry) entry.body = body;
    if (ctl.partner || ctl.layoutForbidden) return send(res, 403, { detail: "You don't have permission to change this." }), true;
    if (ctl.layoutFail) return send(res, 400, { detail: ctl.layoutFail }), true;
    const why = bad(body);
    if (why) return send(res, 400, { detail: why }), true;
    for (const k of KEYS) if (k in body) {
      if (body[k] === null) delete stored[page][k];
      else stored[page][k] = body[k];
    }
    return send(res, 200, { ok: true, ...full(page) }), true;
  }
  return send(res, 200, full(page)), true;
};
module.exports.reset = () => { stored.bus_manifest = {}; stored.relay_list = {}; };
module.exports.stored = stored;
