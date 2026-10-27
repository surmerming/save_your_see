# 「所见即所得收藏夹」开发计划

> 版本：v0.1（规划稿）｜日期：2026-10-19
> 定位一句话：**浏览即收藏，收藏即 Markdown，Markdown 即 AI 知识库的原料。**

---

## TL;DR

- 用 **Chrome MV3 + TypeScript + Vite（CRXJS）** 构建，Content Script 捕获选区、Service Worker 处理右键菜单与落盘。
- 存储采用 **「一条收藏一个 Markdown 文件 + YAML front-matter 元数据」，按「域名/路径」自动建目录归入同一网址**，天然适配后续本地 AI 检索与汇总。
- 落盘走两条通道：**File System Access API 自选收藏根目录为一期标配**（设置页授权），`chrome.downloads` 作为未授权/授权失效时的兜底通道。
- AI 汇总**一期暂不实现**，仅固化「结构化文件 + 侧车队列」接口契约——插件保持离线可用、极简；本地 Watcher 延后到二期。
- 路线图共 4 个里程碑（约 7 周）：M0 原型 → M1 MVP（自选保存目录 + 整页收藏入口）→ M2 整页抽取与富文本 → M3 打磨收尾。**一期仅本地使用，不发布商店、不做同步。**

---

## 1. 产品定位与核心功能拆解

### 1.1 竞品参照与差异化

| 产品 | 做得好的 | 不满足我们的点 |
|---|---|---|
| **SaveSnippet** | 选中文本即存、轻量 | 存储格式封闭、无网址归类、无 AI 出口 |
| **Joplin Web Clipper** | 富文本/整页剪藏、与 Joplin 笔记库打通 | 依赖 Joplin 客户端常驻、重；格式受 Joplin 数据库约束 |
| **Trilium Web Clipper** | 剪藏类型丰富（片段/截图/整页）、层级笔记 | 依赖 Trilium 服务端、部署成本高 |

**差异化定位**：

1. **零依赖**：不要求任何常驻客户端/服务端，插件本身就是全部。
2. **纯 Markdown + 平铺文件系统**：数据永远在用户可见、可 grep、可 git 的本地文件夹里——这是「本地 AI 化」的前提。
3. **按网址自动归类**：同一页面的多次收藏天然聚簇，符合「我在这篇文章/这个项目里查过什么」的场景记忆。
4. **AI 是管道消费方而非插件功能**：插件只负责高质量地产出结构化原料。

### 1.2 核心功能拆解（按优先级）

| 编号 | 功能 | 优先级 | 说明 |
|---|---|---|---|
| F1 | **选中文本一键保存** | P0 | 选中文字 → 浮动小按钮 / 快捷键（默认 `Alt+S`）/ 右键菜单，三种触发方式 |
| F2 | **图片右键保存** | P0 | 右键菜单「收藏此图片」，下载原图到对应网址文件夹；处理防盗链 |
| F3 | **同网址自动归类** | P0 | 收藏根目录下按 `域名/路径 slug/` 建目录；同一 URL 永远落同一目录 |
| F4 | **元数据记录** | P0 | 每条收藏写入 YAML front-matter：来源 URL、页面标题、选中时间、选区上下文（前后各 ~100 字）、收藏类型 |
| F5 | **收藏管理 Popup** | P1 | 查看今日/最近收藏列表、点击跳转原网址、「打开收藏根目录」按钮 |
| F6 | **设置页 Options** | P1 | 收藏根目录选择、文件命名模板、是否记录上下文、排除站点列表 |
| F7 | **AI 汇总接口预留（仅契约，不实现）** | P2 | 固化 front-matter 规范 + 侧车队列文件（见 §3.4）；Watcher 一期不做 |
| F8 | **重复/增量保存去重** | P2 | 同 URL 同文本 hash 已存在 → 追加时间戳或提示跳过 |
| F9 | **选区 HTML→MD 富文本** | P2 | 保留加粗/链接/列表/代码块；纯文本兜底（整页剪藏见 F10） |
| F10 | **整页抽取收藏** | P1 | **未选中任何文本/图片时点击插件栏图标** → 弹窗提供「整页收藏此页」→ Readability 抽正文 → 转存整页 Markdown |

