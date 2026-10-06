"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  bulkUpdateProducts,
  createProduct,
  fetchMissingProducts,
  fetchProductGroups,
  fetchProducts,
  setProductActive,
  updateProduct,
} from "@/lib/products-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  MissingProduct,
  Product,
  ProductBulkInput,
  ProductGroups,
  ProductUpdateInput,
} from "@/types";

import {
  groupLabel,
  groupSections,
  matchesSearch,
  needsCategory,
  typeLabel,
} from "./config";
import { ManifestSetupPanel } from "./manifest-setup-panel";
import { MissingCard } from "./missing-card";
import { ProductLog } from "./product-log";
import {
  type CellState,
  type ProductField,
  ProductsTable,
} from "./products-table";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; products: Product[]; meta: ProductGroups };

const KEEP = "__keep__";

export function ProductsView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  /** 「还没加进列表」只在打开页面时拉一次（加完不重画，同旧页面）；拉不到不影响列表。 */
  const [missing, setMissing] = useState<MissingProduct[] | null>(null);
  const [search, setSearch] = useState("");
  const [needsOnly, setNeedsOnly] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulkGroup, setBulkGroup] = useState(KEEP);
  const [bulkType, setBulkType] = useState(KEEP);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [cellStates, setCellStates] = useState<Record<string, CellState>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<{
    tone: "error" | "info";
    text: string;
  } | null>(null);
  const [logVersion, setLogVersion] = useState(0);
  /** 商品改了组以后 Manifest setup 面板要重拉（旧页面不会，面板会过时）。 */
  const [setupVersion, setSetupVersion] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const applyLoadError = useCallback(
    (error: unknown) => {
      if (isStatus(error, 401)) redirectToLogin();
      else if (isStatus(error, 403)) setView({ kind: "forbidden" });
      else setView({ kind: "error", message: describeError(error) });
    },
    [redirectToLogin],
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const [products, meta] = await Promise.all([
          fetchProducts(signal),
          fetchProductGroups(signal),
        ]);
        if (signal.aborted) return;
        setView({ kind: "ready", products, meta });
        fetchMissingProducts(signal)
          .then((list) => !signal.aborted && setMissing(list))
          .catch(() => !signal.aborted && setMissing([]));
      } catch (error) {
        if (!signal.aborted) applyLoadError(error);
      }
    })();
    return () => controller.abort();
  }, [reloadKey, applyLoadError]);

  const refresh = useCallback(async () => {
    setLogVersion((v) => v + 1);
    try {
      const products = await fetchProducts();
      setView((prev) => (prev.kind === "ready" ? { ...prev, products } : prev));
    } catch (error) {
      applyLoadError(error);
    }
  }, [applyLoadError]);

  function setCell(key: string, state: CellState | null) {
    setCellStates((all) => {
      const next = { ...all };
      if (state) next[key] = state;
      else delete next[key];
      return next;
    });
  }

  function patchProduct(id: number, patch: Partial<Product>) {
    setView((prev) =>
      prev.kind === "ready"
        ? {
            ...prev,
            products: prev.products.map((p) =>
              p.id === id ? { ...p, ...patch } : p,
            ),
          }
        : prev,
    );
  }

  /**
   * 每个商品排队保存：⚠️ PUT 是整体覆盖，两次 PUT 并发时先发的可能后到、把新值盖掉。
   * confirmed 是最后存成功的三项，每次 PUT 发出时才在它上面改这一格（别的格没存好的值不带，
   * 失败时就只是这一格的错）；desired 是页面上显示的值，用来判断失败后要不要改回。
   */
  const saveQueueRef = useRef(
    new Map<
      number,
      {
        chain: Promise<void>;
        desired: ProductUpdateInput;
        confirmed: ProductUpdateInput;
      }
    >(),
  );

  /** 改一格就存。失败时只把这一格改回原值并说明。 */
  function saveField(p: Product, field: ProductField, value: string) {
    const key = `${p.id}:${field}`;
    const queues = saveQueueRef.current;
    const current: ProductUpdateInput = {
      internal_name: p.internal_name,
      manifest_id: p.manifest_id,
      booking_type: p.booking_type ?? "",
    };
    // 还有没存完的就接着上一次的值改（这一行的 p 可能是旧渲染的）。
    const q = queues.get(p.id) ?? {
      chain: Promise.resolve(),
      desired: current,
      confirmed: current,
    };
    queues.set(p.id, q);
    const parsed =
      field === "manifest_id" ? (value ? Number(value) : null) : value;
    q.desired = { ...q.desired, [field]: parsed };
    patchProduct(p.id, {
      [field]: field === "booking_type" ? value || null : parsed,
    });
    setCell(key, "saving");
    setMessage(null);

    const run = async () => {
      const sent = { ...q.confirmed, [field]: parsed };
      try {
        await updateProduct(p.id, sent);
        q.confirmed = sent;
        setCell(key, "saved");
        setTimeout(() => setCell(key, null), 1400);
        if (field === "manifest_id") {
          // 换了组：重拉，让这一行挪到新组下面；Manifest setup 面板也跟着更新。
          setSetupVersion((v) => v + 1);
          void refresh();
        } else {
          setLogVersion((v) => v + 1);
        }
      } catch (error) {
        if (isStatus(error, 401)) {
          redirectToLogin();
          return;
        }
        // 只改回这一格；人在排队期间又改了这一格就不动（那次保存会再试）。
        if (q.desired[field] === parsed) {
          const old = q.confirmed[field];
          q.desired = { ...q.desired, [field]: old };
          patchProduct(p.id, {
            [field]: field === "booking_type" ? old || null : old,
          });
        }
        setCell(key, "failed");
        setMessage({
          tone: "error",
          text: `Could not save ${p.product_code}: ${describeError(error)}`,
        });
      }
    };
    const chained = q.chain.then(run);
    q.chain = chained;
    void chained.finally(() => {
      // 排空了就丢掉，之后以重拉的数据为准。
      if (queues.get(p.id)?.chain === chained) queues.delete(p.id);
    });
  }

  async function toggleActive(p: Product) {
    setBusyId(p.id);
    setMessage(null);
    try {
      await setProductActive(p.id, !p.is_active);
      patchProduct(p.id, { is_active: !p.is_active });
      setLogVersion((v) => v + 1);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setMessage({
        tone: "error",
        text: `Could not change the status of ${p.product_code}: ${describeError(error)}`,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function applyBulk() {
    const input: ProductBulkInput = { ids: [...picked] };
    if (bulkGroup !== KEEP)
      input.manifest_id = bulkGroup ? Number(bulkGroup) : null;
    if (bulkType !== KEEP) input.booking_type = bulkType;
    try {
      const result = await bulkUpdateProducts(input);
      setPicked(new Set());
      if (result.unchanged || result.missing) {
        setMessage({
          tone: "info",
          text: `${result.updated} updated · ${result.unchanged} already set that way · ${result.missing} no longer in the list`,
        });
      }
      if (bulkGroup !== KEEP) setSetupVersion((v) => v + 1);
      setBulkConfirm(false);
      void refresh();
      return { status: "ok" } as const;
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" } as const;
      }
      return { status: "error", message: describeError(error) } as const;
    }
  }

  async function addMissing(
    m: MissingProduct,
    choice: { groupId: string; type: string; internal: string },
  ) {
    try {
      await createProduct({
        product_code: m.product_code,
        product_name: m.product_name,
        internal_name: choice.internal,
        manifest_id: choice.groupId ? Number(choice.groupId) : null,
        booking_type: choice.type,
      });
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
      }
      throw new Error(describeError(error));
    }
    if (choice.groupId) setSetupVersion((v) => v + 1);
    void refresh();
  }

  if (view.kind !== "ready") {
    return (
      <Shell>
        {view.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Admin access required</p>
            <p className="mt-1">Only admins can change products.</p>
          </Panel>
        ) : view.kind === "error" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Could not load the product list: {view.message}
          </ErrorBanner>
        ) : (
          <Panel>Loading…</Panel>
        )}
      </Shell>
    );
  }

  const { products, meta } = view;
  const groups = meta.groups;
  const inactive = products.filter((p) => !p.is_active).length;
  const needCount = products.filter(needsCategory).length;
  const showNeedsOnly = needsOnly && needCount > 0;
  const visibleList = products.filter(
    (p) => matchesSearch(p, search) && (!showNeedsOnly || needsCategory(p)),
  );
  const visibleIds = new Set(visibleList.map((p) => p.id));
  const sections = groupSections(products, visibleIds);
  const allVisiblePicked =
    visibleList.length > 0 && visibleList.every((p) => picked.has(p.id));
  const groupName = (id: string) =>
    id
      ? (groups.find((g) => String(g.id) === id)?.display_name ?? "")
      : "No group";

  return (
    <Shell
      count={`${products.length} products${inactive ? ` · ${inactive} inactive` : ""}`}
    >
      <HowToUse />

      <ManifestSetupPanel
        version={setupVersion}
        onUnauthorized={redirectToLogin}
      />

      {missing && missing.length ? (
        <MissingCard
          missing={missing}
          groups={groups}
          bookingTypes={meta.booking_types}
          onAdd={addMissing}
        />
      ) : null}

      {message ? (
        message.tone === "error" ? (
          <ErrorBanner actionLabel="Dismiss" onAction={() => setMessage(null)}>
            {message.text}
          </ErrorBanner>
        ) : (
          <p
            role="status"
            className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900"
          >
            {message.text}
          </p>
        )
      ) : null}

      <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">All Products</h2>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search…"
            aria-label="Search"
            className="w-48 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
          />
        </div>

        {needCount ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-900">
            <span>
              <b>{needCount}</b>{" "}
              {needCount === 1 ? "product has" : "products have"} no category
              yet. Until one is picked, this table gives no verdict for them and
              their orders fall back to whatever was stored on the booking
              itself.
            </span>
            <button
              type="button"
              aria-pressed={showNeedsOnly}
              onClick={() => setNeedsOnly((v) => !v)}
              className="rounded-md border border-orange-400 bg-white px-3 py-1 text-xs font-semibold hover:bg-orange-100"
            >
              {showNeedsOnly ? "Show all products" : "Show only these"}
            </button>
          </div>
        ) : null}

        {picked.size ? (
          <div className="flex flex-wrap items-center gap-2 bg-stone-900 px-4 py-2 text-sm text-white">
            <span>{picked.size} product(s) selected</span>
            <select
              aria-label="Group for selected"
              value={bulkGroup}
              onChange={(event) => setBulkGroup(event.target.value)}
              className="rounded-md bg-white px-2 py-1 text-stone-800"
            >
              <option value={KEEP}>— group: leave as is —</option>
              <option value="">— no group —</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {groupLabel(g)}
                </option>
              ))}
            </select>
            <select
              aria-label="Category for selected"
              value={bulkType}
              onChange={(event) => setBulkType(event.target.value)}
              className="rounded-md bg-white px-2 py-1 text-stone-800"
            >
              <option value={KEEP}>— category: leave as is —</option>
              <option value="">— blank (falls back) —</option>
              {meta.booking_types.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={bulkGroup === KEEP && bulkType === KEEP}
              onClick={() => setBulkConfirm(true)}
              className="rounded-md bg-white px-3 py-1 font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="rounded-md border border-white/40 px-3 py-1 hover:bg-white/10"
            >
              Clear
            </button>
            {bulkGroup === KEEP && bulkType === KEEP ? (
              <span className="text-xs text-white/60">
                Pick a group or a category to apply.
              </span>
            ) : null}
          </div>
        ) : null}

        <ProductsTable
          sections={sections}
          groups={groups}
          bookingTypes={meta.booking_types}
          picked={picked}
          cellStates={cellStates}
          busyId={busyId}
          placeholder={
            products.length === 0
              ? "Nothing here yet."
              : visibleList.length === 0
                ? "No products match."
                : null
          }
          allVisiblePicked={allVisiblePicked}
          onPick={(id, on) =>
            setPicked((set) => {
              if (!set.size && on) {
                // 工具条重新出现时两个下拉回到「保持不变」。
                setBulkGroup(KEEP);
                setBulkType(KEEP);
              }
              const next = new Set(set);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onPickAll={(on) => {
            if (on && !picked.size) {
              setBulkGroup(KEEP);
              setBulkType(KEEP);
            }
            setPicked((set) => {
              const next = new Set(set);
              for (const p of visibleList) {
                if (on) next.add(p.id);
                else next.delete(p.id);
              }
              return next;
            });
          }}
          onSave={(p, field, value) => saveField(p, field, value)}
          onToggleActive={(p) => void toggleActive(p)}
        />
        <p className="border-t border-stone-200 px-4 py-2.5 text-xs leading-relaxed text-stone-600">
          ⚠️ Category decides which reports a product counts in. Changing it
          changes the numbers for every order of that product, past orders
          included.
          <br />
          Product name comes from Rezdy and cannot be edited here. Use Internal
          name for our own name.
        </p>
      </section>

      <ProductLog
        version={logVersion}
        groups={groups}
        onUnauthorized={redirectToLogin}
      />

      {bulkConfirm ? (
        <ConfirmDialog
          title={`Change ${picked.size} product(s)?`}
          confirmLabel="Apply"
          busyLabel="Applying…"
          danger={bulkType !== KEEP}
          onConfirm={applyBulk}
          onClose={() => setBulkConfirm(false)}
        >
          <p>
            {[
              bulkGroup !== KEEP
                ? `Set group to ${groupName(bulkGroup)}`
                : null,
              bulkType !== KEEP
                ? `${bulkGroup !== KEEP ? "and category" : "Set category"} to ${
                    bulkType ? typeLabel(bulkType) : "blank (falls back)"
                  }`
                : null,
            ]
              .filter(Boolean)
              .join(" ")}{" "}
            for {picked.size} product(s)?
          </p>
          {bulkType !== KEEP ? (
            <p className={cn("font-medium text-red-700")}>
              Category drives the reports, so this changes how every order of
              these products is counted — past orders too.
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </Shell>
  );
}

function Shell({ count, children }: { count?: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              Settings
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">
              🏷️ Products
            </h1>
          </div>
          {count ? (
            <span className="text-sm text-stone-500">{count}</span>
          ) : null}
        </header>
        {children}
      </div>
    </main>
  );
}

function HowToUse() {
  return (
    <details className="rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-stone-700">
      <summary className="cursor-pointer font-semibold text-sky-900">
        📖 How to use — Products
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Not in this list yet (orange card, only there when something needs
          adding): pick a Group and a Category, type an Internal name if you
          like, then click Add. The row turns green &ldquo;Added ✓&rdquo; and
          the product appears in All Products. Products with no upcoming orders
          are folded under &ldquo;N more with no upcoming orders&rdquo;. Click
          that line to open it. To add several at once, tick them, pick a group
          and/or a category in the black bar, click Add selected, then confirm.
          &ldquo;Leave as is&rdquo; keeps what each row already has, and
          Internal name always comes from the row. Any that could not be added
          stay ticked, with the reason under the product name.
        </li>
        <li>
          Change one product: change its Group or Category and it saves by
          itself. A new group moves the row under that group&rsquo;s heading.
          Internal name saves when you click out of the box, and the box turns
          green. If a save fails, a message tells you why and the old value
          comes back.
        </li>
        <li>
          Change many at once: tick the boxes on the left (the box in the header
          ticks every row you can see right now), pick a group and/or a category
          in the black bar, click Apply, then confirm.
        </li>
        <li>
          No category yet: rows with an orange left edge have no category. Click
          Show only these in the orange bar to see just them.
        </li>
        <li>
          Stop selling a product: click Deactivate. It stays in the list, greyed
          out, and Reactivate brings it back. Nothing is ever deleted on this
          page.
        </li>
        <li>
          If a list is wider than the window, scroll it sideways to see the
          columns on the right.
        </li>
      </ol>
    </details>
  );
}
