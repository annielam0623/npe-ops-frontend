"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  HEADER_SEARCH_CLASS,
  LegacyHowTo,
  LegacyPageHeader,
} from "@/components/pickup-locations/legacy-ui";
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
  setProductTourType,
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
import {
  BULK_APPLY_CLASS,
  BULK_BAR_CLASS,
  BULK_CLEAR_CLASS,
  BULK_HINT_CLASS,
  BULK_SELECT_CLASS,
} from "./legacy-ui";
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
  const [bulkTour, setBulkTour] = useState(KEEP);
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

  /**
   * 门票产品的 tour type：走单独的 PATCH，不进上面 PUT 的队列（PUT 不带这个键，两者互不覆盖）。
   * 保存中下拉是禁用的，同一个产品不会有两次并发。失败时改回原值并说明。
   */
  async function saveTourType(p: Product, value: string) {
    const key = `${p.id}:ticket_tour_type`;
    const before = p.ticket_tour_type ?? null;
    const next = value || null;
    patchProduct(p.id, { ticket_tour_type: next });
    setCell(key, "saving");
    setMessage(null);
    try {
      const result = await setProductTourType(p.id, next);
      patchProduct(p.id, { ticket_tour_type: result.ticket_tour_type });
      setCell(key, "saved");
      setTimeout(() => setCell(key, null), 1400);
      setLogVersion((v) => v + 1);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      patchProduct(p.id, { ticket_tour_type: before });
      setCell(key, "failed");
      setMessage({
        tone: "error",
        text: `Could not save the tour type of ${p.product_code}: ${describeError(error)}`,
      });
    }
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
    if (bulkTour !== KEEP) input.ticket_tour_type = bulkTour || null;
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
  /** null = 后端还不支持 tour type（manifests-fields 包落地前），整列和批量下拉都不显示。 */
  const tourTypes = meta.ticket_tour_types ?? null;
  const tourLabel = (key: string) =>
    key
      ? (tourTypes?.find((t) => t.key === key)?.label ?? key)
      : "no tour type";
  // 后端（契约 E 补充）：tour type 必须单独一次批量，同时带组 / 分类整批 400；
  // 设成某个值时选中的有非门票产品也整批 400（清空不限分类）。这里先拦下，不发请求。
  const pickedNonTicket = products.filter(
    (p) => picked.has(p.id) && p.booking_type !== "ticket",
  ).length;
  const tourMixed =
    bulkTour !== KEEP && (bulkGroup !== KEEP || bulkType !== KEEP);
  const tourNonTicket = !!bulkTour && bulkTour !== KEEP && pickedNonTicket > 0;
  const tourBlocked = tourMixed || tourNonTicket;
  const nothingChosen =
    bulkGroup === KEEP && bulkType === KEEP && bulkTour === KEEP;

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
        <div className="mb-5">
          {message.tone === "error" ? (
            <ErrorBanner
              actionLabel="Dismiss"
              onAction={() => setMessage(null)}
            >
              {message.text}
            </ErrorBanner>
          ) : (
            <p
              role="status"
              className="rounded-[12px] border-[0.5px] border-black/10 bg-white px-4 py-2.5 text-[12px] text-[#3B6D11]"
            >
              {message.text}
            </p>
          )}
        </div>
      ) : null}

      <section className={CARD_CLASS}>
        <div className={CARD_HEADER_CLASS}>
          <h2 className={CARD_TITLE_CLASS}>All Products</h2>
          <input
            type="text"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search"
            value={search}
            placeholder="Search…"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search) setSearch("");
            }}
            className={HEADER_SEARCH_CLASS}
          />
        </div>

        {needCount ? (
          // .needs-bar
          <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-black/[.08] bg-[#fff4e5] px-4 py-2.5 text-[12px] text-[#7c4a1e]">
            <span>
              <b className="text-[#9a3412]">{needCount}</b>{" "}
              {needCount === 1 ? "product has" : "products have"} no category
              yet. Until one is picked, this table gives no verdict for them and
              their orders fall back to whatever was stored on the booking
              itself.
            </span>
            <button
              type="button"
              aria-pressed={showNeedsOnly}
              onClick={() => setNeedsOnly((v) => !v)}
              className={cn(
                "cursor-pointer rounded-[6px] border-[0.5px] px-3 py-1 text-[11px] font-semibold whitespace-nowrap",
                showNeedsOnly
                  ? "border-[#9a3412] bg-[#9a3412] text-white"
                  : "border-[#fed7aa] bg-white text-[#9a3412] hover:bg-[#ffe9cc]",
              )}
            >
              {showNeedsOnly ? "Show all products" : "Show only these"}
            </button>
          </div>
        ) : null}

        {picked.size ? (
          <div className={BULK_BAR_CLASS}>
            <b className="font-semibold">{picked.size} product(s) selected</b>
            <select
              aria-label="Group for selected"
              value={bulkGroup}
              onChange={(event) => setBulkGroup(event.target.value)}
              className={BULK_SELECT_CLASS}
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
              className={BULK_SELECT_CLASS}
            >
              <option value={KEEP}>— category: leave as is —</option>
              <option value="">— blank (falls back) —</option>
              {meta.booking_types.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
            {tourTypes ? (
              <select
                aria-label="Tour type for selected"
                value={bulkTour}
                onChange={(event) => setBulkTour(event.target.value)}
                className={BULK_SELECT_CLASS}
              >
                <option value={KEEP}>— tour type: leave as is —</option>
                <option value="">— no tour type —</option>
                {tourTypes.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              disabled={nothingChosen || tourBlocked}
              onClick={() => setBulkConfirm(true)}
              className={BULK_APPLY_CLASS}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className={BULK_CLEAR_CLASS}
            >
              Clear
            </button>
            {nothingChosen ? (
              <span className={BULK_HINT_CLASS}>
                Pick a group
                {tourTypes
                  ? ", a category or a tour type"
                  : " or a category"}{" "}
                to apply.
              </span>
            ) : tourMixed ? (
              <span className={BULK_HINT_CLASS}>
                Change tour type on its own: set group and category back to
                &ldquo;leave as is&rdquo;, or tour type back to &ldquo;leave as
                is&rdquo;.
              </span>
            ) : tourNonTicket ? (
              <span className={BULK_HINT_CLASS}>
                Tour type is for ticket products only — {pickedNonTicket} of the
                selected {pickedNonTicket === 1 ? "isn't" : "aren't"} a ticket
                product. Untick {pickedNonTicket === 1 ? "it" : "them"} or leave
                tour type as is.
              </span>
            ) : null}
          </div>
        ) : null}

        <ProductsTable
          sections={sections}
          groups={groups}
          bookingTypes={meta.booking_types}
          tourTypes={tourTypes}
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
                // 工具条重新出现时几个下拉回到「保持不变」。
                setBulkGroup(KEEP);
                setBulkType(KEEP);
                setBulkTour(KEEP);
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
              setBulkTour(KEEP);
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
          onSaveTourType={(p, value) => void saveTourType(p, value)}
          onToggleActive={(p) => void toggleActive(p)}
        />
      </section>

      <ProductLog
        version={logVersion}
        groups={groups}
        tourTypes={tourTypes ?? []}
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
            Set{" "}
            {joinAnd(
              [
                bulkGroup !== KEEP ? `group to ${groupName(bulkGroup)}` : null,
                bulkType !== KEEP
                  ? `category to ${bulkType ? typeLabel(bulkType) : "blank (falls back)"}`
                  : null,
                bulkTour !== KEEP
                  ? `tour type to ${tourLabel(bulkTour)}`
                  : null,
              ].filter((s): s is string => !!s),
            )}{" "}
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

/** ["a"] → "a"；["a", "b"] → "a and b"；["a", "b", "c"] → "a, b and c"。 */
function joinAnd(parts: string[]): string {
  return parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function Shell({ count, children }: { count?: string; children: ReactNode }) {
  return (
    <main className="text-stone-800">
      <LegacyPageHeader title="🏷️ Products" count={count} />
      {children}
    </main>
  );
}

function HowToUse() {
  return (
    <LegacyHowTo
      title="How to use — Products"
      padY="py-3.5"
      footer={
        <>
          ⚠️ Category decides which reports a product counts in. Changing it
          changes the numbers for every order of that product, past orders
          included.
          <br />
          Product name comes from Rezdy and cannot be edited here. Use Internal
          name for our own name.
        </>
      }
    >
      <li>
        Not in this list yet (orange card, only there when something needs
        adding): pick a Group and a Category, type an Internal name if you like,
        then click Add. The row turns green &ldquo;Added ✓&rdquo; and the
        product appears in All Products. Products with no upcoming orders are
        folded under &ldquo;N more with no upcoming orders&rdquo;. Click that
        line to open it. To add several at once, tick them, pick a group and/or
        a category in the black bar, click Add selected, then confirm.
        &ldquo;Leave as is&rdquo; keeps what each row already has, and Internal
        name always comes from the row. Any that could not be added stay ticked,
        with the reason under the product name.
      </li>
      <li>
        Change one product: change its Group or Category and it saves by itself.
        A new group moves the row under that group&rsquo;s heading. Internal
        name saves when you click out of the box, and the box turns green. If a
        save fails, a message tells you why and the old value comes back.
      </li>
      <li>
        Change many at once: tick the boxes on the left (the box in the header
        ticks every row you can see right now), pick a group and/or a category
        in the black bar, click Apply, then confirm.
      </li>
      <li>
        Tour type (ticket products only): pick which Tickets - SelfDrive pill
        the product shows under on the Manifests page. It saves by itself.
        Ticket products with no tour type show under &ldquo;No tour type
        yet&rdquo; there. To set many at once, tick only ticket products and use
        the tour type menu in the black bar.
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
    </LegacyHowTo>
  );
}
