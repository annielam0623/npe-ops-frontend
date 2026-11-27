import { LA_TIME_ZONE, laToday, laWallClockToIso } from "@/lib/la-date";
import type {
  ComplaintAbout,
  ContactMethod,
  NoShowClientDetails,
  NoShowDecision,
  NoShowReason,
  NoShowReportedBy,
  OperationReportInput,
  PoliceReport,
  ReportDetails,
  ReportStatus,
  ReportType,
} from "@/types";

export const REPORT_TYPES: ReportType[] = [
  "complaint",
  "accident",
  "emergency",
  "no_show",
];
export const COMPLAINT_ABOUTS: ComplaintAbout[] = [
  "driver",
  "guide",
  "itinerary",
  "office",
];
/** Status 下拉里能选的（waiting_reschedule 只由后端设，见 statusOptions）。 */
export const STATUSES: ReportStatus[] = ["open", "in_progress", "resolved"];

/** Status 下拉：No show 已在 Waiting for rescheduled tour 时多这一项（选回去后端才认，要 decision = accepted）。 */
export function statusOptions(current: ReportStatus): ReportStatus[] {
  return current === "waiting_reschedule"
    ? ["open", "in_progress", "waiting_reschedule", "resolved"]
    : STATUSES;
}

export const TYPE_LABEL: Record<ReportType, string> = {
  complaint: "Complaint",
  accident: "Accident",
  emergency: "Emergency",
  no_show: "No show",
};
export const ABOUT_LABEL: Record<ComplaintAbout, string> = {
  driver: "Driver",
  guide: "Guide",
  itinerary: "Itinerary",
  office: "Office / Booking",
};
export const STATUS_LABEL: Record<ReportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_reschedule: "Waiting for rescheduled tour",
  resolved: "Resolved",
};
export const POLICE_LABEL: Record<PoliceReport, string> = {
  yes: "Yes",
  no: "No",
  unknown: "Unknown",
};

// 颜色照 Annie 通过的设计稿（Log an incident 表单）。
export const TYPE_COLOR_CLASS: Record<ReportType, string> = {
  complaint: "border-[#7dd3fc]/50 text-[#7dd3fc]",
  accident: "border-[#fbbf24]/55 text-[#fbbf24]",
  emergency: "border-[#f87171]/55 text-[#f87171]",
  // G361 No show：紫（preview UAhRhQfyGQYt2D8hWjHqZz，同 11-18 样稿 N8XZn83rVNBUM7ASLkNsit）。
  no_show: "border-[#c4b5fd]/55 text-[#c4b5fd]",
};
export const TYPE_TEXT_CLASS: Record<ReportType, string> = {
  complaint: "text-[#7dd3fc]",
  accident: "text-[#fbbf24]",
  emergency: "text-[#f87171]",
  no_show: "text-[#c4b5fd]",
};
export const STATUS_COLOR_CLASS: Record<ReportStatus, string> = {
  open: "border-[#fbbf24]/55 bg-[#fbbf24]/10 text-[#fbbf24]",
  in_progress: "border-[#2dd4bf]/55 bg-[#2dd4bf]/10 text-[#2dd4bf]",
  waiting_reschedule: "border-[#c4b5fd]/60 bg-[#c4b5fd]/10 text-[#c4b5fd]",
  // 已处理 = 绿（Annie 2026-10-24：未读 / 未处理红，已处理绿，全站）
  resolved: "border-[#28a745]/60 bg-[#28a745]/10 text-[#4ade80]",
};

/** 「对谁」那一栏的标签随投诉对象变（设计稿）。 */
export function subjectLabel(type: ReportType, about: ComplaintAbout): string {
  if (type === "complaint") {
    if (about === "guide") return "Guide name";
    if (about === "itinerary") return "Itinerary or tour name";
    if (about === "office") return "Staff or system involved";
  }
  return type === "emergency" ? "People involved" : "Driver name";
}

