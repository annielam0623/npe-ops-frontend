"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { byTick } from "@/lib/by-tick";
import { usePermissions } from "@/lib/staff-permissions";
import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { usePageVisibility } from "@/lib/page-visibility";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import {
  fetchTemplateSettings,
  previewTixPrepare,
  saveTemplateSetting,
  type TemplateSetting,
} from "@/lib/template-settings-api";
import { cn } from "@/lib/utils";

import {
  BC_BUILTIN,
  BC_SLOTS,
  type BroadcastSet,
  bcBodyKey,
  bcSigKey,
  bcTitleKey,
  FO_SAMPLE,
  fillFarmOut,
  fillSample,
  foKey,
  parseFoKey,
  PICKUP_ORDER_AFTER,
  PREP_STEPS,
  prepKey,
  TC_EMAIL_FIELDS,
  TC_GLOBAL_FIELDS,
  TC_LM_EMAIL_FIELDS,
  TC_SMS_FIELDS,
  TC_TOURS,
  tcGuestFields,
  type TextField,
  TIX_EMAIL_FIELDS,
  TIX_GLOBAL_FIELDS,
  TIX_SMS_FIELDS,
  TIX_TOURS,
  tixGuestFields,
} from "./fields";
import { FarmOutNoticePanel } from "./farm-out-notice";
import {
  ShuttlePanel,
  useShuttleData,
  shuttleInitialValues,
} from "./shuttle-panel";
import { ShuttlePreview } from "./shuttle-preview";
import {
  SHUTTLE_HOW_TO,
  SHUTTLE_TABS,
  ShuttleHold,
  sharedMissing,
  type ShuttleTab,
} from "./shuttle-products-panel";
import {
  BroadcastSlotCard,
  LinesCard,
  PickupOrderCard,
  PrepStepsCard,
  type Studio,
  TextFieldCard,
} from "./studio-cards";
import {
  TEAM_TABS,
  TeamMessagesPanel,
  TeamMessagesPreview,
  type TeamTab,
} from "./team-messages";
import { TixTourPicker } from "./tix-tour-picker";

type Module = "tc" | "tix" | "bc" | "fo" | "shuttle" | "team";

/** 票的图标：线条图标，浅灰色（Annie 2026-10-16：不要红色的 🎟️ 表情符号）。 */
function TicketIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="30"
      height="30"
      fill="none"
      stroke="#cbd5e1"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </svg>
  );
}

const MODULES: {
  key: Module;
  icon: ReactNode;
  title: string;
  tag: string;
  text: string;
  tabs: string[];
  /** 首页大卡片的强调色（同旧页面 .cs-big-btn.tc / .tix / .bc）。 */
  accent: string;
}[] = [
  {
    key: "tc",
    icon: "🗓️",
    title: "Tour Confirmation",
    tag: "Bus Tours",
    text: "Manage the confirmation email sent to guests, SMS reminder, and the guest confirmation page. Affects bus tour products only.",
    tabs: ["Global", "Email", "Last Minute Email", "SMS", "Guest Page"],
    accent: "#22c55e",
  },
  {
    key: "tix",
    icon: <TicketIcon />,
    title: "Tickets Reminder",
    tag: "Self-Drive",
    text: "Manage the reminder email, SMS, and self-drive guest reconfirmation page. Affects Antelope Canyon ticket products only.",
    tabs: ["Global", "Email", "SMS", "Guest Page"],
    accent: "#6d5bd0",
  },
  {
    key: "bc",
    icon: "📣",
    title: "Broadcasting",
    tag: "SMS / Email",
    text: "Manage the broadcast message templates used from the Tour and Tickets tracking pages, plus the signature appended to each broadcast.",
    tabs: ["Tour", "Tickets"],
    accent: "#f97316",
  },
  {
    key: "fo",
    icon: "⇄",
    title: "Farm out Notice",
    tag: "Partners",
    text: "Manage the notice sent to guests whose tour is farmed out to a partner. Each partner has its own version. The notice never names the partner.",
    tabs: ["Email", "SMS"],
    accent: "#ffffff",
  },
  {
    key: "shuttle",
    icon: "🚐",
    title: "Shuttle",
    tag: "SMS / Email / Guest Page",
    text: "Manage the shuttle confirmation text: one shared SMS, email and guest page for all routes, plus extra details for each route.",
    // 两层（Annie 2026-10-27「动手」）：Email / SMS / Guest Page 是公共部分，Routes 是每条线的追加（同 Tickets 分标签）。
    // 后端还是旧版（接口 404）时回到旧的路线面板，标签栏不显示（见下面 tabs）。
    tabs: [...SHUTTLE_TABS],
    accent: "#0ea5e9",
  },
  {
    // G228（Annie 2026-10-30「23 全按推荐 动手」，第 4 题 A：一张卡放全部）。发给我们自己人和合作方的，跟上面给客人的分开。
    key: "team",
    icon: "🧑‍✈️",
    title: "Team Messages",
    tag: "SMS / Email",
    text: "Manage the texts we send to our own team and partners: the driver and guide texts from Dispatch, the lunch update to restaurants, and the schedule emails.",
    tabs: [...TEAM_TABS],
    accent: "#eab308",
  },
];

