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
