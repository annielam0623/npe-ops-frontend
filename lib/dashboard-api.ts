import { apiFetch } from "@/lib/api-client";
import type { UnhandledMessages } from "@/types";

/** staff 及以上可调；纯读。未登录抛 401 的 ApiError。 */
export function fetchUnhandledMessages(
  signal?: AbortSignal,
): Promise<UnhandledMessages> {
  return apiFetch<UnhandledMessages>("/api/notifications/unhandled", {
    cache: "no-store",
    signal,
  });
}
