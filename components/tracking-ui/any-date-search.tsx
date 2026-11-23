"use client";

import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { usePermissions } from "@/lib/staff-permissions";
import {
  type FoundMatch,
  type FoundProduct,
  findOrderAnyDate,
  searchOrdersAnyDate,
  type TrackingPage,
} from "@/lib/tracking-find-api";

/**
 * Tour / Tickets Tracking「搜索不限日期」（Annie 2026-11-23「Tracking搜索全部同意推荐，动手」，
 * preview https://claude.ai/artifact/TZYW2kAVLFsdqkkkRQBaVZ ；Q1–Q6 都 A，Q7 B）：
 * - Q1 A：打字时照旧只筛这一天；按 Enter、这一天又没有，才去别的日子找。
 * - Q2 A：完整单号直接跳；名字 / 电话这一天没有 ⇒「Search all dates →」，点了列出所有日子对得上的单，点一个跳过去。
 * - Q3 A：多产品的单先去这一页有的那个产品（团期最早的），蓝条列出别的产品。
 * - Q4 A：只在另一个 Tracking 页上 ⇒ 直接带过去（?date=&q=&from=）。
 * - Q5 A：Order List 里取消了 / 两页都没有 ⇒ 不跳，搜索框下写状态 + Open in Order List →。
 * - Q6 A：跳过去照现在搜索的做法：搜索框留着单号、只显示这一单、整行描黄；蓝条「← Back to 原来那天」。
 */

const PAGE_HREF: Record<TrackingPage, string> = {
  tour: "/tour-confirmation/tracking",
  tickets: "/tickets-reminder/tracking",
};
const PAGE_LABEL: Record<TrackingPage, string> = {
  tour: "Tour Tracking",
  tickets: "Tickets Tracking",
};

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});
/** "2026-10-10" → "Sat, Oct 10"；没有日期 ⇒ "no date"。 */
export function dayLabel(ymd: string | null): string {
  if (!ymd) return "no date";
  const t = Date.parse(`${ymd}T12:00:00Z`);
  return Number.isNaN(t) ? ymd : DAY.format(t);
}

const same = (a: string, b: string) =>
  a.trim().toUpperCase() === b.trim().toUpperCase();
const digits = (s: string) => s.replace(/\D/g, "");
/** 像名字（有空格、没有数字）或电话（只有数字和 + ( ) - . 空格、至少 4 位，同后端）：查不到单号时给「Search all dates」。 */
function nameOrPhone(q: string): boolean {
  if (/\s/.test(q) || !/\d/.test(q)) return true;
  return /^[+\d\s().-]+$/.test(q) && digits(q).length >= 4;
}
const statusText = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "Unknown";

type Note =
  | { kind: "error"; text: string }
  | { kind: "warn"; order: string; product: FoundProduct }
  | { kind: "nomatch"; q: string }
  | { kind: "loading" }
  | { kind: "results"; matches: FoundMatch[]; truncated: boolean };

interface Hit {
  order: string;
  date: string;
  product: string;
  from: string | null;
  others: FoundProduct[];
}

interface Pending {
  order: string;
  /** 要去的那一天；读到那天的表才定位。 */
  target: string;
  product: string;
  from: string | null;
  others: FoundProduct[];
  /** 发起跳转时那份表（同一个对象 = 还没读到新的一天）。 */
  staleData: unknown;
}