### 1.3 一期范围边界（2026-10-19 与发起人确认）

1. **仅本地使用**：不发布 Chrome Web Store（开发者模式加载未打包目录即可，规避权限审核风险）。
2. **不做跨设备同步**：收藏目录即真身；同步类方案全部移入「未来拓展」。
3. **AI 汇总暂缓**：不实现 Watcher 与模型调用，仅固化 front-matter + 队列契约，保证二期可无痛接入。
4. **新增需求**：① 插件设置页可选择文件保存目录（FSA，一期标配）；② 未选中任何内容时点击插件栏图标 → 提供「整页抽取」收藏。

### 1.4 关键用户流程

```
① 文本收藏：
   选中文字 → [浮动按钮/Alt+S] → Content Script 抓取
   {选中内容, 上下文, URL, 标题} → 消息给 Service Worker
   → 生成 Markdown 文件 → 落盘（FSA 自选目录 / downloads 兜底）→ 角标+1 反馈

② 图片收藏：
   右键图片 → 菜单项「🖼 收藏此图片」→ SW 拿到 srcUrl
   → fetch 下载原图（带 Referer 处理）→ downloads 落盘到对应目录

③ 整页收藏（F10）：
   未选中任何内容 → 点击插件栏图标 → Popup「整页收藏此页」按钮
   → Content Script 用 Readability 抽正文 → 转 Markdown → 落盘为 type: page

④ AI 汇总（二期预留，一期不实现）：
   本地 Watcher 监听收藏根目录 → 增量读取新 .md
   → 调 Ollama/在线 API 按天/按站点汇总 → 写入 _summaries/
```

---

## 2. 待确认决策点（含默认建议）

> 均已给出默认建议，**不阻塞 M0/M1 开发**；默认按建议执行，你随时可推翻。

| # | 决策点 | 选项 | ✅ 默认建议 | 理由 |
|---|---|---|---|---|
| D1 | **存储格式** | a) 每条收藏一个 .md；b) 每网址一个 .md 追加写入；c) JSON | **a) 一条一 .md** | MV3 下 `downloads` 无法追加写文件，b 方案需 FSA 读改写且并发易冲突；一条一文件对 AI（RAG/总结）最友好、去重和删除都是文件级操作 |
| D2 | **存储位置** | a) Downloads 子目录；b) File System Access API 自选目录 | **b 一期标配，a 兜底**（已确认） | 用户明确要求可设置保存目录；FSA 在设置页授权（用户手势）+ IndexedDB 持久化句柄；未授权或句柄失效时降级 downloads |
| D3 | **AI 汇总模型** | a) 本地 Ollama；b) 在线 API（OpenAI/DeepSeek）；c) 双通道适配 | **暂缓**（已确认，一期不做） | 仅固化数据契约（front-matter + queue.jsonl），二期接入时再选型，插件代码零改动 |
| D4 | **离线可用性** | 插件是否完全离线 | **是**（保存端完全离线） | 保存是核心路径，不依赖任何网络；图片保存需网络下载原图（本来就是网页资源） |
| D5 | **浏览器范围** | Chrome only / 兼容 Edge / Firefox | **Chrome MV3 优先，Edge 零成本兼容**（Chromium 同内核），Firefox 后续评估 | 避免一期摊子过大 |
| D6 | **文件命名规则** | 时间戳 / 标题 slug / 混合 | **`YYYYMMDD-HHmmss-标题slug.md`** | 时间排序天然成立，slug 保证人类可读 |
| D7 | **URL 归类粒度** | a) 按域名；b) 按域名+完整路径；c) 按域名+路径+query | **b**，query 中的无关参数（utm_* 等）清洗后哈希折叠进目录名 | a 太粗（知乎首页和某回答混一起），c 会目录爆炸 |
| D8 | **前端框架（popup/options）** | 无框架 / Preact / React | **Preact**（体积极小，popup 冷启动快） | popup 生命周期极短，React 全家桶过重；无框架写设置表单又太苦 |

