// 模拟后端：Relay list（/dispatch/relay-list，task/relay-print）。只回 relay-pull 加了打印字段的形状（后端 fc 定的键）。
// 控制：POST /__ctl {fail401, fail500, old}（old = 旧后端，没有 phone / product_short / bus / location_ids / tour_buses）；GET /__log。
const http = require("http");

const ctl = { fail401: false, fail500: false, old: false };
if (process.env.MOCK_CTL) Object.assign(ctl, JSON.parse(process.env.MOCK_CTL));
const log = [];

const BUS = {
  antA: { label: "A", tour: "Antelope Canyon", tour_short: "Antelope", sections: [{ name: "LOWER", short: "Lower", color: "#bcd7f0" }, { name: "UPPER", short: "Upper", color: "#f6c7a0" }], driver: "ZZ Luis", guide: "ZZ Scarlett", van: "2056", color: "#c6c8f0" },
  antB: { label: "B", tour: "Antelope Canyon", tour_short: "Antelope", sections: [{ name: "Canyon X", short: "CanyonX", color: "#c5e0a5" }], driver: "ZZ Lankun", guide: "ZZ Lankun", van: "2622", color: "#e7a3dc" },
  south: { label: "C", tour: "South Rim", tour_short: "South", sections: [], driver: "ZZ Carlos", guide: "ZZ Glenn", van: "1855", color: "#b5de86" },
  west: { label: null, tour: "West Rim", tour_short: "West", sections: [], driver: "ZZ Leo", guide: "ZZ Teresa", van: "1456", color: "#6861a6" },
};
const { sections: _s, ...SOUTH_CAR } = BUS.south;

const g = (o) => ({ id: 0, order_number: "", name: "ZZ Guest", pax: 2, pickup_time: "4:35 AM", pickup_location: "", location_id: null, hotel: "", tour: "", sent: false, sent_at: null, sent_by: "", relay_status: "", changed: [], ...o });
const rich = (o, extra) => (ctl.old ? g(o) : g({ ...o, ...extra }));

function relayPull(date) {
  const r1 = [
    {
      // 1724：站序 MGM（12）在 Aria（11）前面。
      car: { id: 901, van: "1724", driver: "ZZ Bruce", ...(ctl.old ? {} : { location_ids: [12, 11], tour_buses: [] }) },
      guests: [
        rich({ id: 1, order_number: "CHDZZA01", name: "Zed Zane", pickup_location: "Aria Resort", location_id: 11, hotel: "Aria Resort", tour: "Antelope Canyon" }, { phone: "+15550100001", manifest_id: 3, product_short: "Lower", short_tag: "Lower", hotel_short: "Aria", bus: BUS.antA }),
        rich({ id: 2, order_number: "CHDZZA02", name: "Amy Abel", pax: 3, pickup_location: "Aria Resort", location_id: 11, hotel: "Aria Resort", tour: "Antelope Canyon" }, { phone: "+15550100002", manifest_id: 3, product_short: "CanyonX", short_tag: "CanyonX", hotel_short: "Aria", bus: BUS.antB }),
        rich({ id: 3, order_number: "CHDZZM01", name: "Mo Mills", pax: 1, pickup_location: "MGM Grand Hotel", location_id: 12, hotel: "MGM Grand Hotel", tour: "South Rim" }, { phone: "+15550100003", manifest_id: 1, product_short: "South", short_tag: "South", hotel_short: "MGM Grand", bus: BUS.south }),
      ],
    },
    // 1855：当天也是 South C 的大巴，顺路接 Horseshoe。
    {
      car: { id: 902, van: "1855", driver: "ZZ Carlos", ...(ctl.old ? {} : { location_ids: [14], tour_buses: [SOUTH_CAR] }) },
      guests: [rich({ id: 4, order_number: "CHDZZH01", name: "Hana Hill", pickup_time: "4:50 AM", pickup_location: "Horseshoe Las Vegas", location_id: 14, hotel: "Horseshoe Las Vegas", tour: "Antelope Canyon" }, { phone: "+15550100004", manifest_id: 3, product_short: "Upper", short_tag: "Upper", hotel_short: "Horseshoe", bus: BUS.antA })],
    },
    // 1725：还没存站点，没客人（不印分表，图例照列）。
    { car: { id: 903, van: "1725", driver: "ZZ David", problems: ["Relay car 1725 has no pickup stop"], ...(ctl.old ? {} : { location_ids: [], tour_buses: [] }) }, guests: [] },
    // 2017：排错了，同一台车挂在两个团上（只是打印提示，不挡发送）。
    {
      car: { id: 904, van: "2017", driver: "ZZ Paulie", ...(ctl.old ? {} : { location_ids: [15], tour_buses: [SOUTH_CAR, { label: null, tour: "Bryce&Zion", tour_short: "BZ", driver: "ZZ Paulie", guide: "ZZ Paulie", van: "2017", color: "#567669" }], print_warnings: ["This van is on 2 tour buses today."] }) },
      guests: [rich({ id: 5, order_number: "CHDZZX01", name: "Xi Xu", pickup_time: "4:40 AM", pickup_location: "Wynn Hotel", location_id: 15, hotel: "Wynn Hotel", tour: "South Rim" }, { phone: "+15550100005", manifest_id: 1, product_short: "South", short_tag: "South", hotel_short: "Wynn", bus: BUS.south })],
    },
  ];
  const r2 = [{ car: { id: 905, van: "1724", driver: "ZZ Bruce", ...(ctl.old ? {} : { location_ids: [11], tour_buses: [] }) }, guests: [rich({ id: 6, order_number: "CHDZZW01", name: "Wes West", pickup_time: "5:40 AM", pickup_location: "Aria Resort", location_id: 11, hotel: "Aria Resort", tour: "West Rim" }, { phone: "+15550100006", manifest_id: 2, product_short: "West", short_tag: "West", hotel_short: "Aria", bus: BUS.west })] }];
  // Hoover 自己接（Tour bus pick up）：Relay list 不印。
  const tc = [{ car: { id: 906, van: "1955", driver: "ZZ Dan", tour_name: "HooverDam", bus_label: null }, guests: [g({ id: 7, order_number: "CHDZZHD1", name: "Hoover Guest", pickup_time: "9:15 AM", pickup_location: "Excalibur", tour: "HooverDam" })] }];
  return {
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
      Object.assign(ctl, JSON.parse(d || "{}"));
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    log.push({ path: p, query: url.search });
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "staff", is_admin: false, is_superadmin: false });
    if (p === "/api/me/permissions") return send(res, 200, { is_superadmin: false, permissions: [{ code: "dispatch.view", module: "dispatch", wired: true }], default_home: null });
    if (p === "/api/dispatch/relay-pull") {
      if (ctl.fail500) return send(res, 500, { detail: "Internal Server Error" });
      return send(res, 200, relayPull(url.searchParams.get("date")));
    }
    return send(res, 404, { detail: "Not Found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799);
