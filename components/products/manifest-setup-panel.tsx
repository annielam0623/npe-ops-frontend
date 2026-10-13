"use client";

import { useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchManifestSetup,
  saveForecastSplitSections,
  saveManifestExtras,
  saveManifestGroup,
  saveManifestSection,
} from "@/lib/products-api";
import { cn } from "@/lib/utils";
import {
  ManifestMap,
  Pin,
  PIN,
  type MapZone,
} from "@/components/products/manifest-setup-map";
import type {
  ManifestExtra,
  ManifestSectionKind,
  ManifestSetup,
  ManifestSetupGroup,
  ManifestSetupProduct,
} from "@/types";

const DEFAULT_GREY = "#c8cdd3";

// 旧模板 _manifest_setup_panel.html 自带的 ms- 样式（Annie 2026-10-07：和旧版一模一样）。
/** .ms-tbl input / .ms-row input[type=text] */
const INPUT =
  "h-7 rounded-[6px] border-[0.5px] border-black/25 night:border-white/10 bg-white night:bg-white/[.04] px-2 text-[13px] font-normal text-[#1a1a1a] night:text-white/90 focus:outline-none disabled:opacity-60";
/** .ms-tbl select */
const SELECT =
  "h-7 rounded-[6px] border-[0.5px] border-black/25 night:border-white/10 bg-white night:bg-white/[.04] text-[12.5px] text-[#1a1a1a] night:text-white/90";
const BUTTON_BASE =
  "h-[30px] cursor-pointer rounded-[7px] border px-3 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
/** .ms-btn */
const BUTTON = cn(
  BUTTON_BASE,
  "border-black/[.18] night:border-white/10 bg-white night:bg-white/[.04] text-[#1a1a1a] night:text-white/90",
);
/** .ms-tbl th */
const TH =
  "border-b border-black/10 night:border-white/10 px-1.5 py-[5px] text-left text-[11px] font-semibold text-[#666] night:text-white/55";
/** .ms-tbl td */
const TD =
  "border-b-[0.5px] border-black/[.07] night:border-white/10 px-1.5 py-1 align-middle";
/** .ms-hint */
const HINT = "text-[12px] text-[#666] night:text-white/55";
/** .ms-h */
const SUBHEAD =
  "m-0 text-[12.5px] font-bold text-[#22324a] night:text-white/90";

/** Extra 的编辑草稿（名字、座位按输入框原样，由后端校验）。id 为 null = 最后那一行空行（新加）。 */
interface ExtraDraft {
  key: number;
  id: number | null;
  name: string;
  seats: string;
}

/**
 * Bus Manifest setup：每个巴士团印出来的 Bus Manifest 长什么样（顶栏颜色、午餐单那一行、Extra、各产品的节和类型）。
 * 改了下一次打开 / 打印 Bus Manifest 就生效。
 * 后端 2026-10-12 `ad8b7ab`（migrate_v87）：底部按票型字眼计数的「Boxes」拿掉，换成 Extra（Heli 这类 combo 产品），照旧页面 _manifest_setup_panel.html。
 */
