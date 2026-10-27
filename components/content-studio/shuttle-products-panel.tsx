"use client";

import { useState } from "react";

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
  ShuttleProductsData,
  ShuttleSharedField,
} from "@/lib/shuttle-products-api";
import { cn } from "@/lib/utils";

import {
  SHUTTLE_LABEL_KEYS,
  SHUTTLE_LABEL_NAMES,
  SHUTTLE_SHARED_KEYS,
  SHUTTLE_SUBJECT_NOTE,
  SHUTTLE_VARS,
} from "./fields";
import { InputsCard, LinesCard, type Studio, TextFieldCard } from "./studio-cards";

/**
 * Content Studio → Shuttle 两层（Annie 2026-10-27「动手」，preview 第 4 版
 * https://claude.ai/artifact/UDTdCZUSMuxkcgUWh7g7eB ；后端 8a `task/g189-shuttle-shared`）：
 * - Email / SMS / Guest Page 三个标签 = 公共部分，所有 shuttle 线共用一份（红框 Global 卡片，同 Tickets）；
 *   Guest Page 标签另有「Route section labels」4 格（客人看到的标题 / 链接文字，空着用默认，Q4）；
 * - Routes 标签 = 每条线的追加（Route-Specific Information 不限行数 + 3 个链接），全空也照发。
 * 只有公共三格没填齐才拦发送（页面顶部红框写哪几格空着）。旧的单产品四栏不再显示，数据留在库里。
 */
export const SHUTTLE_TABS = ["Email", "SMS", "Guest Page", "Routes"] as const;
export type ShuttleTab = (typeof SHUTTLE_TABS)[number];

const GROUP_TITLE_CLASS =
  "mb-2.5 text-[10px] font-bold tracking-[0.07em] text-[#9B8F88] uppercase night:text-white/50";
const HINT_CLASS =
  "mb-3 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65";
const BUTTON_CLASS =
  "cursor-pointer rounded-[6px] border border-[#1a1a1a] bg-paper px-2.5 py-1 text-[11px] font-medium text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-white night:border-white/40 night:bg-white/[.04] night:text-white/90";

/** 公共三格（按 SMS / Email / Guest Page 认）；接口没给某一格时为 undefined。 */
export function sharedField(
  data: ShuttleProductsData,
  which: keyof typeof SHUTTLE_SHARED_KEYS,
): ShuttleSharedField | undefined {
  return data.shared.fields.find((f) => f.key === SHUTTLE_SHARED_KEYS[which]);
}

/** 现在空着的公共格（按 studio 里的已存值算，保存后马上更新），用界面上的标签名。 */
export function sharedMissing(
  data: ShuttleProductsData,
  studio: Studio,
): string[] {
  const names: [keyof typeof SHUTTLE_SHARED_KEYS, string][] = [
    ["email", "Email"],
    ["sms", "SMS"],
    ["guest", "Guest Page"],
  ];
  return names
    .filter(([w]) => {
      const f = sharedField(data, w);
      return f && !studio.savedValue(f.key).trim();
    })
    .map(([, n]) => n);
}

/** 这条线填了几样追加（已存的值）。 */
export function routeFilled(p: ShuttleProduct, studio: Studio): number {
  return p.fields.filter((f) => studio.savedValue(f.key).trim()).length;
}

