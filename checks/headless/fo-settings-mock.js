// 模拟后端：Farm out 的 Settings 两页（合作公司 + 结算价 + 上车点、时刻表 + 上传 / Apply、按团返回时间 / 注意事项）。
// 控制：POST /__ctl {reset, fail401, staff, unavailable}；GET /__log。端口默认 8811（环境变量 MOCK_PORT 可改）。
const http = require("http");

const ctl = { fail401: false, staff: false, unavailable: false };
const log = [];

const TOURS = [
  { manifest_id: 10, tour_name: "West Rim" },
  { manifest_id: 11, tour_name: "Zion" },
];
let partners, rates, locations, cells, tourMeta, nextPartnerId, nextLocId;

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
    2: TOURS.map((t) => ({ ...t, adult_price: 110, child_price: 99 })),
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
    hotels: sorted(locations[pid]).map((l) => ({ id: l.id, hotel_name: l.hotel_name, spot: l.spot })),
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
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : "admin", is_admin: !ctl.staff, is_superadmin: false });
    if (!p.startsWith("/api/farm-out/")) return send(res, 404, { detail: "mock: not found" });
    // 后端还没上线：整个 /api/farm-out/* 是 404。
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
      return send(res, 200, created);
    }
    if (sub === "/tour-meta" && req.method === "GET") return send(res, 200, tourMeta);
    if (sub === "/tour-meta" && req.method === "PUT") {
      tourMeta = entry.body;
      return send(res, 200, tourMeta);
    }
    let m = sub.match(/^\/partners\/(\d+)$/);
    if (m && req.method === "PATCH") {
      const partner = partners.find((x) => x.id === Number(m[1]));
      Object.assign(partner, entry.body);
      return send(res, 200, partner);
    }
    m = sub.match(/^\/partners\/(\d+)\/(rates|locations|timetable(?:\/parse|\/apply|\/export\.csv)?)$/);
    if (m) {
      const pid = Number(m[1]);
      const what = m[2];
      if (what === "rates") {
        if (req.method === "PUT") {
          if (entry.body.some((r) => "infant_price" in r)) return send(res, 400, { detail: "no infant price" });
          rates[pid] = entry.body;
        }
        return send(res, 200, rates[pid]);
      }
      if (what === "locations") {
        if (req.method === "PUT") {
          locations[pid] = entry.body.map((l) => ({ ...l, id: l.id ?? nextLocId++ }));
        }
        return send(res, 200, sorted(locations[pid]));
      }
      if (what === "timetable") {
        if (req.method === "PUT") {
          if (Object.values(entry.body.cells).some((v) => !/^\d\d:\d\d$/.test(v))) return send(res, 400, { detail: "bad time" });
          cells[pid] = entry.body.cells;
        }
        return send(res, 200, timetableOf(pid));
      }
      if (what === "timetable/export.csv") {
        res.setHeader("Content-Type", "text/csv");
        return res.end("Hotel,Spot,West Rim,Zion\n");
      }
      if (what === "timetable/parse") {
        // 固定的解析结果：Bellagio / West Rim 06:50→06:45，新酒店 Wynn，一个对不上的团名。
        const wynn = { id: 900, hotel_name: "Wynn", spot: "Main Valet" };
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
            cells: { ...base.cells, "101_10": "06:45", "900_10": "06:55", "900_11": "06:25" },
          },
        });
      }
      if (what === "timetable/apply") {
        const parsed = entry.body.parsed;
        for (const h of parsed.hotels) {
          if (!locations[pid].some((l) => l.id === h.id)) {
            locations[pid].push({ id: h.id, hotel_name: h.hotel_name, spot: h.spot, address: "", map_link: "", sort_order: locations[pid].length });
          }
        }
        cells[pid] = parsed.cells;
        return send(res, 200, timetableOf(pid));
      }
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8811, () => console.log("farm-out settings mock up"));
