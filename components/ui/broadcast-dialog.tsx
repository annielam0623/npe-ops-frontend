"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  type BroadcastCheckResult,
  type BroadcastSendResult,
  type BroadcastTemplate,
  checkBroadcast,
  fetchBroadcastTemplates,
  sendBroadcast,
} from "@/lib/broadcast-api";
import { LA_TIME_ZONE } from "@/lib/la-date";
import { SMS_MAX_SEGMENTS, smsSegments, tourDateText } from "@/lib/sms-limit";
import { cn } from "@/lib/utils";

import { ModalShell } from "@/components/tracking-ui/modal-shell";

/**
 * 群发候选人（一张单一行）。
 * 门票页（audience="status"）：group 为 null 的（改期 / 取消等）任何群发都不发。
 * Tour 页（audience="mtlv"）：不看 group，人群是 General（所选团的全部客人）/ MTLV（mtlv 为 true 的），同旧页面。
 */
export interface BroadcastCandidate {
  key: string;
  orderNumber: string;
  name: string;
  firstName: string;
  phone: string;
  email: string;
  tourType: string;
  group: "pending" | "confirmed" | null;
  /** Tour 页：MTLV 资格。 */
  mtlv?: boolean;
  /** Tour 页「By pickup location」用：原始接站点文本、对上的 Settings 站点名（"" = 对不上）、接客时刻。 */
  pickupLocation?: string;
  pickupHotelName?: string;
  pickupTime?: string;
}

/** 没填接站点的客人归进这一组，不丢（同旧页面 `_pickupKeyFor()` 的固定文案）。 */
const NO_PICKUP = "(no pickup location on file)";

/**
 * 一位客人在 By pickup location 里归哪一组：对上站点就是站点名；对不上就是原始文本；空的归 NO_PICKUP。
 * 分组和筛收件人必须用同一条判据（同旧页面注释），所以只有这一个函数。
 */
function pickupKey(c: BroadcastCandidate): string {
  return c.pickupHotelName || (c.pickupLocation ?? "").trim() || NO_PICKUP;
}

interface PickupGroup {
  name: string;
  count: number;
  /** 这一组里出现的团（显示名）。 */
  tours: string[];
  /** 合并进来的其他写法（对上站点的组才有）。 */
  raws: string[];
}

/** 对上站点的一组、对不上的一组，各按名字排序（旧 `_pickupGroups()` + `_renderPickupChecks()`）。 */
function pickupGroups(
  candidates: BroadcastCandidate[],
  tourLabel: (value: string) => string,
): { matched: PickupGroup[]; unknown: PickupGroup[] } {
  const matched = new Map<string, BroadcastCandidate[]>();
  const unknown = new Map<string, BroadcastCandidate[]>();
  for (const c of candidates) {
    const into = c.pickupHotelName ? matched : unknown;
    const key = pickupKey(c);
    into.set(key, [...(into.get(key) ?? []), c]);
  }
  const build = (m: Map<string, BroadcastCandidate[]>, withRaws: boolean) =>
    [...m.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const rows = m.get(name) ?? [];
        return {
          name,
          count: rows.length,
          tours: [
            ...new Set(rows.map((r) => tourLabel(r.tourType)).filter(Boolean)),
          ],
          raws: withRaws
            ? [
                ...new Set(
                  rows
                    .map((r) => (r.pickupLocation ?? "").trim())
                    .filter(
                      (raw) => raw && raw.toLowerCase() !== name.toLowerCase(),
                    ),
                ),
              ]
            : [],
        };
      });
  return { matched: build(matched, true), unknown: build(unknown, false) };
}

type Group = "all" | "pending" | "sent" | "general" | "mtlv";
type Mode = "tour" | "pickup";
type Channel = "both" | "sms" | "email";

/**
 * 模板接口挂了时的兜底（同旧页面那份内置副本）。用的时候弹窗里会明说。
 * ⚠️ Content Studio 里是空就是空，不能拿它顶上——只有接口失败才用。
 */
const FALLBACK_TEMPLATES: BroadcastTemplate[] = [
  {
    name: "tour_cancelled",
    label: "Tour cancelled",
    body: "Hi {first_name}, your National Park Express tour on {tour_date} has been cancelled. Please contact us at 702-948-4190 for assistance.",
  },
  {
    name: "time_changed",
    label: "Pickup time updated",
    body: "Hi {first_name}, your pickup time for your National Park Express tour on {tour_date} has been updated. Please contact us at 702-948-4190 for details.",
  },
  {
    name: "weather_delay",
    label: "Weather delay",
    body: "Hi {first_name}, due to weather conditions your National Park Express tour on {tour_date} may experience delays. We will keep you updated.",
  },
  { name: "custom", label: "Custom message", body: "" },
];

const MTLV_GROUPS: readonly { value: Group; label: string; hint: string }[] = [
  {
    value: "general",
    label: "General",
    hint: "All guests in selected tours",
  },
  { value: "mtlv", label: "MTLV", hint: "MTLV eligible guests only" },
];

