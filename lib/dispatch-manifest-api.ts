import { apiFetch } from "@/lib/api-client";
import type {
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
 * 名单没变后端什么都不写；过去的日子不动（`synced: false`）。ops 不再上传 Rezdy CSV（旧网站保留手动上传当后备）。
 */
export function syncManifests(date: string): Promise<DispatchSyncResult> {
  const form = new FormData();
  form.append("date", date);
  return apiFetch<DispatchSyncResult>(`${API}/manifests/sync`, {
    method: "POST",
    body: form,
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

/**
 * 导游页的预览（后端 field/guide_home.html，按车；只读，不写库）。
 * 不在 /api 下，next.config.ts 单独转发了这一条。
 */
export function manifestGuideUrl(bus: number): string {
  return `/admin/dispatch/manifest/guide?bus=${encodeURIComponent(String(bus))}`;
}
