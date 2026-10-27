/**
 * 收藏索引维护：chrome.storage.local + 角标计数反馈。
 * MV3 SW 随时可能被杀 —— 全部状态持久化，不依赖内存变量。
 */
import type { ClipIndexEntry, ClipType } from '../shared/types';
import { writeIndexSnapshot } from './saver';

const CLIPS_KEY = 'clips';
const MAX_CLIPS = 500;

/** 读取全部索引（新→旧） */
export async function getClips(): Promise<ClipIndexEntry[]> {
  const obj = await chrome.storage.local.get(CLIPS_KEY);
  return obj[CLIPS_KEY] ?? [];
}

export async function getRecent(n: number): Promise<ClipIndexEntry[]> {
  return (await getClips()).slice(0, n);
}

/** 新增索引条目（去重键：path 冲突时覆盖旧记录） */
export async function addClip(entry: ClipIndexEntry): Promise<void> {
  const clips = await getClips();
  const filtered = clips.filter((c) => c.path !== entry.path);
  filtered.unshift(entry);
  const trimmed = filtered.slice(0, MAX_CLIPS);
  await chrome.storage.local.set({ [CLIPS_KEY]: trimmed });
  await updateBadge(trimmed);
  writeIndexSnapshot(trimmed).catch(() => undefined);
}

/**
 * 去重（F8 / M3 完善）：同 URL 且同内容 hash 才视为重复。
 * 不同 URL 的相同内容是合理引用场景（同一篇被多处摘录），允许保存。
 */
export async function findDuplicate(hash: string, url: string): Promise<ClipIndexEntry | undefined> {
  if (!hash) return undefined;
  const clips = await getClips();
  return clips.find((c) => c.hash === hash && c.url === url);
}

/** 计算同目录下的既有文件名集合（用于冲突检测） */
export async function getDirConflictNames(relDir: string): Promise<Set<string>> {
  const clips = await getClips();
  const names = new Set<string>();
  for (const c of clips) {
    const slash = c.path.lastIndexOf('/');
    if (slash > 0 && c.path.slice(0, slash) === relDir) {
      names.add(c.path.slice(slash + 1));
    }
  }
  return names;
}

/**
 * 删除索引条目（仅从 popup 列表移除）。
 * 注意：按风险提示 #4，插件绝不删除收藏根目录里的 Markdown 真身文件。
 */
export async function removeClip(path: string): Promise<boolean> {
  const clips = await getClips();
  const next = clips.filter((c) => c.path !== path);
  if (next.length === clips.length) return false;
  await chrome.storage.local.set({ [CLIPS_KEY]: next });
  await updateBadge(next);
  writeIndexSnapshot(next).catch(() => undefined);
  return true;
}

/** 一键清空索引（仅移除列表条目；Markdown 真身文件保留在收藏目录） */
export async function clearClips(): Promise<number> {
  const clips = await getClips();
  await chrome.storage.local.set({ [CLIPS_KEY]: [] });
  await updateBadge([]);
  writeIndexSnapshot([]).catch(() => undefined);
  return clips.length;
}

/** 今日收藏数 → 角标 */
export async function updateBadge(clips?: ClipIndexEntry[]): Promise<void> {
  const list = clips ?? (await getClips());
  const today = new Date().toDateString();
  const count = list.filter((c) => new Date(c.savedAt).toDateString() === today).length;
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
}

export type { ClipType };
