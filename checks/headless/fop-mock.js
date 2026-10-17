// 模拟后端：Settings → Farm out Partners。控制：POST /__ctl {fail401, staff, failList, deleteFail}；GET /__log。
const http = require("http");

const ctl = { fail401: false, staff: false, failList: false, deleteFail: false };
const log = [];
let nextId = 50;

const TOURS = [
  { manifest_id: 101, tour_name: "West Rim" },
  { manifest_id: 102, tour_name: "Lower Antelope" },
  { manifest_id: 103, tour_name: "Valley of Fire" },
  { manifest_id: 104, tour_name: "Zion" },
  { manifest_id: 105, tour_name: "West Rim (Small Group)" },
  { manifest_id: 106, tour_name: "Hoover Dam (Small Group)" },
];

let partners = [
  {
    id: 1,
    name: "ZZ Test Partner A",
    is_active: true,
    rates: [
      { manifest_id: 101, tour_name: "West Rim", adult_rate: 105, child_rate: 95 },
      { manifest_id: 102, tour_name: "Lower Antelope", adult_rate: 160, child_rate: 150 },
      { manifest_id: 104, tour_name: "Zion", adult_rate: null, child_rate: null },
    ],
  },
  {
    id: 2,
    name: "ZZ Test Partner B",
    is_active: true,
    rates: [{ manifest_id: 101, tour_name: "West Rim", adult_rate: 110, child_rate: 99 }],
  },
];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : null));
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      Object.assign(ctl, await readBody(req));
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p, query: url.search };
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
    if (p === "/api/settings/farm-out/tours") {
      return send(res, 200, { tours: TOURS });
    }
    if (p === "/api/settings/farm-out/partners" && req.method === "GET") {
      if (ctl.failList) return send(res, 500, { detail: "Internal Server Error" });
      return send(res, 200, { partners });
    }
    if (p === "/api/settings/farm-out/partners" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      const name = (body?.name || "").trim();
      if (!name) return send(res, 400, { detail: "Partner name is required." });
      if (partners.some((pt) => pt.name.toLowerCase() === name.toLowerCase())) {
        return send(res, 400, { detail: `"${name}" already exists.` });
      }
      const partner = { id: nextId++, name, is_active: true, rates: [] };
      partners.push(partner);
      return send(res, 200, partner);
    }
    let m = p.match(/^\/api\/settings\/farm-out\/partners\/(\d+)$/);
    if (m && req.method === "DELETE") {
      const id = Number(m[1]);
      if (ctl.deleteFail) {
        return send(res, 409, {
          detail: "ZZ Test Partner A has orders already farmed out to it. It cannot be deleted.",
        });
      }
      partners = partners.filter((pt) => pt.id !== id);
      return send(res, 200, { success: true });
    }
    if (m && req.method === "PATCH") {
      const body = await readBody(req);
      entry.body = body;
      const partner = partners.find((pt) => pt.id === Number(m[1]));
      if (partner && body?.name) partner.name = body.name;
      return send(res, 200, { success: true });
    }
    m = p.match(/^\/api\/settings\/farm-out\/partners\/(\d+)\/active$/);
    if (m && req.method === "PATCH") {
      const body = await readBody(req);
      entry.body = body;
      const partner = partners.find((pt) => pt.id === Number(m[1]));
      if (partner) partner.is_active = !!body?.active;
      return send(res, 200, { success: true });
    }
    m = p.match(/^\/api\/settings\/farm-out\/partners\/(\d+)\/rates\/(\d+)$/);
    if (m && req.method === "PUT") {
      const body = await readBody(req);
      entry.body = body;
      const partnerId = Number(m[1]);
      const manifestId = Number(m[2]);
      const partner = partners.find((pt) => pt.id === partnerId);
      const tour = TOURS.find((t) => t.manifest_id === manifestId);
      if (!partner || !tour) return send(res, 404, { detail: "Not found" });
      const adult = body?.adult_rate === undefined ? null : body.adult_rate;
      const child = body?.child_rate === undefined ? null : body.child_rate;
      if ((adult !== null && adult < 0) || (child !== null && child < 0)) {
        return send(res, 400, { detail: "A rate cannot be negative." });
      }
      partner.rates = partner.rates.filter((r) => r.manifest_id !== manifestId);
      const saved = { manifest_id: manifestId, tour_name: tour.tour_name, adult_rate: adult, child_rate: child };
      if (adult !== null || child !== null) partner.rates.push(saved);
      return send(res, 200, saved);
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () =>
    console.log(`farm-out partners mock on ${Number(process.env.MOCK_PORT) || 8799}`),
  );
