import { describe, it, expect } from 'vitest';
import { parseFrontMatter, validateClipContent, validateQueueLine } from '../scripts/contract-validator.mjs';

const VALID_SNIPPET = [
  '---',
  'type: snippet',
  'url: "https://zhihu.com/question/123"',
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
].join('\n');

const VALID_PAGE = VALID_SNIPPET
  .replace('type: snippet', 'type: page')
  .replace('context_before: "前文"\n', '')
  .replace('context_after: "后文"\n', '');

describe('parseFrontMatter', () => {
  it('解析标准 front-matter', () => {
    const { meta, body } = parseFrontMatter(VALID_SNIPPET);
    expect(meta.type).toBe('snippet');
    expect(meta.ai_status).toBe('pending');
    expect(body.trim()).toBe('正文内容');
  });

  it('缺少定界符报错', () => {
    expect(parseFrontMatter('没有 front-matter').error).toBeTruthy();
    expect(parseFrontMatter('---\n只有开头').error).toBeTruthy();
  });
});

describe('validateClipContent', () => {
  it('合法 snippet 通过', () => {
    expect(validateClipContent(VALID_SNIPPET)).toEqual([]);
  });

  it('合法 page 通过（无 context 字段）', () => {
    expect(validateClipContent(VALID_PAGE)).toEqual([]);
  });

  it('snippet 缺少 context 字段报错', () => {
    const errors = validateClipContent(VALID_PAGE.replace('type: page', 'type: snippet'));
    expect(errors.join('\n')).toMatch(/context_before/);
    expect(errors.join('\n')).toMatch(/context_after/);
  });

  it('缺少必需字段报错', () => {
    const broken = VALID_SNIPPET.replace('host: zhihu.com\n', '');
    expect(validateClipContent(broken).join('\n')).toMatch(/host/);
  });

  it('type 非法报错', () => {
    const errors = validateClipContent(VALID_SNIPPET.replace('type: snippet', 'type: unknown'));
    expect(errors.join('\n')).toMatch(/type 非法/);
  });

  it('ai_status 非法报错', () => {
    const errors = validateClipContent(VALID_SNIPPET.replace('ai_status: pending', 'ai_status: done'));
    expect(errors.join('\n')).toMatch(/ai_status 非法/);
  });

  it('saved_at 非 ISO 报错', () => {
    const errors = validateClipContent(VALID_SNIPPET.replace('saved_at: 2026-10-19T14:30:12+08:00', 'saved_at: 昨天'));
    expect(errors.join('\n')).toMatch(/saved_at 非法/);
  });

  it('url 非 http(s) 报错', () => {
    const errors = validateClipContent(VALID_SNIPPET.replace('url: "https://', 'url: "ftp://'));
    expect(errors.join('\n')).toMatch(/url 非法/);
  });

  it('正文为空报错', () => {
    const errors = validateClipContent(VALID_SNIPPET.replace('正文内容', ''));
    expect(errors.join('\n')).toMatch(/正文为空/);
  });

  it('tags 非 [] 报错（一期契约）', () => {
    const errors = validateClipContent(VALID_SNIPPET.replace('tags: []', 'tags: not-array'));
    expect(errors.join('\n')).toMatch(/tags 非法/);
  });
});

describe('validateQueueLine', () => {
  it('合法行通过', () => {
    expect(validateQueueLine('{"file":"zhihu.com/p/a.md","event":"created","ts":1760000000000}', 0)).toEqual([]);
  });

  it('非法 JSON 报错', () => {
    const errors = validateQueueLine('{not json', 2);
    expect(errors[0]).toMatch(/第 3 行不是合法 JSON/);
  });

  it('缺少 file / event 非法 / ts 非法分别报错', () => {
    expect(validateQueueLine('{"event":"created","ts":1}', 0).join(' ')).toMatch(/file/);
    expect(validateQueueLine('{"file":"a.md","event":"deleted","ts":1}', 0).join(' ')).toMatch(/event 非法/);
    expect(validateQueueLine('{"file":"a.md","event":"created","ts":"x"}', 0).join(' ')).toMatch(/ts 非法/);
  });
});