/** 所有出现在页面上的字段（找标签、给预览用）。 */
function allFields(): Map<string, TextField> {
  const m = new Map<string, TextField>();
  for (const f of [
    ...TC_GLOBAL_FIELDS,
    ...TC_EMAIL_FIELDS,
    ...TC_LM_EMAIL_FIELDS,
    ...TC_SMS_FIELDS,
    ...TIX_GLOBAL_FIELDS,
    ...TIX_EMAIL_FIELDS,
    ...TIX_SMS_FIELDS,
  ]) {
    if (!m.has(f.key)) m.set(f.key, f);
  }
  return m;
}
const FIELD_INDEX = allFields();

export function ContentStudioView() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "forbidden" }
    | { kind: "error"; message: string }
    | { kind: "ready" }
  >({ kind: "loading" });
  const [saved, setSaved] = useState<Record<string, TemplateSetting>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** 同步的草稿副本：同一次点击里先改再存（例如删除群发模板）也能读到新值。 */
  const draftsRef = useRef<Record<string, string>>({});
  const [me, setMe] = useState("");
  const [module, setModule] = useState<Module | null>(null);
  const [tab, setTab] = useState(0);
  const [tcTour, setTcTour] = useState<string>(TC_TOURS[0].key);
  const [tixTour, setTixTour] = useState<string>(TIX_TOURS[0].key);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<BroadcastSet, number>>({
    tour: 0,
    tix: 0,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [shuttleSel, setShuttleSel] = useState<string | null>(null);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);
  // Shuttle 模块有开关（content_studio_shuttle，默认只 admin / Super Admin，Annie 2026-10-25）。
  const pageVisibility = usePageVisibility(redirectToLogin);
  const modules = MODULES.filter(
    (m) =>
      m.key !== "shuttle" || pageVisibility.visible("content_studio_shuttle"),
  );
  const shuttle = useShuttleData(module === "shuttle", redirectToLogin);

  // 全部按照勾选（Annie 2026-10-30 置顶 10c）：开关开着按勾（settings.content，同后端接口），关着照旧；Super Admin 全过。
  const tickPerms = usePermissions();
  const tickPermsRef = useRef(tickPerms);
  tickPermsRef.current = tickPerms;
  useEffect(() => {
    // 权限读完再判断（开关开着时要按勾）。
    if (!tickPerms.ready) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    (async () => {
      try {
        const user = await fetchCurrentUser(controller.signal);
        if (
          !byTick(tickPermsRef.current, "settings.content", {
            legacy: user.is_admin,
            superAdmin: !!user.is_superadmin,
          })
        ) {
          setState({ kind: "forbidden" });
          return;
        }
        setMe(user.username);
        const rows = await fetchTemplateSettings(controller.signal);
        const map = Object.fromEntries(rows.map((r) => [r.key, r]));
        setSaved(map);
        const d = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
        draftsRef.current = d;
        setDrafts(d);
        setState({ kind: "ready" });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin, tickPerms.ready, tickPerms.active]);

  const studio: Studio = useMemo(
    () => ({
      saved,
      draft: (k) => drafts[k] ?? saved[k]?.value ?? "",
      savedValue: (k) => saved[k]?.value ?? "",
      setDraft: (k, v) => {
        draftsRef.current = { ...draftsRef.current, [k]: v };
        setDrafts(draftsRef.current);
      },
      setActive,
      save: async (keys) => {
        const ok: string[] = [];
        const failed: { key: string; message: string }[] = [];
        // 依次存（同旧页面的群发保存）；一个失败继续存其余的，结果里写明哪些没存上。
        for (const key of keys) {
          const value = draftsRef.current[key] ?? "";
          try {
            await saveTemplateSetting(key, value);
            ok.push(key);
            setSaved((s) => ({
              ...s,
              [key]: {
                ...(s[key] ?? { key, label: null }),
                value,
                updated_by: me,
                updated_at: new Date().toISOString(),
              },
            }));
          } catch (error) {
            if (isStatus(error, 401)) {
              redirectToLogin();
              return { ok, failed: [{ key, message: "Signed out" }] };
            }
            failed.push({ key, message: describeError(error) });
          }
        }
        return { ok, failed };
      },
    }),
    [saved, drafts, me, redirectToLogin],
  );
  // Shuttle 的 key 有些是打开 Shuttle 时 GET 才建的：读到以后把值补进已存值和草稿（已有的不动）。
  useEffect(() => {
    if (shuttle.state.kind !== "ready") return;
    const init = shuttleInitialValues(shuttle.state.data);
    setSaved((s) => {
      const add = Object.entries(init).filter(([k]) => !(k in s));
      if (!add.length) return s;
      return {
        ...s,
        ...Object.fromEntries(
          add.map(([key, value]) => [
            key,
            { key, value, label: null, updated_at: null, updated_by: null },
          ]),
        ),
      };
    });
    const add = Object.entries(init).filter(([k]) => !(k in draftsRef.current));
    if (add.length) {
      draftsRef.current = { ...draftsRef.current, ...Object.fromEntries(add) };
      setDrafts(draftsRef.current);
    }
  }, [shuttle.state]);

  const dirtyCount = Object.keys(drafts).filter(
    (k) => drafts[k] !== (saved[k]?.value ?? ""),
  ).length;
  // 有没存的改动时离开页面先提醒（旧页面没有）。
  useEffect(() => {
    if (!dirtyCount) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  useLeaveGuard(
    dirtyCount > 0,
    "You have unsaved changes in Content Studio. Leave without saving?",
  );

  if (state.kind !== "ready") {
    return (
      <Shell>
        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800 night:text-white/90">
              Admin access required
            </p>
          </Panel>
        ) : state.kind === "error" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Could not load the templates: {state.message}
          </ErrorBanner>
        ) : (
          <div className="py-5 text-[13px] text-[#888] night:text-white/55">
            Loading…
          </div>
        )}
      </Shell>
    );
  }

  const mod = MODULES.find((m) => m.key === module);
  const shuttleReady = shuttle.state.kind === "ready" ? shuttle.state : null;
  // Shuttle 的标签只在两层接口读到以后才有（旧的路线面板没有标签）。
  const tabs = module === "shuttle" && !shuttleReady ? [] : (mod?.tabs ?? []);
  const tabName = tabs[tab];
  const shuttleRoutes = shuttleReady
    ? shuttleReady.data.groups.flatMap((g) => g.products)
    : [];
  const shuttleRoute =
    shuttleRoutes.find((p) => p.product_code === shuttleSel) ??
    shuttleRoutes[0] ??
    null;

  return (
    <Shell
      dirtyCount={dirtyCount}
      preview={
        module === "team" ? (
          <TeamMessagesPreview tab={tabName as TeamTab} studio={studio} />
        ) : module === "shuttle" && shuttleReady ? (
          <ShuttlePreview
            tab={tabName as ShuttleTab}
            data={shuttleReady.data}
            studio={studio}
            route={shuttleRoute}
          />
        ) : (
          <Preview
            studio={studio}
            module={module}
            active={active}
            tixTour={
              module === "tix" && tabName === "Guest Page" ? tixTour : null
            }
            onUnauthorized={redirectToLogin}
          />
        )
      }
    >
      {!mod ? (
        <>
          <div className="mb-5 text-[12px] leading-[1.6] text-[#888] night:text-white/55">
            Select a module to edit its text content — emails, SMS messages, and
            guest-facing pages.
          </div>
          {/* .cs-home：深色半透明大卡片，每个模块一种强调色（同旧页面 / Dashboard）。 */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            {modules.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setModule(m.key);
                  setTab(0);
                  setActive(null);
                  // 每次打开模块 Global 都是收起的（同旧页面）。
                  setGlobalOpen(false);
                }}
                style={{ "--ac": m.accent } as CSSProperties}
                className="relative w-full cursor-pointer overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--ac)_38%,rgba(255,255,255,0.08))] bg-white/[.032] px-5 py-[22px] text-left transition-[border-color,box-shadow,transform,background] duration-200 before:pointer-events-none before:absolute before:inset-[-1px] before:bg-[radial-gradient(circle_at_18%_0%,color-mix(in_srgb,var(--ac)_20%,transparent),transparent_52%)] before:opacity-0 before:transition-opacity before:content-[''] hover:-translate-y-0.5 hover:border-[var(--ac)] hover:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--ac)_8%,transparent),rgba(255,255,255,0.025))] hover:shadow-[0_0_36px_color-mix(in_srgb,var(--ac)_20%,transparent)] hover:before:opacity-100 active:scale-[.98]"
              >
                <span className="mb-3.5 block text-[30px]">{m.icon}</span>
                <span className="mb-[7px] block text-[16px] font-bold text-[#f8fafc]">
                  {m.title}
                </span>
                <span className="block text-[12px] leading-[1.65] text-white/50">
                  {m.text}
                </span>
                <span className="mt-4 flex items-center justify-between">
                  <span className="rounded-full border border-[color-mix(in_srgb,var(--ac)_38%,transparent)] bg-[color-mix(in_srgb,var(--ac)_12%,transparent)] px-2.5 py-[3px] text-[10px] font-semibold text-[var(--ac)]">
                    {m.tag}
                  </span>
                  <span className="text-[15px] text-white/[.38]">→</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* .cs-breadcrumb：文字从「← Back {模块名}」改成「← All modules」（2026-10-16），
              跟顶栏下面导航条的「← Back」（离开整个页面）撞了字面，但这个按钮其实是收回模块网格、不离开页面——
              两个功能不一样，改文字消歧义，位置 / 样式 / 功能都不变。 */}
          <button
            type="button"
            onClick={() => setModule(null)}
            className="mb-4 flex cursor-pointer items-center gap-1.5 text-[12px] text-[#888] hover:text-white night:text-white/55"
          >
            ← All modules
          </button>

          {module === "shuttle" && shuttleReady ? (
            <ShuttleHold missing={sharedMissing(shuttleReady.data, studio)} />
          ) : null}
          {/* .cs-sub-tabs */}
          {tabs.length ? (
            <div
              role="tablist"
              className="mb-[18px] flex border-b border-black/10 night:border-white/10"
            >
              {tabs.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === i}
                  onClick={() => {
                    setTab(i);
                    setActive(null);
                  }}
                  className={cn(
                    "-mb-px cursor-pointer border-b-2 px-[18px] py-[7px] text-[13px] font-medium hover:text-white",
                    tab === i
                      ? "border-white text-white"
                      : "border-transparent text-[#888] night:text-white/55",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}

          {module === "team" ? (
            <TeamMessagesPanel tab={tabName as TeamTab} studio={studio} />
          ) : null}
          {module !== "bc" && module !== "team" && tabName === "Global" ? (
            <section>
              {/* .global-toggle-bar */}
              <button
                type="button"
                aria-expanded={globalOpen}
                onClick={() => setGlobalOpen((o) => !o)}
                className="flex w-full cursor-pointer items-center justify-between rounded-[8px] border-[1.5px] border-[#fca5a5] bg-[#fff5f5] px-3 py-2 text-left select-none night:border-red-500/30 night:bg-red-500/10"
              >
                <span className="text-[12px] font-bold text-[#dc2626] night:text-red-300">
                  ⚠ Global — applies to ALL {mod.title} tours
                </span>
                <span
                  aria-hidden
                  className="text-[18px] leading-none font-bold text-[#dc2626] night:text-red-300"
                >
                  {globalOpen ? "−" : "+"}
                </span>
              </button>
              {globalOpen ? (
                <div className="pt-2">
                  <div className="mb-2.5 rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-[7px] text-[11px] text-[#dc2626] night:border-red-500/30 night:bg-red-500/10 night:text-red-300">
                    Changes here apply to all tours. Edit carefully.
                  </div>
                  {(module === "tc" ? TC_GLOBAL_FIELDS : TIX_GLOBAL_FIELDS).map(
                    (f) => (
                      <FieldBlock
                        key={f.key}
                        field={f}
                        studio={studio}
                        global
                        after={module === "tc" && f.key === PICKUP_ORDER_AFTER}
                      />
                    ),
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {(module === "tc" &&
            (tabName === "Email" ||
              tabName === "Last Minute Email" ||
              tabName === "SMS")) ||
          (module === "tix" && (tabName === "Email" || tabName === "SMS")) ? (
            <div className={GROUP_TITLE_CLASS}>Global — all products</div>
          ) : null}
          {module === "tc" && tabName === "Email"
            ? TC_EMAIL_FIELDS.map((f) => (
                <FieldBlock key={f.key} field={f} studio={studio} global />
              ))
            : null}
          {module === "tc" && tabName === "Last Minute Email"
            ? TC_LM_EMAIL_FIELDS.map((f) => (
                <FieldBlock key={f.key} field={f} studio={studio} global />
              ))
            : null}
          {module === "tc" && tabName === "SMS"
            ? TC_SMS_FIELDS.map((f) => (
                <FieldBlock key={f.key} field={f} studio={studio} global />
              ))
            : null}
          {module === "tc" && tabName === "Guest Page" ? (
            <>
              <div className="mb-2 text-[13px] font-bold text-[#3a8c45]">
                Tour Confirmation
              </div>
              <div className={SECTION_HINT_CLASS}>
                Select a tour to edit. Changes only apply to the selected tour.
                To apply a change to all tours, edit the Global section above.
              </div>
              <TourPills
                tours={TC_TOURS}
                value={tcTour}
                onChange={setTcTour}
                activeClass="border-[#3a8c45] bg-[#3a8c45] text-white"
              />
              {tcGuestFields(tcTour).map((f) => (
                <FieldBlock key={f.key} field={f} studio={studio} />
              ))}
            </>
          ) : null}
          {module === "tix" && tabName === "Email"
            ? TIX_EMAIL_FIELDS.map((f) => (
                <FieldBlock key={f.key} field={f} studio={studio} global />
              ))
            : null}
          {module === "tix" && tabName === "SMS"
            ? TIX_SMS_FIELDS.map((f) => (
                <FieldBlock key={f.key} field={f} studio={studio} global />
              ))
            : null}
          {module === "tix" && tabName === "Guest Page" ? (
            <>
              <div className="mb-2 text-[13px] font-bold text-[#c07830]">
                Tickets Reminder
              </div>
              <div className={SECTION_HINT_CLASS}>
                Select a tour to edit. Changes only apply to the selected tour.
                To apply a change to all tours, edit the Global section above.
              </div>
              <TixTourPicker
                value={tixTour}
                onChange={setTixTour}
                onUnauthorized={redirectToLogin}
              />
              {tixGuestFields(tixTour).map((f) => (
                <FieldBlock key={f.key} field={f} studio={studio} />
              ))}
              <PrepStepsCard key={tixTour} tour={tixTour} studio={studio} />
            </>
          ) : null}
          {module === "fo" && (tabName === "Email" || tabName === "SMS") ? (
            <FarmOutNoticePanel
              studio={studio}
              tab={tabName}
              onUnauthorized={redirectToLogin}
            />
          ) : null}
          {module === "bc" ? (
            <BroadcastPanel
              set={tab === 0 ? "tour" : "tix"}
              studio={studio}
              revealed={revealed[tab === 0 ? "tour" : "tix"]}
              onReveal={(n) =>
                setRevealed((r) => ({
                  ...r,
                  [tab === 0 ? "tour" : "tix"]: n,
                }))
              }
            />
          ) : null}
          {module === "shuttle" ? (
            <>
              <ShuttlePanel
                state={shuttle.state}
                onRetry={shuttle.reload}
                tab={(tabName as ShuttleTab | undefined) ?? "Email"}
                studio={studio}
                selected={shuttleRoute?.product_code ?? null}
                onSelect={setShuttleSel}
                onUnauthorized={redirectToLogin}
              />
              {shuttleReady ? (
                <HowToUse title="How to use — Shuttle" items={SHUTTLE_HOW_TO} />
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Shell>
  );
}

/** .field-group-title */
const GROUP_TITLE_CLASS =
  "mb-2.5 text-[10px] font-bold tracking-[0.07em] text-[#9B8F88] night:text-white/50 uppercase";
/** .product-section-hint */
const SECTION_HINT_CLASS =
  "mb-3 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65";

function FieldBlock({
  field,
  studio,
  global = false,
  after = false,
}: {
  field: TextField;
  studio: Studio;
  global?: boolean;
  after?: boolean;
}) {
  return (
    <>
      {field.type === "dynamic_lines" ? (
        <LinesCard field={field} studio={studio} global={global} />
      ) : (
        <TextFieldCard field={field} studio={studio} global={global} />
      )}
      {after ? <PickupOrderCard studio={studio} /> : null}
    </>
  );
}

/** .tour-selector / .tour-pill */
function TourPills({
  tours,
  value,
  onChange,
  activeClass,
}: {
  tours: readonly { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
  activeClass: string;
}) {
  return (
    <div
      role="group"
      aria-label="Tour"
      className="mb-3.5 flex flex-wrap items-start gap-1.5"
    >
      {tours.map((t) => (
        <button
          key={t.key}
          type="button"
          aria-pressed={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "cursor-pointer rounded-[20px] border px-[11px] py-1 text-[11px] font-medium transition-all",
            value === t.key
              ? activeClass
              : "border-black/15 bg-paper text-[#1a1a1a] hover:border-[#1a1a1a] hover:text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/75 night:hover:border-white/40 night:hover:text-white/90",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function BroadcastPanel({
  set,
  studio,
  revealed,
  onReveal,
}: {
  set: BroadcastSet;
  studio: Studio;
  revealed: number;
  onReveal: (n: number) => void;
}) {
  // 显示到「最后一个有内容的槽位」和「点过 + Add template 的槽位」里较大的那个（标题或正文有内容都算）。
  let lastFilled = BC_BUILTIN;
  for (let i = BC_BUILTIN + 1; i <= BC_SLOTS; i++) {
    if (
      studio.savedValue(bcTitleKey(set, i)).trim() ||
      studio.savedValue(bcBodyKey(set, i)) ||
      studio.draft(bcTitleKey(set, i)) ||
      studio.draft(bcBodyKey(set, i))
    ) {
      lastFilled = i;
    }
  }
  const upTo = Math.min(BC_SLOTS, Math.max(lastFilled, revealed));
  const name = set === "tour" ? "Tour" : "Tickets";
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h3 className={cn(GROUP_TITLE_CLASS, "m-0")}>
          {name} broadcast templates
        </h3>
        {upTo < BC_SLOTS ? (
          <button
            type="button"
            onClick={() => onReveal(upTo + 1)}
            className="cursor-pointer rounded-[7px] border border-[#d0d0d0] bg-paper px-3 py-[5px] text-[12px] text-[#1a1a1a] hover:border-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90 night:hover:border-white/40"
          >
            + Add template
          </button>
        ) : (
          <span className="text-[11px] text-[#888] night:text-white/55">
            Max {BC_SLOTS} templates. Contact admin to add more.
          </span>
        )}
      </div>
      {Array.from({ length: upTo }, (_, i) => (
        <BroadcastSlotCard
          key={`${set}-${i + 1}`}
          set={set}
          index={i + 1}
          studio={studio}
        />
      ))}
      <div className="h-1" />
      <TextFieldCard
        field={{
          key: bcSigKey(set),
          label: "✍ Signature",
          rows: 2,
          hint: `Appended to the end of every ${name} broadcast.`,
        }}
        studio={studio}
      />
    </>
  );
}

/**
 * 预览：当前编辑的字段填上示例数据后的样子；短信显示成气泡；门票客人页的「准备」框用后端真实渲染。
 * （旧页面的邮件 / 客人页整版模拟预览没有搬过来。）
 */
function Preview({
  studio,
  module,
  active,
  tixTour,
  onUnauthorized,
}: {
  studio: Studio;
  module: Module | null;
  active: string | null;
  tixTour: string | null;
  onUnauthorized: () => void;
}) {
  const field = active ? FIELD_INDEX.get(active) : undefined;
  const fo = active ? parseFoKey(active) : null;
  const isSms =
    !!field?.sms ||
    !!active?.startsWith("tmpl__bcast__") ||
    fo?.field === "sms_body";
  const text = active ? studio.draft(active) : "";
  const [html, setHtml] = useState<string | null>(null);
  // Farm out 预览：这个团没有 PLEASE NOTE 时那一行整行不显示。
  const [noNote, setNoNote] = useState(false);
  const foSample = noNote ? { ...FO_SAMPLE, "{please_note}": "" } : FO_SAMPLE;
  const prepKeys = tixTour
    ? Array.from({ length: PREP_STEPS }, (_, i) =>
        (["label", "url", "note"] as const).map((p) =>
          prepKey(tixTour, i + 1, p),
        ),
      ).flat()
    : [];
  const overridesKey = JSON.stringify(prepKeys.map((k) => studio.draft(k)));
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    if (!tixTour) {
      setHtml(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      previewTixPrepare({
        tourType: tixTour,
        overrides: Object.fromEntries(
          prepKeys.map((k) => [k, studio.draft(k)]),
        ),
        activeKey: active,
        signal: controller.signal,
      })
        .then((h) => setHtml(h.includes("gf-prepare-box") ? h : null))
        .catch((e: unknown) => {
          if (isStatus(e, 401)) onUnauthorizedRef.current();
          else if (!controller.signal.aborted) setHtml(null);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // 只在门票、准备步骤的内容或当前字段变化时重拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tixTour, overridesKey, active]);

  if (!module) {
    return (
      <aside className="py-10 text-center text-[12px] text-[#1a1a1a] night:text-white/35">
        Select a module to see preview
      </aside>
    );
  }
  if (module === "shuttle") {
    // Shuttle 没有 Preview（后端两份实现文档刻意不做）：还没有发送逻辑，没有真实渲染规则可预览；
    // FIELD_INDEX 也没收 shuttle 的键，硬套通用预览只会显示错的标签 / 判错 SMS 气泡，不如直接说清楚。
    return (
      <aside className="py-10 text-center text-[12px] text-[#1a1a1a] night:text-white/35">
        No preview for Shuttle yet — this module only stores the text; sending
        is a separate, later feature.
      </aside>
    );
  }

  return (
    <aside className="flex flex-col gap-2">
      {active ? (
        <>
          <p className="text-[11px] font-semibold text-[#1a1a1a] night:text-white/65">
            {fo
              ? `Farm out Notice — ${fo.field === "sms_body" ? "SMS" : "Email"} · ${fo.slug === "default" ? "Default" : fo.slug}`
              : (field?.label ?? active)}
          </p>
          {fo ? (
            <label className="flex items-center gap-1.5 text-[11px] text-[#1a1a1a] night:text-white/65">
              <input
                type="checkbox"
                checked={!noNote}
                onChange={(e) => setNoNote(!e.target.checked)}
              />
              Tour has a PLEASE NOTE
            </label>
          ) : null}
          {isSms ? (
            // .sms-phone / .sms-screen / .sms-bubble
            <div className="mx-auto w-full max-w-[260px] rounded-[14px] bg-[#1a1a2e] px-3 py-[18px]">
              <div className="min-h-[160px] rounded-[10px] bg-[#f2f2f7] px-2.5 py-3">
                <div className="mb-2 text-center text-[10px] text-[#1a1a1a]">
                  National Park Express
                </div>
                <div className="rounded-[14px_14px_14px_4px] bg-[#e5e5ea] px-3 py-[9px] text-[12px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap text-[#1a1a1a] night:text-white/90">
                  {(fo ? fillFarmOut(text, foSample) : fillSample(text)) || (
                    <i className="text-[#1a1a1a]">(empty)</i>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[10px] bg-paper px-4 py-3 text-[13px] leading-[1.7] [overflow-wrap:anywhere] whitespace-pre-wrap text-[#24364f] night:bg-white/[.04] night:text-white/90">
              {fo ? (
                <div className="mb-2 border-b border-black/10 pb-2 text-[12px] night:border-white/10">
                  Subject:{" "}
                  <b>
                    {fillFarmOut(
                      studio.draft(foKey(fo.slug, "email_subject")),
                      foSample,
                    )}
                  </b>
                </div>
              ) : null}
              <span className="rounded-[3px] bg-[#fffbcc] px-0.5 night:bg-amber-400/10">
                {(fo
                  ? fillFarmOut(
                      fo.field === "email_subject"
                        ? studio.draft(foKey(fo.slug, "email_body"))
                        : text,
                      foSample,
                    )
                  : fillSample(text)) || (
                  <i className="text-[#1a1a1a] night:text-white/35">
                    (empty — nothing is shown to the guest)
                  </i>
                )}
              </span>
            </div>
          )}
          <p className="text-[11px] text-[#1a1a1a] night:text-white/50">
            {fo
              ? "Variables are filled with sample data (West Rim, Bellagio, Thursday, October 16, …)."
              : "Variables are filled with sample data (Sarah, January 10, 2026, …)."}
          </p>
        </>
      ) : (
        <p className="py-10 text-center text-[12px] text-[#1a1a1a] night:text-white/35">
          Click a box to preview it.
        </p>
      )}
      {html ? (
        <>
          <p className="mt-2 text-[11px] font-semibold text-[#1a1a1a] night:text-white/65">
            Guest page — Prepare for Your Tour (real rendering)
          </p>
          <iframe
            title="Prepare preview"
            sandbox=""
            srcDoc={html}
            className="h-72 w-full rounded-[10px] border border-black/10 bg-paper night:border-white/10 night:bg-white/[.04]"
          />
        </>
      ) : null}
    </aside>
  );
}

function Shell({
  children,
  dirtyCount = 0,
  preview,
}: {
  children: ReactNode;
  dirtyCount?: number;
  preview?: ReactNode;
}) {
  return (
    // .studio-layout：左右分栏铺满内容区（抵消外框的内边距），各自滚动。
    <main className="-m-4 flex h-[calc(100vh-64px)] overflow-hidden text-stone-800 sm:-m-7 night:text-white/90">
      {/* .studio-editor */}
      <div className="w-[55%] min-w-[380px] overflow-y-auto border-r border-black/[.08] px-6 py-5 night:border-white/10">
        {/* 只有 ops 有：线上生效的提醒和未保存计数（旧页面没有这一行）。 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#94a3b8] night:text-white/45">
          <span>
            ⚠️ Every Save changes the live text right away: the next email, SMS
            or guest page uses it. Saved text cannot be recovered.
          </span>
          {dirtyCount ? (
            <span className="font-semibold text-[#fbbf24]">
              {dirtyCount} unsaved change(s)
            </span>
          ) : null}
        </div>
        {children}
        <HowToUse
          title="How to use — Content Studio"
          items={HOW_TO_ITEMS}
          warning={
            <>
              Cards marked ⚠ Global change the text for every tour.
              <br />
              ⚠️ Save turns to Error: nothing was saved, click Save again.
              <br />
              ⚠️ Check-in minutes before tour time (Tickets, Guest Page tab) is
              not guest text. It sets the Check-in Time worked out when a Rezdy
              CSV is uploaded for that tour.
              <br />
              ⚠️ Shuttle: the Email, SMS and Guest Page tabs are shared by every
              shuttle route. The next shuttle confirmation sent from Manifests
              uses them.
            </>
          }
        />
        <div className="mt-4">
          <ActionLogPanel
            refreshKey={0}
            reloadOnOpen
            load={(before, signal) =>
              fetchActionLog(
                "/api/template-settings/action-log",
                before,
                signal,
              )
            }
          />
        </div>
      </div>
      {/* .studio-preview */}
      <div className="flex w-[45%] flex-col overflow-y-auto bg-[#e8e4de] night:bg-white/[.03]">
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-black/[.08] bg-[#e8e4de] px-4 py-2.5 night:border-white/10 night:bg-[#0b1724]">
          <span className="text-[11px] font-semibold tracking-[0.07em] text-[#1a1a1a] uppercase night:text-white/50">
            Preview
          </span>
          <span className="rounded-[4px] bg-black/5 px-2 py-0.5 text-[10px] text-[#1a1a1a] night:bg-white/[.06] night:text-white/40">
            Preview only — not actual rendering
          </span>
        </div>
        <div className="flex-1 p-4">{preview}</div>
      </div>
    </main>
  );
}

const HOW_TO_ITEMS = [
  "Click a module, then a tab (Global, Email, SMS, Guest Page …).",
  "Click in a box and type. The Preview on the right updates as you type.",
  "Keep the { } variables such as {name}; add one with the buttons after Insert:.",
  "Click Save on the card. A green ✓ Saved next to the button means it is stored; unsaved changes are lost when you leave.",
  "Cancel only undoes changes you have not saved.",
  "Team Messages: texts to drivers, guides, restaurants and staff. Driver and guide texts must fit in one SMS with the link filled in, keep exactly one {link}, and use plain characters only. Subjects, the texts and link text can't be empty; the other lines can be left empty to drop them.",
];
