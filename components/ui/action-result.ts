/**
 * 弹窗里保存 / 删除等操作的结果：
 * - ok：成功，由父组件关闭弹窗；
 * - error：留在弹窗里显示 message，可重试；
 * - redirecting：登录已失效、正在跳登录页，弹窗保持「进行中」状态不再操作。
 */
export type ActionResult =
  | { status: "ok" }
  | { status: "error"; message: string }
  | { status: "redirecting" };

export type ActionFailure = Exclude<ActionResult, { status: "ok" }>;
