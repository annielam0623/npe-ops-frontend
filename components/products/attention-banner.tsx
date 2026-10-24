"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeError } from "@/lib/api-errors";
import { fetchForecastSettings } from "@/lib/forecast-api";
import { cn } from "@/lib/utils";
import type {
  ForecastUnmatchedSetting,
  MissingProduct,
  Product,
  ProductGroup,
} from "@/types";

import { unmatchedSettingKey } from "./forecast-setup";

type Pending =
  | { kind: "product"; product: Product; label: string }
  | { kind: "missing"; item: MissingProduct; label: string };

/**
 * Products 页顶部的「需要处理」提醒区（Annie 2026-10-23：「我想要干脆把所有有问题的都集中在这里，
 * 然后点击跳过去解决」）。合并四类分散在页面各处的信号，不重做它们各自的编辑界面，点进去只是跳到
 * 并高亮原来那一行：
 *  ① Group 没填（大表格「No group」分组）② Category 没填（原来搜索框下面的黄条）——按产品去重合并，
 *  同一个产品两样都缺时药丸上标两个小标签；③ 订单孤儿代码（MissingCard 那票）；
 *  ④ Bus Manifest setup → 某个团的 Forecast 子页签里「对不上的保存设置」（脏数据，没有「留着不管」
 *  这个选项，只能删，所以没有 Leave as is）。
 * ①②③支持「Leave as is」：确认后不再提醒。持久化靠 Product.attention_dismissed（后端没上线这一列时，
 * PUT/POST 多带的这个键会被忽略，Leave as is 在本次打开期间仍然有效，只是刷新后会回来——不报错、不崩页面）。
 */
