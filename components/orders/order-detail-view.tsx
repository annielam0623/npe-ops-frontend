"use client";

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  describeOrderError,
  fetchOrder,
  patchOrder,
  unlockOrderPrice,
} from "@/lib/orders-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { OrderDetail, OrderPatch } from "@/types";

const INPUT =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

const STATUS_TONE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  cancelled: "bg-red-50 text-red-700",
};

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

  /** 保存后重拉，但不切回 Loading：另一张卡片里没存的输入保留（各卡片自己管状态）。 */
  const reload = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      if (!quiet) setState({ kind: "loading" });
      try {
        const order = await fetchOrder(orderNumber, signal);
        setState({ kind: "ready", order });
      } catch (error) {
        if (signal?.aborted) return;
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

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-8 sm:px-6">
        <Link
          href="/orders"
          className="text-sm text-stone-500 hover:text-stone-800"
        >
          ← Back to Orders
        </Link>
        <HowToUse />
        {state.kind === "loading" ? (
          <Panel>Loading…</Panel>
        ) : state.kind === "notfound" ? (
          <Panel>Order not found.</Panel>
        ) : state.kind === "error" ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800"
          >
            Could not load this order ({state.message}).{" "}
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="font-semibold underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <OrderBody
            order={state.order}
            onSaved={() => void reload(undefined, true)}
            onUnauthorized={redirectToLogin}
          />
        )}
      </div>
    </main>
  );
}

