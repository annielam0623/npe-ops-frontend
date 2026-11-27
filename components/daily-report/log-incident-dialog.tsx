"use client";

import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { capsPlaceholder } from "@/components/ui/placeholder";
import { Modal } from "@/components/ui/modal";
import { ApiError } from "@/types";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  createOperationReport,
  fetchNoShowPrefill,
  fetchReportAssignees,
} from "@/lib/daily-report-api";
import { laToday } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type {
  NoShowPrefill,
  NoShowPrefillDay,
  NoShowReason,
  NoShowReportedBy,
  OperationReportCreateResult,
  PoliceReport,
  ReportAssignee,
  ReportType,
} from "@/types";

import {
  ABOUT_LABEL,
  COMPLAINT_ABOUTS,
  POLICE_LABEL,
  REASON_LABEL,
  REASON_OPTIONS,
  REPORTED_BY_LABEL,
  REPORTED_BY_OPTIONS,
  REPORT_TYPES,
  TYPE_LABEL,
  formatYmd,
  buildReportInput,
  emptyReportForm,
  missingFields,
  missingMessage,
  subjectLabel,
  type ReportForm,
} from "./config";
import { SelectMenu } from "@/components/ui/select-menu";
import { EarlierRecords, orderLooksComplete } from "./earlier-records";

/** Dispatch 的 Farm out 灰底白字（farm-out-block.tsx:51-59），DOR 里照搬。 */
export const FARM_OUT_TAG_CLASS =
  "rounded-[5px] bg-[#475569] px-[7px] py-px text-[10px] font-bold tracking-[.06em] text-white uppercase";

const FIELD_CLASS =
  "w-full rounded-lg border border-white/20 bg-black/[.28] px-[9px] py-[7px] text-[13px] text-[#f8fafc] placeholder:text-white/35 [color-scheme:dark] focus:border-white/50 focus:outline-none";
const LABEL_CLASS = "text-[11.5px] font-bold tracking-[.02em] text-white/62";

function newClientToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function Field({
  label,
  htmlFor,
  required,
  action,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className={LABEL_CLASS}>
          {label}
          {required ? <span className="text-[#f87171]"> *</span> : null}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  label,
}: {
  legend: string;
  options: readonly T[];
  /** "" = 都没选（No show 的 Reported by 选填）。 */
  value: T | "";
  onChange: (next: T) => void;
  label: (option: T) => string;
}) {
  return (
    <div role="group" aria-label={legend} className="flex flex-col gap-1">
      <span className={LABEL_CLASS}>{legend}</span>
      <div
        className={cn(
          "grid gap-1.5",
          // 四个（Report type 加了 No show、Complaint about 加了 Office / Booking）：手机上 2 × 2。
          options.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
        )}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-lg border px-1 py-1.5 text-[12.5px] font-semibold",
              value === option
                ? "border-[#f8fafc] bg-[#f8fafc] text-[#06101c]"
                : "border-white/25 text-[#f8fafc] hover:bg-white/[.08]",
            )}
          >
            {label(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 「Unknown」小按钮：车号 / 司机允许填 Unknown。 */
function UnknownButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11.5px] text-white/60 underline underline-offset-2 hover:text-white"
    >
      Unknown
    </button>
  );
}

/**
 * + Log an incident 弹窗（Annie 2026-10-24 通过设计稿：弹窗、深色、Save 是蓝色提交键）。
 * Complaint / Emergency 只有 What happened 必填；Accident 的详情全部必填，
 * 事故时间 = 日期（默认今天，可选）+ 钟点。
 */