const WHEN_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const WHEN_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
});

/** 今天只显示钟点（7:05 AM），其他天带日期（Oct 23, 7:05 AM）；一律洛杉矶时间。 */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = WHEN_TIME.format(at);
  return laToday(at) === laToday() ? time : `${WHEN_DATE.format(at)}, ${time}`;
}

export interface ReportForm {
  type: ReportType;
  about: ComplaintAbout;
  orderNumber: string;
  subject: string;
  whatHappened: string;
  followUpId: string; // "" = 不指定
  // Accident
  accidentDate: string;
  accidentTime: string;
  location: string;
  vehicleNo: string;
  driverName: string;
  injuries: string;
  police: "" | PoliceReport;
  // No show（G361）：除订单号 + 团期外都从 prefill 带出、可改、选填。
  nsTourDate: string;
  nsProductCode: string;
  nsProductName: string;
  nsPickup: string;
  nsDriver: string;
  nsGuide: string;
  nsVehicle: string;
  nsReportedBy: "" | NoShowReportedBy;
  nsReason: "" | NoShowReason;
}

export function emptyReportForm(): ReportForm {
  return {
    type: "complaint",
    about: "driver",
    orderNumber: "",
    subject: "",
    whatHappened: "",
    followUpId: "",
    // 事故时间的日期默认今天，但必须能选：过了半夜补登前一天的事故。
    accidentDate: laToday(),
    accidentTime: "",
    location: "",
    vehicleNo: "",
    driverName: "",
    injuries: "",
    police: "",
    nsTourDate: "",
    nsProductCode: "",
    nsProductName: "",
    nsPickup: "",
    nsDriver: "",
    nsGuide: "",
    nsVehicle: "",
    nsReportedBy: "",
    nsReason: "",
  };
}

const FIELD_LABEL = {
  orderNumber: "CHD# / order",
  nsTourDate: "Tour date",
  whatHappened: "What happened",
  accidentTime: "Accident time",
  location: "Location",
  vehicleNo: "Vehicle #",
  driverName: "Driver",
  injuries: "Injuries",
  police: "Police report",
} as const;

export type MissingField = keyof typeof FIELD_LABEL;

/** 必填检查：Complaint / Emergency 只要 What happened；Accident 全部必填（车号、司机可填 Unknown）。 */
export function missingFields(form: ReportForm): MissingField[] {
  const missing: MissingField[] = [];
  // No show：只要订单号 + 团期（G361 Q2「只填订单号，其余自动带出」）；What happened 选填。
  if (form.type === "no_show") {
    if (!form.orderNumber.trim()) missing.push("orderNumber");
    if (!form.nsTourDate) missing.push("nsTourDate");
    return missing;
  }
  if (!form.whatHappened.trim()) missing.push("whatHappened");
  if (form.type === "accident") {
    if (!form.accidentDate || !form.accidentTime) missing.push("accidentTime");
    if (!form.location.trim()) missing.push("location");
    if (!form.vehicleNo.trim()) missing.push("vehicleNo");
    if (!form.driverName.trim()) missing.push("driverName");
    if (!form.injuries.trim()) missing.push("injuries");
    if (!form.police) missing.push("police");
  }
  return missing;
}

export function missingMessage(missing: MissingField[]): string {
  return `Please fill in: ${missing.map((m) => FIELD_LABEL[m]).join(", ")}.`;
}

