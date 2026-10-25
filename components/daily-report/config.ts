import { LA_TIME_ZONE, laToday, laWallClockToIso } from "@/lib/la-date";
import type {
  ComplaintAbout,
  OperationReportInput,
  PoliceReport,
  ReportStatus,
  ReportType,
} from "@/types";

export const REPORT_TYPES: ReportType[] = [
  "complaint",
  "accident",
  "emergency",
];
export const COMPLAINT_ABOUTS: ComplaintAbout[] = [
  "driver",
  "guide",
  "itinerary",
];
export const STATUSES: ReportStatus[] = ["open", "in_progress", "resolved"];

export const TYPE_LABEL: Record<ReportType, string> = {
  complaint: "Complaint",
  accident: "Accident",
  emergency: "Emergency",
};
export const ABOUT_LABEL: Record<ComplaintAbout, string> = {
  driver: "Driver",
  guide: "Guide",
  itinerary: "Itinerary",
};
export const STATUS_LABEL: Record<ReportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
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
};
export const TYPE_TEXT_CLASS: Record<ReportType, string> = {
  complaint: "text-[#7dd3fc]",
  accident: "text-[#fbbf24]",
  emergency: "text-[#f87171]",
};
export const STATUS_COLOR_CLASS: Record<ReportStatus, string> = {
  open: "border-[#fbbf24]/55 bg-[#fbbf24]/10 text-[#fbbf24]",
  in_progress: "border-[#2dd4bf]/55 bg-[#2dd4bf]/10 text-[#2dd4bf]",
  // 已处理 = 绿（Annie 2026-10-24：未读 / 未处理红，已处理绿，全站）
  resolved: "border-[#28a745]/60 bg-[#28a745]/10 text-[#4ade80]",
};

/** 「对谁」那一栏的标签随投诉对象变（设计稿）。 */
export function subjectLabel(type: ReportType, about: ComplaintAbout): string {
  if (type === "complaint") {
    if (about === "guide") return "Guide name";
    if (about === "itinerary") return "Itinerary or tour name";
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
  };
}

const FIELD_LABEL = {
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

/** DOR 块里新建 / 改状态后发这个事件，Dashboard 的统计块（Open reports）据此立刻刷新。 */
export const DOR_CHANGED_EVENT = "npe:dor-changed";
