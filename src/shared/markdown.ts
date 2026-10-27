import type { ClipMeta, ClipType } from './types';

/** 上下文截取长度（选中文字前/后各 ~100 字） */
const CONTEXT_LEN = 100;

/** 截断上下文并折叠换行 */
export function clipContext(text: string, len = CONTEXT_LEN): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= len) return t;
  return t.slice(0, len) + '…';
}

/** YAML 值转义：双引号包裹 + 内部双引号转义 */
function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

/**
 * 生成完整 Markdown 文件内容（front-matter + 正文）。
 * 契约见开发计划 §3.4 —— 二期 Watcher 仅依赖此格式，字段顺序不可随意变更。
 */
export function buildMarkdownFile(meta: ClipMeta, body: string): string {
  const lines: string[] = ['---'];
  lines.push(`type: ${meta.type}`);
  lines.push(`url: ${yamlStr(meta.url)}`);
  lines.push(`host: ${meta.host}`);
  lines.push(`title: ${yamlStr(meta.title)}`);
  lines.push(`saved_at: ${meta.saved_at}`);
  if (meta.type === 'snippet') {
    lines.push(`context_before: ${yamlStr(meta.context_before ?? '')}`);
    lines.push(`context_after: ${yamlStr(meta.context_after ?? '')}`);
  }
  lines.push(`tags: []`);
  lines.push(`ai_status: ${meta.ai_status}`);
  lines.push('---', '');
  lines.push(body.trimEnd(), '');
  return lines.join('\n');
}

/** 由 URL 提取 host（失败返回 unknown） */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/** 纯文本 → Markdown 兜底：段落间空行 */
export function textToMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** 便捷构造 ClipMeta */
export function makeMeta(opts: {
  type: ClipType;
  url: string;
  title: string;
  savedAt?: Date;
  contextBefore?: string;
  contextAfter?: string;
}): ClipMeta {
  return {
    type: opts.type,
    url: opts.url,
    host: hostOf(opts.url),
    title: opts.title || opts.url,
    saved_at: (opts.savedAt ?? new Date()).toISOString(),
    context_before: opts.contextBefore,
    context_after: opts.contextAfter,
    tags: [],
    ai_status: 'pending',
  };
}
