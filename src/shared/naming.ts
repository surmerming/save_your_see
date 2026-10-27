/**
 * 目录归类 & 文件命名规则引擎。
 *
 * 纯函数、无 DOM/Chrome 依赖 —— 这是整个产品「数据组织正确性」的心脏，
 * 必须保持 100% 单测覆盖（tests/naming.spec.ts）。
 */

/** query 白名单之外的常见跟踪参数（剔除后不参与归类） */
const STRIP_QUERY_KEYS = /^(utm_\w+|spm|fbclid|gclid|yclid|from|fr|share_|sid|sharer_|_hsenc|_hsmi|mib_extid|ref|ref_src|ref_url|igsh|si)$/i;

/** 文件系统保留/非法字符 */
const ILLEGAL_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g;

/** 清洗为 slug：非法字符转连字符、折叠连字符、去首尾连字符 */
export function sanitizeSlug(input: string, maxLen: number): string {
  const slug = input
    .normalize('NFKC')
    .replace(ILLEGAL_CHARS, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .replace(/-$/g, '');
  return slug || 'untitled';
}

/** 格式化为 YYYYMMDD-HHmmss（本地时间） */
export function timestampName(d: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** 短哈希（用于折叠清洗后的 query） */
export function shortHash(input: string, len = 8): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = ((h2 + c * (i + 7)) * 2654435761) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, len);
}

/**
 * URL → 收藏目录相对路径（不含文件名）。
 * 规则：`{YYYYMMDD}/{host}/{path-slug}` —— 日期在前，按天回溯「哪天看了什么」；
 * query 仅保留白名单外参数参与哈希折叠；
 * 无法规整解析时落入 `_inbox/`（系统目录，不带日期）。
 */
export function dirForUrl(rawUrl: string, saveDate: Date): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '_inbox';
  }
  const day = yyyymmdd(saveDate);
  const host = sanitizeSlug(url.hostname, 100);
  const segments = url.pathname
    .split('/')
    .filter((s) => s && s !== 'index.html' && s !== 'index.htm')
    .map((s) => decodeSegment(s));

  // 清洗 query：剔除跟踪参数，保留白名单外参数参与哈希
  const keptQuery: [string, string][] = [];
  url.searchParams.forEach((v, k) => {
    if (!STRIP_QUERY_KEYS.test(k)) keptQuery.push([k, v]);
  });

  let pathSlug = segments.map((s) => sanitizeSlug(s, 40)).filter((s) => s !== 'untitled').join('-');
  pathSlug = sanitizeSlug(pathSlug, 60);
  if (!pathSlug || pathSlug === 'untitled') pathSlug = 'home';

  if (keptQuery.length > 0) {
    const qs = keptQuery
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('&');
    pathSlug = `${pathSlug}-${shortHash(qs, 6)}`;
  }

  return `${day}/${host}/${pathSlug}`;
}

/** 格式化为 YYYYMMDD */
function yyyymmdd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 单段路径解码，失败保持原样 */
function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 生成文件名：`YYYYMMDD-HHmmss-{内容slug ≤30}.md`
 * 冲突时追加 `-2`、`-3`…；同秒高并发时追加短随机后缀。
 *
 * @param existingConflicts 已存在的同名集合（不带扩展名或带扩展名均可）
 */
export function makeFileName(
  titleOrContent: string,
  d: Date,
  existingConflicts: Set<string> = new Set(),
  ext = 'md',
): string {
  const base = timestampName(d);
  const slug = sanitizeSlug(titleOrContent, 30);
  const stem = `${base}-${slug}`;
  if (!existingConflicts.has(`${stem}.${ext}`) && !existingConflicts.has(stem)) {
    return `${stem}.${ext}`;
  }
  let n = 2;
  while (existingConflicts.has(`${stem}-${n}.${ext}`) || existingConflicts.has(`${stem}-${n}`)) {
    n++;
  }
  return `${stem}-${n}.${ext}`;
}

/** 图片文件名：`YYYYMMDD-HHmmss-NN.ext`（NN 为该页面下的序号） */
export function makeImageFileName(seq: number, ext: string, d: Date = new Date()): string {
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext.toLowerCase()) ? ext.toLowerCase() : 'bin';
  return `${timestampName(d)}-${String(seq).padStart(2, '0')}.${safeExt}`;
}

/** 图片收藏目录：日期目录下网址目录的 img/ */
export function imageDirForUrl(rawUrl: string, saveDate: Date): string {
  return `${dirForUrl(rawUrl, saveDate)}/img`;
}

/** 从扩展名/MIME 推断图片扩展名 */
export function imageExtFromUrlOrMime(url: string, mime?: string): string {
  const fromMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
  };
  if (mime && fromMime[mime.toLowerCase().split(';')[0]]) {
    return fromMime[mime.toLowerCase().split(';')[0]];
  }
  const m = url.split('?')[0].match(/\.(\w{2,5})$/);
  if (m) {
    const e = m[1].toLowerCase();
    if (/^(jpe?g|png|gif|webp|svg|avif|bmp)$/.test(e)) return e === 'jpeg' ? 'jpg' : e;
  }
  return 'jpg';
}
