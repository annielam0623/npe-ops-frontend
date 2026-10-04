import { apiFetch } from "@/lib/api-client";
import type {
  ManifestCard,
  ManifestUploadPreview,
  ManifestView,
} from "@/types";

/**
 * Dispatch → Tour manifest。全部 require_staff。
 * 车来自排车页**已保存**的排车；客人来自上传的 Rezdy CSV。
 */
const API = "/api/dispatch";

export async function fetchManifestCards(
  date: string,
  signal?: AbortSignal,
): Promise<ManifestCard[]> {
  const result = await apiFetch<{ run_date: string; cards: ManifestCard[] }>(
    `${API}/manifests`,
    { cache: "no-store", signal, query: { date } },
  );
  return result.cards;
}

export function fetchManifest(
  date: string,
  tour: number,
  signal?: AbortSignal,
): Promise<ManifestView> {
  return apiFetch<ManifestView>(`${API}/manifest`, {
    cache: "no-store",
    signal,
    query: { date, tour },
  });
}

function uploadForm(date: string, manifestId: number, file: File): FormData {
  const form = new FormData();
  form.append("date", date);
  form.append("manifest_id", String(manifestId));
  form.append("file", file);
  return form;
}

/** 上传 Rezdy CSV 的预览：Added / Removed / Changed。**不写库**。 */
export function previewManifestUpload(
  date: string,
  manifestId: number,
  file: File,
): Promise<ManifestUploadPreview> {
  return apiFetch<ManifestUploadPreview>(`${API}/manifests/preview`, {
    method: "POST",
    body: uploadForm(date, manifestId, file),
  });
}

/** Apply：服务端重新解析同一个文件后写库；保留每位客人的车和司机的上车标记。 */
export function applyManifestUpload(
  date: string,
  manifestId: number,
  file: File,
): Promise<{
  ok: true;
  added: number;
  removed: number;
  changed: number;
  rows: number;
  pax: number;
}> {
  return apiFetch(`${API}/manifests/apply`, {
    method: "POST",
    body: uploadForm(date, manifestId, file),
  });
}

export async function setGuestBus(
  guestId: number,
  busLabel: string | null,
): Promise<void> {
  await apiFetch(`${API}/manifests/guest-bus`, {
    method: "POST",
    body: { guest_id: guestId, bus_label: busLabel },
  });
}

/** 黄框（景点确认信息）。按 manifest + 车 + 节存。 */
export async function saveAttraction(input: {
  tourManifestId: number;
  busKey: string;
  section: string;
  checkin_time: string;
  pax_text: string;
  tour_time: string;
  confirmation_no: string;
}): Promise<void> {
  await apiFetch(`${API}/manifests/attraction`, {
    method: "POST",
    body: {
      tour_manifest_id: input.tourManifestId,
      bus_label: input.busKey,
      section: input.section,
      checkin_time: input.checkin_time,
      pax_text: input.pax_text,
      tour_time: input.tour_time,
      confirmation_no: input.confirmation_no,
    },
  });
}

/** 与后端 ATTR_LEN 一致（超长会被截断）。 */
export const ATTR_LEN = {
  checkin_time: 30,
  pax_text: 10,
  tour_time: 30,
  confirmation_no: 60,
} as const;

/** 后端渲染的打印页（新标签打开；每打开一次后端记一条打印日志）。bus 是 dispatch_assignment.id。 */
export function manifestPrintUrl(date: string, tour: number, bus?: number) {
  const q = new URLSearchParams({ date, tour: String(tour) });
  if (bus !== undefined) q.set("bus", String(bus));
  return `/admin/dispatch/manifest/print?${q.toString()}`;
}

export const MANIFEST_DOWNLOAD_URL = "/admin/dispatch/manifest/download";
