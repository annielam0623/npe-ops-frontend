import { apiFetch } from "@/lib/api-client";
import type {
  TourGuest,
  TourHeld,
  TourLane,
  TourMessagePreview,
  TourPreview,
  TourSendBulkResponse,
  TourSendType,
  TourTypeOption,
} from "@/types";

/** 巴士团型（按显示顺序 9 个）。key 就是发送接口认的那一组。 */
export function fetchTourTypes(
  signal?: AbortSignal,
): Promise<TourTypeOption[]> {
  return apiFetch<TourTypeOption[]>(
    "/api/notifications/tour-confirmation/tour-types",
    { cache: "no-store", signal },
  );
}

/** 用示例客人渲染这个团、这一天客人会收到的短信 / 邮件 / 确认页。纯读。 */
export function fetchTourMessagePreview(
  tourType: string,
  tourDate: string,
  signal?: AbortSignal,
): Promise<TourMessagePreview> {
  return apiFetch<TourMessagePreview>(
    "/api/notifications/tour-confirmation/message-preview",
    {
      cache: "no-store",
      signal,
      query: { tour_type: tourType, tour_date: tourDate },
    },
  );
}

/**
 * 上传 manifest：解析、标出这一天已经发过的单、重新上传时比对。不发送任何东西。
 * 解析失败 400（detail 是原因）。Last Minute 那一块传 lane=last_minute：Removed 只对比 Last Minute 的行。
 */
export function previewTourManifest(
  file: File,
  tourType: string,
  tourDate: string,
  lane: TourLane,
): Promise<TourPreview> {
  const form = new FormData();
  form.append("file", file);
  form.append("tour_type", tourType);
  form.append("tour_date", tourDate);
  if (lane === "last_minute") form.append("lane", "last_minute");
  return apiFetch<TourPreview>("/api/notifications/tour-confirmation/preview", {
    method: "POST",
    body: form,
    cache: "no-store",
  });
}

/**
 * 点 Send 时先建一批（Send Log 按批看）。**这一步什么都不发**；建不成就不发。
 * held = 页面自己留下没发的行和原因（已发过没勾 Send anyway、文件里第二次出现）。
 */
export function startTourBatch(body: {
  lane: TourLane;
  tour_type: string;
  tour_date: string;
  send_type: TourSendType;
  file_rows: number;
  held: TourHeld[];
}): Promise<{ batch_id: number }> {
  return apiFetch<{ batch_id: number }>("/send/tour-batches", {
    method: "POST",
    body,
    cache: "no-store",
  });
}

const BULK_URL: Record<TourLane, string> = {
  tour_confirmation: "/send/tour-confirmation-bulk",
  last_minute: "/send/last-minute-confirmation-bulk",
};

/**
 * ⚠️ 真实发送：给这一组客人发团确认（或 Last Minute）短信 / 邮件，写 send_log。
 * 服务端发每位前拿锁再查一次：发过的跳过（回在 skipped 里）；sendAnyway 里列了、而且最近一次发送早于
 * previewAt 的才再发一次——页面怎么重试都不会把同一单多发。
 * 400 = 服务端在发第一条之前就整组拒了，这一组什么都没发。
 */
export function sendTourGroup(
  lane: TourLane,
  body: {
    tour_type: string;
    tour_date: string;
    send_type: TourSendType;
    guests: TourGuest[];
    send_anyway: string[];
    preview_at: string;
    batch_id: number;
  },
): Promise<TourSendBulkResponse> {
  return apiFetch<TourSendBulkResponse>(BULK_URL[lane], {
    method: "POST",
    body,
    cache: "no-store",
  });
}

/**
 * 重新上传后「Apply」：Changed 写新值、Added 插进系统（Last Minute 那一块插的标 Last Minute）。
 * **不发任何消息**、不写 send_log；Removed 不碰。整批一个事务。
 */
export function applyTourUpload(body: {
  tour_type: string;
  tour_date: string;
  lane: "regular" | "last_minute";
  guests: TourGuest[];
}): Promise<{ updated: number; added: number }> {
  return apiFetch("/send/tour-confirmation-apply", {
    method: "POST",
    body,
    cache: "no-store",
  });
}
