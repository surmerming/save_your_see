/**
 * Content Script 入口：选区监听 + 浮动按钮 + 整页抽取请求处理。
 */
import { initFloatingButton, feedbackFromCommand } from './floating-button';
import { handleExtractRequest } from './capture';

function main(): void {
  // 避免在 iframe 中重复注入（只挂顶层窗口）
  if (window.top !== window.self) return;

  initFloatingButton();

  // 空闲时预热 turndown 动态 chunk，首次保存省去模块加载延迟
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      void import('../shared/html-to-md');
    });
  }

  // SW 转发来的 Alt+S 快捷键 / 右键菜单
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'COMMAND_SAVE_SELECTION') {
      feedbackFromCommand(); // 保存后 Toast 反馈 + 清除选区
      sendResponse({ ok: true });
    } else if (msg?.type === 'EXTRACT_PAGE') {
      handleExtractRequest();
      sendResponse({ ok: true });
    }
    return false;
  });
}

main();
