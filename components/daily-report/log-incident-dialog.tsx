"use client";

import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  createOperationReport,
  fetchReportAssignees,
} from "@/lib/daily-report-api";
import { laToday } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type {
  OperationReportCreateResult,
  PoliceReport,
  ReportAssignee,
  ReportType,
} from "@/types";

import {
  ABOUT_LABEL,
  COMPLAINT_ABOUTS,
  POLICE_LABEL,
  REPORT_TYPES,
  TYPE_LABEL,
  buildReportInput,
  emptyReportForm,
  missingFields,
  missingMessage,
  subjectLabel,
  type ReportForm,
} from "./config";

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
  value: T;
  onChange: (next: T) => void;
  label: (option: T) => string;
}) {
  return (
    <div role="group" aria-label={legend} className="flex flex-col gap-1">
      <span className={LABEL_CLASS}>{legend}</span>
      <div className="grid grid-cols-3 gap-1.5">
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
  const [saving, setSaving] = useState(false);

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

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="CHD# / order" htmlFor={`${id}-order`}>
              <input
                id={`${id}-order`}
                type="text"
                autoComplete="off"
                maxLength={50}
                placeholder="CHD…"
                value={form.orderNumber}
                onChange={(e) => set("orderNumber", e.target.value)}
                className={FIELD_CLASS}
              />
            </Field>
            {!isAccident ? (
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

          <Field label="What happened" htmlFor={`${id}-what`} required>
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
                  <select
                    id={`${id}-pol`}
                    value={form.police}
                    onChange={(e) =>
                      set("police", e.target.value as "" | PoliceReport)
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="">Choose…</option>
                    {(Object.keys(POLICE_LABEL) as PoliceReport[]).map((p) => (
                      <option key={p} value={p}>
                        {POLICE_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </fieldset>
          ) : null}

          <Field label="Follow-up" htmlFor={`${id}-fu`}>
            <select
              id={`${id}-fu`}
              value={form.followUpId}
              onChange={(e) => set("followUpId", e.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">Not assigned — whoever is on shift</option>
              {assignees.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.display_name}
                </option>
              ))}
            </select>
          </Field>

          {error ? (
            <p role="alert" className="text-xs text-[#f87171]">
              {error}
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
