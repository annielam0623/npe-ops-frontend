"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type { ActionFailure } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import {
  LEGACY_CANCEL_BUTTON_CLASS,
  LEGACY_ERROR_CLASS,
  LEGACY_SAVE_BUTTON_CLASS,
} from "@/components/teams/legacy-styles";
import { InviteLinkField } from "@/components/users/invite-dialog";
import { ModalCloseButton } from "@/components/users/modal-close-button";
import {
  createTeamAccount,
  createTeamInvite,
  fetchTeamMember,
  saveTeamMember,
} from "@/lib/team-permissions-api";
import { buildInviteUrl } from "@/lib/users-api";
import { cn } from "@/lib/utils";
import type { TeamCatalog, TeamMemberUser, TeamSelection } from "@/types";

import {
  ACCESS_NOTES,
  buildAccessGroups,
  LEVEL_OPTIONS,
  levelOf,
  summarize,
  withLevel,
  type AccessGroup,
  type AccessRow,
  type AccessSummary,
} from "./access";
import { HOME_PAGES, ITEM_NOTES, memberName } from "./config";
import { TeamChip } from "./team-chip";

export type MemberFormMode =
  { kind: "edit"; member: TeamMemberUser } | { kind: "add" };

interface MemberFormDialogProps {
  mode: MemberFormMode;
  catalog: TeamCatalog;
  /** 「照某个人复制」的下拉：除自己以外、已注册的人。 */
  members: TeamMemberUser[];
  /** 各人的档位合计（下拉里写「N modules」）；还没拿到的人不写。 */
  summaries?: ReadonlyMap<number, AccessSummary>;
  /** 保存 / 建号成功（建邀请成功时在显示链接之后、按 Done 关闭前就调用，列表先刷新出待注册行）。 */
  onSaved: () => void;
  onClose: () => void;
  /** 把错误转成弹窗里显示的原因；401 时由页面跳登录。 */
  toFailure: (error: unknown) => ActionFailure;
}

interface FormState {
  items: Set<string>;
  duties: Set<string>;
  teamIds: Set<number>;
  home: string;
}

type SignIn = "invite" | "create";

const SECTION_TITLE_CLASS = "m-0 text-[14px] font-bold text-[#1a1a1a]";
const AUX_CLASS = "text-[12px] text-[#4b5563]";
const SMALL_BUTTON_CLASS =
  "cursor-pointer rounded-[6px] border border-[#e5e7eb] bg-[#f3f4f6] px-3 py-1.5 text-[12px] font-medium whitespace-nowrap text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-60";
const INPUT_CLASS =
  "box-border w-full rounded-[8px] border border-[#ddd] bg-paper px-3 py-2 text-[14px] text-black";

function toggled<T>(set: Set<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}

/** 后端没给（或给了不认识的）就不算：只保留 catalog 里有的权限项。 */
function knownItems(catalog: TeamCatalog, codes: readonly string[]) {
  const known = new Set(
    catalog.modules.flatMap((m) => m.items.map((i) => i.code)),
  );
  return new Set(codes.filter((c) => known.has(c)));
}

