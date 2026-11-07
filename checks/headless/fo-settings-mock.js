// 模拟后端（形状 2026-10-17 对着后端真代码核对：所有保存返回 {ok, <键>: ...}，时刻表的酒店没有 spot，parse 里新酒店 id 为 null、格子 key 是 new<序号>_<团>）。
// Farm out 的 Settings 两页（合作公司 + 结算价 + 上车点、时刻表 + 上传 / Apply、按团返回时间 / 注意事项）。
// 控制：POST /__ctl {reset, fail401, staff, unavailable, foVis（farm_out_settings 的档：staff / admin / super_admin_only；null = 后端还没登记）}；GET /__log。端口默认 8799（环境变量 MOCK_PORT 可改）。
const http = require("http");

const ctl = { fail401: false, staff: false, partner: false, unavailable: false, foVis: "staff", log403: false, itemsFail: false, importFail: false, importConflict: false, importFileError: "" };
const log = [];

const TOURS = [
  { manifest_id: 10, tour_name: "West Rim" },
  { manifest_id: 11, tour_name: "Zion" },
];
let partners, rates, locations, cells, tourMeta, nextPartnerId, nextLocId, nextItemId;

/** 后端 farm_out_common.product_display_name：「<团> <产品> - <合作公司>」。 */
function withNames(pid, list) {
  const partner = (partners || []).find((x) => x.id === pid)?.name ?? "";
  return list.map((r) => ({ ...r, products: (r.products || []).map((x, i) => ({ ...x, sort_order: i, display_name: `${r.tour_name} ${x.name} - ${partner}` })) }));
}

