"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { usePhoneInfo } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  deletePayrollExtraRate,
  deletePayrollPrice,
  fetchPayrollRates,
  savePayrollExtraRate,
  savePayrollPrice,
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
  code: string;
  name: string;
  from: string;
  to: string;
  amount: string;
  applies: "all" | "people";
  people: string[];
}

const TYPED = "__typed";
const NEW_EXTRA = "__new";

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
}

export function PayrollRates({
  canEdit,
  onUnauthorized,
  onDirtyChange,
  onSaved,
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

  const [pf, setPf] = useState<PriceForm | null>(null);
  const [pfErr, setPfErr] = useState<string | null>(null);
  const [xf, setXf] = useState<ExtraForm | null>(null);
  const [xfErr, setXfErr] = useState<string | null>(null);

  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const pricesInfo = usePhoneInfo("About prices");
  const extrasInfo = usePhoneInfo("About extras");

  const load = useCallback(
    (signal?: AbortSignal) => {
      fetchPayrollRates(signal)
        .then((d) => {
          setData(d);
          setLoadErr(null);
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
    [onUnauthorized],
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
    extraGone.length;

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
  }, [people, savedPrices, savedExtras]);

  const priceRows: (PriceRow & { saved: boolean; edited: boolean })[] = [
    ...savedPrices.map((p) => ({
      ...(p.id !== null && priceEdits[p.id] ? priceEdits[p.id] : p),
      saved: true,
      edited: p.id !== null && !!priceEdits[p.id],
    })),
    ...priceDraft.map((p) => ({ ...p, saved: false, edited: false })),
  ];
  const extraRows: (ExtraRow & { saved: boolean })[] = [
    ...savedExtras.map((x) => ({ ...x, saved: true })),
    ...extraDraft.map((x) => ({ ...x, saved: false })),
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
    for (const x of savedExtras) if (!m.has(x.code)) m.set(x.code, x.name);
    return [...m.entries()];
  }, [savedExtras]);

  function addExtra() {
    if (!xf) return;
    const isNew = xf.code === NEW_EXTRA;
    const name = isNew
      ? xf.name.trim()
      : (extraCodes.find(([c]) => c === xf.code)?.[1] ?? xf.code);
    const err = (() => {
      if (isNew && !name) return "Type a name for the extra, like Long day.";
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
    setExtraDraft((d) => [
      ...d,
      {
        key: `xd${++draftSeq}`,
        id: null,
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
      },
    ]);
    setXf(null);
    setXfErr(null);
    touched();
  }

  function discard() {
    setPriceDraft([]);
    setPriceEdits({});
    setPriceGone([]);
    setExtraDraft([]);
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
        <select
          className={C_INPUT}
          value={pf.tourKey}
          disabled={pf.id !== null}
          data-pf="tour"
          onChange={(e) => setPf({ ...pf, tourKey: e.target.value })}
        >
          {tourOpts.map((t) => (
            <option key={t.key} value={t.key}>
              {t.tour}
            </option>
          ))}
          <option value={TYPED}>Type a tour name…</option>
        </select>
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
              className={rowClass(!x.saved, gone)}
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
        <select
          className={C_INPUT}
          value={xf.code}
          data-xf="code"
          onChange={(e) => setXf({ ...xf, code: e.target.value })}
        >
          <option value={NEW_EXTRA}>New extra…</option>
          {extraCodes.map(([code, name]) => (
            <option key={code} value={code}>
              {name} — new amount
            </option>
          ))}
        </select>
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
          Add
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
            · Prices and extras
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
          {canEdit ? (
            <div className={cn(C_SAVEBAR, "mt-3")} data-rates-savebar>
              <span className={C_HINT}>
                Prices or extras that cover locked days can’t be changed or
                removed. To change a price from now on, add a new one starting
                after the locked days.
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

/** Applies to：Everyone / Only these people（含手打名字的导游，标 Not in HR）。价格、加购项两个表单共用。 */
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
  return (
    <div className={cn(C_FLABEL, "basis-full")} data-who-picker={name}>
      Applies to
      <span className="flex flex-wrap gap-x-3.5 gap-y-1.5">
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
          Only these people:
        </label>
        {applies === "people"
          ? options.map((p) => (
              <label key={p.key} className={C_CK}>
                <input
                  type="checkbox"
                  data-who={p.name}
                  checked={people.includes(p.key)}
                  onChange={(e) =>
                    onChange(
                      "people",
                      e.target.checked
                        ? [...people, p.key]
                        : people.filter((k) => k !== p.key),
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
          : null}
      </span>
    </div>
  );
}
