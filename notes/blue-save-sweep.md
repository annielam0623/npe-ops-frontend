# Blue Save sweep — handoff (63, 2026-11-19 14:20)

Task from 08 (Annie via f4): every Save / Submit-type button blue #3b82f6; Add rule (saves at once = blue, adds to page then Save = sage #6b8e74). Inventory + preview first, no code change until Annie says 「动手」.

Status: started 14:18, only a first grep done. No code changed. Next window: finish the inventory, build preview artifact, send list + link to main.

## Candidates found so far (not yet verified one by one)
- components/ui/buttons.ts:3 shared primary button `bg-stone-800` (dark grey) — likely used by many older pages (teams / users etc.). Biggest single fix; find all users first.
- components/hr/legacy-ui.ts:27-30 HR_BTN_PRIMARY_CLASS bg-[#1a1a1a] — HR Profile › Edit list "Save changes" (hr-view.tsx:837-843), shared by every HR Save. (f4 lead)
- components/orders/order-detail-view.tsx:53-54 OD_BTN_PRIMARY (f4 lead)
- components/pickup-locations/legacy-ui.tsx:24-25 BTN_ADD_BASE — apply Add rule (f4 lead)
- components/dispatch-imports/imports-view.tsx:204 (f4 lead)
- check if submit/apply: broadcasting-log-view.tsx:335, orders-list-view.tsx:342, ui/date-range-presets.tsx:230 (f4 lead)
- check colour: dispatch-manifest/layout-dialog.tsx:47 SAVE_BTN, relay-list/relay-settings-dialog.tsx:50 SAVE_BTN (f4 lead)
- components/tickets-send/legacy-ui.tsx:135 dark ghost button — check which buttons use it (Send/Upload?)
- components/dispatch-manifest/farm-out-button.tsx:39 white button — check if it submits
- components/hr/payroll-cards-shared.ts:118 C_BTN white — check use
- components/send-log/legacy.tsx:15/19/39 white buttons — check if any is Apply/Save

## Still to do
1. grep by text too (`>Save`, `Submit`, `Send`, `Upload`, `Insert`, `Apply`, `Confirm`) and check each button's class, not only colour constants.
2. Table: page › where › text, colour (file:line), recommendation; unclear ones in a separate list for Annie.
3. Preview artifact: before / after per page, disabled look kept.

## 4a progress (2026-11-19 21:50) — still inventory, no code changed, no preview yet
Verified so far (dark button -> text -> recommendation):
- ui/buttons.ts:3 PRIMARY_BUTTON_CLASS stone-800: only 2 users — manifests/field-picker.tsx:383 "Apply" (saves picked fields) -> blue; ui/confirm-dialog.tsx:116 (shared confirm OK key, non-danger) -> blue (check each caller's wording).
- ui/filter-bar.tsx:30 FILTER_PRIMARY_BUTTON_CLASS stone-800 "Apply / Pull" — no direct users found by name yet; check spread usage.
- hr/legacy-ui.ts:29 HR_BTN_PRIMARY_CLASS #1a1a1a — WARNING: also used as SELECTED TAB state (hr-view.tsx:634/644/657/677 People/Schedule/Record/Payroll tabs, working-record.tsx:272 span toggle). Do NOT just recolour the constant; split into a Save constant. Save users: hr-view.tsx:841 "Save changes" -> blue; profile-dialog.tsx:319 "Save" -> blue; hr-view.tsx:602 "Add person" (opens dialog?) -> check, likely not counted / or blue if creates directly.
- orders/order-detail-view.tsx:71 OD_BTN_PRIMARY -> :920 "Save" (and :709 same) -> blue.
- pickup-locations/legacy-ui.tsx:25 BTN_ADD_BASE -> BTN_ADD_CLASS used workspace-settings-view.tsx:551 -> check if adds-to-page (sage) or saves (blue).
- "Apply" date-range buttons #1a1a1a: broadcasting-log-view.tsx:335, orders-list-view.tsx:342, ui/date-range-presets.tsx:230 — filter Apply, not a save. UNCLEAR -> ask Annie (is a filter "Apply" a submit?).
- dispatch-imports/imports-view.tsx:204 "Pull from Discord" #1a1a1a — fetch action, UNCLEAR -> ask Annie.
- Not buttons (selected-state chips / table totals, leave): manifests-view.tsx:2079, ops-summary-view.tsx:165, print-layout/layout-panels.tsx:713, products/forecast-setup.tsx:264/437, products/legacy-ui.ts:55 (bar), sales-report breakdown-table.tsx:91 / breakdown-view.tsx:107, date-range-presets.tsx:169/190, filter-bar.tsx:84.
Still to do: text grep (Save/Submit/Send/Upload/Insert/Confirm/Create) for non-dark buttons (white / ghost: tickets-send legacy-ui:135, farm-out-button:39, payroll-cards-shared:118, send-log legacy 15/19/39, layout-dialog:47, relay-settings-dialog:50, bug-reports legacy-styles); confirm-dialog callers; then preview artifact.

## bb (2026-11-20) — inventory done, preview published, no code changed
- Branch task/blue-save-sweep-bb (from origin/task/blue-save-sweep bea69a10 + latest main). Worktree C:\Code\ops-wt-bb-blue.
- Preview: https://claude.ai/artifact/SvbDoNGWTZeiqjyY9tHRUJ (full list: blue 16 groups, sage 3 keys in tcq-review, keep lists, pending 1a + new S1 send-theme question).
- Code plan after Annie 「动手」: HR new HR_BTN_SAVE_CLASS (keep HR_BTN_PRIMARY for tabs / Add person); OD_BTN_PRIMARY blue; ConfirmDialog default blue + neutral class for Replace / Discard / Deactivate / Unlock / Download callers; BTN_ADD_SMALL/BTN_ADD_CLASS Save users -> BTN_SUBMIT style; vehicles BTN_ON Save -> blue; LEGACY_SAVE_BUTTON_CLASS -> blue; bug / task-board SUBMIT blue but Done / 完成 keys separate; lunch-dialog blue; date Apply x5 blue; field-picker:378 DARK/blue; unit-save / navigation #2563eb, import Insert #378ADD, upload-compare #185FA5, page-save Save sendButtonClass("blue") -> #3b82f6; tcq-review + Add x3 sage; FILTER_PRIMARY_BUTTON_CLASS blue (unused).
