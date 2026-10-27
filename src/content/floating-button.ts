/**
 * 浮动保存按钮 + 保存反馈 Toast —— Shadow DOM 隔离样式，避免被宿主页面 CSS 污染。
 * 交互：出现非空文本选区 → 按钮出现在选区右上角附近；
 * 点击保存 → 清除选区 + Toast 反馈；滚动、失焦、选区消失时按钮隐藏。
 */
import type { SaveResult } from '../shared/types';
import { captureSelection } from './capture';

const HOST_ID = 'wysiwyg-clipper-anchor';
const TOAST_HOST_ID = 'wysiwyg-clipper-toast';

let host: HTMLDivElement | null = null;
let btn: HTMLButtonElement | null = null;
let toastHost: HTMLDivElement | null = null;
/** closed Shadow Root 无法二次访问（.shadowRoot 返回 null），必须在创建时持有引用 */
let toastShadow: ShadowRoot | null = null;
let hideTimer: number | undefined;
let toastTimer: number | undefined;
let suppressed = false;

function ensureButton(): void {
  if (host && btn) return;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;top:0;left:0;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .clip-btn {
      pointer-events: auto;
      display: flex; align-items: center; gap: 4px;
      padding: 4px 10px;
      border: none; border-radius: 6px;
      background: #1a73e8; color: #fff;
      font: 12px/1.4 -apple-system, "PingFang SC", sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.25);
      opacity: 0; transform: translateY(4px);
      transition: opacity .12s ease, transform .12s ease;
      user-select: none;
    }
    .clip-btn.show { opacity: 1; transform: translateY(0); }
    .clip-btn:hover { background: #1765cc; }
    .clip-btn:active { transform: translateY(1px); }
  `;
  btn = document.createElement('button');
  btn.className = 'clip-btn';
  btn.textContent = '🔖 收藏';
  btn.type = 'button';
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // 防止点击时选区丢失
  btn.addEventListener('click', onClick);
  shadow.appendChild(style);
  shadow.appendChild(btn);
  document.documentElement.appendChild(host);
}

function hide(): void {
  if (!host || !btn) return;
  btn.classList.remove('show');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (host) host.style.display = 'none';
  }, 150) as unknown as number;
}

function show(x: number, y: number): void {
  ensureButton();
  if (!host || !btn) return;
  window.clearTimeout(hideTimer);
  host.style.display = 'block';
  host.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
  btn.classList.add('show');
}

/* ------------------------------------------------------------------ */
/* 保存反馈 Toast（独立 host + position:fixed，viewport 右上角）          */
/* ------------------------------------------------------------------ */

function ensureToastHost(): void {
  if (toastHost && toastShadow) return;
  toastHost = document.createElement('div');
  toastHost.id = TOAST_HOST_ID;
  toastHost.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:none;';
  const shadow = toastHost.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .toast {
      padding: 9px 16px;
      border-radius: 8px;
      font: 13px/1.4 -apple-system, "PingFang SC", sans-serif;
      color: #fff;
      box-shadow: 0 4px 14px rgba(0,0,0,.28);
      opacity: 0; transform: translateY(-8px);
      transition: opacity .18s ease, transform .18s ease;
      user-select: none;
      max-width: 320px;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.ok { background: #1e8e3e; }
    .toast.warn { background: #b26a00; }
    .toast.err { background: #d93025; }
    .toast.pending { background: #1a73e8; }
  `;
  const el = document.createElement('div');
  el.className = 'toast';
  shadow.appendChild(style);
  shadow.appendChild(el);
  document.documentElement.appendChild(toastHost);
  toastShadow = shadow;
}

