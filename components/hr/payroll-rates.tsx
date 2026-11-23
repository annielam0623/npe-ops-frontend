"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { usePhoneInfo } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  deletePayrollExtraRate,
  deletePayrollPrice,
  deletePayrollVehicleRate,
  fetchPayrollRates,
  savePayrollExtraRate,
  savePayrollPrice,
  savePayrollVehicleRate,
} from "@/lib/guide-payroll-api";
import { cn } from "@/lib/utils";
import type {
  PayrollExtraRate,
  PayrollExtraRateInput,
  PayrollLock,
  PayrollPerson,
  PayrollPersonRef,
  PayrollPrice,
  PayrollPriceInput,
  PayrollRates as PayrollRatesData,
  PayrollRun,
  PayrollVehicleRate,
} from "@/types/guide-payroll";

import {
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
} from "./legacy-ui";
import {
  amountError,
  C_BTN,
  C_BTN_ADD,
  C_BTN_SAVE,
  C_CK,
  C_DIM,
  C_FLABEL,
  C_FORMROW,
  C_GREEN,
  C_GRP_TD,
  C_HINT,
  C_INPUT,
  C_LINK,
  C_LOCKED,
  C_NUM,
  C_RED,
  C_ROW_GONE,
  C_ROW_PENDING,
  C_SAVEBAR,
  C_STICKY,
  C_SUBH,
  C_TABLE,
  C_TD,
  C_TH,
  C_WRAP,
  cardDatesOf,
  cardMoney,
  dateError,
  lockCovering,
  lockSentence,
} from "./payroll-cards-shared";
import { SelectMenu } from "@/components/ui/select-menu";

/**
 * Payroll › Pay rates 卡（138 乙，5a）：价格按团排一张表（V9 题 5 A）+ Extras 表。
 * 加 / 改 / 删全部先暂存在页面上（淡黄底 / 淡红删除线），按蓝「Save rates」依次 PUT / DELETE。
 * 碰到锁的行不能改、不能删（🔒 Locked）。Extras 的 Applies to 选人照合同 v3（v170）；旧后端没带 = Everyone。
 * 离开拦截由页面（payroll.tsx）统一挂：这里只通过 onDirtyChange 报有没有没存的改动。
 */

interface PersonOpt {
  key: string;
  hr_id: number | null;
  name: string;
  in_hr: boolean;
}

interface TourOpt {
  key: string;
  manifest_id: number | null;
  custom_tour: string | null;
  tour: string;
}

interface PriceRow {
  key: string;
  id: number | null;
  manifest_id: number | null;
  custom_tour: string | null;
  tour: string;
  from: string;
  to: string | null;
  applies_to: "all" | "people";
  people: PersonOpt[];
  guide_fee: string;
  driver_guide_fee: string;
  ant_relay: boolean;
}

interface ExtraRow {
  key: string;
  id: number | null;
  code: string;
  name: string;
  from: string;
  to: string | null;
  amount: string;
  applies_to: "all" | "people";
  people: PersonOpt[];
  isNew: boolean;
}

interface PriceForm {
  id: number | null;
  tourKey: string;
  typed: string;
  from: string;
  to: string;
  applies: "all" | "people";
  people: string[];
  g: string;
  dg: string;
  ant: boolean;
}

interface ExtraForm {
  /** 改哪一行（Edit，Annie 2026-11-17「Extras 的 Edit…一起动手」）；null = 新加。 */
  id: number | null;
  code: string;
  name: string;
  from: string;
  to: string;
  amount: string;
  applies: "all" | "people";
  people: string[];
}

/** G363：Pay rates › Vehicle extras 一行（已存的或暂存的）。 */
interface VehicleRow {
  key: string;
  id: number | null;
  model: string;
  manifest_id: number;
  tour: string;
  mode: "add" | "total";
  amount: string;
  from: string;
  to: string | null;
}

interface VehicleForm {
  /** 改哪一行；null = 新加。改的时候车型和团固定（合同）。 */
  id: number | null;
  /** 下拉选的车型；TYPED = 手打。 */
  modelSel: string;
  typed: string;
  /** 团（只能是有 manifest 的团，合同要 manifest_id）；"" = 还没选。 */
  tourKey: string;
  mode: "add" | "total";
  amount: string;
  from: string;
  to: string;
}

const MODE_LABEL: Record<"add" | "total", string> = {
  add: "Add to the driver-guide fee",
  total: "Total for the run",
};

function fromVehicle(v: PayrollVehicleRate): VehicleRow {
  return {
    key: `v${v.id}`,
    id: v.id,
    model: v.model,
    manifest_id: v.manifest_id,
    tour: v.tour,
    mode: v.mode,
    amount: v.amount,
    from: v.from,
    to: v.to,
  };
}

const TYPED = "__typed";
const NEW_EXTRA = "__new";
/** 系统自带的 ANT relay（后端按这个 code 判断「只能在价格 ANT relay = Yes 的团上勾」）。 */
const ANT_RELAY_CODE = "ant_relay";

/** 同后端 save_extra_rate 由名字生成 code 的写法（小写、非字母数字换成 _、去头尾 _）：比名字是不是同一个加购项。 */
function extraSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const tourKeyOf = (manifestId: number | null, name: string) =>
  manifestId !== null ? `m:${manifestId}` : `c:${norm(name)}`;
const personKey = (hrId: number | null, name: string) =>
  hrId !== null ? `hr:${hrId}` : `typed:${norm(name)}`;
const refToOpt = (p: PayrollPersonRef): PersonOpt => ({
  key: p.person_key || personKey(p.hr_id, p.name),
  hr_id: p.hr_id,
  name: p.name,
  in_hr: p.hr_id !== null,
});

function fromPrice(p: PayrollPrice): PriceRow {
  return {
    key: `p${p.id}`,
    id: p.id,
    manifest_id: p.manifest_id,
    custom_tour: p.custom_tour,
    tour: p.tour,
    from: p.from,
    to: p.to,
    applies_to: p.applies_to,
    people: p.people.map(refToOpt),
    guide_fee: p.guide_fee,
    driver_guide_fee: p.driver_guide_fee,
    ant_relay: p.ant_relay,
  };
}

function fromExtra(x: PayrollExtraRate): ExtraRow {
  return {
    key: `x${x.id}`,
    id: x.id,
    code: x.code,
    name: x.name,
    from: x.from,
    to: x.to,
    amount: x.amount,
    applies_to: x.applies_to ?? "all",
    people: (x.people ?? []).map(refToOpt),
    isNew: false,
  };
}

const kindOf = (p: PriceRow) =>
  p.applies_to === "people" ? "Picked people" : p.to ? "Date range" : "Default";
const KIND_ORDER: Record<string, number> = {
  Default: 0,
  "Date range": 1,
  "Picked people": 2,
};

const whoOf = (applies: "all" | "people", people: PersonOpt[]) =>
  applies === "all" ? "Everyone" : people.map((p) => p.name).join(", ");

function peopleBody(people: PersonOpt[]) {
  return people.map((p) =>
    p.hr_id !== null ? { hr_id: p.hr_id } : { name: p.name },
  );
}

/** 两位小数的字符串（"230" → "230.00"），给暂存行显示和比较用。 */
const two = (v: string) => Number(v).toFixed(2);

let draftSeq = 0;

