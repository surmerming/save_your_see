/**
 * 收藏编排：消息载荷 → 命名引擎 → Markdown 渲染 → 落盘 → 索引/队列。
 */
import { dirForUrl, makeFileName, makeImageFileName, imageDirForUrl, imageExtFromUrlOrMime } from '../shared/naming';
import { buildMarkdownFile, makeMeta, clipContext, textToMarkdown } from '../shared/markdown';
import { getSettings, isExcluded } from '../shared/settings';
import type { SaveResult, SaveSnippetMsg, SavePageMsg } from '../shared/types';
import { saveTextFile, saveBinaryFile, sha256Hex, appendQueueEvent, ROOT_FOLDER } from './saver';
import { addClip, findDuplicate, getDirConflictNames } from './indexer';

export async function saveSnippet(msg: SaveSnippetMsg): Promise<SaveResult> {
  try {
    const settings = await getSettings();
    if (isExcluded(settings, msg.url)) {
      return { ok: false, error: '该站点已在排除列表中' };
    }

    // 去重（F8）：同 URL 且同内容 hash 已存在 → 跳过
    const hash = await sha256Hex(msg.text);
    const dup = await findDuplicate(hash, msg.url);
    if (dup) {
      return { ok: true, duplicate: true, path: dup.path, channel: dup.channel };
    }

    const now = new Date();
    const relDir = dirForUrl(msg.url, now);
    const conflicts = await getDirConflictNames(relDir);
    // 同一页面收藏多条时，用「选中文本首行」作展示标题与文件名 slug（页面标题全部相同，无法区分）
    const displayTitle = snippetTitle(msg.text, msg.title);
    const fileName = makeFileName(displayTitle, now, conflicts, 'md');
    const relPath = `${relDir}/${fileName}`;

    const meta = makeMeta({
      type: 'snippet',
      url: msg.url,
      title: msg.title,
      savedAt: now,
      contextBefore: settings.withContext ? clipContext(msg.contextBefore ?? '') : undefined,
      contextAfter: settings.withContext ? clipContext(msg.contextAfter ?? '') : undefined,
    });
    let md = buildMarkdownFile(meta, msg.markdown ?? textToMarkdown(msg.text));

    // 混排收藏：选区内联图片先落盘到 img/，再把 Markdown 中的远程 URL 替换为本地相对路径
    let imagesSaved = 0;
    if (msg.images && msg.images.length > 0) {
      const imgDir = imageDirForUrl(msg.url, now); // {YYYYMMDD}/{host}/{path-slug}/img —— 与 .md 同目录
      const map = await saveInlineImages(msg.images, imgDir, now);
      imagesSaved = map.size;
      if (map.size > 0) md = rewriteImagePaths(md, map);
    }

    const saved = await saveTextFile(relPath, md);
    if (!saved.ok) return { ok: false, error: saved.error };

    await afterSave(relPath, 'snippet', msg.url, displayTitle, hash, saved.channel);
    return { ok: true, path: relPath, channel: saved.channel, imagesSaved: imagesSaved > 0 ? imagesSaved : undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * snippet 展示标题：选中文本首个非空行（≤30 字），空则回退页面标题。
 * front-matter 的 title 字段仍保持页面标题（AI 契约 §3.4），此处仅影响文件名与索引展示。
 */
function snippetTitle(text: string, fallback: string): string {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return fallback || '未命名选段';
  return firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine;
}

export async function savePage(msg: SavePageMsg): Promise<SaveResult> {
  try {
    const settings = await getSettings();
    if (isExcluded(settings, msg.url)) {
      return { ok: false, error: '该站点已在排除列表中' };
    }

    const hash = await sha256Hex(msg.markdown);
    const dup = await findDuplicate(hash, msg.url);
    if (dup) {
      return { ok: true, duplicate: true, path: dup.path, channel: dup.channel };
    }

    const now = new Date();
    const relDir = dirForUrl(msg.url, now);
    const conflicts = await getDirConflictNames(relDir);
    const fileName = makeFileName(msg.title, now, conflicts, 'md');
    const relPath = `${relDir}/${fileName}`;

    const meta = makeMeta({ type: 'page', url: msg.url, title: msg.title, savedAt: now });
    const md = buildMarkdownFile(meta, msg.markdown);

    const saved = await saveTextFile(relPath, md);
    if (!saved.ok) return { ok: false, error: saved.error };

    await afterSave(relPath, 'page', msg.url, msg.title, hash, saved.channel);
    return { ok: true, path: relPath, channel: saved.channel };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * 下载选区内联图片到 imgDir，返回 src → 本地相对路径（img/xxx.ext）映射。
 * 单张失败不影响整体（失败的保留远程 URL）。
 */
async function saveInlineImages(srcs: string[], imgDir: string, now: Date): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const conflicts = await getDirConflictNames(imgDir);
  let seq = conflicts.size + 1;

  for (const src of srcs) {
    const dl = await downloadImageBlob(src);
    if (!dl) continue; // 下载失败 → Markdown 保留远程 URL
    const ext = imageExtFromUrlOrMime(src, dl.mime);
    let name = makeImageFileName(seq++, ext, now);
    while (conflicts.has(name)) name = makeImageFileName(seq++, ext, now);
    conflicts.add(name);

    const relPath = `${imgDir}/${name}`;
    const saved = await saveBinaryFile(relPath, dl.buf, dl.mime);
    if (!saved.ok) continue;
    map.set(src, `img/${name}`);
    void appendQueueEvent(relPath);
  }
  return map;
}

/**
 * 下载图片（防盗链：SW fetch 带 credentials，host_permissions 全站）。
 * 返回 null 表示失败，由调用方降级。
 */
async function downloadImageBlob(srcUrl: string): Promise<{ buf: ArrayBuffer; mime: string } | null> {
  try {
    const res = await fetch(srcUrl, { credentials: 'include' });
    if (!res.ok) return null;
    const mime = res.headers.get('content-type') ?? 'image/jpeg';
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) return null;
    return { buf, mime };
  } catch {
    return null;
  }
}

/**
 * 把 Markdown 中图片的远程 URL 替换为本地相对路径。
 * 兼容 turndown 对括号的转义形式 `\(` `\)`。
 */
function rewriteImagePaths(md: string, map: Map<string, string>): string {
  for (const [src, local] of map) {
    const escaped = src.replace(/([()])/g, '\\$1');
    md = md.split(escaped).join(local).split(src).join(local);
  }
  return md;
}

export async function saveImage(srcUrl: string, pageUrl: string): Promise<SaveResult> {
  try {
    const settings = await getSettings();
    if (isExcluded(settings, pageUrl)) {
      return { ok: false, error: '该站点已在排除列表中' };
    }

    const now = new Date();
    const relDir = imageDirForUrl(pageUrl, now);
    const ext = imageExtFromUrlOrMime(srcUrl);
    const fileName = makeImageFileName(await nextImageSeq(relDir), ext, now);
    const relPath = `${relDir}/${fileName}`;

    let channel: 'fsa' | 'downloads';
    const dl = await downloadImageBlob(srcUrl);
    if (dl) {
      const saved = await saveBinaryFile(relPath, dl.buf, dl.mime);
      if (!saved.ok) return { ok: false, error: saved.error };
      channel = saved.channel;
    } else {
      // 降级：交由浏览器 downloads 直取（自带页面 Referer 策略，可绕过部分防盗链）
      const finalName = `${makeImageFileName(await nextImageSeq(relDir), ext, now)}`;
      await chrome.downloads.download({
        url: srcUrl,
        filename: `${ROOT_FOLDER}/${relDir}/${finalName}`,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      channel = 'downloads';
      await afterSave(`${relDir}/${finalName}`, 'image', pageUrl, `图片 ${finalName}`, undefined, channel);
      return { ok: true, path: `${relDir}/${finalName}`, channel };
    }

    await afterSave(relPath, 'image', pageUrl, `图片 ${fileName}`, undefined, channel);
    return { ok: true, path: relPath, channel };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 图片序号：同 img/ 目录下已有图片数 + 1 */
async function nextImageSeq(relDir: string): Promise<number> {
  const conflicts = await getDirConflictNames(relDir);
  return conflicts.size + 1;
}

/** 保存后统一动作：索引（阻塞，角标/去重依赖）+ 队列（后台，不阻塞结果返回） */
async function afterSave(
  relPath: string,
  type: 'snippet' | 'image' | 'page',
  url: string,
  title: string,
  hash: string | undefined,
  channel: 'fsa' | 'downloads',
): Promise<void> {
  await addClip({
    path: relPath,
    type,
    url,
    title,
    savedAt: Date.now(),
    hash,
    channel,
  });
  // queue.jsonl 是读全文+重写的侧车写，耗时随历史增长 —— 后台执行，不让用户等
  void appendQueueEvent(relPath);
}