/** 显示 Toast；autoHide=false 时保持显示（用于「收藏中…」占位，由最终结果替换） */
function showToast(text: string, kind: 'ok' | 'warn' | 'err' | 'pending', autoHide = true): void {
  ensureToastHost();
  const el = toastShadow?.querySelector('.toast') as HTMLDivElement | null;
  if (!el) return;
  window.clearTimeout(toastTimer);
  el.textContent = text;
  el.className = `toast ${kind}`;
  // 强制 reframe 以重放过渡动画
  void el.offsetWidth;
  el.classList.add('show');
  if (autoHide) {
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
  }
}

/** 点击保存的即时反馈：先占位，结果返回后替换 */
function showPendingToast(): void {
  showToast('⏳ 收藏中…', 'pending', false);
}

/** 统一的保存结果反馈：Toast + 成功时清除选区 */
function showSaveFeedback(res: SaveResult | undefined): void {
  if (!res) {
    showToast('⚠️ 扩展已更新，请刷新页面后重试', 'warn');
    return;
  }
  if (res.ok && res.duplicate) {
    showToast('📌 当前内容已收藏过，已跳过', 'warn');
    window.getSelection()?.removeAllRanges();
    return;
  }
  if (res.ok) {
    const suffix = res.imagesSaved ? `（含 ${res.imagesSaved} 张图片）` : '';
    showToast(`✅ 已收藏${suffix}`, 'ok');
    // 清除选区：视觉上确认「这段内容已被收走」
    window.getSelection()?.removeAllRanges();
    hide();
    return;
  }
  showToast(`❌ 保存失败：${res.error ?? '未知错误'}`, 'err');
}

async function onClick(e: MouseEvent): Promise<void> {
  e.preventDefault();
  e.stopPropagation();
  suppressed = true;
  hide();
  showPendingToast(); // 即时反馈：体感零延迟，结果返回后替换
  const res = await captureSelection();
  showSaveFeedback(res);
  window.setTimeout(() => (suppressed = false), 400);
}

/** Alt+S / 右键菜单路径的反馈入口（无浮动按钮，仅 Toast） */
export function feedbackFromCommand(): void {
  showPendingToast();
  void captureSelection().then(showSaveFeedback);
}

/** 判断选区是否有效（非空、非输入框内、非密码框） */
function validSelection(): Selection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const node = sel.anchorNode;
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;
  if (el.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return null;
  return sel;
}

/** 事件是否来自插件自身 UI（Shadow DOM 事件会 retarget 到 host 元素） */
function fromOwnUi(e: MouseEvent): boolean {
  return !!host && e.composedPath().includes(host);
}

/**
 * 取选区「末尾」的行盒矩形（页面坐标定位用）。
 * 长选区（跨行/跨屏）时选区开头的 rect 可能在视口外，锚定末尾让按钮始终出现在
 * 用户收尾光标附近 —— 取最后一个 Range 的最后一个 client rect。
 */
function selectionEndRect(sel: Selection): { x: number; y: number } {
  const range = sel.getRangeAt(sel.rangeCount - 1);
  const rects = range.getClientRects();
  const rect =
    rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
  return {
    x: rect.right + window.scrollX + 4,
    y: rect.bottom + window.scrollY + 6, // 末行下方，紧贴选区收尾
  };
}

function showAtSelectionEnd(sel: Selection): void {
  const { x, y } = selectionEndRect(sel);
  show(x, y);
}

function onMouseUp(e: MouseEvent): void {
  if (suppressed) return;
  // 避开右键与浮动按钮自身的点击（修复：按钮 mouseup 的延时定时器把按钮又显示回来）
  if (e.button !== 0 || fromOwnUi(e)) return;
  window.setTimeout(() => {
    const sel = validSelection();
    if (!sel) {
      hide();
      return;
    }
    showAtSelectionEnd(sel);
  }, 10);
}

export function initFloatingButton(): void {
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keyup', (e) => {
    // Shift+方向键选区结束后同样显示（同样锚定选区末尾）
    if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      window.setTimeout(() => {
        const sel = validSelection();
        if (!sel) return;
        showAtSelectionEnd(sel);
      }, 10);
    }
  }, true);
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('blur', hide);
}
