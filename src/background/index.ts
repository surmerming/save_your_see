/**
 * Service Worker 入口：contextMenus 注册、commands 快捷键、消息路由。
 * MV3 事件驱动 —— 不在内存缓存任何"必须活着"的状态。
 */
import type { SaveSnippetMsg, SavePageMsg, ExtractPageResultMsg } from '../shared/types';
import { saveSnippet, savePage, saveImage } from './clipper';
import { updateBadge, removeClip, clearClips } from './indexer';

chrome.runtime.onInstalled.addListener(() => {
  // 插件重载/更新后旧菜单会残留，直接 create 会报 duplicate id —— 先清空再注册
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'clip-selection',
      title: '🔖 收藏选中文本',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'clip-image',
      title: '🖼 收藏此图片',
      contexts: ['image'],
    });
  });
  updateBadge().catch(() => undefined);
});

chrome.runtime.onStartup?.addListener(() => {
  updateBadge().catch(() => undefined);
});

/** 快捷键 Alt+S → 让活动标签页的 Content Script 保存当前选区 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'COMMAND_SAVE_SELECTION' }).catch(() => undefined);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'clip-image' && info.srcUrl) {
    const pageUrl = tab?.url ?? info.pageUrl ?? info.srcUrl;
    await saveImage(info.srcUrl, pageUrl);
  } else if (info.menuItemId === 'clip-selection' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'COMMAND_SAVE_SELECTION' }).catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SAVE_SNIPPET') {
    saveSnippet(msg as SaveSnippetMsg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // 异步响应
  }
  if (msg?.type === 'SAVE_PAGE' || msg?.type === 'EXTRACT_PAGE_RESULT') {
    const { url, title, markdown } = msg as ExtractPageResultMsg & SavePageMsg;
    if (markdown) {
      savePage({ type: 'SAVE_PAGE', markdown, url, title })
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
    } else {
      sendResponse({ ok: false, error: (msg as ExtractPageResultMsg).error ?? 'empty markdown' });
    }
    return true;
  }
  if (msg?.type === 'DELETE_CLIP') {
    removeClip(msg.path as string)
      .then((removed) => sendResponse({ ok: removed }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'CLEAR_CLIPS') {
    clearClips()
      .then((count) => sendResponse({ ok: true, count }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  // FSA_WRITE 由 offscreen 处理，此处不拦截
  return false;
});
