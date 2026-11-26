# G382 前端 ↔ 后端合同核对包（给后端 86）

- 前端：`task/g382-ov-ab` @ a94f171b（总览 = ab；请假框 / 改班栏 / Staff Schedule 搬家 / My leave = e2 在 `task/g382-fe` 上，已合进 a94f171b）。
  之后 e2 在 `task/g382-fe` 又推了两笔（cf10418d 改班栏手机「+1」点得到，只动样式；a418dd48 g382-staff / g382-leave 能从 run-all 直接跑），
  跟 a94f171b、最新 main 合在 `task/g382-ov-checks-e2`（这份文件也在这个分支）。
- 后端：`task/g382-hr-schedule` @ 77404fa0 的 `docs/g382-hr-schedule/interface.md` 和代码（后端分支现在到 85af458e，只多 SA-6 测试，不动契约）。
- 做法：逐条看前端发的请求（路径、body）和读的字段，对照合同和后端代码。下面「前端」列写 `文件:行`（a94f171b），「后端」列写 77404fa0 的 `文件:行`。
  没查到底的写「未核」。CR-6（`would_gap` 做还是删）定了再补。
- 检查结果（合并后的 `task/g382-ov-checks-e2`，`node run-all.js g382-staff g382-leave sch leave g382ov hr`）：
  g382-staff 14/14、g382-leave 67/67、sch 82/82（21 段 SKIP，管理功能搬到总览）、leave 54/54（6 段 SKIP）、g382ov 10/10、hr 138/138，6/6 clean；
  g382ov-contract-check 37/37；tsc 0、eslint 0 错（3 个旧 warning）、build 过。

## 结论

| # | 接口 | 结论 |
|---|---|---|
| 1 | `GET /api/schedule/range` | 对得上；1 处要 86 确认（Q-2：没建的周 `status` 是 null） |
| 2 | `POST /api/schedule/range/changes` | 对得上；**1 处要定（Q-1：没建的周存班会 400）** |
| 3 | `…/leave-categories` GET / POST / PUT | 对得上 |
| 4 | `PUT /api/schedule/time-off`、`PUT/DELETE …/time-off/{id}` | 总览不直接调（录假走 range/changes）；前端封装和合同一致 |
| 5 | `POST …/leave-requests/{id}/approve`、`…/reject` | 对得上 |
| 6 | `GET …/leave-requests`（range 里的 `leave_requests`） | 对得上；`would_gap` 后端还没有，前端有就用、没有就自己算（CR-6 两种结果都行） |
| 7 | `GET /api/schedule/weeks/{w}`（Staff Schedule 只读） | 对得上 |
| 8 | 改班请求 `confirmation-requests/{id}/approve|decline` | 现有接口，没变 |
| 9 | 编辑锁 `weeks/{w}/edit-lock`（+ heartbeat / release） | 现有接口，没变；token 原样当 `lock_token` |
| 10 | 通知链接 `/settings/hr?tab=schedule` | 前端接住了 |
| 11 | 员工 My leave（`/my-schedule`） | 改读类别表；不发 `start_time` / `end_time`（员工照旧只能整天请） |

## 要 86 / Annie 定的

**Q-1 没建的周，在总览上手动加班存不了（400）**
- 现在：range 不建周，没建的周 `weeks_info[].version = null`（后端 services/schedule.py `get_range`，77404fa0 第 23–25 行附近）。
  总览照样让人在这周加班 / 拖班（前端 overview-view.tsx `edit()` 只占锁，不建周；`fetchScheduleWeek` 只在 Send to confirm 框里用，overview-view.tsx:1091）。
  存的时候 `base_version: null` ⇒ 后端 `apply_week_changes` 第一句就拒：400 `base_version is required (the version you got when you opened the week).`
  （services/schedule.py `apply_week_changes` 开头）；就算带了也会 404 `This week doesn't exist yet. Reload the page.`
- 什么时候会碰到：默认 4 周 = 上周、本周、后两周；后两周没人打开过 Staff Schedule、也没跑 Auto-fill 时就是没建的周。
  搬家后 Staff Schedule 的草稿周对排班人也不显示，打开它的人会更少（未核：Staff Schedule 只读页现在还会不会调 GET weeks/{w} 去建周）。
