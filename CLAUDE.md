@AGENTS.md

# npe-ops-frontend —— Claude Code 工作说明

## 项目背景

本仓库是 CHD 员工后台的新前端（Next.js + React），逐页替换后端仓库
`npe-confirmation-service` 里的 Jinja2 旧页面。技术栈、目录结构、接口调用方式见 [README.md](README.md)。
前后端两个仓库都由 Max 负责，Annie 验收、转需求。

后端由另一个 Claude Code 窗口负责。两个仓库完全独立，**本仓库不需要 worktree**，
后端窗口的文件清单、worktree 要求和 gate 规则都不适用于本仓库。

### 已定的决策（不再重开）

- 用 React + Next.js，Vue 3 方案已作废（和 TripGuru supplier、CHD transportation 前端统一技术栈，
  TripGuru 那边 Li Li 还在确认细节，但方向已定）。
- 继续用 Railway，不迁 AWS。
- 逐页迁移：新页面用 JSON API + React；旧 Jinja2 页面只修 bug，不加新功能。
- **分批切换**（Annie 2026-10-10 定，取代 10-03 的「全部做完一次性切换」）：staff 只用 ops 一个网址、只登录一次。
  ops 自己没有的路径一律经 `next.config.ts` 的 fallback 原样转给后端（旧页面、样式、接口），网址仍是 ops 的；
  哪些页面已换成新页面只看 `lib/page-switch.ts` 的 `SWITCHED` 清单（切一页只改这一处），清单里的页面旧路径自动跳新页面。
  不改登录 cookie 的域、不改后端；客人页面和 confirm 域名不受影响。注意 ops 连的是生产后端，发送页点了就真发。
  切换由 Max 测试（Annie 2026-10-11），合 main 前先问 Annie。
- **主样子是「深色外框 + 白卡片」，全深色另做**（Annie 2026-10-11）：所有页面照旧按现在的样子（同旧后台）做完、上线；
  全深色（卡片、表格也是深色）单独做，「能做多少做多少」，做好的先藏着，以后一批开放给 staff 选，默认仍是现在的样子。
  写法见 `lib/theme.ts`：`<html data-theme="night">` 时生效的 `night:` 变体，没开时页面不变；预览用网址 `?theme=night` / `?theme=day`。
  公司旁支（`task/pickup-locations-dark`）那 6 页的深色改版不合进来，只当配色参考。
- **先 preview、Annie 同意了再动手**（Annie 2026-10-14）：每次增加新功能，或者页面有设计调整（版式、大小、颜色、样式），
  必须先给 Annie 看 preview（模拟数据截图 / 样稿 / 预览页），她同意了才写代码、提交、合 main。她用文字提的改法也一样要先 preview。
  只修 bug、样子不变的，和照旧页面一模一样搬的，不用。
- **Annie 提改动意见时：先记录，等「动手」指令才行动**（Annie 2026-10-17）：Annie 提出任何改动意见（新功能、样子调整、规则变更、
  对 preview 的修改要求），窗口只做三件事——① 记下来（写进 PROGRESS.md 或回复里复述确认）；② 需要的话更新 preview、核对可行性、
  问清细节；③ **等 Annie 明确发出「动手」类指令后才改代码、提交、合 main**。「可以」「同意」「用 X 吧」「对」这类对方案的回应、
  或在 preview 上的取舍，不算动手指令；拿不准就问一句「是否现在动手」。推 main 前把 Annie 的「动手」原话告诉主窗口。
  只修 bug、样子不变的小修仍照「先 preview」那条的例外办理。
- **每个新板块先只对 Super Admin 可见，版面上设「员工可见 / 不可见」开关**（Annie 2026-10-24）：Dashboard 上每出现一个新板块
  （Daily Operation Report 等），上线时默认只出现在 Super Admin 的版面，并在版面设置里加一个开关，由 Super Admin 决定员工能否看到；
  默认员工不可见。具体放哪、开关长什么样，先 preview。
  **同理，自动发出的提醒 / 通知也要有总开关，默认关**（Annie 2026-10-24：每日任务提醒、Daily Operation Report 的负责人通知等）：
  人力体系还没建好、没有收件人，系统不能先跑；就算建好了，内容也要先调试，Annie 准备好再打开。
