import { describe, it, expect } from 'vitest';
import { buildMarkdownFile, clipContext, hostOf, makeMeta, textToMarkdown } from '../src/shared/markdown';
import type { ClipMeta } from '../src/shared/types';

const baseMeta: ClipMeta = {
  type: 'snippet',
  url: 'https://zhihu.com/question/123456/answer/789',
  host: 'zhihu.com',
  title: '页面标题',
  saved_at: '2026-10-19T14:30:12+08:00',
  context_before: '前文',
  context_after: '后文',
  tags: [],
  ai_status: 'pending',
};

describe('buildMarkdownFile（AI 契约 §3.4）', () => {
  it('front-matter 字段完整且顺序固定', () => {
    const md = buildMarkdownFile(baseMeta, '正文内容');
    expect(md).toBe(
      [
        '---',
        'type: snippet',
        'url: "https://zhihu.com/question/123456/answer/789"',
        'host: zhihu.com',
        'title: "页面标题"',
        'saved_at: 2026-10-19T14:30:12+08:00',
        'context_before: "前文"',
        'context_after: "后文"',
        'tags: []',
        'ai_status: pending',
        '---',
        '',
        '正文内容',
        '',
      ].join('\n'),
    );
  });

  it('title 中的双引号被转义', () => {
    const md = buildMarkdownFile({ ...baseMeta, title: '他说"你好"' }, 'x');
    expect(md).toContain('title: "他说\\"你好\\""');
  });

  it('非 snippet 类型不写 context 字段', () => {
    const md = buildMarkdownFile({ ...baseMeta, type: 'page' }, 'x');
    expect(md).not.toContain('context_before');
    expect(md).not.toContain('context_after');
  });

  it('换行被折叠进单行（YAML 标量安全）', () => {
    const md = buildMarkdownFile({ ...baseMeta, title: '多\n行' }, 'x');
    expect(md).toContain('title: "多 行"');
  });
});

describe('clipContext', () => {
  it('折叠空白', () => {
    expect(clipContext('a\n  b\tc')).toBe('a b c');
  });
  it('超长截断加省略号', () => {
    expect(clipContext('x'.repeat(150))).toHaveLength(101);
    expect(clipContext('x'.repeat(150))).toMatch(/…$/);
  });
  it('短文本原样返回', () => {
    expect(clipContext('短文本')).toBe('短文本');
  });
});

describe('hostOf', () => {
  it('正常解析', () => {
    expect(hostOf('https://a.b.com/c?d=1')).toBe('a.b.com');
  });
  it('非法 URL → unknown', () => {
    expect(hostOf('???')).toBe('unknown');
  });
});

describe('makeMeta', () => {
  it('自动填充 host 与时间', () => {
    const meta = makeMeta({ type: 'page', url: 'https://x.com/a', title: '' });
    expect(meta.host).toBe('x.com');
    expect(meta.title).toBe('https://x.com/a');
    expect(meta.saved_at).toBeTruthy();
    expect(meta.ai_status).toBe('pending');
    expect(meta.tags).toEqual([]);
  });
});

describe('textToMarkdown', () => {
  it('段落间空行、段内单换行保留', () => {
    expect(textToMarkdown('p1\np2\n\np3')).toBe('p1\np2\n\np3');
  });
  it('Windows 换行归一', () => {
    expect(textToMarkdown('a\r\n\r\nb')).toBe('a\n\nb');
  });
});
