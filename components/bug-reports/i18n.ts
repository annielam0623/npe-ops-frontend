/**
 * 中英双语，默认中文（Annie 2026-09-17 定，保留双语）。
 * ⚠️ ClickUp 里的数据值（Bug原因 的选项、中文状态名等）不翻译，原样显示。
 */
export type Lang = "zh" | "en";

export const TEXT = {
  zh: {
    pageSub: "数据来自 ClickUp · Bug list · TripGuru-Dev",
    refresh: "刷新数据",
    newBug: "＋ 新建 Bug",
    langButton: "EN",
    loading: "正在从 ClickUp 拉取数据...",
    connError: "连接失败，请稍后重试",
    connErrorNote: "这不代表没有 bug，是取数据失败了。",
    truncated:
      "⚠️ 数据可能不完整：bug 条数超出单次拉取上限，下面不是全部。请告知 Max。",
    noResult: "没有符合条件的 bug",
    empty: "目前为空",
    cleared: "✓ 已从该项移出",
    noOwner: "无负责人",
    allBug: "全部 Bug",
    open: "未关闭",
    search: "搜索 bug 标题、负责人...",
    showing: (n: number, t: number) => `显示 ${n} / ${t} 条`,
    days: (d: number) => `已 ${d} 天`,
    created: (d: string) => `创建: ${d}`,
    viewClickup: "在 ClickUp 查看 ↗",
    description: "Bug 描述 / Description",
    noDescription: "No description created for this bug",
    history: "评论历史",
    addComment: "发表评论",
    commentHolder: "留言…",
    selectFiles: "📎 点击选择文件",
    send: "发送",
    sending: "提交中...",
    submitOk: "✓ 已提交到 ClickUp",
    commentFail: "加载失败",
    noComment: "暂无评论",
    commentLoading: "加载中...",
    allPill: "全部",
    log: "日报",
    needContent: "请输入内容或选择文件",
    submitFail: "提交失败：",
    attachFail: "附件上传失败：",
    unknownUser: "未知用户",
    uploaded: (who: string, n: number) => `📎 ${who} 上传了 ${n} 张附件`,
    allSeverity: "所有优先级",
    allStatus: "所有状态",
    allReasons: "所有原因",
    allWorkstreams: "所有 Workstream",
    allAssignees: "所有负责人",
    allReporters: "所有提交人",
    sortPriority: "优先级（默认）",
    sortOldest: "天数最多优先",
    sortUpdated: "最新动态优先",
    statusOptions: { new: "新建", "in progress": "进行中", complete: "已完成" },
  },
  en: {
    pageSub: "Data from ClickUp · Bug list · TripGuru-Dev",
    refresh: "Refresh",
    newBug: "＋ New Bug",
    langButton: "中文",
    loading: "Loading from ClickUp...",
    connError: "Connection failed. Please try again.",
    connErrorNote: "This does not mean there are no bugs — the fetch failed.",
    truncated:
      "⚠️ The list may be incomplete: there are more bugs than one fetch can return. Please tell Max.",
    noResult: "No bugs found",
    empty: "Currently empty",
    cleared: "✓ All cleared",
    noOwner: "No assignee",
    allBug: "All Bugs",
    open: "Open",
    search: "Search bug title, assignee...",
    showing: (n: number, t: number) => `Showing ${n} / ${t}`,
    days: (d: number) => `${d} days`,
    created: (d: string) => `Created: ${d}`,
    viewClickup: "View in ClickUp ↗",
    description: "Bug 描述 / Description",
    noDescription: "No description created for this bug",
    history: "Comment History",
    addComment: "Add Comment",
    commentHolder: "Add a comment…",
    selectFiles: "📎 Click to select files",
    send: "Send",
    sending: "Submitting...",
    submitOk: "✓ Submitted to ClickUp",
    commentFail: "Failed to load",
    noComment: "No comments yet",
    commentLoading: "Loading...",
    allPill: "All",
    log: "Log",
    needContent: "Please enter a comment or select a file",
    submitFail: "Submit failed: ",
    attachFail: "Attachment upload failed: ",
    unknownUser: "Unknown",
    uploaded: (who: string, n: number) => `📎 ${who} uploaded ${n} file(s)`,
    allSeverity: "All Severity",
    allStatus: "All Status",
    allReasons: "All Reasons",
    allWorkstreams: "All Workstreams",
    allAssignees: "All Assignees",
    allReporters: "All Reporters",
    sortPriority: "Priority (default)",
    sortOldest: "Oldest First",
    sortUpdated: "Recently Updated",
    statusOptions: {
      new: "New",
      "in progress": "In Progress",
      complete: "Complete",
    },
  },
} as const;

export type Text = (typeof TEXT)[Lang];

/** 状态按钮：按子串匹配 ClickUp 的状态名（同旧页面）。 */
export const STATUS_PILLS: readonly {
  value: string;
  zh: string;
  en: string;
}[] = [
  { value: "new", zh: "新建", en: "New" },
  { value: "in progress", zh: "修复中", en: "In Progress" },
  { value: "fixed", zh: "已修复待测试", en: "Fixed & Pending Test" },
  { value: "in verification", zh: "验证中", en: "Under Verification" },
  { value: "test passed", zh: "TEST验证通过", en: "Test Passed" },
  { value: "complete", zh: "已上线", en: "Completed" },
  { value: "已拒绝", zh: "已拒绝", en: "Rejected" },
  { value: "cr", zh: "转为需求", en: "Moved to Backlog" },
];

/** Bug原因 的选项（值就是 ClickUp 里的中文，不翻译）。 */
export const REASONS: readonly { value: string; en: string }[] = [
  { value: "需求不明确", en: "Unclear Requirements" },
  { value: "UI问题", en: "UI Issue" },
  { value: "优化建议", en: "Optimization" },
  { value: "逻辑错误", en: "Logic Error" },
  { value: "功能缺失", en: "Missing Feature" },
  { value: "数据问题", en: "Data Issue" },
  { value: "兼容性问题", en: "Compatibility" },
  { value: "测试遗漏", en: "Test Gap" },
  { value: "环境与部署问题", en: "Env / Deploy" },
];

export const WORKSTREAMS = [
  "Hotel",
  "Tour",
  "Activity",
  "OA",
  "API",
  "Payment",
] as const;