const GROUPS: readonly { value: Group; label: string; hint: string }[] = [
  {
    value: "all",
    label: "All",
    hint: "Everyone still on this tour (replied yes + no reply yet)",
  },
  { value: "pending", label: "Pending", hint: "No reply yet" },
  { value: "sent", label: "Confirmed", hint: "Guest replied yes" },
];

const CHANNELS: readonly { value: Channel; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "sms", label: "SMS only" },
  { value: "email", label: "Email only" },
];

/** 群发一条最多几段短信（Annie 2026-10-14：「最多两条信息的量，超过了就建议发 email」）。 */
const BROADCAST_MAX_SMS = SMS_MAX_SEGMENTS;

type Phase =
  | { kind: "edit"; error: string | null }
  /** 问后端谁已经收过这条一模一样的消息（G62）。 */
  | { kind: "checking" }
  | { kind: "confirm"; check: BroadcastCheckResult }
  /** 选了 SMS 但超过短信上限：建议改发 Email，问 staff 愿不愿意（Annie 2026-10-14）。 */
  | { kind: "tooLong" }
  | { kind: "sending"; check: BroadcastCheckResult }
  | { kind: "done"; result: BroadcastSendResult };

const SENT_AT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function sentWhen(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso : SENT_AT.format(t).replace(/\s/g, " ");
}

/**
 * 📣 群发：选产品 → 选人群 → 写消息（可套模板）→ 选渠道 → 核对收件人 → 确认后发送。
 * ⚠️ **真实**发短信 / 邮件给每位勾选的客人。
 */
