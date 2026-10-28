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
  changeTeamAccountType,
  createTeamAccount,
  createTeamInvite,
  fetchTeamMember,
  saveTeamMember,
} from "@/lib/team-permissions-api";
import { buildInviteUrl } from "@/lib/users-api";
import { cn } from "@/lib/utils";
import type {
  AccountType,
  TeamCatalog,
  TeamMemberUser,
  TeamSelection,
} from "@/types";

import {
  ACCESS_NOTES,
  buildAccessGroups,
  editLockedFor,
  LEVEL_OPTIONS,
  levelOf,
  staffOnlyCodes,
  staffOnlyIn,
  summarize,
  withLevel,
  type AccessGroup,
  type AccessRow,
  type AccessSummary,
} from "./access";
import {
  HOME_PAGES,
  ITEM_NOTES,
  memberName,
  PARTNER_HOME,
  PARTNER_NOTE_CLASS,
  PARTNER_TAG_CLASS,
  supportsAccountType,
} from "./config";
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
  /** 账号类型切换成功：列表刷新那一行，编辑框不关。 */
  onAccountTypeChanged?: () => void;
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
// 同列表上 Super Admin / Partner 的小标签。
const TAG_CLASS =
  "ml-1.5 inline-block rounded-[6px] px-[7px] py-px align-middle text-[11px] font-semibold whitespace-nowrap";
// 切换账号类型的确认键：琥珀色（影响大，不是普通提交，不用蓝色）。
const AMBER_BUTTON_CLASS =
  "cursor-pointer rounded-[8px] border-0 bg-[#b45309] px-5 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";

function toggled<T>(set: Set<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}

