import { useEffect, useState } from 'preact/hooks';
import type { ClipIndexEntry } from '../shared/types';
import { getRootHandle } from '../background/fsa-store';
import { getFsaState } from '../background/saver';

const TYPE_EMOJI: Record<string, string> = { snippet: '📝', image: '🖼', page: '📄' };

/** popup 列表最多展示条数 */
const MAX_VISIBLE = 5;

/**
 * 打开本地收藏目录：
 * downloads 通道文件 → chrome.downloads.show 在 Finder 中定位（浏览器唯一可靠的打开方式）；
 * 无 download 记录（纯 FSA 用户）→ 打开全量收藏列表页兜底
 * （FSA 授权目录出于浏览器安全限制无法由插件直接 reveal，Chrome 不暴露完整路径）。
 */
async function openLocalFolder(): Promise<void> {
  try {
    const items = await chrome.downloads.search({ filenameRegex: '.*WYSIWYG-Favorites.*' });
    const latest = items
      .filter((it) => it.state === 'complete')
      .sort((a, b) => (b.endTime ?? '').localeCompare(a.endTime ?? ''));
    if (latest.length > 0) {
      chrome.downloads.show(latest[0].id);
      return;
    }
  } catch {
    // downloads API 异常 → 走列表页兜底
  }
  chrome.tabs.create({ url: 'src/clips/index.html' });
}

export function App() {
  const [clips, setClips] = useState<ClipIndexEntry[]>([]);
  const [rootName, setRootName] = useState<string | null>(null);
  const [fsaStale, setFsaStale] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    chrome.storage.local.get('clips').then((obj) => setClips(obj.clips ?? []));
    getRootHandle().then(async (h) => {
      if (h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') {
        setRootName(h.name);
      }
    });
    getFsaState().then((s) => setFsaStale(s?.state === 'stale'));
  }, []);

  /** 整页收藏（F10）：未选中内容时点击插件图标的主入口 */
  async function saveWholePage() {
    setSaving(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('无法定位活动标签页');
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        throw new Error('浏览器内部页面无法收藏');
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PAGE' });
      window.close();
    } catch (e) {
      alert(`整页收藏失败：${String(e)}\n（页面刷新一次后重试）`);
      setSaving(false);
    }
  }

  function openSettings() {
    chrome.runtime.openOptionsPage();
  }

  function openClip(entry: ClipIndexEntry) {
    chrome.tabs.create({ url: entry.url });
  }

  /** 删除：仅从列表移除索引，Markdown 文件保留在收藏目录（插件绝不删真身） */
  async function removeClip(e: MouseEvent, entry: ClipIndexEntry) {
    e.stopPropagation();
    const label = entry.title || entry.path;
    if (!confirm(`从最近收藏列表移除「${label.slice(0, 30)}」？\n\n（Markdown 文件仍保留在收藏目录中，可手动删除）`)) {
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'DELETE_CLIP', path: entry.path });
    if (res?.ok) {
      setClips((prev) => prev.filter((c) => c.path !== entry.path));
    }
  }

  /** 一键清空：仅移除列表索引，Markdown 文件保留在收藏目录 */
  async function clearAllClips() {
    if (clips.length === 0) return;
    if (!confirm(`清空最近收藏列表（共 ${clips.length} 条）？\n\n注意：仅移除列表记录，Markdown 文件仍全部保留在收藏目录中。`)) {
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'CLEAR_CLIPS' });
    if (res?.ok) {
      setClips([]);
    }
  }

  return (
    <div class="popup">
      <header>
        <h1>🔖 所见即所得收藏夹</h1>
        <span class={`root-status ${rootName ? 'ok' : 'warn'}`}>
          {rootName ? `📁 ${rootName}` : '⚠️ 未授权收藏根目录'}
        </span>
      </header>

      {fsaStale && (
        <div class="stale-banner" onClick={openSettings} role="button">
          ⚠️ 收藏根目录授权已失效，近期收藏走了 Downloads 兜底。点击去设置重新授权
        </div>
      )}

      <button class="primary" disabled={saving} onClick={saveWholePage}>
        {saving ? '抽取中…' : '📄 整页收藏此页'}
      </button>

      <section>
        <div class="section-head">
          <h2>最近收藏</h2>
          {clips.length > 0 && (
            <button class="clear-all" onClick={clearAllClips} title="清空列表（文件保留）">
              🧹 清空
            </button>
          )}
        </div>
        {clips.length === 0 ? (
          <p class="empty">还没有收藏。选中网页文字试试～</p>
        ) : (
          <>
            <ul>
              {clips.slice(0, MAX_VISIBLE).map((c) => (
                <li key={c.path} onClick={() => openClip(c)} title={c.path}>
                  <span class="emoji">{TYPE_EMOJI[c.type] ?? '📝'}</span>
                  <span class="title">{c.title || c.path}</span>
                  <span class="time">
                    {new Date(c.savedAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    class="delete"
                    title="从列表移除（文件保留）"
                    onClick={(e) => removeClip(e as unknown as MouseEvent, c)}
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
            {clips.length > MAX_VISIBLE && (
              <button class="more" onClick={openLocalFolder}>
                查看更多（还有 {clips.length - MAX_VISIBLE} 条）→ 打开收藏目录
              </button>
            )}
          </>
        )}
      </section>

      <footer>
        <button onClick={openSettings}>⚙️ 设置</button>
        {!rootName && <span class="hint">请先在设置中授权收藏根目录</span>}
      </footer>
    </div>
  );
}
