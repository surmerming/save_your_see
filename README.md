# 所见即所得收藏夹（wysiwyg-clipper）

> 浏览即收藏，收藏即 Markdown，Markdown 即 AI 知识库的原料。

Chrome MV3 扩展：选中文本 / 右键图片 / 整页抽取，一键存为**结构化 Markdown 文件**，按「域名/路径」自动归类到本地收藏根目录。一期仅本地使用。

## 功能

| 触发方式 | 效果 |
|---|---|
| 选中文字 → 浮动「🔖 收藏」按钮 / `Alt+S` / 右键菜单 | 保存为 `type: snippet` 的 Markdown（含上下文 front-matter，富文本转 MD） |
| 右键图片 → 「🖼 收藏此图片」 | 原图下载到该网址目录的 `img/` 下（带防盗链处理，失败降级 downloads 直取） |
| 未选中内容时点击插件图标 → 「📄 整页收藏此页」 | Readability 抽正文 → 整页 Markdown（`type: page`） |

## 目录结构（收藏根目录）

```
WYSIWYG-Favorites/
├── 20261019/                        # 一级：日期（YYYYMMDD，按天回溯「哪天看了什么」）
│   └── {host}/{path-slug}/          # 二级：域名 + 路径 slug（同 URL 永远同目录）
│       ├── 20261019-143012-标题slug.md
│       └── img/20261019-143015-01.jpg
├── _inbox/                          # URL 无法规整解析时的兜底
├── _meta/
│   ├── index.json                   # 收藏索引镜像
│   └── queue.jsonl                  # AI 事件队列（二期 Watcher 契约）
└── _summaries/                      # 二期 AI 汇总产物（一期不生成）
```

- 文件命名：`YYYYMMDD-HHmmss-{内容slug ≤30}.md`，冲突追加 `-2`、`-3`
- query 清洗：`utm_*`、`spm` 等跟踪参数剔除，其余参数哈希折叠进目录名
- 去重：同 URL 同内容 hash 已存在 → 跳过保存

## 安装（开发者模式）

1. 构建：`npm install && npm run build`
2. Chrome 打开 `chrome://extensions` → 右上角开启**开发者模式**
3. 「加载已解压的扩展程序」→ 选择本项目的 `dist/` 目录
4. 首次使用：点击插件图标 → ⚙️ 设置 → **选择收藏根目录**（File System Access 授权）

> 未授权根目录时自动降级为 `Downloads/WYSIWYG-Favorites/` 兜底通道，功能不受影响。

## 开发

```bash
npm run dev        # HMR 开发模式（加载 dist/ 并热更新）
npm run build      # tsc --noEmit + vite build → dist/
npm test           # vitest 单测（naming / markdown / contract 共 47 用例）
npm run validate -- /path/to/WYSIWYG-Favorites   # AI 契约自检（M3）
```

### AI 契约自检（二期 Watcher 铺路）

`npm run validate -- <收藏根目录>` 会校验：

1. **front-matter 完整性**：必需字段（type/url/host/title/saved_at/tags/ai_status）、枚举值合法性、snippet 类型必须含 context 字段、正文非空
2. **queue.jsonl**：逐行 JSON 合法、`event` 固定为 `created`、`ts` 为数字、`file` 指向真实存在的文件

全部通过输出 ✅ 并以退出码 0 结束；可挂进 CI 或二期 Watcher 启动前预检。

### 代码结构

```
src/
├── shared/       # 三端共用纯函数：naming.ts（归类引擎·单测重心）、markdown.ts（front-matter 契约）、settings.ts
├── content/      # 选区监听、浮动按钮（Shadow DOM）、Readability 整页抽取、HTML→MD
├── background/   # SW：消息路由、右键菜单、双通道落盘（FSA⇄downloads）、索引/角标
├── offscreen/    # FSA 写入兜底（SW createWritable 不可用时由 offscreen 代写）
├── popup/        # 整页收藏按钮 + 最近 20 条列表（Preact）
└── options/      # FSA 根目录授权 + 排除站点 + 上下文开关（Preact）
```

### 架构要点

- **MV3 SW 随时可被杀**：所有状态持久化到 `chrome.storage.local` / IndexedDB，不依赖内存变量
- **FSA 句柄**：options 页授权（需用户手势）→ IndexedDB 持久化 → SW 恢复使用；失效时自动降级 downloads，popup 顶部出现黄色警告条引导重新授权
- **下载失败重试**：downloads 通道失败自动重试 2 次（指数退避 200ms/400ms）
- **去重**：同 URL 且同内容 hash 才跳过（不同 URL 的相同内容允许保存，属合理引用）
- **孤儿脚本自愈**：扩展 reload 后旧页面残留的 Content Script 调用前会探测上下文有效性，不再抛 `Extension context invalidated`
- **HTML→MD 在 Content Script 侧执行**（SW 无 DOMParser）
- **AI 契约**：每条收藏自包含 front-matter（`ai_status: pending`）+ `_meta/queue.jsonl` 事件队列，二期 Watcher 可直接消费，插件代码零改动
- **浏览器兼容**：Chrome 109+；Edge 基于 Chromium 同内核，理论零成本兼容（加载 dist/ 即用），未做系统化回归

## 备份建议

收藏目录是唯一真身，插件绝不做删除操作。建议将收藏根目录纳入 **Time Machine / Syncthing / iCloud** 备份。
