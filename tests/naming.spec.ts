import { describe, it, expect } from 'vitest';
import {
  sanitizeSlug,
  timestampName,
  shortHash,
  dirForUrl,
  imageDirForUrl,
  makeFileName,
  makeImageFileName,
  imageExtFromUrlOrMime,
} from '../src/shared/naming';

describe('sanitizeSlug', () => {
  it('清洗非法字符与空白', () => {
    expect(sanitizeSlug('a/b\\c:d*e?f"g<h>i|j', 100)).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizeSlug('  多  个 空格  ', 100)).toBe('多-个-空格');
    expect(sanitizeSlug('连--续---连字符', 100)).toBe('连-续-连字符');
  });

  it('截断至最大长度并去除尾部连字符', () => {
    expect(sanitizeSlug('x'.repeat(100), 60)).toHaveLength(60);
    expect(sanitizeSlug('abcde', 4)).toBe('abcd');
  });

  it('空输入返回 untitled', () => {
    expect(sanitizeSlug('', 30)).toBe('untitled');
    expect(sanitizeSlug('///', 30)).toBe('untitled');
  });
});

describe('dirForUrl', () => {
  const D = new Date(2026, 9, 19); // 2026-10-19

  it('日期前缀 + 域名 + 路径 slug 归类（按天回溯「哪天看了什么」）', () => {
    expect(dirForUrl('https://zhihu.com/question/123456/answer/789', D)).toBe(
      '20261019/zhihu.com/question-123456-answer-789',
    );
    expect(dirForUrl('https://github.com/vuejs/core/blob/main/README.md', D)).toBe(
      '20261019/github.com/vuejs-core-blob-main-README.md',
    );
  });

  it('根路径 → home', () => {
    expect(dirForUrl('https://example.com/', D)).toBe('20261019/example.com/home');
  });

  it('不同日期 → 不同日期目录', () => {
    const d2 = new Date(2026, 9, 20);
    expect(dirForUrl('https://x.com/p', D)).toBe('20261019/x.com/p');
    expect(dirForUrl('https://x.com/p', d2)).toBe('20261020/x.com/p');
  });

  it('剔除跟踪参数后 query 参与哈希折叠', () => {
    const a = dirForUrl('https://x.com/p?id=99&utm_source=rss&spm=alibaba', D);
    const b = dirForUrl('https://x.com/p?id=99&utm_medium=email&spm=taobao', D);
    // utm_* / spm 均剔除 → 同一目录
    expect(a).toBe(b);
    expect(a).toMatch(/^20261019\/x\.com\/p-[a-z0-9]{6}$/);
  });

  it('不同白名单外 query → 不同目录', () => {
    const a = dirForUrl('https://x.com/p?id=1', D);
    const b = dirForUrl('https://x.com/p?id=2', D);
    expect(a).not.toBe(b);
  });

  it('URL 编码路径段被解码', () => {
    expect(dirForUrl('https://x.com/%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98', D)).toMatch(/^20261019\/x\.com\/中文标题/);
  });

  it('非法 URL → _inbox 兜底（系统目录不带日期）', () => {
    expect(dirForUrl('not-a-url', D)).toBe('_inbox');
  });

  it('index.html 段被忽略', () => {
    expect(dirForUrl('https://x.com/blog/index.html', D)).toBe('20261019/x.com/blog');
  });

  it('imageDirForUrl 在网址目录下加 img/', () => {
    expect(imageDirForUrl('https://x.com/p', D)).toBe('20261019/x.com/p/img');
  });
});

describe('makeFileName', () => {
  it('格式为 YYYYMMDD-HHmmss-slug.md', () => {
    const d = new Date(2026, 9, 19, 14, 30, 12);
    expect(makeFileName('一段中文标题', d)).toBe('20261019-143012-一段中文标题.md');
  });

  it('slug 截断至 30 字符', () => {
    const d = new Date(2026, 0, 1, 0, 0, 0);
    const name = makeFileName('很'.repeat(50), d);
    expect(name).toBe(`20260101-000000-${'很'.repeat(30)}.md`);
  });

  it('冲突时追加 -2、-3', () => {
    const d = new Date(2026, 9, 19, 14, 30, 12);
    const existing = new Set(['20261019-143012-标题.md', '20261019-143012-标题-2.md']);
    expect(makeFileName('标题', d, existing)).toBe('20261019-143012-标题-3.md');
  });
});

describe('makeImageFileName', () => {
  it('格式为 YYYYMMDD-HHmmss-NN.ext', () => {
    const d = new Date(2026, 9, 19, 14, 30, 15);
    expect(makeImageFileName(1, 'jpg', d)).toBe('20261019-143015-01.jpg');
    expect(makeImageFileName(12, 'png', d)).toBe('20261019-143015-12.png');
  });

  it('非法扩展名回退 bin', () => {
    const d = new Date(2026, 9, 19, 14, 30, 15);
    expect(makeImageFileName(1, 'php/x?', d)).toBe('20261019-143015-01.bin');
  });
});

describe('imageExtFromUrlOrMime', () => {
  it('MIME 优先', () => {
    expect(imageExtFromUrlOrMime('https://x.com/img', 'image/webp')).toBe('webp');
    expect(imageExtFromUrlOrMime('https://x.com/img.png', 'image/jpeg')).toBe('jpg');
  });

  it('回退 URL 扩展名', () => {
    expect(imageExtFromUrlOrMime('https://x.com/a/b.jpeg?w=100')).toBe('jpg');
    expect(imageExtFromUrlOrMime('https://x.com/a/b.SVG')).toBe('svg');
  });

  it('无法判断 → jpg 兜底', () => {
    expect(imageExtFromUrlOrMime('https://x.com/img')).toBe('jpg');
  });
});

describe('shortHash / timestampName', () => {
  it('shortHash 稳定且定长', () => {
    expect(shortHash('abc')).toBe(shortHash('abc'));
    expect(shortHash('abc')).toHaveLength(8);
    expect(shortHash('abc', 6)).toHaveLength(6);
  });

  it('timestampName 本地时间补零', () => {
    expect(timestampName(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });
});
