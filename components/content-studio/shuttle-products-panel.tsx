"use client";

import { useMemo, useState } from "react";

import {
  DIRECTION_ARROW,
  DIRECTION_LABEL,
  DIRECTION_TAG,
  inkOnHollow,
  inkOnSolid,
  normalizeGroupColor,
  orderShuttleProducts,
  parseShuttleName,
  shuttlePillText,
} from "@/lib/shuttle-colors";
import type {
  ShuttleProduct,
  ShuttleProductDirection,
  ShuttleProductGroup,
} from "@/lib/shuttle-products-api";
import { cn } from "@/lib/utils";

import { SHUTTLE_SUBJECT_NOTE, SHUTTLE_VARS } from "./fields";
import { type Studio, TextFieldCard } from "./studio-cards";

/** 键名最后一段（sms_body / email_subject / email_body / guest_page_body）。 */
const fieldOf = (key: string) => key.split("__").pop() ?? "";
/** staff 要填的格（Annie 2026-10-26：主题系统统一出、不做 guest page）。 */
const isEditable = (key: string) =>
  fieldOf(key) === "sms_body" || fieldOf(key) === "email_body";

const SEND_HINT =
  "Not sent yet — Shuttle has no send feature today. This stores the text for when it does.";

/** Email subject 那一格：只读说明，主题由系统统一出（Annie 2026-10-26 选 B1）。 */
export function ShuttleSubjectNote({ fieldKey }: { fieldKey: string }) {
  return (
    <section
      aria-label="Email subject"
      className="mb-2.5 overflow-hidden rounded-[10px] border border-black/10 bg-paper px-3.5 py-2.5 text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
    >
      <h3 className="text-[12px] leading-[1.4] font-semibold">Email subject</h3>
      <div className="mt-px font-mono text-[10px] night:text-white/35">
        {fieldKey}
      </div>
      <p className="mt-1.5 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65">
        {SHUTTLE_SUBJECT_NOTE}
      </p>
    </section>
  );
}

/** 一格文案：短信 / 邮件正文带 Insert 变量；主题是只读说明；guest page 不显示。 */
export function ShuttleFieldCard({
  fieldKey,
  label,
  rows,
  studio,
}: {
  fieldKey: string;
  label: string;
  rows: number;
  studio: Studio;
}) {
  const f = fieldOf(fieldKey);
  if (f === "guest_page_body") return null;
  if (f === "email_subject") return <ShuttleSubjectNote fieldKey={fieldKey} />;
  return (
    <TextFieldCard
      field={{
        key: fieldKey,
        label,
        rows,
        vars: SHUTTLE_VARS,
        hint: f === "sms_body" ? SEND_HINT : undefined,
      }}
      studio={studio}
    />
  );
}

const LABEL_CLASS =
  "mb-2.5 text-[10px] font-bold tracking-[0.07em] text-[#9B8F88] uppercase night:text-white/50";
const BUTTON_CLASS =
  "cursor-pointer rounded-[6px] border border-[#1a1a1a] bg-paper px-2.5 py-1 text-[11px] font-medium text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-white night:border-white/40 night:bg-white/[.04] night:text-white/90";

/** 药丸 / 图例标签的样子：实心 = inbound，空心 = outbound，round = 空心 + 实心圆徽章，没设方向 = 虚线空心。 */
function Chip({
  direction,
  color,
  children,
  small = false,
}: {
  direction: ShuttleProductDirection;
  color: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  const solid = direction === "inbound";
  const inkSolid = inkOnSolid(color);
  const inkHollow = inkOnHollow(color);
  return (
    <span
      data-dir={direction}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-[20px] border-2 font-bold [overflow-wrap:anywhere]",
        small
          ? "px-[7px] py-0 text-[10px] leading-[1.4]"
          : "px-[11px] py-0.5 text-[11px] leading-[1.35]",
        direction === "tour" ? "border-dashed" : "border-solid",
      )}
      style={{
        borderColor: color,
        background: solid ? color : "#ffffff",
        color: solid ? inkSolid : inkHollow,
      }}
    >
      {direction === "roundtrip" ? (
        <span
          aria-hidden
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px]"
          style={{ background: color, color: inkSolid }}
        >
          ⇄
        </span>
      ) : (
        <span aria-hidden className="shrink-0 font-extrabold">
          {DIRECTION_ARROW[direction]}
        </span>
      )}
      {children}
    </span>
  );
}

