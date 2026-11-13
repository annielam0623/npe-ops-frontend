"use client";

import {
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { ManifestLinks } from "@/components/order-lookup/manifest-links";

import { FarmOutViewCard } from "@/components/farm-out/farm-out-view-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  describeOrderError,
  fetchOrder,
  patchOrder,
  unlockOrderPrice,
} from "@/lib/orders-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { usePermissions } from "@/lib/staff-permissions";
import { useTick } from "@/lib/use-tick";
import { cn } from "@/lib/utils";
import { PageLink } from "@/components/ui/page-link";
import type { OrderDetail, OrderPatch } from "@/types";

import {
  RefreshButton,
  RefreshResultCard,
  type RefreshState,
  useOrderRefresh,
} from "./refresh-from-rezdy";
import {
  sendDateFor,
  type SendOrderState,
  PickupMissingAlert,
  SendTourButton,
  SendTourResultCard,
  useSendTourOrder,
} from "./send-tour-confirmation";

// 样子照旧后台 admin/order_detail.html（Annie 2026-10-07：和旧版一模一样）。
/** .od-input */
const INPUT =
  "h-[26px] w-full rounded-md border-[0.5px] border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] px-2 text-[13px] focus:border-[#1a1a1a] night:focus:border-white/40 focus:outline-none";
/** .od-btn */
const OD_BTN =
  "h-[26px] cursor-pointer rounded-md border-[0.5px] border-black/[.18] night:border-white/10 bg-paper night:bg-white/[.04] px-2.5 text-[11px] font-normal tracking-normal text-[#1a1a1a] night:text-white/75 normal-case hover:border-black/40 disabled:cursor-default disabled:opacity-45";
/** .od-btn.od-btn-primary */
const OD_BTN_PRIMARY =
  "h-[26px] cursor-pointer rounded-md border-[0.5px] border-[#1a1a1a] night:border-white/40 bg-[#1a1a1a] px-2.5 text-[11px] text-white hover:bg-[#333] disabled:cursor-default disabled:opacity-45";
/** .od-loading：直接写在深色底上。 */
const OD_LOADING =
  "p-10 text-center text-[13px] text-[#ccc] night:text-white/35";
/** 卡片里的 .od-loading（padding:14px）。 */
const OD_LOADING_IN_CARD =
  "p-3.5 text-center text-[13px] text-[#1a1a1a] night:text-white/35";
/** .od-warn */
const OD_WARN = "mt-1.5 text-[11px] text-[#B3261E] night:text-red-300";
/** .sp */
const SP = "inline-block rounded-[10px] px-2 py-0.5 text-[11px]";

function money(value: number | null, currency: string): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value).toFixed(2);
  return currency ? `${currency} ${n}` : `$${n}`;
}

const show = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

function errorText(error: unknown): string {
  return describeOrderError(error) ?? describeError(error);
}

export function OrderDetailView({ orderNumber }: { orderNumber: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "notfound" }
    | { kind: "error"; message: string }
    | { kind: "ready"; order: OrderDetail }
  >({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  /** 只认最后一次重拉：连着保存两次时，先发的 GET 晚到也不会盖掉后发的。 */
  const seqRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  /** 保存后重拉，但不切回 Loading：另一张卡片里没存的输入保留（各卡片自己管状态）。 */
  // partner 只能看（Annie 2026-10-27「合作方只能看manifest和订单，不能改或者选任何功能」）：
  // 不出 Edit / Unlock、How to use、Agent & Commission（N2 B）、Farm out、条码的 show、Raw Rezdy。员工照旧。
  const perms = usePermissions();
  const partner = perms.partnerView;
  // 员工也按勾（Annie 2026-10-30 置顶 10c）：没勾 orders.edit 就没有 Edit / Unlock；总开关关着照旧全给，Super Admin 全给。
  const canEditOrder = useTick("orders.edit");
  const reload = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      const seq = ++seqRef.current;
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;
      signal?.addEventListener("abort", () => controller.abort());
      if (!quiet) setState({ kind: "loading" });
      try {
        const order = await fetchOrder(orderNumber, controller.signal);
        if (seq !== seqRef.current) return;
        setState({ kind: "ready", order });
      } catch (error) {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 404)) setState({ kind: "notfound" });
        else setState({ kind: "error", message: describeError(error) });
      }
    },
    [orderNumber, redirectToLogin],
  );

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload, reloadKey]);

  // 「Refresh from Rezdy」（置顶 111）：结果放在这里，静默重读后结果卡照样留着。
  const quietReload = useCallback(() => void reload(undefined, true), [reload]);
  const refresh = useOrderRefresh(orderNumber, quietReload, redirectToLogin);
  // 只在新 Rezdy 表的单（后端原始 editable = false）、有 orders.edit 时出；partner 不出（后端 3e：挂 orders.edit）。
  // G280：TripGuru 的单不出（这个键是去 Rezdy 重拉）。
  // G297：「Send tour confirmation」——有 manifests.send 的员工；partner 不出。日期优先网址的 tour_date（Notice 链接带的）。
  const canSendTour = useTick("manifests.send") && !partner;
  const urlDate = useSearchParams().get("tour_date");
  const sendTour = useSendTourOrder(orderNumber, redirectToLogin);
  const canRefresh =
    state.kind === "ready" &&
    !partner &&
    canEditOrder &&
    !state.order.editable &&
    state.order.source !== "tripguru";

  return (
    <main className="text-stone-800 night:text-white/90">
      <PageLink
        href="/orders"
        className="mb-3 inline-block text-[12px] text-[#888] no-underline hover:text-[#378ADD] night:text-white/55 night:hover:text-sky-300"
      >
        ← Back to Orders
      </PageLink>
      {partner ? null : (
        <HowToUse
          money={perms.canSeeMoney}
          refresh={canRefresh}
          sendTour={canSendTour}
        />
      )}
      {state.kind === "loading" ? (
        <div className={OD_LOADING}>Loading…</div>
      ) : state.kind === "notfound" ? (
        <div className={OD_LOADING}>Order not found.</div>
      ) : state.kind === "error" ? (
        <div role="alert" className={OD_LOADING}>
          Could not load this order ({state.message}).{" "}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="text-[#5ba3d9] underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <OrderBody
          order={
            partner || !canEditOrder
              ? { ...state.order, editable: false }
              : state.order
          }
          partner={partner}
          storedReadOnly={!state.order.editable}
          refresh={canRefresh ? refresh : null}
          sendTour={canSendTour ? { ...sendTour, urlDate } : null}
          onSaved={() => void reload(undefined, true)}
          onUnauthorized={redirectToLogin}
        />
      )}
    </main>
  );
}

