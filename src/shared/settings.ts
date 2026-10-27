/**
 * 插件设置（chrome.storage.local）。
 */
export interface Settings {
  /** 是否记录选区上下文（前后各 ~100 字） */
  withContext: boolean;
  /** 排除站点列表（host 关键词匹配） */
  excludedHosts: string[];
  /** 文件名中内容 slug 的最大长度 */
  contentSlugLen: number;
}

const DEFAULTS: Settings = {
  withContext: true,
  excludedHosts: [],
  contentSlugLen: 30,
};

export async function getSettings(): Promise<Settings> {
  const obj = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(obj.settings ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** 命中排除站点列表 */
export function isExcluded(settings: Settings, url: string): boolean {
  if (settings.excludedHosts.length === 0) return false;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return settings.excludedHosts.some((kw) => kw && host.includes(kw.toLowerCase()));
}