export function BroadcastDialog({
  theme,
  module,
  templateSet,
  audience = "status",
  byPickup = false,
  tourDate,
  tours: toursProp,
  candidates,
  onClose,
  onSent,
  onUnauthorized,
}: {
  /** 照哪一页的旧弹窗画：门票页深色、Tour 页奶油色（Annie 2026-10-07：和旧版一模一样）。 */
  theme: "tickets" | "tour";
  module: "tickets" | "tour";
  templateSet: "tix" | "tour";
  /** 人群怎么分：status = All / Pending / Confirmed（门票页）；mtlv = General / MTLV（Tour 页）。 */
  audience?: "status" | "mtlv";
  /**
   * Step 1 多一个「By tour / By pickup location」切换（Tour 页，后端 2026-10-09 `a5b3bfd`）：
   * 按接站点选客人，不分团；发出去的 group_filter 是 'pickup'。每次打开都回到 By tour。
   */
  byPickup?: boolean;
  tourDate: string;
  /** 这天出现的产品；label 是屏幕上的短名（也存进群发记录）。 */
  tours: { value: string; label: string }[];
  candidates: BroadcastCandidate[];
  onClose: () => void;
  /** 发完（不论成败多少）：群发记录要重拉。 */
  onSent: () => void;
  onUnauthorized: () => void;
}) {
  const [templates, setTemplates] = useState<BroadcastTemplate[] | null>(null);
  const [signature, setSignature] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);
  const [selectedTours, setSelectedTours] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("tour");
  const [selectedPickups, setSelectedPickups] = useState<string[]>([]);
  const [group, setGroup] = useState<Group>(
    audience === "mtlv" ? "general" : "all",
  );
  const groups = audience === "mtlv" ? MTLV_GROUPS : GROUPS;
  const [templateName, setTemplateName] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<Channel>("both");
  /** 取消勾选的收件人（默认全勾）。 */
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>({ kind: "edit", error: null });
  /** 收过这条消息、勾了 Send anyway 的订单号。 */
  const [anyway, setAnyway] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetchBroadcastTemplates(templateSet)
      .then((set) => {
        if (!cancelled) {
          setTemplates(set.templates);
          setSignature(set.signature);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isStatus(error, 401)) {
          onUnauthorized();
          return;
        }
        setTemplates(FALLBACK_TEMPLATES);
        setUsingFallback(true);
      });
    return () => {
      cancelled = true;
    };
  }, [templateSet, onUnauthorized]);

  // 打开时拍一份候选人快照：外面每分钟自动刷新，不能让 staff 没看过的人混进「Yes, send now」。
  const [snapshot] = useState(candidates);
  // 产品按钮也用打开时那份，和候选人对得上。
  const [tours] = useState(toursProp);

  const tourLabel = (value: string) =>
    tours.find((t) => t.value === value)?.label ?? value;
  const pickups = useMemo(
    () =>
      byPickup
        ? pickupGroups(
            snapshot,
            (v) => tours.find((t) => t.value === v)?.label ?? v,
          )
        : { matched: [], unknown: [] },
    [byPickup, snapshot, tours],
  );
  /** 勾选框的显示顺序（对上的在前、Not found 在后），也是存进群发记录的顺序。 */
  const pickupOrder = [...pickups.matched, ...pickups.unknown].map(
    (g) => g.name,
  );

  // 人群的唯一判据，计数和清单都从这里来。
  // 门票页只有 yes + pending 能收群发；Tour 页是所选团（或所选接站点）的全部客人（同旧页面，不按状态筛）。
  const pool = useMemo(
    () =>
      snapshot.filter(
        (c) =>
          (audience === "mtlv" || c.group !== null) &&
          (mode === "pickup"
            ? selectedPickups.includes(pickupKey(c))
            : selectedTours.includes(c.tourType)),
      ),
    [snapshot, selectedTours, selectedPickups, mode, audience],
  );
  const byGroup: Record<Group, BroadcastCandidate[]> = {
    all: pool,
    pending: pool.filter((c) => c.group === "pending"),
    sent: pool.filter((c) => c.group === "confirmed"),
    general: pool,
    mtlv: pool.filter((c) => c.mtlv),
  };
  const recipients = byGroup[group];
  const picked = recipients.filter((c) => !unticked.has(c.key));
  const wantSms = channel !== "email";
  const wantEmail = channel !== "sms";
  const smsReach = picked.filter((c) => c.phone).length;
  const emailReach = picked.filter((c) => c.email).length;

  const trimmed = body.trim();
  const finalBody = signature ? `${trimmed}\n${signature}` : trimmed;
  // 按最坏情况算短信字数：签名 + 选中收件人里最长的名字 + 展开后的日期。
  const longestFirst = picked.reduce(
    (longest, c) =>
      (c.firstName || "Guest").length > longest.length
        ? c.firstName || "Guest"
        : longest,
    "Guest",
  );
  const smsText = finalBody
    .split("{first_name}")
    .join(longestFirst)
    .split("{tour_date}")
    .join(tourDateText(tourDate));
  // 群发最多两条短信的量（Annie 2026-10-14），超了建议改发 Email。比 Twilio 的 1600 字严，所以只看段数。
  const smsCount = smsSegments(smsText);
  const smsTooLong = wantSms && smsCount > BROADCAST_MAX_SMS;
  const smsCounterText = `${smsText.length.toLocaleString("en-US")} chars, ${smsCount} of ${BROADCAST_MAX_SMS} SMS${
    smsCount > BROADCAST_MAX_SMS
      ? ` - over the ${BROADCAST_MAX_SMS}-SMS limit for broadcasts. Shorten it or send by Email.`
      : ""
  }`;

  function productLabel(): string {
    // By pickup location：存勾选的站点 / 原始写法，不是产品名（同旧页面，Annie 定）。
    if (mode === "pickup") {
      return pickupOrder
        .filter((name) => selectedPickups.includes(name))
        .join(", ")
        .slice(0, 200);
    }
    if (!selectedTours.length) return "";
    if (selectedTours.length === tours.length && tours.length > 1) return "All";
    return tours
      .filter((t) => selectedTours.includes(t.value))
      .map((t) => t.label)
      .join(", ")
      .slice(0, 200);
  }

  function validate(): string | null {
    if (!trimmed) return "Please enter a message.";
    if (mode === "pickup") {
      if (!selectedPickups.length)
        return "Please select at least one pickup location.";
    } else if (!selectedTours.length) {
      return "Please select at least one tour.";
    }
    if (!picked.length) return "No recipients selected.";
    return null;
  }

  /** 确认之前问后端：勾的人里谁这个团期已经收过一模一样的消息（Manifests 发的也算）。 */
  async function check() {
    setPhase({ kind: "checking" });
    try {
      const result = await checkBroadcast({
        tour_date: tourDate,
        message_body: finalBody,
        order_numbers: [...new Set(picked.map((c) => c.orderNumber))],
      });
      setAnyway(new Set());
      setPhase({ kind: "confirm", check: result });
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setPhase({
        kind: "edit",
        error: `Could not check who already got this message: ${describeError(error)}`,
      });
    }
  }

  async function send(checked: BroadcastCheckResult) {
    setPhase({ kind: "sending", check: checked });
    const again = checked.already_sent
      .map((s) => s.order_number)
      .filter((o) => anyway.has(o));
    try {
      const result = await sendBroadcast({
        ...(again.length
          ? { send_anyway: again, preview_at: checked.checked_at }
          : {}),
        module,
        // By pickup location 存 'pickup'（Broadcasting Log 显示绿色 Pickup 标签），不再分 General / MTLV。
        group_filter: mode === "pickup" ? "pickup" : group,
        status_filter: "all",
        tour_date: tourDate,
        product_label: productLabel(),
        template_name:
          templates
            ?.find((t) => t.name === templateName)
            ?.label.slice(0, 200) || null,
        message_body: finalBody,
        recipients: picked.map((c) => ({
          order_number: c.orderNumber,
          customer_name: c.name,
          first_name: c.firstName,
          phone: c.phone,
          email: c.email,
        })),
        send_sms: wantSms,
        send_email: wantEmail,
      });
      setPhase({ kind: "done", result });
      onSent();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      // 409：同一团期别人正在群发，后端什么都没发（G62）。
      if (isStatus(error, 409)) {
        setPhase({
          kind: "edit",
          error: `Nothing was sent: ${describeError(error)}`,
        });
        return;
      }
      // 请求失败时后端有可能已经发出一部分：让 staff 先去核对，别直接再发。
      setPhase({
        kind: "edit",
        error: `Send failed: ${describeError(error)}. Some messages may already have gone out — check the Send Log before sending again.`,
      });
      onSent();
    }
  }

  const titleId = "broadcast-title";
  const busy = phase.kind === "sending" || phase.kind === "checking";
  const checked =
    phase.kind === "confirm" || phase.kind === "sending" ? phase.check : null;
  const already = checked?.already_sent ?? [];
  const alreadySet = new Set(already.map((s) => s.order_number));
  const willGet = picked.filter(
    (c) => !alreadySet.has(c.orderNumber) || anyway.has(c.orderNumber),
  );
  const allAgain =
    already.length > 0 && already.every((s) => anyway.has(s.order_number));
  const nameOf = new Map(picked.map((c) => [c.orderNumber, c.name]));
  const toggleAgain = (orders: string[], on: boolean) =>
    setAnyway((prev) => {
      const next = new Set(prev);
      for (const o of orders)
        if (on) next.add(o);
        else next.delete(o);
      return next;
    });
  const skin = theme === "tickets" ? TICKETS_SKIN : TOUR_SKIN;

  return (
    <ModalShell
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      overlayClassName={skin.overlay}
      panelClassName={skin.panel}
    >
      <div className={cn("flex items-center px-[18px] py-3.5", skin.head)}>
        <h2
          id={titleId}
          className={cn("flex-1 text-[15px] font-bold", skin.headText)}
        >
          📣 Broadcast message
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="cursor-pointer text-[22px] leading-none text-black/40 disabled:opacity-50"
        >
          ×
        </button>
      </div>

      {phase.kind === "done" ? (
        <>
          <div
            className={cn(
              "flex flex-col gap-2 px-[18px] py-4 text-[13px]",
              skin.text,
            )}
          >
            <p className="font-semibold">
              {phase.result.broadcast_id === null
                ? "Nothing was sent: everyone already got this message."
                : "Broadcast sent."}
            </p>
            {phase.result.skipped?.length ? (
              <p data-broadcast-skipped>
                Skipped {phase.result.skipped.length} (already got this
                message):{" "}
                {phase.result.skipped.map((s) => s.order_number).join(", ")}.
              </p>
            ) : null}
            {wantSms ? (
              <p>
                SMS: {phase.result.sms_sent} sent,{" "}
                <span className={phase.result.sms_failed ? skin.failText : ""}>
                  {phase.result.sms_failed} failed
                </span>
              </p>
            ) : null}
            {wantEmail ? (
              <p>
                Email: {phase.result.email_sent} sent,{" "}
                <span
                  className={phase.result.email_failed ? skin.failText : ""}
                >
                  {phase.result.email_failed} failed
                </span>
              </p>
            ) : null}
          </div>
          <div
            className={cn(
              "flex justify-end gap-2 border-t px-[18px] py-3",
              skin.footBorder,
            )}
          >
            <button type="button" onClick={onClose} className={skin.sendBtn}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] py-4">
            <Step
              title={
                byPickup
                  ? "Step 1 — Select recipients"
                  : "Step 1 — Select tours"
              }
              className={skin.step}
            >
              {byPickup ? (
                <div className="mb-2.5 flex gap-3.5">
                  {(
                    [
                      ["tour", "By tour"],
                      ["pickup", "By pickup location"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer items-center gap-[5px] text-[12px]",
                        skin.text,
                      )}
                    >
                      <input
                        type="radio"
                        name="broadcast-mode"
                        value={value}
                        checked={mode === value}
                        disabled={phase.kind !== "edit"}
                        onChange={() => setMode(value)}
                        style={{ accentColor: skin.accent }}
                      />{" "}
                      {label}
                    </label>
                  ))}
                </div>
              ) : null}
              {mode === "pickup" ? (
                <PickupChecks
                  groups={pickups}
                  order={pickupOrder}
                  selected={selectedPickups}
                  disabled={phase.kind !== "edit"}
                  onChange={setSelectedPickups}
                />
              ) : (
                <>
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    <Chip
                      checked={
                        tours.length > 0 &&
                        selectedTours.length === tours.length
                      }
                      disabled={phase.kind !== "edit"}
                      onChange={(on) =>
                        setSelectedTours(on ? tours.map((t) => t.value) : [])
                      }
                      label="All"
                      className={skin.allChip}
                      textClassName={skin.allChipText}
                      accent={skin.accent}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tours.map((t) => (
                      <Chip
                        key={t.value}
                        checked={selectedTours.includes(t.value)}
                        disabled={phase.kind !== "edit"}
                        onChange={(on) =>
                          setSelectedTours((list) =>
                            on
                              ? [...list, t.value]
                              : list.filter((v) => v !== t.value),
                          )
                        }
                        label={t.label}
                        // 两页的产品勾选都是白底黄边（旧页面就是这样，门票页的深色弹窗里也是）。
                        className="border-[#e8b84b] bg-paper"
                        textClassName="text-[12px] text-[#7a4f00]"
                        accent="#ee8e00"
                      />
                    ))}
                    {tours.length === 0 ? (
                      <span className={cn("text-[12px]", skin.muted)}>
                        No tours on this date.
                      </span>
                    ) : null}
                  </div>
                </>
              )}
            </Step>

            <Step title="Step 2 — Recipients" className={skin.step}>
              <div className="flex gap-2">
                {groups.map((g) => (
                  <label
                    key={g.value}
                    className={cn(
                      "flex flex-1 cursor-pointer items-center gap-1.5 rounded-[7px] border px-3.5 py-[7px]",
                      group === g.value ? skin.radioOn : skin.radioOff,
                    )}
                  >
                    <input
                      type="radio"
                      name="broadcast-group"
                      value={g.value}
                      checked={group === g.value}
                      disabled={phase.kind !== "edit"}
                      onChange={() => setGroup(g.value)}
                      style={{ accentColor: skin.accent }}
                    />
                    <span>
                      <span
                        className={cn(
                          "block text-[13px] font-medium",
                          skin.radioTitle,
                        )}
                      >
                        {g.label}
                      </span>
                      <span className={cn("block text-[11px]", skin.muted)}>
                        {g.hint}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "ml-auto text-[12px] whitespace-nowrap",
                        skin.muted,
                      )}
                    >
                      {byGroup[g.value].length} guests
                    </span>
                  </label>
                ))}
              </div>
            </Step>

            <Step title="Step 3 — Message" className={skin.step}>
              {usingFallback ? (
                <p
                  className={cn(
                    "mb-2 rounded-md border px-2.5 py-[7px] text-[11px] leading-[1.5]",
                    skin.warnBox,
                  )}
                >
                  ⚠️ Couldn&rsquo;t load templates from Content Studio — showing
                  built-in defaults. Any edits made in Content Studio are{" "}
                  <b>not</b> shown here. You can still type a message and send.
                </p>
              ) : null}
              <select
                aria-label="Template"
                value={templateName}
                disabled={phase.kind !== "edit" || templates === null}
                onChange={(event) => {
                  setTemplateName(event.target.value);
                  const t = templates?.find(
                    (x) => x.name === event.target.value,
                  );
                  if (t) setBody(t.body);
                }}
                className={cn(
                  "mb-2 w-full rounded-md border px-2.5 py-[7px] text-[13px]",
                  skin.select,
                )}
              >
                <option value="">
                  {templates === null
                    ? "Loading templates…"
                    : "— Select template —"}
                </option>
                {(templates ?? []).map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label}
                  </option>
                ))}
              </select>
              <textarea
                aria-label="Message"
                value={body}
                disabled={phase.kind !== "edit"}
                onChange={(event) => setBody(event.target.value)}
                rows={3}
                placeholder="Message body... (supports {first_name} and {tour_date})"
                className={cn(
                  "block w-full resize-y rounded-md border px-2.5 py-2 font-[inherit] text-[13px]",
                  skin.textarea,
                )}
              />
              <p className={cn("mt-1 text-[11px]", skin.muted)}>
                Supports {"{first_name}"} and {"{tour_date}"}
                {signature ? " · the signature is added automatically" : ""}
              </p>
              {wantSms && trimmed ? (
                <p
                  className={cn(
                    "mt-1 text-[11px]",
                    smsCount > BROADCAST_MAX_SMS
                      ? "font-semibold text-[#c0392b]"
                      : skin.counter,
                  )}
                >
                  {smsCounterText}
                </p>
              ) : null}
            </Step>

            <Step title="Step 4 — Channel" className={skin.step}>
              <div className="flex gap-1.5">
                {CHANNELS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={channel === c.value}
                    disabled={phase.kind !== "edit"}
                    onClick={() => setChannel(c.value)}
                    className={cn(
                      "cursor-pointer rounded-md px-4 py-[7px] text-[12px]",
                      channel === c.value
                        ? cn("border border-transparent font-bold", skin.active)
                        : cn("border font-semibold", skin.idle),
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </Step>

            <div
              data-recipient-list
              className={cn(
                "overflow-y-auto rounded-lg border px-3 py-2.5",
                skin.listBox,
              )}
            >
              <div
                className={cn(
                  "mb-[5px] flex items-center gap-3 text-[12px]",
                  skin.listCount,
                )}
              >
                <span>{recipients.length} recipient(s)</span>
                {/* 全选（Annie 2026-10-13：所有发送表格都要全选 / 单选）。只管这一组名单里的人。 */}
                {recipients.length ? (
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      data-select-all
                      checked={picked.length === recipients.length}
                      disabled={phase.kind !== "edit"}
                      style={{ accentColor: skin.accent }}
                      onChange={(event) =>
                        setUnticked((set) => {
                          const next = new Set(set);
                          for (const c of recipients)
                            if (event.target.checked) next.delete(c.key);
                            else next.add(c.key);
                          return next;
                        })
                      }
                    />
                    Select all
                  </label>
                ) : null}
              </div>
              <div className="flex flex-col gap-[3px]">
                {recipients.map((c) => (
                  <label
                    key={c.key}
                    className={cn(
                      "flex items-center gap-2 rounded border px-1.5 py-[3px] text-[12px]",
                      skin.listItem,
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={!unticked.has(c.key)}
                      disabled={phase.kind !== "edit"}
                      style={{ accentColor: skin.accent }}
                      onChange={(event) =>
                        setUnticked((set) => {
                          const next = new Set(set);
                          if (event.target.checked) next.delete(c.key);
                          else next.add(c.key);
                          return next;
                        })
                      }
                    />
                    <span className={cn("flex-1 font-medium", skin.listName)}>
                      {c.name || "—"}
                    </span>
                    {/* By pickup location 不分团：每人多写哪个团、几点接（同旧页面，Annie 定）。 */}
                    {mode === "pickup" ? (
                      <span className="text-[11px] whitespace-nowrap text-[#8a6d1f]">
                        {tourLabel(c.tourType) || "—"}
                        {c.pickupTime ? ` · ${c.pickupTime}` : ""}
                      </span>
                    ) : null}
                    <span className={cn("text-[11px]", skin.listContact)}>
                      {c.phone || c.email || "—"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className={cn("text-[12px]", skin.text)}>
              {picked.length ? (
                <>
                  Will send:{" "}
                  {wantSms ? (
                    <>
                      📱 SMS <b>{smsReach}</b>
                    </>
                  ) : null}
                  {wantSms && wantEmail ? " · " : null}
                  {wantEmail ? (
                    <>
                      ✉ Email <b>{emailReach}</b>
                    </>
                  ) : null}
                  <span className={skin.summaryExtra}>
                    {"  "}({picked.length} of {recipients.length} selected
                    {wantSms && picked.length - smsReach
                      ? ` · ${picked.length - smsReach} no phone`
                      : ""}
                    {wantEmail && picked.length - emailReach
                      ? ` · ${picked.length - emailReach} no email`
                      : ""}
                    )
                  </span>
                </>
              ) : recipients.length ? (
                <span className={skin.noneSelected}>
                  No recipients selected.
                </span>
              ) : null}
            </p>
          </div>

          <div
            className={cn(
              "flex flex-col gap-2 border-t px-[18px] py-3",
              skin.footBorder,
            )}
          >
            {phase.kind === "edit" && phase.error ? (
              <p
                role="alert"
                className={cn(
                  "rounded-md border px-2.5 py-[7px] text-[12px]",
                  skin.warnBox,
                )}
              >
                {phase.error}
              </p>
            ) : null}
            {phase.kind === "tooLong" ? (
              <div
                data-too-long
                className={cn(
                  "rounded-md border px-3 py-2 text-[13px]",
                  skin.warnBox,
                )}
              >
                <p className="font-semibold">
                  This message is too long for SMS: it would go out as{" "}
                  {smsCount} SMS ({smsText.length.toLocaleString("en-US")}{" "}
                  characters, counting the signature and the expanded{" "}
                  {"{first_name}"} / {"{tour_date}"}). Broadcasts allow up to{" "}
                  {BROADCAST_MAX_SMS} SMS.
                </p>
                <p>
                  We suggest sending it by Email only. Would you like to switch
                  to Email only?
                </p>
                {picked.length - emailReach ? (
                  <p className="mt-1">
                    {picked.length - emailReach} selected guest(s) have no email
                    and will not receive it.
                  </p>
                ) : null}
              </div>
            ) : null}
            {checked ? (
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-[13px]",
                  skin.confirmBox,
                )}
              >
                <p className="font-semibold">
                  {willGet.length
                    ? `Send this message to ${willGet.length} guest(s) now?`
                    : "Everyone already got this message. Tick Send anyway to send it again."}
                </p>
                {already.length ? (
                  <div data-broadcast-already className="my-1.5">
                    <p>
                      {already.length} already got this exact message for this
                      tour date. They are skipped unless you tick Send anyway.
                    </p>
                    <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold">
                      <input
                        type="checkbox"
                        checked={allAgain}
                        disabled={busy}
                        style={{ accentColor: skin.accent }}
                        onChange={(event) =>
                          toggleAgain(
                            already.map((s) => s.order_number),
                            event.target.checked,
                          )
                        }
                      />
                      Send anyway (all)
                    </label>
                    <div className="mt-1 flex flex-col gap-[3px]">
                      {already.map((s) => (
                        <label
                          key={s.order_number}
                          data-already={s.order_number}
                          className="flex cursor-pointer flex-wrap items-center gap-2 rounded border border-[#f0d080] bg-[#fff8e1] px-1.5 py-[3px] text-[12px] text-[#7C4A00]"
                        >
                          <input
                            type="checkbox"
                            data-anyway={s.order_number}
                            checked={anyway.has(s.order_number)}
                            disabled={busy}
                            style={{ accentColor: skin.accent }}
                            onChange={(event) =>
                              toggleAgain(
                                [s.order_number],
                                event.target.checked,
                              )
                            }
                          />
                          <span className="font-medium text-[#1a1a1a]">
                            {nameOf.get(s.order_number) || s.order_number}
                          </span>
                          <span className="rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] text-[#BA7517]">
                            Sent by {s.sent_by || "staff"} on{" "}
                            {sentWhen(s.sent_at)}
                          </span>
                          <span className="ml-auto text-[11px]">
                            Send anyway
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                {willGet.length ? (
                  <p>
                    {[
                      wantSms
                        ? `${willGet.filter((c) => c.phone).length} SMS`
                        : null,
                      wantEmail
                        ? `${willGet.filter((c) => c.email).length} email(s)`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" and ")}{" "}
                    will go out. This cannot be undone.
                  </p>
                ) : null}
                {picked.length !== recipients.length ? (
                  <p className={cn("mt-1", skin.failText)}>
                    {recipients.length - picked.length} selected recipient(s)
                    will NOT receive this message.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              {phase.kind === "edit" ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    className={skin.cancelBtn}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const problem = validate();
                      if (problem) setPhase({ kind: "edit", error: problem });
                      else if (smsTooLong) setPhase({ kind: "tooLong" });
                      else void check();
                    }}
                    className={skin.sendBtn}
                  >
                    📣 Send broadcast
                  </button>
                </>
              ) : phase.kind === "tooLong" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPhase({ kind: "edit", error: null })}
                    className={skin.cancelBtn}
                  >
                    No, edit the message
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChannel("email");
                      void check();
                    }}
                    className={skin.sendBtn}
                  >
                    Yes, use Email only
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPhase({ kind: "edit", error: null })}
                    disabled={busy}
                    className={skin.cancelBtn}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => checked && void send(checked)}
                    disabled={busy || !checked || !willGet.length}
                    className={skin.sendBtn}
                  >
                    {phase.kind === "checking"
                      ? "Checking…"
                      : phase.kind === "sending"
                        ? "Sending…"
                        : "Yes, send now"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/** 门票页的群发弹窗：深色（tracking_tickets.html #broadcastOverlay）。 */
const TICKETS_SKIN = {
  overlay: "bg-black/70",
  panel:
    "flex max-h-[90vh] w-[580px] max-w-[95vw] flex-col overflow-hidden rounded-[14px] border border-white/15 bg-[#111a2b]",
  head: "bg-[linear-gradient(135deg,#f7cf6d,#f4b23c)]",
  headText: "text-[#2c1b00]",
  step: "text-white/40",
  text: "text-[#d9e8ff]",
  muted: "text-white/40",
  accent: "#f4b23c",
  allChip: "border-white/15 bg-white/[.08]",
  allChipText: "text-[12px] font-semibold text-[#d9e8ff]",
  radioOn: "border-white/15 bg-white/[.08]",
  radioOff: "border-white/15 bg-white/[.04]",
  radioTitle: "text-[#d9e8ff]",
  warnBox: "border-[#f87171] bg-[rgba(220,38,38,.18)] text-[#fecaca]",
  select: "border-white/15 bg-[#1e2d45] text-[#d9e8ff]",
  textarea: "border-white/15 bg-white/[.07] text-white",
  counter: "text-white/45",
  active: "bg-[linear-gradient(135deg,#f7cf6d,#f4b23c)] text-[#2c1b00]",
  idle: "border-white/15 bg-white/[.08] text-[#d9e8ff]",
  listBox: "max-h-[220px] border-white/[.12] bg-white/[.04]",
  listCount: "text-white/50",
  listItem: "border-white/10 bg-white/[.06]",
  listName: "text-[#d9e8ff]",
  listContact: "text-white/40",
  summaryExtra: "text-white/45",
  noneSelected: "text-[#f4b23c]",
  footBorder: "border-white/10",
  confirmBox:
    "border-[rgba(244,178,60,.45)] bg-[rgba(244,178,60,.12)] text-[#f7cf6d]",
  failText: "font-semibold text-[#f87171]",
  cancelBtn:
    "cursor-pointer rounded-md border border-white/15 bg-white/[.08] px-4 py-[7px] text-[13px] text-[#d9e8ff] disabled:opacity-50",
  sendBtn:
    "cursor-pointer rounded-md border-none bg-[linear-gradient(135deg,#f7cf6d,#f4b23c)] px-[18px] py-[7px] text-[13px] font-bold text-[#2c1b00] disabled:opacity-60",
};

/** Tour 页的群发弹窗：奶油色（tracking_tour.html #broadcastOverlay）。 */
const TOUR_SKIN: typeof TICKETS_SKIN = {
  overlay: "bg-black/45",
  panel:
    "flex max-h-[90vh] w-[580px] max-w-[95vw] flex-col overflow-hidden rounded-[12px] border border-[#e8b84b] bg-[#FFFDF5]",
  head: "bg-[linear-gradient(135deg,#ffce21,#ee8e00)]",
  headText: "text-[#1a1a1a]",
  step: "text-[#b86a00]",
  text: "text-[#7a4f00]",
  muted: "text-[#b86a00]",
  accent: "#ee8e00",
  allChip: "border-[#e8b84b] bg-[#fff3cd]",
  allChipText: "text-[12px] font-semibold text-[#7a4f00]",
  radioOn: "border-[#e8b84b] bg-[#fff3cd]",
  radioOff: "border-[#e8b84b] bg-[#FFFDF5]",
  radioTitle: "text-[#7a4f00]",
  warnBox: "border-[#dc2626] bg-[#fef2f2] text-[#991b1b]",
  select: "border-[#e8b84b] bg-paper text-[#7a4f00]",
  textarea: "border-[#e8b84b] bg-paper text-[#1a1a1a]",
  counter: "text-[#a07a3a]",
  active: "bg-[linear-gradient(135deg,#ffce21,#ee8e00)] text-[#1a1a1a]",
  idle: "border-[#e8b84b] bg-paper text-[#7a4f00]",
  listBox: "max-h-[150px] border-[#e8b84b] bg-[#fff8e1]",
  listCount: "text-[#b86a00]",
  listItem: "border-[#e8b84b] bg-paper",
  listName: "text-[#1a1a1a]",
  listContact: "text-[#b86a00]",
  summaryExtra: "text-[#a07a3a]",
  noneSelected: "font-semibold text-[#b45309]",
  footBorder: "border-[#f5e6c8]",
  confirmBox: "border-[#e8b84b] bg-[#fff3cd] text-[#7a4f00]",
  failText: "font-semibold text-[#dc2626]",
  cancelBtn:
    "cursor-pointer rounded-md border border-[#e8b84b] bg-paper px-4 py-[7px] text-[13px] text-[#7a4f00] disabled:opacity-50",
  sendBtn:
    "cursor-pointer rounded-md border-none bg-[linear-gradient(135deg,#ffce21,#ee8e00)] px-[18px] py-[7px] text-[13px] font-bold text-[#1a1a1a] disabled:opacity-60",
};

function Step({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3
        className={cn(
          "mb-2 text-[11px] font-semibold tracking-[.05em] uppercase",
          className,
        )}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * By pickup location 的勾选（旧 tracking_tour.html `#bcast-step1-pickup`）：All、对上 Settings 的站点
 * （人数 · 哪几个团、Also written as 其他写法）、对不上的放在「Not found in Settings → Pickup Locations」下面。
 */
function PickupChecks({
  groups,
  order,
  selected,
  disabled,
  onChange,
}: {
  groups: { matched: PickupGroup[]; unknown: PickupGroup[] };
  order: string[];
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  function toggle(name: string, on: boolean) {
    onChange(
      on
        ? order.filter((n) => n === name || selected.includes(n))
        : selected.filter((n) => n !== name),
    );
  }
  const box = (name: string) => (
    <input
      type="checkbox"
      value={name}
      checked={selected.includes(name)}
      disabled={disabled}
      onChange={(event) => toggle(name, event.target.checked)}
      style={{ accentColor: "#ee8e00" }}
    />
  );
  return (
    <div data-pickup-checks>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        <Chip
          checked={order.length > 0 && selected.length === order.length}
          disabled={disabled}
          onChange={(on) => onChange(on ? order : [])}
          label="All"
          className="border-[#e8b84b] bg-[#fff3cd]"
          textClassName="text-[12px] font-semibold text-[#7a4f00]"
          accent="#ee8e00"
        />
      </div>
      <div className="flex flex-col gap-[5px]">
        {groups.matched.map((g) => (
          <label
            key={g.name}
            data-pickup={g.name}
            className="block cursor-pointer rounded-lg border border-[#e8b84b] bg-paper px-2.5 py-1.5"
          >
            <span className="flex items-center gap-1.5">
              {box(g.name)}
              <span className="text-[12px] font-semibold text-[#1a1a1a]">
                {g.name}
              </span>
              <span className="ml-auto text-[11px] whitespace-nowrap text-[#b86a00]">
                {g.count} guest(s) · {g.tours.join(", ")}
              </span>
            </span>
            {g.raws.length ? (
              <span className="mt-0.5 ml-6 block text-[11px] text-[#3B6D11]">
                Also written as: {g.raws.join(", ")}
              </span>
            ) : null}
          </label>
        ))}
        {groups.matched.length === 0 ? (
          <div className="text-[12px] text-[#1a1a1a]">
            No guests for this date.
          </div>
        ) : null}
      </div>
      {groups.unknown.length ? (
        <div data-pickup-unknown className="mt-2.5">
          <div className="mb-[5px] text-[11px] font-semibold text-[#9a6b1f]">
            Not found in Settings &rarr; Pickup Locations
          </div>
          <div className="flex flex-col gap-[5px]">
            {groups.unknown.map((g) => (
              <label
                key={g.name}
                data-pickup={g.name}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#e8b84b] bg-paper px-2.5 py-[5px]"
              >
                {box(g.name)}
                <span className="text-[12px] text-[#1a1a1a]">{g.name}</span>
                <span className="ml-auto text-[11px] text-[#b86a00]">
                  {g.count} guest(s)
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  checked,
  disabled,
  onChange,
  label,
  className,
  textClassName,
  accent,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className: string;
  textClassName: string;
  accent: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-[5px] rounded-[20px] border px-2.5 py-[3px]",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        style={{ accentColor: accent }}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={textClassName}>{label}</span>
    </label>
  );
}
