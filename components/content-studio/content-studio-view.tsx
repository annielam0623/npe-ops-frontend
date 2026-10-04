"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
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
  fillSample,
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
import {
  BroadcastSlotCard,
  LinesCard,
  PickupOrderCard,
  PrepStepsCard,
  type Studio,
  TextFieldCard,
} from "./studio-cards";

type Module = "tc" | "tix" | "bc";

const MODULES: {
  key: Module;
  icon: string;
  title: string;
  tag: string;
  text: string;
  tabs: string[];
}[] = [
  {
    key: "tc",
    icon: "🗓️",
    title: "Tour Confirmation",
    tag: "Bus Tours",
    text: "Manage the confirmation email sent to guests, SMS reminder, and the guest confirmation page. Affects bus tour products only.",
    tabs: ["Email", "Last Minute Email", "SMS", "Guest Page"],
  },
  {
    key: "tix",
    icon: "🎟️",
    title: "Tickets Reminder",
    tag: "Self-Drive",
    text: "Manage the reminder email, SMS, and self-drive guest reconfirmation page. Affects Antelope Canyon ticket products only.",
    tabs: ["Email", "SMS", "Guest Page"],
  },
  {
    key: "bc",
    icon: "📣",
    title: "Broadcasting",
    tag: "SMS / Email",
    text: "Manage the broadcast message templates used from the Tour and Tickets tracking pages, plus the signature appended to each broadcast.",
    tabs: ["Tour", "Tickets"],
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
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    (async () => {
      try {
        const user = await fetchCurrentUser(controller.signal);
        if (!user.is_admin) {
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
  }, [reloadKey, redirectToLogin]);

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

  if (state.kind !== "ready") {
    return (
      <Shell>
        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Admin access required</p>
          </Panel>
        ) : state.kind === "error" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Could not load the templates: {state.message}
          </ErrorBanner>
        ) : (
          <Panel>Loading…</Panel>
        )}
      </Shell>
    );
  }

  const mod = MODULES.find((m) => m.key === module);
  const tabName = mod?.tabs[tab];

  return (
    <Shell dirtyCount={dirtyCount}>
      <HowToUse />
      {!mod ? (
        <>
          <p className="text-sm text-stone-600">
            Select a module to edit its text content — emails, SMS messages, and
            guest-facing pages.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {MODULES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setModule(m.key);
                  setTab(0);
                  setActive(null);
                }}
                className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white px-4 py-4 text-left hover:border-stone-400"
              >
                <span className="text-lg font-semibold text-stone-900">
                  {m.icon} {m.title}
                </span>
                <span className="self-start rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                  {m.tag}
                </span>
                <span className="text-sm text-stone-600">{m.text}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setModule(null)}
              className="text-sm text-stone-500 hover:text-stone-800"
            >
              ← Back
            </button>
            <h2 className="text-lg font-semibold text-stone-900">
              {mod.icon} {mod.title}
            </h2>
          </div>

          {module !== "bc" ? (
            <section className="rounded-lg border border-red-300 bg-red-50">
              <button
                type="button"
                aria-expanded={globalOpen}
                onClick={() => setGlobalOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold text-red-800"
              >
                ⚠ Global — applies to ALL {mod.title} tours
                <span aria-hidden>{globalOpen ? "−" : "+"}</span>
              </button>
              {globalOpen ? (
                <div className="flex flex-col gap-3 border-t border-red-200 px-4 py-3">
                  <p className="text-xs text-red-700">
                    Changes here apply to all tours. Edit carefully.
                  </p>
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

          <div
            role="tablist"
            className="flex flex-wrap gap-1 border-b border-stone-300"
          >
            {mod.tabs.map((t, i) => (
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
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                  tab === i
                    ? "border-stone-900 text-stone-900"
                    : "border-transparent text-stone-500 hover:text-stone-800",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[55%_1fr]">
            <div className="flex flex-col gap-3">
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
                  <p className="text-xs text-stone-500">
                    Select a tour to edit. Changes only apply to the selected
                    tour. To apply a change to all tours, edit the Global
                    section above.
                  </p>
                  <TourPills
                    tours={TC_TOURS}
                    value={tcTour}
                    onChange={setTcTour}
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
                  <p className="text-xs text-stone-500">
                    Select a tour to edit. Changes only apply to the selected
                    tour. To apply a change to all tours, edit the Global
                    section above.
                  </p>
                  <TourPills
                    tours={TIX_TOURS}
                    value={tixTour}
                    onChange={setTixTour}
                  />
                  {tixGuestFields(tixTour).map((f) => (
                    <FieldBlock key={f.key} field={f} studio={studio} />
                  ))}
                  <PrepStepsCard key={tixTour} tour={tixTour} studio={studio} />
                </>
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
            </div>
            <Preview
              studio={studio}
              active={active}
              tixTour={
                module === "tix" && tabName === "Guest Page" ? tixTour : null
              }
              onUnauthorized={redirectToLogin}
            />
          </div>
        </>
      )}
    </Shell>
  );
}

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

function TourPills({
  tours,
  value,
  onChange,
}: {
  tours: readonly { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div role="group" aria-label="Tour" className="flex flex-wrap gap-1.5">
      {tours.map((t) => (
        <button
          key={t.key}
          type="button"
          aria-pressed={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            value === t.key
              ? "border-stone-800 bg-stone-800 text-white"
              : "border-stone-300 bg-white text-stone-700",
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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">
          {name} broadcast templates
        </h3>
        {upTo < BC_SLOTS ? (
          <button
            type="button"
            onClick={() => onReveal(upTo + 1)}
            className="text-xs font-semibold text-sky-700"
          >
            + Add template
          </button>
        ) : (
          <span className="text-xs text-stone-500">
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
  active,
  tixTour,
  onUnauthorized,
}: {
  studio: Studio;
  active: string | null;
  tixTour: string | null;
  onUnauthorized: () => void;
}) {
  const field = active ? FIELD_INDEX.get(active) : undefined;
  const isSms = !!field?.sms || !!active?.startsWith("tmpl__bcast__");
  const text = active ? studio.draft(active) : "";
  const [html, setHtml] = useState<string | null>(null);
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

  return (
    <aside className="flex flex-col gap-2 self-start rounded-lg border border-stone-200 bg-white px-4 py-3 lg:sticky lg:top-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">Preview</h3>
        <span className="text-xs text-stone-400">
          Preview only — not actual rendering
        </span>
      </div>
      {active ? (
        <>
          <p className="text-xs text-stone-500">{field?.label ?? active}</p>
          {isSms ? (
            <div className="max-w-xs self-start rounded-2xl rounded-bl-sm bg-stone-100 px-3 py-2 text-sm whitespace-pre-wrap text-stone-800">
              {fillSample(text) || <i className="text-stone-400">(empty)</i>}
            </div>
          ) : (
            <div className="rounded-md bg-yellow-50 px-3 py-2 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-stone-800">
              {fillSample(text) || (
                <i className="text-stone-400">
                  (empty — nothing is shown to the guest)
                </i>
              )}
            </div>
          )}
          <p className="text-[11px] text-stone-400">
            Variables are filled with sample data (Sarah, January 10, 2026, …).
          </p>
        </>
      ) : (
        <p className="text-sm text-stone-500">Click a box to preview it.</p>
      )}
      {html ? (
        <>
          <p className="mt-2 text-xs font-semibold text-stone-600">
            Guest page — Prepare for Your Tour (real rendering)
          </p>
          <iframe
            title="Prepare preview"
            sandbox=""
            srcDoc={html}
            className="h-72 w-full rounded border border-stone-200"
          />
        </>
      ) : null}
    </aside>
  );
}

function Shell({
  children,
  dirtyCount = 0,
}: {
  children: ReactNode;
  dirtyCount?: number;
}) {
  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              Settings
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">
              Content Studio
            </h1>
          </div>
          {dirtyCount ? (
            <span className="text-xs font-semibold text-amber-700">
              {dirtyCount} unsaved change(s)
            </span>
          ) : null}
        </header>
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠️ Every Save changes the live text right away: the next email, SMS or
          guest page uses it. Saved text cannot be recovered.
        </p>
        {children}
      </div>
    </main>
  );
}

function HowToUse() {
  return (
    <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-3 text-sm leading-relaxed text-stone-700">
      <summary className="cursor-pointer font-semibold text-sky-900">
        📖 How to use — Content Studio
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Click a module, then a tab (Global, Email, SMS, Guest Page …).</li>
        <li>
          Click in a box and type. The Preview on the right updates as you type.
        </li>
        <li>
          Keep the {"{ }"} variables such as {"{name}"}; add one with the
          buttons after Insert:.
        </li>
        <li>
          Click Save on the card. Saved ✓ means it is stored; unsaved changes
          are lost when you leave.
        </li>
        <li>Cancel only undoes changes you have not saved.</li>
      </ol>
      <p className="mt-2">
        ⚠️ Cards marked ⚠ Global change the text for every tour.
      </p>
      <p>⚠️ Save turns to Error: nothing was saved, click Save again.</p>
    </details>
  );
}
