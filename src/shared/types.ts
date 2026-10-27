/** 收藏类型 */
export type ClipType = 'snippet' | 'image' | 'page';

/** 落盘通道 */
export type SaveChannel = 'fsa' | 'downloads';

/** front-matter 元数据（契约见开发计划 §3.4） */
export interface ClipMeta {
  type: ClipType;
  url: string;
  host: string;
  title: string;
  /** ISO 8601 带时区 */
  saved_at: string;
  context_before?: string;
  context_after?: string;
  tags: string[];
  ai_status: 'pending' | 'summarized' | 'skipped';
}

/** Content Script → SW：保存文本选区 */
export interface SaveSnippetMsg {
  type: 'SAVE_SNIPPET';
  /** 选区 HTML（原始克隆片段序列化） */
  html: string;
  /** 纯文本（兜底/去重） */
  text: string;
  /** 选区 HTML→MD 转换结果（Content Script 侧转换，SW 无 DOM） */
  markdown?: string;
  /** 选区内的图片绝对 URL 列表（混排收藏：随文本下载到 img/ 并回写相对路径） */
  images?: string[];
  contextBefore: string;
  contextAfter: string;
  url: string;
  title: string;
}

/** Content Script → SW：保存整页（已抽取为 Markdown） */
export interface SavePageMsg {
  type: 'SAVE_PAGE';
  markdown: string;
  url: string;
  title: string;
}

/** SW → Content Script：请求抽取整页 */
export interface ExtractPageMsg {
  type: 'EXTRACT_PAGE';
}

/** Content Script → SW：抽取结果 */
export interface ExtractPageResultMsg {
  type: 'EXTRACT_PAGE_RESULT';
  ok: boolean;
  markdown?: string;
  error?: string;
}

/** SW 保存结果 */
export interface SaveResult {
  ok: boolean;
  /** 相对收藏根目录的路径 */
  path?: string;
  channel?: SaveChannel;
  duplicate?: boolean;
  /** 本次随文保存成功的图片数 */
  imagesSaved?: number;
  error?: string;
}

export type ContentMessage = SaveSnippetMsg | SavePageMsg | ExtractPageResultMsg;
export type AnyMessage = ContentMessage | ExtractPageMsg;

/** 收藏索引条目（chrome.storage.local） */
export interface ClipIndexEntry {
  path: string;
  type: ClipType;
  url: string;
  title: string;
  savedAt: number;
  /** 内容 sha-256（文本型收藏用于去重） */
  hash?: string;
  channel: SaveChannel;
}

/** 侧车队列事件（契约见开发计划 §3.4） */
export interface QueueEvent {
  file: string;
  event: 'created';
  ts: number;
}
