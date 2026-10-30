// 模拟后端（形状 2026-10-17 对着后端真代码核对：所有保存返回 {ok, <键>: ...}，时刻表的酒店没有 spot，parse 里新酒店 id 为 null、格子 key 是 new<序号>_<团>）。
// Farm out 的 Settings 两页（合作公司 + 结算价 + 上车点、时刻表 + 上传 / Apply、按团返回时间 / 注意事项）。
// 控制：POST /__ctl {reset, fail401, staff, unavailable, foVis（farm_out_settings 的档：staff / admin / super_admin_only；null = 后端还没登记）}；GET /__log。端口默认 8799（环境变量 MOCK_PORT 可改）。
const http = require("http");

const ctl = { fail401: false, staff: false, partner: false, unavailable: false, foVis: "staff", log403: false, itemsFail: false };
const log = [];

const TOURS = [
  { manifest_id: 10, tour_name: "West Rim" },
  { manifest_id: 11, tour_name: "Zion" },
];
let partners, rates, locations, cells, tourMeta, nextPartnerId, nextLocId, nextItemId;

function reset() {
  partners = [
    { id: 1, name: "Partner A", slug: "partner-a", is_active: true },
    { id: 2, name: "Partner B", slug: "partner-b", is_active: true },
  ];
  rates = {
    1: [
      { manifest_id: 10, tour_name: "West Rim", adult_price: 105, child_price: 95 },
      { manifest_id: 11, tour_name: "Zion", adult_price: null, child_price: null },
    ],
    2: TOURS.map((t) => ({ ...t, adult_price: 110, child_price: 99, items: t.manifest_id === 10 ? [{ id: 801, name: "Lunch", price: 15, sort_order: 0 }] : [] })),
  };
  locations = {
    1: [
      { id: 101, hotel_name: "Bellagio", spot: "Underground South Tour Lobby", address: "3600 S Las Vegas Blvd", map_link: "https://goo.gl/maps/aaa", sort_order: 0 },
      { id: 102, hotel_name: "Venetian", spot: "Ground Transportation Area", address: "3355 S Las Vegas Blvd", map_link: "https://goo.gl/maps/bbb", sort_order: 1 },
    ],
    2: [{ id: 201, hotel_name: "Strat", spot: "Sidedoor", address: "2000 S Las Vegas Blvd", map_link: "", sort_order: 0 }],
  };
  cells = {
    1: { "101_10": "06:50", "101_11": "06:20", "102_10": "06:50" },
    2: { "201_10": "06:30" },
  };
  tourMeta = [
    { manifest_id: 10, tour_name: "West Rim", estimated_return_time: "5:00- 6:30 PM", please_note: "No large bags." },
    { manifest_id: 11, tour_name: "Zion", estimated_return_time: "", please_note: "" },
  ];
  nextPartnerId = 50;
  nextLocId = 500;
  nextItemId = 900;
}
reset();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
const sorted = (arr) => [...arr].sort((a, b) => a.sort_order - b.sort_order);
function timetableOf(pid) {
  return {
    hotels: sorted(locations[pid]).map((l) => ({ id: l.id, hotel_name: l.hotel_name })),
    tours: TOURS,
    cells: cells[pid],
  };
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const body = JSON.parse((await readRaw(req)).toString() || "{}");
      if (body.reset) {
        reset();
        log.length = 0;
      }
      Object.assign(ctl, { ...body, reset: undefined });
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p, query: url.search };
    log.push(entry);
    const raw = await readRaw(req);
    const ctype = req.headers["content-type"] || "";
    if (ctype.includes("application/json") && raw.length) entry.body = JSON.parse(raw.toString());
    else if (raw.length) {
      entry.contentType = ctype.split(";")[0];
      entry.rawText = raw.toString("latin1");
    }
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.partner ? "partner" : ctl.staff ? "staff" : "admin", is_admin: !ctl.staff && !ctl.partner, is_superadmin: false });
    // 「谁看得到」开关（2026-10-25）：这套默认放给所有人（看页面内容）；foVis=null 时没登记（404），前端按默认 super_admin_only 算。
    if (p === "/api/settings/dashboard-widgets") {
      if (!ctl.foVis) return send(res, 404, { detail: "Not Found" });
      const seen = ctl.foVis === "staff" || (ctl.foVis === "admin" && !ctl.staff);
      return send(res, 200, { readable: true, widgets: ["farm_out_settings", "farm_out_report"].map((key) => ({ key, label: key, visibility: ctl.foVis, default: "super_admin_only", visible_to_me: seen })) });
    }
    if (!p.startsWith("/api/farm-out/")) return send(res, 404, { detail: "mock: not found" });
    // 后端还没上线：整个 /api/farm-out/* 是 404。
    // G203 第三批：Farm out 设置的 Action Log（后端 c8 ee121ec，权限 settings.farm_out；partner 403）。旧条目 from / to 是 null。
    if (p === "/api/farm-out/settings/action-log") {
      if (ctl.log403 || ctl.partner) return send(res, 403, { detail: "Permission required" });
      return send(res, 200, { next_cursor: null, entries: [
        { id: "3-1", at: "2026-10-29T17:00:00+00:00", by: "Annie Z", action: "update", label: "ZZ Test Partner", what: "West Rim › Adult price", from: "$100.00", to: "$105.00" },
        { id: "2-1", at: "2026-10-28T17:00:00+00:00", by: "Max", action: "update", label: "ZZ Test Partner", what: "Bellagio › Spot", from: "Main lobby", to: "North valet" },
        { id: "1-1", at: "2026-10-20T17:00:00+00:00", by: "Max", action: "update", label: "ZZ Test Partner", what: "Active", from: null, to: null },
      ] });
    }
    if (ctl.unavailable) return send(res, 404, { detail: "Not Found" });
    if (ctl.staff) return send(res, 403, { detail: "Admin access required" });

    const sub = p.slice("/api/farm-out".length);
    if (sub === "/partners" && req.method === "GET") return send(res, 200, partners);
    if (sub === "/partners" && req.method === "POST") {
      const name = (entry.body.name || "").trim();
      if (partners.some((x) => x.name.toLowerCase() === name.toLowerCase())) return send(res, 400, { detail: `"${name}" already exists` });
      const created = { id: nextPartnerId++, name, slug: name.toLowerCase().replace(/\W+/g, "-"), is_active: true };
      partners.push(created);
      rates[created.id] = TOURS.map((t) => ({ ...t, adult_price: null, child_price: null }));
      locations[created.id] = [];
      cells[created.id] = {};
      return send(res, 200, { ok: true, partner: created });
    }
    if (sub === "/tour-meta" && req.method === "GET") return send(res, 200, tourMeta);
    if (sub === "/tour-meta" && req.method === "PUT") {
      tourMeta = entry.body;
      return send(res, 200, { ok: true, items: tourMeta });
    }
    let m = sub.match(/^\/partners\/(\d+)$/);
    if (m && req.method === "PATCH") {
      const partner = partners.find((x) => x.id === Number(m[1]));
      Object.assign(partner, entry.body);
      return send(res, 200, { ok: true, partner });
    }
    m = sub.match(/^\/partners\/(\d+)\/(rates|locations|timetable(?:\/parse|\/apply|\/export\.csv)?)$/);
    if (m) {
      const pid = Number(m[1]);
      const what = m[2];
      if (what === "rates") {
        if (req.method === "PUT") {
          if (entry.body.some((r) => "infant_price" in r)) return send(res, 400, { detail: "no infant price" });
          // 子项（Farm out 团的子项，后端还没上）：带了 items 就整组替换（顺序 = sort_order），没带就保留原来的；同团名字重复 400。
          for (const r of entry.body) {
            const names = (r.items || []).map((it) => it.name.toLowerCase());
            const dup = names.find((n, i) => names.indexOf(n) !== i);
            if (dup) return send(res, 400, { detail: `${r.items.find((it) => it.name.toLowerCase() === dup).name} is already on ${r.tour_name}.` });
          }
          if (ctl.itemsFail) return send(res, 500, { detail: "Database is busy" });
          const old = rates[pid] || [];
          rates[pid] = entry.body.map((r) => ({
            ...r,
            items: r.items ? r.items.map((it, i) => ({ id: it.id ?? nextItemId++, name: it.name, price: it.price, sort_order: i })) : (old.find((o) => o.manifest_id === r.manifest_id)?.items || []),
          }));
          return send(res, 200, { ok: true, rates: rates[pid] });
        }
        return send(res, 200, rates[pid]);
      }
      if (what === "locations") {
        if (req.method === "PUT") {
          locations[pid] = entry.body.map((l) => ({ ...l, id: l.id ?? nextLocId++ }));
          return send(res, 200, { ok: true, locations: sorted(locations[pid]) });
        }
        return send(res, 200, sorted(locations[pid]));
      }
      if (what === "timetable") {
        if (req.method === "PUT") {
          if (Object.values(entry.body.cells).some((v) => !/^\d\d:\d\d$/.test(v))) return send(res, 400, { detail: "bad time" });
          cells[pid] = entry.body.cells;
          return send(res, 200, { ok: true, timetable: timetableOf(pid) });
        }
        return send(res, 200, timetableOf(pid));
      }
      if (what === "timetable/export.csv") {
        res.setHeader("Content-Type", "text/csv");
        return res.end("Hotel,Spot,West Rim,Zion\n");
      }
      if (what === "timetable/parse") {
        // 固定的解析结果：Bellagio / West Rim 06:50→06:45，新酒店 Wynn，一个对不上的团名。
        const wynn = { id: null, hotel_name: "Wynn" };
        const base = timetableOf(pid);
        return send(res, 200, {
          diff: {
            changed: [{ hotel: "Bellagio", tour: "West Rim", from: "06:50", to: "06:45" }],
            new_hotels: ["Wynn"],
            unmatched_tours: ["Bryce Canyon"],
          },
          parsed: {
            hotels: [...base.hotels, wynn],
            tours: TOURS,
            // 新酒店排在第 base.hotels.length 位 ⇒ key 是 new<序号>_<团>。
            cells: { ...base.cells, "101_10": "06:45", [`new${base.hotels.length}_10`]: "06:55", [`new${base.hotels.length}_11`]: "06:25" },
          },
        });
      }
      if (what === "timetable/apply") {
        const parsed = entry.body.parsed;
        const next = {};
        const idAt = {};
        parsed.hotels.forEach((h, i) => {
          if (h.id == null) {
            const id = nextLocId++;
            idAt[i] = id;
            locations[pid].push({ id, hotel_name: h.hotel_name, spot: "", address: "", map_link: "", sort_order: locations[pid].length });
          }
        });
        for (const [k, v] of Object.entries(parsed.cells)) {
          const mm = k.match(/^new(\d+)_(\d+)$/);
          next[mm ? `${idAt[Number(mm[1])]}_${mm[2]}` : k] = v;
        }
        cells[pid] = next;
        return send(res, 200, { ok: true, timetable: timetableOf(pid) });
      }
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("farm-out settings mock up"));