function OrderBody({
  order: o,
  partner,
  storedReadOnly,
  refresh,
  sendTour,
  onSaved,
  onUnauthorized,
}: {
  order: OrderDetail;
  /** null = 不出 Send tour confirmation 键。 */
  sendTour: {
    state: SendOrderState;
    run: (date: string) => Promise<void>;
    urlDate: string | null;
  } | null;
  partner: boolean;
  /** null = 不出 Refresh from Rezdy 键。 */
  refresh: { state: RefreshState; run: () => Promise<void> } | null;
  /** 后端说这单本来就改不了（新 Rezdy 表）：才写 Read-only 那句；只是没勾 orders.edit 不写。 */
  storedReadOnly: boolean;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const type = o.booking_type !== "—" ? o.booking_type : o.product.type;
  // 没勾 See prices, agent & commission（orders.money_view，题 8「除了客人的基本信息，CCL看不到任何有价格的信息」）：
  // 价格卡、Agent & Commission、票价、Raw Rezdy 都不出。后端这时 price = null、order_detail / items_detail 去掉代理商 / 付款 / 金额。
  const seeMoney = usePermissions().canSeeMoney && o.price !== null;
  // G280：TripGuru 来的单（后端 26fdfa29）：只读，order_detail / items_detail 是 TripGuru 的键名。
  const tripguru = o.source === "tripguru";
  const raw = tripguru ? "TripGuru" : "Rezdy";
  const sendDate = sendTour
    ? sendDateFor(sendTour.urlDate, o.product.tour_date)
    : null;
  // G297：酒店空着——照后端 send_guard.no_pickup_location_orders：原始字段去掉空格后为空才算（「TBD」「—」都当有值，
  // 「—」只是页面显示空值的占位、库里没有）；门票单不算（没有接客）。
  // 有发送键的人才看到红字提醒、键灰掉；Rezdy 补好、Refresh from Rezdy 后重读，红字自动消失、键能按。
  const hotelMissing =
    sendTour !== null &&
    o.product.type !== "ticket" &&
    o.booking_type !== "ticket" &&
    !String(o.product.pickup_location ?? "").trim();
  return (
    <>
      {/* .od-head：订单号直接在深色底上，旧页的 #1a1a1a 看不见，改用旧后台正文色 #f8fafc。 */}
      <header
        className={cn(
          "flex flex-wrap items-center gap-2.5",
          o.editable && "mb-4",
        )}
      >
        <h1 className="text-[20px] font-semibold tracking-[0.3px] text-[#f8fafc]">
          {o.order_number}
        </h1>
        <span
          className={cn(
            SP,
            "bg-[#EAF3DE] text-[#3B6D11] night:bg-emerald-400/10 night:text-emerald-300",
          )}
        >
          {/* G280：TripGuru 的状态是小写原文（pending / confirmed / cancelled），首字母大写，同 Order List 的标签。 */}
          {tripguru && o.status
            ? o.status.charAt(0).toUpperCase() + o.status.slice(1)
            : o.status}
        </span>
        <span
          className={cn(
            SP,
            o.source === "rezdy"
              ? "bg-[#f1efe8] text-[#1a1a1a] night:bg-white/[.04] night:text-white/65"
              : tripguru
                ? "bg-[#E6F1FB] text-[#185FA5] night:bg-sky-400/[.08] night:text-sky-300"
                : "bg-[#EEEDFE] text-[#534AB7] night:bg-violet-400/15 night:text-violet-300",
          )}
        >
          {o.source === "rezdy" ? "Rezdy" : tripguru ? "TripGuru" : o.source}
        </span>
        {refresh || sendTour ? (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {sendTour ? (
              <SendTourButton
                busy={sendTour.state.kind === "busy"}
                date={sendDate}
                hotelMissing={hotelMissing}
                onClick={() => {
                  if (sendDate) void sendTour.run(sendDate);
                }}
              />
            ) : null}
            {refresh ? (
              <RefreshButton
                busy={refresh.state.kind === "busy"}
                onClick={() => void refresh.run()}
              />
            ) : null}
          </div>
        ) : null}
      </header>
      {refresh ? <RefreshResultCard state={refresh.state} /> : null}
      {hotelMissing ? <PickupMissingAlert /> : null}
      {sendTour ? <SendTourResultCard state={sendTour.state} /> : null}
      {/* 置顶 51 B：一点跳到 Main manifest 的那一单（标黄、预勾）。 */}
      <ManifestLinks order={o} className="mt-2 mb-3" />
      {storedReadOnly && !partner ? (
        // 旧页 .od-warn 是 #B3261E，深色底上看不清，用浅一点的红。
        <p data-read-only className="mt-1.5 mb-4 text-[11px] text-[#f87171]">
          {tripguru
            ? "Read-only — this order comes from TripGuru. Confirmation #, lunch counts and price cannot be edited here."
            : "Read-only — this order is stored in the new Rezdy table. Confirmation #, lunch counts and price cannot be edited here yet."}
        </p>
      ) : null}

      {o.farm_out_view && !partner ? (
        <div className="mb-3.5">
          <FarmOutViewCard
            farmOutView={o.farm_out_view}
            ourPickup={
              [o.product.pickup_time, o.product.pickup_location]
                .filter((v) => v && v !== "—")
                .join(" · ") || "—"
            }
          />
        </div>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-3.5">
        <Card title="Guest">
          <Rows
            rows={[
              ["Name", o.guest.name],
              ["Email", o.guest.email],
              ["Phone", o.guest.phone],
              ["Pax", o.guest.pax],
            ]}
          />
        </Card>
        <Card title="Product">
          <Rows
            rows={[
              ["Product", o.product.name],
              ["Code", o.product.code],
              ["Type", type],
              ["Tour date", o.product.tour_date],
              ["Tour time", o.product.tour_time],
              ["Pickup", o.product.pickup_time],
              [
                "Location",
                hotelMissing ? (
                  <span
                    data-order-location-missing
                    className="font-semibold text-[#A32D2D] night:text-red-300"
                  >
                    Missing — add it in Rezdy
                  </span>
                ) : (
                  o.product.pickup_location
                ),
              ],
              ...(o.product.item_count > 1
                ? ([
                    [
                      "Items",
                      `${o.product.item_count} products in this order — the card above shows the first one. See ${tripguru ? "Items" : "Ticket Breakdown"}${partner || !seeMoney ? "" : ` and Raw ${raw} items`} below.`,
                    ],
                  ] as [string, unknown][])
                : []),
            ]}
          />
        </Card>
        {seeMoney ? (
          <PriceCard
            order={o}
            onSaved={onSaved}
            onUnauthorized={onUnauthorized}
          />
        ) : null}
        <OpsCard order={o} onSaved={onSaved} onUnauthorized={onUnauthorized} />
        {/* TripGuru 的代理商现在是空的（后端：等第一张 TEST 单看到真实数据再接），不出 Agent 卡。 */}
        {partner || !seeMoney || tripguru ? null : (
          <AgentCard detail={o.order_detail} />
        )}
        {tripguru ? (
          <TripGuruItemsCard items={o.items_detail} />
        ) : (
          <TicketsCard items={o.items_detail} prices={seeMoney} />
        )}
        {tripguru && !partner && tgInternalNote(o.order_detail) ? (
          <InternalNoteCard note={tgInternalNote(o.order_detail) ?? ""} />
        ) : null}
        <Card title="Notes">
          <Rows
            rows={[
              ["Special req.", o.special_requirements],
              ["Note", o.notes],
            ]}
          />
          {o.booking_notes.length ? (
            <ul>
              {o.booking_notes.map((n) => (
                <li
                  key={n.id}
                  className="border-b-[0.5px] border-black/[.04] py-2 text-[12px] last:border-b-0 night:border-white/10"
                >
                  <div className="mb-[3px] text-[11px] text-[#1a1a1a] night:text-white/55">
                    {n.author || "—"} · {n.created_at} · {n.direction}
                  </div>
                  <div className="[overflow-wrap:anywhere] whitespace-pre-wrap text-[#1a1a1a] night:text-white/90">
                    {n.body}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={OD_LOADING_IN_CARD}>No notes.</div>
          )}
        </Card>
        <Card title="Activity">
          {o.activity_log.length ? (
            <ul>
              {o.activity_log.map((a) => (
                <li
                  key={a.id}
                  className="flex gap-[9px] border-b-[0.5px] border-black/[.04] py-[7px] text-[12px] last:border-b-0 night:border-white/10"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[5px] size-[7px] flex-none rounded-full",
                      a.actor_type === "staff"
                        ? "bg-[#378ADD]"
                        : "bg-[#B8B6AE]",
                    )}
                  />
                  <span>
                    <span className="block [overflow-wrap:anywhere] text-[#1a1a1a] night:text-white/90">
                      {a.detail || a.event_type}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#1a1a1a] night:text-white/35">
                      {a.actor} · {a.created_at}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className={OD_LOADING_IN_CARD}>No activity yet.</div>
          )}
        </Card>
      </div>
      {partner || !seeMoney ? null : (
        <>
          <RawBlock title={`Raw ${raw} items`} value={o.items_detail} />
          <RawBlock title={`Raw ${raw} order`} value={o.order_detail} />
        </>
      )}
    </>
  );
}

function Card({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-[10px] border-[0.5px] border-black/10 bg-paper px-4 py-3.5 night:border-white/10 night:bg-white/[.04]"
    >
      {/* .od-card h3；按钮放在右边（.od-actions） */}
      <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.6px] text-[#1a1a1a] uppercase night:text-white/35">
        {title}
        {actions}
      </h3>
      {children}
    </section>
  );
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === "" || v === "—";

/** .od-row：左边灰字段名、右边值。label = 编辑时整行是输入框的 label。 */
function OdRow({
  k,
  children,
  label,
}: {
  k: ReactNode;
  children: ReactNode;
  label?: boolean;
}) {
  const Tag = label ? "label" : "div";
  return (
    <Tag className="flex items-center gap-2.5 border-b-[0.5px] border-black/[.04] py-[5px] text-[13px] last:border-b-0 night:border-white/10">
      <span className="min-w-[130px] flex-shrink-0 self-start text-[12px] text-[#1a1a1a] night:text-white/35">
        {k}
      </span>
      <span className="flex-1 [overflow-wrap:anywhere] text-[#1a1a1a] night:text-white/90">
        {children}
      </span>
    </Tag>
  );
}

function Rows({ rows }: { rows: [string, unknown][] }) {
  return (
    <div>
      {rows.map(([k, v]) => (
        <OdRow key={k} k={k}>
          {isValidElement(v) ? (
            v
          ) : (
            <span
              className={
                isEmpty(v) ? "text-[#1a1a1a] night:text-white/35" : undefined
              }
            >
              {show(v)}
            </span>
          )}
        </OdRow>
      ))}
    </div>
  );
}

/** 价格卡：保存前确认；有 🔒 时可以 Unlock。 */
function PriceCard({
  order: o,
  onSaved,
  onUnauthorized,
}: {
  order: OrderDetail;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const p = o.price;
  const initial = () => ({
    total_amount: p.total_amount === null ? "" : String(p.total_amount),
    total_paid: p.total_paid === null ? "" : String(p.total_paid),
    total_due: p.total_due === null ? "" : String(p.total_due),
    currency: p.currency ?? "",
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<OrderPatch | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  function buildPatch(): OrderPatch | null {
    const patch: OrderPatch = {};
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    for (const k of ["total_amount", "total_paid", "total_due"] as const) {
      const before = p[k] === null ? "" : String(p[k]);
      if (form[k] !== before) patch[k] = num(form[k]);
    }
    if (form.currency !== (p.currency ?? ""))
      patch.currency = form.currency.trim() || null;
    return Object.keys(patch).length ? patch : null;
  }

  async function save(patch: OrderPatch) {
    try {
      await patchOrder(o.order_number, patch);
      setEditing(false);
      setConfirm(null);
      onSaved();
      return { status: "ok" } as const;
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return { status: "redirecting" } as const;
      }
      setConfirm(null);
      setError(errorText(e));
      return { status: "ok" } as const;
    }
  }

  const cleared = confirm
    ? Object.entries(confirm)
        .filter(([, v]) => v === null)
        .map(([k]) => k)
    : [];

  return (
    <Card
      title="Price"
      actions={
        o.editable ? (
          <>
            {p.overridden ? (
              <span className="flex items-center font-normal tracking-normal normal-case">
                <span
                  className={cn(
                    SP,
                    "bg-[#FDECEA] text-[#B3261E] night:bg-red-500/10 night:text-red-300",
                  )}
                >
                  🔒 Price locked
                </span>
                <button
                  type="button"
                  disabled={unlocking}
                  onClick={() => setUnlocking(true)}
                  className={cn(OD_BTN, "ml-2")}
                >
                  Unlock
                </button>
              </span>
            ) : null}
            {!editing ? (
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setForm(initial());
                    setError(null);
                    setEditing(true);
                  }}
                  className={OD_BTN}
                >
                  Edit
                </button>
              </span>
            ) : null}
          </>
        ) : undefined
      }
    >
      {editing ? (
        <div>
          {(
            [
              ["total_amount", "Total"],
              ["total_paid", "Paid"],
              ["total_due", "Balance"],
            ] as const
          ).map(([k, label]) => (
            <OdRow key={k} k={label} label>
              <input
                type="number"
                step="0.01"
                value={form[k]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [k]: e.target.value }))
                }
                className={INPUT}
              />
            </OdRow>
          ))}
          <OdRow k="Currency" label>
            <input
              type="text"
              maxLength={10}
              value={form.currency}
              onChange={(e) =>
                setForm((f) => ({ ...f, currency: e.target.value }))
              }
              className={INPUT}
            />
          </OdRow>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              className={OD_BTN_PRIMARY}
              onClick={() => {
                const patch = buildPatch();
                if (!patch) {
                  setError("Nothing to save.");
                  return;
                }
                setError(null);
                setConfirm(patch);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className={OD_BTN}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p role="alert" className={OD_WARN}>
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <OdRow k="Total">
            <span className="text-[17px] font-semibold text-[#1a1a1a] tabular-nums night:text-white/90">
              {money(p.total_amount, p.currency)}
            </span>
          </OdRow>
          <OdRow k="Paid">
            <span className="font-medium tabular-nums">
              {money(p.total_paid, p.currency)}
            </span>
          </OdRow>
          <OdRow k="Balance">
            <span className="font-medium tabular-nums">
              {money(p.total_due, p.currency)}
            </span>
          </OdRow>
          <Rows rows={[["Currency", p.currency]]} />
        </div>
      )}
      {confirm ? (
        <ConfirmDialog
          title="Save the price?"
          confirmLabel="Save"
          busyLabel="Saving…"
          onConfirm={() => save(confirm)}
          onClose={() => setConfirm(null)}
        >
          <p>
            Saving a price change locks this order: Rezdy will stop updating its
            price and detail until you unlock it.
          </p>
          {cleared.length ? (
            <p className="font-medium text-red-700 night:text-red-300">
              You are also clearing: {cleared.join(", ")}.
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
      {unlocking ? (
        <ConfirmDialog
          title="Unlock the price?"
          confirmLabel="Unlock"
          busyLabel="Unlocking…"
          onConfirm={async () => {
            try {
              await unlockOrderPrice(o.order_number);
              setUnlocking(false);
              onSaved();
              return { status: "ok" };
            } catch (e) {
              if (isStatus(e, 401)) {
                onUnauthorized();
                return { status: "redirecting" };
              }
              return { status: "error", message: errorText(e) };
            }
          }}
          onClose={() => setUnlocking(false)}
        >
          <p>
            Resume Rezdy price sync for this order? The current price stays
            until Rezdy pushes an update.
          </p>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

/** 运营卡：确认号（空 = 清空）、午餐数（空 = 不改）。 */
function OpsCard({
  order: o,
  onSaved,
  onUnauthorized,
}: {
  order: OrderDetail;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const ops = o.ops;
  // partner 不看代理商（Agent & Commission 对 partner 不出，Annie 2026-10-27 N2 B）；没勾 orders.money_view 也不看（题 8）。
  const perms = usePermissions();
  const hideAgent = perms.partnerView || !perms.canSeeMoney;
  const initial = () => ({
    confirmation_no: ops.confirmation_no ?? "",
    lunch_turkey: String(ops.lunch_turkey ?? 0),
    lunch_veggie: String(ops.lunch_veggie ?? 0),
    lunch_beef: String(ops.lunch_beef ?? 0),
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const patch: OrderPatch = {};
    if (form.confirmation_no !== (ops.confirmation_no ?? "")) {
      patch.confirmation_no = form.confirmation_no.trim() || null;
    }
    for (const k of ["lunch_turkey", "lunch_veggie", "lunch_beef"] as const) {
      if (form[k].trim() !== "" && form[k] !== String(ops[k] ?? 0))
        patch[k] = Number(form[k]);
    }
    if (!Object.keys(patch).length) {
      setError("Nothing to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchOrder(o.order_number, patch);
      setEditing(false);
      onSaved();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Operations"
      actions={
        o.editable && !editing ? (
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setForm(initial());
                setError(null);
                setEditing(true);
              }}
              className={OD_BTN}
            >
              Edit
            </button>
          </span>
        ) : undefined
      }
    >
      {editing ? (
        <div>
          <OdRow k="Confirmation #" label>
            <input
              type="text"
              maxLength={100}
              value={form.confirmation_no}
              onChange={(e) =>
                setForm((f) => ({ ...f, confirmation_no: e.target.value }))
              }
              className={INPUT}
            />
          </OdRow>
          {(
            [
              ["lunch_turkey", "Lunch turkey"],
              ["lunch_veggie", "Lunch veggie"],
              ["lunch_beef", "Lunch beef"],
            ] as const
          ).map(([k, label]) => (
            <OdRow key={k} k={label} label>
              <input
                type="number"
                step="1"
                min="0"
                value={form[k]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [k]: e.target.value }))
                }
                className={INPUT}
              />
            </OdRow>
          ))}
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className={OD_BTN_PRIMARY}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className={OD_BTN}
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p role="alert" className={OD_WARN}>
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <Rows
          rows={[
            ["Confirmation #", ops.confirmation_no],
            ["TT #", ops.tt_number],
            ...(hideAgent
              ? []
              : ([["Agent", ops.agent_name]] as [string, unknown][])),
            ["Driver", ops.driver],
            ["Driver phone", ops.driver_phone],
            ["Vehicle", ops.vehicle_no],
            [
              "Lunch",
              `Turkey ${ops.lunch_turkey ?? 0} / Veggie ${ops.lunch_veggie ?? 0} / Beef ${ops.lunch_beef ?? 0}`,
            ],
          ]}
        />
      )}
    </Card>
  );
}

type RezdyOrder = {
  resellerName?: string;
  commission?: number;
  paymentOption?: string;
  resellerReference?: string;
  sourceChannel?: string;
  source?: string;
  resellerComments?: string;
};

function AgentCard({ detail }: { detail: unknown }) {
  const d = (
    detail && typeof detail === "object" ? detail : null
  ) as RezdyOrder | null;
  return (
    <Card title="Agent & Commission">
      {d ? (
        <Rows
          rows={[
            ["Reseller", d.resellerName],
            [
              "Commission",
              typeof d.commission === "number"
                ? `$${d.commission.toFixed(2)}`
                : d.commission,
            ],
            ["Payment", d.paymentOption],
            ["Agent ref", d.resellerReference],
            ["Source", d.sourceChannel || d.source],
            ["Agent notes", d.resellerComments],
          ]}
        />
      ) : (
        <div className={OD_LOADING_IN_CARD}>No Rezdy order data.</div>
      )}
    </Card>
  );
}

type RezdyItem = {
  productName?: string;
  quantities?: { optionLabel?: string; optionPrice?: number; value?: number }[];
  participants?: { fields?: { label?: string; value?: string }[] }[];
};

/** 门票条码 / 票号是入场凭证：默认只显示后 4 位，点 show 才显示全部。 */
function Masked({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  // partner 不给 show（只看后四位）。
  const partner = usePermissions().partnerView;
  if (partner)
    return (
      <span className="font-mono tracking-[0.5px]">••••{value.slice(-4)}</span>
    );
  return open ? (
    <span className="font-mono tracking-[0.5px]">{value}</span>
  ) : (
    <span>
      <span className="font-mono tracking-[0.5px]">••••{value.slice(-4)}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1.5 cursor-pointer text-[10px] text-[#378ADD] select-none hover:underline night:text-sky-300"
      >
        show
      </button>
    </span>
  );
}

/** prices = false：不出每种票的单价（没勾 orders.money_view，题 8）。 */
function TicketsCard({ items, prices }: { items: unknown; prices: boolean }) {
  const list = Array.isArray(items) ? (items as RezdyItem[]) : [];
  return (
    <Card title="Ticket Breakdown">
      {list.length ? (
        <div>
          {list.map((it, i) => (
            <div key={i}>
              {/* .od-prod */}
              <div className="px-1 pt-2 pb-0.5 text-[12px] font-semibold text-[#1a1a1a] night:text-white/55">
                {it.productName ?? "—"}
              </div>
              {/* table.od-tickets */}
              <table className="w-full border-collapse text-[12px] text-[#1a1a1a] night:text-white/75">
                <tbody>
                  {(it.quantities ?? []).map((q, j) => (
                    <tr
                      key={j}
                      className="border-b-[0.5px] border-black/5 last:border-b-0 night:border-white/10"
                    >
                      <td className="px-1 py-1.5">{q.optionLabel}</td>
                      {prices ? (
                        <td className="px-1 py-1.5 text-right whitespace-nowrap tabular-nums">
                          {typeof q.optionPrice === "number"
                            ? `$${q.optionPrice.toFixed(2)}`
                            : ""}
                        </td>
                      ) : null}
                      <td className="px-1 py-1.5 text-right whitespace-nowrap tabular-nums">
                        × {q.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(it.participants ?? []).map((p, pi) =>
                (p.fields ?? []).map((f, fi) => (
                  <OdRow key={`${pi}-${fi}`} k={`P${pi + 1} ${f.label}`}>
                    {/barcode|ticket\s*number/i.test(f.label ?? "") &&
                    f.value ? (
                      <Masked value={String(f.value)} />
                    ) : (
                      <span
                        className={
                          isEmpty(f.value)
                            ? "text-[#1a1a1a] night:text-white/35"
                            : undefined
                        }
                      >
                        {show(f.value)}
                      </span>
                    )}
                  </OdRow>
                )),
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className={OD_LOADING_IN_CARD}>No item detail.</div>
      )}
    </Card>
  );
}

/**
 * TripGuru 快照里一项（键名照后端 docs/integrations/tripguru-webhook-handoff-2026-11-10.md 第 2 节样例，35 转）。
 * bookingFields / participants 文档里只有 []、形状未知：先当通用键值列表显示（每个元素的键原样列出），空的不显示。
 */
type TripGuruItem = {
  product?: { id?: string; code?: string; name?: string };
  selection?: {
    serviceDate?: string;
    startsAt?: string;
    endsAt?: string;
    timezone?: string;
    option?: { id?: string; code?: string; name?: string };
    /** quantity 是单位数量，不一定是人数（Group 不能当 Adult），不加总成 pax。 */
    units?: { unitId?: string; label?: string; quantity?: number }[];
  };
  bookingFields?: unknown[];
  participants?: unknown[];
};

/** 带时区的 ISO → 那个时区的钟点（例 7:30 AM）；读不懂就原样。 */
function tgTime(iso: string | undefined, tz: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      ...(tz ? { timeZone: tz } : null),
    }).format(d);
  } catch {
    return iso;
  }
}

/** 形状未知的列表（bookingFields / participants）：每个元素的键原样列成一行，空的元素 / 空的值不出。 */
function genericRows(
  list: unknown[] | undefined,
  prefix: string,
): [string, unknown][] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((el, i) => {
    const head = list.length > 1 ? `${prefix} ${i + 1}` : prefix;
    if (el && typeof el === "object" && !Array.isArray(el))
      return Object.entries(el as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(
          ([k, v]) =>
            [
              `${head} · ${k}`,
              typeof v === "object" ? JSON.stringify(v) : v,
            ] as [string, unknown],
        );
    return el === null || el === undefined || el === ""
      ? []
      : ([[head, typeof el === "object" ? JSON.stringify(el) : el]] as [
          string,
          unknown,
        ][]);
  });
}

/** G280：TripGuru 单的项目（产品、选项、日期、场次、每种数量、booking fields / participants）。没有单价（金额在 Price 卡）。 */
function TripGuruItemsCard({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? (items as TripGuruItem[]) : [];
  return (
    <Card title="Items">
      {list.length ? (
        <div data-tripguru-items>
          {list.map((it, i) => {
            const sel = it.selection ?? {};
            const start = tgTime(sel.startsAt, sel.timezone);
            const end = tgTime(sel.endsAt, sel.timezone);
            return (
              <div key={i}>
                <div className="px-1 pt-2 pb-0.5 text-[12px] font-semibold text-[#1a1a1a] night:text-white/55">
                  {it.product?.name ?? "—"}
                </div>
                <Rows
                  rows={[
                    ["Option", sel.option?.name],
                    ["Date", sel.serviceDate],
                    ...(start
                      ? ([["Time", end ? `${start} – ${end}` : start]] as [
                          string,
                          unknown,
                        ][])
                      : []),
                    ...(sel.units ?? []).map(
                      (u) =>
                        [u.label ?? "Quantity", u.quantity] as [
                          string,
                          unknown,
                        ],
                    ),
                    ...genericRows(it.bookingFields, "Booking field"),
                    ...genericRows(it.participants, "Participant"),
                  ]}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className={OD_LOADING_IN_CARD}>No item detail.</div>
      )}
    </Card>
  );
}

/** TripGuru 的内部备注（order_detail.supplier.internalNote，字符串或 null）。 */
function tgInternalNote(detail: unknown): string | null {
  const note = (detail as { supplier?: { internalNote?: unknown } } | null)
    ?.supplier?.internalNote;
  return typeof note === "string" && note.trim() ? note : null;
}

/** G280：TripGuru 的内部备注卡。有 orders.view 就能看；只在员工后台，不进客人页面；没有备注（null）就不出卡。 */
function InternalNoteCard({ note }: { note: string }) {
  return (
    <Card title="Internal note (TripGuru)">
      <div
        data-tripguru-internal-note
        className="px-1 py-1.5 text-[12px] [overflow-wrap:anywhere] whitespace-pre-wrap text-[#1a1a1a] night:text-white/90"
      >
        {note}
      </div>
    </Card>
  );
}

const RAW_LIMIT = 20000;

function RawBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value, null, 2);
  return (
    // details.od-raw
    <details className="mt-3.5 rounded-[10px] border-[0.5px] border-black/10 bg-paper px-4 py-3 night:border-white/10 night:bg-white/[.04]">
      <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.6px] text-[#1a1a1a] uppercase night:text-white/35">
        {title}
      </summary>
      {text.length > RAW_LIMIT ? (
        <p className={OD_WARN}>
          Truncated for display — {text.length.toLocaleString("en-US")}{" "}
          characters total.
        </p>
      ) : null}
      <pre className="mt-2.5 max-h-[420px] overflow-x-auto rounded-[7px] bg-[#fafaf8] p-2.5 text-[11px] leading-[1.5] text-[#1a1a1a] night:bg-white/[.03] night:text-white/75">
        {text.slice(0, RAW_LIMIT)}
      </pre>
    </details>
  );
}

/** money = false（没勾 orders.money_view）：不提价格卡、代理商和 Raw Rezdy。 */
function HowToUse({
  money,
  refresh,
  sendTour,
}: {
  money: boolean;
  refresh: boolean;
  sendTour: boolean;
}) {
  return (
    // 旧页这里是一直展开的蓝框（不是可折叠的 details），样式照 send_morning.html。
    <div className="mb-4 rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3.5 text-[12px] leading-[1.8] text-[#0c3a6b] night:border-sky-400/20 night:bg-sky-400/[.08] night:text-sky-300">
      <div className="mb-1.5 font-semibold text-[#185FA5] night:text-sky-300">
        📖 How to use — Order Detail
      </div>
      <ol className="list-decimal pl-[18px]">
        <li>
          {money
            ? "This page shows one order: guest, product, price, operations, agent and commission, tickets, notes and activity."
            : "This page shows one order: guest, product, operations, tickets, notes and activity."}
        </li>
        {money ? (
          <li>
            Change the price: click Edit on the Price card, change the numbers,
            click Save, then confirm. Saving a price locks the order, so Rezdy
            stops updating its price and details. Click Unlock to let Rezdy
            update it again.
          </li>
        ) : null}
        <li>
          Change operations: click Edit on the Operations card to change
          Confirmation # or lunch counts, then Save. A lunch box left empty is
          not changed. An empty Confirmation # clears it.
        </li>
        {money ? (
          <li>
            You can have both cards open at once. Saving one does not lose what
            you typed in the other.
          </li>
        ) : null}
        {refresh ? (
          <li>
            Refresh from Rezdy (next to the order number): gets this order from
            Rezdy again and updates Order List right away. Use it when a
            guest&apos;s details were changed in Rezdy but did not come through.
            The result shows under the order number: what changed (before →
            after), or that nothing changed. If Rezdy has no phone or email for
            the order, the one we have is kept. If it does not work, the reason
            shows in red and nothing is changed.
          </li>
        ) : null}
        {sendTour ? (
          <li>
            Send tour confirmation (next to the order number): sends this
            order&apos;s tour confirmation by SMS and email, for the tour date
            of this order. If the pickup location is missing, a red message says
            what to fix and the button stays grey: add the pickup location to
            the order in Rezdy, then click Refresh from Rezdy. When the red
            message is gone, click Send tour confirmation. Once it is sent, the
            Pickup location missing notice goes away for everyone. If it is not
            sent, the reason shows in red.
          </li>
        ) : null}
        <li>
          Orders from TripGuru open read-only. Items shows each product with its
          option, date, quantities and booking fields; Internal note (TripGuru)
          is TripGuru&apos;s note for staff and is never shown to guests.
        </li>
        <li>
          Ticket barcodes are hidden; click show to see one.
          {money
            ? " Raw Rezdy items and Raw Rezdy order at the bottom open the original data Rezdy sent."
            : ""}
        </li>
      </ol>
      <div className="mt-2 border-t border-[#b5d4f4] pt-2 night:border-sky-400/20">
        Some orders are read-only: a red note under the order number says so and
        the Edit buttons are not shown. If a save does not work, the reason
        shows in red under the Save button and nothing is changed.
      </div>
    </div>
  );
}
