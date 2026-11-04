// 模拟后端：Relay list（/dispatch/relay-list，task/relay-print）。只回 relay-pull 加了打印字段的形状（后端 fc 定的键）。
// 控制：POST /__ctl {fail401, fail500, old, many, noSettings, edit, failPut, reset}
//   many = 2nd Round 那台车 40 个客人，一张单要印两页；old = 旧后端，没有 phone / product_short / bus / location_ids / tour_buses；
//   置顶 73：noSettings = 设置接口还没上线（404）；edit = 我有 dispatch.edit；failPut = 存设置 500；reset = 设置回默认。GET /__log。
const http = require("http");

const ctl = { fail401: false, fail500: false, old: false, many: false, noSettings: false, edit: false, failPut: false };
if (process.env.MOCK_CTL) Object.assign(ctl, JSON.parse(process.env.MOCK_CTL));
const log = [];

// ── 置顶 73：Relay list 颜色 + 每张单方向（GET / PUT /api/settings/relay-list，形状照 9e 评估）──
const DEFAULT_COLORS = ["#fff605", "#ffc05b", "#83b7e8", "#c5e8b7", "#d9c8f0", "#f6c6d6"];
// 启用的团：当天有的是 3 Antelope（A/B）、1 South Rim（C）、2 West Rim、4 Bryce&Zion；9 Hoover Dam 当天没有（Show all tours 才出）。
const TOURS = [
  { manifest_id: 3, name: "Antelope Canyon", default_color: "#7a6ba8", buses: [{ label: "A", default_color: "#afc0f4" }, { label: "B", default_color: "#db92c8" }] },
  { manifest_id: 1, name: "South Rim", default_color: "#b5de86", buses: [{ label: "C", default_color: "#b5de86" }] },
  { manifest_id: 2, name: "West Rim", default_color: "#6861a6", buses: [] },
  { manifest_id: 4, name: "Bryce&Zion", default_color: "#f4938e", buses: [] },
  { manifest_id: 9, name: "Hoover Dam", default_color: "#d9fbfe", buses: [{ label: "A", default_color: "#d9fbfe" }] },
];
const P = "portrait";
const fresh = () => ({ colors: [...DEFAULT_COLORS], tour_colors: {}, orientations: { summary: P, relay: [P, P, P, P, P, P], tours: {} } });
let st = fresh();
const tourColor = (mid, label) => {
  const t = TOURS.find((x) => x.manifest_id === mid);
  const tc = st.tour_colors[mid] || {};
  const b = t && t.buses.find((x) => x.label === label);
  return (label && tc.buses && tc.buses[label]) || (b && b.default_color !== t.default_color ? b.default_color : null) || tc.all || (b && b.default_color) || (t && t.default_color) || "#c8cdd3";
};
const tourOrient = (mid, label) => {
  const to = st.orientations.tours[mid] || {};
  return (label && to.buses && to.buses[label]) || to.all || P;
};
function settingsBody() {
  return {
    ...JSON.parse(JSON.stringify(st)),
    defaults: { colors: DEFAULT_COLORS, orientations: { summary: P, relay: [P, P, P, P, P, P], tours: {} } },
    tours: TOURS.map((t) => ({ ...t, color: tourColor(t.manifest_id, null), buses: t.buses.map((b) => ({ ...b, color: tourColor(t.manifest_id, b.label) })) })),
  };
}
// PUT：只改传进来的部分，按团 / 字母合并，null = 回默认（照 9e）。
function merge(patch) {
  if (Array.isArray(patch.colors)) st.colors = st.colors.map((c, i) => (i in patch.colors ? patch.colors[i] || DEFAULT_COLORS[i] : c));
  for (const [mid, v] of Object.entries(patch.tour_colors || {})) {
    const cur = (st.tour_colors[mid] ||= {});
    if ("all" in v) cur.all = v.all;
    for (const [l, c] of Object.entries(v.buses || {})) (cur.buses ||= {})[l] = c;
  }
  const o = patch.orientations || {};
  if (o.summary) st.orientations.summary = o.summary;
  if (Array.isArray(o.relay)) st.orientations.relay = o.relay.map((x) => x || P);
  for (const [mid, v] of Object.entries(o.tours || {})) {
    const cur = (st.orientations.tours[mid] ||= {});
    if ("all" in v) cur.all = v.all;
    for (const [l, x] of Object.entries(v.buses || {})) (cur.buses ||= {})[l] = x;
  }
}

