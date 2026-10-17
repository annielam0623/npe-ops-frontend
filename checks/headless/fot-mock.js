// 模拟后端：Settings → Farm out Timetable。控制：POST /__ctl {fail401, staff, failList, deleteFail, departFail}；GET /__log。
// Upload 不真解析文件，只认文件名；返回固定的 diff（任务包里的字段）。
const http = require("http");

const ctl = { fail401: false, staff: false, failList: false, deleteFail: false, departFail: false };
const log = [];
let nextSpotId = 100;

const TOURS = [
  { manifest_id: 101, tour_name: "West Rim" },
  { manifest_id: 102, tour_name: "Lower Antelope" },
  { manifest_id: 103, tour_name: "Valley of Fire" },
  { manifest_id: 104, tour_name: "Zion" },
  { manifest_id: 105, tour_name: "West Rim (Small Group)" },
  { manifest_id: 106, tour_name: "Hoover Dam (Small Group)" },
];

const PARTNERS = [
  { id: 1, name: "ZZ Test Partner A" },
  { id: 2, name: "ZZ Test Partner B" },
];

let spots = [
  {
    id: 10,
    partner_id: 1,
    name: "Plaza Hotel · Ride Share Area",
    address: "1 Main St, Las Vegas, NV",
    map_link: "https://maps.test/plaza",
    departures: { 101: "6:20", 102: "4:50", 103: "8:40", 104: "5:50", 105: "6:10", 106: "7:10" },
  },
  {
    id: 11,
    partner_id: 1,
    name: "Strat · Sidedoor",
    address: "",
    map_link: "",
    departures: { 101: "6:30" },
  },
  {
    id: 20,
    partner_id: 2,
    name: "Venetian · Ground Transportation",
    address: "",
    map_link: "",
    departures: { 101: "6:50" },
  },
];

let tourMeta = [
  {
    manifest_id: 101,
    tour_name: "West Rim",
    return_time: "5:00- 6:30 PM",
    please_note:
      "Due to recent safety concerns, backpacks and large bags are not permitted inside the Grand Canyon.",
  },
  { manifest_id: 104, tour_name: "Zion", return_time: null, please_note: "" },
];

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
function timetablePayload() {
  return { partners: PARTNERS, tours: TOURS, spots, tour_meta: tourMeta };
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      Object.assign(ctl, JSON.parse((await readRaw(req)).toString() || "{}"));
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const ct = req.headers["content-type"] || "";
    const raw = req.method === "GET" ? null : await readRaw(req);
    const isMultipart = ct.includes("multipart");
    const body = raw && !isMultipart ? JSON.parse(raw.toString() || "null") : null;
    const entry = { method: req.method, path: p, query: url.search, body };
    log.push(entry);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me") {
      return send(res, 200, {
        id: 1,
        username: "zztest",
        display_name: "ZZ Test",
        initials: "ZT",
        role: ctl.staff ? "staff" : "admin",
        is_admin: !ctl.staff,
        is_superadmin: false,
      });
    }
    if (p === "/api/settings/farm-out/timetable" && req.method === "GET") {
      if (ctl.failList) return send(res, 500, { detail: "Internal Server Error" });
      return send(res, 200, timetablePayload());
    }
    if (p === "/api/settings/farm-out/timetable/spots" && req.method === "POST") {
      const name = (body?.name || "").trim();
      if (!name) return send(res, 400, { detail: "Hotel · Spot name is required." });
      const spot = {
        id: nextSpotId++,
        partner_id: body.partner_id,
        name,
        address: "",
        map_link: "",
        departures: {},
      };
      spots.push(spot);
      return send(res, 200, { id: spot.id });
    }
    let m = p.match(/^\/api\/settings\/farm-out\/timetable\/spots\/(\d+)$/);
    if (m && req.method === "PUT") {
      const spot = spots.find((s) => s.id === Number(m[1]));
      if (spot) Object.assign(spot, body);
      return send(res, 200, { success: true });
    }
    if (m && req.method === "DELETE") {
      if (ctl.deleteFail) {
        return send(res, 409, { detail: "This pickup spot still has departure times. Clear them first." });
      }
      spots = spots.filter((s) => s.id !== Number(m[1]));
      return send(res, 200, { success: true });
    }
    m = p.match(/^\/api\/settings\/farm-out\/timetable\/spots\/(\d+)\/departures\/(\d+)$/);
    if (m && req.method === "PUT") {
      if (ctl.departFail) return send(res, 400, { detail: "Could not read that as a time." });
      const spot = spots.find((s) => s.id === Number(m[1]));
      const manifestId = Number(m[2]);
      if (spot) {
        if (!body?.depart_time) delete spot.departures[manifestId];
        else spot.departures[manifestId] = body.depart_time;
      }
      return send(res, 200, { success: true });
    }
    m = p.match(/^\/api\/settings\/farm-out\/timetable\/tour-meta\/(\d+)$/);
    if (m && req.method === "PUT") {
      const manifestId = Number(m[1]);
      const tour = TOURS.find((t) => t.manifest_id === manifestId);
      tourMeta = tourMeta.filter((tm) => tm.manifest_id !== manifestId);
      tourMeta.push({
        manifest_id: manifestId,
        tour_name: tour?.tour_name ?? "",
        return_time: body?.return_time ?? null,
        please_note: body?.please_note ?? "",
      });
      return send(res, 200, { success: true });
    }
    m = p.match(/^\/api\/settings\/farm-out\/timetable\/partners\/(\d+)\/upload$/);
    if (m && req.method === "POST") {
      const text = raw.toString("latin1");
      const f = /filename="([^"]+)"/.exec(text);
      const fileName = f ? f[1] : "upload.csv";
      const diff = {
        file_name: fileName,
        changed: [
          { spot_name: "Plaza Hotel · Ride Share Area", manifest_id: 101, tour_name: "West Rim", before: "6:20", after: "6:25" },
          { spot_name: "Strat · Sidedoor", manifest_id: 102, tour_name: "Lower Antelope", before: null, after: "5:05" },
        ],
        new_spots: [
          { name: "Excalibur · Rear Rotunda", departures: { "West Rim": "6:30", "Lower Antelope": "5:00" } },
        ],
        unknown_tours: ["Hoover Dam Only"],
        parsed: [
          { spot_name: "Plaza Hotel · Ride Share Area", departures: { 101: "6:25" } },
          { spot_name: "Strat · Sidedoor", departures: { 102: "5:05" } },
          { spot_name: "Excalibur · Rear Rotunda", departures: { 101: "6:30", 102: "5:00" } },
        ],
      };
      return send(res, 200, diff);
    }
    m = p.match(/^\/api\/settings\/farm-out\/timetable\/partners\/(\d+)\/apply$/);
    if (m && req.method === "POST") {
      const partnerId = Number(m[1]);
      for (const row of body?.parsed ?? []) {
        let spot = spots.find((s) => s.partner_id === partnerId && s.name === row.spot_name);
        if (!spot) {
          spot = { id: nextSpotId++, partner_id: partnerId, name: row.spot_name, address: "", map_link: "", departures: {} };
          spots.push(spot);
        }
        Object.assign(spot.departures, row.departures);
      }
      return send(res, 200, { success: true });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () =>
    console.log(`farm-out timetable mock on ${Number(process.env.MOCK_PORT) || 8799}`),
  );
