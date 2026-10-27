/**
 * 落盘通道统一接口：FSA（标配）⇄ downloads（兜底）。
 *
 * 通道优先级：
 * 1. FSA 直写（SW 内 createWritable，Chrome 109+）
 * 2. FSA 经 Offscreen Document 写（SW 直写不可用时的兜底）
 * 3. chrome.downloads（未授权 / 句柄失效）
 */
import { getRootHandle } from './fsa-store';
import type { SaveChannel } from '../shared/types';

/** 收藏根目录名（downloads 兜底时的前缀目录） */
export const ROOT_FOLDER = 'WYSIWYG-Favorites';

export interface ChannelSaveResult {
  ok: boolean;
  channel: SaveChannel;
  error?: string;
}

/** 保存文本内容 */
export async function saveTextFile(relPath: string, content: string): Promise<ChannelSaveResult> {
  const fsa = await saveWithFSA(relPath, content);
  if (fsa.ok) return fsa;
  return saveWithDownloads(relPath, content);
}

/** 保存二进制（图片） */
export async function saveBinaryFile(relPath: string, data: ArrayBuffer, mime: string): Promise<ChannelSaveResult> {
  const fsa = await saveWithFSA(relPath, data);
  if (fsa.ok) return fsa;
  return saveWithDownloads(relPath, data, mime);
}

/* ------------------------------------------------------------------ */
/* FSA                                                                  */
/* ------------------------------------------------------------------ */

/** FSA 状态（持久化，供 popup 展示降级警告） */
export type FsaState = 'ok' | 'stale' | 'none';

async function setFsaState(state: FsaState): Promise<void> {
  await chrome.storage.local.set({ fsaState: { state, at: Date.now() } });
}

/** 读取 FSA 状态（popup 用） */
export async function getFsaState(): Promise<{ state: FsaState; at: number } | null> {
  const obj = await chrome.storage.local.get('fsaState');
  return obj.fsaState ?? null;
}

/**
 * 检查 FSA 可用性。
 * 返回 null 表示从未授权（非异常）；返回 stale=true 表示句柄存在但权限丢失，需要用户重新授权。
 */
async function checkFsa(): Promise<{ root: FileSystemDirectoryHandle; stale: false } | { root: FileSystemDirectoryHandle; stale: true } | null> {
  const root = await getRootHandle();
  if (!root) return null;
  try {
    const perm = await root.queryPermission({ mode: 'readwrite' });
    return perm === 'granted' ? { root, stale: false } : { root, stale: true };
  } catch {
    return { root, stale: true };
  }
}

/** 按相对路径逐级解析/创建目录句柄 */
async function resolveDirs(root: FileSystemDirectoryHandle, relPath: string): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = relPath.split('/').filter(Boolean);
  const name = parts.pop()!;
  let dir = root;
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create: true });
  }
  return { dir, name };
}

async function writeWithHandle(dir: FileSystemDirectoryHandle, name: string, data: string | ArrayBuffer): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

async function saveWithFSA(relPath: string, data: string | ArrayBuffer): Promise<ChannelSaveResult> {
  const checked = await checkFsa();
  if (!checked) {
    await setFsaState('none');
    return { ok: false, channel: 'fsa', error: 'no-root' };
  }
  if (checked.stale) {
    await setFsaState('stale');
    return { ok: false, channel: 'fsa', error: 'stale-permission' };
  }

  const { dir, name } = await resolveDirs(checked.root, relPath);
  // 通道 1：SW 直写
  try {
    await writeWithHandle(dir, name, data);
    await setFsaState('ok');
    return { ok: true, channel: 'fsa' };
  } catch {
    // 通道 2：Offscreen 兜底（SW createWritable 不可用时）
    try {
      const res = await writeViaOffscreen(relPath, data);
      await setFsaState('ok');
      return res;
    } catch (e) {
      await setFsaState('stale');
      return { ok: false, channel: 'fsa', error: String(e) };
    }
  }
}

/** 让 Offscreen Document 代写（handle 从共享 IndexedDB 读取） */
async function writeViaOffscreen(relPath: string, data: string | ArrayBuffer): Promise<ChannelSaveResult> {
  await ensureOffscreen();
  const payload = {
    type: 'FSA_WRITE' as const,
    relPath,
    text: typeof data === 'string' ? data : undefined,
    base64: typeof data === 'string' ? undefined : arrayBufferToBase64(data),
  };
  const res = await chrome.runtime.sendMessage(payload) as { ok: boolean; error?: string } | undefined;
  if (res?.ok) return { ok: true, channel: 'fsa' };
  throw new Error(res?.error ?? 'offscreen write failed');
}

async function ensureOffscreen(): Promise<void> {
  const has = await chrome.offscreen.hasDocument?.();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/index.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'FSA 文件写入兜底通道',
    });
  }
}

/* ------------------------------------------------------------------ */
/* downloads 兜底                                                       */
/* ------------------------------------------------------------------ */

async function saveWithDownloads(relPath: string, data: string | ArrayBuffer, mime = 'text/markdown'): Promise<ChannelSaveResult> {
  let url: string;
  if (typeof data === 'string') {
    url = `data:text/markdown;charset=utf-8;base64,${arrayBufferToBase64(new TextEncoder().encode(data).buffer as ArrayBuffer)}`;
  } else {
    url = `data:${mime};base64,${arrayBufferToBase64(data)}`;
  }
  // 失败重试：指数退避（200ms / 400ms），共 3 次尝试
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chrome.downloads.download({
        url,
        filename: `${ROOT_FOLDER}/${relPath}`,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      return { ok: true, channel: 'downloads' };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }
  return { ok: false, channel: 'downloads', error: String(lastErr) };
}

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** sha-256（SW/页面均可用） */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------------------------ */
/* _meta 侧车文件（queue.jsonl / index.json）                            */
/* ------------------------------------------------------------------ */

/** 追加一条队列事件（仅 FSA 可用时写入；契约见开发计划 §3.4） */
export async function appendQueueEvent(file: string): Promise<void> {
  const checked = await checkFsa();
  if (!checked || checked.stale) return;
  try {
    const metaDir = await checked.root.getDirectoryHandle('_meta', { create: true });
    const fh = await metaDir.getFileHandle('queue.jsonl', { create: true });
    const existing = await fh.getFile().then((f) => f.text()).catch(() => '');
    const line = JSON.stringify({ file, event: 'created', ts: Date.now() }) + '\n';
    await writeWithHandle(metaDir, 'queue.jsonl', existing + line);
  } catch (e) {
    console.warn('[wysiwyg-clipper] appendQueueEvent failed:', e);
  }
}

/** 导出收藏索引到 _meta/index.json（仅 FSA 可用时写入） */
export async function writeIndexSnapshot(index: unknown): Promise<void> {
  const checked = await checkFsa();
  if (!checked || checked.stale) return;
  try {
    const metaDir = await checked.root.getDirectoryHandle('_meta', { create: true });
    await writeWithHandle(metaDir, 'index.json', JSON.stringify(index, null, 2));
  } catch (e) {
    console.warn('[wysiwyg-clipper] writeIndexSnapshot failed:', e);
  }
}