const BUS = {
  antA: { label: "A", tour: "Antelope Canyon", tour_short: "Antelope", sections: [{ name: "LOWER", short: "Lower", color: "#bcd7f0" }, { name: "UPPER", short: "Upper", color: "#f6c7a0" }], driver: "ZZ Luis", guide: "ZZ Scarlett", van: "2056", color: "#c6c8f0" },
  antB: { label: "B", tour: "Antelope Canyon", tour_short: "Antelope", sections: [{ name: "Canyon X", short: "CanyonX", color: "#c5e0a5" }], driver: "ZZ Lankun", guide: "ZZ Lankun", van: "2622", color: "#e7a3dc" },
  south: { label: "C", tour: "South Rim", tour_short: "South", sections: [], driver: "ZZ Carlos", guide: "ZZ Glenn", van: "1855", color: "#b5de86" },
  west: { label: null, tour: "West Rim", tour_short: "West", sections: [], driver: "ZZ Leo", guide: "ZZ Teresa", van: "1456", color: "#6861a6" },
};
const { sections: _s, ...SOUTH_BASE } = BUS.south;
const southCar = () => ({ ...SOUTH_BASE, manifest_id: 1 });

const g = (o) => ({ id: 0, order_number: "", name: "ZZ Guest", pax: 2, pickup_time: "4:35 AM", pickup_location: "", location_id: null, hotel: "", tour: "", sent: false, sent_at: null, sent_by: "", relay_status: "", changed: [], ...o });
const rich = (o, extra) => (ctl.old ? g(o) : g({ ...o, ...extra }));

