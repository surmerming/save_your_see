/**
 * AI 契约自检脚本（M3）。
 *
 * 校验收藏根目录产出物的「二期 Watcher 可消费性」：
 *   1. 每个收藏 .md 的 YAML front-matter 完整性（契约见 docs/开发计划 §3.4）
 *   2. _meta/queue.jsonl 逐行 JSON 合法、file 字段指向真实存在的文件
 *
 * 用法：node scripts/contract-validator.mjs <收藏根目录> [--quiet]
 * 退出码：0 = 全部通过；1 = 存在错误。
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const REQUIRED_FIELDS = ['type', 'url', 'host', 'title', 'saved_at', 'tags', 'ai_status'];
const TYPE_VALUES = ['snippet', 'image', 'page'];
const AI_STATUS_VALUES = ['pending', 'summarized', 'skipped'];

/** 解析 YAML front-matter（够用即可：仅支持 `key: value` 标量与 `key: []`） */
export function parseFrontMatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { error: '缺少 front-matter 定界符（文件必须以 --- 开头并以 --- 结束元数据区）' };
  const meta = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) return { error: `front-matter 存在无法解析的行：${JSON.stringify(rawLine)}` };
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    meta[key] = value;
  }
  return { meta, body: m[2] };
}

/** 校验单个 .md 收藏文件，返回错误列表（空数组 = 通过） */
export function validateClipContent(content) {
  const errors = [];
  const parsed = parseFrontMatter(content);
  if (parsed.error) {
    return [`front-matter 解析失败：${parsed.error}`];
  }
  const meta = parsed.meta;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in meta)) errors.push(`缺少必需字段 ${field}`);
  }
  if (errors.length > 0) return errors;

  if (!TYPE_VALUES.includes(meta.type)) {
    errors.push(`type 非法：${JSON.stringify(meta.type)}（允许 ${TYPE_VALUES.join('|')}）`);
  }
  if (!/^"https?:\/\//.test(meta.url) && !/^https?:\/\//.test(meta.url)) {
    errors.push(`url 非法：${meta.url}（应为 http(s) 完整 URL，双引号可选）`);
  }
  if (!meta.host || meta.host === '""') {
    errors.push('host 为空');
  }
  if (!meta.title || meta.title === '""') {
    errors.push('title 为空');
  }
  const iso = meta.saved_at.replace(/^"|"$/g, '');
  if (Number.isNaN(Date.parse(iso))) {
    errors.push(`saved_at 非法：${meta.saved_at}（应为 ISO 8601）`);
  }
  if (meta.tags !== '[]' && !meta.tags.startsWith('[')) {
    errors.push(`tags 非法：${meta.tags}（一期契约固定为 []）`);
  }
  if (!AI_STATUS_VALUES.includes(meta.ai_status)) {
    errors.push(`ai_status 非法：${JSON.stringify(meta.ai_status)}（允许 ${AI_STATUS_VALUES.join('|')}）`);
  }
  if (meta.type === 'snippet') {
    for (const field of ['context_before', 'context_after']) {
      if (!(field in meta)) errors.push(`snippet 类型缺少字段 ${field}`);
    }
  }
  if (!parsed.body.trim()) {
    errors.push('正文为空');
  }
  return errors;
}

/** 校验 queue.jsonl 单行，返回错误列表 */
export function validateQueueLine(line, index) {
  const errors = [];
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (e) {
    return [`第 ${index + 1} 行不是合法 JSON：${e.message}`];
  }
  if (typeof obj.file !== 'string' || !obj.file) errors.push(`第 ${index + 1} 行缺少 file 字段`);
  if (obj.event !== 'created') errors.push(`第 ${index + 1} 行 event 非法：${JSON.stringify(obj.event)}（一期固定为 created）`);
  if (typeof obj.ts !== 'number' || !Number.isFinite(obj.ts)) errors.push(`第 ${index + 1} 行 ts 非法：${JSON.stringify(obj.ts)}`);
  return errors;
}

/** 遍历目录收集 .md 文件（跳过 _summaries/ 与 img/） */
function collectMdFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) {
        if (name.endsWith('.md')) out.push(full);
        continue;
      }
      if (name === '_summaries' || name === 'img') continue;
      walk(full);
    }
  };
  walk(rootDir);
  return out;
}

/** 校验整个收藏根目录，返回报告对象 */
export function validateRoot(rootDir) {
  const report = { rootDir, fileCount: 0, fileErrors: [], queueLines: 0, queueErrors: [], missingFiles: [] };

  const mdFiles = collectMdFiles(rootDir);
  report.fileCount = mdFiles.length;
  for (const file of mdFiles) {
    const errors = validateClipContent(readFileSync(file, 'utf8'));
    if (errors.length > 0) {
      report.fileErrors.push({ file: relative(rootDir, file), errors });
    }
  }

  const queuePath = join(rootDir, '_meta', 'queue.jsonl');
  if (existsSync(queuePath)) {
    const lines = readFileSync(queuePath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
    report.queueLines = lines.length;
    lines.forEach((line, i) => {
      const errors = validateQueueLine(line, i);
      if (errors.length > 0) {
        report.queueErrors.push(...errors);
        return;
      }
      const { file } = JSON.parse(line);
      if (!existsSync(join(rootDir, file))) {
        report.missingFiles.push(file);
      }
    });
  }
  return report;
}

/** 格式化报告为可读文本 */
export function formatReport(report) {
  const lines = [`📁 收藏根目录：${report.rootDir}`];
  lines.push(`📄 收藏文件：${report.fileCount} 个`);
  lines.push(`🧾 queue.jsonl：${report.queueLines} 行`);
  let hasError = false;

  if (report.fileErrors.length > 0) {
    hasError = true;
    lines.push(`\n❌ front-matter 校验失败 ${report.fileErrors.length} 个文件：`);
    for (const { file, errors } of report.fileErrors) {
      lines.push(`  · ${file}`);
      for (const e of errors) lines.push(`      - ${e}`);
    }
  }
  if (report.queueErrors.length > 0) {
    hasError = true;
    lines.push(`\n❌ queue.jsonl 格式错误：`);
    for (const e of report.queueErrors) lines.push(`  - ${e}`);
  }
  if (report.missingFiles.length > 0) {
    hasError = true;
    lines.push(`\n⚠️ queue.jsonl 引用了不存在的文件 ${report.missingFiles.length} 个：`);
    for (const f of report.missingFiles) lines.push(`  - ${f}`);
  }
  if (!hasError) {
    lines.push('\n✅ 契约自检全部通过，二期 Watcher 可直接消费。');
  }
  return lines.join('\n');
}

/* CLI 入口（vitest 导入本模块时不会执行） */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const rootDir = process.argv[2];
  if (!rootDir || !existsSync(rootDir)) {
    console.error('用法：node scripts/contract-validator.mjs <收藏根目录>');
    process.exit(2);
  }
  const report = validateRoot(rootDir);
  console.log(formatReport(report));
  const failed =
    report.fileErrors.length > 0 || report.queueErrors.length > 0;
  process.exit(failed ? 1 : 0);
}