- 选法：
  - A（后端）：range 对 `can_edit` 的人把范围里没建的周建好（同 GET weeks/{w} 的 `_get_or_create_week`；注意那里会照上一周复制班）。
  - B（前端）：在没建的周第一次改动前先 GET weeks/{w}（会建周、可能照上周复制班，拿到 version），再改。
  - C：没建的周在总览上只读，写一句「Open the week in Auto-fill first」之类。
- e2 不推荐哪个：A / B 都会「照上周复制班」，这是看得见的行为，要 Annie 定；已发 fe。

**Q-2 没建的周 `weeks_info[].status` 是 null**
- 合同 §2.1 没写 null；后端 `get_range` 回 `None`。前端类型写的是 `"draft" | "published"`，页面 `info?.status ?? "draft"` 当草稿显示（week-block.tsx `status`），不会坏。
  请 86 在 interface.md §2.1 补一句「还没建的周 status / version 都是 null」，前端类型跟着改成可空。

## 逐条

### 1. GET /api/schedule/range（§2.1）
| 项 | 前端 | 合同 / 后端 | 对 |
|---|---|---|---|
| 请求 | `?from=&weeks=`，from = 本周日 −7（4 周默认，1–8 可选）。lib/schedule-overview-api.ts:14-23、overview-view.tsx:160-161 | §2.1；routers/schedule.py `schedule_range` | ✓ |
| 403 | 显示后端原话（overview-view.tsx:201）；hr-view 没 settings.hr.view 的人只出 Schedule 页签（hr-view.tsx:61） | 403 `You don't have access to the schedule overview.` | ✓ |
| can_edit / can_publish / can_manage_leave_types | 编辑键、Publish、Leave types 按它出 | §2.1 | ✓ |
| weeks_info | `week_start, status, version(string\|null), published_with_gaps`；没有 pending_changes（types/schedule-overview.ts） | §2.1；status 可能 null（Q-2） | ✓（Q-2） |
| employees | `id, name, is_active`，不带 sort_order，照后端顺序 | §2.1 | ✓ |
| slots / time_off / gaps / violations | time_off 读 `kind_label / start_time / end_time`；gap 读 `reason`；violation 读 `message / slot_ids / blocking`，只有 blocking 的标橙框（overview-view.tsx `isBlocking`） | §1；schedule_rule_check `_v` 带 `rule_id / blocking`，按周的带 `week` | ✓ |
| leave_requests | 读 `can_decide / shifts[].slot_id / kind_label / start_time / end_time / would_gap?` | leave_requests.py queue 行（第 343-345 行带 can_decide / shifts）；would_gap 还没有（CR-6） | ✓ |
| change_requests | 每周一项 + week_start；can_edit=false 时 []，前端不出栏 | routers/schedule.py `schedule_range` | ✓ |

### 2. POST /api/schedule/range/changes（§2.2）
| 项 | 前端 | 合同 / 后端 | 对 |
|---|---|---|---|
| weeks | 所有有改动的周都列；有班 op 的周带锁 token + base_version（字符串），只录 / 删假的周 `lock_token: null`（overview-view.tsx `doSave`、draft.ts `diffDraft` 的 slotWeeks） | §2.2：只有带班 op 的周查锁和版本 | ✓（没建的周见 Q-1） |
| 班的 op | `create {ref, date, shift_type, start_time, end_time, employee_id, note}`、`assign {slot, employee_id}`、`time {slot, start_time, end_time}`、`note {slot, note}`、`delete {slot}`；换日子 / 换班次 = delete + create（ref `m<id>`），新加的 ref `n<N>`（draft.ts） | 同 `POST weeks/{w}/changes`；create 按 date 落周 | ✓ |
| 假的 op | `time_off_set {employee_id, date, kind, start_time, end_time, note}`、`time_off_delete {id}`（draft.ts `offSet`） | §2.2 | ✓ |
| 成功 | 读 `weeks[w].lock_token`（换新 token）后放锁、重读 range | §2.2 回包 | ✓ |
| 409 rule_violation | 出「Can’t save: rule problems」框，列 `violations[].message`，只有 Back to edit | §2.2 | ✓（g382ov-test 第 6 项） |
| 409 coverage_gap / locked / stale、400 | 红字后端原话；coverage_gap 逐行列空档（leaveErrorText）；stale 加一句「Press Discard to load the latest…」 | §2.2 | ✓ |

