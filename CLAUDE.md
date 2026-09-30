@AGENTS.md

# npe-ops-frontend —— Claude Code 工作说明

## 项目背景

本仓库是 CHD 员工后台的新前端（Next.js + React），逐页替换后端仓库
`npe-confirmation-service` 里的 Jinja2 旧页面。技术栈、目录结构、接口调用方式见 [README.md](README.md)。

后端由另一个 Claude Code 窗口负责。两个仓库完全独立，**本仓库不需要 worktree**，
后端窗口的文件清单、worktree 要求和 gate 规则都不适用于本仓库。

## 开工必做

1. 看 `git status` 和当前分支；
2. 读本仓库的 [PROGRESS.md](PROGRESS.md)，确认做到哪一步、下一步是什么；
3. 只读查看 `D:\npe-confirmation-service\NPE_前端迁移_项目规则.md` 第五节「接口清单与进度」，
   确认要做的页面接口是否已就绪。

## 边界

- 不修改后端仓库 `D:\npe-confirmation-service` 的任何文件，只读查看。
- 缺接口时不要自己实现，写进 PROGRESS.md 的「需要后端」一节，由 Annie 转给后端窗口。

## 测试

- 本地连真实后端，**数据是生产数据**。
- 新建 / 编辑 / 删除只动名字以 `ZZ Test` 开头的记录。
- 发送类页面（Tickets / Morning / Tour 发送等）只用 Annie 提供的、只含她本人信息的文件。

## 下班交接

和后端窗口相同：周一到周五 **13:35** 开始收尾。

1. 把未完成的工作提交并推到 `task/<页面名>` 分支；
2. 在 PROGRESS.md 写清做到哪一步、下一步是什么。

## PROGRESS.md

每完成一步就更新 PROGRESS.md，保证新开的窗口读完 CLAUDE.md 和 PROGRESS.md 就能接着做。