/** 表单 → 接口请求体（调用前先过 missingFields）。空串一律发 null。 */
export function buildReportInput(
  form: ReportForm,
  clientToken: string,
): OperationReportInput {
  const orNull = (value: string) => value.trim() || null;
  const followUp = Number(form.followUpId);
  const base = {
    report_type: form.type,
    complaint_about: form.type === "complaint" ? form.about : null,
    what_happened: form.whatHappened.trim(),
    follow_up_user_id: form.followUpId && followUp > 0 ? followUp : null,
    client_token: clientToken,
  };
  if (form.type === "no_show") {
    const d: Partial<NoShowClientDetails> = {
      tour_date: form.nsTourDate,
      product_code: form.nsProductCode.trim(),
      product_name: form.nsProductName.trim(),
      pickup_location: form.nsPickup.trim(),
      driver_name: form.nsDriver.trim(),
      guide_name: form.nsGuide.trim(),
      vehicle: form.nsVehicle.trim(),
      ...(form.nsReportedBy ? { reported_by: form.nsReportedBy } : {}),
      ...(form.nsReason ? { reason: form.nsReason } : {}),
    };
    return {
      ...base,
      order_number: form.orderNumber.trim().toUpperCase(),
      subject_name: orNull(form.subject),
      details: dropBlank(d),
    };
  }
  if (form.type === "accident") {
    return {
      ...base,
      order_number: orNull(form.orderNumber),
      subject_name: null,
      details: {
        occurred_at: laWallClockToIso(form.accidentDate, form.accidentTime),
        location: form.location.trim(),
        vehicle_no: form.vehicleNo.trim(),
        driver_name: form.driverName.trim(),
        injuries: form.injuries.trim(),
        police_report: form.police as PoliceReport,
      },
    };
  }
  return {
    ...base,
    order_number: orNull(form.orderNumber),
    subject_name: orNull(form.subject),
    details: {},
  };
}

/** 空串的键不发（后端也会丢，这里先丢，请求干净）。 */
export function dropBlank<T extends object>(d: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(d).filter(([, v]) => v !== "" && v !== null && v !== undefined),
  ) as Partial<T>;
}

// ── No show（G361）的选项文字（同后端 no_show_reports.LABELS）──
export const REPORTED_BY_OPTIONS: NoShowReportedBy[] = ["driver", "guide", "office"];
export const REPORTED_BY_LABEL: Record<NoShowReportedBy, string> = {
  driver: "Driver",
  guide: "Guide",
  office: "Office",
};
export const REASON_OPTIONS: NoShowReason[] = [
  "guest_did_not_show",
  "wrong_pickup_info",
  "not_notified",
  "other",
];
export const REASON_LABEL: Record<NoShowReason, string> = {
  guest_did_not_show: "Guest didn't show",
  wrong_pickup_info: "Wrong pickup info given to guest",
  not_notified: "Guest says not notified",
  other: "Other",
};
export const DECISION_OPTIONS: NoShowDecision[] = ["accepted", "declined", "no_reply"];
export const DECISION_LABEL: Record<NoShowDecision, string> = {
  accepted: "Accepted reschedule",
  declined: "Declined",
  no_reply: "No reply",
};
export const CONTACT_METHODS: ContactMethod[] = [
  "phone",
  "text",
  "whatsapp",
  "email",
  "in_person",
];
export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  phone: "Phone",
  text: "Text",
  whatsapp: "WhatsApp",
  email: "Email",
  in_person: "In person",
};

/** PATCH details 要整份发 staff 那部分（后端整份替换），从现有 details 里只留 staff 能填的键。 */
const CLIENT_KEYS: (keyof NoShowClientDetails)[] = [
  "tour_date",
  "product_code",
  "product_name",
  "pickup_location",
  "driver_name",
  "guide_name",
  "vehicle",
  "reported_by",
  "reason",
  "decision",
  "new_order_number",
  "follow_up_due",
];
export function clientDetails(d: ReportDetails): Partial<NoShowClientDetails> {
  const out: Record<string, unknown> = {};
  for (const k of CLIENT_KEYS) {
    const v = d[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out as Partial<NoShowClientDetails>;
}

/** "2026-11-26" → "Nov 26, 2026"（不经时区换算）。 */
export function formatYmd(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd ?? "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** DOR 块里新建 / 改状态后发这个事件，Dashboard 的统计块（Open reports）据此立刻刷新。 */
export const DOR_CHANGED_EVENT = "npe:dor-changed";
