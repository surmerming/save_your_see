/**
 * Content Script 运行时守卫。
 *
 * 扩展重新加载/更新后，旧页面残留的 Content Script 上下文已失效
 * （chrome.runtime 访问会同步抛 "Extension context invalidated"），
 * 所有 chrome 调用必须先探测、再兜底，避免 Uncaught (in promise)。
 */

/** 扩展上下文是否仍有效 */
export function contextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export type SafeSendResult<T> =
  | { ok: true; data: T }
  /** 扩展上下文失效（旧页面残留脚本）—— 提示用户刷新页面 */
  | { ok: false; reason: 'orphan' }
  /** 真实错误 —— 带原始报错信息（如 SW 未运行、消息口关闭等） */
  | { ok: false; reason: 'error'; error: string };

/** 安全发送消息：区分「上下文失效」与「真实错误」，不吞错误信息 */
export async function safeSendMessage<T = unknown>(msg: unknown): Promise<SafeSendResult<T>> {
  if (!contextValid()) return { ok: false, reason: 'orphan' };
  try {
    const data = (await chrome.runtime.sendMessage(msg)) as T | undefined;
    if (data === undefined) {
      // 监听器存在但未 sendResponse（端口提前关闭）或 SW 异步链路中断
      return {
        ok: false,
        reason: 'error',
        error: '扩展后台未返回结果（Service Worker 可能异常），请到 chrome://extensions 查看本插件的 Service Worker 控制台报错',
      };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: 'error', error: String(e) };
  }
}
