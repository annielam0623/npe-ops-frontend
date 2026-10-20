"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchManifestSetup,
  saveForecastSplitSections,
  saveSectionOrder,
  saveManifestExtras,
  saveManifestGroup,
  saveManifestSection,
  saveRelayRound,
} from "@/lib/products-api";
import { cn } from "@/lib/utils";
import {
  BULK_MIN,
  BulkBar,
  BulkBarRow,
  BulkResultText,
  bulkResultText,
  lastPickedIndex,
} from "@/components/products/bulk-bar";
import { BULK_SELECT_CLASS } from "@/components/products/legacy-ui";
import {
  ManifestMap,
  PIN,
  type MapZone,
} from "@/components/products/manifest-setup-map";
import { ForecastSetupFields } from "@/components/products/forecast-setup";
import {
  BUTTON,
  HINT,
  INPUT,
  MapField,
  SELECT,
  Saved,
  TD,
  TH,
  useSavedFlag,
} from "@/components/products/setup-ui";
import type {
  ManifestExtra,
  ManifestSectionKind,
  ManifestSetup,
  ManifestSetupGroup,
  ManifestSetupProduct,
} from "@/types";

const DEFAULT_GREY = "#c8cdd3";

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
    <section className="mb-4 overflow-hidden rounded-[12px] border-[0.5px] border-black/10 bg-paper text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90">
      <div className="flex flex-wrap items-center gap-3 border-b-[0.5px] border-black/[.08] bg-paper px-4 py-[11px] night:border-white/10 night:bg-white/[.03]">
        <h2 className="text-[14.5px] font-bold">Bus Manifest setup</h2>
        {data && data.groups.length ? (
          <select
            aria-label="Tour group"
            value={groupId ?? ""}
            onChange={(event) => {
              setGroupId(Number(event.target.value));
              setError(null);
            }}
            className="h-[30px] rounded-[7px] border-[0.5px] border-black/25 bg-paper px-1.5 text-[13px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
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
  const [order, setOrder] = useState((group.section_order ?? []).join(", "));
  const [orderSaved, flagOrderSaved] = useSavedFlag();
  const [groupSaved, flagGroupSaved] = useSavedFlag();
  const [relay, setRelay] = useState(group.relay_round ?? "");
  const [relaySaved, flagRelaySaved] = useSavedFlag();
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

  /** 「Own block on the 7 Days Forecast」：逗号分开的节名，离开框时整组替换；失败写原因、框里的值不动（同旧页面）。 */
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

  /** 「Section order」（G50）：逗号分开的节名，离开框时整组替换；失败写原因、框里的值不动（同旧页面 saveSecOrder）。 */
  async function saveOrder() {
    const next = splitList(order);
    if (next.join(", ") === (group.section_order ?? []).join(", ")) return;
    onStart();
    try {
      const d = await saveSectionOrder(group.id, next);
      onGroupChange({ ...groupRef.current, section_order: d.sections });
      setOrder(d.sections.join(", "));
      flagOrderSaved();
    } catch (e) {
      onFail(e);
    }
  }

  /** 「Morning Relay round」（后端 7c）：选了就存；失败改回已存的值、写原因。 */
  async function saveRelay(next: string) {
    setRelay(next);
    onStart();
    try {
      const d = await saveRelayRound(group.id, next);
      onGroupChange({ ...groupRef.current, relay_round: d.relay_round });
      setRelay(d.relay_round ?? "");
      flagRelaySaved();
    } catch (e) {
      setRelay(groupRef.current.relay_round ?? "");
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
  // ── 批量改 Section / Type（Annie 2026-10-19）：勾 2 个以上，批量条贴在最后一个已勾行下面 ──
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  const [bulkSec, setBulkSec] = useState("");
  const [bulkType, setBulkType] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  /** 上一次批量里存失败的产品：行标红、仍勾着。 */
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [bulkResult, setBulkResult] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  // 换了一个团：上一个团的勾选不带过来。
  useEffect(() => {
    setPickedIds(new Set());
    setBulkResult(null);
  }, [group.id]);

  function pick(id: number, on: boolean) {
    setBulkResult(null);
    setFailedIds(new Set());
    setPickedIds((set) => {
      if (!set.size && on) {
        setBulkSec("");
        setBulkType("");
      }
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function applyBulk() {
    const section = bulkSec.trim();
    if (bulkBusy || (!section && !bulkType)) return;
    setBulkBusy(true);
    setBulkResult(null);
    setFailedIds(new Set());
    onStart();
    // 后端没有批量接口：一个个顺序存；失败的留着勾选、写原因，不静默丢。
    const saved = new Map<number, ManifestSetupProduct>();
    const failures: { id: number; label: string; reason: string }[] = [];
    let unchanged = 0;
    for (const prod of group.products.filter((x) => pickedIds.has(x.id))) {
      const nextSection = section || prod.manifest_section;
      const nextType = bulkType || typeValue(prod);
      if (
        nextSection === prod.manifest_section &&
        nextType === typeValue(prod)
      ) {
        unchanged++;
        continue;
      }
      const isExtra = nextType.startsWith("extra:");
      try {
        const d = await saveManifestSection(prod.id, {
          section: nextSection,
          kind: isExtra ? "tour" : (nextType as ManifestSectionKind),
          extra_id: isExtra ? Number(nextType.slice(6)) : null,
          return_pickup_time: prod.return_pickup_time ?? "",
          return_pickup_place: prod.return_pickup_place ?? "",
        });
        saved.set(prod.id, {
          ...prod,
          manifest_section: d.section,
          manifest_section_kind: d.kind,
          manifest_extra_id: d.extra_id,
          return_pickup_time: d.return_pickup_time ?? "",
          return_pickup_place: d.return_pickup_place ?? "",
        });
      } catch (e) {
        if (isStatus(e, 401)) {
          onFail(e);
          setBulkBusy(false);
          return;
        }
        failures.push({
          id: prod.id,
          label: prod.product_code,
          reason: describeError(e),
        });
      }
    }
    if (saved.size) {
      onGroupChange({
        ...group,
        products: group.products.map((x) => saved.get(x.id) ?? x),
      });
    }
    setPickedIds(new Set(failures.map((f) => f.id)));
    setFailedIds(new Set(failures.map((f) => f.id)));
    setBulkResult(
      failures.length
        ? {
            tone: "error",
            text: bulkResultText(saved.size + unchanged, failures),
          }
        : null,
    );
    setBulkBusy(false);
  }

  const lastPicked = lastPickedIndex(group.products, (x) =>
    pickedIds.has(x.id),
  );
  const barAfterId =
    pickedIds.size >= BULK_MIN && lastPicked >= 0
      ? group.products[lastPicked].id
      : null;
  const allPicked =
    group.products.length > 0 && pickedIds.size === group.products.length;
  const productRows = group.products.map((p) => (
    <Fragment key={`${p.id}:${p.manifest_extra_id ?? ""}`}>
      <SectionRow
        // 产品挂的 Extra 被删掉（后端变回 Tour）时重建这一行，下拉显示新值。
        product={p}
        setup={setup}
        extras={group.extras}
        picked={pickedIds.has(p.id)}
        failed={failedIds.has(p.id)}
        onPick={(on) => pick(p.id, on)}
        onSaved={(next) =>
          onGroupChange({
            ...group,
            products: group.products.map((x) => (x.id === next.id ? next : x)),
          })
        }
        onStart={onStart}
        onFail={onFail}
      />
      {barAfterId === p.id ? (
        <BulkBarRow colSpan={6}>
          <BulkBar
            count={pickedIds.size}
            applyDisabled={bulkBusy || (!bulkSec.trim() && !bulkType)}
            onApply={() => void applyBulk()}
            onClear={() => {
              setPickedIds(new Set());
              setFailedIds(new Set());
              setBulkResult(null);
            }}
            result={bulkResult}
            hint={
              bulkSec.trim() || bulkType
                ? null
                : "Leave Section empty to keep each product's own. Round-trip return times are set per row."
            }
          >
            <input
              type="text"
              aria-label="Section for selected"
              value={bulkSec}
              maxLength={60}
              placeholder="Section: leave as is"
              onChange={(event) => setBulkSec(event.target.value)}
              className="rounded-[6px] border-[0.5px] border-white/25 bg-[#2a2a2a] px-2 py-1 text-[12px] text-white"
            />
            <select
              aria-label="Type for selected"
              value={bulkType}
              onChange={(event) => setBulkType(event.target.value)}
              className={BULK_SELECT_CLASS}
            >
              <option value="">— type: leave as is —</option>
              {setup.kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
              {group.extras.map((e) => (
                <option key={`extra:${e.id}`} value={`extra:${e.id}`}>
                  Extra: {e.name}
                </option>
              ))}
            </select>
          </BulkBar>
        </BulkBarRow>
      ) : null}
    </Fragment>
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
                className="h-[30px] w-14 rounded-[6px] border-[0.5px] border-black/25 bg-paper px-0.5 night:border-white/10 night:bg-white/[.04]"
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
            hint={`Which heading a product's guests are printed under. Leave it empty and they go under ${setup.default_section}. Fill it only for a part that should be its own section (for example LOWER KEN'S 1:00PM). For a shuttle pick Shuttle outbound or Shuttle inbound, or Shuttle round trip for one product that goes both ways the same day. For a combo like Heli pick its extra (set it up in ${PIN.extras}). It saves when you leave the box.`}
          >
            {bulkResult && pickedIds.size < BULK_MIN ? (
              <BulkResultText result={bulkResult} className="mb-1.5" />
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className={cn(TH, "w-[28px] pr-0")}>
                      <input
                        type="checkbox"
                        aria-label="Select all products in this group"
                        checked={allPicked}
                        disabled={!group.products.length}
                        onChange={(event) => {
                          setBulkResult(null);
                          if (event.target.checked && !pickedIds.size) {
                            setBulkSec("");
                            setBulkType("");
                          }
                          setPickedIds(
                            event.target.checked
                              ? new Set(group.products.map((x) => x.id))
                              : new Set(),
                          );
                        }}
                      />
                    </th>
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
            {...field("order")}
            title="Section order"
            hint="Not printed as text: the order the sections come in, top to bottom, on the Bus Manifest, Manifests and the 7 Days Forecast. Type the section names separated by commas (for example UPPER, LOWER, X) and click outside the box. Sections you leave out come after, A to Z. Shuttles always come last, outbound before inbound. Leave it empty to keep the old order."
          >
            <div className="flex items-center gap-3">
              <input
                type="text"
                aria-label="Section order"
                value={order}
                maxLength={1200}
                placeholder="UPPER, LOWER, X"
                onChange={(event) => setOrder(event.target.value)}
                onBlur={() => void saveOrder()}
                className={cn(INPUT, "w-full")}
              />
              <Saved show={orderSaved} />
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
            title="Own block on the 7 Days Forecast"
            hint="Not printed. Only for a section that leaves at a different time with its own bus, for example SUNSET on West Rim. Type its name (several: separate with commas); on the Forecast it gets its own block and its own Total. Most tours leave this empty."
          >
            <div className="flex items-center gap-3">
              <input
                type="text"
                aria-label="Own block on the 7 Days Forecast"
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

          {setup.relay_rounds?.length ? (
            <MapField
              {...field("relay")}
              title="Morning Relay round"
              hint="Not printed. On Dispatch, the round whose relay cars bring this tour's hotel guests to Treasure Island. Not on Morning Relay: the tour bus picks up its own hotel guests. It saves right away."
            >
              <div className="flex items-center gap-3">
                <select
                  aria-label="Morning Relay round"
                  value={relay}
                  onChange={(event) => void saveRelay(event.target.value)}
                  className={SELECT}
                >
                  {setup.relay_rounds.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Saved show={relaySaved} />
              </div>
            </MapField>
          ) : null}

          <ForecastSetupFields
            manifestId={group.id}
            field={field}
            onStart={onStart}
            onFail={onFail}
          />
        </div>

        <ManifestMap
          group={group}
          defaultSection={setup.default_section}
          color={color}
          lunch={lunch}
          perBus={perBus}
          split={splitList(split)}
          order={splitList(order)}
          relay={
            setup.relay_rounds?.length
              ? {
                  value: relay,
                  label:
                    setup.relay_rounds.find((o) => o.value === relay)?.label ??
                    relay,
                }
              : undefined
          }
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
            Round-trip shuttles that come back the same day (one product for
            both ways): pick Shuttle round trip, then fill Return pickup time
            and Return pickup place under it. Each box saves when you leave it.
            The guest then shows up twice on that day: in the outbound section
            (pickup from the order) and in the inbound section (the return
            pickup you typed). Not filled in shows as not set on the manifest.
            Next-day return products (for example PHN0QB) stay as they are:
            split them in Rezdy into a tour on day 1 and an inbound shuttle on
            day 2.
          </li>
          <li>
            Section order: type the section names from top to bottom, separated
            by commas (for example UPPER, LOWER, X), and click outside the box.
            The Forecast rows and the sections on Manifests follow this order.
            Sections you leave out come after, A to Z. Shuttles always come
            last, outbound before inbound. Leave the box empty to keep the old
            order.
          </li>
          {setup.relay_rounds?.length ? (
            <li>
              Morning Relay round: pick the round whose relay cars bring this
              tour&rsquo;s hotel guests to Treasure Island (1st Round or 2nd
              Round). It saves right away. Not on Morning Relay means the tour
              bus picks up its own hotel guests, and they do not show in Morning
              Relay at all. The next Pull from manifests on Dispatch uses it.
            </li>
          ) : null}
          <li>
            Running days, Max allotments and List each order only change the 7
            Days Forecast. Running days: untick a weekday the tour never runs,
            or add closed dates; those days show - instead of 0. Max allotments:
            type a time and the most guests for a row and click outside the box;
            add a different cap for some dates in the table under it. List each
            order: tick it for Private, so each order is listed on the Forecast.
            A tour with its own block (for example SUNSET) has a tab per block.
          </li>
          <li>
            Changes show on the next Bus Manifest you open or print. Seats come
            from Settings → Vehicles.
          </li>
          <li>
            7 Days Forecast: each Section becomes its own row under this tour on
            the Forecast, the same sections as the Bus Manifest. If a section
            leaves at a different time with its own bus (for example SUNSET on
            West Rim), type its name in Own block on the 7 Days Forecast and
            click outside the box. It then gets its own block and its own Total
            on the Forecast.
          </li>
        </ol>
      </details>
    </>
  );
}

function SectionRow({
  product: p,
  setup,
  extras,
  picked,
  failed,
  onPick,
  onSaved,
  onStart,
  onFail,
}: {
  product: ManifestSetupProduct;
  picked: boolean;
  failed: boolean;
  onPick: (on: boolean) => void;
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
  // 往返 shuttle 的回程（G36）：只有 Type = Shuttle round trip 时显示（同旧 _manifest_setup_panel.html）。
  const [rtime, setRtime] = useState(p.return_pickup_time ?? "");
  const [rplace, setRplace] = useState(p.return_pickup_place ?? "");
  const [saved, flagSaved] = useSavedFlag();
  // 批量改过以后（外面的值变了），这一行的输入框跟着变。
  useEffect(() => {
    setSection(p.manifest_section);
    setType(typeValue(p));
    setRtime(p.return_pickup_time ?? "");
    setRplace(p.return_pickup_place ?? "");
    // typeValue(p) 由 kind 和 extra_id 决定，这里只在这几个值变时同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    p.manifest_section,
    p.manifest_section_kind,
    p.manifest_extra_id,
    p.return_pickup_time,
    p.return_pickup_place,
  ]);

  async function save(
    nextSection: string,
    nextType: string,
    nextRtime = rtime,
    nextRplace = rplace,
  ) {
    if (
      nextSection === p.manifest_section &&
      nextType === typeValue(p) &&
      nextRtime === (p.return_pickup_time ?? "") &&
      nextRplace === (p.return_pickup_place ?? "")
    ) {
      return;
    }
    const isExtra = nextType.startsWith("extra:");
    onStart();
    try {
      const d = await saveManifestSection(p.id, {
        section: nextSection,
        kind: isExtra ? "tour" : (nextType as ManifestSectionKind),
        extra_id: isExtra ? Number(nextType.slice(6)) : null,
        return_pickup_time: nextRtime,
        return_pickup_place: nextRplace,
      });
      const next = {
        ...p,
        manifest_section: d.section,
        manifest_section_kind: d.kind,
        manifest_extra_id: d.extra_id,
        return_pickup_time: d.return_pickup_time ?? "",
        return_pickup_place: d.return_pickup_place ?? "",
      };
      setSection(d.section);
      setType(typeValue(next));
      setRtime(next.return_pickup_time);
      setRplace(next.return_pickup_place);
      onSaved(next);
      flagSaved();
    } catch (e) {
      setSection(p.manifest_section);
      setType(typeValue(p));
      setRtime(p.return_pickup_time ?? "");
      setRplace(p.return_pickup_place ?? "");
      onFail(e);
    }
  }

  return (
    <tr
      className={cn(
        p.is_active ? undefined : "text-[#999] night:text-white/35",
        picked && "bg-[#f0f6ff] night:bg-sky-400/[.08]",
        failed && "bg-[#fdecec] night:bg-red-400/10",
      )}
    >
      <td className={cn(TD, "w-[28px] pr-0")}>
        <input
          type="checkbox"
          aria-label={`Select ${p.product_code}`}
          checked={picked}
          onChange={(event) => onPick(event.target.checked)}
        />
      </td>
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
        {type === "roundtrip" ? (
          <div className="mt-1 grid gap-[3px]">
            <input
              type="text"
              aria-label={`Return pickup time for ${p.product_code}`}
              value={rtime}
              maxLength={20}
              placeholder="Return pickup time"
              onChange={(event) => setRtime(event.target.value)}
              onBlur={() => void save(section, type, rtime, rplace)}
              className={cn(INPUT, "w-[150px]")}
            />
            <input
              type="text"
              aria-label={`Return pickup place for ${p.product_code}`}
              value={rplace}
              maxLength={80}
              placeholder="Return pickup place"
              onChange={(event) => setRplace(event.target.value)}
              onBlur={() => void save(section, type, rtime, rplace)}
              className={cn(INPUT, "w-[150px]")}
            />
          </div>
        ) : null}
      </td>
      <td className={TD}>
        <Saved show={saved} />
      </td>
    </tr>
  );
}
