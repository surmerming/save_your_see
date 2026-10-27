/**
 * 选区/整页内容捕获 —— 只在有 DOM 的 Content Script 上下文运行。
 */
import type { SaveResult, SaveSnippetMsg } from '../shared/types';
import { clipContext } from '../shared/markdown';
import { safeSendMessage } from './runtime';

/** 捕获当前文本选区并发送给 SW，返回保存结果（上下文失效时为 undefined） */
export async function captureSelection(): Promise<SaveResult | undefined> {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  // 克隆选区 DOM 片段并序列化（不污染页面）
  const frag = range.cloneContents();
  const wrap = document.createElement('div');
  wrap.appendChild(frag);
  const html = wrap.innerHTML;
  const text = sel.toString();

  // 选区内联图片（混排收藏）：收集绝对 URL 并去重
  const images = collectImageUrls(wrap);

  // 上下文：以选区起点所在块级容器的全文为源，截取前后 ~100 字
  const { before, after } = extractContext(range);

  // HTML→MD 在 Content Script 侧完成（SW 无 DOMParser）
  const { htmlToMarkdown } = await import('../shared/html-to-md');
  const markdown = htmlToMarkdown(html) || undefined;

  const msg: SaveSnippetMsg = {
    type: 'SAVE_SNIPPET',
    html,
    text,
    markdown,
    images: images.length > 0 ? images : undefined,
    contextBefore: before,
    contextAfter: after,
    url: location.href,
    title: document.title,
  };
  const res = await safeSendMessage<SaveResult>(msg);
  if (!res.ok) {
    // 上下文失效 → undefined（上层提示「扩展已更新，请刷新页面」）
    if (res.reason === 'orphan') return undefined;
    // 真实错误 → 带原始报错上抛，Toast 显示「保存失败：<原因>」
    return { ok: false, error: res.error };
  }
  return res.data;
}

/** 收集片段内 <img> 的绝对 URL（去重；相对 src 以页面地址为基准解析） */
function collectImageUrls(wrap: HTMLElement): string[] {
  const seen = new Set<string>();
  for (const img of wrap.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (!src) continue;
    try {
      const abs = new URL(src, location.href).href;
      if (abs.startsWith('http')) seen.add(abs);
    } catch {
      // 非法 URL 跳过，Markdown 中保留原样
    }
  }
  return [...seen];
}

/** 提取选区前后上下文 */
function extractContext(range: Range): { before: string; after: string } {
  try {
    let container: Node | null = range.startContainer;
    const block = (container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement
    )?.closest('p, div, article, section, li, td, blockquote, h1, h2, h3, h4, h5, h6');
    const source = (block?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!source) return { before: '', after: '' };

    const selected = range.toString().replace(/\s+/g, ' ').trim();
    const idx = source.indexOf(selected.slice(0, 60));
    if (idx < 0) return { before: '', after: '' };
    return {
      before: clipContext(source.slice(0, idx)),
      after: clipContext(source.slice(idx + selected.length)),
    };
  } catch {
    return { before: '', after: '' };
  }
}

/**
 * 整页抽取（F10）：克隆 document → Readability 抽正文 → turndown 转 MD。
 * 不修改真实页面 DOM。失败返回 null 由调用方兜底。
 */
export async function extractPage(): Promise<{ markdown: string; title: string; url: string } | null> {
  try {
    const { Readability } = await import('@mozilla/readability');
    const { pageHtmlToMarkdown } = await import('../shared/html-to-md');

    const doc = document.cloneNode(true) as Document;
    // 清理克隆文档中的脚本与样式干扰
    doc.querySelectorAll('script, noscript, iframe').forEach((el) => el.remove());

    const reader = new Readability(doc, { keepClasses: false });
    const article = reader.parse();

    const title = article?.title || document.title;
    if (article?.content) {
      const markdown = pageHtmlToMarkdown(article.content);
      if (markdown) return { markdown, title, url: location.href };
    }
    // 降级：正文抽取失败 → 全文纯文本
    const { textToMarkdown } = await import('../shared/markdown');
    const fallback = textToMarkdown(document.body?.innerText ?? '');
    if (fallback) return { markdown: fallback, title, url: location.href };
    return null;
  } catch (e) {
    console.warn('[wysiwyg-clipper] extractPage failed:', e);
    return null;
  }
}

/** 处理来自 Popup / SW 的抽取请求 */
export async function handleExtractRequest(): Promise<void> {
  const result = await extractPage();
  await safeSendMessage({
    type: 'EXTRACT_PAGE_RESULT',
    ok: !!result,
    markdown: result?.markdown,
    url: result?.url ?? location.href,
    title: result?.title ?? document.title,
    error: result ? undefined : '无法从该页面抽取正文',
  });
}