---

## 3. 技术选型与架构方案

### 3.1 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| Manifest | **MV3** | Chrome 强制方向；Service Worker 事件驱动 |
| 语言/构建 | **TypeScript + Vite + @crxjs/vite-plugin** | HMR 开发体验、自动处理 content script 注入与 manifest 生成 |
| UI（popup/options） | **Preact + htm 或 JSX** | 见 D8 |
| Content Script | 原生 TS，无框架 | 只做选区捕获与浮动按钮，用 Shadow DOM 隔离样式 |
| 存储（索引层） | `chrome.storage.local` | 存收藏索引（URL→文件路径映射、统计），真身在文件系统 |
| 落盘 | **File System Access API（一期标配）** + `chrome.downloads` 兜底 | 见 D2 |
| 正文抽取 | **@mozilla/readability** | 整页收藏（F10）；在 Content Script 侧解析（SW 无 DOMParser） |
| HTML→MD | **turndown** | 选区富文本与整页正文转换 |
| 消息 | `chrome.runtime.sendMessage` + 长连接 | Content Script ↔ SW |
| AI 汇总 | 独立 Node/Python Watcher + 模型（二期预留，一期不实现） | 与插件解耦，仅约定数据契约，见 §3.4 |

### 3.2 架构图

```
┌─────────────────────────── Chrome 浏览器 ───────────────────────────┐
│                                                                      │
│  ┌── Content Script（每页注入，Shadow DOM）──┐                       │
│  │  · 选区监听 → 浮动保存按钮                  │                       │
│  │  · 捕获: 选中文本/上下文/URL/标题            │                       │
│  └──────────────┬───────────────────────────┘                       │
│                 │ sendMessage                                        │
│  ┌──────────────▼── Service Worker (MV3) ──────────────┐             │
│  │  · 消息路由 & 触发节流                                │             │
│  │  · contextMenus：图片/选区右键菜单                    │             │
│  │  · Markdown 渲染器（选区HTML→MD）+ front-matter 生成  │             │
│  │  · 文件命名 / 目录归类规则引擎                         │             │
│  │  · 落盘通道: FSA handle（标配）⇄ downloads 兜底       │             │
│  │  · 索引维护: chrome.storage.local                     │             │
│  └──────────────┬───────────────────────────┘                       │
└─────────────────┼────────────────────────────────────────────────────┘
                  │ 写文件
     ┌────────────▼─────────────────────────────────┐
     │  收藏根目录（本地文件夹）                        │
     │  ├─ zhihu.com/                                │
     │  │   └─ question-123456/                      │
     │  │       ├─ 20261019-143012-选段slug.md        │
     │  │       └─ img/20261019-143015.jpg           │
     │  ├─ github.com/...                            │
     │  ├─ _inbox/        ← 无法归类时的兜底           │
     │  ├─ _meta/index.json   ← 收藏索引              │
     │  ├─ _meta/queue.jsonl  ← AI 任务队列（侧车）    │
     │  └─ _summaries/    ← AI 汇总产物（Watcher 写）  │
     └────────────┬─────────────────────────────────┘
                  │ 文件系统监听（chokidar/watchdog）
     ┌────────────▼───────────────┐
     │  本地 AI Watcher（独立进程，二期预留）  │
     │  · 消费 queue.jsonl / 新文件 │
     │  · Ollama(qwen3) 汇总        │
     │  · 可切换在线 API Provider    │
     │  · 产出: _summaries/日期.md   │
     └────────────────────────────┘
```

### 3.3 关键技术点与坑位预案