function LegendTags({
  color,
  directions,
}: {
  color: string;
  directions: ShuttleProductDirection[];
}) {
  return (
    <>
      {directions.map((d) => (
        <span key={d} title={DIRECTION_LABEL[d]}>
          <Chip direction={d} color={color} small>
            {DIRECTION_TAG[d]}
          </Chip>
        </span>
      ))}
    </>
  );
}

/** 一个 Group 标题后面显示哪些方向标签：out / in 一定有，round / no dir 只在这个 Group 里有时才有。 */
function directionsIn(products: ShuttleProduct[]): ShuttleProductDirection[] {
  const has = new Set(products.map((p) => p.direction));
  return (["outbound", "inbound", "roundtrip", "tour"] as const).filter(
    (d) => d === "outbound" || d === "inbound" || has.has(d),
  );
}

/**
 * Content Studio → Shuttle（后端 G128 重设计，接口草案、没上线；Annie 2026-10-23 看过 preview 说「动手」）：
 * 模板按产品存，一个 Group 一排药丸；颜色 = Group（读 Products 的 `manifest_color`），实心 = inbound，空心 = outbound。
 * 先排完 out 再排 in，最后 round / 没设方向；Group 可折叠，默认只展开选中产品所在的那个。没有 Preview。
 * 2026-10-26 Annie 定（preview 第 5 版「shuttle动手」）：短信 / 邮件正文加 Insert 变量；主题系统统一出（只读说明）；不做 guest page（那格不显示）。
 * Clone（从另一个产品复制四段文案）后端还没决定做，所以这里没有这个入口，也不发请求。
 */
