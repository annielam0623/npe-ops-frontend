import { apiFetch } from "@/lib/api-client";
import type {
  DispatchPendingItem,
  DispatchSyncResult,
  GuestListsDone,
  ManifestCard,
  ManifestView,
} from "@/types";

/**
 * Dispatch → Tour manifest。全部 require_staff。
 * 车来自排车页**已保存**的排车；客人从主 Manifest 同步（G35）。
 */
const API = "/api/dispatch";

export async function fetchManifestCards(
  date: string,
  signal?: AbortSignal,
): Promise<{ cards: ManifestCard[]; guestListsDone: GuestListsDone | null }> {
  const result = await apiFetch<{
    run_date: string;
    cards: ManifestCard[];
    guest_lists_done?: GuestListsDone | null;
  }>(`${API}/manifests`, { cache: "no-store", signal, query: { date } });
  return {
    cards: result.cards,
    guestListsDone: result.guest_lists_done ?? null,
  };
}

/** Step 1 全部团的名单都齐了：点 Completed（G33）。共享、持久化；任何一团名单变了后端自动清掉。 */
export async function markGuestListsDone(date: string): Promise<void> {
  const form = new FormData();
  form.append("date", date);
  await apiFetch(`${API}/manifests/complete`, { method: "POST", body: form });
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

/**
 * Step 1 的名单从主 Manifest 同步（后端 G35，Annie 2026-10-12）：打开 / 重读排车页、换天时先调它，再读卡片。
 * 名单没变后端什么都不写；过去的日子不动（`synced: false`）。同步失败时的后备是 Step 1 每个团的 Upload Rezdy CSV（`previewUpload` / `applyUpload`）。
 */
export function syncManifests(date: string): Promise<DispatchSyncResult> {
  const form = new FormData();
  form.append("date", date);
  return apiFetch<DispatchSyncResult>(`${API}/manifests/sync`, {
    method: "POST",
    body: form,
  });
}

/** 一位客人在上传比对里的样子（后端 `diff_guests` 的 brief）。接客时间已经减过 15，同 manifest 页。 */
export interface UploadDiffGuest {
  order_number: string;
  name: string;
  pax: number;
  product: string;
  pickup_time: string;
  pickup_location: string;
  /** Removed：原来坐哪台车、司机标过上车 / 没来。 */
  bus_label?: string | null;
  boarding?: string | null;
  /** Removed（G65 同步留下的「已离开」）：原因。 */
  note?: string;
  /** Changed：改了什么（几句短话）。 */
  changes?: string[];
}

export interface UploadDiff {
  added: UploadDiffGuest[];
  removed: UploadDiffGuest[];
  changed: UploadDiffGuest[];
  unchanged: number;
  rows: number;
  pax: number;
  first_upload: boolean;
}

function uploadForm(date: string, manifestId: number, file: File): FormData {
  const form = new FormData();
  form.append("date", date);
  form.append("manifest_id", String(manifestId));
  form.append("file", file);
  return form;
}

/**
 * 同步失败时的后备：上传这个团从 Rezdy 下载的 CSV（后端 dbd0b12 起只收 CSV，Excel 400）。
 * 只解析、列出 Added / Removed / Changed，**不写库**。出错 400 {detail}，原样显示。
 */
export function previewUpload(
  date: string,
  manifestId: number,
  file: File,
): Promise<UploadDiff> {
  return apiFetch<UploadDiff>(`${API}/manifests/preview`, {
    method: "POST",
    body: uploadForm(date, manifestId, file),
  });
}

/** Apply：文件再传一次、服务端重新解析后替换这个团这一天的名单（同一位客人保留 Bus 和上车标记）。 */
export function applyUpload(
  date: string,
  manifestId: number,
  file: File,
): Promise<{
  ok: true;
  rows: number;
  pax: number;
  added: number;
  removed: number;
  changed: number;
}> {
  return apiFetch(`${API}/manifests/apply`, {
    method: "POST",
    body: uploadForm(date, manifestId, file),
  });
}

/**
 * Completed 之后名单又变了的单（后端 G56，Annie 2026-10-12）：只返回还没处理的。
 * Completed 之后后端不再自动分车、不清 Completed，新单留在 Not on a bus，由 staff 选车。
 */
export async function fetchPending(
  date: string,
  signal?: AbortSignal,
): Promise<DispatchPendingItem[]> {
  const r = await apiFetch<{ run_date: string; items: DispatchPendingItem[] }>(
    `${API}/pending`,
    { cache: "no-store", signal, query: { date } },
  );
  return r.items;
}

/** 标「已处理」：给 ids 就是这几条，`all` 就是这一天全部。后端记谁、几点；点过的再点不算（handled 为 0）。 */
export async function markPendingHandled(
  date: string,
  which: { ids: number[] } | { all: true },
): Promise<number> {
  const r = await apiFetch<{ ok: true; handled: number }>(
    `${API}/pending/handled`,
    { method: "POST", body: { date, ...which } },
  );
  return r.handled;
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

/**
 * 导游页的预览（后端 field/guide_home.html，按车；只读，不写库）。
 * 不在 /api 下，next.config.ts 单独转发了这一条。
 */
export function manifestGuideUrl(bus: number): string {
  return `/admin/dispatch/manifest/guide?bus=${encodeURIComponent(String(bus))}`;
}