| 技术点 | 方案 | 已知坑 |
|---|---|---|
| **MV3 SW 休眠** | SW 是事件驱动、随时可被杀。所有状态（索引）持久化到 `chrome.storage.local`，不依赖内存变量；contextMenus 在 `onInstalled` 注册 | 不要在 SW 里缓存任何"必须活着"的状态 |
| **落盘重复文件名** | `chrome.downloads.download` 默认对同名文件加 `(1)` 后缀。**必须自己保证文件名唯一**（时间戳到秒 + 随机后缀），并传 `conflictAction: 'uniquify'` 兜底 | 文件名里的非法字符 `/ \ : ?` 等要清洗；中文文件名 OK 但长度限 255 |
| **图片防盗链** | SW 中 `fetch(srcUrl, { credentials: 'include' })` 拿 blob 再落盘；失败则降级直接把 URL 交给 downloads（浏览器自带 Referer） | data: URL 直接转存；跨域 canvas 污染问题不存在（不走 canvas） |
| **SPA 动态选区** | 用 `window.getSelection()` 的 `Range`，`cloneContents()` 拿 DOM 片段再做 HTML→MD | 表格等复杂结构转换移「未来拓展」，M2 保留基础格式 + 纯文本兜底 |
| **FSA 目录句柄持久化** | options 页里 `showDirectoryPicker()`，handle 存 IndexedDB（`storage` 权限下可跨会话恢复，需 `queryPermission` 检查） | Service Worker **不能**调 `showDirectoryPicker`（需用户手势的页面上下文）；读写文件操作 SW 可用恢复的 handle 执行 |
| **下载可见通知** | downloads 每次保存会出现在下载栏/下载历史 | 可接受（也是一种保存反馈）；M2 可用 FSA 后消除 |

### 3.4 AI 汇总接口预留设计（一期只固化契约，不实现 Watcher）

插件侧职责（契约）：

1. **每条收藏是自包含的 Markdown**：front-matter 携带 AI 所需全部元数据，无需解析文件名。

```markdown
---
type: snippet            # snippet | image | page（整页收藏）
url: "https://zhihu.com/question/123456/answer/789"
host: zhihu.com
title: "页面标题"
saved_at: 2026-10-19T14:30:12+08:00
context_before: "……选中文字前约100字"
context_after: "……选中文字后约100字"
tags: []                 # 预留：手动/自动标签
ai_status: pending       # pending | summarized | skipped（Watcher 回写）
---

这里是被保存的正文内容（HTML 转 Markdown，一期纯文本）。
```

2. **侧车队列 `_meta/queue.jsonl`**：每次保存追加一行 `{ "file": "相对路径", "event": "created", "ts": ... }`。Watcher 两种消费模式：监听文件系统变更（主）+ 读取队列（兜底）。Watcher 处理完把条目 front-matter 的 `ai_status` 改为 `summarized`。

3. **汇总产物规范**：`_summaries/YYYY-MM-DD.md`（按天）与 `_summaries/by-site/<host>.md`（按站点），由 Watcher 生成，插件不感知。

这样约定的好处：**插件与 AI 管道只通过"文件系统 + 这个 front-matter 格式"耦合**，Watcher 可以换成任何语言/任何模型，甚至未来换成你自己的知识库索引器（RAG），插件代码零改动。

---

## 4. 目录 / 文件组织规则

### 4.1 收藏数据目录（用户可见的产出物）

```
WYSIWYG-Favorites/                     # 收藏根目录
├── {host}/                            # 一级：域名
│   └── {path-slug}/                   # 二级：URL 路径 slug（同网址 → 同目录）
│       ├── 20261019-143012-段落标题slug.md     # 文本收藏
│       ├── img/                               # 该网址下的图片收藏
│       │   └── 20261019-143015-01.jpg
│       └── ...
├── _inbox/                            # URL 无法规整解析时的兜底目录
├── _meta/
│   ├── index.json                     # 收藏索引（SW 维护，供 popup 展示）
│   └── queue.jsonl                    # AI 事件队列（侧车）
└── _summaries/                        # AI 汇总产物（二期 Watcher 专属写入区，一期不生成）
    ├── 2026-10-19.md
    └── by-site/zhihu.com.md
```

