# ⚡ LightningClass v2

一个 **2 小时、多人在线、Duolingo 风格** 的 AI 实践培训平台。
基于 Preact + Signals + WebSocket 重构，零构建步骤，单文件后端。

> 🎬 **想立刻看效果？** 用浏览器（手机或电脑）打开 [`public/demo.html`](./public/demo.html) — 单文件、零依赖、完整体验流程。可直接转发给朋友。
> 🚀 想立即开课？跳到 [3 分钟起步](#3-分钟起步)
> 🏛 想了解架构？读 [`../design/ai-training-platform`](../design/ai-training-platform/README.md)

---

## 🎬 单文件体验 demo

不想配环境？打开 [`public/demo.html`](./public/demo.html) 即可：

- **单文件 67KB** — 所有 CSS/JS/数据内联，零外部依赖
- **手机优先设计** — 在任何浏览器（iOS Safari、Android Chrome、桌面浏览器）丝滑流畅
- **完整流程** — 欢迎页 → 入场 → 候场 → Node 1（提交→投票→揭榜）→ 快进 2-19 → 颁奖典礼
- **可转发** — 当附件直接发给朋友；或托管到 GitHub Pages / Netlify / Vercel（拖拽即可）

```bash
# 本地直接打开
open app/public/demo.html      # macOS
xdg-open app/public/demo.html  # Linux
start app/public/demo.html     # Windows

# 或在已启动的服务器上访问
http://localhost:3000/demo.html
```

> **demo 是单设备体验** — 朋友们各自打开都能看到完整流程，但不是真实多人。
> 真实多人需要部署服务（看下面）。

---

## 它做什么

```
┌──────────────────────────────────────────────────────────────────┐
│  你 (主持人)         →  打开 http://localhost:3000              │
│                          点「开启一场培训」                       │
│                          得到 6 位 code 和 QR 码                  │
│                                                                  │
│  你的学员们          →  扫码或输入 code 入场                     │
│                          填暱称→选头像→进入候场厅                 │
│                                                                  │
│  你点「🚀 开始培训」 →  全场进入 Node 1                          │
│  你点空格键          →  推进 FSM（公布→提交→投票→揭榜→下一关）    │
│  ……重复 20 次……    →  自动进入颁奖典礼                         │
│                                                                  │
│  学员看到的体验     →  Duolingo 风格闯关、实时瀑布流、投票动画、 │
│                         徽章解锁 toast、XP 飘字、奖台烟花         │
└──────────────────────────────────────────────────────────────────┘
```

## 与 v1 的区别

| 维度 | v1 | v2 |
| --- | --- | --- |
| 启动门槛 | 主持人需输入控制台令牌 | 任何人点「开启培训」即成主持人 |
| 并发场次 | 单场 | 多场并行（每场独立 6 位 code） |
| 邀请方式 | 手抄 URL | 自带 QR 码 + 一键复制链接 |
| 数据存储 | 进程内存 | JSON 落盘，重启不丢 |
| 前端架构 | 命令式 DOM 操作 | Preact + Signals 响应式 |
| 协议 | 静态 HTML 多页 | 单页应用 + URL 路由 |
| 入场流 | 两次跳转 | 入场→选头像→直达 |
| 主持人操作 | 5 个按钮 | 1 个上下文「下一步」+ 快捷键 |
| 状态恢复 | 刷新即丢 | 刷新继续，身份持久化 |

---

## 3 分钟起步

```bash
cd app
npm install      # 仅需一次（只装 ws 一个包）
npm start
# 终端会显示：Open in browser: http://localhost:3000
```

**接下来：**

1. 在你的电脑上打开 `http://localhost:3000`
2. 点「**开启一场培训**」→ 输入培训名（可跳过）→ 自动进入主持人台
3. 右上角「📲 **邀请学员**」会弹出 QR 码 + 链接
4. 把 QR 码投屏 / 把链接发群里
5. 学员陆续亮灯，你确认人差不多了 → 点「🚀 **开始培训**」
6. 之后每点一次空格（或主按钮）就推进一步：
   - 📢 公布题目 → ▶ 开放提交 → ⏹ 关闭并投票 → 🏆 揭榜 → ➡ 下一关
7. 20 关后自动进入颁奖典礼

> **学员怎么访问？** 如果你和学员在同一局域网，把 `localhost` 换成你的内网 IP（macOS: `ifconfig | grep "inet "` / Windows: `ipconfig`）。如果在公网服务器，直接用域名/IP。

---

## 主持人台特性

- **单按钮上下文化**：FSM 每个状态对应一个明确的"下一步"按钮，按钮文字自动变更
- **空格 = 下一步、P = 暂停**：解放双手，全程键盘流
- **倒计时暂停/继续**：临时讲解时按 P 暂停，不再被秒表追着跑
- **延长 +60 秒**：发现大家还没交完，一键加时
- **按住 0.6 秒确认**：「重置」「上一步」等破坏性操作需按住确认，防止直播误触
- **实时大屏**：在线/已提交/投票/倒计时四象限 + 实时排行榜 + 提交瀑布流
- **情境提示**：右下角自动显示当前 FSM 状态下应该做什么

---

## 学员体验

- **匿名入场**：扫码进入 → 输入暱称 → 选头像 → 一键加入（< 30 秒）
- **个人持久化**：浏览器记住你的暱称、头像、徽章；刷新页面不会丢
- **多设备**：电脑跑 AI 工具 + 手机看平台都可以，会自动同步
- **实时反馈**：每次提交、被点赞、解锁徽章都有动画
- **不评判错误**：所有"错误"用鼓励性颜色 + 文案（设计原则：鼓励 > 评判）

---

## 课程：20 节点

四个阶段，详见 `curriculum.json`：

| 阶段 | 节点 | 主题 |
| --- | --- | --- |
| 🍑 破冰 (Node 1-5) | AI 自我介绍 · 收件箱清零 · 深度检索 · 文档萃取 · 会议提取 |
| 🌊 职场 (Node 6-10) | 元提示词 · 数据透视 · 情绪翻译 · 个性化营销 · PPT 闪电战 |
| ☀️ 多模态 (Node 11-15) | 视觉咒语 · 声音脚本 · 视频高光 · UI 头脑风暴 · 跨平台裂变 |
| 🌹 智能体 (Node 16-20) | Zapier 工作流 · 客服智能体 · 链式思考 · 研究智能体 · 终极飞轮 |

每个节点都有：题目、推荐工具、一键复制提示词、新手陷阱提示、投票评分标准。

### 修改课程

直接编辑 `curriculum.json`，重启服务即可。Schema 字段说明：

```jsonc
{
  "seq": 1,                       // 1-20
  "phase": "icebreak",            // icebreak | workplace | multimodal | agentic
  "phaseName": "破冰",
  "title": "AI 自我介绍",
  "difficulty": 1,                // 1-5 ★
  "durationSec": 90,              // 提交时长
  "tools": ["ChatGPT", "Claude"],
  "icon": "🤖",
  "accent": "peach",              // peach | sky | sun | coral
  "question": "...",
  "promptTemplate": "...{name}...",  // {name} 被替换为学员暱称
  "warning": "新手陷阱",
  "voteCriterion": "投票看什么",
  "placeholder": "输入框占位符",
  "externalLink": "https://..."   // 可选
}
```

---

## 技术栈

| 层 | 选择 | 大小 |
| --- | --- | --- |
| 服务端 | Node.js + ws | 一个 npm 包 |
| 数据 | JSON 文件，2 秒防抖落盘 | - |
| 前端 | Preact + @preact/signals + htm（CDN） | ~12KB gzip |
| 实时 | WebSocket | 浏览器原生 |
| 构建 | **无** | - |

**为什么无构建？** 因为现代浏览器都支持 ES modules + import maps。CDN（esm.sh）提供 Preact，浏览器原生 import。开发体验现代化，部署体验最简化。

---

## 部署

### 本地（个人培训）
直接 `npm start`，把内网 IP 给学员。最大可支持约 100 人。

### 云服务器（公开课）
任何支持 Node 18+ 的环境都行：

**Render / Railway / Fly.io**：
- 检测到 `package.json` 自动安装
- Start command: `npm start`
- 暴露端口：`PORT` 环境变量自动注入

**自建 VPS（推荐方式）**：
```bash
# 在服务器上
git clone <repo>
cd app
npm install --omit=dev
npx pm2 start server.js --name lc
npx pm2 save
```

**Docker**：
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
VOLUME ["/app/data.json"]
CMD ["node", "server.js"]
```

### 持久化

服务端将所有事件、参与者、提交、投票每 2 秒落盘到 `data.json`（位于 `app/` 目录下）。重启服务 = 数据保留。要清空：删掉 `data.json`。

### 多场同时进行

无需任何配置，多个主持人同时使用同一个服务实例即可。每场有唯一 6 位 code，互不干扰。

---

## 测试

```bash
# 启动服务
npm start
# 另一个终端
node test-e2e.mjs
```

完整端到端测试覆盖：创建事件、加入、提交、首位徽章、投票、撤销投票、揭榜、XP 计算、自动推进、暂停/继续。

---

## 文件结构

```
app/
├── server.js              单文件后端（约 480 行）
├── package.json
├── curriculum.json        20 节点课程数据
├── data.json              ← 运行时自动生成（已 .gitignore）
├── test-e2e.mjs           端到端协议测试
├── public/
│   ├── index.html         入口
│   ├── styles.css         设计系统
│   ├── lib.js             Preact + htm 绑定
│   ├── store.js           Signals 全局状态
│   ├── ws.js              WebSocket 协议层
│   ├── app.js             根组件
│   ├── components/
│   │   ├── ui.js          按钮 / 头像 / 倒计时 / 模态 / 等
│   │   ├── qr.js          纯 JS QR 码生成（无依赖）
│   │   ├── effects.js     Toast / XP 飘字
│   │   ├── NodeMap.js
│   │   ├── Submission.js
│   │   └── ShareCard.js
│   └── views/
│       ├── Home.js        / 路由
│       ├── Event.js       /e/:code 路由分发
│       ├── Entry.js       学员入场（暱称+头像）
│       ├── Lobby.js       候场厅
│       ├── Play.js        主战场（reveal/open/voting/result）
│       ├── Host.js        主持人台
│       └── Finale.js      颁奖典礼
```

---

## 自定义指南

### 改视觉

`public/styles.css` 顶部的 `:root` 定义了所有设计 token。改一行即全局生效：

```css
:root {
  --peach: #FF7A59;   /* 主 CTA 色 */
  --sky:   #38BDF8;   /* 次 CTA 色 */
  --sun:   #FACC15;   /* 上榜/徽章 */
  /* ... */
}
```

### 改提示词模板变量

`{name}` 被替换为学员暱称。要添加更多变量（如 `{eventName}`），改 `views/Play.js` 中的 `filled()` 函数即可。

### 改 XP 公式

`server.js` 中的 `handleSubmit` 函数有完整 XP 计算逻辑。`handleVote` 处理投票分。

### 改徽章

`server.js` 中 `addBadgeOnce` 调用点决定徽章触发时机。新增徽章：加一次 `addBadgeOnce(p, 'slug', '🎨', '徽章名', broadcasters)`。

---

## 已知局限（v2 故意不做）

- 单进程内存 + JSON 文件 → 单机部署最多约 200 并发学员。要更高，需要 Redis + 多进程，但对培训场景太重。
- 无管理后台 → 教研要批量改课程只能编辑 JSON 重启。后台是 v3 的事。
- 学员不能跨设备同步 → 同一浏览器 = 同一身份；换浏览器 = 重新入场。
- 无导出 → 散场后想拿 CSV 数据库还得用脚本读 `data.json`。下一版的事。
- 无私有部署 / SSO → 这是 B2B 才需要的。

完整设计 + 扩展路线图：[`../design/ai-training-platform/`](../design/ai-training-platform/)

---

## 致谢

设计 5 次迭代参见 `design/ai-training-platform/`，灵感来自 Duolingo（视觉语言）、Kahoot（同步多人）、Slido（同侪反馈）、Notion（协作感）。
