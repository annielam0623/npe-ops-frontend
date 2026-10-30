"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchManifestSetup,
  saveCfmSections,
  saveForecastSplitSections,
  saveSectionOrder,
  saveManifestExtras,
  saveManifestGroup,
  saveManifestSection,
  saveRelayRound,
  saveSectionTourType,
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
  type MapZone,
} from "@/components/products/manifest-setup-map";
import { ForecastSetupFields } from "@/components/products/forecast-setup";
import {
  BUTTON,
  HINT,
  INPUT,
  MapField,
  SELECT,
  TD,
  TH,
} from "@/components/products/setup-ui";
import {
  CHANGED_RING,
  SaveControl,
  useAskUnsaved,
  useBlockSave,
} from "@/components/products/unsaved";
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
  onData,
  jumpTo,
}: {
  /** 商品换了组时 +1：重拉，产品清单不过时。 */
  version: number;
  onUnauthorized: () => void;
  /** 读到 / 改了设置就交出来（Products 表里非门票产品的 Tour type 按它显示，G130）。 */
  onData?: (data: ManifestSetup) => void;
  /**
   * Products 页顶部提醒区点了某团的「对不上的设置」跳过来（Annie 2026-10-23）：切到那个团、
   * 展开"Settings for other pages"、滚到并亮起那一条。manifestId 对不上任何团时不动。
   */
  jumpTo?: { manifestId: number; itemKey: string } | null;
}) {
  const [data, setData] = useState<ManifestSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  useEffect(() => {
    if (data) onDataRef.current?.(data);
  }, [data]);

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

  // 换团会丢掉这个团没存的改动：先问 Save / Don't save / Cancel（主窗口 eb 2026-10-30，同离开页面）。
  const askUnsaved = useAskUnsaved();
  async function switchGroup(id: number) {
    if (id === groupId) return;
    const prefix = `setup:${groupId}:`;
    if (!(await askUnsaved((k) => k.startsWith(prefix)))) return;
    setGroupId(id);
    setError(null);
  }
  const switchGroupRef = useRef(switchGroup);
  switchGroupRef.current = switchGroup;

  useEffect(() => {
    if (jumpTo && data?.groups.some((g) => g.id === jumpTo.manifestId)) {
      void switchGroupRef.current(jumpTo.manifestId);
    }
  }, [jumpTo, data]);

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
            onChange={(event) => void switchGroup(Number(event.target.value))}
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
            focusUnmatchedKey={
              jumpTo && jumpTo.manifestId === group.id ? jumpTo.itemKey : null
            }
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
const toExtraDrafts = (list: ManifestExtra[]): ExtraDraft[] => [
  ...list.map((e) => ({
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
  focusUnmatchedKey,
}: {
  group: ManifestSetupGroup;
  setup: ManifestSetup;
  onGroupChange: (g: ManifestSetupGroup) => void;
  onStart: () => void;
  onFail: (e: unknown) => void;
  focusUnmatchedKey?: string | null;
}) {
  const otherSettingsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (focusUnmatchedKey && otherSettingsRef.current) {
      otherSettingsRef.current.open = true;
    }
  }, [focusUnmatchedKey]);
  /** G199：后端带了 lunch_restaurant ⇒ 午餐店在 Supplier › Restaurant 管，这里只读、保存不再带 lunch_note。 */
  const restaurantMode = group.lunch_restaurant !== undefined;
  const groupRef = useRef(group);
  groupRef.current = group;

  // 改了先放在页面上，每一小项一个 Save（Annie 2026-10-29「不要改一点存一点」；主窗口 eb 2026-10-30 定「每个带标题的小项一个 Save」）。
  // 草稿只记改过的值（null = 没改，照已存的显示），重拉后没改的跟着新值。存好清掉草稿。
  // 都参加 10 分钟没活动自动存（./unsaved）；离开页面、换团先问。
  const [colorEdit, setColorEdit] = useState<string | null>(null);
  const [lunchEdit, setLunchEdit] = useState<string | null>(null);
  const [perBusEdit, setPerBusEdit] = useState<string | null>(null);
  const [splitEdit, setSplitEdit] = useState<string | null>(null);
  const [orderEdit, setOrderEdit] = useState<string | null>(null);
  const [relayEdit, setRelayEdit] = useState<string | null>(null);
  const [cfmEdit, setCfmEdit] = useState<string[] | null>(null);
  const [tourTypeEdits, setTourTypeEdits] = useState<Record<string, string>>(
    {},
  );
  const [sectionEdits, setSectionEdits] = useState<
    Record<number, SectionDraft>
  >({});
  /** 上一次 Save 里存不上的产品：行标红。 */
  const [sectionFailed, setSectionFailed] = useState<Set<number>>(new Set());
  const savedExtras = useMemo(
    () => toExtraDrafts(group.extras),
    [group.extras],
  );
  const [extrasEdit, setExtrasEdit] = useState<ExtraDraft[] | null>(null);

  /** 存着的颜色（"" = 默认灰）。 */
  const savedColorValue = group.manifest_color ?? "";
  const colorValue = colorEdit ?? savedColorValue;
  const color = colorValue || DEFAULT_GREY;
  const lunch = lunchEdit ?? group.manifest_lunch_note ?? "";
  const perBus = perBusEdit ?? String(group.guests_per_bus);
  const split = splitEdit ?? group.forecast_split_sections.join(", ");
  const order = orderEdit ?? (group.section_order ?? []).join(", ");
  const relay = relayEdit ?? group.relay_round ?? "";
  const cfmOn = cfmEdit ?? group.cfm_sections ?? [];
  const extras = extrasEdit ?? savedExtras;
  /** 左边指到 / Tab 到的那项设置：右边地图上对应那块亮起来（反过来指右边也一样）。 */
  const [zone, setZone] = useState<MapZone | null>(null);
  /** 示意图默认收起（Annie 2026-10-19：Bus Manifest 设置合并），点开才显示。 */
  const [showMap, setShowMap] = useState(false);

  /** 存不上：401 跳登录（返回 ""，不写字），其余返回后端原话。 */
  function failText(e: unknown): string {
    if (isStatus(e, 401)) {
      onFail(e);
      return "";
    }
    return describeError(e);
  }

  /**
   * 颜色 / 午餐行 / Guests per bus 都是同一个 PUT：后端每次都按 color 覆盖，所以没在改的那几项照已存的带上。
   * 同一组的这类保存排队一个个发（自动存和手按的 Save 撞在一起时），发的时候才读已存的值。
   */
  function putGroup(
    patch: (g: ManifestSetupGroup) => {
      color: string;
      lunch_note?: string;
      guests_per_bus?: string;
    },
  ): Promise<string | null> {
    const id = group.id;
    const run = async (): Promise<string | null> => {
      const body = patch(groupRef.current);
      try {
        const d = await saveManifestGroup(id, {
          color: body.color,
          ...(restaurantMode || body.lunch_note === undefined
            ? {}
            : { lunch_note: body.lunch_note }),
          ...(body.guests_per_bus === undefined
            ? {}
            : { guests_per_bus: body.guests_per_bus }),
        });
        const next = {
          ...groupRef.current,
          manifest_color: d.manifest_color,
          ...(restaurantMode
            ? {}
            : { manifest_lunch_note: d.manifest_lunch_note }),
          guests_per_bus: d.guests_per_bus,
        };
        groupRef.current = next;
        onGroupChange(next);
        return null;
      } catch (e) {
        return failText(e);
      }
    };
    const chained = (groupSaveChains.get(id) ?? Promise.resolve()).then(run);
    const tail = chained.then(() => undefined);
    groupSaveChains.set(id, tail);
    void tail.finally(() => {
      if (groupSaveChains.get(id) === tail) groupSaveChains.delete(id);
    });
    return chained;
  }

  const label = (what: string) => `${group.display_name}: ${what}`;
  const sid = (what: string) => `setup:${group.id}:${what}`;

  const colorBlock = useBlockSave({
    id: sid("color"),
    label: label("Colour"),
    dirty: colorValue !== savedColorValue,
    draftKey: colorValue,
    auto: true,
    doSave: async () => {
      const sent = colorValue;
      const err = await putGroup((g) => ({
        color: sent,
        lunch_note: g.manifest_lunch_note ?? "",
      }));
      if (err === null) setColorEdit(null);
      return err;
    },
  });

  const lunchBlock = useBlockSave({
    id: sid("lunch"),
    label: label("Lunch sheet line"),
    dirty: !restaurantMode && lunch !== (group.manifest_lunch_note ?? ""),
    draftKey: lunch,
    auto: true,
    doSave: async () => {
      const sent = lunch;
      const err = await putGroup((g) => ({
        color: g.manifest_color ?? "",
        lunch_note: sent,
      }));
      if (err === null) setLunchEdit(null);
      return err;
    },
  });

  // Guests per bus 送输入框原文，后端校验 1–99；不合规矩时红字写原因、框里的值不动（同旧页面）。
  const perBusBlock = useBlockSave({
    id: sid("perBus"),
    label: label("Guests per bus"),
    dirty: perBus !== String(group.guests_per_bus),
    draftKey: perBus,
    auto: true,
    doSave: async () => {
      const sent = perBus;
      const err = await putGroup((g) => ({
        color: g.manifest_color ?? "",
        lunch_note: g.manifest_lunch_note ?? "",
        guests_per_bus: sent,
      }));
      if (err === null) setPerBusEdit(null);
      return err;
    },
  });

  // Cfm # 格（G198）：整组替换。
  const cfmBlock = useBlockSave({
    id: sid("cfm"),
    label: label("Cfm # box per section"),
    dirty: !sameNames(cfmOn, group.cfm_sections ?? []),
    draftKey: JSON.stringify(cfmOn),
    auto: true,
    doSave: async () => {
      try {
        const d = await saveCfmSections(group.id, cfmOn);
        onGroupChange({ ...groupRef.current, cfm_sections: d.sections });
        setCfmEdit(null);
        return null;
      } catch (e) {
        return failText(e);
      }
    },
  });

  // 「Own block on the 7 Days Forecast」：逗号分开的节名，整组替换；失败红字写原因、框里的值不动（同旧页面）。
  const splitBlock = useBlockSave({
    id: sid("split"),
    label: label("Own block on the 7 Days Forecast"),
    dirty:
      splitList(split).join(", ") !== group.forecast_split_sections.join(", "),
    draftKey: split,
    auto: true,
    doSave: async () => {
      try {
        const d = await saveForecastSplitSections(group.id, splitList(split));
        onGroupChange({
          ...groupRef.current,
          forecast_split_sections: d.sections,
        });
        setSplitEdit(null);
        return null;
      } catch (e) {
        return failText(e);
      }
    },
  });

  // 「Section order」（G50）：逗号分开的节名，整组替换；失败红字写原因、框里的值不动（同旧页面 saveSecOrder）。
  const orderBlock = useBlockSave({
    id: sid("order"),
    label: label("Section order"),
    dirty:
      splitList(order).join(", ") !== (group.section_order ?? []).join(", "),
    draftKey: order,
    auto: true,
    doSave: async () => {
      try {
        const d = await saveSectionOrder(group.id, splitList(order));
        onGroupChange({ ...groupRef.current, section_order: d.sections });
        setOrderEdit(null);
        return null;
      } catch (e) {
        return failText(e);
      }
    },
  });

  // 「Morning Relay round」（后端 7c）。
  const relayBlock = useBlockSave({
    id: sid("relay"),
    label: label("Morning Relay round"),
    dirty: relay !== (group.relay_round ?? ""),
    draftKey: relay,
    auto: true,
    doSave: async () => {
      try {
        const d = await saveRelayRound(group.id, relay);
        onGroupChange({ ...groupRef.current, relay_round: d.relay_round });
        setRelayEdit(null);
        return null;
      } catch (e) {
        return failText(e);
      }
    },
  });

  // Extra 整组保存（同旧页面 saveExtras）：有一行只填了名字或座位就不存、红字说明；
  // 名字和座位都清空的那一行 = 删掉它，挂着它的产品后端会变回普通 Tour。
  const extraRows = extras.map((d) => ({
    id: d.id,
    name: d.name.trim(),
    seats: d.seats.trim(),
  }));
  const extrasHalf = extraRows.some((r) => !r.name !== !r.seats);
  const extrasFilled = extraRows.filter((r) => r.name);
  const extrasDirty =
    extrasHalf ||
    JSON.stringify(extrasFilled.map((r) => [r.id, r.name, r.seats])) !==
      JSON.stringify(group.extras.map((e) => [e.id, e.name, String(e.seats)]));
  const extrasBlock = useBlockSave({
    id: sid("extras"),
    label: label("Extras"),
    dirty: extrasDirty,
    draftKey: JSON.stringify(extraRows),
    auto: true,
    doSave: async () => {
      if (extrasHalf) return "Not saved: fill in both the name and the seats.";
      try {
        const d = await saveManifestExtras(
          group.id,
          extrasFilled.map((r) =>
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
        groupRef.current = next;
        onGroupChange(next);
        setExtrasEdit(null);
        return null;
      } catch (e) {
        return failText(e);
      }
    },
  });

  // 每节的默认 tour type（G130）：改了的几节一节一个 PATCH；存不上的那几节留着草稿。
  const tourTypeChanged = (group.section_tour_types ?? []).filter(
    (e) =>
      tourTypeEdits[e.section] !== undefined &&
      tourTypeEdits[e.section] !== (e.tour_type ?? ""),
  );
  const tourTypeBlock = useBlockSave({
    id: sid("tourTypes"),
    label: label("Default tour type per section"),
    dirty: tourTypeChanged.length > 0,
    draftKey: JSON.stringify(tourTypeEdits),
    auto: true,
    doSave: async () => {
      const fails: string[] = [];
      for (const e of tourTypeChanged) {
        const next = tourTypeEdits[e.section];
        try {
          const d = await saveSectionTourType(
            group.id,
            e.section,
            next || null,
          );
          const cur = groupRef.current;
          const updated = {
            ...cur,
            section_tour_types: (cur.section_tour_types ?? []).map((x) =>
              x.section === e.section
                ? { ...x, tour_type: d.tour_type ?? null }
                : x,
            ),
          };
          groupRef.current = updated;
          onGroupChange(updated);
          setTourTypeEdits((m) => {
            const rest = { ...m };
            delete rest[e.section];
            return rest;
          });
        } catch (err) {
          const t = failText(err);
          if (t === "") return "";
          fails.push(`${e.section || setup.default_section}: ${t}`);
        }
      }
      return fails.length ? fails.join(" · ") : null;
    },
  });

  /** 一批产品的 Section / Type / 回程依次存（后端没有批量接口）；存上的更新到组里、草稿去掉。 */
  async function saveSectionDrafts(
    list: { p: ManifestSetupProduct; d: SectionDraft }[],
  ): Promise<{
    saved: number;
    failures: { id: number; label: string; reason: string }[];
    unauthorized: boolean;
  }> {
    const done = new Map<number, ManifestSetupProduct>();
    const failures: { id: number; label: string; reason: string }[] = [];
    let unauthorized = false;
    for (const { p, d } of list) {
      const isExtra = d.type.startsWith("extra:");
      try {
        const r = await saveManifestSection(p.id, {
          section: d.section,
          kind: isExtra ? "tour" : (d.type as ManifestSectionKind),
          extra_id: isExtra ? Number(d.type.slice(6)) : null,
          return_pickup_time: d.rtime,
          return_pickup_place: d.rplace,
        });
        done.set(p.id, {
          ...p,
          manifest_section: r.section,
          manifest_section_kind: r.kind,
          manifest_extra_id: r.extra_id,
          return_pickup_time: r.return_pickup_time ?? "",
          return_pickup_place: r.return_pickup_place ?? "",
        });
      } catch (e) {
        if (isStatus(e, 401)) {
          onFail(e);
          unauthorized = true;
          break;
        }
        failures.push({
          id: p.id,
          label: p.product_code,
          reason: describeError(e),
        });
      }
    }
    if (done.size) {
      const cur = groupRef.current;
      const next = {
        ...cur,
        products: cur.products.map((x) => done.get(x.id) ?? x),
      };
      groupRef.current = next;
      onGroupChange(next);
      setSectionEdits((m) => {
        const rest = { ...m };
        for (const id of done.keys()) delete rest[id];
        return rest;
      });
    }
    return { saved: done.size, failures, unauthorized };
  }

  // Sections 产品表：整张表一个 Save；失败的产品留着草稿、行标红，红字写哪个产品、后端原话。
  const sectionOf = (p: ManifestSetupProduct): SectionDraft =>
    sectionEdits[p.id] ?? savedSectionDraft(p);
  const sectionChanged = group.products.filter((p) =>
    sectionDraftChanged(p, sectionOf(p)),
  );
  const sectionsBlock = useBlockSave({
    id: sid("sections"),
    label: label("Sections"),
    dirty: sectionChanged.length > 0,
    draftKey: JSON.stringify(sectionEdits),
    auto: true,
    doSave: async () => {
      const r = await saveSectionDrafts(
        sectionChanged.map((p) => ({ p, d: sectionOf(p) })),
      );
      if (r.unauthorized) return "";
      setSectionFailed(new Set(r.failures.map((f) => f.id)));
      return r.failures.length ? bulkResultText(r.saved, r.failures) : null;
    },
  });

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

  /**
   * 批量条的 Apply 是提交键：照页面上现在的值（含没存的改动）套上这次批量，马上存勾选的产品。
   * 存不上的留着勾选、行标红、写原因，这次批量的值留在页面上（等 Save 或再改）。
   */
  async function applyBulk() {
    const section = bulkSec.trim();
    if (bulkBusy || (!section && !bulkType)) return;
    setBulkBusy(true);
    setBulkResult(null);
    setFailedIds(new Set());
    onStart();
    const list: { p: ManifestSetupProduct; d: SectionDraft }[] = [];
    let unchanged = 0;
    for (const p of group.products.filter((x) => pickedIds.has(x.id))) {
      const cur = sectionOf(p);
      const d = {
        ...cur,
        section: section || cur.section,
        type: bulkType || cur.type,
      };
      if (sectionDraftChanged(p, d)) list.push({ p, d });
      else unchanged++;
    }
    const r = await saveSectionDrafts(list);
    if (r.unauthorized) {
      setBulkBusy(false);
      return;
    }
    if (r.failures.length)
      setSectionEdits((m) => {
        const next = { ...m };
        for (const f of r.failures) {
          const item = list.find((x) => x.p.id === f.id);
          if (item) next[f.id] = item.d;
        }
        return next;
      });
    setPickedIds(new Set(r.failures.map((f) => f.id)));
    setFailedIds(new Set(r.failures.map((f) => f.id)));
    setBulkResult(
      r.failures.length
        ? {
            tone: "error",
            text: bulkResultText(r.saved + unchanged, r.failures),
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
  const sectionsSaving = sectionsBlock.state.kind === "saving" || bulkBusy;
  const productRows = group.products.map((p) => (
    <Fragment key={p.id}>
      <SectionRow
        product={p}
        setup={setup}
        extras={group.extras}
        draft={sectionOf(p)}
        onDraft={(patch) =>
          setSectionEdits((m) => ({
            ...m,
            [p.id]: { ...sectionOf(p), ...patch },
          }))
        }
        changed={sectionDraftChanged(p, sectionOf(p))}
        disabled={sectionsSaving}
        picked={pickedIds.has(p.id)}
        failed={failedIds.has(p.id) || sectionFailed.has(p.id)}
        onPick={(on) => pick(p.id, on)}
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
      <button
        type="button"
        aria-expanded={showMap}
        onClick={() => setShowMap((v) => !v)}
        className={cn(BUTTON, "mb-2 self-start")}
      >
        {showMap
          ? "Hide where each setting prints"
          : "Show where each setting prints"}
      </button>
      <div
        className={cn(
          "grid gap-[18px]",
          showMap && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]",
        )}
      >
        <div className="grid min-w-0 content-start gap-3">
          <MapField
            {...field("color")}
            title="Colour"
            hint="The coloured bar across the top of every Bus Manifest page."
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                aria-label="Colour"
                value={color}
                onChange={(event) => setColorEdit(event.target.value)}
                className={cn(
                  "h-[30px] w-14 rounded-[6px] border-[0.5px] border-black/25 bg-paper px-0.5 night:border-white/10 night:bg-white/[.04]",
                  colorBlock.dirty && CHANGED_RING,
                )}
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
                onClick={() => setColorEdit("")}
              >
                Use default grey
              </button>
              <SaveControl block={colorBlock} />
            </div>
          </MapField>

          <MapField
            {...field("sections")}
            title="Sections"
            hint={`Which heading a product's guests are printed under. Leave it empty and they go under ${setup.default_section}. Fill it only for a part that should be its own section (for example LOWER KEN'S 1:00PM). For a shuttle pick Shuttle outbound or Shuttle inbound, or Shuttle round trip for one product that goes both ways the same day. For a combo like Heli pick its extra (set it up in Extras, right below). Click Save under the table to keep the changes.`}
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
            <SaveControl block={sectionsBlock} disabled={bulkBusy} />
          </MapField>

          {group.section_tour_types && setup.tour_types ? (
            <MapField
              {...field("sections")}
              sub
              title="Default tour type per section"
              hint="The tour type used when guests of this section are sent a tour confirmation. Pick it once per section. Sections come from the Section column above. Send tour confirmation on Manifests fills it in, and the automatic send uses it. Pick (not set) to clear it; the automatic send then skips that section. Shuttle sections do not have one. Click Save to keep it."
            >
              {group.section_tour_types.length ? (
                <>
                  <table className="w-auto border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        <th className={TH}>Section</th>
                        <th className={TH}>Tour type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.section_tour_types.map((e) => (
                        <SectionTourTypeRow
                          key={e.section}
                          entry={e}
                          value={tourTypeEdits[e.section] ?? e.tour_type ?? ""}
                          onChange={(v) =>
                            setTourTypeEdits((m) => ({ ...m, [e.section]: v }))
                          }
                          changed={tourTypeChanged.some(
                            (x) => x.section === e.section,
                          )}
                          disabled={tourTypeBlock.state.kind === "saving"}
                          label={e.section || setup.default_section}
                          options={setup.tour_types ?? []}
                        />
                      ))}
                    </tbody>
                  </table>
                  <SaveControl block={tourTypeBlock} />
                </>
              ) : (
                <span className={HINT}>
                  No Tour sections in this group yet.
                </span>
              )}
            </MapField>
          ) : null}

          {group.cfm_sections ? (
            <MapField
              {...field("sections")}
              sub
              title="Cfm # box per section"
              hint="Tick a section to give it a Cfm # box on its header row in Manifests (Bus tours). Fill the number there once per day; every bus with this section shows it in the section header on the Bus Manifest. It is only a record, nothing is sent. Shuttle sections do not have one. Click Save to keep it."
            >
              {cfmSectionNames(group).length ? (
                <table className="w-auto border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <th className={TH}>Section</th>
                      <th className={TH}>Show Cfm # box</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cfmSectionNames(group).map((name) => {
                      const has = (list: string[]) =>
                        list.some(
                          (s) => s.toLowerCase() === name.toLowerCase(),
                        );
                      const on = has(cfmOn);
                      const changed = on !== has(group.cfm_sections ?? []);
                      return (
                        <tr key={name} data-cfm-section={name}>
                          <td className={cn(TD, "font-medium")}>{name}</td>
                          <td className={TD}>
                            <label
                              className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] px-0.5",
                                changed && CHANGED_RING,
                              )}
                            >
                              <input
                                type="checkbox"
                                aria-label={`Show Cfm # box for ${name}`}
                                checked={on}
                                disabled={cfmBlock.state.kind === "saving"}
                                onChange={(event) =>
                                  setCfmEdit(
                                    event.target.checked
                                      ? [...cfmOn, name]
                                      : cfmOn.filter(
                                          (s) =>
                                            s.toLowerCase() !==
                                            name.toLowerCase(),
                                        ),
                                  )
                                }
                              />
                              Show
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <span className={HINT}>
                  No named Tour sections in this group yet.
                </span>
              )}
              <SaveControl block={cfmBlock} className="mt-1" />
            </MapField>
          ) : null}

          <MapField
            {...field("order")}
            sub
            title="Section order"
            hint="Not printed as text: the order the sections come in, top to bottom, on the Bus Manifest, Manifests and the 7 Days Forecast. Type the section names separated by commas (for example UPPER, LOWER, X) and click Save. Sections you leave out come after, A to Z. Shuttles always come last, outbound before inbound. Leave it empty to keep the old order."
          >
            <div className="flex items-center gap-3">
              <input
                type="text"
                aria-label="Section order"
                value={order}
                maxLength={1200}
                placeholder="UPPER, LOWER, X"
                disabled={orderBlock.state.kind === "saving"}
                onChange={(event) => setOrderEdit(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && orderBlock.dirty && orderBlock.save()
                }
                className={cn(
                  INPUT,
                  "w-full",
                  orderBlock.dirty && CHANGED_RING,
                )}
              />
              <SaveControl block={orderBlock} className="shrink-0" />
            </div>
          </MapField>

          <MapField
            {...field("extras")}
            sub
            title="Extras"
            hint={`For a combo product such as Heli. Its guests stay in their section on the Bus Manifest with the row shaded, and the bottom row shows NAME SEATS LEFT. On the Forecast they count in the tour's own rows. To add one, fill in the empty last row and click Save. Then pick it as the Type of each combo product in Sections above.`}
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
                      setExtrasEdit(
                        extras.map((d) =>
                          d.key === x.key ? { ...d, ...patch } : d,
                        ),
                      );
                    const was = group.extras.find((e) => e.id === x.id);
                    const changed = was
                      ? x.name.trim() !== was.name ||
                        x.seats.trim() !== String(was.seats)
                      : !!(x.name.trim() || x.seats.trim());
                    const ring = changed && CHANGED_RING;
                    const saving = extrasBlock.state.kind === "saving";
                    return (
                      <tr key={x.key} data-extra={x.id ?? ""}>
                        <td className={TD}>
                          <input
                            type="text"
                            aria-label="Extra name"
                            value={x.name}
                            maxLength={40}
                            placeholder={x.id === null ? "New extra" : ""}
                            disabled={saving}
                            onChange={(event) =>
                              set({ name: event.target.value })
                            }
                            className={cn(INPUT, ring)}
                          />
                        </td>
                        <td className={TD}>
                          <input
                            type="number"
                            aria-label="Seats"
                            value={x.seats}
                            min={1}
                            max={999}
                            disabled={saving}
                            onChange={(event) =>
                              set({ seats: event.target.value })
                            }
                            className={cn(INPUT, "w-20", ring)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SaveControl block={extrasBlock} />
          </MapField>

          {restaurantMode ? (
            // G199（preview 第 4 版 ③）：只读一行，改在 Supplier › Restaurant。
            <MapField
              {...field("lunch")}
              title="Lunch vendor"
              hint="The lunch sheet prints only for a tour with a lunch vendor. Its name and contact lines are kept in Supplier › Restaurant."
            >
              <p data-lunch-vendor className="m-0 text-[13px]">
                Lunch vendor:{" "}
                {group.lunch_restaurant ? (
                  <b>{group.lunch_restaurant.name}</b>
                ) : (
                  <span className="text-[#6b7280] night:text-white/50">
                    None (no lunch sheet)
                  </span>
                )}{" "}
                ·{" "}
                <Link
                  href="/supplier/restaurant"
                  className="text-[#1d4ed8] underline night:text-sky-300"
                >
                  Edit in Supplier › Restaurant
                </Link>
              </p>
            </MapField>
          ) : (
            <MapField
              {...field("lunch")}
              title="Lunch sheet line"
              hint="Printed at the bottom of this tour's lunch sheet (the sandwich order sheet), for example who to text about sandwiches. Up to two lines. Leave it empty and this tour prints no lunch sheet."
            >
              <textarea
                aria-label="Lunch sheet line"
                value={lunch}
                rows={2}
                maxLength={300}
                placeholder="(TEXT) POC: name phone ..."
                onChange={(event) =>
                  // 最多两行（后端三行 400）：第三个换行起并回第二行。
                  setLunchEdit(
                    event.target.value.replace(
                      /^([^\n]*\n[^\n]*)\n([\s\S]*)$/,
                      (_, two: string, rest: string) =>
                        `${two} ${rest.replace(/\n/g, " ")}`,
                    ),
                  )
                }
                disabled={lunchBlock.state.kind === "saving"}
                className={cn(
                  INPUT,
                  "h-auto w-full resize-none py-1 leading-[1.45]",
                  lunchBlock.dirty && CHANGED_RING,
                )}
              />
              <SaveControl block={lunchBlock} />
            </MapField>
          )}

          {/* 不是改 Bus Manifest 打印页的设置（Annie 2026-10-19：Bus Manifest 设置合并）：Dispatch 和 7 Days Forecast 用的，收在这里，默认收起。 */}
          <details
            ref={otherSettingsRef}
            data-other-settings
            className="rounded-[9px] border border-black/10 px-2.5 py-2 night:border-white/10"
          >
            <summary className="cursor-pointer text-[12.5px] font-bold text-[#22324a] night:text-white/90">
              Settings for other pages (Dispatch, 7 Days Forecast)
            </summary>
            <div className="mt-2 grid gap-3">
              <h3 className="m-0 text-[11px] font-bold tracking-[.06em] text-[#1a1a1a] uppercase night:text-white/55">
                Dispatch
              </h3>
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
                    disabled={perBusBlock.state.kind === "saving"}
                    onChange={(event) => setPerBusEdit(event.target.value)}
                    onKeyDown={(event) =>
                      event.key === "Enter" &&
                      perBusBlock.dirty &&
                      perBusBlock.save()
                    }
                    className={cn(
                      INPUT,
                      "w-20",
                      perBusBlock.dirty && CHANGED_RING,
                    )}
                  />
                  <SaveControl block={perBusBlock} />
                </div>
              </MapField>

              {setup.relay_rounds?.length ? (
                <MapField
                  {...field("relay")}
                  title="Morning Relay round"
                  hint="Not printed. On Dispatch, the round whose relay cars bring this tour's hotel guests to Treasure Island. Not on Morning Relay: the tour bus picks up its own hotel guests. Click Save to keep it."
                >
                  <div className="flex items-center gap-3">
                    <select
                      aria-label="Morning Relay round"
                      value={relay}
                      disabled={relayBlock.state.kind === "saving"}
                      onChange={(event) => setRelayEdit(event.target.value)}
                      className={cn(SELECT, relayBlock.dirty && CHANGED_RING)}
                    >
                      {setup.relay_rounds.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <SaveControl block={relayBlock} />
                  </div>
                </MapField>
              ) : null}

              <h3 className="m-0 text-[11px] font-bold tracking-[.06em] text-[#1a1a1a] uppercase night:text-white/55">
                7 Days Forecast
              </h3>
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
                    disabled={splitBlock.state.kind === "saving"}
                    onChange={(event) => setSplitEdit(event.target.value)}
                    onKeyDown={(event) =>
                      event.key === "Enter" &&
                      splitBlock.dirty &&
                      splitBlock.save()
                    }
                    className={cn(
                      INPUT,
                      "w-full",
                      splitBlock.dirty && CHANGED_RING,
                    )}
                  />
                  <SaveControl block={splitBlock} className="shrink-0" />
                </div>
              </MapField>

              <ForecastSetupFields
                manifestId={group.id}
                field={field}
                onStart={onStart}
                onFail={onFail}
                focusUnmatchedKey={focusUnmatchedKey}
              />
            </div>
          </details>
        </div>

        <div hidden={!showMap}>
          <ManifestMap
            group={group}
            defaultSection={setup.default_section}
            color={color}
            lunch={lunch}
            restaurant={restaurantMode ? group.lunch_restaurant : undefined}
            perBus={perBus}
            split={splitList(split)}
            order={splitList(order)}
            relay={
              setup.relay_rounds?.length
                ? {
                    value: relay,
                    label:
                      setup.relay_rounds.find((o) => o.value === relay)
                        ?.label ?? relay,
                  }
                : undefined
            }
            active={zone}
            onHover={setZone}
          />
        </div>
      </div>

      {/* .ms-howto */}
      <details className="rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-[18px] py-2.5 text-[12px] leading-[1.9] text-[#0c3a6b] night:border-sky-400/20 night:bg-sky-400/[.08] night:text-sky-300">
        <summary className="cursor-pointer font-semibold text-[#185FA5] night:text-sky-300">
          📖 How to use — Bus Manifest setup
        </summary>
        <ol className="list-decimal pl-[18px]">
          <li>
            Pick the tour at the top of this box. Show where each setting prints
            opens a small picture of the pages: point at a setting on the left
            to see where it shows on the right. The numbers match. Changes show
            on the next Bus Manifest you open or print. Seats come from Settings
            → Vehicles.
          </li>
          <li>
            Saving: each setting has its own Save. What you change turns orange
            and is not saved until you click Save; Saved shows in green, and a
            reason in red if it could not be saved. If the page has had no
            activity for 10 minutes, changes here save by themselves
            (Auto-saved). If you pick another tour or leave the page with
            changes not saved, the page asks first.
          </li>
          <li>
            Colour: pick a colour for the top bar of this tour&rsquo;s Bus
            Manifest, then click Save. Use default grey removes it.{" "}
            {restaurantMode ? (
              <>
                Lunch vendor: the lunch sheet prints only for a tour with a
                lunch vendor; pick the tours and the contact lines in Supplier ›
                Restaurant.
              </>
            ) : (
              <>
                Lunch sheet line: the contact line printed at the bottom of the
                lunch sheet (for example Bee&rsquo;s). Leave it empty and this
                tour prints no lunch sheet.
              </>
            )}
          </li>
          <li>
            Sections: type a section name next to a product only when it should
            be its own section, and pick Shuttle outbound or Shuttle inbound for
            shuttles. Every product of an agent (Canyontours.com, Gray Line …)
            needs the same name. Round-trip shuttles that come back the same day
            (one product for both ways): pick Shuttle round trip, then fill
            Return pickup time and Return pickup place under it, and click Save
            under the table. The guest then shows up twice on that day: in the
            outbound section (pickup from the order) and in the inbound section
            (the return pickup you typed). Not filled in shows as not set on the
            manifest. Next-day return products (for example PHN0QB) stay as they
            are: split them in Rezdy into a tour on day 1 and an inbound shuttle
            on day 2. Extras: type a name and its seats in the empty last row
            (for example HELI and 12) and click Save. Then pick Extra: HELI as
            the Type of each Heli product. To remove an extra, clear its name
            and seats; its products go back to Tour. Section order: type the
            section names from top to bottom, separated by commas (for example
            UPPER, LOWER, X), and click Save. The Forecast rows and the sections
            on Manifests follow this order. Sections you leave out come after, A
            to Z. Shuttles always come last, outbound before inbound. Leave the
            box empty to keep the old order.
          </li>
          <li>
            Settings for other pages (open the box under Lunch{" "}
            {restaurantMode ? "vendor" : "sheet line"}). Guests per bus: how
            many guests one bus is opened for on Dispatch (54 unless you change
            it). With 72 guests and 54, Dispatch opens Bus A and Bus B. It does
            not limit which vehicle you pick. Type a number from 1 to 99 and
            click Save.
            {setup.relay_rounds?.length ? (
              <>
                {" "}
                Morning Relay round: pick the round whose relay cars bring this
                tour&rsquo;s hotel guests to Treasure Island (1st Round or 2nd
                Round) and click Save. Not on Morning Relay means the tour bus
                picks up its own hotel guests, and they do not show in Morning
                Relay at all. The next Pull from manifests on Dispatch uses it.
              </>
            ) : null}
          </li>
          <li>
            7 Days Forecast: each Section becomes its own row under this tour on
            the Forecast, the same sections as the Bus Manifest. If a section
            leaves at a different time with its own bus (for example SUNSET on
            West Rim), type its name in Own block on the 7 Days Forecast and
            click Save. It then gets its own block and its own Total on the
            Forecast. Running days, Max allotments and List each order only
            change the 7 Days Forecast. Running days: untick a weekday the tour
            never runs, or add closed dates; those days show - instead of 0. Max
            allotments: type a time and the most guests for a row. Click the
            Save under List each order to keep these three; add a different cap
            for some dates in the table under it. List each order: tick it for
            Private, so each order is listed on the Forecast. A tour with its
            own block (for example SUNSET) has a tab per block.
          </li>
        </ol>
      </details>
    </>
  );
}

/**
 * Cfm # 勾选表列哪几节（G198）：这个团 Tour 产品用到的有名字的节（默认节没有名字，不列），
 * 按 Section order 排、没排的 A–Z；已经勾了、但现在没有产品的节也列出来，好取消。
 */
function cfmSectionNames(group: ManifestSetupGroup): string[] {
  const seen = new Map<string, string>();
  for (const p of group.products) {
    const name = p.manifest_section.trim();
    if (
      p.manifest_section_kind === "tour" &&
      name &&
      !seen.has(name.toLowerCase())
    )
      seen.set(name.toLowerCase(), name);
  }
  for (const name of group.cfm_sections ?? [])
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  const order = (group.section_order ?? []).map((s) => s.toLowerCase());
  const rank = (n: string) => {
    const i = order.indexOf(n.toLowerCase());
    return i < 0 ? order.length : i;
  };
  return [...seen.values()].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
}

/** 两份节名清单一样（不分大小写、不看顺序）。 */
function sameNames(a: string[], b: string[]): boolean {
  const norm = (l: string[]) =>
    [...new Set(l.map((s) => s.toLowerCase()))].sort().join("\n");
  return norm(a) === norm(b);
}

/** Sections 表一行的草稿：节名、Type（kind 或 "extra:<id>"）、往返 shuttle 的回程时间 / 地点（输入框原文）。 */
interface SectionDraft {
  section: string;
  type: string;
  rtime: string;
  rplace: string;
}

function savedSectionDraft(p: ManifestSetupProduct): SectionDraft {
  return {
    section: p.manifest_section,
    type: typeValue(p),
    rtime: p.return_pickup_time ?? "",
    rplace: p.return_pickup_place ?? "",
  };
}

function sectionDraftChanged(p: ManifestSetupProduct, d: SectionDraft) {
  const s = savedSectionDraft(p);
  return (
    d.section !== s.section ||
    d.type !== s.type ||
    d.rtime !== s.rtime ||
    d.rplace !== s.rplace
  );
}

/** 一节的默认 tour type（G130）：选了先放在页面上，和别的节一起按 Save 存。 */
function SectionTourTypeRow({
  entry,
  value,
  onChange,
  changed,
  disabled,
  label,
  options,
}: {
  entry: { section: string; tour_type: string | null };
  value: string;
  onChange: (v: string) => void;
  changed: boolean;
  disabled: boolean;
  label: string;
  options: { key: string; label: string }[];
}) {
  return (
    <tr data-section-tour-type={entry.section}>
      <td className={cn(TD, "font-medium")}>{label}</td>
      <td className={TD}>
        <select
          aria-label={`Tour type for ${label}`}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(SELECT, changed && CHANGED_RING)}
        >
          <option value="">(not set)</option>
          {options.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
          {/* 清单里已经没有的旧键照实显示，不让下拉落到别的选项上。 */}
          {value && !options.some((t) => t.key === value) ? (
            <option value={value}>{value}</option>
          ) : null}
        </select>
      </td>
    </tr>
  );
}

/** Sections 表的一行：改了先放在页面上（琥珀框），整张表按下面的 Save 才存。 */
function SectionRow({
  product: p,
  setup,
  extras,
  draft,
  onDraft,
  changed,
  disabled,
  picked,
  failed,
  onPick,
}: {
  product: ManifestSetupProduct;
  setup: ManifestSetup;
  /** 这个团的 Extra：Type 下拉在 Tour / Shuttle 之后各加一项「Extra: 名字」。 */
  extras: ManifestExtra[];
  draft: SectionDraft;
  onDraft: (patch: Partial<SectionDraft>) => void;
  changed: boolean;
  disabled: boolean;
  picked: boolean;
  failed: boolean;
  onPick: (on: boolean) => void;
}) {
  const s = savedSectionDraft(p);
  const ring = (k: keyof SectionDraft) => draft[k] !== s[k] && CHANGED_RING;
  return (
    <tr
      data-changed={changed || undefined}
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
          value={draft.section}
          maxLength={60}
          placeholder={setup.default_section}
          disabled={disabled}
          onChange={(event) => onDraft({ section: event.target.value })}
          className={cn(INPUT, "w-full min-w-[120px]", ring("section"))}
        />
      </td>
      <td className={TD}>
        <select
          aria-label={`Type for ${p.product_code}`}
          value={draft.type}
          disabled={disabled}
          onChange={(event) => onDraft({ type: event.target.value })}
          className={cn(SELECT, ring("type"))}
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
        {draft.type === "roundtrip" ? (
          <div className="mt-1 grid gap-[3px]">
            <input
              type="text"
              aria-label={`Return pickup time for ${p.product_code}`}
              value={draft.rtime}
              maxLength={20}
              placeholder="Return pickup time"
              disabled={disabled}
              onChange={(event) => onDraft({ rtime: event.target.value })}
              className={cn(INPUT, "w-[150px]", ring("rtime"))}
            />
            <input
              type="text"
              aria-label={`Return pickup place for ${p.product_code}`}
              value={draft.rplace}
              maxLength={80}
              placeholder="Return pickup place"
              disabled={disabled}
              onChange={(event) => onDraft({ rplace: event.target.value })}
              className={cn(INPUT, "w-[150px]", ring("rplace"))}
            />
          </div>
        ) : null}
      </td>
      <td className={TD}>
        {changed ? (
          <span className="text-[11.5px] font-semibold whitespace-nowrap text-[#8a5a00] night:text-amber-200">
            Not saved yet
          </span>
        ) : null}
      </td>
    </tr>
  );
}
