# ⚡ LightningClass · AI 实践通关训练营

一个 **2 小时、多人在线、Duolingo 风格** 的 AI 应用技能游戏化培训平台。
基于 [`/design/ai-training-platform`](../design/ai-training-platform) 的 5 次迭代设计落地为可马上跑的产品。

> 你是培训主持人？继续往下读。
> 你想了解架构？读 `../design/ai-training-platform/README.md`。

## 5 分钟开课

### 1. 启动服务（在你的笔记本/服务器）

```bash
cd app
npm install           # 仅需一次，安装 ws (~50KB)
npm start
```

控制台会打印：

```
  ⚡ LightningClass · AI 实践通关训练营

  学员入口:    http://localhost:3000
  主持人台:    http://localhost:3000/host

  主持人令牌:  AB12CD
```

### 2. 你自己打开「主持人台」

浏览器访问 `http://localhost:3000/host`，输入控制台显示的「主持人令牌」（每次启动会重新生成；要固定可设 `HOST_TOKEN=mytoken npm start`）。

### 3. 把「学员入口」分享给你的培训对象

如果是局域网培训（同一个 WiFi），把 `http://localhost:3000` 中的 `localhost` 换成你电脑的内网 IP，比如 `http://192.168.1.100:3000`。

- macOS / Linux 看 IP：`ifconfig | grep "inet "`
- Windows 看 IP：`ipconfig`

如果在云服务器，直接用公网 IP 或域名。

> 💡 **想让学员扫码进场**？用 `https://cli.im/url` 或任何二维码生成工具，把链接转成二维码贴在群里 / 投影上。

### 4. 开课

学员陆续进入候场厅时，你会在主持人台看到他们的暱称头像逐个亮起。
人数差不多了，点 **🚀 开始培训**，按照主持人台右下角的 **「主持小贴士」** 一步步推进就行。

---

## 五个核心操作（主持人台）

每一关的流程都是这五步循环：

| 步骤 | 按钮 | 学员看到 |
| --- | --- | --- |
| 1 | 📢 **公布题目** | 题目浮现，但还不能提交 |
| 2 | ▶ **开放提交** | 输入框激活，倒计时启动 |
| 3 | ⏹ **关闭并投票** | 输入框锁定，每人 3 票投给最爱的答案 |
| 4 | 🏆 **展示榜单** | 卡片按得票数重排，前三名金边 |
| 5 | ➡ **进入下一关** | 切到下一个节点 |

> 关键按钮都有 **按住 0.6 秒** 防呆——避免直播中误触。
> 提交阶段倒计时不够用了，按右侧 **+60 秒**。

---

## 课程内容（20 关，4 阶段）

| 阶段 | 节点 | 主题 |
| --- | --- | --- |
| 🍑 破冰 | 1-5 | AI 自我介绍 · 邮件清零 · 深度检索 · 文档萃取 · 会议提取 |
| 🌊 职场 | 6-10 | 元提示词 · 数据透视 · 情绪翻译 · 个性化营销 · PPT 闪电战 |
| ☀️ 多模态 | 11-15 | 视觉咒语 · 声音合成 · 视频高光 · UI 风格 · 跨平台裂变 |
| 🌹 智能体 | 16-20 | Zapier 工作流 · 客服智能体 · 链式思考 · 研究智能体 · 终极飞轮 |

每一关都内置了：
- 题目正文
- 推荐 AI 工具 + 替代工具
- 一键复制的提示词模板（自动注入学员暱称）
- 「新手陷阱」提示
- 同侪投票评分标准
- 一键跳转到外部 AI 工具

完整课程在 [`curriculum.json`](./curriculum.json)，可自由修改。

---

## 游戏化机制（学员看到的）

- **XP 经济**：每次提交 100 分 + 速度奖（首位 50/前三 30/前十 15）+ 难度系数（×1.0~×1.5）
- **投票积分**：被投一票 +30 XP，节点冠军额外 +50 XP
- **温柔 streak**：连续提交 3/7/12/20 关分别解锁 🐕 / 🏔️ / 🧘 / 🌟 徽章
- **24 枚徽章**：速度系 / 共识系 / 心流系 / 慷慨系 / 至高系
- **颁奖典礼**：终关结束自动进入，奖台升起、烟花、可下载战绩

