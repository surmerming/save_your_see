import { useEffect, useState } from 'preact/hooks';
import { getRootHandle, setRootHandle, clearRootHandle } from '../background/fsa-store';
import { getSettings, saveSettings, type Settings } from '../shared/settings';

/** showDirectoryPicker 类型兼容（TS lib 版本差异） */
type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
};

type RootStatus = 'none' | 'granted' | 'stale';

export function App() {
  const [rootStatus, setRootStatus] = useState<RootStatus>('none');
  const [rootName, setRootName] = useState('');
  const [settings, setSettings] = useState<Settings>({ withContext: true, excludedHosts: [], contentSlugLen: 30 });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    refreshRoot();
    getSettings().then(setSettings);
  }, []);

  async function refreshRoot() {
    const h = await getRootHandle();
    if (!h) {
      setRootStatus('none');
      setRootName('');
      return;
    }
    try {
      const perm = await h.queryPermission({ mode: 'readwrite' });
      setRootName(h.name);
      setRootStatus(perm === 'granted' ? 'granted' : 'stale');
    } catch {
      setRootStatus('stale');
      setRootName(h.name);
    }
  }

  /** FSA 授权（需用户手势的页面上下文 —— 只能在 options/popup 调用） */
  async function pickRoot() {
    try {
      const picker = (window as PickerWindow).showDirectoryPicker;
      if (!picker) {
        setMsg('当前浏览器不支持目录选择 API，将使用 Downloads/WYSIWYG-Favorites 兜底');
        return;
      }
      const handle = await picker({ mode: 'readwrite', id: 'wysiwyg-clipper' });
      // Chrome 要求显式 requestPermission 持久化 readwrite 权限
      const perm = await (handle as FileSystemDirectoryHandle & {
        requestPermission: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
      }).requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        setMsg('未授予读写权限，收藏将走 Downloads 兜底通道');
        return;
      }
      await setRootHandle(handle);
      setMsg('✅ 收藏根目录已设置');
      await refreshRoot();
    } catch (e) {
      if (String(e).includes('abort')) return; // 用户取消
      setMsg(`授权失败：${String(e)}`);
    }
  }

  async function revokeRoot() {
    await clearRootHandle();
    setMsg('已解除授权，收藏将走 Downloads 兜底通道');
    await refreshRoot();
  }

  async function persist() {
    await saveSettings(settings);
    setMsg('✅ 设置已保存');
    window.setTimeout(() => setMsg(''), 2000);
  }

  return (
    <div class="options">
      <h1>🔖 所见即所得收藏夹 · 设置</h1>

      <section>
        <h2>收藏根目录（File System Access）</h2>
        <p class="desc">所有收藏将以 Markdown 文件形式保存到该目录，按「域名/路径」自动归类。</p>
        <div class="row">
          <span class={`badge ${rootStatus}`}>
            {rootStatus === 'granted' && `📁 已授权：${rootName}`}
            {rootStatus === 'stale' && `⚠️ 句柄失效，需重新授权：${rootName || '（未知）'}`}
            {rootStatus === 'none' && '未授权（当前使用 Downloads/WYSIWYG-Favorites 兜底）'}
          </span>
          <button onClick={pickRoot}>{rootStatus === 'none' ? '选择目录' : '重新选择'}</button>
          {rootStatus !== 'none' && <button class="danger" onClick={revokeRoot}>解除授权</button>}
        </div>
        {rootStatus === 'stale' && (
          <p class="warn">句柄失效通常由浏览器更新或清理站点数据导致，点击「重新选择」重新授权即可。</p>
        )}
      </section>

      <section>
        <h2>行为</h2>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.withContext}
            onChange={(e) => setSettings({ ...settings, withContext: (e.target as HTMLInputElement).checked })}
          />
          记录选区上下文（选中文字前后各 ~100 字）
        </label>
      </section>

      <section>
        <h2>排除站点</h2>
        <p class="desc">每行一个关键词，匹配到域名即不触发收藏。</p>
        <textarea
          rows={5}
          placeholder={'example.com\ndocs.google.com'}
          value={settings.excludedHosts.join('\n')}
          onChange={(e) =>
            setSettings({
              ...settings,
              excludedHosts: (e.target as HTMLTextAreaElement).value
                .split('\n')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            })
          }
        />
      </section>

      <div class="row">
        <button class="primary" onClick={persist}>保存设置</button>
        {msg && <span class="msg">{msg}</span>}
      </div>
    </div>
  );
}