/** 公共部分没填齐时的红框（在标签栏上面，每个标签都看得到）；填齐了不显示。 */
export function ShuttleHold({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return (
    <div
      role="alert"
      data-shuttle-hold
      className="mb-3.5 rounded-[8px] border-[1.5px] border-[#fca5a5] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#dc2626] night:border-red-500/30 night:bg-red-500/10 night:text-red-300"
    >
      <b>Shuttle confirmations are on hold.</b> Fill the shared{" "}
      <b>{missing.join(", ")}</b> text and Save. Until then, Manifests lists
      shuttle guests under Not sent. Route extras can stay empty.
    </div>
  );
}

export const SHUTTLE_HOW_TO = [
  <>
    The <b>Email</b>, <b>SMS</b> and <b>Guest Page</b> tabs are shared by all
    shuttle routes. A change there goes to every shuttle guest.
  </>,
  "Keep the { } variables such as {name}; add one with the buttons after Insert:. {url} is the confirm link: a guest who opens it is confirmed.",
  <>
    <b>Routes</b> tab: click a route, then fill only what is different for it:
    Route-Specific Information (one item per line, as many lines as you need),
    Google Maps URL, Apple Maps URL, Location photo URL.
  </>,
  "Route extras show in the email and on the guest page, not in the SMS. A box left empty is not shown.",
  <>
    To change the words guests see above the extras and on the links (Route
    information, Google Maps, Apple Maps, Location photo), edit{" "}
    <b>Route section labels</b> on the Guest Page tab. They are shared by all
    routes; leave a box empty to use the default.
  </>,
  "Manifests sends shuttle confirmations only when all three shared texts are filled. If one is empty, the red box at the top says which one. Empty route extras never stop a send.",
];

/** Email subject：只读说明，主题由系统统一出（Annie 2026-10-26 选 B1）。 */
function SubjectNote() {
  return (
    <section
      aria-label="Email subject"
      className="mb-2.5 overflow-hidden rounded-[10px] border border-black/10 bg-paper px-3.5 py-2.5 text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
    >
      <h3 className="text-[12px] leading-[1.4] font-semibold">Email subject</h3>
      <p className="mt-1.5 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65">
        {SHUTTLE_SUBJECT_NOTE}
      </p>
    </section>
  );
}

export function ShuttleSharedTab({
  tab,
  data,
  studio,
}: {
  tab: Exclude<ShuttleTab, "Routes">;
  data: ShuttleProductsData;
  studio: Studio;
}) {
  const routes = data.groups.reduce((n, g) => n + g.products.length, 0);
  const which = tab === "Email" ? "email" : tab === "SMS" ? "sms" : "guest";
  const f = sharedField(data, which);
  // 4 格按 preview 的顺序；接口多给的（以后加的）排在后面。
  const order: string[] = Object.values(SHUTTLE_LABEL_KEYS);
  const labels = [...data.shared.text_fields].sort(
    (a, b) =>
      (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99),
  );
  return (
    <>
      <div className={GROUP_TITLE_CLASS}>
        Global — all {routes} shuttle route{routes === 1 ? "" : "s"}
      </div>
      {tab === "Email" ? <SubjectNote /> : null}
      {f ? (
        <TextFieldCard
          key={f.key}
          field={{
            key: f.key,
            label: f.label,
            rows: f.rows,
            sms: which === "sms",
            // 客人页文字没有 Insert（同 preview）。
            vars:
              which === "guest"
                ? undefined
                : f.vars?.length
                  ? f.vars
                  : SHUTTLE_VARS,
          }}
          studio={studio}
          global
        />
      ) : null}
      {tab === "SMS" ? (
        <p className={HINT_CLASS}>
          Route extras are not added to the SMS. The SMS stays the same for
          every route.
        </p>
      ) : null}
      {tab === "Guest Page" && labels.length ? (
        <>
          <InputsCard
            label="Route section labels"
            hint="The words guests see above each route's extras and on its links, in the email and on the guest page. Shared by all routes. Leave a box empty to use the default shown in grey."
            rows={labels.map((t) => ({
              key: t.key,
              label: SHUTTLE_LABEL_NAMES[t.key] ?? t.label,
              placeholder: t.default,
            }))}
            studio={studio}
            global
          />
          <p className={HINT_CLASS}>
            A label shows only when that route has something filled in for it.
          </p>
        </>
      ) : null}
    </>
  );
}

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

/** 灰色小点 = 这条线有追加（Q3：追加可以全空，所以不用橙色「要处理」的点）。 */
function HasExtrasDot() {
  return (
    <span
      aria-hidden
      data-has-extras
      className="inline-block size-[7px] shrink-0 rounded-full bg-[#9ca3af] shadow-[0_0_0_1.5px_#fff]"
    />
  );
}

/**
 * Routes 标签：一个 Group 一排药丸（颜色 = Group，读 Products 的 `manifest_color`；实心 = inbound，空心 = outbound），
 * Group 可折叠，默认只展开选中那条线所在的 Group；右边是选中那条线的 4 格追加。
 */
export function ShuttleRoutesTab({
  groups,
  colors,
  studio,
  selected,
  onSelect,
}: {
  groups: ShuttleProductGroup[];
  colors: Record<number, string | null | undefined>;
  studio: Studio;
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  const all = groups.flatMap((g) => g.products);
  const sel = all.find((p) => p.product_code === selected) ?? all[0] ?? null;
  const groupKey = (g: ShuttleProductGroup) => String(g.manifest_id ?? "none");
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const first = groups.find((g) =>
      g.products.some((p) => p.product_code === sel?.product_code),
    );
    return first ? { [groupKey(first)]: true } : {};
  });
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  function groupColor(g: ShuttleProductGroup): string {
    return normalizeGroupColor(
      g.color ?? (g.manifest_id != null ? colors[g.manifest_id] : null),
    );
  }

  let any = false;
  const rows = groups.map((g) => {
    const shown = g.products.filter(
      (p) =>
        !query ||
        p.product_name.toLowerCase().includes(query) ||
        p.product_code.toLowerCase().includes(query),
    );
    if (!shown.length) return null;
    any = true;
    const key = groupKey(g);
    const isOpen = query ? true : !!open[key];
    const withExtras = g.products.filter((p) => routeFilled(p, studio)).length;
    const color = groupColor(g);
    return (
      <div
        key={key}
        className="border-b border-black/10 last:border-b-0 night:border-white/10"
      >
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={`${g.group_display_name}: ${g.products.length} routes, ${withExtras} with extras. ${isOpen ? "Collapse" : "Expand"}`}
          onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
          className="flex w-full cursor-pointer flex-wrap items-center gap-2 border-0 bg-[#f6f4f0] px-2.5 py-2 text-left text-[12px] font-semibold text-[#1a1a1a] hover:bg-[#ece8e1] night:bg-white/[.06] night:text-white/90 night:hover:bg-white/10"
        >
          <span aria-hidden className="w-3.5 shrink-0 text-[13px]">
            {isOpen ? "▾" : "▸"}
          </span>
          <span className="text-[13px]">{g.group_display_name}</span>
          <LegendTags color={color} directions={directionsIn(g.products)} />
          <span className="ml-auto text-right text-[11px] font-normal text-[#6b5e57] night:text-white/55">
            {g.products.length} route{g.products.length === 1 ? "" : "s"} ·{" "}
            {withExtras} with extras
          </span>
        </button>
        {isOpen ? (
          <div
            role="group"
            aria-label={`${g.group_display_name} routes`}
            className="flex flex-wrap gap-[7px] px-2.5 pt-2 pb-2.5"
          >
            {orderShuttleProducts(shown).map((p) => (
              <button
                key={p.product_code}
                type="button"
                aria-pressed={sel?.product_code === p.product_code}
                title={`${DIRECTION_LABEL[p.direction]} · ${p.product_name} (${p.product_code})`}
                aria-label={`${DIRECTION_LABEL[p.direction]}: ${shuttlePillText(p)}`}
                onClick={() => {
                  onSelect(p.product_code);
                  setOpen((o) => ({ ...o, [key]: true }));
                  studio.setActive(null);
                }}
                className={cn(
                  "max-w-full cursor-pointer rounded-[20px] border-0 bg-transparent p-0 text-left hover:brightness-95",
                  sel?.product_code === p.product_code &&
                    "outline-2 outline-offset-2 outline-[#1a1a1a] night:outline-white",
                )}
              >
                <Chip direction={p.direction} color={color}>
                  {routeFilled(p, studio) ? <HasExtrasDot /> : null}
                  {shuttlePillText(p)}
                </Chip>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  });

  return (
    <div className="@container">
      <p className={HINT_CLASS}>
        Pick a route and fill only what is different for it. Every box can stay
        empty: an empty box is not shown to guests and never stops a send.
        Colour = the tour (Group). Solid = inbound, hollow = outbound.
      </p>
      <Legend groups={groups} groupColor={groupColor} />

      <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          type="search"
          aria-label="Search routes"
          placeholder="Search by product name or code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[200px] flex-1 rounded-[6px] border border-[#e5e7eb] bg-paper px-2 py-1.5 text-[12px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
        />
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
      </div>

      <div className="grid gap-3.5 @[600px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @[600px]:items-start">
        <div className="max-h-[min(46vh,380px)] min-w-0 overflow-y-auto rounded-[10px] border border-black/10 bg-paper @[600px]:max-h-[calc(100vh-230px)] @[600px]:min-h-[220px] night:border-white/10 night:bg-white/[.03]">
          {any ? (
            rows
          ) : (
            <p className="px-3 py-4 text-[12px] text-[#6b5e57] night:text-white/55">
              No route matches.
            </p>
          )}
        </div>

        <div className="min-w-0 @[600px]:sticky @[600px]:top-2 @[600px]:max-h-[calc(100vh-16px)] @[600px]:overflow-y-auto">
          {sel ? (
            <RouteDetail key={sel.product_code} product={sel} studio={studio} />
          ) : (
            <p className="rounded-[8px] bg-[#f6f4f0] px-3 py-2.5 text-[12px] text-[#1a1a1a] night:bg-white/[.06] night:text-white/70">
              No shuttle routes yet.
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
        <span className="inline-flex items-center gap-1">
          <HasExtrasDot /> = has route extras
        </span>
      </span>
    </div>
  );
}

const ROUTE_INFO_HINT =
  "One item per line. Shown in the email and on the guest page under the section title (Guest Page tab → Route section labels). Not in the SMS.";

function RouteDetail({
  product,
  studio,
}: {
  product: ShuttleProduct;
  studio: Studio;
}) {
  const info = parseShuttleName(product.product_name);
  const line = info.ok ? `${info.from} ⇄ ${info.to}` : info.title;
  const filled = routeFilled(product, studio);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2.5 min-w-0">
        <h3 className="m-0 text-[14px] font-semibold [overflow-wrap:anywhere] text-[#1a1a1a] night:text-white/90">
          {product.product_name}
        </h3>
        <div className="font-mono text-[10.5px] [overflow-wrap:anywhere] text-[#8a847c] night:text-white/40">
          {product.product_code} · {line} ·{" "}
          {DIRECTION_LABEL[product.direction].toLowerCase()}
          {product.is_active ? "" : " · inactive"}
        </div>
        <p
          data-route-filled
          className="mt-1 text-[11px] text-[#6b5e57] night:text-white/55"
        >
          Route extras: {filled} of {product.fields.length} filled. Empty ones
          are not shown.
        </p>
        {product.error ? (
          <p
            role="alert"
            className="mt-1 text-[11px] font-semibold text-[#dc2626] night:text-red-300"
          >
            {product.error}
          </p>
        ) : null}
      </div>
      {product.fields.map((f) =>
        f.type === "dynamic_lines" ? (
          <LinesCard
            key={f.key}
            field={{
              key: f.key,
              label: f.label,
              type: "dynamic_lines",
              // Annie 2026-10-27：「Route-Specific Information 不设上限吧」。
              max: Infinity,
              hint: ROUTE_INFO_HINT,
            }}
            studio={studio}
          />
        ) : (
          <TextFieldCard
            key={f.key}
            field={{
              key: f.key,
              label: f.label,
              rows: f.rows || 1,
              url: f.type === "url",
            }}
            studio={studio}
          />
        ),
      )}
    </div>
  );
}