export function AttentionBanner({
  products,
  groups,
  missing,
  onDismissProduct,
  onClaimMissing,
  onJumpToProduct,
  onJumpToMissing,
  onJumpToForecast,
}: {
  products: Product[];
  groups: ProductGroup[];
  missing: MissingProduct[];
  /** 整体覆盖式 PUT，顺带 attention_dismissed: true；失败抛出 Error.message 给人看。 */
  onDismissProduct: (p: Product) => Promise<void>;
  /** 用 Rezdy 名字建档（不选组/分类）+ attention_dismissed: true；失败抛出 Error.message 给人看。 */
  onClaimMissing: (m: MissingProduct) => Promise<void>;
  onJumpToProduct: (id: number) => void;
  onJumpToMissing: (code: string) => void;
  onJumpToForecast: (manifestId: number, itemKey: string) => void;
}) {
  const [open, setOpen] = useState(true);
  // 认领孤儿代码不会让它从 missing 清单里消失（Annie 2026-10-01 定：本次打开期间不重画），
  // 这里单独记一下本次打开期间"已经 Leave as is 过"的，让提醒区里不再列它。
  const [dismissedMissing, setDismissedMissing] = useState<Set<string>>(
    new Set(),
  );
  const [unmatched, setUnmatched] = useState<ForecastUnmatchedSetting[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchForecastSettings(controller.signal)
      .then((d) => setUnmatched(d.unmatched))
      .catch(() => {
        // 拉不到也不挡其余三类；④ 本来就是补充的一类，没有就当没有。
      });
    return () => controller.abort();
  }, []);

  const attrIssues = products.filter(
    (p) =>
      p.is_active &&
      !p.attention_dismissed &&
      (p.manifest_id === null || !p.booking_type),
  );
  const missingLeft = missing.filter(
    (m) => !dismissedMissing.has(m.product_code),
  );
  const total = attrIssues.length + missingLeft.length + unmatched.length;
  if (total === 0) {
    return null;
  }

  const groupLabel = (manifestId: number) =>
    groups.find((g) => g.id === manifestId)?.display_name ??
    `Tour #${manifestId}`;

  async function handleConfirm(): Promise<ActionResult> {
    if (!pending) {
      return { status: "ok" };
    }
    try {
      if (pending.kind === "product") {
        await onDismissProduct(pending.product);
      } else {
        await onClaimMissing(pending.item);
        setDismissedMissing((s) => new Set(s).add(pending.item.product_code));
      }
      setPending(null);
      return { status: "ok" };
    } catch (error) {
      return { status: "error", message: describeError(error) };
    }
  }

  return (
    <section
      data-attention-banner
      className="mb-5 overflow-clip rounded-[12px] border-[0.5px] border-[#fed7aa] bg-paper night:border-amber-400/30 night:bg-white/[.04]"
    >
      <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-black/[.08] bg-[#fff4e5] px-4 py-3 night:border-white/10 night:bg-amber-400/10">
        <h2 className="text-[13px] font-semibold text-[#9a3412] night:text-amber-200">
          {total} {total === 1 ? "item needs" : "items need"} attention
        </h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="cursor-pointer rounded-[6px] px-2 py-1 text-[11px] font-semibold text-[#7c4a1e] hover:bg-black/[.05] night:text-amber-200 night:hover:bg-white/10"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open ? (
        <div className="flex flex-col">
          {attrIssues.length ? (
            <Row
              section="attrs"
              text={
                <>
                  <b className="text-[#9a3412] night:text-amber-200">
                    {attrIssues.length}
                  </b>{" "}
                  {attrIssues.length === 1 ? "product is" : "products are"}{" "}
                  missing their <b>Group</b> and/or <b>Category</b>. Until
                  both are set, this table and its reports fall back to
                  whatever was already stored on the booking.
                </>
              }
              jumpLabel="Jump to them ↓"
              onJump={() => onJumpToProduct(attrIssues[0].id)}
            >
              {attrIssues.map((p) => {
                const tags = [
                  p.manifest_id === null ? "no group" : null,
                  !p.booking_type ? "no category" : null,
                ].filter((t): t is string => t !== null);
                return (
                  <Chip
                    key={p.id}
                    code={p.product_code}
                    name={p.product_name}
                    tags={tags}
                    onJump={() => onJumpToProduct(p.id)}
                    onDismiss={() =>
                      setPending({
                        kind: "product",
                        product: p,
                        label: `${p.product_code} — ${p.product_name}`,
                      })
                    }
                  />
                );
              })}
            </Row>
          ) : null}

          {missingLeft.length ? (
            <Row
              section="missing"
              text={
                <>
                  <b className="text-[#9a3412] night:text-amber-200">
                    {missingLeft.length}
                  </b>{" "}
                  product code{missingLeft.length === 1 ? "" : "s"} appeared
                  on orders but{" "}
                  {missingLeft.length === 1 ? "is" : "are"} not in this list
                  at all yet — their orders fall back to whatever category
                  was stored on the booking itself.
                </>
              }
              jumpLabel="Review & add ↓"
              onJump={() => onJumpToMissing(missingLeft[0].product_code)}
            >
              {missingLeft.map((m) => (
                <Chip
                  key={m.product_code}
                  code={m.product_code}
                  name={m.product_name}
                  onJump={() => onJumpToMissing(m.product_code)}
                  onDismiss={() =>
                    setPending({
                      kind: "missing",
                      item: m,
                      label: `${m.product_code} — ${m.product_name}`,
                    })
                  }
                />
              ))}
            </Row>
          ) : null}

          {unmatched.length ? (
            <Row
              section="forecast"
              text={
                <>
                  <span aria-hidden className="mr-[2px] font-bold">
                    ⚠
                  </span>{" "}
                  <b>{unmatched.length}</b> saved Forecast setting
                  {unmatched.length === 1 ? "" : "s"} no longer match
                  {unmatched.length === 1 ? "es" : ""} a section (renamed or
                  removed). These are leftover data, not a classification
                  choice — they should be deleted, not left as is.
                </>
              }
              jumpLabel="Open & review ↓"
              onJump={() =>
                onJumpToForecast(
                  unmatched[0].manifest_id,
                  unmatchedSettingKey(unmatched[0]),
                )
              }
            >
              {unmatched.map((u) => (
                <Chip
                  key={unmatchedSettingKey(u)}
                  forecast
                  code={u.label}
                  name={groupLabel(u.manifest_id)}
                  onJump={() =>
                    onJumpToForecast(u.manifest_id, unmatchedSettingKey(u))
                  }
                />
              ))}
            </Row>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <ConfirmDialog
          title="Leave this as is?"
          confirmLabel="Leave as is"
          busyLabel="Saving…"
          danger
          onConfirm={handleConfirm}
          onClose={() => setPending(null)}
        >
          <p>
            Stop reminding about {pending.label}? It will not appear in this
            list again, even after you reload the page.
          </p>
          <p className="text-[12px] text-[#1a1a1a] night:text-white/50">
            There is no undo screen yet — if you change your mind later, you
            would need to ask engineering to clear it.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function Row({
  section,
  text,
  jumpLabel,
  onJump,
  children,
}: {
  /** 区分三类，给样式分支和 headless 检查用（同一个代码可能同时出现在不同类里，比如认领过的孤儿代码）。 */
  section: "attrs" | "missing" | "forecast";
  text: ReactNode;
  jumpLabel: string;
  onJump: () => void;
  children: ReactNode;
}) {
  const forecast = section === "forecast";
  return (
    <>
      <div
        data-attn-row={section}
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 border-b-[0.5px] border-black/[.06] px-4 py-2.5 text-[12.5px] leading-[1.55] night:border-white/10",
          forecast
            ? "border-l-[4px] border-l-[#f0d080] bg-[#fff8e1] font-semibold text-[#7c4a00] night:bg-amber-400/15 night:text-amber-200"
            : "bg-[#fffaf3] text-[#7c4a1e] night:bg-amber-400/10 night:text-amber-200",
        )}
      >
        <p className="m-0 max-w-[56ch]">{text}</p>
        <button
          type="button"
          onClick={onJump}
          className={cn(
            "shrink-0 cursor-pointer rounded-[6px] border-[0.5px] px-3 py-1 text-[11px] font-semibold whitespace-nowrap text-white",
            forecast
              ? "border-[#a66a00] bg-[#a66a00] hover:opacity-90"
              : "border-[#9a3412] bg-[#9a3412] hover:opacity-90",
          )}
        >
          {jumpLabel}
        </button>
      </div>
      <div
        data-attn-chips={section}
        className="flex flex-wrap gap-[6px] border-b-[0.5px] border-black/[.06] bg-[#fffaf3] px-4 py-2.5 night:border-white/10 night:bg-amber-400/10 last:border-b-0"
      >
        {children}
      </div>
    </>
  );
}

function Chip({
  code,
  name,
  tags,
  forecast,
  onJump,
  onDismiss,
}: {
  code: string;
  name: string;
  tags?: string[];
  forecast?: boolean;
  onJump: () => void;
  onDismiss?: () => void;
}) {
  return (
    <span
      data-chip={code}
      className={cn(
        "inline-flex items-center gap-[5px] rounded-full border-[0.5px] bg-paper px-[8px] py-[4px] text-[11.5px] night:bg-white/[.04]",
        forecast
          ? "border-[#f0d080] text-[#7c4a00] night:border-amber-400/30 night:text-amber-200"
          : "border-[rgba(154,52,18,0.28)] text-[#7c4a1e] night:border-amber-400/25 night:text-amber-200",
      )}
    >
      <button
        type="button"
        data-jump={code}
        onClick={onJump}
        className="flex cursor-pointer items-center gap-[5px]"
      >
        <span className="font-mono font-semibold text-[#9a3412] night:text-amber-200">
          {code}
        </span>
        <span>{name}</span>
        {tags?.map((t) => (
          <span
            key={t}
            className="rounded-full bg-[rgba(154,52,18,0.1)] px-[5px] py-[1px] text-[10px] font-semibold text-[#9a3412] night:bg-amber-400/15 night:text-amber-200"
          >
            {t}
          </span>
        ))}
        <span aria-hidden>↓</span>
      </button>
      {onDismiss ? (
        <button
          type="button"
          data-dismiss={code}
          onClick={onDismiss}
          aria-label={`Leave ${code} as is — stop reminding`}
          title="Leave as is — stop reminding"
          className="cursor-pointer text-[13px] leading-none text-[rgba(154,52,18,0.55)] hover:text-[#9a3412]"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