export function ShuttleProductsPanel({
  groups,
  colors,
  studio,
}: {
  groups: ShuttleProductGroup[];
  /** manifest_id → Products 里设的团颜色（没配的不在里面）。 */
  colors: Record<number, string | null | undefined>;
  studio: Studio;
}) {
  const all = useMemo(() => groups.flatMap((g) => g.products), [groups]);
  const [sel, setSel] = useState<string | null>(
    () =>
      all.find((p) => !p.complete)?.product_code ??
      all[0]?.product_code ??
      null,
  );
  const groupKey = (g: ShuttleProductGroup) => String(g.manifest_id ?? "none");
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const first = groups.find((g) =>
      g.products.some((p) => p.product_code === sel),
    );
    return first ? { [groupKey(first)]: true } : {};
  });
  const [q, setQ] = useState("");
  const [onlyUnfilled, setOnlyUnfilled] = useState(false);

  const selected = all.find((p) => p.product_code === sel) ?? null;

  // 服务端刚种下的字段（第一次打开页面时 studio 还没有）：用接口给的值当初始值，保存后 studio 自己会记下。
  const initial = useMemo(
    () =>
      Object.fromEntries(
        all.flatMap((p) => p.fields.map((f) => [f.key, f.value])),
      ),
    [all],
  );
  const view: Studio = useMemo(
    () => ({
      ...studio,
      draft: (k) =>
        k in studio.saved
          ? studio.draft(k)
          : studio.draft(k) || (initial[k] ?? ""),
      savedValue: (k) =>
        k in studio.saved ? studio.savedValue(k) : (initial[k] ?? ""),
    }),
    [studio, initial],
  );

  // 填没填完以 studio 里的最新值为准（保存后立刻更新橙点和计数）。
  const filled = (p: ShuttleProduct) => {
    const fields = p.fields.filter((f) => isEditable(f.key));
    return (
      fields.length > 0 &&
      fields.every((f) => view.savedValue(f.key).trim() !== "")
    );
  };

  const query = q.trim().toLowerCase();
  const unfilledCount = all.filter((p) => !filled(p)).length;

  function groupColor(g: ShuttleProductGroup): string {
    return normalizeGroupColor(
      g.color ?? (g.manifest_id != null ? colors[g.manifest_id] : null),
    );
  }

  return (
    <div className="@container">
      <Legend groups={groups} groupColor={groupColor} />
      <div className={LABEL_CLASS}>Shuttle products</div>
      <p className="mb-3 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65">
        Each shuttle product has its own text, like upper / lower / x in Tour
        Confirmation. Colour = the tour (Group). Solid = inbound, hollow =
        outbound. Click a group row to fold or unfold it. Pick a product and its
        text cards stay in view beside the list.
      </p>

      <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          type="search"
          aria-label="Search products"
          placeholder="Search by product name or code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[200px] flex-1 rounded-[6px] border border-[#e5e7eb] bg-paper px-2 py-1.5 text-[12px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
        />
        <label className="flex items-center gap-1.5 text-[11.5px] whitespace-nowrap text-[#1a1a1a] night:text-white/75">
          <input
            type="checkbox"
            checked={onlyUnfilled}
            onChange={(e) => setOnlyUnfilled(e.target.checked)}
          />
          Only unfilled ({unfilledCount})
        </label>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => setOpen({})}
        >
          Collapse all
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() =>
            setOpen(Object.fromEntries(groups.map((g) => [groupKey(g), true])))
          }
        >
          Expand all
        </button>
        <span className="flex items-center gap-1 text-[11px] text-[#6B5E57] night:text-white/55">
          <span
            className="inline-block size-[7px] rounded-full bg-[#d98a00]"
            aria-hidden
          />
          text not filled
        </span>
      </div>

      <div className="grid gap-3.5 @[600px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @[600px]:items-start">
        <div className="max-h-[min(46vh,380px)] min-w-0 overflow-y-auto rounded-[10px] border border-black/10 bg-paper @[600px]:max-h-[calc(100vh-230px)] @[600px]:min-h-[220px] night:border-white/10 night:bg-white/[.03]">
          {(() => {
            let any = false;
            const rows = groups.map((g) => {
              const shown = g.products.filter((p) => {
                if (onlyUnfilled && filled(p)) return false;
                if (!query) return true;
                return (
                  p.product_name.toLowerCase().includes(query) ||
                  p.product_code.toLowerCase().includes(query)
                );
              });
              if (!shown.length) return null;
              any = true;
              const key = groupKey(g);
              const isOpen = query || onlyUnfilled ? true : !!open[key];
              const unfilled = g.products.filter((p) => !filled(p)).length;
              const color = groupColor(g);
              return (
                <div
                  key={key}
                  className="border-b border-black/10 last:border-b-0 night:border-white/10"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`${g.group_display_name}: ${g.products.length} products, ${unfilled} unfilled. ${isOpen ? "Collapse" : "Expand"}`}
                    onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                    className="flex w-full cursor-pointer flex-wrap items-center gap-2 border-0 bg-[#f6f4f0] px-2.5 py-2 text-left text-[12px] font-semibold text-[#1a1a1a] hover:bg-[#ece8e1] night:bg-white/[.06] night:text-white/90 night:hover:bg-white/10"
                  >
                    <span aria-hidden className="w-3.5 shrink-0 text-[13px]">
                      {isOpen ? "▾" : "▸"}
                    </span>
                    <span className="text-[13px]">{g.group_display_name}</span>
                    <LegendTags
                      color={color}
                      directions={directionsIn(g.products)}
                    />
                    <span className="ml-auto text-right text-[11px] font-normal text-[#6b5e57] night:text-white/55">
                      {g.products.length} product
                      {g.products.length === 1 ? "" : "s"}
                      {unfilled ? ` · ${unfilled} unfilled` : " · all filled"}
                    </span>
                  </button>
                  {isOpen ? (
                    <div
                      role="group"
                      aria-label={`${g.group_display_name} products`}
                      className="flex flex-wrap gap-[7px] px-2.5 pt-2 pb-2.5"
                    >
                      {orderShuttleProducts(shown).map((p) => (
                        <button
                          key={p.product_code}
                          type="button"
                          aria-pressed={sel === p.product_code}
                          title={`${DIRECTION_LABEL[p.direction]} · ${p.product_name} (${p.product_code})`}
                          aria-label={`${DIRECTION_LABEL[p.direction]}: ${shuttlePillText(p)}`}
                          onClick={() => {
                            setSel(p.product_code);
                            setOpen((o) => ({ ...o, [key]: true }));
                            studio.setActive(null);
                          }}
                          className={cn(
                            "max-w-full cursor-pointer rounded-[20px] border-0 bg-transparent p-0 text-left hover:brightness-95",
                            sel === p.product_code &&
                              "outline-2 outline-offset-2 outline-[#1a1a1a] night:outline-white",
                          )}
                        >
                          <Chip direction={p.direction} color={color}>
                            {filled(p) ? null : (
                              <span
                                aria-hidden
                                title="Some text is empty"
                                className="inline-block size-[7px] shrink-0 rounded-full bg-[#d98a00] shadow-[0_0_0_1.5px_#fff]"
                              />
                            )}
                            {shuttlePillText(p)}
                          </Chip>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            });
            return any ? (
              rows
            ) : (
              <p className="px-3 py-4 text-[12px] text-[#6b5e57] night:text-white/55">
                No product matches.
              </p>
            );
          })()}
        </div>

        <div className="min-w-0 @[600px]:sticky @[600px]:top-2 @[600px]:max-h-[calc(100vh-16px)] @[600px]:overflow-y-auto">
          {selected ? (
            <ProductDetail product={selected} studio={view} />
          ) : (
            <p className="rounded-[8px] bg-[#f6f4f0] px-3 py-2.5 text-[12px] text-[#1a1a1a] night:bg-white/[.06] night:text-white/70">
              Pick a product on the left.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({
  groups,
  groupColor,
}: {
  groups: ShuttleProductGroup[];
  groupColor: (g: ShuttleProductGroup) => string;
}) {
  return (
    <div
      aria-label="Group colours"
      className="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-[10px] border border-black/10 bg-[#fbfaf8] px-2.5 py-2 text-[11px] text-[#4a4741] night:border-white/10 night:bg-white/[.03] night:text-white/70"
    >
      {groups.map((g) => (
        <span
          key={g.manifest_id ?? "none"}
          className="inline-flex items-center gap-[5px]"
        >
          <b className="font-semibold">{g.group_display_name}</b>
          <LegendTags
            color={groupColor(g)}
            directions={["inbound", "outbound"]}
          />
        </span>
      ))}
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[#6b5e57] night:text-white/55">
        <span>solid ← = in (inbound)</span>
        <span>hollow → = out (outbound)</span>
        <span>hollow + ⇄ badge = round</span>
        <span>dashed ? = no direction set</span>
      </span>
    </div>
  );
}

function ProductDetail({
  product,
  studio,
}: {
  product: ShuttleProduct;
  studio: Studio;
}) {
  const info = parseShuttleName(product.product_name);
  const line = info.ok ? `${info.from} ⇄ ${info.to}` : info.title;
  const editable = product.fields.filter((f) => isEditable(f.key));
  const empties = editable.filter(
    (f) => studio.savedValue(f.key).trim() === "",
  ).length;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="m-0 text-[14px] font-semibold [overflow-wrap:anywhere] text-[#1a1a1a] night:text-white/90">
            {product.product_name}
          </h3>
          <div className="font-mono text-[10.5px] [overflow-wrap:anywhere] text-[#8a847c] night:text-white/40">
            {product.product_code} · {line} ·{" "}
            {DIRECTION_LABEL[product.direction].toLowerCase()}
            {product.is_active ? "" : " · inactive"}
          </div>
        </div>
        <div className="text-[11px] text-[#6b5e57] night:text-white/55">
          {empties ? (
            <span className="font-semibold text-[#b36b00]">
              {empties} of {editable.length} empty
            </span>
          ) : (
            <span className="font-semibold text-[#3b6d11] night:text-emerald-300">
              All {editable.length} filled
            </span>
          )}
        </div>
      </div>
      {product.fields.map((f) => (
        <ShuttleFieldCard
          key={f.key}
          fieldKey={f.key}
          label={f.label}
          rows={f.rows}
          studio={studio}
        />
      ))}
    </div>
  );
}