**命名规则细则**：

- `path-slug`：URL 路径段用 `-` 连接、截断至 60 字符、清洗非法字符；query 仅保留白名单参数（剔除 `utm_*`、`spm` 等），剩余参与哈希。
- 文件名：`YYYYMMDD-HHmmss-{内容slug ≤ 30 字}.md`，冲突时追加 `-2`、`-3`。
- 约定 `_` 前缀目录为系统目录，插件 UI 中隐藏/置灰，**永不**把用户收藏写入 `_summaries/`。

### 4.2 插件源码目录

```
wysiwyg-clipper/                        # 插件仓库
├── manifest.config.ts                  # CRXJS 动态 manifest
├── vite.config.ts
├── package.json
├── src/
│   ├── shared/                         # 三端共用
│   │   ├── types.ts                    # Snippet / ImageItem / MetaMessage 等类型
│   │   ├── naming.ts                   # 目录归类 & 文件命名规则引擎（纯函数，可单测）
│   │   └── markdown.ts                 # front-matter 生成、HTML→MD 转换
│   ├── content/
│   │   ├── index.ts                    # 入口：选区监听
│   │   └── floating-button.ts          # 浮动按钮（Shadow DOM）
│   ├── background/
│   │   ├── index.ts                    # SW 入口：消息路由、菜单注册
│   │   ├── saver.ts                    # 落盘通道（downloads / FSA 双实现）
│   │   ├── image-saver.ts              # 图片下载 + 防盗链处理
│   │   └── indexer.ts                  # chrome.storage.local 索引维护
│   ├── popup/
│   │   ├── index.html / App.tsx        # 「整页收藏此页」按钮 + 最近收藏列表
│   │   └── ...
│   └── options/
│       ├── index.html / App.tsx        # 根目录选择（FSA）、命名模板、排除站点
│       └── fsa.ts                      # 目录句柄持久化（IndexedDB）
├── watcher/                            # AI 汇总（二期预留，一期不创建此目录）
│   ├── index.mjs                       # chokidar 监听 + 队列消费
│   ├── providers/
│   │   ├── ollama.mjs
│   │   └── openai-compatible.mjs       # DeepSeek/OpenAI 等在线 API
│   └── summarizer.mjs                  # 按天/按站点汇总策略
└── tests/
    ├── naming.spec.ts                  # 归类规则是正确性的重心，重点单测
    └── markdown.spec.ts
```

**分层原则**：`shared/` 里的归类与命名引擎是纯函数——它是整个产品"数据组织正确性"的心脏，必须 100% 单测覆盖；UI 与落盘都只是它的调用方。

---

## 5. 分阶段开发路线图与里程碑

### M0 · 技术原型（第 1 周）—— "能存下来"

- [ ] CRXJS + TS + Preact 脚手架，MV3 manifest 配通
- [ ] Content Script 选区捕获 → SW 消息链路跑通
- [ ] `chrome.downloads` 落盘第一个 .md（含 front-matter）
- [ ] 图片右键菜单 + 原图下载落盘
- **验收**：在任意网页选中文字保存、右键图片保存，Downloads 目录出现结构正确的文件
- **风险排除**：验证 SW 休眠后消息仍可达、中文文件名落盘

### M1 · MVP（第 2–3 周）—— "存得对、归得准"

- [ ] `shared/naming.ts` 归类规则引擎 + 单测（域名/路径 slug/query 清洗）
- [ ] front-matter 完整元数据（上下文、类型、时间）
- [ ] **FSA 自选收藏根目录（F6 核心）**：options 页授权 + IndexedDB 持久化句柄；未授权时降级 `chrome.downloads`，落盘通道双实现（`saver.ts` 统一接口）
- [ ] `chrome.storage.local` 收藏索引 + 角标计数反馈
- [ ] Popup v1：**「整页收藏此页」按钮**、最近 20 条收藏、跳原网址、打开所在文件夹
- [ ] `_inbox` 兜底归类；重复内容 hash 检测提示（F8）
- **验收**：自选根目录生效；同一 URL 的 3 次文本收藏 + 2 张图片全部落入同一目录，popup 可见可跳转

