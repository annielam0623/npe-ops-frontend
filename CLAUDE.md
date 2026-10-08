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
- 员工**全部页面做完才一次性切换**到 ops（Annie 2026-10-03 定）。在这之前员工继续用旧后台，
  ops 上的页面只用于验收。注意 ops 连的是生产后端，发送页点了就真发。切换前检查清单见 PROGRESS.md。
- 暂不引入状态管理库和 UI 组件库。
- **页面对着旧版做，做到一模一样**（Annie 2026-10-07）：配色（旧后台是深色，`base.html` 的 `--bg:#06101c`）、
  版式、字体、文字都照旧模板，不自己发挥。之前做的浅色页面都不符合这一条。和旧页面有任何不同，都要先经 Annie 同意，
  同意过的写进 PROGRESS.md。旧页面没有的新功能（如 Dispatch 的 Assign / Send）也用旧后台的深色风格。
- 新页面参照已上线的 `/promotion-stats` 和已完成的 teams / users 页：组件放 `components/<页面>/`，
  接口封装放 `lib/<页面>-api.ts`，统一走 `lib/api-client.ts` 的 `apiFetch`。

### 部署

| 服务                         | 域名                              | 说明                                    |
| ---------------------------- | --------------------------------- | --------------------------------------- |
| 本仓库（Railway）            | `ops.nationalparkexpress.com`     | 端口 3100；**推送 main 后自动部署上线** |
| 后端 confirm 服务（Railway） | `confirm.nationalparkexpress.com` | 端口 8080                               |

- ⚠️ 合并到 main 就等于上线，只合并 Annie 验收通过的分支。
- 两个域名都经 Cloudflare 代理，DNS 在 Cloudflare 管理，改 DNS 去 Cloudflare 操作。

### 鉴权现状

- 浏览器只请求同源 `/api/*`，由 `next.config.ts` 转发到后端；401 时跳旧后台登录页，
  带 `?next=<当前页面完整 URL>`（`lib/safe-redirect.ts`）。
- ⏸️ 未定：在 confirm 登录后能不能跳回原来的 ops 页面。旧后台登录接口要支持 `next` 回跳，
  线上 session cookie 也要能带到 ops 子域（同一父域，计划用 `SameSite=Lax; Secure`）——都是后端的活，
  本仓库不改。上线前回落到旧后台首页属预期的过渡态。

## 开工必做

1. 看 `git status` 和当前分支；
2. 读本仓库的 [PROGRESS.md](PROGRESS.md)，确认做到哪一步、下一步是什么；
3. 只读查看后端仓库的 `NPE_前端迁移_项目规则.md` 第五节「接口清单与进度」，
   确认要做的页面接口是否已就绪。后端仓库的位置因电脑而异：
   - 家里（AnniesPC）：`D:\npe-confirmation-service`
   - 公司：`C:\Code\npe-confirmation-service`

## 待验收页面（不设上限）

- Annie 2026-10-03 定：**不设未验收页面上限**。做完一页、写好验收步骤就接着做下一页，
  Annie 有空时验收，也可以全部做完后集中验收。
- 分支连成一条链：每个新页面的 `task/<页面名>` 分支从上一个未合并的分支拉出，
  PROGRESS.md「进行中」开头写清链的顺序和最新的分支。验收时在链尾分支上看全部页面；
  通过的就合到 main（只过了前面几页，就合对应的那个分支）。
- 验收时提出的问题，修在链尾分支上，并在 PROGRESS.md 写明修的是哪一页。修过以后，
  前面的分支里没有这个修复，不能再单独合，要合就合链尾分支。
- 接口还没就绪的页面跳过，记进「需要后端」，先做下一个。

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
