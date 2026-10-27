import { useEffect, useState } from 'preact/hooks';
import type { ClipIndexEntry } from '../shared/types';

const TYPE_EMOJI: Record<string, string> = { snippet: '📝', image: '🖼', page: '📄' };

export function App() {
  const [clips, setClips] = useState<ClipIndexEntry[]>([]);
  const [rootName, setRootName] = useState('');

  useEffect(() => {
    chrome.storage.local.get('clips').then((obj) => setClips(obj.clips ?? []));
    import('../background/fsa-store').then(({ getRootHandle }) =>
      getRootHandle().then((h) => setRootName(h?.name ?? '')),
    );
  }, []);

  function openClip(entry: ClipIndexEntry) {
    chrome.tabs.create({ url: entry.url });
  }

  async function removeClip(e: MouseEvent, entry: ClipIndexEntry) {
    e.stopPropagation();
    const label = entry.title || entry.path;
    if (!confirm(`从收藏列表移除「${label.slice(0, 30)}」？\n\n（Markdown 文件仍保留在收藏目录中，可手动删除）`)) {
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'DELETE_CLIP', path: entry.path });
    if (res?.ok) {
      setClips((prev) => prev.filter((c) => c.path !== entry.path));
    }
  }

  return (
    <div class="clips-page">
      <h1>🔖 全部收藏（{clips.length}）</h1>
      {rootName && <p class="root-line">📁 收藏根目录：{rootName}</p>}
      <p class="hint">
        提示：插件授权的目录（File System Access）出于浏览器安全限制无法由插件直接在 Finder 打开；
        Downloads 兜底通道的文件位于 <code>Downloads/WYSIWYG-Favorites/</code>，可在 Popup 点「查看更多」直接定位。
      </p>

      {clips.length === 0 ? (
        <p class="empty">还没有收藏。</p>
      ) : (
        <ul>
          {clips.map((c) => (
            <li key={c.path} onClick={() => openClip(c)} title={c.url}>
              <span class="emoji">{TYPE_EMOJI[c.type] ?? '📝'}</span>
              <span class="title">{c.title || c.path}</span>
              <span class="time">
                {new Date(c.savedAt).toLocaleString('zh-CN', {
                  year: 'numeric',
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
      )}
    </div>
  );
}