export function ManifestSetupPanel({
  version,
  onUnauthorized,
}: {
  /** 商品换了组时 +1：重拉，产品清单不过时。 */
  version: number;
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<ManifestSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    fetchManifestSetup(controller.signal)
      .then((d) => {
        setData(d);
        setLoadError(null);
        setGroupId((current) =>
          current !== null && d.groups.some((g) => g.id === current)
            ? current
            : (d.groups[0]?.id ?? null),
        );
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        setLoadError(describeError(e));
      });
    return () => controller.abort();
  }, [version]);

  const group = data?.groups.find((g) => g.id === groupId) ?? null;

  function replaceGroup(next: ManifestSetupGroup) {
    setData((d) =>
      d
        ? { ...d, groups: d.groups.map((g) => (g.id === next.id ? next : g)) }
        : d,
    );
  }

  /** 保存失败：401 跳登录，其余把原因显示在面板顶上（输入框由调用方改回原值）。 */
  function fail(e: unknown) {
    if (isStatus(e, 401)) {
      onUnauthorizedRef.current();
      return;
    }
    setError(describeError(e));
  }

  return (
    // .ms-card
    <section className="mb-4 overflow-hidden rounded-[12px] border-[0.5px] border-black/10 bg-white text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90">
      <div className="flex flex-wrap items-center gap-3 border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-[11px] night:border-white/10 night:bg-white/[.03]">
        <h2 className="text-[14.5px] font-bold">Bus Manifest setup</h2>
        {data && data.groups.length ? (
          <select
            aria-label="Tour group"
            value={groupId ?? ""}
            onChange={(event) => {
              setGroupId(Number(event.target.value));
              setError(null);
            }}
            className="h-[30px] rounded-[7px] border-[0.5px] border-black/25 bg-white px-1.5 text-[13px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
          >
            {data.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.display_name}
                {g.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        ) : null}
        <span className={HINT}>
          How the printed Bus Manifest looks for this tour.
        </span>
        {error || loadError ? (
          <span
            role="alert"
            className="text-[12.5px] text-[#b3261e] night:text-red-300"
          >
            {error ?? `Could not load: ${loadError}`}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3.5 px-4 pt-3 pb-4">
        {!data ? (
          loadError ? null : (
            <span className={HINT}>Loading…</span>
          )
        ) : !group ? (
          <span className={HINT}>No bus tour groups.</span>
        ) : (
          <GroupEditor
            key={group.id}
            group={group}
            setup={data}
            onGroupChange={replaceGroup}
            onStart={() => setError(null)}
            onFail={fail}
          />
        )}
      </div>
    </section>
  );
}

function useSavedFlag(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [
    saved,
    () => {
      setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 2000);
    },
  ];
}

function Saved({ show }: { show: boolean }) {
  return show ? (
    <span className="text-[12px] text-[#1e6b43] night:text-emerald-300">
      Saved
    </span>
  ) : null;
}

/** 逗号分开的节名 ⇒ 清单（去首尾空格、去空项，同旧页面 splitList）。 */
const splitList = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** 每组正在排队的颜色 / 午餐行保存（切走再切回来也接着排）。 */
const groupSaveChains = new Map<number, Promise<void>>();

let extraKey = 0;
/** 已有的 Extra + 最后一行空行（同旧页面：最后总有一行空的，填上就是新加一个）。 */
const toExtraDrafts = (g: ManifestSetupGroup): ExtraDraft[] => [
  ...g.extras.map((e) => ({
    key: ++extraKey,
    id: e.id,
    name: e.name,
    seats: String(e.seats),
  })),
  { key: ++extraKey, id: null, name: "", seats: "" },
];

/** 产品的 Type 下拉的值：挂了 Extra 的是 "extra:<id>"，否则是 kind（同旧页面 typeValue）。 */
const typeValue = (p: ManifestSetupProduct) =>
  p.manifest_extra_id !== null
    ? `extra:${p.manifest_extra_id}`
    : p.manifest_section_kind;

function GroupEditor({
  group,
  setup,
  onGroupChange,
  onStart,
  onFail,
}: {
  group: ManifestSetupGroup;
  setup: ManifestSetup;
  onGroupChange: (g: ManifestSetupGroup) => void;
  onStart: () => void;
  onFail: (e: unknown) => void;
}) {
  const savedColor = group.manifest_color || DEFAULT_GREY;
  const savedLunch = group.manifest_lunch_note ?? "";
  const [color, setColor] = useState(savedColor);
  const [lunch, setLunch] = useState(savedLunch);
  const [perBus, setPerBus] = useState(String(group.guests_per_bus));
  const [split, setSplit] = useState(group.forecast_split_sections.join(", "));
  const [splitSaved, flagSplitSaved] = useSavedFlag();
  const [groupSaved, flagGroupSaved] = useSavedFlag();
  const [extras, setExtras] = useState<ExtraDraft[]>(() =>
    toExtraDrafts(group),
  );
  /** Extra 那一块的提示：没填全时「Not saved yet…」，存好时 Saved。 */
  const [extrasNote, setExtrasNote] = useState("");
  const colorRef = useRef<HTMLInputElement>(null);
  /** 左边指到 / Tab 到的那项设置：右边地图上对应那块亮起来（反过来指右边也一样）。 */
  const [zone, setZone] = useState<MapZone | null>(null);

  // 要存的颜色（"" = 默认灰）和午餐行：每次真正发 PUT 时才读，保证最后一次操作的值不被旧值盖掉。
  const colorValueRef = useRef(group.manifest_color ?? "");
  const lunchRef = useRef(lunch);
  lunchRef.current = lunch;
  const groupRef = useRef(group);
  groupRef.current = group;
  const saveSeqRef = useRef(0);

  /**
   * 颜色和午餐行一起存（离开 Guests per bus 框时再带上它）；同一组的保存排队一个个发，PUT 按点击顺序落地。
   * Guests per bus 送输入框原文，后端校验 1–99；不合规矩时写原因、框里的值不动（同旧页面），改了再离开框重试。
   */
  function saveGroup(perBusText?: string) {
    onStart();
    const seq = ++saveSeqRef.current;
    const id = group.id;
    const run = async () => {
      const sentColor = colorValueRef.current;
      const sentLunch = lunchRef.current;
      try {
        const d = await saveManifestGroup(id, {
          color: sentColor,
          lunch_note: sentLunch,
          ...(perBusText === undefined ? {} : { guests_per_bus: perBusText }),
        });
        onGroupChange({
          ...groupRef.current,
          manifest_color: d.manifest_color,
          manifest_lunch_note: d.manifest_lunch_note,
          guests_per_bus: d.guests_per_bus,
        });
        if (perBusText !== undefined) setPerBus(String(d.guests_per_bus));
        // 后面还有排着的保存，或者人又改了，就不拿这次的结果盖输入框。
        if (seq === saveSeqRef.current) {
          if (colorValueRef.current === sentColor) {
            colorValueRef.current = d.manifest_color ?? "";
            setColor(d.manifest_color || DEFAULT_GREY);
          }
          if (lunchRef.current === sentLunch) {
            setLunch(d.manifest_lunch_note ?? "");
          }
        }
        flagGroupSaved();
      } catch (e) {
        // 失败改回已保存的值（旧页面不改回，看起来像存上了）。
        if (seq === saveSeqRef.current) {
          const saved = groupRef.current;
          colorValueRef.current = saved.manifest_color ?? "";
          setColor(saved.manifest_color || DEFAULT_GREY);
          setLunch(saved.manifest_lunch_note ?? "");
        }
        onFail(e);
      }
    };
    const chained = (groupSaveChains.get(id) ?? Promise.resolve()).then(run);
    groupSaveChains.set(id, chained);
    void chained.finally(() => {
      if (groupSaveChains.get(id) === chained) groupSaveChains.delete(id);
    });
  }

  // 取色器拖动时不停触发 input；只在选定（原生 change）时保存，同旧页面。
  const saveGroupRef = useRef(saveGroup);
  saveGroupRef.current = saveGroup;
  useEffect(() => {
    const el = colorRef.current;
    if (!el) return;
    const onChange = () => {
      colorValueRef.current = el.value;
      saveGroupRef.current();
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  /** 「Own block on the 60 Days Forecast」：逗号分开的节名，离开框时整组替换；失败写原因、框里的值不动（同旧页面）。 */
  async function saveSplit() {
    const next = splitList(split);
    if (next.join(", ") === group.forecast_split_sections.join(", ")) return;
    onStart();
    try {
      const d = await saveForecastSplitSections(group.id, next);
      onGroupChange({
        ...groupRef.current,
        forecast_split_sections: d.sections,
      });
      setSplit(d.sections.join(", "));
      flagSplitSaved();
    } catch (e) {
      onFail(e);
    }
  }

  /**
   * Extra 整组保存（离开任何一个框时，同旧页面 saveExtras）：有一行只填了名字或座位就先不存（免得填到一半报错）；
   * 和已存的一样也不存。名字和座位都清空的那一行 = 删掉它，挂着它的产品后端会变回普通 Tour。
   */
  async function saveExtras(drafts: ExtraDraft[]) {
    const rows = drafts.map((d) => ({
      id: d.id,
      name: d.name.trim(),
      seats: d.seats.trim(),
    }));
    if (rows.some((r) => !r.name !== !r.seats)) {
      setExtrasNote("Not saved yet - fill in both the name and the seats.");
      return;
    }
    const filled = rows.filter((r) => r.name);
    const same =
      JSON.stringify(filled.map((r) => [r.id, r.name, r.seats])) ===
      JSON.stringify(group.extras.map((e) => [e.id, e.name, String(e.seats)]));
    if (same) {
      setExtrasNote("");
      return;
    }
    onStart();
    try {
      const d = await saveManifestExtras(
        group.id,
        filled.map((r) =>
          r.id === null
            ? { name: r.name, seats: r.seats }
            : { id: r.id, name: r.name, seats: r.seats },
        ),
      );
      // 删掉的 Extra：挂着它的产品已经变回普通 Tour，这里跟着改（下拉里不留一个已经没有的选项）。
      const ids = new Set(d.extras.map((e) => e.id));
      const next = {
        ...groupRef.current,
        extras: d.extras,
        products: groupRef.current.products.map((p) =>
          p.manifest_extra_id !== null && !ids.has(p.manifest_extra_id)
            ? { ...p, manifest_extra_id: null }
            : p,
        ),
      };
      onGroupChange(next);
      setExtras(toExtraDrafts(next));
      setExtrasNote("Saved");
    } catch (e) {
      setExtrasNote("");
      onFail(e);
    }
  }

  const field = (z: MapZone) => ({ zone: z, active: zone, onZone: setZone });
  const productRows = group.products.map((p) => (
    <SectionRow
      // 产品挂的 Extra 被删掉（后端变回 Tour）时重建这一行，下拉显示新值。
      key={`${p.id}:${p.manifest_extra_id ?? ""}`}
      product={p}
      setup={setup}
      extras={group.extras}
      onSaved={(next) =>
        onGroupChange({
          ...group,
          products: group.products.map((x) => (x.id === next.id ? next : x)),
        })
      }
      onStart={onStart}
      onFail={onFail}
    />
  ));

  return (
    <>
      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="grid min-w-0 content-start gap-3">
          <MapField
            {...field("color")}
            title="Colour"
            hint="The coloured bar across the top of every Bus Manifest page."
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={colorRef}
                type="color"
                aria-label="Colour"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-[30px] w-14 rounded-[6px] border-[0.5px] border-black/25 bg-white px-0.5 night:border-white/10 night:bg-white/[.04]"
              />
              <span
                className="inline-flex h-[30px] items-center rounded-[4px] px-3.5 text-[14px] font-extrabold text-[#1a1a1a]"
                style={{ background: color }}
              >
                {group.display_name}
              </span>
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  colorValueRef.current = "";
                  setColor(DEFAULT_GREY);
                  saveGroup();
                }}
              >
                Use default grey
              </button>
            </div>
          </MapField>

          <MapField
            {...field("sections")}
            title="Sections"
            hint={`Which heading a product's guests are printed under. Leave it empty and they go under ${setup.default_section}. Fill it only for a part that should be its own section (for example LOWER KEN'S 1:00PM). For a shuttle pick Shuttle outbound or Shuttle inbound. For a combo like Heli pick its extra (set it up in ${PIN.extras}). It saves when you leave the box.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className={TH}>Product (from Rezdy)</th>
                    <th className={TH}>Code</th>
                    <th className={TH}>Section</th>
                    <th className={TH}>Type</th>
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody>{productRows}</tbody>
              </table>
            </div>
          </MapField>

          <MapField
            {...field("extras")}
            title="Extras"
            hint={`For a combo product such as Heli. Its guests stay in their section on the Bus Manifest with the row shaded, and the bottom row shows NAME SEATS LEFT. On the Forecast they count in the tour's own rows. To add one, fill in the empty last row. Then pick it as the Type of each combo product in ${PIN.sections}.`}
          >
            <div className="overflow-x-auto">
              <table className="w-auto border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className={TH}>Name</th>
                    <th className={TH}>Seats</th>
                  </tr>
                </thead>
                <tbody>
                  {extras.map((x) => {
                    const set = (patch: Partial<ExtraDraft>) =>
                      setExtras((list) =>
                        list.map((d) =>
                          d.key === x.key ? { ...d, ...patch } : d,
                        ),
                      );
                    return (
                      <tr key={x.key} data-extra={x.id ?? ""}>
                        <td className={TD}>
                          <input
                            type="text"
                            aria-label="Extra name"
                            value={x.name}
                            maxLength={40}
                            placeholder={x.id === null ? "New extra" : ""}
                            onChange={(event) =>
                              set({ name: event.target.value })
                            }
                            onBlur={() => void saveExtras(extras)}
                            className={INPUT}
                          />
                        </td>
                        <td className={TD}>
                          <input
                            type="number"
                            aria-label="Seats"
                            value={x.seats}
                            min={1}
                            max={999}
                            onChange={(event) =>
                              set({ seats: event.target.value })
                            }
                            onBlur={() => void saveExtras(extras)}
                            className={cn(INPUT, "w-20")}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {extrasNote ? (
              <span
                className={
                  extrasNote === "Saved"
                    ? "text-[12px] text-[#1e6b43] night:text-emerald-300"
                    : "text-[12px] text-[#8a5a00] night:text-amber-200"
                }
              >
                {extrasNote}
              </span>
            ) : null}
          </MapField>

          <MapField
            {...field("lunch")}
            title="Lunch sheet line"
            hint="Printed at the bottom of this tour's lunch sheet (the sandwich order sheet), for example who to text about sandwiches. Leave it empty and this tour prints no lunch sheet."
          >
            <input
              type="text"
              aria-label="Lunch sheet line"
              value={lunch}
              maxLength={300}
              placeholder="(TEXT) POC: name phone ..."
              onChange={(event) => setLunch(event.target.value)}
              onBlur={() => {
                if (lunchRef.current !== savedLunch) saveGroup();
              }}
              className={cn(INPUT, "w-full")}
            />
          </MapField>

          <MapField
            {...field("perBus")}
            title="Guests per bus"
            hint="Not printed. On Dispatch, how many guests one bus is opened for: 72 guests at 54 per bus opens Bus A and Bus B. It does not limit which vehicle you pick. A number from 1 to 99."
          >
            <div className="flex items-center gap-3">
              <input
                type="number"
                aria-label="Guests per bus"
                value={perBus}
                min={1}
                max={99}
                onChange={(event) => setPerBus(event.target.value)}
                onBlur={() => {
                  if (perBus !== String(group.guests_per_bus))
                    saveGroup(perBus);
                }}
                className={cn(INPUT, "w-20")}
              />
              <Saved show={groupSaved} />
            </div>
          </MapField>

          <MapField
            {...field("split")}
            title="Own block on the 60 Days Forecast"
            hint="Not printed. Only for a section that leaves at a different time with its own bus, for example SUNSET on West Rim. Type its name (several: separate with commas); on the Forecast it gets its own block and its own Total. Most tours leave this empty."
          >
            <div className="flex items-center gap-3">
              <input
                type="text"
                aria-label="Own block on the 60 Days Forecast"
                value={split}
                maxLength={400}
                placeholder="SUNSET"
                onChange={(event) => setSplit(event.target.value)}
                onBlur={() => void saveSplit()}
                className={cn(INPUT, "w-full")}
              />
              <Saved show={splitSaved} />
            </div>
          </MapField>
        </div>

        <ManifestMap
          group={group}
          defaultSection={setup.default_section}
          color={color}
          lunch={lunch}
          perBus={perBus}
          split={splitList(split)}
          active={zone}
          onHover={setZone}
        />
      </div>

      {/* .ms-howto */}
      <details className="rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-[18px] py-2.5 text-[12px] leading-[1.9] text-[#0c3a6b] night:border-sky-400/20 night:bg-sky-400/[.08] night:text-sky-300">
        <summary className="cursor-pointer font-semibold text-[#185FA5] night:text-sky-300">
          📖 How to use — Bus Manifest setup
        </summary>
        <ol className="list-decimal pl-[18px]">
          <li>Pick the tour at the top of this box.</li>
          <li>
            Point at a setting on the left to see where it shows on the right.
            The numbers match.
          </li>
          <li>
            Colour: pick a colour for the top bar of this tour&rsquo;s Bus
            Manifest. It saves right away. Use default grey removes it.
          </li>
          <li>
            Lunch sheet line: the contact line printed at the bottom of the
            lunch sheet (for example Bee&rsquo;s). Leave it empty and this tour
            prints no lunch sheet.
          </li>
          <li>
            Guests per bus: how many guests one bus is opened for on Dispatch
            (54 unless you change it). With 72 guests and 54, Dispatch opens Bus
            A and Bus B. It does not limit which vehicle you pick. Type a number
            from 1 to 99 and click outside the box to save.
          </li>
          <li>
            Extras: type a name and its seats in the empty last row (for example
            HELI and 12) and click outside the box. Then pick Extra: HELI as the
            Type of each Heli product. To remove an extra, clear its name and
            seats; its products go back to Tour.
          </li>
          <li>
            Sections: type a section name next to a product only when it should
            be its own section, and pick Shuttle outbound or Shuttle inbound for
            shuttles. Every product of an agent (Canyontours.com, Gray Line …)
            needs the same name.
          </li>
          <li>
            Changes show on the next Bus Manifest you open or print. Seats come
            from Settings → Vehicles.
          </li>
          <li>
            60 Days Forecast: each Section becomes its own row under this tour
            on the Forecast, the same sections as the Bus Manifest. If a section
            leaves at a different time with its own bus (for example SUNSET on
            West Rim), type its name in Own block on the 60 Days Forecast and
            click outside the box. It then gets its own block and its own Total
            on the Forecast.
          </li>
        </ol>
      </details>
    </>
  );
}

/** 左边一项设置：编号 + 标题 + 灰字说明（这项印在哪 / 用在哪）。指到或 Tab 进来时整块描橙色，右边对应位置跟着亮。 */
function MapField({
  zone,
  active,
  onZone,
  title,
  hint,
  children,
}: {
  zone: MapZone;
  active: MapZone | null;
  onZone: (z: MapZone | null) => void;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const on = active === zone;
  return (
    <div
      data-field={zone}
      onMouseEnter={() => onZone(zone)}
      onMouseLeave={() => onZone(null)}
      onFocus={() => onZone(zone)}
      onBlur={() => onZone(null)}
      className={cn(
        "grid grid-cols-[26px_minmax(0,1fr)] gap-2.5 rounded-[9px] border px-2.5 py-2",
        on
          ? "border-[#e8590c] bg-[#e8590c]/[.08] night:bg-[#e8590c]/[.15]"
          : "border-transparent",
      )}
    >
      <Pin zone={zone} />
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className={SUBHEAD}>{title}</h3>
        <p className={cn(HINT, "m-0 leading-[1.5]")}>{hint}</p>
        {children}
      </div>
    </div>
  );
}

function SectionRow({
  product: p,
  setup,
  extras,
  onSaved,
  onStart,
  onFail,
}: {
  product: ManifestSetupProduct;
  setup: ManifestSetup;
  /** 这个团的 Extra：Type 下拉在 Tour / Shuttle 之后各加一项「Extra: 名字」。 */
  extras: ManifestExtra[];
  onSaved: (p: ManifestSetupProduct) => void;
  onStart: () => void;
  onFail: (e: unknown) => void;
}) {
  const [section, setSection] = useState(p.manifest_section);
  /** Type 下拉的值：kind，或 "extra:<id>"（= kind tour + extra_id，同旧页面）。 */
  const [type, setType] = useState(typeValue(p));
  const [saved, flagSaved] = useSavedFlag();

  async function save(nextSection: string, nextType: string) {
    if (nextSection === p.manifest_section && nextType === typeValue(p)) {
      return;
    }
    const isExtra = nextType.startsWith("extra:");
    onStart();
    try {
      const d = await saveManifestSection(p.id, {
        section: nextSection,
        kind: isExtra ? "tour" : (nextType as ManifestSectionKind),
        extra_id: isExtra ? Number(nextType.slice(6)) : null,
      });
      const next = {
        ...p,
        manifest_section: d.section,
        manifest_section_kind: d.kind,
        manifest_extra_id: d.extra_id,
      };
      setSection(d.section);
      setType(typeValue(next));
      onSaved(next);
      flagSaved();
    } catch (e) {
      setSection(p.manifest_section);
      setType(typeValue(p));
      onFail(e);
    }
  }

  return (
    <tr className={p.is_active ? undefined : "text-[#999] night:text-white/35"}>
      <td className={cn(TD, "min-w-[160px]")}>
        {p.product_name}
        {p.internal_name ? (
          <span className={HINT}> ({p.internal_name})</span>
        ) : null}
      </td>
      <td className={TD}>{p.product_code}</td>
      <td className={TD}>
        <input
          type="text"
          aria-label={`Section for ${p.product_code}`}
          value={section}
          maxLength={60}
          placeholder={setup.default_section}
          onChange={(event) => setSection(event.target.value)}
          onBlur={() => void save(section, type)}
          className={cn(INPUT, "w-full min-w-[120px]")}
        />
      </td>
      <td className={TD}>
        <select
          aria-label={`Type for ${p.product_code}`}
          value={type}
          onChange={(event) => {
            const next = event.target.value;
            setType(next);
            void save(section, next);
          }}
          className={SELECT}
        >
          {setup.kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
          {extras.map((e) => (
            <option key={`extra:${e.id}`} value={`extra:${e.id}`}>
              Extra: {e.name}
            </option>
          ))}
        </select>
      </td>
      <td className={TD}>
        <Saved show={saved} />
      </td>
    </tr>
  );
}