function OrderBody({
  order: o,
  onSaved,
  onUnauthorized,
}: {
  order: OrderDetail;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const type = o.booking_type !== "—" ? o.booking_type : o.product.type;
  return (
    <>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold text-stone-900">
            {o.order_number}
          </h1>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              STATUS_TONE[o.status.toLowerCase()] ??
                "bg-stone-100 text-stone-600",
            )}
          >
            {o.status}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs",
              o.source === "rezdy"
                ? "bg-stone-100 text-stone-600"
                : "bg-violet-50 text-violet-700",
            )}
          >
            {o.source}
          </span>
        </div>
        {!o.editable ? (
          <p className="text-sm text-red-700">
            Read-only — this order is stored in the new Rezdy table.
            Confirmation #, lunch counts and price cannot be edited here yet.
          </p>
        ) : null}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
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
              ["Location", o.product.pickup_location],
            ]}
          />
          {o.product.item_count > 1 ? (
            <p className="mt-2 text-xs text-amber-800">
              {o.product.item_count} products in this order — the card above
              shows the first one. See Ticket Breakdown and Raw Rezdy items
              below.
            </p>
          ) : null}
        </Card>
        <PriceCard
          order={o}
          onSaved={onSaved}
          onUnauthorized={onUnauthorized}
        />
        <OpsCard order={o} onSaved={onSaved} onUnauthorized={onUnauthorized} />
        <AgentCard detail={o.order_detail} />
        <TicketsCard items={o.items_detail} />
        <Card title="Notes">
          <Rows
            rows={[
              ["Special req.", o.special_requirements],
              ["Note", o.notes],
            ]}
          />
          {o.booking_notes.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {o.booking_notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-md bg-stone-50 px-3 py-2 text-sm"
                >
                  <div className="text-xs text-stone-500">
                    {n.author || "—"} · {n.created_at} · {n.direction}
                  </div>
                  <div className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                    {n.body}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-stone-500">No notes.</p>
          )}
        </Card>
        <Card title="Activity">
          {o.activity_log.length ? (
            <ul className="flex flex-col gap-2">
              {o.activity_log.map((a) => (
                <li key={a.id} className="flex gap-2 text-sm">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 flex-none rounded-full",
                      a.actor_type === "staff" ? "bg-blue-500" : "bg-stone-300",
                    )}
                  />
                  <span>
                    <span className="[overflow-wrap:anywhere]">
                      {a.detail || a.event_type}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {a.actor} · {a.created_at}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">No activity yet.</p>
          )}
        </Card>
      </div>
      <RawBlock title="Raw Rezdy items" value={o.items_detail} />
      <RawBlock title="Raw Rezdy order" value={o.order_detail} />
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
      className="rounded-lg border border-stone-200 bg-white px-4 py-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, unknown][] }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-stone-500">{k}</dt>
          <dd className="[overflow-wrap:anywhere] text-stone-800">{show(v)}</dd>
        </div>
      ))}
    </dl>
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
          <span className="flex items-center gap-2">
            {p.overridden ? (
              <>
                <span className="text-xs text-amber-700">🔒 Price locked</span>
                <button
                  type="button"
                  disabled={unlocking}
                  onClick={() => setUnlocking(true)}
                  className="text-xs font-semibold text-sky-700 underline"
                >
                  Unlock
                </button>
              </>
            ) : null}
            {!editing ? (
              <button
                type="button"
                onClick={() => {
                  setForm(initial());
                  setError(null);
                  setEditing(true);
                }}
                className="text-xs font-semibold text-sky-700 underline"
              >
                Edit
              </button>
            ) : null}
          </span>
        ) : undefined
      }
    >
      {editing ? (
        <div className="flex flex-col gap-2 text-sm">
          {(
            [
              ["total_amount", "Total"],
              ["total_paid", "Paid"],
              ["total_due", "Balance"],
            ] as const
          ).map(([k, label]) => (
            <label
              key={k}
              className="grid grid-cols-[120px_1fr] items-center gap-2"
            >
              <span className="text-stone-500">{label}</span>
              <input
                type="number"
                step="0.01"
                value={form[k]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [k]: e.target.value }))
                }
                className={INPUT}
              />
            </label>
          ))}
          <label className="grid grid-cols-[120px_1fr] items-center gap-2">
            <span className="text-stone-500">Currency</span>
            <input
              type="text"
              maxLength={10}
              value={form.currency}
              onChange={(e) =>
                setForm((f) => ({ ...f, currency: e.target.value }))
              }
              className={INPUT}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
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
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="text-2xl font-semibold text-stone-900">
            {money(p.total_amount, p.currency)}
          </p>
          <Rows
            rows={[
              ["Paid", money(p.total_paid, p.currency)],
              ["Balance", money(p.total_due, p.currency)],
              ["Currency", p.currency],
            ]}
          />
        </>
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
            <p className="font-medium text-red-700">
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
          <button
            type="button"
            onClick={() => {
              setForm(initial());
              setError(null);
              setEditing(true);
            }}
            className="text-xs font-semibold text-sky-700 underline"
          >
            Edit
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="flex flex-col gap-2 text-sm">
          <label className="grid grid-cols-[120px_1fr] items-center gap-2">
            <span className="text-stone-500">Confirmation #</span>
            <input
              type="text"
              maxLength={100}
              value={form.confirmation_no}
              onChange={(e) =>
                setForm((f) => ({ ...f, confirmation_no: e.target.value }))
              }
              className={INPUT}
            />
          </label>
          {(
            [
              ["lunch_turkey", "Lunch turkey"],
              ["lunch_veggie", "Lunch veggie"],
              ["lunch_beef", "Lunch beef"],
            ] as const
          ).map(([k, label]) => (
            <label
              key={k}
              className="grid grid-cols-[120px_1fr] items-center gap-2"
            >
              <span className="text-stone-500">{label}</span>
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
            </label>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className={PRIMARY_BUTTON_CLASS}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <Rows
          rows={[
            ["Confirmation #", ops.confirmation_no],
            ["TT #", ops.tt_number],
            ["Agent", ops.agent_name],
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
        <p className="text-sm text-stone-500">No Rezdy order data.</p>
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
  return open ? (
    <span className="font-mono">{value}</span>
  ) : (
    <span>
      ••••{value.slice(-4)}{" "}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-sky-700 underline"
      >
        show
      </button>
    </span>
  );
}

function TicketsCard({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? (items as RezdyItem[]) : [];
  return (
    <Card title="Ticket Breakdown">
      {list.length ? (
        <div className="flex flex-col gap-3 text-sm">
          {list.map((it, i) => (
            <div key={i}>
              <div className="font-medium text-stone-800">
                {it.productName ?? "—"}
              </div>
              <table className="mt-1 text-xs">
                <tbody>
                  {(it.quantities ?? []).map((q, j) => (
                    <tr key={j}>
                      <td className="pr-3">{q.optionLabel}</td>
                      <td className="pr-3">
                        {typeof q.optionPrice === "number"
                          ? `$${q.optionPrice.toFixed(2)}`
                          : ""}
                      </td>
                      <td>× {q.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(it.participants ?? []).map((p, pi) =>
                (p.fields ?? []).map((f, fi) => (
                  <div key={`${pi}-${fi}`} className="text-xs text-stone-600">
                    P{pi + 1} {f.label}:{" "}
                    {/barcode|ticket\s*number/i.test(f.label ?? "") &&
                    f.value ? (
                      <Masked value={String(f.value)} />
                    ) : (
                      show(f.value)
                    )}
                  </div>
                )),
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-stone-500">No item detail.</p>
      )}
    </Card>
  );
}

const RAW_LIMIT = 20000;

function RawBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value, null, 2);
  return (
    <details className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-800">
        {title}
      </summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded bg-stone-50 p-2 text-xs">
        {text.slice(0, RAW_LIMIT)}
      </pre>
      {text.length > RAW_LIMIT ? (
        <p className="mt-1 text-xs text-stone-500">
          Truncated for display — {text.length.toLocaleString("en-US")}{" "}
          characters total.
        </p>
      ) : null}
    </details>
  );
}

function HowToUse() {
  return (
    <details className="rounded-lg border border-sky-200 bg-sky-50 px-5 py-3 text-sm leading-relaxed text-stone-700">
      <summary className="cursor-pointer font-semibold text-sky-900">
        📖 How to use — Order Detail
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          This page shows one order: guest, product, price, operations, agent
          and commission, tickets, notes and activity.
        </li>
        <li>
          Change the price: click Edit on the Price card, change the numbers,
          click Save, then confirm. Saving a price locks the order, so Rezdy
          stops updating its price and details. Click Unlock to let Rezdy update
          it again.
        </li>
        <li>
          Change operations: click Edit on the Operations card to change
          Confirmation # or lunch counts, then Save. A lunch box left empty is
          not changed. An empty Confirmation # clears it.
        </li>
        <li>
          You can have both cards open at once. Saving one does not lose what
          you typed in the other.
        </li>
        <li>
          Ticket barcodes are hidden; click show to see one. Raw Rezdy items and
          Raw Rezdy order at the bottom open the original data Rezdy sent.
        </li>
      </ol>
      <p className="mt-2">
        Some orders are read-only: a red note under the order number says so and
        the Edit buttons are not shown. If a save does not work, the reason
        shows in red under the Save button and nothing is changed.
      </p>
    </details>
  );
}
