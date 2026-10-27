/**
 * HTML → Markdown 转换（F9 / F10）。
 *
 * 注意：turndown 依赖 DOM，只能在 Content Script / Popup / Offscreen 等
 * 有 DOM 的上下文中调用；Service Worker 不要 import 本模块。
 */
import TurndownService from 'turndown';

let instance: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (instance) return instance;
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  // 保留换行 <br>
  td.addRule('linebreak', {
    filter: ['br'],
    replacement: () => '\n',
  });
  // 过滤无意义的脚本/样式节点
  td.remove(['script', 'style', 'noscript']);
  instance = td;
  return td;
}

/** 富文本选区 HTML → MD（保留加粗/链接/列表/代码块，基础格式） */
export function htmlToMarkdown(html: string): string {
  try {
    const md = getTurndown().turndown(html);
    return md.trim();
  } catch {
    return '';
  }
}

/** 整页正文 HTML → MD */
export function pageHtmlToMarkdown(html: string): string {
  return htmlToMarkdown(html);
}