设计原理详见 [`../design/ai-training-platform/iteration-3-gamification.md`](../design/ai-training-platform/iteration-3-gamification.md)。

---

## 培训现场建议

- **学员设备**：手机看 LightningClass，电脑跑 AI 工具。或者全在电脑上分两个标签页。
- **AI 工具**：会前 24 小时把 [appendix/curriculum-20-nodes.md](../design/ai-training-platform/appendix/curriculum-20-nodes.md) 中各节点工具清单发给学员，让他们提前注册账号。
- **网络**：30-50 人内的局域网完全够，单台 MacBook 当服务器无压力。
- **应急**：如果某关大家普遍卡壳，按 **+60 秒** 不要硬关；如果实在不行就直接 **进入下一关**（数据不丢）。

---

## 自定义

### 修改课程

直接编辑 `curriculum.json`，重启服务即可。20 个节点的 schema：

```json
{
  "seq": 1,                       // 1-20
  "title": "节点名",
  "phase": "icebreak | workplace | multimodal | agentic",
  "phaseName": "中文阶段名",
  "difficulty": 1-5,
  "durationSec": 60-600,
  "tools": ["ChatGPT", "Claude"],
  "icon": "🤖",                    // emoji
  "accent": "peach | sky | sun | coral",
  "question": "题目正文",
  "promptTemplate": "...",         // {name} 会被替换为学员暱称
  "warning": "新手陷阱提示",
  "voteCriterion": "投票看什么",
  "placeholder": "输入框占位符",
  "externalLink": "https://..."    // 可选
}
```

### 修改视觉

`public/style.css` 顶部的 `:root` 是设计 token（颜色、圆角、阴影）。改一行变全局。

### 主持人令牌

启动时随机生成。固定令牌：

```bash
HOST_TOKEN=mySecretTraining npm start
```

### 部署到云

适配任何 Node ≥ 18 的环境。推荐：

- **Render** / **Railway** / **Fly.io**：一键 deploy
- **腾讯云轻量** / **阿里云 ECS**：`pm2 start server.js --name lc`
- **Docker**：附上一份 `Dockerfile`：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## 技术栈（极简）

| 层 | 技术 | 体积 |
| --- | --- | --- |
| 服务端 | Node.js + ws | 1 个 npm 包 |
| 数据 | 进程内存（单场单进程） | - |
| 前端 | 原生 HTML/CSS/JS | 0 构建步骤 |
| 实时通信 | WebSocket | 浏览器原生 |

**为什么这么简单？** 因为单场培训只需要单台机器、单进程就够了。
要做多场并发 / 数据持久化 / 100 万并发，看 [`../design/ai-training-platform/iteration-4-tech-hardening.md`](../design/ai-training-platform/iteration-4-tech-hardening.md) 的生产级方案。

---

## 已知局限（V0.1 故意没做）

- 单场培训共享一个 `event` 实例。**多个并行培训**需要 V0.2 引入 `eventCode` 路由（架构已支持，UI 路径待添加）。
- 数据**不持久化**。重启服务 = 重置全场。要持久化加 SQLite 几十行代码即可。
- **无账号系统**。学员暱称即身份，浏览器 localStorage 维持 session。
- **无防作弊**。设计文档里有 vote_weight 五因子算法，V0.2 后端开关上即可启用。
- **AI 工具登录**仍需学员自己做，平台不代理。

这些都是「为了 V0.1 当晚就能开课」的取舍。要扩展，看设计文档对应章节。

---

## 出问题？

| 症状 | 排查 |
| --- | --- |
| 学员看不到内容 | 检查防火墙是否放行 3000 端口 |
| 学员看到旧状态 | 让他刷新页面，WebSocket 会自动重连 |
| 我误触了按钮 | 不行 — 按钮已有按住确认。如果真触发了「下一关」想回去：暂时只能 `重置全场` |
| 想让某人成为副主持人 | V0.1 不支持，主持人台只有一个 |
| 投了别人但 +1 没显示 | 刷新一下 |

完整设计与扩展路线图：[`../design/ai-training-platform/`](../design/ai-training-platform/)
