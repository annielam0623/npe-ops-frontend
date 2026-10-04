"use client";

import { useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchManifestSetup,
  saveManifestCounters,
  saveManifestGroup,
  saveManifestSection,
} from "@/lib/products-api";
import { cn } from "@/lib/utils";
import type {
  ManifestSectionKind,
  ManifestSetup,
  ManifestSetupGroup,
  ManifestSetupProduct,
} from "@/types";

const DEFAULT_GREY = "#c8cdd3";

const INPUT =
  "h-8 rounded-md border border-stone-300 bg-white px-2 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:opacity-60";
const BUTTON =
  "h-8 rounded-md border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50";

/** 计数框的编辑草稿：Seats 按输入框原样保存，由后端校验。 */
interface CounterDraft {
  key: number;
  label: string;
  match_text: string;
  seats: string;
}

/**
 * Manifest setup：每个巴士团印出来的 manifest 长什么样（顶栏颜色、午餐单那一行、底部计数框、各产品的节）。
 * 改了下一次打开 / 打印 manifest 就生效。
 */
export function ManifestSetupPanel({
  version,
  onUnauthorized,
}: {
  /** 商品换了组时 +1：重拉，产品清单不过时。 */
  version: number;
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<ManifestSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    fetchManifestSetup(controller.signal)
      .then((d) => {
        setData(d);
        setLoadError(null);
        setGroupId((current) =>
          current !== null && d.groups.some((g) => g.id === current)
            ? current
            : (d.groups[0]?.id ?? null),
        );
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        setLoadError(describeError(e));
      });
    return () => controller.abort();
  }, [version]);

  const group = data?.groups.find((g) => g.id === groupId) ?? null;

  function replaceGroup(next: ManifestSetupGroup) {
    setData((d) =>
      d
        ? { ...d, groups: d.groups.map((g) => (g.id === next.id ? next : g)) }
        : d,
    );
  }

  /** 保存失败：401 跳登录，其余把原因显示在面板顶上（输入框由调用方改回原值）。 */
  function fail(e: unknown) {
    if (isStatus(e, 401)) {
      onUnauthorizedRef.current();
      return;
    }
    setError(describeError(e));
  }

  return (
    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-stone-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-stone-900">Manifest setup</h2>
        {data && data.groups.length ? (
          <select
            aria-label="Tour group"
            value={groupId ?? ""}
            onChange={(event) => {
              setGroupId(Number(event.target.value));
              setError(null);
            }}
            className={INPUT}
          >
            {data.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.display_name}
                {g.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        ) : null}
        <span className="text-xs text-stone-500">
          How the printed bus manifest looks for this tour.
        </span>
        {error || loadError ? (
          <span role="alert" className="text-sm text-red-700">
            {error ?? `Could not load: ${loadError}`}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-5 px-4 py-4">
        {!data ? (
          loadError ? null : (
            <span className="text-sm text-stone-500">Loading…</span>
          )
        ) : !group ? (
          <span className="text-sm text-stone-500">No bus tour groups.</span>
        ) : (
          <GroupEditor
            key={group.id}
            group={group}
            setup={data}
            onGroupChange={replaceGroup}
            onStart={() => setError(null)}
            onFail={fail}
          />
        )}
      </div>
    </section>
  );
}

function useSavedFlag(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [
    saved,
    () => {
      setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 2000);
    },
  ];
}

function Saved({ show }: { show: boolean }) {
  return show ? (
    <span className="text-xs font-semibold text-emerald-700">Saved</span>
  ) : null;
}

let counterKey = 0;
const toDrafts = (g: ManifestSetupGroup): CounterDraft[] =>
  g.counters.map((c) => ({
    key: ++counterKey,
    label: c.label,
    match_text: c.match_text,
    seats: c.seats === null ? "" : String(c.seats),
  }));

function GroupEditor({
  group,
  setup,
  onGroupChange,
  onStart,
  onFail,
}: {
  group: ManifestSetupGroup;
  setup: ManifestSetup;
  onGroupChange: (g: ManifestSetupGroup) => void;
  onStart: () => void;
  onFail: (e: unknown) => void;
}) {
  const savedColor = group.manifest_color || DEFAULT_GREY;
  const savedLunch = group.manifest_lunch_note ?? "";
  const [color, setColor] = useState(savedColor);
  const [lunch, setLunch] = useState(savedLunch);
  const [groupSaved, flagGroupSaved] = useSavedFlag();
  const [counters, setCounters] = useState<CounterDraft[]>(() =>
    toDrafts(group),
  );
  const [countersSaving, setCountersSaving] = useState(false);
  const [countersSaved, flagCountersSaved] = useSavedFlag();
  const colorRef = useRef<HTMLInputElement>(null);

  async function saveGroup(next: { color: string; lunch_note: string }) {
    onStart();
    try {
      const d = await saveManifestGroup(group.id, next);
      onGroupChange({
        ...group,
        manifest_color: d.manifest_color,
        manifest_lunch_note: d.manifest_lunch_note,
      });
      setColor(d.manifest_color || DEFAULT_GREY);
      setLunch(d.manifest_lunch_note ?? "");
      flagGroupSaved();
    } catch (e) {
      // 失败改回已保存的值（旧页面不改回，看起来像存上了）。
      setColor(savedColor);
      setLunch(savedLunch);
      onFail(e);
    }
  }

  // 取色器拖动时不停触发 input；只在选定（原生 change）时保存，同旧页面。
  const saveGroupRef = useRef(saveGroup);
  saveGroupRef.current = saveGroup;
  const lunchRef = useRef(lunch);
  lunchRef.current = lunch;
  useEffect(() => {
    const el = colorRef.current;
    if (!el) return;
    const onChange = () =>
      void saveGroupRef.current({ color: el.value, lunch_note: savedLunch });
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [savedLunch]);

  async function saveCounters() {
    onStart();
    setCountersSaving(true);
    try {
      const d = await saveManifestCounters(
        group.id,
        counters.map((c) => ({
          label: c.label,
          match_text: c.match_text,
          seats: c.seats.trim() === "" ? null : c.seats.trim(),
        })),
      );
      const next = { ...group, counters: d.counters };
      onGroupChange(next);
      setCounters(toDrafts(next));
      flagCountersSaved();
    } catch (e) {
      onFail(e);
    } finally {
      setCountersSaving(false);
    }
  }

  // 有没改完没存的计数框（Remove / Add 之后也要点 Save boxes 才算数）。
  const comparable = (list: CounterDraft[]) =>
    JSON.stringify(list.map((c) => [c.label, c.match_text, c.seats]));
  const countersDirty = comparable(counters) !== comparable(toDrafts(group));

  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
          Colour
          <input
            ref={colorRef}
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-8 w-14 rounded-md border border-stone-300 bg-white px-0.5"
          />
        </label>
        <span
          className="inline-flex h-8 items-center rounded px-3.5 text-sm font-extrabold"
          style={{ background: color }}
        >
          {group.display_name}
        </span>
        <button
          type="button"
          className={BUTTON}
          onClick={() => void saveGroup({ color: "", lunch_note: savedLunch })}
        >
          Use default grey
        </button>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs font-semibold text-stone-600">
          Lunch sheet line (leave empty = no lunch sheet)
          <input
            type="text"
            value={lunch}
            maxLength={300}
            placeholder="(TEXT) POC: name phone ..."
            onChange={(event) => setLunch(event.target.value)}
            onBlur={() => {
              if (lunchRef.current !== savedLunch) {
                void saveGroup({
                  color: group.manifest_color ?? "",
                  lunch_note: lunchRef.current,
                });
              }
            }}
            className={cn(INPUT, "w-full font-normal")}
          />
        </label>
        <Saved show={groupSaved} />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-stone-800">
          Boxes at the bottom of the manifest
        </h3>
        <p className="text-xs text-stone-500">
          Each box counts the guests whose ticket (Quantities) contains the
          word. Seats is optional: with it the manifest also shows &ldquo;…
          SEATS LEFT&rdquo;.
        </p>
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-500">
                <th className="px-1.5 py-1 font-semibold">Box name</th>
                <th className="px-1.5 py-1 font-semibold">Ticket word</th>
                <th className="px-1.5 py-1 font-semibold">Seats</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {counters.map((c) => {
                const set = (patch: Partial<CounterDraft>) =>
                  setCounters((list) =>
                    list.map((x) => (x.key === c.key ? { ...x, ...patch } : x)),
                  );
                return (
                  <tr key={c.key}>
                    <td className="px-1.5 py-1">
                      <input
                        type="text"
                        aria-label="Box name"
                        value={c.label}
                        maxLength={40}
                        placeholder="HELI"
                        onChange={(event) => set({ label: event.target.value })}
                        className={INPUT}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        type="text"
                        aria-label="Ticket word"
                        value={c.match_text}
                        maxLength={60}
                        placeholder="Heli"
                        onChange={(event) =>
                          set({ match_text: event.target.value })
                        }
                        className={INPUT}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        type="number"
                        aria-label="Seats"
                        value={c.seats}
                        min={1}
                        max={999}
                        onChange={(event) => set({ seats: event.target.value })}
                        className={cn(INPUT, "w-20")}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <button
                        type="button"
                        className={BUTTON}
                        onClick={() =>
                          setCounters((list) =>
                            list.filter((x) => x.key !== c.key),
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={BUTTON}
            onClick={() =>
              setCounters((list) => [
                ...list,
                { key: ++counterKey, label: "", match_text: "", seats: "" },
              ])
            }
          >
            Add box
          </button>
          <button
            type="button"
            disabled={countersSaving}
            onClick={() => void saveCounters()}
            className="h-8 rounded-md bg-blue-500 px-3 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {countersSaving ? "Saving…" : "Save boxes"}
          </button>
          <Saved show={countersSaved} />
          {countersDirty && !countersSaving ? (
            <span className="text-xs text-amber-700">
              Not saved yet — click Save boxes.
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-stone-800">
          Sections on the manifest
        </h3>
        <p className="text-xs text-stone-500">
          Leave Section empty and the guests go into {setup.default_section}.
          Fill it only for a part that should be its own section (for example
          LOWER KEN&rsquo;S 1:00PM) or a shuttle (pick Shuttle outbound /
          inbound). It saves when you leave the box.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                <th className="px-1.5 py-1 font-semibold">
                  Product (from Rezdy)
                </th>
                <th className="px-1.5 py-1 font-semibold">Code</th>
                <th className="px-1.5 py-1 font-semibold">Section</th>
                <th className="px-1.5 py-1 font-semibold">Type</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {group.products.map((p) => (
                <SectionRow
                  key={p.id}
                  product={p}
                  setup={setup}
                  onSaved={(next) =>
                    onGroupChange({
                      ...group,
                      products: group.products.map((x) =>
                        x.id === next.id ? next : x,
                      ),
                    })
                  }
                  onStart={onStart}
                  onFail={onFail}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs leading-relaxed text-sky-950">
        <summary className="cursor-pointer font-semibold text-sky-800">
          📖 How to use — Manifest setup
        </summary>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>Pick the tour at the top of this box.</li>
          <li>
            Colour: pick a colour for the top bar of this tour&rsquo;s manifest.
            It saves right away. Use default grey removes it.
          </li>
          <li>
            Lunch sheet line: the contact line printed at the bottom of the
            lunch sheet (for example Bee&rsquo;s). Leave it empty and this tour
            prints no lunch sheet.
          </li>
          <li>
            Boxes at the bottom: click Add box, type the box name and the ticket
            word, add Seats if it has its own seat limit, then click Save boxes.
          </li>
          <li>
            Sections: type a section name next to a product only when it should
            be its own section, and pick Shuttle outbound or Shuttle inbound for
            shuttles. Every product of an agent (Canyontours.com, Gray Line …)
            needs the same name.
          </li>
          <li>
            Changes show on the next manifest you open or print. Seats come from
            Settings → Vehicles.
          </li>
        </ol>
      </details>
    </>
  );
}

function SectionRow({
  product: p,
  setup,
  onSaved,
  onStart,
  onFail,
}: {
  product: ManifestSetupProduct;
  setup: ManifestSetup;
  onSaved: (p: ManifestSetupProduct) => void;
  onStart: () => void;
  onFail: (e: unknown) => void;
}) {
  const [section, setSection] = useState(p.manifest_section);
  const [kind, setKind] = useState<ManifestSectionKind>(
    p.manifest_section_kind,
  );
  const [saved, flagSaved] = useSavedFlag();

  async function save(nextSection: string, nextKind: ManifestSectionKind) {
    if (
      nextSection === p.manifest_section &&
      nextKind === p.manifest_section_kind
    ) {
      return;
    }
    onStart();
    try {
      const d = await saveManifestSection(p.id, {
        section: nextSection,
        kind: nextKind,
      });
      setSection(d.section);
      setKind(d.kind);
      onSaved({
        ...p,
        manifest_section: d.section,
        manifest_section_kind: d.kind,
      });
      flagSaved();
    } catch (e) {
      setSection(p.manifest_section);
      setKind(p.manifest_section_kind);
      onFail(e);
    }
  }

  return (
    <tr
      className={cn(
        "border-b border-stone-100",
        !p.is_active && "text-stone-400",
      )}
    >
      <td className="min-w-72 px-1.5 py-1">
        {p.product_name}
        {p.internal_name ? (
          <span className="text-xs text-stone-500"> ({p.internal_name})</span>
        ) : null}
      </td>
      <td className="px-1.5 py-1 font-mono text-xs">{p.product_code}</td>
      <td className="px-1.5 py-1">
        <input
          type="text"
          aria-label={`Section for ${p.product_code}`}
          value={section}
          maxLength={60}
          placeholder={setup.default_section}
          onChange={(event) => setSection(event.target.value)}
          onBlur={() => void save(section, kind)}
          className={cn(INPUT, "w-72")}
        />
      </td>
      <td className="px-1.5 py-1">
        <select
          aria-label={`Type for ${p.product_code}`}
          value={kind}
          onChange={(event) => {
            const next = event.target.value as ManifestSectionKind;
            setKind(next);
            void save(section, next);
          }}
          className={INPUT}
        >
          {setup.kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-1.5 py-1">
        <Saved show={saved} />
      </td>
    </tr>
  );
}