function relayPull(date) {
  const r1 = [
    {
      // 1724：站序 MGM（12）在 Aria（11）前面。
      car: { id: 901, van: "1724", driver: "ZZ Bruce", ...(ctl.old ? {} : { location_ids: [12, 11], tour_buses: [], relay_color: "#fff605" }) },
      guests: [
        rich({ id: 1, order_number: "CHDZZA01", name: "Zed Zane", pickup_location: "Aria Resort", location_id: 11, hotel: "Aria Resort", tour: "Antelope Canyon" }, { phone: "+15550100001", manifest_id: 3, product_short: "Lower", short_tag: "Lower", hotel_short: "Aria", bus: BUS.antA }),
        rich({ id: 2, order_number: "CHDZZA02", name: "Amy Abel", pax: 3, pickup_location: "Aria Resort", location_id: 11, hotel: "Aria Resort", tour: "Antelope Canyon" }, { phone: "+15550100002", manifest_id: 3, product_short: "CanyonX", short_tag: "CanyonX", hotel_short: "Aria", bus: BUS.antB }),
        rich({ id: 3, order_number: "CHDZZM01", name: "Mo Mills", pax: 1, pickup_location: "MGM Grand Hotel", location_id: 12, hotel: "MGM Grand Hotel", tour: "South Rim" }, { phone: "+15550100003", manifest_id: 1, product_short: "South", short_tag: "South", hotel_short: "MGM Grand", bus: BUS.south }),
      ],
    },
    // 1855：当天也是 South C 的大巴，顺路接 Horseshoe。
    {
      car: { id: 902, van: "1855", driver: "ZZ Carlos", ...(ctl.old ? {} : { location_ids: [14], tour_buses: [southCar()] }) },
      guests: [rich({ id: 4, order_number: "CHDZZH01", name: "Hana Hill", pickup_time: "4:50 AM", pickup_location: "Horseshoe Las Vegas", location_id: 14, hotel: "Horseshoe Las Vegas", tour: "Antelope Canyon" }, { phone: "+15550100004", manifest_id: 3, product_short: "Upper", short_tag: "Upper", hotel_short: "Horseshoe", bus: BUS.antA })],
    },
    // 1725：还没存站点，没客人（不印分表，图例照列）。
    { car: { id: 903, van: "1725", driver: "ZZ David", problems: ["Relay car 1725 has no pickup stop"], ...(ctl.old ? {} : { location_ids: [], tour_buses: [] }) }, guests: [] },
    // 2017：排错了，同一台车挂在两个团上（只是打印提示，不挡发送）。
    {
      car: { id: 904, van: "2017", driver: "ZZ Paulie", ...(ctl.old ? {} : { location_ids: [15], tour_buses: [southCar(), { label: null, tour: "Bryce&Zion", tour_short: "BZ", driver: "ZZ Paulie", guide: "ZZ Paulie", van: "2017", color: "#f4938e" }], print_warnings: ["This van is on 2 tour buses today."] }) },
      guests: [rich({ id: 5, order_number: "CHDZZX01", name: "Xi Xu", pickup_time: "4:40 AM", pickup_location: "Wynn Hotel", location_id: 15, hotel: "Wynn Hotel", tour: "South Rim" }, { phone: "+15550100005", manifest_id: 1, product_short: "South", short_tag: "South", hotel_short: "Wynn", bus: BUS.south })],
    },
  ];
  const extra = ctl.many
    ? Array.from({ length: 40 }, (_, i) => rich({ id: 100 + i, order_number: `CHDZZL${String(i).padStart(2, "0")}`, name: `ZZ Long ${i}`, pickup_time: "5:45 AM", pickup_location: `ZZ Hotel ${i}`, location_id: 200 + i, hotel: `ZZ Hotel ${i}`, tour: "West Rim" }, { phone: "+15550100100", manifest_id: 2, product_short: "West", short_tag: "West", hotel_short: `ZZ Hotel ${i}`, bus: BUS.west }))
    : [];
  const r2 = [{ car: { id: 905, van: "1724", driver: "ZZ Bruce", ...(ctl.old ? {} : { location_ids: [11], tour_buses: [] }) }, guests: [rich({ id: 6, order_number: "CHDZZW01", name: "Wes West", pickup_time: "5:40 AM", pickup_location: "Aria Resort", location_id: 11, hotel: "Aria Resort", tour: "West Rim" }, { phone: "+15550100006", manifest_id: 2, product_short: "West", short_tag: "West", hotel_short: "Aria", bus: BUS.west }), ...extra] }];
  // Hoover 自己接（Tour bus pick up）：Relay list 不印。
  const tc = [{ car: { id: 906, van: "1955", driver: "ZZ Dan", tour_name: "HooverDam", bus_label: null }, guests: [g({ id: 7, order_number: "CHDZZHD1", name: "Hoover Guest", pickup_time: "9:15 AM", pickup_location: "Excalibur", tour: "HooverDam" })] }];
  if (!ctl.old) {
    for (const round of [r1, r2]) {
      let n = 0;
      for (const b of round) {
        const tb = b.car.tour_buses || [];
        for (const x of tb) {
          if (x.manifest_id != null) {
            x.color = tourColor(x.manifest_id, x.label);
            x.orientation = tourOrient(x.manifest_id, x.label);
          }
        }
        if (tb.length) b.car.orientation = tb[0].orientation || P;
        else {
          b.car.relay_color = st.colors[n % 6];
          b.car.orientation = st.orientations.relay[n % 6];
          n += 1;
        }
      }
    }
  }
  return {
    ...(ctl.old ? {} : { summary_orientation: st.orientations.summary }),
    run_date: date,
    checked_at: "2026-11-02T20:00:00-08:00",
    round_labels: { relay: { name: "Morning Relay · 1st Round", when: "4:30 - 5:15 AM" }, relay_2: { name: "Morning Relay · 2nd Round", when: "5:40 - 6:30 AM" }, tour_car: { name: "Morning Relay · Tour bus pick up", when: "" } },
    rounds: { relay: r1, relay_2: r2, tour_car: tc },
    need_a_look: [rich({ id: 8, order_number: "CHDZZN01", name: "Nia Nguyen", pickup_time: "4:45 AM", pickup_location: "Circus Circus Hotel", location_id: 16, hotel: "Circus Circus Hotel", tour: "South Rim", reason: "No relay car stops at this hotel in this round" }, { phone: "+15550100008", manifest_id: 1, product_short: "South", short_tag: "South", bus: BUS.south })],
    departure: 3,
  };
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      let d = "";
      req.on("data", (c) => (d += c));
      await new Promise((r) => req.on("end", r));
      const body = JSON.parse(d || "{}");
      if (body.reset) st = fresh();
      delete body.reset;
      Object.assign(ctl, body);
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    log.push({ path: p, query: url.search });
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "staff", is_admin: false, is_superadmin: false });
    if (p === "/api/me/permissions") return send(res, 200, { is_superadmin: false, permissions: [{ code: "dispatch.view", module: "dispatch", wired: true }, ...(ctl.edit ? [{ code: "dispatch.edit", module: "dispatch", wired: true }] : [])], default_home: null });
    if (p === "/api/settings/relay-list") {
      if (ctl.noSettings) return send(res, 404, { detail: "Not Found" });
      if (req.method === "PUT") {
        let d = "";
        req.on("data", (c) => (d += c));
        await new Promise((r) => req.on("end", r));
        log[log.length - 1].body = JSON.parse(d || "{}");
        log[log.length - 1].method = "PUT";
        if (!ctl.edit) return send(res, 403, { detail: "You do not have permission to edit Dispatch." });
        if (ctl.failPut) return send(res, 500, { detail: "Internal Server Error" });
        merge(log[log.length - 1].body);
      }
      return send(res, 200, settingsBody());
    }
    if (p === "/api/dispatch/relay-pull") {
      if (ctl.fail500) return send(res, 500, { detail: "Internal Server Error" });
      return send(res, 200, relayPull(url.searchParams.get("date")));
    }
    return send(res, 404, { detail: "Not Found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799);