function reset() {
  partners = [
    { id: 1, name: "Partner A", slug: "partner-a", is_active: true },
    { id: 2, name: "Partner B", slug: "partner-b", is_active: true },
  ];
  // G263 v3（后端 2c task/farm-out-item-rates 8f951f4c 的 get_rates）：合作方 → 团 → products [{id, name, sort_order, display_name, prices}]。
  rates = {
    1: [
      { manifest_id: 10, tour_name: "West Rim", products: [
        { id: 701, name: "Premium Pass", sort_order: 0, prices: [{ ticket_type: "adult", price: 98 }, { ticket_type: "child", price: 98 }] },
        { id: 702, name: "Admission Only", sort_order: 1, prices: [{ ticket_type: "adult", price: 83 }] },
      ] },
      { manifest_id: 11, tour_name: "Zion", products: [] },
    ],
    2: TOURS.map((t) => ({ ...t, products: t.manifest_id === 10 ? [{ id: 801, name: "VOF-H/D", sort_order: 0, prices: [{ ticket_type: "adult", price: 70 }, { ticket_type: "child", price: 70 }] }] : [] })),
  };
  for (const pid of Object.keys(rates)) rates[pid] = withNames(Number(pid), rates[pid]);
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
    // 题 8：ctl.ticks = 这个人勾了的项（数组）；没设 ⇒ 权限接口 404（前端照旧不藏）。
    if (p === "/api/me/permissions") {
      if (!ctl.ticks) return send(res, 404, { detail: "Not Found" });
      return send(res, 200, { is_superadmin: false, permissions: ctl.ticks.map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: null });
    }
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
      // 题 8（后端 36 e37835a8）：没勾 orders.money_view 时 rates 条目整条不给，一页可能是空的但 next_cursor 照给。
      // ctl.logEmptyFirst ⇒ 第一页 0 条 + next_cursor「c1」，带 before=c1 才给下面 3 条。
      if (ctl.logEmptyFirst && url.searchParams.get("before") !== "c1") return send(res, 200, { next_cursor: "c1", entries: [] });
      return send(res, 200, { next_cursor: null, entries: [
        { id: "3-1", at: "2026-10-29T17:00:00+00:00", by: "Annie Z", action: "update", label: "ZZ Test Partner", what: "West Rim › Adult price", from: "$100.00", to: "$105.00" },
        { id: "2-1", at: "2026-10-28T17:00:00+00:00", by: "Max", action: "update", label: "ZZ Test Partner", what: "Bellagio › Spot", from: "Main lobby", to: "North valet" },
        { id: "1-1", at: "2026-10-20T17:00:00+00:00", by: "Max", action: "update", label: "ZZ Test Partner", what: "Active", from: null, to: null },
      ] });
    }
    if (ctl.unavailable) return send(res, 404, { detail: "Not Found" });
    if (ctl.staff) return send(res, 403, { detail: "Admin access required" });

    const sub = p.slice("/api/farm-out".length);
    // ⬆ Import 结算价（G220 第二批，后端 task/bulk-import-backend c8c0b739：farm_out_settings.plan_rate_import）。
    // 按 Partner + Tour 对上，从不新建（status 只有 update / unchanged / error）；id = 对上的合作公司 id；
    // 价钱在 values / before 里是两位小数、不带 $ 的文字（"$110" 也认），没价钱的 before 是 ""；每行带 row、回 counts。
    if (sub === "/rates/import/preview" || sub === "/rates/import/commit") {
      entry.hasFile = /filename="fo-rates-import\.csv"/.test(entry.rawText || "");
      if (ctl.importFileError) return send(res, 400, { detail: ctl.importFileError });
      if (sub.endsWith("/preview")) {
        // G263 v3（后端 plan_rate_import）：Partner / Tour / Product / Adult / Child / Infant；产品写短名或全名都对上；
        // 对不上的产品 = new（后端不给 label，前端标「New product」）；公司 / 团对不上 = error。
        const V = (partner, tour_name, product, adult_price, child_price, infant_price) => ({ partner, tour_name, product, adult_price, child_price, infant_price });
        const rows = [
          { status: "update", id: 1, row: 2, values: V("Partner A", "West Rim", "Premium Pass", "109.00", "98.00", ""), before: { adult_price: "98.00" }, changed: ["adult_price"], blanked: ["infant_price"], errors: [] },
          { status: "update", id: 1, row: 3, values: V("partner a", "West Rim", "West Rim Admission Only - Partner A", "83.00", "80.00", ""), before: { child_price: "" }, changed: ["child_price"], blanked: ["infant_price"], errors: [] },
          { status: "new", id: 1, row: 4, values: V("Partner A", "Zion", "ZZ Test Day Pass", "120.00", "100.00", ""), before: {}, changed: ["adult_price", "child_price"], blanked: [], errors: [] },
          { status: "unchanged", id: 2, row: 5, values: V("Partner B", "West Rim", "VOF-H/D", "70.00", "70.00", ""), before: {}, changed: [], blanked: [], errors: [] },
          { status: "error", id: null, row: 6, values: V("Partner Z", "Zion", "Day Pass", "100.00", "90.00", ""), before: {}, changed: [], blanked: [], errors: [{ field: "partner", message: "No partner called “Partner Z”." }] },
          { status: "error", id: null, row: 7, values: V("Partner B", "Zion", "Day Pass", "abc", "90.00", ""), before: {}, changed: [], blanked: [], errors: [{ field: "adult_price", message: "The adult price must be a number such as 45 or 45.50." }] },
        ];
        const counts = { new: 0, update: 0, unchanged: 0, error: 0 };
        for (const r of rows) counts[r.status]++;
        return send(res, 200, { columns: ["partner", "tour_name", "product", "adult_price", "child_price", "infant_price"], rows, counts });
      }
      if (ctl.importConflict) return send(res, 409, { detail: "Someone changed this list while the file was being saved. Nothing was saved — check the preview again." });
      if (ctl.importFail) return send(res, 500, { detail: "Database is busy" });
      const wr = rates[1].find((r) => r.manifest_id === 10).products;
      wr.find((x) => x.name === "Premium Pass").prices.find((x) => x.ticket_type === "adult").price = 109;
      wr.find((x) => x.name === "Admission Only").prices.push({ ticket_type: "child", price: 80 });
      rates[1].find((r) => r.manifest_id === 11).products.push({ id: nextItemId++, name: "ZZ Test Day Pass", prices: [{ ticket_type: "adult", price: 120 }, { ticket_type: "child", price: 100 }] });
      rates[1] = withNames(1, rates[1]);
      return send(res, 200, { created: 1, updated: 2, unchanged: 1, skipped: 2 });
    }
    if (sub === "/partners" && req.method === "GET") return send(res, 200, partners);
    if (sub === "/partners" && req.method === "POST") {
      const name = (entry.body.name || "").trim();
      if (partners.some((x) => x.name.toLowerCase() === name.toLowerCase())) return send(res, 400, { detail: `"${name}" already exists` });
      const created = { id: nextPartnerId++, name, slug: name.toLowerCase().replace(/\W+/g, "-"), is_active: true };
      partners.push(created);
      rates[created.id] = TOURS.map((t) => ({ ...t, products: [] }));
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
    // ⬆ Import（G220 第二批，后端 task/bulk-import-backend c8c0b739：farm_out_settings.plan_location_import）。
    // 只在这家的点里按 Hotel 对（不分大小写，不去掉 Hotel 字样）；每行带 row、回 counts；新建行的 changed = 文件里有值的栏；
    // 公司不存在 / 文件错 400，写的时候撞上别人改 409，数据库写失败 500（都是后端原话）。
    m = sub.match(/^\/partners\/(\d+)\/locations\/import\/(preview|commit)$/);
    if (m) {
      const pid = Number(m[1]);
      entry.hasFile = /filename="fo-locations-import\.csv"/.test(entry.rawText || "");
      if (!locations[pid]) return send(res, 400, { detail: "That partner could not be found. Reload the page and try again." });
      if (ctl.importFileError) return send(res, 400, { detail: ctl.importFileError });
      if (m[2] === "preview") {
        const rows = [
          { status: "update", id: 101, row: 2, values: { hotel_name: "Bellagio Hotel", spot: "North Valet", address: "", map_link: "" }, before: { spot: "Underground South Tour Lobby" }, changed: ["spot"], blanked: ["address", "map_link"], errors: [] },
          { status: "unchanged", id: locations[pid].find((l) => l.hotel_name === "ZZ Test Hotel")?.id ?? null, row: 3, values: { hotel_name: "zz test hotel", spot: "Door 1", address: "1 Test St", map_link: "https://goo.gl/maps/zzz" }, before: {}, changed: [], blanked: [], errors: [] },
          { status: "new", id: null, row: 4, values: { hotel_name: "ZZ Test Import Hotel", spot: "Lobby", address: "2 Test St", map_link: "" }, before: {}, changed: ["spot", "address"], blanked: [], errors: [] },
          { status: "error", id: null, row: 5, values: { hotel_name: "ZZ Bad Link", spot: "", address: "", map_link: "goo.gl/x" }, before: {}, changed: [], blanked: [], errors: [{ field: "map_link", message: "The map link for ZZ Bad Link must start with http:// or https:// and have no spaces." }] },
        ];
        const counts = { new: 0, update: 0, unchanged: 0, error: 0 };
        for (const r of rows) counts[r.status]++;
        return send(res, 200, { columns: ["hotel_name", "spot", "address", "map_link"], rows, counts });
      }
      if (ctl.importConflict) return send(res, 409, { detail: "Someone changed this list while the file was being saved. Nothing was saved — check the preview again." });
      if (ctl.importFail) return send(res, 500, { detail: "Could not save. Nothing was changed - try again." });
      locations[pid].find((l) => l.id === 101).spot = "North Valet";
      locations[pid].push({ id: nextLocId++, hotel_name: "ZZ Test Import Hotel", spot: "Lobby", address: "2 Test St", map_link: "", sort_order: locations[pid].length });
      return send(res, 200, { created: 1, updated: 1, unchanged: 1, skipped: 1 });
    }
    m = sub.match(/^\/partners\/(\d+)\/(rates|locations|timetable(?:\/parse|\/apply|\/export\.csv)?)$/);
    if (m) {
      const pid = Number(m[1]);
      const what = m[2];
      if (what === "rates") {
        if (req.method === "PUT") {
          // G263 v3（后端 put_rates / _clean_products / _clean_prices 原话）：带 products 的团整组替换（顺序 = sort_order），
          // 没带 = 不动；旧主项价 adult_price / child_price 有值 ⇒ 400。名字必填、≤80、同团不重名（不分大小写）；
          // 每个产品至少一行价，票种只认 adult / child / infant、不重复，价钱必填、≥0；带来的 id 要还在这家这个团。一条不对 ⇒ 400、一条不写。
          const LABEL = { adult: "Adult", child: "Child", infant: "Infant" };
          const tourName = (r) => TOURS.find((t) => t.manifest_id === r.manifest_id)?.tour_name ?? r.tour_name;
          for (const r of entry.body) {
            const tour = tourName(r);
            if (r.adult_price != null || r.child_price != null) return send(res, 400, { detail: "Tour prices are now products. Reload the page." });
            if (r.products == null) continue;
            const seen = new Set();
            for (const it of r.products) {
              const name = String(it.name ?? "").trim();
              if (!name) return send(res, 400, { detail: `Every product on ${tour} needs a name.` });
              if (name.length > 80) return send(res, 400, { detail: `The product name on ${tour} is ${name.length} characters - the limit is 80.` });
              if (seen.has(name.toLowerCase())) return send(res, 400, { detail: `${name} is already on ${tour}.` });
              seen.add(name.toLowerCase());
              const where = `${name} on ${tour}`;
              if (!Array.isArray(it.prices) || !it.prices.length) return send(res, 400, { detail: `Enter a price for ${where}.` });
              const kinds = new Set();
              for (const x of it.prices) {
                if (!LABEL[x.ticket_type]) return send(res, 400, { detail: `Pick Adult, Child or Infant for every price on ${where}.` });
                if (kinds.has(x.ticket_type)) return send(res, 400, { detail: `${LABEL[x.ticket_type]} is listed twice on ${where}.` });
                kinds.add(x.ticket_type);
                if (x.price === null || x.price === undefined || x.price === "") return send(res, 400, { detail: `Enter the ${x.ticket_type} price on ${where}.` });
                if (typeof x.price === "boolean" || !Number.isFinite(Number(x.price))) return send(res, 400, { detail: `The ${x.ticket_type} price on ${where} must be a number such as 45 or 45.50.` });
                if (Number(x.price) < 0) return send(res, 400, { detail: `The ${x.ticket_type} price on ${where} cannot be negative.` });
              }
            }
          }
          for (const r of entry.body) {
            if (r.products == null) continue;
            const mine = new Set(((rates[pid] || []).find((o) => o.manifest_id === r.manifest_id)?.products || []).map((it) => it.id));
            if (r.products.some((it) => it.id != null && !mine.has(it.id))) return send(res, 400, { detail: "A product in the price list no longer exists. Reload the page and try again." });
          }
          if (ctl.itemsFail) return send(res, 500, { detail: "Database is busy" });
          const old = rates[pid] || [];
          rates[pid] = withNames(pid, old.map((o) => {
            const r = entry.body.find((x) => x.manifest_id === o.manifest_id);
            if (!r || r.products == null) return o;
            return { ...o, products: r.products.map((it) => ({ id: it.id ?? nextItemId++, name: String(it.name).trim(), prices: it.prices.map((x) => ({ ticket_type: x.ticket_type, price: Number(x.price) })) })) };
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