### 3. 请假类别（§2.3）
| 项 | 前端 | 合同 | 对 |
|---|---|---|---|
| GET | 总览、Leave types 框、批假 / 录假框、员工 My leave 都读；表单只要在用的（`?active=1`） | §2.3 | ✓ |
| POST | `{label}` ⇒ 用回包的 key；要改顺序 / 停用再 PUT（leave-types-dialog.tsx:129-134） | §2.3 | ✓ |
| PUT | `{label?, sort_order?, is_active?}`（leave-types-dialog.tsx:145） | §2.3 | ✓ |
| 读不到 | 兜底 PTO / Sick / Leave（personal = Leave，Q8） | 种子同 | ✓ |

### 4. 录假 / 改假
- 总览上录假、删假、改假都是先放草稿，按 Save 走 range/changes 的 `time_off_set / time_off_delete`，不直接调 `PUT /api/schedule/time-off` 和 `PUT/DELETE …/time-off/{id}`。
- `lib/schedule-leave-api.ts` 里 `addTimeOff / updateTimeOff / deleteTimeOff` 三个封装和 §2.4 / §3 一致（`{kind?, start_time?, end_time?, note?}`，改整天 = 两个 null），目前没有页面调用。

### 5. 批假 / 拒假（§3）
| 项 | 前端 | 合同 | 对 |
|---|---|---|---|
| approve body | `adjust {date_from, date_to, kind, start_time, end_time}`（改了才带）、`shifts [{slot_id, action: give, employee_id} \| {slot_id, action: delete}]`、`cover {employee_id}`（已发布周按小时、会空出来才必选）、`note`（≤120）（leave-request-dialog.tsx:215-239） | §3 approve body | ✓ |
| reject | `{note}`（可空）（lib/leave-api.ts:166-173） | 现有 | ✓ |
| 400 / 409 | 红框后端原话；409 rule_violation / coverage_gap 下面逐行列违规原句 / 空档 | §3；SA-4 / SA-5 新句子原样显示 | ✓ |
| 顶班 / 给班候选 | 只灰掉「已在班 / 在请假」，违规的人靠后端 409 拦（Annie 选 B） | — | ✓ |

### 6–11
- **leave_requests 列表**：前端对 `would_gap` 有就用，没有用 `lib/schedule-leave.ts hourlyLeaveGaps` 自己算；CR-6 删掉也不影响。
- **GET weeks/{w}**：Staff Schedule 只读页读 time_off 的 `kind_label / start_time / end_time`（week-grid.tsx:834-837 一带，按小时的写「Leave 2–4 PM (PTO)」）；不读 violations。
- **改班请求**：`POST /api/schedule/confirmation-requests/{id}/approve|decline`（lib/schedule-confirm-api.ts:270、280），没变。
- **编辑锁**：`POST weeks/{w}/edit-lock`、`/heartbeat`、`/release`（lib/schedule-lock-api.ts），404 = 不占照常改（use-range-locks.ts:18）。
- **通知链接**：批复人的 `/settings/hr?tab=schedule` 直接打开总览（hr-view）；旧的 `/schedule?tab=leave`：批复人 / Super Admin 跳总览，其他人跳 My schedule（schedule-view.tsx）。
- **My schedule › My leave**：Type 下拉读 `GET leave-categories?active=1`，列表 Type 用行上的 `kind_label`；POST 不带 `start_time / end_time`（员工在这页只能整天请，没改）。
- **员工页的按小时假**：`GET /api/schedule/confirmation` 的 time_off 只有 `{employee_id, date, kind}`（services/schedule.py 第 2651 行一带），My schedule 上按小时的假显示一条「Leave」不带时间。已出 preview 给 Annie，等她看了再说，这次不改。