export function useAnyDateSearch<Row extends { order_number: string }>({
  page,
  date,
  data,
  rows,
  search,
  setSearch,
  changeDate,
  matches,
  onLocate,
  productOf,
  onUnauthorized,
}: {
  page: TrackingPage;
  date: string;
  /** 这一天读到的整份数据（换了一天会换成新对象）；没读到为 null。 */
  data: unknown;
  /** 这一天的全部行（不经过胶囊、搜索过滤）；没读到为 null。 */
  rows: readonly Row[] | null;
  search: string;
  setSearch: (v: string) => void;
  changeDate: (next: string) => void;
  /** 这一行对不对得上搜索框（页面原来的搜索规则）。 */
  matches: (row: Row, q: string) => boolean;
  /** 定位到这一行：页面选中它所在的胶囊。 */
  onLocate: (row: Row) => void;
  /** 蓝条上写的团 / 产品名（拿不到 Order List 的产品名时用）。 */
  productOf: (row: Row) => string;
  onUnauthorized: () => void;
}) {
  const router = useRouter();
  // Q5 A：Open in Order List → 只给能打开 Order List 的人（后端合同：没有就只写字）。
  const canOpenOrders = usePermissions().canOpen("/orders");
  const [note, setNote] = useState<Note | null>(null);
  const [hit, setHit] = useState<Hit | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const seq = useRef(0);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const clear = useCallback(() => {
    seq.current++;
    setNote(null);
    setHit(null);
    setPending(null);
  }, []);

  /** 读到要去的那一天：找到这单就选胶囊、描黄；找不到写一句。 */
  const resolve = useCallback(
    (p: Pending, list: readonly Row[]) => {
      const row = list.find((r) => same(r.order_number, p.order));
      setPending(null);
      if (!row) {
        setNote({ kind: "error", text: `${p.order} is in the Order List for ${dayLabel(p.target)} but is not on ${PAGE_LABEL[page]} yet.` });
        return;
      }
      onLocate(row);
      setHit({
        order: row.order_number,
        date: p.target,
        product: p.product || productOf(row),
        from: p.from,
        others: p.others,
      });
    },
    [onLocate, page, productOf],
  );

  useEffect(() => {
    if (!pending || !rows || date !== pending.target) return;
    if (data === pending.staleData) return;
    resolve(pending, rows);
  }, [pending, rows, data, date, resolve]);

  // 自己换了日子（不是跳过来的）：蓝条和描黄不跟着走。
  useEffect(() => {
    if (hit && date && hit.date !== date && !pending) setHit(null);
  }, [date, hit, pending]);

  /** 去这个产品：这一页的 ⇒ 换日子定位；另一页的 ⇒ 带过去；哪页都不在 ⇒ 写原因。 */
  function goTo(order: string, product: FoundProduct, others: FoundProduct[]) {
    setNote(null);
    if (!product.page || !product.tour_date) {
      setNote({ kind: "warn", order, product });
      return;
    }
    const target = product.tour_date;
    if (product.page !== page) {
      const qs = new URLSearchParams({ date: target, q: order, from: date });
      router.push(`${PAGE_HREF[product.page]}?${qs}`);
      return;
    }
    setSearch(order);
    const p: Pending = {
      order,
      target,
      product: product.product_name,
      from: target === date ? null : date,
      others,
      staleData: target === date ? undefined : data,
    };
    if (target === date && rows) {
      resolve(p, rows);
      return;
    }
    setPending(p);
    changeDate(target);
  }

  async function onEnter() {
    const q = search.trim();
    if (!q || !rows) return;
    // 这一天就有：照现在的搜索，不用去别的日子（Q1 A）。
    if (rows.some((r) => same(r.order_number, q))) return;
    if (nameOrPhone(q) && rows.some((r) => matches(r, q))) return;
    const my = ++seq.current;
    setHit(null);
    setNote({ kind: "loading" });
    try {
      const found = await findOrderAnyDate(q);
      if (my !== seq.current) return;
      if (!found || !found.products.length) {
        setNote(
          nameOrPhone(q)
            ? { kind: "nomatch", q }
            : { kind: "error", text: `No order ${q} on any date (checked the Order List).` },
        );
        return;
      }
      // 后端已经按日期早的在前排好（没有日期的不动）。
      const byDate = [...found.products];
      const first =
        byDate.find((p) => p.page === page && p.tour_date) ??
        byDate.find((p) => p.page && p.tour_date) ??
        byDate[0];
      goTo(
        found.order_number,
        first,
        byDate.filter((p) => p !== first),
      );
    } catch (error) {
      if (my !== seq.current) return;
      if (isStatus(error, 401)) unauthorized.current();
      else setNote({ kind: "error", text: describeError(error) });
    }
  }

  async function searchAll(q: string) {
    const my = ++seq.current;
    setNote({ kind: "loading" });
    try {
      const r = await searchOrdersAnyDate(q);
      if (my !== seq.current) return;
      setNote({ kind: "results", matches: r.matches, truncated: r.truncated });
    } catch (error) {
      if (my !== seq.current) return;
      if (isStatus(error, 401)) unauthorized.current();
      else setNote({ kind: "error", text: describeError(error) });
    }
  }

  /** 页面开着时带了 ?q=&from=（从另一个 Tracking 页带过来，Q4 A）：读到这一天就定位，蓝条给 ← Back。 */
  const arrive = useCallback((order: string, from: string | null, target: string) => {
    setPending({ order, target, product: "", from, others: [], staleData: undefined });
    void findOrderAnyDate(order)
      .then((found) => {
        if (!found) return;
        const others = found.products.filter(
          (p) => !(p.page === page && p.tour_date === target),
        );
        setPending((cur) => (cur && same(cur.order, order) ? { ...cur, others } : cur));
        setHit((cur) => (cur && same(cur.order, order) ? { ...cur, others } : cur));
      })
      .catch(() => {});
  }, [page]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void onEnter();
    }
  }

  function onType(value: string) {
    clear();
    setSearch(value);
  }

  function back() {
    const from = hit?.from;
    clear();
    setSearch("");
    if (from) changeDate(from);
  }

  const LINK =
    "cursor-pointer border-0 bg-transparent p-0 font-bold text-inherit underline";

  const banner: ReactNode = hit ? (
    <div
      data-anydate-banner
      role="status"
      className="mb-2 rounded-[8px] border border-[#93c5fd] bg-[#eff6ff] px-3 py-[7px] text-[12.5px] leading-[1.55] text-[#1e3a8a] max-sm:text-[12px]"
    >
      <b>{hit.order}</b> is on <b>{dayLabel(hit.date)}</b>
      {hit.product ? ` · ${hit.product}` : ""}.
      {hit.others.length ? (
        <>
          {" "}
          Also on this order:{" "}
          {hit.others.map((p, i) => (
            <span key={`${p.product_code}-${p.tour_date}-${i}`}>
              {i ? " · " : ""}
              <button
                type="button"
                data-anydate-other
                className={LINK}
                onClick={() =>
                  goTo(
                    hit.order,
                    p,
                    [
                      ...hit.others.filter((x) => x !== p),
                    ],
                  )
                }
              >
                {dayLabel(p.tour_date)} · {p.product_name}
                {p.page && p.page !== page ? ` → ${PAGE_LABEL[p.page]}` : ""}
                {!p.page ? ` (${statusText(p.status)})` : ""}
              </button>
            </span>
          ))}
          .
        </>
      ) : null}
      {hit.from ? (
        <>
          {" "}
          Moved here from {dayLabel(hit.from)}.{" "}
          <button type="button" data-anydate-back className={LINK} onClick={back}>
            ← Back to {dayLabel(hit.from)}
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  const noteNode: ReactNode = note ? (
    <div
      data-anydate-note={note.kind}
      className={
        "basis-full text-[12px] font-semibold " +
        (note.kind === "error"
          ? "text-[#b3261e]"
          : note.kind === "warn"
            ? "text-[#8a5a00]"
            : "text-[#1e3a8a]")
      }
    >
      {note.kind === "loading" ? (
        "Searching other days…"
      ) : note.kind === "error" ? (
        note.text
      ) : note.kind === "warn" ? (
        <>
          {note.order} is {statusText(note.product.status)} in the Order List (
          {dayLabel(note.product.tour_date)} · {note.product.product_name}) and is
          not on {PAGE_LABEL[page]}.
          {canOpenOrders ? (
            <>
              {" "}
              <a
                href={`/orders?q=${encodeURIComponent(note.order)}`}
                className="font-bold text-inherit underline"
              >
                Open in Order List →
              </a>
            </>
          ) : null}
        </>
      ) : note.kind === "nomatch" ? (
        <>
          No match on {dayLabel(date)}.{" "}
          <button
            type="button"
            data-anydate-all
            className={LINK}
            onClick={() => void searchAll(note.q)}
          >
            Search all dates →
          </button>
        </>
      ) : note.matches.length === 0 ? (
        "No match on any date."
      ) : (
        <ul
          data-anydate-results
          className="mt-1 max-w-[560px] overflow-hidden rounded-[8px] border border-[#cbd5e1] bg-white font-normal text-[#1a1a1a]"
        >
          {note.matches.map((m, i) => (
            <li key={`${m.order_number}-${m.product_code}-${m.tour_date}-${i}`}>
              <button
                type="button"
                data-anydate-result={m.order_number}
                onClick={() =>
                  goTo(
                    m.order_number,
                    m,
                    note.matches.filter(
                      (x) => x !== m && same(x.order_number, m.order_number),
                    ),
                  )
                }
                className="flex w-full cursor-pointer flex-wrap gap-x-2.5 border-0 border-b border-[#f1f5f9] bg-transparent px-3 py-1.5 text-left text-[12.5px] hover:bg-[#f1f5f9]"
              >
                <b className="text-[#1d4ed8] underline">{m.order_number}</b>
                <span>{dayLabel(m.tour_date)}</span>
                <span>{m.product_name}</span>
                <span className="text-[#6b6f76]">{m.name}</span>
                {!m.page ? (
                  <span className="text-[#8a5a00]">
                    {statusText(m.status)}
                  </span>
                ) : m.page !== page ? (
                  <span className="text-[#6b6f76]">{PAGE_LABEL[m.page]}</span>
                ) : null}
              </button>
            </li>
          ))}
          {note.truncated ? (
            <li className="px-3 py-1.5 text-[11.5px] text-[#6b6f76]">
              Showing the first 20. Type more of the name or number.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  ) : null;

  return {
    onKeyDown,
    onType,
    arrive,
    banner,
    note: noteNode,
    hitOrder: hit?.order ?? null,
  };
}