export function MemberFormDialog({
  mode,
  catalog,
  members,
  summaries,
  onSaved,
  onClose,
  toFailure,
}: MemberFormDialogProps) {
  const titleId = useId();
  const groups = useMemo(
    () => buildAccessGroups(catalog.modules),
    [catalog.modules],
  );
  const itemNames = useMemo(
    () =>
      new Map(
        catalog.modules.flatMap((m) =>
          m.items.map((i) => [i.code, i.display_name] as const),
        ),
      ),
    [catalog.modules],
  );
  const wiredModules = useMemo(
    () => new Set(catalog.modules.filter((m) => m.wired).map((m) => m.code)),
    [catalog.modules],
  );
  const isAdd = mode.kind === "add";
  const editId = mode.kind === "edit" ? mode.member.id : null;
  const defaultItems = catalog.default_items ?? null;

  const [form, setForm] = useState<FormState | null>(() =>
    isAdd
      ? {
          items: knownItems(catalog, defaultItems ?? []),
          duties: new Set(),
          teamIds: new Set(),
          home: "",
        }
      : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [copyFrom, setCopyFrom] = useState("");
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [signIn, setSignIn] = useState<SignIn>("invite");
  const [account, setAccount] = useState({
    username: "",
    password: "",
    displayName: "",
    initials: "",
    email: "",
  });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  // 编辑：先拿这个人的完整勾选（列表里只有条数）。
  useEffect(() => {
    if (editId === null) {
      return;
    }
    const controller = new AbortController();
    fetchTeamMember(editId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setForm({
            items: knownItems(catalog, detail.items),
            duties: new Set(detail.duties),
            teamIds: new Set(detail.team_ids),
            home: detail.home_path ?? "",
          });
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          const failure = toFailure(err);
          if (failure.status === "error") {
            setLoadError(failure.message);
          }
        }
      });
    return () => controller.abort();
  }, [editId, catalog, toFailure]);

  const copyCandidates = members.filter(
    (m) => !m.pending_invite && m.id !== editId,
  );

  async function handleCopy() {
    const source = copyCandidates.find((m) => String(m.id) === copyFrom);
    if (!source || !form || copying) {
      return;
    }
    setCopying(true);
    setCopyMessage(null);
    setError(null);
    try {
      const detail = await fetchTeamMember(source.id);
      // superadmin 那边的勾选不一定写全（她在代码里永远通过），复制她就是全部。
      const items = detail.is_superadmin
        ? knownItems(
            catalog,
            catalog.modules.flatMap((m) => m.items.map((i) => i.code)),
          )
        : knownItems(catalog, detail.items);
      setForm((prev) => (prev ? { ...prev, items } : prev));
      setCopyMessage(
        `Copied access for ${summarize(groups, items).modules} modules from ${memberName(source)}. Nothing is saved until you click ${isAdd ? "Create" : "Save"}.`,
      );
    } catch (err) {
      const failure = toFailure(err);
      if (failure.status === "error") {
        setError(`Could not copy: ${failure.message}`);
      }
    } finally {
      setCopying(false);
    }
  }

  function selection(state: FormState): TeamSelection {
    return {
      items: [...state.items].sort(),
      duties: [...state.duties].sort(),
      team_ids: [...state.teamIds].sort((a, b) => a - b),
      home_path: state.home || null,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving) {
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (mode.kind === "edit") {
        await saveTeamMember(mode.member.id, selection(form));
        onSaved();
        return;
      }
      if (signIn === "invite") {
        const { invite_token: token } = await createTeamInvite(selection(form));
        setInviteUrl(buildInviteUrl(token));
        setSaving(false);
        onSaved();
        return;
      }
      await createTeamAccount({
        ...selection(form),
        username: account.username.trim(),
        password: account.password,
        initials: account.initials.trim(),
        display_name: account.displayName.trim() || null,
        email: account.email.trim() || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      const failure = toFailure(err);
      if (failure.status === "error") {
        setError(failure.message);
        setSaving(false);
      }
    }
  }

  const title = isAdd ? "Add person" : `Edit ${memberName(mode.member)}`;
  const meta = isAdd
    ? "New back-office account"
    : [
        `@${mode.member.username}`,
        mode.member.email,
        mode.member.pending_invite
          ? "Pending invite"
          : mode.member.can_login
            ? "Can sign in"
            : "Cannot sign in",
      ]
        .filter(Boolean)
        .join(" · ");
  const submitLabel = !isAdd
    ? "Save"
    : signIn === "invite"
      ? "Create invite link"
      : "Create account";

  return (
    <Modal
      titleId={titleId}
      onDismiss={saving ? undefined : onClose}
      panelClassName="relative flex max-h-[88vh] max-w-[880px] flex-col !rounded-[14px] !shadow-[0_20px_60px_rgba(0,0,0,.2)] text-[#1a1a2e]"
    >
      <ModalCloseButton onClick={onClose} disabled={saving} />
      <div className="border-b border-[#e5e7eb] px-[26px] pt-[22px] pb-3">
        <h2 id={titleId} className="m-0 text-[18px] font-bold text-[#1a1a1a]">
          {title}
        </h2>
        <p className="m-0 mt-1 text-[12.5px] break-words text-[#4b5563]">
          {meta}
        </p>
      </div>

      {inviteUrl ? (
        <>
          <div className="px-[26px] py-5">
            <InviteLinkField url={inviteUrl} />
            <p className="mt-2 text-[12px] text-[#4b5563]">
              Their access is already saved and apply when they finish signing
              up.
            </p>
          </div>
          <div className="flex justify-end border-t border-[#e5e7eb] px-[26px] py-3.5">
            <button
              type="button"
              autoFocus
              onClick={onClose}
              className={LEGACY_CANCEL_BUTTON_CLASS}
            >
              Done
            </button>
          </div>
        </>
      ) : (
        <form
          noValidate
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* 正文在框里滚动，滚动条要看得见（preview 同款）。 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-[26px] pt-4 pb-5 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-[#f1f2f4] [&::-webkit-scrollbar-thumb]:bg-[#b6bcc6] [&::-webkit-scrollbar-track]:bg-[#f1f2f4]">
            {loadError ? (
              <p role="alert" className={LEGACY_ERROR_CLASS}>
                Failed to load: {loadError}
              </p>
            ) : !form ? (
              <p className="text-[13px] text-[#4b5563]">Loading…</p>
            ) : (
              <div className="flex flex-col gap-[18px]">
                {isAdd ? (
                  <SignInSection
                    signIn={signIn}
                    onSignIn={setSignIn}
                    account={account}
                    onAccount={setAccount}
                  />
                ) : null}

                <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2.5">
                  <label
                    htmlFor={`${titleId}-copy`}
                    className="text-[13px] font-semibold"
                  >
                    Copy access from
                  </label>
                  <select
                    id={`${titleId}-copy`}
                    value={copyFrom}
                    onChange={(e) => setCopyFrom(e.target.value)}
                    className="max-w-full rounded-[8px] border border-[#ddd] bg-paper px-2.5 py-1.5 text-[14px] text-black"
                  >
                    <option value="">Choose a person…</option>
                    {copyCandidates.map((m) => (
                      <option key={m.id} value={m.id}>
                        {memberName(m)}
                        {m.is_superadmin
                          ? " (Super Admin, all modules)"
                          : summaries?.has(m.id)
                            ? ` (${summaries.get(m.id)?.modules} modules)`
                            : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!copyFrom || copying}
                    className={SMALL_BUTTON_CLASS}
                  >
                    {copying ? "Copying…" : "Copy"}
                  </button>
                  {copyMessage ? (
                    <span className="w-full text-[12px] text-[#166534]">
                      {copyMessage}
                    </span>
                  ) : null}
                </div>

                <ItemNamesContext.Provider value={itemNames}>
                  <AccessSection
                    groups={groups}
                    wiredModules={wiredModules}
                    items={form.items}
                    open={open}
                    onOpen={setOpen}
                    onItems={(items) => setForm({ ...form, items })}
                    note={
                      isAdd && defaultItems === null
                        ? "The default staff set is not available yet. Pick someone in Copy access from, or choose by hand."
                        : null
                    }
                  />
                </ItemNamesContext.Provider>

                <Section
                  title="Notification duties"
                  aux="Notified when this kind of thing happens"
                >
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-[18px] gap-y-1.5">
                    {catalog.duties.map((duty) => (
                      <label
                        key={duty.code}
                        className="flex cursor-pointer items-center gap-2 text-[13px]"
                        title={duty.description ?? undefined}
                      >
                        <input
                          type="checkbox"
                          checked={form.duties.has(duty.code)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              duties: toggled(
                                form.duties,
                                duty.code,
                                e.target.checked,
                              ),
                            })
                          }
                        />
                        {duty.display_name}
                      </label>
                    ))}
                  </div>
                </Section>

                <Section title="Teams" aux="For messages only, no permissions">
                  {catalog.teams.length === 0 ? (
                    <p className="m-0 text-[13px] text-[#4b5563]">
                      No teams yet. Create one in Settings › Teams first.
                    </p>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-[18px] gap-y-1.5">
                      {catalog.teams.map((team) => (
                        <label
                          key={team.id}
                          className="flex cursor-pointer items-center gap-2 text-[13px]"
                        >
                          <input
                            type="checkbox"
                            checked={form.teamIds.has(team.id)}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                teamIds: toggled(
                                  form.teamIds,
                                  team.id,
                                  e.target.checked,
                                ),
                              })
                            }
                          />
                          <TeamChip team={team} />
                        </label>
                      ))}
                    </div>
                  )}
                </Section>

                <Section
                  title="Home page"
                  aux="The page they see after signing in"
                >
                  <select
                    aria-label="Home page"
                    value={form.home}
                    onChange={(e) => setForm({ ...form, home: e.target.value })}
                    className="max-w-full rounded-[8px] border border-[#ddd] bg-paper px-2.5 py-2 text-[14px] text-black"
                  >
                    {HOME_PAGES.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.label}
                      </option>
                    ))}
                    {form.home &&
                    !HOME_PAGES.some((p) => p.path === form.home) ? (
                      <option value={form.home}>{form.home}</option>
                    ) : null}
                  </select>
                </Section>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#e5e7eb] px-[26px] py-3.5">
            <span className="text-[12.5px] text-[#4b5563]">
              {form
                ? `${summarize(groups, form.items).modules} modules · ${form.duties.size} duties · ${form.teamIds.size} teams`
                : ""}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              {error ? (
                <p role="alert" className={cn(LEGACY_ERROR_CLASS, "m-0")}>
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className={LEGACY_CANCEL_BUTTON_CLASS}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form}
                className={LEGACY_SAVE_BUTTON_CLASS}
              >
                {saving ? "Saving…" : submitLabel}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Section({
  title,
  aux,
  children,
}: {
  title: string;
  aux?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2.5">
        <h3 className={SECTION_TITLE_CLASS}>{title}</h3>
        {aux ? <div className={AUX_CLASS}>{aux}</div> : null}
      </div>
      {children}
    </section>
  );
}

function SignInSection({
  signIn,
  onSignIn,
  account,
  onAccount,
}: {
  signIn: SignIn;
  onSignIn: (value: SignIn) => void;
  account: {
    username: string;
    password: string;
    displayName: string;
    initials: string;
    email: string;
  };
  onAccount: (value: typeof account) => void;
}) {
  const id = useId();
  const options: { value: SignIn; label: string }[] = [
    { value: "invite", label: "Send an invite link" },
    { value: "create", label: "Create the account now" },
  ];
  const fields: { key: keyof typeof account; label: string; type: string }[] = [
    { key: "username", label: "Username", type: "text" },
    { key: "password", label: "Password", type: "password" },
    { key: "displayName", label: "Display name (optional)", type: "text" },
    { key: "initials", label: "Initials (optional)", type: "text" },
    { key: "email", label: "Email (optional)", type: "email" },
  ];
  return (
    <Section title="How will they sign in?">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-[8px] border px-3 py-2 text-[13px]",
              signIn === o.value
                ? "border-[#1f4e79] bg-[#f0f6fc]"
                : "border-[#e5e7eb]",
            )}
          >
            <input
              type="radio"
              name={`${id}-signin`}
              checked={signIn === o.value}
              onChange={() => onSignIn(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      {signIn === "invite" ? (
        <p className="m-0 mt-1.5 text-[12px] text-[#4b5563]">
          They open the link and choose their own username and password. Until
          then their row shows Pending invite.
        </p>
      ) : (
        <>
          <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-2.5">
            {fields.map((f) => (
              <div key={f.key}>
                <label
                  htmlFor={`${id}-${f.key}`}
                  className="mb-1 block text-[13px] font-semibold"
                >
                  {f.label}
                </label>
                <input
                  id={`${id}-${f.key}`}
                  type={f.type}
                  autoComplete={f.key === "password" ? "new-password" : "off"}
                  value={account[f.key]}
                  onChange={(e) =>
                    onAccount({ ...account, [f.key]: e.target.value })
                  }
                  className={INPUT_CLASS}
                />
              </div>
            ))}
          </div>
          <p className="m-0 mt-1.5 text-[12px] text-[#4b5563]">
            Username: at least 3 characters (letters, numbers, . _ -), no @.
            Password: at least 6 characters. They must change it the first time
            they sign in.
          </p>
        </>
      )}
    </Section>
  );
}

/** 项的显示名（「what's included」里用），由 MemberFormDialog 按 catalog 提供。 */
const ItemNamesContext = createContext<ReadonlyMap<string, string>>(new Map());

function useItemNames() {
  const map = useContext(ItemNamesContext);
  return (codes: readonly string[]) =>
    codes.map((c) => map.get(c) ?? c).join(", ") || "—";
}

// 选中是深灰实底，不用蓝色（蓝色只给提交键，Annie 2026-10-11）。
const SEG_CLASS =
  "cursor-pointer border-0 bg-paper px-[11px] py-[5px] text-[12.5px] whitespace-nowrap text-[#374151] [&+&]:border-l [&+&]:border-solid [&+&]:border-[#d1d5db]";
const SEG_ON_CLASS = "!bg-[#374151] font-semibold !text-white";
const SEG_NONE_ON_CLASS = "!bg-[#e5e7eb] font-semibold";
const NOT_ACTIVE_TAG = (
  <span className="rounded-[6px] border border-dashed border-[#cbd5e1] bg-[#f3f4f6] px-[7px] py-px text-[11px] font-medium text-[#6b7280]">
    Not active yet
  </span>
);

function AccessSection({
  groups,
  wiredModules,
  items,
  open,
  onOpen,
  onItems,
  note,
}: {
  groups: AccessGroup[];
  wiredModules: ReadonlySet<string>;
  items: Set<string>;
  open: Set<string>;
  onOpen: (open: Set<string>) => void;
  onItems: (items: Set<string>) => void;
  note: string | null;
}) {
  const sum = summarize(groups, items);
  const toggle = (key: string) => onOpen(toggled(open, key, !open.has(key)));
  return (
    <Section
      title="Access"
      aux={
        <span className="tabular-nums">
          {sum.modules} modules
          {sum.readOnly ? ` · ${sum.readOnly} read only` : ""}
        </span>
      }
    >
      <p className="m-0 mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#4b5563]">
        <span>
          <b className="text-[#1a1a1a]">Read only</b>: can open and look
        </span>
        <span>
          <b className="text-[#1a1a1a]">Read &amp; edit</b>: can also change,
          send, publish, export and delete
        </span>
        <span>
          <b className="text-[#1a1a1a]">Full access</b>: one switch for the
          whole page
        </span>
      </p>
      {note ? (
        <p className="m-0 mb-2 text-[12px] text-[#854d0e]">{note}</p>
      ) : null}
      <div className="overflow-hidden rounded-[10px] border border-[#e5e7eb]">
        {groups.map((group) =>
          group.kind === "row" ? (
            <AccessRowView
              key={group.key}
              row={group.rows[0]}
              notActive={!wiredModules.has(group.module)}
              items={items}
              expanded={open.has(group.key)}
              onToggle={() => toggle(group.key)}
              onItems={onItems}
            />
          ) : (
            <SettingsGroup
              key={group.key}
              group={group}
              notActive={!wiredModules.has(group.module)}
              items={items}
              open={open}
              onToggle={toggle}
              onItems={onItems}
            />
          ),
        )}
      </div>
    </Section>
  );
}

function SettingsGroup({
  group,
  notActive,
  items,
  open,
  onToggle,
  onItems,
}: {
  group: AccessGroup;
  notActive: boolean;
  items: Set<string>;
  open: Set<string>;
  onToggle: (key: string) => void;
  onItems: (items: Set<string>) => void;
}) {
  const expanded = open.has(group.key);
  const levels = group.rows.map((r) => levelOf(r, items));
  const on = levels.filter((l) => l !== "none").length;
  return (
    <div className="border-t border-[#f3f4f6] first:border-t-0">
      <button
        type="button"
        onClick={() => onToggle(group.key)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[13.5px] font-semibold text-[#1a1a2e]"
      >
        <span aria-hidden className="w-3 text-[12px] text-[#4b5563]">
          {expanded ? "▾" : "▸"}
        </span>
        {group.label}
        {notActive ? NOT_ACTIVE_TAG : null}
        <span className="text-[12px] font-normal text-[#4b5563] tabular-nums">
          {on} of {group.rows.length} pages
          {levels.includes("custom") ? " · custom" : ""}
        </span>
      </button>
      {expanded ? (
        <div className="bg-[#fafafa] pl-[18px]">
          {group.rows.map((row) => (
            <AccessRowView
              key={row.key}
              row={row}
              notActive={false}
              items={items}
              expanded={open.has(row.key)}
              onToggle={() => onToggle(row.key)}
              onItems={onItems}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AccessRowView({
  row,
  notActive,
  items,
  expanded,
  onToggle,
  onItems,
}: {
  row: AccessRow;
  notActive: boolean;
  items: Set<string>;
  expanded: boolean;
  onToggle: () => void;
  onItems: (items: Set<string>) => void;
}) {
  const level = levelOf(row, items);
  const names = useItemNames();
  const have = row.all.filter((c) => items.has(c));
  const extra = row.all.filter((c) => !row.read.includes(c));
  const notes = row.all.filter((c) => ITEM_NOTES[c]).map((c) => ITEM_NOTES[c]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 border-t border-[#f3f4f6] px-3 py-2 first:border-t-0 max-sm:grid-cols-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13.5px] font-semibold">
        {row.label}
        {notActive ? NOT_ACTIVE_TAG : null}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-normal text-[#9ca3af]"
        >
          {expanded ? "▾ hide" : "▸ what's included"}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
        {level === "custom" ? (
          <span
            title={names(have)}
            className="rounded-[6px] border border-[#fcd34d] bg-[#fef3c7] px-[7px] py-px text-[11.5px] font-semibold whitespace-nowrap text-[#92400e]"
          >
            Custom: {have.length} of {row.all.length}
          </span>
        ) : null}
        <div
          role="group"
          aria-label={`${row.label} access`}
          className="inline-flex shrink-0 overflow-hidden rounded-[8px] border border-[#d1d5db]"
        >
          {LEVEL_OPTIONS[row.kind].map((option) => {
            const on = level === option.level;
            return (
              <button
                key={option.level}
                type="button"
                aria-pressed={on}
                onClick={() => onItems(withLevel(row, option.level, items))}
                className={cn(
                  SEG_CLASS,
                  on &&
                    (option.level === "none"
                      ? SEG_NONE_ON_CLASS
                      : SEG_ON_CLASS),
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      {ACCESS_NOTES[row.key] ? (
        <p className="col-span-full m-0 text-[12px] text-[#92400e]">
          {ACCESS_NOTES[row.key]}
        </p>
      ) : null}
      {expanded ? (
        <p className="col-span-full m-0 text-[12px] leading-[1.6] text-[#4b5563]">
          {row.kind === "on-off" ? (
            <>
              <b className="text-[#1a1a1a]">Full access:</b> {names(row.all)}
            </>
          ) : (
            <>
              <b className="text-[#1a1a1a]">Read only:</b> {names(row.read)}
              <br />
              <b className="text-[#1a1a1a]">Read &amp; edit</b> adds:{" "}
              {names(extra)}
            </>
          )}
          {level === "custom" ? (
            <>
              <br />
              <b className="text-[#1a1a1a]">Now:</b> {names(have)}
            </>
          ) : null}
          {notes.map((n) => (
            <span key={n} className="block text-[#9ca3af]">
              {n}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