export function LogIncidentDialog({
  onClose,
  onCreated,
  onUnauthorized,
}: {
  onClose: () => void;
  onCreated: (result: OperationReportCreateResult) => void;
  onUnauthorized: () => void;
}) {
  const titleId = useId();
  const id = useId();
  const [form, setForm] = useState<ReportForm>(emptyReportForm);
  const [clientToken] = useState(newClientToken);
  const [assignees, setAssignees] = useState<ReportAssignee[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** G361：这单这天已有没关的 No show（后端 409 existing_id）⇒ 红字后面给「Open it →」。 */
  const [existingId, setExistingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefill, setPrefill] = useState<NoShowPrefill | null>(null);
  const [farmOut, setFarmOut] = useState(false);
  const isNoShow = form.type === "no_show";
  const prefillOrder = isNoShow ? form.orderNumber.trim().toUpperCase() : "";

  /** 选了一天 ⇒ 那天带出来的值填进格子（空的就留空、能手填）。 */
  function applyDay(day: NoShowPrefillDay) {
    setFarmOut(day.farm_out);
    setForm((prev) => ({
      ...prev,
      nsTourDate: day.tour_date,
      nsProductCode: day.product_code,
      nsProductName: day.product_name,
      nsPickup: day.pickup_location,
      nsDriver: day.driver_name,
      nsGuide: day.guide_name,
      nsVehicle: day.vehicle,
      subject: day.guest_name,
    }));
  }

  // G361 No show：订单号像样了（停 400ms）⇒ 后端从 Order List + Main manifest + Dispatch 带出团期等；一单一天就直接选上。
  useEffect(() => {
    setPrefill(null);
    setFarmOut(false);
    if (!prefillOrder || !orderLooksComplete(prefillOrder)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchNoShowPrefill(prefillOrder, controller.signal)
        .then((p) => {
          setPrefill(p);
          if (p.days.length === 1) applyDay(p.days[0]);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (isStatus(err, 401)) onUnauthorized();
          // 带不出来不挡登记：当成查不到，格子手填。
          else
            setPrefill({ order_number: prefillOrder, found: false, days: [] });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [prefillOrder, onUnauthorized]);

  // 跟进人下拉：拿不到就只剩「不指定」，不挡登记。
  useEffect(() => {
    const controller = new AbortController();
    fetchReportAssignees(controller.signal)
      .then((users) => setAssignees(users))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  function set<K extends keyof ReportForm>(key: K, value: ReportForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const missing = missingFields(form);
    if (missing.length) {
      setError(missingMessage(missing));
      return;
    }
    setError(null);
    setExistingId(null);
    setSaving(true);
    try {
      const result = await createOperationReport(
        buildReportInput(form, clientToken),
      );
      onCreated(result);
    } catch (err) {
      if (isStatus(err, 401)) {
        onUnauthorized();
      } else {
        setError(describeError(err));
        const existing =
          err instanceof ApiError && isStatus(err, 409)
            ? (err.body as { existing_id?: unknown } | null)?.existing_id
            : null;
        setExistingId(typeof existing === "number" ? existing : null);
      }
      setSaving(false);
    }
  }

  const isAccident = form.type === "accident";

  return (
    <Modal
      titleId={titleId}
      onDismiss={saving ? undefined : onClose}
      panelClassName="flex max-h-[calc(100vh-32px)] max-w-[560px] flex-col !rounded-[14px] border border-white/20 !bg-[#0f2238] !text-[#f8fafc] shadow-[0_16px_48px_rgba(0,0,0,.55)]"
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center gap-2.5 border-b border-white/12 px-4 pt-3.5 pb-2.5">
          <h2 id={titleId} className="m-0 text-base font-bold">
            Log an incident
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={saving}
            className="ml-auto text-xl leading-none hover:text-white/70 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <Segmented<ReportType>
            legend="Report type"
            options={REPORT_TYPES}
            value={form.type}
            onChange={(next) => set("type", next)}
            label={(t) => TYPE_LABEL[t]}
          />
          {form.type === "complaint" ? (
            <Segmented
              legend="Complaint about"
              options={COMPLAINT_ABOUTS}
              value={form.about}
              onChange={(next) => set("about", next)}
              label={(a) => ABOUT_LABEL[a]}
            />
          ) : null}

          <div
            className={cn(
              "grid grid-cols-1 gap-2.5",
              !isNoShow && "sm:grid-cols-2",
            )}
          >
            <Field
              label="CHD# / order"
              htmlFor={`${id}-order`}
              required={isNoShow}
            >
              <input
                id={`${id}-order`}
                type="text"
                autoComplete="off"
                maxLength={50}
                placeholder="CHD…"
                {...capsPlaceholder("CHD…")}
                value={form.orderNumber}
                onChange={(e) => set("orderNumber", e.target.value)}
                className={FIELD_CLASS}
              />
            </Field>
            {!isAccident && !isNoShow ? (
              <Field
                label={subjectLabel(form.type, form.about)}
                htmlFor={`${id}-subject`}
              >
                <input
                  id={`${id}-subject`}
                  type="text"
                  autoComplete="off"
                  maxLength={200}
                  placeholder={
                    form.type === "complaint" && form.about === "itinerary"
                      ? "Which tour"
                      : "Who"
                  }
                  value={form.subject}
                  onChange={(e) => set("subject", e.target.value)}
                  className={FIELD_CLASS}
                />
              </Field>
            ) : null}
          </div>

          {isNoShow ? (
            <NoShowFields
              id={id}
              form={form}
              set={set}
              prefill={prefill}
              farmOut={farmOut}
              onPickDay={applyDay}
            />
          ) : null}

          <EarlierRecords
            orderNumber={form.orderNumber}
            onUnauthorized={onUnauthorized}
          />

          <Field
            label="What happened"
            htmlFor={`${id}-what`}
            required={!isNoShow}
          >
            <textarea
              id={`${id}-what`}
              placeholder="Short description"
              value={form.whatHappened}
              onChange={(e) => set("whatHappened", e.target.value)}
              className={cn(FIELD_CLASS, "min-h-[76px] resize-y")}
            />
          </Field>

          {isAccident ? (
            <fieldset className="flex flex-col gap-2.5 rounded-[10px] border border-dashed border-[#fbbf24]/50 p-2.5">
              <legend className="px-1 text-xs font-bold text-[#fbbf24]">
                Accident details
              </legend>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field label="Accident date" htmlFor={`${id}-adate`} required>
                  <input
                    id={`${id}-adate`}
                    type="date"
                    max={laToday()}
                    value={form.accidentDate}
                    onChange={(e) => set("accidentDate", e.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Accident time" htmlFor={`${id}-atime`} required>
                  <input
                    id={`${id}-atime`}
                    type="time"
                    value={form.accidentTime}
                    onChange={(e) => set("accidentTime", e.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
              </div>
              <Field label="Location" htmlFor={`${id}-loc`} required>
                <input
                  id={`${id}-loc`}
                  type="text"
                  autoComplete="off"
                  maxLength={200}
                  placeholder="Where"
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  className={FIELD_CLASS}
                />
              </Field>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field
                  label="Vehicle #"
                  htmlFor={`${id}-veh`}
                  required
                  action={
                    <UnknownButton
                      onClick={() => set("vehicleNo", "Unknown")}
                    />
                  }
                >
                  <input
                    id={`${id}-veh`}
                    type="text"
                    autoComplete="off"
                    maxLength={50}
                    placeholder="Bus / van number"
                    value={form.vehicleNo}
                    onChange={(e) => set("vehicleNo", e.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field
                  label="Driver"
                  htmlFor={`${id}-drv`}
                  required
                  action={
                    <UnknownButton
                      onClick={() => set("driverName", "Unknown")}
                    />
                  }
                >
                  <input
                    id={`${id}-drv`}
                    type="text"
                    autoComplete="off"
                    maxLength={200}
                    placeholder="Who was driving"
                    value={form.driverName}
                    onChange={(e) => set("driverName", e.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field label="Injuries" htmlFor={`${id}-inj`} required>
                  <input
                    id={`${id}-inj`}
                    type="text"
                    autoComplete="off"
                    maxLength={500}
                    placeholder="None / describe"
                    value={form.injuries}
                    onChange={(e) => set("injuries", e.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Police report" htmlFor={`${id}-pol`} required>
                  <SelectMenu
                    id={`${id}-pol`}
                    value={String(form.police)}
                    options={[
                      { value: "", label: "Choose…" },
                      ...(Object.keys(POLICE_LABEL) as PoliceReport[]).map(
                        (p) => ({
                          value: String(p),
                          label: String(POLICE_LABEL[p]),
                        }),
                      ),
                    ]}
                    onChange={(next) =>
                      set("police", next as "" | PoliceReport)
                    }
                    className={FIELD_CLASS}
                  />
                </Field>
              </div>
            </fieldset>
          ) : null}

          <Field label="Follow-up" htmlFor={`${id}-fu`}>
            <SelectMenu
              id={`${id}-fu`}
              value={String(form.followUpId)}
              options={[
                { value: "", label: "Not assigned — whoever is on shift" },
                ...assignees.map((u) => ({
                  value: String(String(u.id)),
                  label: String(u.display_name),
                })),
              ]}
              onChange={(next) => set("followUpId", next)}
              className={FIELD_CLASS}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-xs text-[#f87171]">
              {error}
              {existingId ? (
                <>
                  {" "}
                  <a
                    href={`/daily-report?id=${existingId}`}
                    data-open-existing
                    className="font-semibold text-[#38bdf8] hover:underline"
                  >
                    Open it →
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/12 px-4 pt-2.5 pb-3.5">
          <button
            type="submit"
            disabled={saving}
            className="rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-[18px] py-[7px] text-[13px] font-bold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-[9px] border border-white/30 px-3.5 py-[7px] text-[13px] hover:bg-white/[.08] disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * G361 No show 那一块（preview UAhRhQfyGQYt2D8hWjHqZz ①）：团期必填（几天就按钮选一天；Order List 里查不到就自己填日期），
 * 其余从 prefill 带出、可改、选填。
 */
function NoShowFields({
  id,
  form,
  set,
  prefill,
  farmOut,
  onPickDay,
}: {
  id: string;
  form: ReportForm;
  set: <K extends keyof ReportForm>(key: K, value: ReportForm[K]) => void;
  prefill: NoShowPrefill | null;
  farmOut: boolean;
  onPickDay: (day: NoShowPrefillDay) => void;
}) {
  const days = prefill?.days ?? [];
  const text = (
    key: "nsProductName" | "nsPickup" | "nsDriver" | "nsGuide" | "nsVehicle",
    label: string,
    max: number,
    placeholder: string,
  ) => (
    <Field label={label} htmlFor={`${id}-${key}`}>
      <input
        id={`${id}-${key}`}
        type="text"
        autoComplete="off"
        maxLength={max}
        placeholder={placeholder}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        className={FIELD_CLASS}
      />
    </Field>
  );
  const picked = (d: NoShowPrefillDay) =>
    form.nsTourDate === d.tour_date && form.nsProductCode === d.product_code;
  return (
    <>
      {days.length > 1 ? (
        <div
          role="group"
          aria-label="Tour date"
          className="flex flex-col gap-1"
        >
          <span className={LABEL_CLASS}>
            Tour date<span className="text-[#f87171]"> *</span>
          </span>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {days.map((d) => (
              <button
                key={`${d.tour_date}|${d.product_code}`}
                type="button"
                data-ns-day={d.tour_date}
                aria-pressed={picked(d)}
                onClick={() => onPickDay(d)}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-left text-[12.5px] font-semibold",
                  picked(d)
                    ? "border-[#f8fafc] bg-[#f8fafc] text-[#06101c]"
                    : "border-white/25 text-[#f8fafc] hover:bg-white/[.08]",
                )}
              >
                {formatYmd(d.tour_date)}
                {d.product_name ? ` · ${d.product_name}` : ""}
              </button>
            ))}
          </div>
          <span className="text-[11.5px] text-white/42">
            This order has {days.length} tour days. Pick the one the guest
            missed.
          </span>
        </div>
      ) : (
        <Field label="Tour date" htmlFor={`${id}-nsdate`} required>
          <input
            id={`${id}-nsdate`}
            type="date"
            value={form.nsTourDate}
            onChange={(e) => set("nsTourDate", e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      )}
      {prefill && !prefill.found ? (
        <p data-ns-not-found className="text-[11.5px] text-[#fbbf24]">
          This order is not in the Order List. You can still log it: type the
          tour date and the rest yourself.
        </p>
      ) : null}
      <fieldset className="flex min-w-0 flex-col gap-2.5 rounded-[10px] border border-dashed border-[#c4b5fd]/55 p-2.5">
        <legend className="flex items-center gap-1.5 px-1 text-xs font-bold text-[#c4b5fd]">
          No show details
          {farmOut ? (
            <span data-farm-out className={FARM_OUT_TAG_CLASS}>
              Farm out
            </span>
          ) : null}
        </legend>
        {prefill?.found ? (
          <span className="text-[10.5px] text-[#c4b5fd]">
            Filled in from Main manifest and Dispatch. You can change them.
          </span>
        ) : null}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {text("nsProductName", "Product", 300, "Tour")}
          {text("nsPickup", "Pickup location", 300, "Where")}
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {text("nsDriver", "Driver", 200, "Who")}
          {text("nsGuide", "Guide", 200, "Who")}
          {text("nsVehicle", "Vehicle", 50, "Bus / van")}
        </div>
        <Segmented<NoShowReportedBy>
          legend="Reported by"
          options={REPORTED_BY_OPTIONS}
          value={form.nsReportedBy}
          onChange={(next) =>
            set("nsReportedBy", form.nsReportedBy === next ? "" : next)
          }
          label={(o) => REPORTED_BY_LABEL[o]}
        />
        <Field label="Reason" htmlFor={`${id}-reason`}>
          <SelectMenu
            id={`${id}-reason`}
            value={String(form.nsReason)}
            options={[
              { value: "", label: "Choose…" },
              ...REASON_OPTIONS.map((o) => ({
                value: String(o),
                label: String(REASON_LABEL[o]),
              })),
            ]}
            onChange={(next) => set("nsReason", next as "" | NoShowReason)}
            className={FIELD_CLASS}
          />
        </Field>
      </fieldset>
    </>
  );
}