### M2 · 整页抽取与体验完善（第 4–5 周）—— "整页也能收"

- [ ] **整页抽取（F10）**：Content Script 用 Readability 抽正文（克隆 document 解析，不污染页面）→ turndown 转 MD → 落盘 `type: page`；抽取失败降级为纯文本或提示手动框选
- [ ] 选区 HTML→MD 基础转换（F9：加粗/链接/列表/代码块），纯文本兜底
- [ ] 快捷键 `Alt+S`（chrome.commands）、浮动按钮交互打磨（防误触、消失逻辑）
- [ ] 设置项：命名模板、上下文开关、排除站点列表
- [ ] Edge 浏览器兼容验证（Chromium 同内核，预期零成本）
- **验收**：在新闻/博客页点「整页收藏」得到干净正文 Markdown；富文本选区转换可读；快捷键可用

### M3 · 打磨收尾（第 6–7 周）—— "稳定可靠"

- [ ] 边界与异常：SW 休眠恢复后消息可达、FSA 句柄失效的重新授权引导、下载失败重试
- [ ] 去重策略完善：整页收藏与既有片段的 URL+hash 冲突处理
- [ ] **AI 契约自检脚本**：校验全部产出文件的 front-matter 完整性与 queue.jsonl 格式正确性（为二期 Watcher 无缝接入铺路）
- [ ] README：开发者模式安装步骤、目录结构说明、备份建议（Time Machine/Syncthing）
- **验收**：连续一周日常使用无数据丢失、无重复文件；front-matter 通过契约自检，二期 Watcher 可直接消费

### M4+ · 见「未来拓展」

---

## 6. 未来拓展方向（单列）

| 方向 | 内容 | 建议时机 |
|---|---|---|
| **AI 汇总管道（一期暂缓）** | 本地 Watcher + Ollama/在线 API 双通道、按天/按站点汇总、`ai_status` 回写；契约已在一期固化 | 二期首项 |
| **富文本增强与选区截图** | 表格/图片内联转 MD、选区截图（chrome.tabs.captureVisibleTab） | M4 |
| **标签体系与全文检索** | front-matter tags + 本地 SQLite FTS5 索引（Watcher 侧建库），插件 popup 接搜索框 | M4–M5 |
| **自动分类** | 本地模型对收藏自动打标签/归主题文件夹（已有 front-matter 通道，零插件改动） | M5 |
| **知识库化 / RAG** | Watcher 产 embedding → 本地向量库（如 LanceDB），自然语言问答"我什么时候看过…" | M5+ |
| **跨设备同步** | 三条路线对比：a) 收藏目录放 Syncthing/iCloud（零开发，推荐先试）；b) Git 仓库自动 push；c) 自建同步服务 | 按需 |
| **发布到 Chrome Web Store** | 权限收敛审核（downloads/contextMenus/activeTab）、隐私声明、打包与版本管理 | 想分享给他人时 |

---

## 7. 风险提示汇总

1. **MV3 权限审核**：`downloads` + `contextMenus` + `<all_urls>` content script 组合在 Web Store 审核较严——**一期仅本地使用、开发者模式加载未打包目录，完全规避此风险**；未来若要发布再做权限收敛。
2. **FSA 句柄失效**：浏览器更新或用户清理站点数据后 handle 会失效，需在 options 页提供"重新授权"引导，落盘通道保留 downloads 降级路径。
3. **防盗链图片长尾**：总有站点连 credentials 请求都拒绝，降级策略（保存原 URL 到 md 正文作为引用）必须存在。
4. **数据安全**：收藏目录是用户唯一真身，M2 起建议在 README 提示纳入 Time Machine/Syncthing 备份；插件自身绝不做删除真身文件的操作。