- **蓝色按钮只用于提交**（Annie 2026-10-11）：全站蓝色的键统一作提交键（Send / Save / Upload / Insert 等）。
  计数、进度、状态（例如「0 of 10 done」）不做成胶囊，用普通文字，不用蓝色，不能看起来像按钮。
  例外：右下角 ↑↓ 这类功能键也用蓝色（Annie 2026-10-11：「反正也是功能键」，照旧后台的蓝色粗箭头）。
- 暂不引入状态管理库和 UI 组件库。
- **页面对着旧版做，做到一模一样**（Annie 2026-10-07）：配色（旧后台是深色，`base.html` 的 `--bg:#06101c`）、
  版式、字体、文字都照旧模板，不自己发挥。之前做的浅色页面都不符合这一条。和旧页面有任何不同，都要先经 Annie 同意，
  同意过的写进 PROGRESS.md。旧页面没有的新功能（如 Dispatch 的 Assign / Send）也用旧后台的深色风格。
- **整个系统的发送页面格式必须统一**（Annie 2026-10-12）：不同页面功能可以有增减，格式要一样。发送页、发送弹窗里逐单列名单 /
  已发过 / 结果，一律用 `components/tickets-send/legacy-ui`（照旧 `send_tour.html` 的表格、淡黄行 + 「Sent by 谁 on 时间」标签、
  黄框 / 红框、结果数字、进度条），不另写一套，也不把单号挤成一段文字。
- 新页面参照已上线的 `/promotion-stats` 和已完成的 teams / users 页：组件放 `components/<页面>/`，
  接口封装放 `lib/<页面>-api.ts`，统一走 `lib/api-client.ts` 的 `apiFetch`。

### 部署

| 服务                         | 域名                              | 说明                                    |
| ---------------------------- | --------------------------------- | --------------------------------------- |
| 本仓库（Railway）            | `ops.nationalparkexpress.com`     | 端口 3100；**推送 main 后自动部署上线** |
| 后端 confirm 服务（Railway） | `confirm.nationalparkexpress.com` | 端口 8080                               |

- ⚠️ 合并到 main 就等于上线。**Annie 2026-10-13 定：做完就直接合进 main 上线，Annie 在线上 ops 验收**（目前只有 Annie 在用 ops，staff 还在 confirm，没有风险）。
  合之前照常跑 tsc / eslint / build 和相关 headless 套件，过了就合；验收提的问题从 main 拉新分支修，修完同样直接合。
- 两个域名都经 Cloudflare 代理，DNS 在 Cloudflare 管理，改 DNS 去 Cloudflare 操作。

### 鉴权现状

- 浏览器只请求同源 `/api/*`，由 `next.config.ts` 转发到后端；401 时跳旧后台登录页，
  带 `?next=<当前页面完整 URL>`（`lib/safe-redirect.ts`）。
- ⏸️ 未定：在 confirm 登录后能不能跳回原来的 ops 页面。旧后台登录接口要支持 `next` 回跳，
  线上 session cookie 也要能带到 ops 子域（同一父域，计划用 `SameSite=Lax; Secure`）——都是后端的活，
  本仓库不改。上线前回落到旧后台首页属预期的过渡态。

## 开工必做

0. 用 `ListAgents` 看一下自己这个对话的名字（形如 `npe-ops-frontend-<code> [<ref>]`），
   在这次交接 / 回复的开头报一下，方便别的窗口或后端用 `SendMessage` 找到自己。**每次开工都要报，不能省**；
   同时说明自己是主窗口还是工作窗口（主窗口由 Annie 开工时指定）。
1. 看 `git status` 和当前分支；
2. 读本仓库的 [PROGRESS.md](PROGRESS.md)，确认做到哪一步、下一步是什么；
3. 只读查看后端仓库的 `NPE_前端迁移_项目规则.md` 第五节「接口清单与进度」，
   确认要做的页面接口是否已就绪。后端仓库的位置因电脑而异：
   - 家里（AnniesPC）：`D:\npe-confirmation-service`
   - 公司：`C:\Code\npe-confirmation-service`

## 多窗口协调：主窗口派工（Max 2026-10-16 定）

- 每天指定一个 ops 窗口当「主窗口」：接后端（或 Annie）用 `SendMessage` 转来的任务，
  决定要不要拆、拆给几个新窗口；其余窗口专心做被派到的事，不用自己盯后端消息。