export interface PayrollRatesProps {
  canEdit: boolean;
  onUnauthorized: () => void;
  /** 有没存的改动时 true（页面挂离开拦截、换期拦截）。 */
  onDirtyChange: (dirty: boolean) => void;
  /** 至少存好一项后调用：页面重拉期间数据。 */
  onSaved: () => void;
  /** 这一期的人（P.people）：Applies to 选人用，含手打导游。 */
  people?: PayrollPerson[];
  /** 这一期的趟（P.runs + P.unpaid）：Tour 下拉补上还没价格的团。 */
  runs?: PayrollRun[];
  /** + Add price / + Add extra 表单里 From 的默认值（这一期第一天）。 */
  defaultFrom?: string;
  /** 每次读到 GET /api/payroll/rates 后调用（G363：页面用 vehicle_rates 判断 Use the price 后会不会有补贴）。 */
  onLoaded?: (data: PayrollRatesData) => void;
}

export function PayrollRates({
  canEdit,
  onUnauthorized,
  onDirtyChange,
  onSaved,
  onLoaded,
  people,
  runs,
  defaultFrom,
}: PayrollRatesProps) {
  const [data, setData] = useState<PayrollRatesData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const [priceDraft, setPriceDraft] = useState<PriceRow[]>([]);
  const [priceEdits, setPriceEdits] = useState<Record<number, PriceRow>>({});
  const [priceGone, setPriceGone] = useState<number[]>([]);
  const [extraDraft, setExtraDraft] = useState<ExtraRow[]>([]);
  const [extraGone, setExtraGone] = useState<number[]>([]);
  /** 改过、还没存的已存加购项行（照 priceEdits）。 */
  const [extraEdits, setExtraEdits] = useState<Record<number, ExtraRow>>({});
  /** G363 车型补贴：暂存的新行 / 改过的已存行 / 要删的（同 Prices、Extras，按 Save rates 才存）。 */
  const [vDraft, setVDraft] = useState<VehicleRow[]>([]);
  const [vEdits, setVEdits] = useState<Record<number, VehicleRow>>({});
  const [vGone, setVGone] = useState<number[]>([]);
  const [vf, setVf] = useState<VehicleForm | null>(null);
  const [vfErr, setVfErr] = useState<string | null>(null);

  const [pf, setPf] = useState<PriceForm | null>(null);
  const [pfErr, setPfErr] = useState<string | null>(null);
  const [xf, setXf] = useState<ExtraForm | null>(null);
  const [xfErr, setXfErr] = useState<string | null>(null);

  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const pricesInfo = usePhoneInfo("About prices");
  const extrasInfo = usePhoneInfo("About extras");
  const vehicleInfo = usePhoneInfo("About vehicle extras");

  const load = useCallback(
    (signal?: AbortSignal) => {
      fetchPayrollRates(signal)
        .then((d) => {
          setData(d);
          setLoadErr(null);
          onLoaded?.(d);
        })
        .catch((e: unknown) => {
          if (signal?.aborted) return;
          if (isStatus(e, 401)) {
            onUnauthorized();
            return;
          }
          setLoadErr(describeError(e));
        });
    },
    [onUnauthorized, onLoaded],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const dirtyCount =
    priceDraft.length +
    Object.keys(priceEdits).length +
    priceGone.length +
    extraDraft.length +
    Object.keys(extraEdits).length +
    extraGone.length +
    vDraft.length +
    Object.keys(vEdits).length +
    vGone.length;

  useEffect(() => {
    onDirtyChange(dirtyCount > 0);
  }, [dirtyCount, onDirtyChange]);

  const locks: PayrollLock[] = useMemo(() => data?.locks ?? [], [data]);
  const savedPrices = useMemo(
    () => (data?.rates ?? []).filter((p) => p.active).map(fromPrice),
    [data],
  );
  const savedExtras = useMemo(
    () => (data?.extra_rates ?? []).filter((x) => x.active).map(fromExtra),
    [data],
  );
  const savedVehicles = useMemo(
    () => (data?.vehicle_rates ?? []).filter((v) => v.active).map(fromVehicle),
    [data],
  );

  const tourOpts: TourOpt[] = useMemo(() => {
    const m = new Map<string, TourOpt>();
    const add = (manifestId: number | null, name: string) => {
      if (!name.trim()) return;
      const key = tourKeyOf(manifestId, name);
      if (!m.has(key)) {
        m.set(key, {
          key,
          manifest_id: manifestId,
          custom_tour: manifestId === null ? name.trim() : null,
          tour: name.trim(),
        });
      }
    };
    for (const p of savedPrices) add(p.manifest_id, p.tour);
    for (const r of runs ?? []) add(r.manifest_id, r.tour);
    return [...m.values()].sort(
      (a, b) =>
        Number(a.manifest_id === null) - Number(b.manifest_id === null) ||
        a.tour.localeCompare(b.tour),
    );
  }, [savedPrices, runs]);

  const personOpts: PersonOpt[] = useMemo(() => {
    const m = new Map<string, PersonOpt>();
    // 名单 = HR 所有 Guide / Driver + Guide（后端 rates.guides）+ 本期手打名字的导游 + 已存个人价的人
    // （Annie 样稿第 1 版「3题都全部同意推荐」）。同一 hr_id 只出一次。
    for (const g of data?.guides ?? []) {
      if (!g.name?.trim()) continue;
      const key = personKey(g.hr_id, g.name);
      if (!m.has(key))
        m.set(key, { key, hr_id: g.hr_id, name: g.name.trim(), in_hr: true });
    }
    for (const p of people ?? []) {
      if (!p.name?.trim()) continue;
      const key = personKey(p.hr_id, p.name);
      if (!m.has(key))
        m.set(key, {
          key,
          hr_id: p.hr_id,
          name: p.name.trim(),
          in_hr: p.in_hr,
        });
    }
    for (const r of [...savedPrices, ...savedExtras]) {
      for (const p of r.people) if (!m.has(p.key)) m.set(p.key, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.guides, people, savedPrices, savedExtras]);

  const priceRows: (PriceRow & { saved: boolean; edited: boolean })[] = [
    ...savedPrices.map((p) => ({
      ...(p.id !== null && priceEdits[p.id] ? priceEdits[p.id] : p),
      saved: true,
      edited: p.id !== null && !!priceEdits[p.id],
    })),
    ...priceDraft.map((p) => ({ ...p, saved: false, edited: false })),
  ];
  const extraRows: (ExtraRow & { saved: boolean; edited: boolean })[] = [
    ...savedExtras.map((x) => ({
      ...(x.id !== null && extraEdits[x.id] ? extraEdits[x.id] : x),
      saved: true,
      edited: x.id !== null && !!extraEdits[x.id],
    })),
    ...extraDraft.map((x) => ({ ...x, saved: false, edited: false })),
  ];

  const touched = () => {
    setStatus("idle");
    setSaveErr(null);
  };

  // ── 价格表单 ──────────────────────────────────────────
  function openNewPrice() {
    setPf({
      id: null,
      tourKey: tourOpts[0]?.key ?? TYPED,
      typed: "",
      from: defaultFrom ?? "",
      to: "",
      applies: "all",
      people: [],
      g: "",
      dg: "",
      ant: false,
    });
    setPfErr(null);
  }

  function openEditPrice(row: PriceRow) {
    setPf({
      id: row.id,
      tourKey: tourKeyOf(row.manifest_id, row.tour),
      typed: "",
      from: row.from,
      to: row.to ?? "",
      applies: row.applies_to,
      people: row.people.map((p) => p.key),
      g: two(row.guide_fee),
      dg: two(row.driver_guide_fee),
      ant: row.ant_relay,
    });
    setPfErr(null);
  }

  function addPrice() {
    if (!pf) return;
    const typed = pf.tourKey === TYPED;
    const opt = typed ? null : tourOpts.find((t) => t.key === pf.tourKey);
    const tourName = typed ? pf.typed.trim() : (opt?.tour ?? "");
    const err = (() => {
      if (!tourName) return "Type the tour name as it is on Dispatch.";
      const de = dateError(pf.from, "from");
      if (de) return de;
      if (pf.to) {
        const te = dateError(pf.to, "to");
        if (te) return te;
        if (pf.to < pf.from) return "'To' can't be before 'from'.";
      }
      const ae = amountError(pf.g) || amountError(pf.dg);
      if (ae) return ae;
      if (pf.applies === "people" && !pf.people.length)
        return "Pick at least one person.";
      const l = lockCovering(locks, pf.from, pf.to || null);
      if (l) return lockSentence(l);
      return null;
    })();
    if (err) {
      setPfErr(err);
      return;
    }
    const manifestId = typed ? null : (opt?.manifest_id ?? null);
    const key = tourKeyOf(manifestId, tourName);
    const picked = personOpts.filter((p) => pf.people.includes(p.key));
    // 同一团、同一天起、同样对谁 ⇒ 后端会 400，页面先挡（同原句）。
    const dup = priceRows.find(
      (p) =>
        p.id !== pf.id &&
        !(p.id !== null && priceGone.includes(p.id)) &&
        tourKeyOf(p.manifest_id, p.tour) === key &&
        p.from === pf.from &&
        p.applies_to === pf.applies &&
        (pf.applies === "all" ||
          p.people.some((x) => pf.people.includes(x.key))),
    );
    if (dup) {
      const who =
        pf.applies === "all"
          ? "everyone"
          : (dup.people.find((x) => pf.people.includes(x.key))?.name ?? "");
      setPfErr(
        `${tourName} already has a price for ${who} starting ${pf.from}. Change that one instead.`,
      );
      return;
    }
    const row: PriceRow = {
      key: pf.id !== null ? `p${pf.id}` : `d${++draftSeq}`,
      id: pf.id,
      manifest_id: manifestId,
      custom_tour: manifestId === null ? tourName : null,
      tour: tourName,
      from: pf.from,
      to: pf.to || null,
      applies_to: pf.applies,
      people: pf.applies === "all" ? [] : picked,
      guide_fee: two(pf.g),
      driver_guide_fee: two(pf.dg),
      ant_relay: pf.ant,
    };
    if (pf.id !== null) {
      const id = pf.id;
      setPriceEdits((m) => ({ ...m, [id]: row }));
    } else {
      setPriceDraft((d) => [...d, row]);
    }
    setPf(null);
    setPfErr(null);
    touched();
  }

  // ── 加购项表单 ────────────────────────────────────────
  const extraCodes = useMemo(() => {
    const m = new Map<string, string>();
    // 后端的加购项名单（含行全删了的）：给已有加购项加金额要带 code，不然同名会生成 long_day_2（Annie 2026-11-17）。
    for (const x of data?.extras ?? [])
      if (!m.has(x.code)) m.set(x.code, x.name);
    for (const x of savedExtras) if (!m.has(x.code)) m.set(x.code, x.name);
    // 旧后端（没有 extras 名单）兜底：ANT relay 是系统自带的加购项（v168 种的 code ant_relay，算钱按这个 code 认），
    // 行全被 Remove 以后 GET rates 不再回它，下拉里也要有；PUT 带 code ant_relay 后端会照旧加一段新金额。
    if (!m.has(ANT_RELAY_CODE)) m.set(ANT_RELAY_CODE, "ANT relay");
    return [...m.entries()];
  }, [data, savedExtras]);

  function addExtra() {
    if (!xf) return;
    const isNew = xf.code === NEW_EXTRA;
    const name = isNew
      ? xf.name.trim()
      : (extraCodes.find(([c]) => c === xf.code)?.[1] ?? xf.code);
    const err = (() => {
      if (isNew && !name) return "Type a name for the extra, like Long day.";
      if (isNew) {
        // 后端按名字生成 code（小写、非字母数字换成 _）：「ANT Relay」会变成另一个加购项 ant_relay_2，
        // 任何趟都能勾、钱会算重（Annie 2026-11-17「还给我显示个any 润」）。跟已有的只差大小写 / 符号 ⇒ 挡下，叫人选已有的。
        const slug = extraSlug(name);
        const same =
          extraCodes.find(([c, n]) => c === slug || extraSlug(n) === slug) ??
          extraDraft
            .filter((d) => d.isNew && extraSlug(d.name) === slug)
            .map((d) => [d.code, d.name] as [string, string])[0];
        if (same)
          return extraCodes.some(([c]) => c === same[0])
            ? `${same[1]} already exists. Pick "${same[1]} — new amount" under Extra instead.`
            : `${same[1]} is already in the list, not saved yet.`;
      }
      const de = dateError(xf.from, "from");
      if (de) return de;
      if (xf.to) {
        const te = dateError(xf.to, "to");
        if (te) return te;
        if (xf.to < xf.from) return "'To' can't be before 'from'.";
      }
      const ae = amountError(xf.amount);
      if (ae) return ae;
      const l = lockCovering(locks, xf.from, xf.to || null);
      if (l) return lockSentence(l);
      if (xf.applies === "people" && !xf.people.length)
        return "Pick at least one person.";
      if (!isNew) {
        const dup = extraRows.find(
          (y) =>
            y.code === xf.code &&
            y.id !== xf.id &&
            y.from === xf.from &&
            y.applies_to === xf.applies &&
            !(y.id !== null && extraGone.includes(y.id)) &&
            (xf.applies === "all" ||
              y.people.some((p) => xf.people.includes(p.key))),
        );
        if (dup) {
          const who =
            xf.applies === "all"
              ? ""
              : ` for ${dup.people.find((p) => xf.people.includes(p.key))?.name ?? ""}`;
          return `${name} already has an amount${who} starting ${xf.from}. Change that one instead.`;
        }
      }
      return null;
    })();
    if (err) {
      setXfErr(err);
      return;
    }
    const row: ExtraRow = {
      key: xf.id !== null ? `x${xf.id}` : `xd${++draftSeq}`,
      id: xf.id,
      code: isNew ? NEW_EXTRA : xf.code,
      name,
      from: xf.from,
      to: xf.to || null,
      amount: two(xf.amount),
      applies_to: xf.applies,
      people:
        xf.applies === "all"
          ? []
          : personOpts.filter((p) => xf.people.includes(p.key)),
      isNew,
    };
    if (xf.id !== null) {
      const id = xf.id;
      setExtraEdits((m) => ({ ...m, [id]: row }));
    } else {
      setExtraDraft((d) => [...d, row]);
    }
    setXf(null);
    setXfErr(null);
    touched();
  }

  // ── 车型补贴表单（G363）─────────────────────────────────
  /** Model 下拉：后端 vehicle_models（Vehicles 车型历史里有的）+ 已存行的车型；最后一项手打。 */
  const modelOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [
      ...(data?.vehicle_models ?? []),
      ...savedVehicles.map((v) => v.model),
    ]) {
      if (x?.trim() && !m.has(norm(x))) m.set(norm(x), x.trim());
    }
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  }, [data?.vehicle_models, savedVehicles]);

  /** Tour 下拉：合同要 manifest_id ⇒ 只列有 manifest 的团（同 Prices 的团 + 已存补贴的团）。 */
  const vTourOpts = useMemo(() => {
    const m = new Map<
      string,
      { key: string; manifest_id: number; tour: string }
    >();
    for (const t of tourOpts)
      if (t.manifest_id !== null)
        m.set(t.key, { key: t.key, manifest_id: t.manifest_id, tour: t.tour });
    for (const v of savedVehicles) {
      const key = tourKeyOf(v.manifest_id, v.tour);
      if (!m.has(key))
        m.set(key, { key, manifest_id: v.manifest_id, tour: v.tour });
    }
    return [...m.values()].sort((a, b) => a.tour.localeCompare(b.tour));
  }, [tourOpts, savedVehicles]);

  const vehicleRows: (VehicleRow & { saved: boolean; edited: boolean })[] = [
    ...savedVehicles.map((v) => ({
      ...(v.id !== null && vEdits[v.id] ? vEdits[v.id] : v),
      saved: true,
      edited: v.id !== null && !!vEdits[v.id],
    })),
    ...vDraft.map((v) => ({ ...v, saved: false, edited: false })),
  ].sort(
    (a, b) =>
      a.model.localeCompare(b.model) ||
      a.tour.localeCompare(b.tour) ||
      a.from.localeCompare(b.from),
  );

  function openNewVehicle() {
    setVf({
      id: null,
      modelSel: modelOpts[0] ?? TYPED,
      typed: "",
      tourKey: "",
      mode: "add",
      amount: "",
      from: defaultFrom ?? "",
      to: "",
    });
    setVfErr(null);
  }

  function addVehicle() {
    if (!vf) return;
    const model = (vf.modelSel === TYPED ? vf.typed : vf.modelSel).trim();
    const tour = vTourOpts.find((t) => t.key === vf.tourKey);
    const err = (() => {
      if (!model)
        return "Type the vehicle model exactly as on the Vehicles page, like Sprinter.";
      if (!tour) return "Pick a tour.";
      const de = dateError(vf.from, "from");
      if (de) return de;
      if (vf.to) {
        const te = dateError(vf.to, "to");
        if (te) return te;
        if (vf.to < vf.from) return "'To' can't be before 'from'.";
      }
      const ae = amountError(vf.amount);
      if (ae) return ae;
      const l = lockCovering(locks, vf.from, vf.to || null);
      if (l) return lockSentence(l);
      // 同车型、同团、同一天起 ⇒ 后端会 400，页面先挡（同原句）。
      const dup = vehicleRows.find(
        (v) =>
          v.id !== vf.id &&
          !(v.id !== null && vGone.includes(v.id)) &&
          norm(v.model) === norm(model) &&
          v.manifest_id === tour.manifest_id &&
          v.from === vf.from,
      );
      if (dup)
        return `${dup.model} on ${tour.tour} already has an extra starting ${vf.from}. Change that one instead.`;
      return null;
    })();
    if (err || !tour) {
      setVfErr(err);
      return;
    }
    const row: VehicleRow = {
      key: vf.id !== null ? `v${vf.id}` : `vd${++draftSeq}`,
      id: vf.id,
      model,
      manifest_id: tour.manifest_id,
      tour: tour.tour,
      mode: vf.mode,
      amount: two(vf.amount),
      from: vf.from,
      to: vf.to || null,
    };
    if (vf.id !== null) {
      const id = vf.id;
      setVEdits((m) => ({ ...m, [id]: row }));
    } else {
      setVDraft((d) => [...d, row]);
    }
    setVf(null);
    setVfErr(null);
    touched();
  }

  function discard() {
    setVDraft([]);
    setVEdits({});
    setVGone([]);
    setVf(null);
    setVfErr(null);
    setPriceDraft([]);
    setPriceEdits({});
    setPriceGone([]);
    setExtraDraft([]);
    setExtraEdits({});
    setExtraGone([]);
    setPf(null);
    setXf(null);
    setPfErr(null);
    setXfErr(null);
    setSaveErr(null);
    setStatus("idle");
  }

  async function save() {
    if (!dirtyCount || status === "saving") return;
    setStatus("saving");
    setSaveErr(null);
    let changed = false;
    // 一项一项存，存好的从暂存里拿掉；出错就停在那一项，红字照后端原句。
    const priceBody = (p: PriceRow): PayrollPriceInput => ({
      ...(p.id !== null ? { id: p.id } : {}),
      ...(p.id === null
        ? p.manifest_id !== null
          ? { manifest_id: p.manifest_id }
          : { custom_tour: p.custom_tour ?? p.tour }
        : {}),
      from: p.from,
      to: p.to,
      guide_fee: p.guide_fee,
      driver_guide_fee: p.driver_guide_fee,
      ant_relay: p.ant_relay,
      applies_to: p.applies_to,
      people: p.applies_to === "all" ? [] : peopleBody(p.people),
    });
    try {
      for (const [id, row] of Object.entries(priceEdits)) {
        await savePayrollPrice(priceBody(row));
        changed = true;
        setPriceEdits((m) => {
          const next = { ...m };
          delete next[Number(id)];
          return next;
        });
      }
      for (const row of priceDraft) {
        await savePayrollPrice(priceBody(row));
        changed = true;
        setPriceDraft((d) => d.filter((x) => x.key !== row.key));
      }
      for (const id of priceGone) {
        await deletePayrollPrice(id);
        changed = true;
        setPriceGone((g) => g.filter((x) => x !== id));
      }
      for (const [id, row] of Object.entries(extraEdits)) {
        // 改一行：带 id，不带 code / name（加购项不能换、名字不改，Annie 小题 3 A）；applies_to / people 要原样再发。
        await savePayrollExtraRate({
          id: Number(id),
          from: row.from,
          to: row.to,
          amount: row.amount,
          applies_to: row.applies_to,
          people: row.applies_to === "all" ? [] : peopleBody(row.people),
        });
        changed = true;
        setExtraEdits((m) => {
          const next = { ...m };
          delete next[Number(id)];
          return next;
        });
      }
      for (const row of extraDraft) {
        // 合同 v3：applies_to / people 跟价格一样；旧后端不认识也不碍事。
        const body: PayrollExtraRateInput = {
          ...(row.isNew ? { name: row.name } : { code: row.code }),
          from: row.from,
          to: row.to,
          amount: row.amount,
          applies_to: row.applies_to,
          people: row.applies_to === "all" ? [] : peopleBody(row.people),
        };
        await savePayrollExtraRate(body);
        changed = true;
        setExtraDraft((d) => d.filter((x) => x.key !== row.key));
      }
      for (const id of extraGone) {
        await deletePayrollExtraRate(id);
        changed = true;
        setExtraGone((g) => g.filter((x) => x !== id));
      }
      // G363 车型补贴：改一行只送 id + mode / amount / from / to（车型和团固定，合同）。
      for (const [id, row] of Object.entries(vEdits)) {
        await savePayrollVehicleRate({
          id: Number(id),
          mode: row.mode,
          amount: row.amount,
          from: row.from,
          to: row.to,
        });
        changed = true;
        setVEdits((m) => {
          const next = { ...m };
          delete next[Number(id)];
          return next;
        });
      }
      for (const row of vDraft) {
        await savePayrollVehicleRate({
          model: row.model,
          manifest_id: row.manifest_id,
          mode: row.mode,
          amount: row.amount,
          from: row.from,
          to: row.to,
        });
        changed = true;
        setVDraft((d) => d.filter((x) => x.key !== row.key));
      }
      for (const id of vGone) {
        await deletePayrollVehicleRate(id);
        changed = true;
        setVGone((g) => g.filter((x) => x !== id));
      }
      setStatus("saved");
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setStatus("idle");
      setSaveErr(describeError(e));
    }
    load();
    if (changed) onSaved();
  }

  // ── 画表 ──────────────────────────────────────────────
  function priceAction(p: (typeof priceRows)[number]) {
    if (!canEdit) return null;
    if (!p.saved) {
      return (
        <button
          type="button"
          className={C_LINK}
          data-price-undo
          onClick={() => setPriceDraft((d) => d.filter((x) => x.key !== p.key))}
        >
          Remove
        </button>
      );
    }
    if (lockCovering(locks, p.from, p.to)) {
      return (
        <span className={C_LOCKED} title="This price covers locked days">
          🔒 Locked
        </span>
      );
    }
    const id = p.id as number;
    const gone = priceGone.includes(id);
    return (
      <span className="inline-flex gap-2.5 whitespace-nowrap no-underline">
        {gone ? null : (
          <button
            type="button"
            className={C_LINK}
            data-price-edit={id}
            onClick={() => openEditPrice(p)}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className={C_LINK}
          data-price-remove={id}
          onClick={() => {
            setPriceGone((g) =>
              g.includes(id) ? g.filter((x) => x !== id) : [...g, id],
            );
            touched();
          }}
        >
          {gone ? "Keep" : "Remove"}
        </button>
      </span>
    );
  }

  const groups = (() => {
    const keys = new Map<string, { tour: string; custom: boolean }>();
    for (const t of tourOpts)
      keys.set(t.key, { tour: t.tour, custom: t.manifest_id === null });
    for (const p of priceRows) {
      const k = tourKeyOf(p.manifest_id, p.tour);
      if (!keys.has(k))
        keys.set(k, { tour: p.tour, custom: p.manifest_id === null });
    }
    return [...keys.entries()].map(([key, v]) => ({
      key,
      ...v,
      rows: priceRows
        .filter((p) => tourKeyOf(p.manifest_id, p.tour) === key)
        .sort(
          (a, b) =>
            KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)] ||
            a.from.localeCompare(b.from),
        ),
    }));
  })();

  const rowClass = (pending: boolean, gone: boolean) =>
    pending ? C_ROW_PENDING : gone ? C_ROW_GONE : "bg-white";

  const pricesTable = (
    <table className={cn(C_TABLE, "min-w-[720px]")} data-payroll-prices>
      <thead>
        <tr>
          <th className={cn(C_TH, C_STICKY)}>Kind</th>
          <th className={C_TH}>Dates</th>
          <th className={C_TH}>Applies to</th>
          <th className={cn(C_TH, "text-right")}>Guide</th>
          <th className={cn(C_TH, "text-right")}>Driver + Guide</th>
          <th className={C_TH}>ANT relay</th>
          <th className={C_TH} />
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.key}>
            <tr data-price-tour={g.tour}>
              <td className={C_GRP_TD} colSpan={7}>
                <b>{g.tour}</b>
                {g.custom ? (
                  <span className={C_DIM}> · tour name typed on Dispatch</span>
                ) : null}
                {g.rows.length ? null : (
                  <>
                    {" "}
                    <span className="text-[12px] font-semibold whitespace-nowrap text-[#b45309]">
                      No rate
                    </span>{" "}
                    <span className={C_DIM}>· no price yet</span>
                  </>
                )}
              </td>
            </tr>
            {g.rows.map((p) => {
              const gone = p.id !== null && priceGone.includes(p.id);
              return (
                <tr
                  key={p.key}
                  data-price-row={p.id ?? "new"}
                  data-pending={!p.saved || p.edited || undefined}
                  data-gone={gone || undefined}
                  className={rowClass(!p.saved || p.edited, gone)}
                >
                  <td className={cn(C_TD, C_STICKY, "whitespace-nowrap")}>
                    {kindOf(p)}
                  </td>
                  <td className={cn(C_TD, "whitespace-nowrap")}>
                    {cardDatesOf(p.from, p.to)}
                  </td>
                  <td className={C_TD}>{whoOf(p.applies_to, p.people)}</td>
                  <td className={cn(C_TD, C_NUM)}>{cardMoney(p.guide_fee)}</td>
                  <td className={cn(C_TD, C_NUM)}>
                    {cardMoney(p.driver_guide_fee)}
                  </td>
                  <td className={C_TD}>{p.ant_relay ? "Yes" : "—"}</td>
                  <td className={cn(C_TD, "no-underline")}>{priceAction(p)}</td>
                </tr>
              );
            })}
          </Fragment>
        ))}
        {groups.length === 0 ? (
          <tr>
            <td className={cn(C_TD, C_DIM)} colSpan={7}>
              No prices yet.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );

  const priceForm = !canEdit ? null : pf ? (
    <div className={C_FORMROW} data-price-form>
      <label className={C_FLABEL}>
        Tour
        <SelectMenu
          className={C_INPUT}
          value={String(pf.tourKey)}
          options={[
            ...tourOpts.map((t) => ({
              value: String(t.key),
              label: String(t.tour),
            })),
            { value: String(TYPED), label: "Type a tour name…" },
          ]}
          disabled={pf.id !== null}
          data-pf="tour"
          onChange={(next) => setPf({ ...pf, tourKey: next })}
        />
      </label>
      {pf.tourKey === TYPED ? (
        <label className={C_FLABEL}>
          Tour name (as typed on Dispatch)
          <input
            className={C_INPUT}
            value={pf.typed}
            placeholder="Lake Mead Sunset"
            data-pf="typed"
            onChange={(e) => setPf({ ...pf, typed: e.target.value })}
          />
        </label>
      ) : null}
      <label className={C_FLABEL}>
        From
        <input
          type="date"
          className={C_INPUT}
          value={pf.from}
          data-pf="from"
          onChange={(e) => setPf({ ...pf, from: e.target.value })}
        />
      </label>
      <label className={C_FLABEL}>
        To (empty = no end)
        <input
          type="date"
          className={C_INPUT}
          value={pf.to}
          data-pf="to"
          onChange={(e) => setPf({ ...pf, to: e.target.value })}
        />
      </label>
      <label className={C_FLABEL}>
        Guide
        <input
          className={cn(C_INPUT, "w-[100px] text-right max-sm:w-auto")}
          inputMode="decimal"
          placeholder="0.00"
          value={pf.g}
          data-pf="g"
          onChange={(e) => setPf({ ...pf, g: e.target.value })}
        />
      </label>
      <label className={C_FLABEL}>
        Driver + Guide
        <input
          className={cn(C_INPUT, "w-[100px] text-right max-sm:w-auto")}
          inputMode="decimal"
          placeholder="0.00"
          value={pf.dg}
          data-pf="dg"
          onChange={(e) => setPf({ ...pf, dg: e.target.value })}
        />
      </label>
      <label className={cn(C_CK, "self-center")}>
        <input
          type="checkbox"
          checked={pf.ant}
          data-pf="ant"
          onChange={(e) => setPf({ ...pf, ant: e.target.checked })}
        />
        ANT relay can be ticked
      </label>
      <WhoPicker
        name="pf"
        applies={pf.applies}
        people={pf.people}
        options={personOpts}
        onChange={(applies, picked) =>
          setPf({ ...pf, applies, people: picked })
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={C_BTN_ADD}
          data-pf="add"
          onClick={addPrice}
        >
          {pf.id !== null ? "Update" : "Add"}
        </button>
        <button
          type="button"
          className={C_BTN}
          onClick={() => {
            setPf(null);
            setPfErr(null);
          }}
        >
          Cancel
        </button>
        {pfErr ? (
          <span className={C_RED} data-pf-err>
            {pfErr}
          </span>
        ) : null}
      </div>
    </div>
  ) : (
    <div className="px-4 pt-2.5 max-sm:px-3">
      <button
        type="button"
        className={C_BTN}
        data-add-price
        onClick={openNewPrice}
      >
        + Add price
      </button>
    </div>
  );

  function extraAction(x: (typeof extraRows)[number]) {
    if (!canEdit) return null;
    if (!x.saved) {
      return (
        <button
          type="button"
          className={C_LINK}
          data-extra-undo
          onClick={() => setExtraDraft((d) => d.filter((y) => y.key !== x.key))}
        >
          Remove
        </button>
      );
    }
    if (lockCovering(locks, x.from, x.to)) {
      return <span className={C_LOCKED}>🔒 Locked</span>;
    }
    const id = x.id as number;
    const gone = extraGone.includes(id);
    return (
      <span className="inline-flex gap-2.5 whitespace-nowrap no-underline">
        {gone ? null : (
          <button
            type="button"
            className={C_LINK}
            data-extra-edit={id}
            onClick={() => {
              setXf({
                id,
                code: x.code,
                name: x.name,
                from: x.from,
                to: x.to ?? "",
                amount: x.amount,
                applies: x.applies_to,
                people: x.people.map((p) => p.key),
              });
              setXfErr(null);
            }}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className={C_LINK}
          data-extra-remove={id}
          onClick={() => {
            setExtraGone((g) =>
              g.includes(id) ? g.filter((y) => y !== id) : [...g, id],
            );
            touched();
          }}
        >
          {gone ? "Keep" : "Remove"}
        </button>
      </span>
    );
  }

  const extrasTable = (
    <table className={cn(C_TABLE, "min-w-[640px]")} data-payroll-extras>
      <thead>
        <tr>
          <th className={cn(C_TH, C_STICKY)}>Extra</th>
          <th className={C_TH}>Dates</th>
          <th className={C_TH}>Applies to</th>
          <th className={cn(C_TH, "text-right")}>Amount</th>
          <th className={C_TH}>Can be ticked on</th>
          <th className={C_TH} />
        </tr>
      </thead>
      <tbody>
        {extraRows.map((x) => {
          const gone = x.id !== null && extraGone.includes(x.id);
          return (
            <tr
              key={x.key}
              data-extra-row={x.id ?? "new"}
              data-pending={!x.saved || undefined}
              data-gone={gone || undefined}
              className={rowClass(!x.saved || x.edited, gone)}
            >
              <td className={cn(C_TD, C_STICKY)}>{x.name}</td>
              <td className={cn(C_TD, "whitespace-nowrap")}>
                {cardDatesOf(x.from, x.to)}
              </td>
              <td className={C_TD}>{whoOf(x.applies_to, x.people)}</td>
              <td className={cn(C_TD, C_NUM)}>{cardMoney(x.amount)}</td>
              <td className={C_TD}>
                {x.code === "ant_relay"
                  ? "Tours whose price has ANT relay = Yes"
                  : "Any run"}
              </td>
              <td className={cn(C_TD, "no-underline")}>{extraAction(x)}</td>
            </tr>
          );
        })}
        {extraRows.length === 0 ? (
          <tr>
            <td className={cn(C_TD, C_DIM)} colSpan={6}>
              No extras yet.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );

  const extraForm = !canEdit ? null : xf ? (
    <div className={C_FORMROW} data-extra-form>
      <label className={C_FLABEL}>
        Extra
        <SelectMenu
          className={C_INPUT}
          value={String(xf.code)}
          options={[
            ...(xf.id !== null
              ? [{ value: String(xf.code), label: String(xf.name) }]
              : [
                  { value: String(NEW_EXTRA), label: "New extra…" },
                  ...extraCodes.map(([code, name]) => ({
                    value: String(code),
                    label: `${name} — new amount`,
                  })),
                ]),
          ]}
          data-xf="code"
          disabled={xf.id !== null}
          onChange={(next) => setXf({ ...xf, code: next })}
        />
      </label>
      {xf.code === NEW_EXTRA ? (
        <label className={C_FLABEL}>
          Name
          <input
            className={C_INPUT}
            value={xf.name}
            placeholder="Long day"
            data-xf="name"
            onChange={(e) => setXf({ ...xf, name: e.target.value })}
          />
        </label>
      ) : null}
      <label className={C_FLABEL}>
        From
        <input
          type="date"
          className={C_INPUT}
          value={xf.from}
          data-xf="from"
          onChange={(e) => setXf({ ...xf, from: e.target.value })}
        />
      </label>
      <label className={C_FLABEL}>
        To (empty = no end)
        <input
          type="date"
          className={C_INPUT}
          value={xf.to}
          data-xf="to"
          onChange={(e) => setXf({ ...xf, to: e.target.value })}
        />
      </label>
      <label className={C_FLABEL}>
        Amount
        <input
          className={cn(C_INPUT, "w-[100px] text-right max-sm:w-auto")}
          inputMode="decimal"
          placeholder="0.00"
          value={xf.amount}
          data-xf="amount"
          onChange={(e) => setXf({ ...xf, amount: e.target.value })}
        />
      </label>
      <WhoPicker
        name="xf"
        applies={xf.applies}
        people={xf.people}
        options={personOpts}
        onChange={(applies, picked) =>
          setXf({ ...xf, applies, people: picked })
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={C_BTN_ADD}
          data-xf="add"
          onClick={addExtra}
        >
          {xf.id !== null ? "Update" : "Add"}
        </button>
        <button
          type="button"
          className={C_BTN}
          onClick={() => {
            setXf(null);
            setXfErr(null);
          }}
        >
          Cancel
        </button>
        {xfErr ? (
          <span className={C_RED} data-xf-err>
            {xfErr}
          </span>
        ) : null}
      </div>
    </div>
  ) : (
    <div className="px-4 pt-2.5 max-sm:px-3">
      <button
        type="button"
        className={C_BTN}
        data-add-extra
        onClick={() => {
          setXf({
            id: null,
            code: NEW_EXTRA,
            name: "",
            from: defaultFrom ?? "",
            to: "",
            amount: "",
            applies: "all",
            people: [],
          });
          setXfErr(null);
        }}
      >
        + Add extra
      </button>
    </div>
  );

  function vehicleAction(v: (typeof vehicleRows)[number]) {
    if (!canEdit) return null;
    if (!v.saved) {
      return (
        <button
          type="button"
          className={C_LINK}
          data-vehicle-undo
          onClick={() => setVDraft((d) => d.filter((y) => y.key !== v.key))}
        >
          Remove
        </button>
      );
    }
    if (lockCovering(locks, v.from, v.to)) {
      return (
        <span
          className={C_LOCKED}
          title="This vehicle extra covers locked days"
        >
          🔒 Locked
        </span>
      );
    }
    const id = v.id as number;
    const gone = vGone.includes(id);
    return (
      <span className="inline-flex gap-2.5 whitespace-nowrap no-underline">
        {gone ? null : (
          <button
            type="button"
            className={C_LINK}
            data-vehicle-edit={id}
            onClick={() => {
              setVf({
                id,
                modelSel: v.model,
                typed: "",
                tourKey: tourKeyOf(v.manifest_id, v.tour),
                mode: v.mode,
                amount: two(v.amount),
                from: v.from,
                to: v.to ?? "",
              });
              setVfErr(null);
            }}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className={C_LINK}
          data-vehicle-remove={id}
          onClick={() => {
            setVGone((g) =>
              g.includes(id) ? g.filter((y) => y !== id) : [...g, id],
            );
            touched();
          }}
        >
          {gone ? "Keep" : "Remove"}
        </button>
      </span>
    );
  }

  const vehiclesTable = (
    <table className={cn(C_TABLE, "min-w-[720px]")} data-payroll-vehicle-extras>
      <thead>
        <tr>
          <th className={cn(C_TH, C_STICKY)}>Model</th>
          <th className={C_TH}>Tour</th>
          <th className={C_TH}>Dates</th>
          <th className={C_TH}>How it is paid</th>
          <th className={cn(C_TH, "text-right")}>Amount</th>
          <th className={C_TH} />
        </tr>
      </thead>
      <tbody>
        {vehicleRows.map((v) => {
          const gone = v.id !== null && vGone.includes(v.id);
          return (
            <tr
              key={v.key}
              data-vehicle-row={v.id ?? "new"}
              data-pending={!v.saved || v.edited || undefined}
              data-gone={gone || undefined}
              className={rowClass(!v.saved || v.edited, gone)}
            >
              <td className={cn(C_TD, C_STICKY, "whitespace-nowrap")}>
                {v.model}
              </td>
              <td className={C_TD}>{v.tour}</td>
              <td className={cn(C_TD, "whitespace-nowrap")}>
                {cardDatesOf(v.from, v.to)}
              </td>
              <td className={C_TD}>{MODE_LABEL[v.mode]}</td>
              <td className={cn(C_TD, C_NUM)}>
                {v.mode === "add" ? "+" : ""}
                {cardMoney(v.amount)}
              </td>
              <td className={cn(C_TD, "no-underline")}>{vehicleAction(v)}</td>
            </tr>
          );
        })}
        {vehicleRows.length === 0 ? (
          <tr>
            <td className={cn(C_TD, C_DIM)} colSpan={6}>
              No vehicle extras yet.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );

  const vehicleForm = !canEdit ? null : vf ? (
    <div className={C_FORMROW} data-vehicle-form>
      <label className={C_FLABEL}>
        Model
        <SelectMenu
          className={C_INPUT}
          value={String(vf.modelSel)}
          options={[
            ...(vf.id !== null
              ? [{ value: String(vf.modelSel), label: String(vf.modelSel) }]
              : [
                  ...modelOpts.map((m) => ({ value: m, label: m })),
                  { value: TYPED, label: "Type a model…" },
                ]),
          ]}
          disabled={vf.id !== null}
          data-vf="model"
          onChange={(next) => setVf({ ...vf, modelSel: next })}
        />
      </label>
      {vf.modelSel === TYPED && vf.id === null ? (
        <label className={C_FLABEL}>
          Model (as on the Vehicles page)
          <input
            className={C_INPUT}
            value={vf.typed}
            placeholder="Sprinter"
            data-vf="typed"
            onChange={(e) => setVf({ ...vf, typed: e.target.value })}
          />
        </label>
      ) : null}
      <label className={C_FLABEL}>
        Tour
        <SelectMenu
          className={C_INPUT}
          value={String(vf.tourKey)}
          options={[
            ...(vf.tourKey === ""
              ? [{ value: "", label: "Pick a tour…" }]
              : []),
            ...vTourOpts.map((t) => ({ value: t.key, label: t.tour })),
          ]}
          disabled={vf.id !== null}
          data-vf="tour"
          onChange={(next) => setVf({ ...vf, tourKey: next })}
        />
      </label>
      <label className={C_FLABEL}>
        How it is paid
        <SelectMenu
          className={C_INPUT}
          value={vf.mode}
          options={[
            { value: "add", label: MODE_LABEL.add },
            { value: "total", label: MODE_LABEL.total },
          ]}
          data-vf="mode"
          onChange={(next) =>
            setVf({ ...vf, mode: next === "total" ? "total" : "add" })
          }
        />
      </label>
      <label className={C_FLABEL}>
        Amount
        <input
          className={cn(C_INPUT, "w-[100px] text-right max-sm:w-auto")}
          inputMode="decimal"
          placeholder="0.00"
          value={vf.amount}
          data-vf="amount"
          onChange={(e) => setVf({ ...vf, amount: e.target.value })}
        />
      </label>
      <label className={C_FLABEL}>
        From
        <input
          type="date"
          className={C_INPUT}
          value={vf.from}
          data-vf="from"
          onChange={(e) => setVf({ ...vf, from: e.target.value })}
        />
      </label>
      <label className={C_FLABEL}>
        To (empty = no end)
        <input
          type="date"
          className={C_INPUT}
          value={vf.to}
          data-vf="to"
          onChange={(e) => setVf({ ...vf, to: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={C_BTN_ADD}
          data-vf="add"
          onClick={addVehicle}
        >
          {vf.id !== null ? "Update" : "Add"}
        </button>
        <button
          type="button"
          className={C_BTN}
          onClick={() => {
            setVf(null);
            setVfErr(null);
          }}
        >
          Cancel
        </button>
        {vfErr ? (
          <span className={C_RED} data-vf-err>
            {vfErr}
          </span>
        ) : null}
      </div>
    </div>
  ) : (
    <div className="px-4 pt-2.5 max-sm:px-3">
      <button
        type="button"
        className={C_BTN}
        data-add-vehicle-extra
        onClick={openNewVehicle}
      >
        + Add vehicle extra
      </button>
    </div>
  );

  return (
    <div className={HR_CARD_CLASS} data-payroll-rates>
      <div className={HR_CARD_HEADER_CLASS}>
        <button
          type="button"
          aria-expanded={open}
          data-rates-toggle
          onClick={() => setOpen((v) => !v)}
          className={cn(
            HR_CARD_TITLE_CLASS,
            "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0",
          )}
        >
          <span className="w-3 text-[10px] text-[#4b5563]">
            {open ? "▼" : "▶"}
          </span>
          Pay rates
          <span className="font-normal text-[#4b5563]">
            {data?.vehicle_rates
              ? "· Prices, extras and vehicle extras"
              : "· Prices and extras"}
          </span>
        </button>
      </div>
      {!open ? null : loadErr && !data ? (
        <p className={cn(C_RED, "m-0 px-4 py-3")} role="alert">
          {loadErr}
        </p>
      ) : !data ? (
        <p className={cn(C_DIM, "m-0 px-4 py-6 text-center text-[13px]")}>
          Loading…
        </p>
      ) : (
        <>
          <div className={C_SUBH}>
            <span>
              Prices
              {pricesInfo.button}
            </span>
            <span className={cn(C_HINT, "font-normal", pricesInfo.hide)}>
              A run uses the newest price for that guide that covers the day; if
              none, the newest price for everyone. No end date = keeps going.
            </span>
          </div>
          <div className={C_WRAP}>{pricesTable}</div>
          {priceForm}
          <div className={cn(C_SUBH, "mt-3.5")}>
            <span>
              Extras
              {extrasInfo.button}
            </span>
            <span className={cn(C_HINT, "font-normal", extrasInfo.hide)}>
              Paid per ticked run. ANT relay only on tours whose price says ANT
              relay; other extras on any run. Like prices, an amount for that
              guide beats an amount for everyone.
            </span>
          </div>
          <div className={C_WRAP}>{extrasTable}</div>
          {extraForm}
          {/* G363：旧后端没有 vehicle_rates ⇒ 不出这一节。 */}
          {data.vehicle_rates ? (
            <>
              <div className={cn(C_SUBH, "mt-3.5")} data-vehicle-extras-head>
                <span>
                  Vehicle extras
                  {vehicleInfo.button}
                </span>
                <span className={cn(C_HINT, "font-normal", vehicleInfo.hide)}>
                  For driver-guide runs in a vehicle of this model, on tours
                  that have a price. Add: paid on top of the driver-guide fee.
                  Total: the driver-guide gets this much for the run; if that
                  day’s Driver + Guide price for everyone is higher, the run
                  gets the price. Not added when the fee was typed by hand.
                </span>
              </div>
              <div className={C_WRAP}>{vehiclesTable}</div>
              {vehicleForm}
            </>
          ) : null}
          {canEdit ? (
            <div className={cn(C_SAVEBAR, "mt-3")} data-rates-savebar>
              <span className={C_HINT}>
                Prices, extras or vehicle extras that cover locked days can’t be
                changed or removed. To change one from now on, add a new one
                starting after the locked days.
              </span>
              <span className="flex-1" />
              {saveErr ? (
                <span className={C_RED} role="alert" data-rates-err>
                  {saveErr}
                </span>
              ) : status === "saving" ? (
                <span className="text-[12.5px] text-[#4b5563]">Saving…</span>
              ) : dirtyCount ? (
                <span className={C_RED} data-rates-unsaved>
                  Not saved yet · {dirtyCount} change
                  {dirtyCount === 1 ? "" : "s"}
                </span>
              ) : status === "saved" ? (
                <span className={C_GREEN} data-rates-saved>
                  Saved
                </span>
              ) : null}
              {dirtyCount && status !== "saving" ? (
                <button
                  type="button"
                  className={C_BTN}
                  data-rates-discard
                  onClick={discard}
                >
                  Discard
                </button>
              ) : null}
              <button
                type="button"
                className={C_BTN_SAVE}
                disabled={!dirtyCount || status === "saving"}
                data-rates-save
                onClick={() => void save()}
              >
                Save rates
              </button>
            </div>
          ) : (
            <div className="h-3" />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Applies to：Everyone / Only these people。价格、加购项两个表单共用。
 * 选人改成弹窗（Annie 2026-11-17「小题2，改成弹窗吧，放多少人都ok了」，样稿 LtGwyr8qAUxYhXfSVnL1VL 第 2 版，动手）：
 * 表单上一个白键「Choose people… (N)」+ 一行灰字已选名字；弹窗里 Search name + 一列勾选框（已勾的排最前面，
 * 手打名字的标 Not in HR），灰绿 Done 回表单（只是选好，还要按 Save rates），Cancel 不改。
 */
function WhoPicker({
  name,
  applies,
  people,
  options,
  onChange,
}: {
  name: string;
  applies: "all" | "people";
  people: string[];
  options: PersonOpt[];
  onChange: (applies: "all" | "people", people: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = options.filter((p) => people.includes(p.key));
  return (
    <div className={cn(C_FLABEL, "basis-full")} data-who-picker={name}>
      Applies to
      <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <label className={C_CK}>
          <input
            type="radio"
            name={`${name}-applies`}
            checked={applies === "all"}
            data-applies="all"
            onChange={() => onChange("all", people)}
          />
          Everyone
        </label>
        <label className={C_CK}>
          <input
            type="radio"
            name={`${name}-applies`}
            checked={applies === "people"}
            data-applies="people"
            onChange={() => onChange("people", people)}
          />
          Only these people
        </label>
        {applies === "people" ? (
          <button
            type="button"
            className={cn(C_BTN, "px-2.5 py-[3px]")}
            data-who-open
            onClick={() => setOpen(true)}
          >
            Choose people… ({picked.length})
          </button>
        ) : null}
      </span>
      {applies === "people" && picked.length ? (
        <span className="text-[12px] font-normal text-[#4b5563]" data-who-names>
          {picked.map((p) => p.name).join(", ")}
        </span>
      ) : null}
      {open ? (
        <PeopleDialog
          options={options}
          initial={people}
          onDone={(next) => {
            onChange("people", next);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function PeopleDialog({
  options,
  initial,
  onDone,
  onCancel,
}: {
  options: PersonOpt[];
  initial: string[];
  onDone: (people: string[]) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState<string[]>(initial);
  const [q, setQ] = useState("");
  // 打开时已勾的排最前面（之后勾 / 取消不跳动）。
  const [order] = useState(() => [
    ...options.filter((p) => initial.includes(p.key)),
    ...options.filter((p) => !initial.includes(p.key)),
  ]);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? order.filter((p) => p.name.toLowerCase().includes(needle))
    : order;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 max-sm:p-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose people"
        data-who-dialog
        className="flex max-h-[85vh] w-[420px] max-w-full flex-col rounded-[12px] bg-white text-[#1a1a1a] shadow-[0_10px_30px_rgba(0,0,0,.35)]"
      >
        <div className="px-4 pt-3.5 pb-2 text-[14px] font-semibold">
          Choose people
        </div>
        <div className="px-4 pb-2">
          <input
            className={cn(C_INPUT, "w-full")}
            placeholder="Search name"
            value={q}
            autoFocus
            data-who-search
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex min-h-0 flex-col gap-[7px] overflow-auto border-y border-[#e5e7eb] px-4 py-2.5 text-[13px] font-normal">
          {shown.length ? (
            shown.map((p) => (
              <label
                key={p.key}
                className="flex items-center gap-1.5"
                data-who-row={p.name}
              >
                <input
                  type="checkbox"
                  data-who={p.name}
                  checked={sel.includes(p.key)}
                  onChange={(e) =>
                    setSel((s) =>
                      e.target.checked
                        ? [...s, p.key]
                        : s.filter((k) => k !== p.key),
                    )
                  }
                />
                {p.name}
                {p.in_hr ? null : (
                  <span className="text-[11.5px] font-medium whitespace-nowrap text-[#4b5563]">
                    Not in HR
                  </span>
                )}
              </label>
            ))
          ) : (
            <span className="text-[#888]" data-who-none>
              No one matches.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-[12.5px] text-[#4b5563]" data-who-count>
            {sel.length} selected
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className={C_BTN_ADD}
            data-who-done
            onClick={() => onDone(sel)}
          >
            Done
          </button>
          <button
            type="button"
            className={C_BTN}
            data-who-cancel
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