/** partner 底部合计后面：以前勾了的发送项保存时会去掉几项（Q2 A）。 */
function removedSendText(
  items: ReadonlySet<string>,
  staffOnly: ReadonlySet<string>,
): string {
  const n = [...items].filter((c) => staffOnly.has(c)).length;
  return n
    ? ` · ${n} send permission${n === 1 ? "" : "s"} will be removed when you save`
    : "";
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
  onAccountTypeChanged,
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
  /** 发送类（只给内部员工）：partner 的档位不含它们，保存时去掉（Annie 2026-10-27）。 */
  const staffOnly = useMemo(
    () => staffOnlyCodes(catalog.modules),
    [catalog.modules],
  );
  const isAdd = mode.kind === "add";
  const editId = mode.kind === "edit" ? mode.member.id : null;
  const defaultItems = catalog.default_items ?? null;
  // 后端列表带 account_type 才出类型选项（没上线时和以前一样，请求也不带）。
  const accountTypes =
    supportsAccountType(members) ||
    (mode.kind === "edit" && mode.member.account_type !== undefined);
  const [accountType, setAccountType] = useState<AccountType>(
    mode.kind === "edit" ? (mode.member.account_type ?? "staff") : "staff",
  );
  const partner = accountType === "partner";
  /** partner 时传给档位计算的发送项；员工为 undefined（照旧）。 */
  const partnerStaffOnly = partner ? staffOnly : undefined;
  const [typeConfirm, setTypeConfirm] = useState(false);

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
        `Copied access for ${summarize(groups, items, partnerStaffOnly).modules} modules from ${memberName(source)}. Nothing is saved until you click ${isAdd ? "Create" : "Save"}.`,
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

  /**
   * 新增时换账号类型（Annie 2026-10-26 选 A）：partner 从全空白起步（用「Copy access from」复制），
   * 不要通知职责和团队，首页换成他能开的页面；换回 staff 恢复员工默认组。
   */
  function changeAccountType(next: AccountType) {
    if (next === accountType) {
      return;
    }
    setAccountType(next);
    setCopyMessage(null);
    setForm({
      items:
        next === "partner"
          ? new Set()
          : knownItems(catalog, defaultItems ?? []),
      duties: new Set(),
      teamIds: new Set(),
      home: next === "partner" ? PARTNER_HOME : "",
    });
  }

  function selection(state: FormState): TeamSelection {
    const items = [...state.items].sort();
    const home_path = state.home || null;
    // partner 不收通知、不进团队：职责根本不发（后端对 partner 的职责 400），团队存空。
    // 发送只给内部员工（Annie 2026-10-27 Q2 A）：以前勾了的，这次保存时去掉。
    if (partner) {
      return {
        items: items.filter((c) => !staffOnly.has(c)),
        team_ids: [],
        // 首页固定是 partner 首页（Q7 A），以前存的 /forecast 这次一起改掉。
        home_path: PARTNER_HOME,
      };
    }
    return {
      items,
      duties: [...state.duties].sort(),
      team_ids: [...state.teamIds].sort((a, b) => a - b),
      home_path,
    };
  }

  /** 新建 / 邀请的请求体：后端支持时才带 account_type。 */
  function newSelection(state: FormState) {
    return accountTypes
      ? { ...selection(state), account_type: accountType }
      : selection(state);
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
        const { invite_token: token } = await createTeamInvite(
          newSelection(form),
        );
        setInviteUrl(buildInviteUrl(token));
        setSaving(false);
        onSaved();
        return;
      }
      await createTeamAccount({
        ...newSelection(form),
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
    ? partner
      ? "New external partner account"
      : "New back-office account"
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
    <>
      <Modal
        titleId={titleId}
        onDismiss={saving || typeConfirm ? undefined : onClose}
        panelClassName="relative flex max-h-[88vh] max-w-[880px] flex-col !rounded-[14px] !shadow-[0_20px_60px_rgba(0,0,0,.2)] text-[#1a1a2e]"
      >
        <ModalCloseButton onClick={onClose} disabled={saving} />
        <div className="border-b border-[#e5e7eb] px-[26px] pt-[22px] pb-3">
          <h2 id={titleId} className="m-0 text-[18px] font-bold text-[#1a1a1a]">
            {title}
          </h2>
          <p className="m-0 mt-1 text-[12.5px] break-words text-[#4b5563]">
            {meta}
            {isAdd && partner ? (
              <span className={cn(TAG_CLASS, PARTNER_TAG_CLASS)}>Partner</span>
            ) : null}
          </p>
          {/* 已有账号：抬头写类型，「Change…」二次确认（Annie 2026-10-26 选 A）。 */}
          {/* Super Admin 账号后端是 "staff"、不能在这里切（403），不出 Change…。 */}
          {mode.kind === "edit" &&
          accountTypes &&
          !mode.member.is_superadmin ? (
            <p className="m-0 mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[#4b5563]">
              Account type:{" "}
              <b className="font-semibold text-[#1a1a1a]">
                {partner ? "External partner" : "Staff"}
              </b>
              {partner ? (
                <span className={cn(TAG_CLASS, "ml-0", PARTNER_TAG_CLASS)}>
                  Partner
                </span>
              ) : null}
              ·
              <button
                type="button"
                onClick={() => setTypeConfirm(true)}
                disabled={saving}
                className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-[#1f4e79] underline disabled:cursor-not-allowed"
              >
                Change…
              </button>
            </p>
          ) : null}
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
                  {isAdd && accountTypes ? (
                    <AccountTypeSection
                      value={accountType}
                      onChange={changeAccountType}
                    />
                  ) : null}
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
                      staffOnly={partnerStaffOnly}
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
                    aux={
                      partner
                        ? undefined
                        : "Notified when this kind of thing happens"
                    }
                  >
                    {/* partner：职责整块灰掉、不能点（后端对 partner 的职责 400）。 */}
                    {partner ? <NotForPartners /> : null}
                    <fieldset
                      disabled={partner}
                      aria-label="Notification duties"
                      className={cn(
                        "m-0 min-w-0 border-0 p-0",
                        partner && "mt-2 opacity-45",
                      )}
                    >
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-[18px] gap-y-1.5">
                        {catalog.duties.map((duty) => (
                          <label
                            key={duty.code}
                            className={cn(
                              "flex items-center gap-2 text-[13px]",
                              partner ? "cursor-not-allowed" : "cursor-pointer",
                            )}
                            title={duty.description ?? undefined}
                          >
                            <input
                              type="checkbox"
                              checked={!partner && form.duties.has(duty.code)}
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
                    </fieldset>
                  </Section>

                  <Section
                    title="Teams"
                    aux={
                      partner ? undefined : "For messages only, no permissions"
                    }
                  >
                    {partner ? (
                      <NotForPartners />
                    ) : catalog.teams.length === 0 ? (
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

                  {/* partner 不选首页（Q7 A）：首页固定是 partner 首页。 */}
                  {partner ? null : (
                    <Section
                      title="Home page"
                      aux="The page they see after signing in"
                    >
                      <select
                        aria-label="Home page"
                        value={form.home}
                        onChange={(e) =>
                          setForm({ ...form, home: e.target.value })
                        }
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
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#e5e7eb] px-[26px] py-3.5">
              <span className="text-[12.5px] text-[#4b5563]">
                {form
                  ? partner
                    ? `${summarize(groups, form.items, staffOnly).modules} modules${removedSendText(form.items, staffOnly)}`
                    : `${summarize(groups, form.items).modules} modules · ${form.duties.size} duties · ${form.teamIds.size} teams`
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
      {typeConfirm && mode.kind === "edit" ? (
        <AccountTypeConfirm
          member={mode.member}
          current={accountType}
          modules={form ? summarize(groups, form.items).modules : null}
          items={form?.items ?? null}
          staffOnly={staffOnly}
          itemNames={itemNames}
          onClose={() => setTypeConfirm(false)}
          onChanged={(next, saved) => {
            setAccountType(next);
            setTypeConfirm(false);
            // 员工 → partner（Q3 A）：确认框里列的发送项后端已经去掉，弹窗按返回的 items 刷新（没带就自己去掉）；改回员工不加回。
            if (next === "partner") {
              setForm((prev) =>
                prev
                  ? {
                      ...prev,
                      items: saved
                        ? knownItems(catalog, saved)
                        : new Set(
                            [...prev.items].filter((c) => !staffOnly.has(c)),
                          ),
                    }
                  : prev,
              );
            }
            onAccountTypeChanged?.();
          }}
          toFailure={toFailure}
        />
      ) : null}
    </>
  );
}

/** partner 不收通知、不进团队（Annie 2026-10-26 选 A）。 */
function NotForPartners() {
  return (
    <div className="rounded-[8px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-[12.5px] text-[#4b5563]">
      Not for external partners.
    </div>
  );
}

/** 新增人员最上面一节：Staff / External partner，默认 Staff（Annie 2026-10-26 选 A）。 */
function AccountTypeSection({
  value,
  onChange,
}: {
  value: AccountType;
  onChange: (value: AccountType) => void;
}) {
  const id = useId();
  const options: { value: AccountType; label: string }[] = [
    { value: "staff", label: "Staff" },
    { value: "partner", label: "External partner" },
  ];
  return (
    <Section title="Account type" aux="Who is this account for?">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-[8px] border px-3 py-2 text-[13px]",
              value !== o.value
                ? "border-[#e5e7eb]"
                : o.value === "partner"
                  ? "border-[#fdba74] bg-[#fff7ed]"
                  : "border-[#1f4e79] bg-[#f0f6fc]",
            )}
          >
            <input
              type="radio"
              name={`${id}-type`}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      {value === "partner" ? (
        <p className={cn(PARTNER_NOTE_CLASS, "m-0 mt-2")}>
          <b>External partner</b>: they can open only the pages ticked below.
          Everything else is blocked, even if someone sends them a link. They
          get no notifications and are not in any team. They&apos;ll be asked to
          change the password on first sign-in.
        </p>
      ) : (
        <p className="m-0 mt-1.5 text-[12px] text-[#4b5563]">
          A normal back-office account.
        </p>
      )}
    </Section>
  );
}

/**
 * 已有账号切换类型的二次确认（Annie 2026-10-26 选 A）。两个方向影响都大：staff → partner 马上关掉没勾的页面；
 * partner → staff 会放开所有没接线的接口。确认键调 PUT /api/team/members/{id}/account-type（后端 8a），
 * 出错照后端原话写在框里。发送只给内部员工（Annie 2026-10-27 Q3 A）：员工 → partner 时列出要去掉的发送项，
 * 确认后由后端去掉（d7 B2，返回删完的 items，弹窗用它刷新）；partner → 员工不加回，其他勾选两个方向都不动。
 */
function AccountTypeConfirm({
  member,
  current,
  modules,
  items,
  staffOnly,
  itemNames,
  onClose,
  onChanged,
  toFailure,
}: {
  member: TeamMemberUser;
  current: AccountType;
  modules: number | null;
  /** 弹窗里现在的勾选（还没拿到时 null）：列出要去掉的发送项用。 */
  items: ReadonlySet<string> | null;
  staffOnly: ReadonlySet<string>;
  itemNames: ReadonlyMap<string, string>;
  onClose: () => void;
  /** `items` = 后端返回的这个人现在的勾选（没带时 undefined）。 */
  onChanged: (next: AccountType, items?: readonly string[]) => void;
  toFailure: (error: unknown) => ActionFailure;
}) {
  const titleId = useId();
  const name = memberName(member);
  const toPartner = current === "staff";
  const next: AccountType = toPartner ? "partner" : "staff";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removing = toPartner
    ? [...(items ?? [])].filter((c) => staffOnly.has(c)).sort()
    : [];

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      // 后端 d7（B2）：切成 partner 时服务器已删掉发送勾，返回的 items 是删完的。
      const { member: updated } = await changeTeamAccountType(member.id, next);
      onChanged(updated.account_type ?? next, updated.items);
    } catch (err) {
      const failure = toFailure(err);
      if (failure.status === "error") {
        setError(failure.message);
        setBusy(false);
      }
    }
  }

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="relative max-w-[520px] !rounded-[14px] !shadow-[0_20px_60px_rgba(0,0,0,.2)] text-[#1a1a2e]"
    >
      <div className="border-b border-[#e5e7eb] px-[26px] pt-[22px] pb-3">
        <h2 id={titleId} className="m-0 text-[18px] font-bold text-[#1a1a1a]">
          {toPartner
            ? `Change ${name} to External partner?`
            : `Change ${name} to Staff?`}
        </h2>
        <p className="m-0 mt-1 text-[12.5px] text-[#4b5563]">
          @{member.username} ·{" "}
          {toPartner ? "Staff → External partner" : "External partner → Staff"}
        </p>
      </div>
      <div className="px-[26px] py-4 text-[13.5px]">
        {toPartner ? (
          <>
            <p className="m-0 mb-2.5">
              After this, {name} can open only the pages ticked for them
              {modules === null ? "" : ` today (${modules} modules)`}. Every
              other page and action is blocked right away, including anything
              not yet linked to a tick, even for an Admin.
            </p>
            <p className={cn(PARTNER_NOTE_CLASS, "m-0")}>
              {removing.length ? (
                <>
                  <b>Sending is for internal staff only.</b> These will be
                  removed:
                </>
              ) : (
                <>
                  <b>Sending is for internal staff only.</b> Partners can&apos;t
                  send or reply to guests, whatever is ticked.
                </>
              )}
            </p>
            {removing.length ? (
              <ul
                data-removing-send
                className="m-0 mt-1.5 flex flex-col gap-0.5 pl-5 text-[13px]"
              >
                {removing.map((c) => (
                  <li key={c}>{itemNames.get(c) ?? c}</li>
                ))}
              </ul>
            ) : null}
            <p className="m-0 mt-2 text-[12px] text-[#4b5563]">
              Their other ticks stay as they are. Notification duties and teams
              don&apos;t apply to partners.
            </p>
          </>
        ) : (
          <>
            <p className="m-0 mb-2.5">
              After this, {name} is a normal back-office account again and can
              use everything staff can, not only the ticked pages. Their ticks
              stay as they are.
            </p>
            <p className={cn(PARTNER_NOTE_CLASS, "m-0")}>
              They become Staff. An earlier Admin or Supervisor role does not
              come back. Send permissions are not added back: to let them send,
              pick <b>Read &amp; edit</b> on those pages again after the change.
            </p>
          </>
        )}
        {error ? (
          <p role="alert" className="m-0 mt-2.5 text-[13px] text-[#b91c1c]">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-[#e5e7eb] px-[26px] py-3.5">
        <div className="flex gap-2.5">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={busy}
            className={LEGACY_CANCEL_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={AMBER_BUTTON_CLASS}
          >
            {busy
              ? "Changing…"
              : toPartner
                ? "Change to partner"
                : "Change to staff"}
          </button>
        </div>
      </div>
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
  staffOnly,
  open,
  onOpen,
  onItems,
  note,
}: {
  groups: AccessGroup[];
  wiredModules: ReadonlySet<string>;
  items: Set<string>;
  /** partner 时 = 只给内部员工的发送项；员工为 undefined。 */
  staffOnly?: ReadonlySet<string>;
  open: Set<string>;
  onOpen: (open: Set<string>) => void;
  onItems: (items: Set<string>) => void;
  note: string | null;
}) {
  const sum = summarize(groups, items, staffOnly);
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
        {staffOnly ? (
          <span>
            <b className="text-[#1a1a1a]">Read &amp; edit</b>: can also change,
            publish, export and delete
          </span>
        ) : (
          <span>
            <b className="text-[#1a1a1a]">Read &amp; edit</b>: can also change,
            send, publish, export and delete
          </span>
        )}
        <span>
          <b className="text-[#1a1a1a]">Full access</b>: one switch for the
          whole page
        </span>
        {staffOnly ? (
          <span>
            <b className="text-[#1a1a1a]">Send</b>: internal staff only
          </span>
        ) : null}
      </p>
      {/* partner：发送只给内部员工（Annie 2026-10-27「发送只能是我们内部员工发送」）。 */}
      {staffOnly ? (
        <p
          data-partner-send-note
          className={cn(PARTNER_NOTE_CLASS, "m-0 mb-2")}
        >
          <b>Sending is for internal staff only</b>: partners can&apos;t send
          dispatch, manifests, confirmations, reminders or broadcasts, or reply
          to guests, whatever is ticked.
        </p>
      ) : null}
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
              staffOnly={staffOnly}
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
              staffOnly={staffOnly}
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
  staffOnly,
  open,
  onToggle,
  onItems,
}: {
  group: AccessGroup;
  notActive: boolean;
  items: Set<string>;
  staffOnly?: ReadonlySet<string>;
  open: Set<string>;
  onToggle: (key: string) => void;
  onItems: (items: Set<string>) => void;
}) {
  const expanded = open.has(group.key);
  const levels = group.rows.map((r) => levelOf(r, items, staffOnly));
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
              staffOnly={staffOnly}
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
  staffOnly,
  expanded,
  onToggle,
  onItems,
}: {
  row: AccessRow;
  notActive: boolean;
  items: Set<string>;
  /** partner 时 = 只给内部员工的发送项（档位不含、灰字 Internal staff only）；员工为 undefined。 */
  staffOnly?: ReadonlySet<string>;
  expanded: boolean;
  onToggle: () => void;
  onItems: (items: Set<string>) => void;
}) {
  const level = levelOf(row, items, staffOnly);
  const names = useItemNames();
  const have = row.all.filter((c) => items.has(c));
  const send = staffOnlyIn(row, staffOnly);
  const sendTicked = send.filter((c) => items.has(c));
  const editLocked = editLockedFor(row, staffOnly);
  const extra = row.all.filter(
    (c) => !row.read.includes(c) && !send.includes(c),
  );
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
            // partner：只剩「看」的行没有 Read & edit / Full access（Q1 A）。
            const locked = editLocked && option.level === "edit";
            return (
              <button
                key={option.level}
                type="button"
                aria-pressed={on}
                disabled={locked}
                title={locked ? "Internal staff only" : undefined}
                onClick={() =>
                  onItems(withLevel(row, option.level, items, staffOnly))
                }
                className={cn(
                  SEG_CLASS,
                  "disabled:cursor-not-allowed disabled:bg-[#f8f9fa] disabled:text-[#c0c4cc]",
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
      {send.length ? (
        <p
          data-staff-only={row.key}
          className="col-span-full m-0 flex flex-wrap items-center gap-1.5 text-[12px] text-[#4b5563]"
        >
          <span className="inline-flex items-center gap-1 rounded-[6px] border border-dashed border-[#cbd5e1] bg-[#f3f4f6] px-[7px] py-px text-[11px] font-semibold whitespace-nowrap text-[#6b7280]">
            <svg viewBox="0 0 10 10" aria-hidden className="size-2.5">
              <rect
                x="1.5"
                y="4.5"
                width="7"
                height="5"
                rx="1"
                fill="currentColor"
              />
              <path
                d="M3 4.5V3a2 2 0 0 1 4 0v1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
            Internal staff only
          </span>
          {names(send)}
          {editLocked
            ? " — partners can only look at this page"
            : " — not included in Read & edit for partners"}
        </p>
      ) : null}
      {sendTicked.length ? (
        <p
          data-send-ticked={row.key}
          className="col-span-full m-0 rounded-[8px] border border-[#fcd34d] bg-[#fef3c7] px-2.5 py-1.5 text-[12px] text-[#92400e]"
        >
          {names(sendTicked)} {sendTicked.length === 1 ? "is" : "are"} ticked,
          but partners can&apos;t send. It will be removed when you save.
        </p>
      ) : null}
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
              {extra.length || !send.length ? (
                <>
                  <br />
                  <b className="text-[#1a1a1a]">Read &amp; edit</b> adds:{" "}
                  {names(extra)}
                </>
              ) : null}
            </>
          )}
          {send.length ? (
            <>
              <br />
              <s className="text-[#9ca3af]">{names(send)}</s> — internal staff
              only
            </>
          ) : null}
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
