/**
 * Offscreen Document：FSA 写入兜底通道。
 * SW 的 createWritable 在部分 Chrome 版本不可用时，由本上下文代写。
 * 根目录句柄从共享 IndexedDB 读取（同扩展 origin）。
 */
import { getRootHandle } from '../background/fsa-store';
import { base64ToBlob } from '../background/saver';

async function resolveDirs(root: FileSystemDirectoryHandle, relPath: string): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = relPath.split('/').filter(Boolean);
  const name = parts.pop()!;
  let dir = root;
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create: true });
  }
  return { dir, name };
}

async function write(relPath: string, text?: string, base64?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const root = await getRootHandle();
    if (!root) return { ok: false, error: 'no root handle' };
    const perm = await root.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return { ok: false, error: 'permission not granted' };
    const { dir, name } = await resolveDirs(root, relPath);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    if (text !== undefined) {
      await w.write(new Blob([text], { type: 'text/markdown' }));
    } else if (base64 !== undefined) {
      await w.write(base64ToBlob(base64, 'application/octet-stream'));
    } else {
      await w.close();
      return { ok: false, error: 'empty payload' };
    }
    await w.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'FSA_WRITE') {
    write(msg.relPath, msg.text, msg.base64).then(sendResponse);
    return true;
  }
  return false;
});