- 每个窗口开工时都按「开工必做」第 0 条报自己的对话名——不只是主窗口，这样主窗口才能找到刚开的新窗口。
- 主窗口收到任务后：
  1. 判断范围、要不要拆成几份分给不同窗口（独立、不互相卡文件的任务才拆，同一文件 / 同一组件的改动留一个窗口做完，避免冲突）；
  2. 告诉操作的人要开几个新窗口（新窗口照旧从 main 拉 `task/<名字>` 分支，多个窗口同时改动时各自开 worktree，避免在主目录互相切分支——同「分支和上线」一节）；
  3. 新窗口报了对话名以后，主窗口用 `SendMessage` 把具体任务派过去。**派工消息必须带全背景**（新窗口不共享主窗口这边的上下文）：要做什么、为什么（Annie 的原话 / 决定）、相关 PROGRESS.md 条目或后端接口说明的位置、验收标准（看预览 / 检查套 / ZZ Test）。
- **主窗口只负责项目管理、工作分配和反馈**（Annie 2026-10-17 定，2026-10-21 重申收紧）：主窗口只负责分发、确认业务（跟 Annie / 后端核对需求、验收标准）、
  跟进各窗口进度、核对合 main 前的检查结果、把各方反馈转达清楚；功能代码、修 bug、写检查套、**做 preview / artifact（包括纯 HTML 预览稿）**一律派给工作窗口，不是主窗口自己做。
  主窗口自己只改协调类文件（本文件、PROGRESS.md 的派工 / 进度记录），并**忠实记录每次工作到交接里**（谁做的、做了什么、Annie 的原话、检查结果）。
- **窗口不够就向 Annie 要，但先看资源**：任务需要的窗口比现有的多，主窗口可以请 Annie 再开；
  同时开太多窗口会占满电脑内存 / CPU（每个窗口还会跑 dev server、headless Chrome、build）。
  主窗口要随时观察资源（用 PowerShell 看内存 / CPU 占用，例如 `Get-CimInstance Win32_OperatingSystem` 的空闲内存、
  `Get-Process node,chrome` 的数量和内存），派工前、请 Annie 加窗口前各看一次；空闲内存紧张就少开窗口、让任务排队，
  并提醒各窗口跑完检查后关掉自己起的 dev server / Chrome。请 Annie 加窗口时说明：要加几个、各做什么、当前资源情况。
- 这条只是协调流程，不改别的规矩：该走的分支 / preview / 检查 / 合 main 流程照旧，见「分支和上线」「开工必做」。

## 分支和上线（Annie 2026-10-13 起）

- 每件事从 main 拉一个 `task/<名字>` 分支，做完、检查过就直接合进 main 上线（推 main 自动部署），Annie 在线上 ops 验收。
  不再攒分支链、不再等本地验收。合之前先把最新的 main 合进来再跑检查（几个窗口同时在推 main）。
- 验收提的问题：从 main 拉新分支修，修完直接合。PROGRESS.md 写明修了什么。
- 接口还没就绪的跳过，记进「需要后端」，先做下一个。
- ⚠️ ops 连生产后端：上线后的发送页、Manifests 发送、群发点了就真发；测试仍只动 `ZZ Test` 开头的记录。
- 以前的「分支链 / 链尾验收」规矩（2026-10-03 起）作废，PROGRESS.md 里相关段落是历史记录。

## 边界

- 不修改后端仓库的任何文件，只读查看。
- 缺接口时不要自己实现，写进 PROGRESS.md 的「需要后端」一节，由 Annie 转给后端窗口。

## 测试

- 本地连真实后端，**数据是生产数据**。
- 新建 / 编辑 / 删除只动名字以 `ZZ Test` 开头的记录。
- 发送类页面（Tickets / Morning / Tour 发送等）只用 Annie 提供的、只含她本人信息的文件。
- 不连真实后端时，用模拟接口 + headless Chrome 跑检查，把检查项和结果写进 PROGRESS.md。

## 下班交接

和后端窗口相同：周一到周五 **13:35** 开始收尾。

1. 把未完成的工作提交并推到 `task/<页面名>` 分支；
2. 在 PROGRESS.md 写清做到哪一步、下一步是什么。

## PROGRESS.md

每完成一步就更新 PROGRESS.md，保证新开的窗口读完 CLAUDE.md 和 PROGRESS.md 就能接着做。
