# 迭代 1 · 基础架构与风险识别 (V1.0)

## 这一版要解决的问题

原始需求是一份"半成品蓝图"——它描述了**应该有什么**（FSM、瀑布流、投票），但没有回答：

1. **给谁用？** 200 人的字节 OKR 培训，和 30 人的社区夜校，要不要同一个产品？
2. **核心循环是什么？** "提交→投票→排行"——但学员的 60 分钟在这里到底做了什么？
3. **第一性约束是什么？** 网络？算力？运营？还是用户的 AI 工具账号？
4. **失败长什么样？** 第 8 关有 30% 的人没提交，怎么办？
5. **能在 8 周内做出来吗？** 哪些是 MVP 必需，哪些可以放到 V2？

V1 不会"完成"产品设计，但要把上述问题逼到墙角，给出 **当前最佳判断 + 已知风险清单**。

---

## 1. 受众与定位

### 1.1 三类候选用户

| 画像 | 场景 | 人数 | 付费方 | 关键诉求 |
| --- | --- | --- | --- | --- |
| **A. 字节/腾讯式企业内训** | 部门季度团建 | 30–80 | 企业 HR | 完课率、可量化产出 |
| **B. 行业公开课/付费训练营** | 知识付费课 | 50–200 | 个人学员 | 单次体验爽、可分享朋友圈 |
| **C. 高校就业指导/职业训练** | 半学期实训 | 100–300 | 学校采购 | 与课时挂钩、可考核 |

### 1.2 V1 聚焦 B（公开付费课）

**理由**：
- A 类对完课率要求最高，但 HR 客户决策周期长（3–6 个月），不适合冷启动验证。
- C 类对功能稳定性容忍度低，且需要对接学校 SSO/LMS。
- **B 类是"产品自证有效"最快的市场**：用户为爽感付费，朋友圈传播即获客，2 小时单场即闭环。

V1–V2 围绕 B 优化；V3 抽出可复用的"企业版变体"接口（白标、SSO 占位、数据导出），但不做完整实现。

### 1.3 角色定义

| 角色 | 数量 | 核心动作 |
| --- | --- | --- |
| **Learner（学员）** | 30–200 | 提交答案、投票、欣赏他人作品 |
| **Host（主持人）** | 1 | 推进 FSM、点评、调动气氛 |
| **Curator（教研）** | 内部 | 编排课程、维护题库 |
| **Spectator（旁听）** | 0–∞ | 只看不投不交，会前 CEO/嘉宾旁听场景 |

`Spectator` 在 V1 不做，但 schema 上预留 `users.role` 字段，避免 V2 改表。

---

## 2. 信息架构

```
LightningClass
├─ /                          首页（营销+下场预告）
├─ /e/[event_code]            入场页（输入暱称/选头像）
├─ /e/[event_code]/lobby      候场厅（等待开始，左侧花名册右侧暖场动画）
├─ /e/[event_code]/play       主战场（节点循环：宣题→提交→投票→揭榜）
├─ /e/[event_code]/finale     颁奖典礼（XP 总榜 + 数字奖章下载）
├─ /e/[event_code]/recap      会后回看（提交合集 + 自己的作品集）
├─ /host/[event_code]         主持人控制台（FSM 控制盘 + 直播看板）
└─ /admin                     教研后台（管理员低代码）
```

**关键决策**：

- **没有"账号系统"**。学员凭 `event_code + 暱称`一次性入场，浏览器 localStorage 保留 7 天 session token。账号会成为冷启动的最大阻碍——多邻国早期也是匿名才起势的。
- **`/recap` 是产品的"长尾"**。它是用户回看自己作品、转发的页面，也是无成本拉新的入口（被分享者点链接看到的就是别人作品集）。
- **`/host` 与 `/play` 完全独立路由**，物理上跑同一个 Next.js 应用但权限隔离，避免学员误入。

---

## 3. 核心用户流程（Happy Path）

### 学员视角的两小时（按情绪节拍切分）

```
T=00:00  扫码入场       → 输入暱称、选随机头像（10 秒）
T=00:30  候场厅         → 看到其他人陆续亮灯，主持人开场暖暄
T=03:00  Node 1 开始    → "邮件清零"，简单题，让你赢一次
T=05:30  第一次提交     → 自己的卡片飘到顶端，第一次心跳
T=07:00  第一轮投票     → 给别人投三票，体验"我是评委"
T=09:00  Node 1 揭榜    → 前三名金框，主持人点评 30 秒
... (第 2–10 节点按 5–7 分钟单位重复，难度递增)
T=60:00  中场休息 5 min  → 喝水、活动、看花絮回放
T=65:00  Node 11 起     → 进入多模态阶段，开始变难
T=110:00 Node 20        → 终极融合挑战，集大成
T=115:00 颁奖典礼       → 烟花、奖台、可下载奖章
T=120:00 散场 + recap   → 一键转发自己的作品集
```

### 主持人视角

主持人不是"老师"，是"游戏主持 + 体育解说员 + DJ"的杂交。她的核心操作只有 5 个按钮：

```
[公布题目]  [开放提交]  [开启评分]  [展示榜单]  [进入下一关]
```

加上一个紧急按钮：`[延长 60 秒]`（应对"大家还没提交完"的现实情况）。

这种"5 + 1 按钮设计"是 V1 的关键约束——任何更复杂的操作面板都会让主持人在 200 人盯着的时候手忙脚乱。

---

## 4. 技术栈定稿

| 层 | 选择 | 替代品 | 选择理由 |
| --- | --- | --- | --- |
| 前端框架 | **Next.js 14 (App Router)** | Remix, Nuxt | RSC + 边缘渲染 + Vercel 一键部署 |
| 实时同步 | **Supabase Realtime** | Pusher, Ably, 自建 ws | Presence/Broadcast/Postgres Changes 三合一 |
| 数据库 | **Supabase Postgres 15** | PlanetScale, Neon | 与 Realtime 同源、RLS 原生支持、连接池托管 |
| 身份 | **匿名 session token (jose JWT)** | Supabase Auth | V1 不做账号系统，但 token 仍走 Supabase Auth 的 anonymous 模式以复用 RLS |
| 边缘函数 | **Supabase Edge Functions (Deno)** | Vercel Edge | 与 DB 共址，延迟最低 |
| 状态管理 | **Zustand + Realtime hooks** | Redux, Jotai | 轻、与 React 18 并发模式兼容 |
| UI | **Tailwind v3 + shadcn/ui + Framer Motion** | MUI, Chakra | token 化、动效一等公民 |
| 主持人台 | **同一个 Next.js 应用 / `/host` 路由** | Retool/Appsmith | **修改原方案**——见下文 |
| 部署 | **Vercel + Supabase Cloud** | 自建 K8s | 0 → 1 阶段不要碰运维 |
| 可观测性 | **PostHog + Sentry + Vercel Analytics** | Datadog | 埋点 + 错误 + Web Vitals |

### 与原方案的关键差异

**差异 1：放弃 Retool/Appsmith，主持人台用同一个 Next.js 应用**

原因：
- Retool 不支持 Supabase Realtime 的细粒度订阅，主持人台的"实时观察提交流"会落后 2–3 秒，主持人节奏会被破坏。
- 主持人台需要的不是 CRUD，而是"快门式控制" + "直播大屏"，低代码反而是负担。
- 自研只多 1 周工时，但获得视觉一致性和动效一致性。

教研后台（`/admin`）仍然可以用 Retool，因为它**不需要实时性**，只是 CRUD 题库。

**差异 2：明确"Edge Functions 做什么"**

```
Edge Function 用例：
  ✅ 提交时检测"首位提交者"并打标（带事务）
  ✅ 投票时校验 user_remaining_votes（带行锁）
  ✅ 节点结束时计算 XP 与徽章（异步）
  ✅ 颁奖典礼时生成数字奖章 SVG/PNG

Edge Function 不做的：
  ❌ FSM 状态切换 → 这是数据库事务，trigger 处理
  ❌ Realtime 广播 → Supabase Realtime 自动做
  ❌ 题目内容下发 → 直接读 DB + RLS
```

---

## 5. 数据库 Schema v1

详见 `appendix/database-schema.sql`，此处给出关键结构与设计意图。

### 8 张核心表

```
training_events       ← 一场培训的元数据 + FSM 当前状态
curriculum_nodes      ← 20 个题目（关联到 event 或 template）
event_nodes           ← event × node 的实例化（**新增表，原方案没有**）
participants          ← 学员（原方案叫 users，避免与 auth 冲突）
submissions           ← 提交记录
peer_votes            ← 同侪投票（uniq: submission_id × voter_id）
badges                ← 徽章定义
participant_badges    ← 学员获得的徽章
```

### 关键设计决策

**决策 1：分离 `curriculum_nodes`（模板）与 `event_nodes`（实例）**

原方案把题目与 event 1:1 绑定，问题：
- 同一套"AI 通用 20 关"会被复用 100 次，每次复制题目数据是浪费
- 主持人想换某一关的话，要改 events 的内嵌数据
- 教研侧无法做"题库 → 课程"组合

新方案：
```
curriculum_nodes (template)         event_nodes (instance)
─────────────────────              ─────────────────────────
id                                  id
slug                                event_id  ─┐
question_md                         node_id   ─┴─ 复合唯一
ai_tool_tag                         sequence_order
sdui_payload                        state           ← FSM 在这里
default_duration_sec                started_at
                                    ended_at
                                    overrides_json  ← 临场改题
```

**决策 2：FSM 状态字段挂在 `event_nodes` 不在 `training_events`**

原方案 `training_events.current_state` 把 FSM 状态放在事件级别，问题：
- 一个 event 有 20 个节点，每个节点都有自己的生命周期
- 用一个全局状态描述"当前在 Node 7 的 PEER_VOTING 阶段"会产生 `current_node × node_state` 的笛卡尔积，状态空间爆炸

新方案：
- `training_events.active_node_id` 指向当前激活的 `event_nodes.id`
- `event_nodes.state` 是单节点的 FSM 状态
- 全局状态 = `(event.active_node_id, event_nodes[active_node_id].state)`

**决策 3：投票表加冗余字段 `node_id`**

```sql
peer_votes (
  id, submission_id, node_id, voter_id, vote_weight, created_at,
  UNIQUE(submission_id, voter_id),
  UNIQUE(node_id, voter_id, ...) -- 此处控制"每节点每人 3 票"
)
```

冗余 `node_id` 的目的是让"每节点每人 3 票"的约束可以用部分唯一索引 + 计数触发器实现，不必每次 JOIN。

**决策 4：用 `submissions.metadata jsonb` 兜底未来扩展**

不为图片 URL、视频时长、AI 工具名等扩展字段加一堆 nullable column，而是：

```sql
submissions (
  ...
  content text,             -- 用户主提交（文字/链接）
  metadata jsonb default '{}'::jsonb,  -- {tool: 'midjourney', image_url: '...', model: 'mj-v6'}
  ...
)
```

V2 再根据真实使用频率决定哪些字段提升为列。

---

## 6. FSM v1（单节点版）

```
                  ┌──────────┐
                  │  LOCKED  │  初始/上一节点结束
                  └────┬─────┘
                       │ host:publish_question
                       ▼
                  ┌──────────┐
                  │  REVEAL  │  公布题目，倒计时未启动
                  └────┬─────┘
                       │ host:open_submission
                       ▼
                  ┌──────────┐
                  │   OPEN   │  提交开放，沙漏运行
                  └────┬─────┘
              ┌────────┴────────┐
   timer:end │                  │ host:close_submission
              ▼                  ▼
                  ┌──────────┐
                  │  VOTING  │  提交关闭，投票开放
                  └────┬─────┘
              ┌────────┴────────┐
   timer:end │                  │ host:reveal_results
              ▼                  ▼
                  ┌──────────┐
                  │  RESULT  │  揭榜，金框前三
                  └────┬─────┘
                       │ host:advance_node
                       ▼
                  ┌──────────┐
                  │   DONE   │  归档
                  └──────────┘
```

完整状态转移表（包括异常路径如 `host:force_skip`、`system:error_freeze`）见 `appendix/fsm-spec.md`。

---

## 7. ⚠️ 风险清单（V1 必须正视的 12 个问题）

按"杀伤力 × 解决难度"排序：

| # | 风险 | 杀伤力 | 触发场景 | 在哪一版解决 |
| --- | --- | --- | --- | --- |
| 1 | **AI 工具账号问题** | ★★★★★ | 学员没有 ChatGPT Plus，Midjourney 需要 Discord 账号 | V2（账号清单 + 替代工具 + 团购方案） |
| 2 | **首次启动失败** | ★★★★★ | Node 1 就有 20% 提交不上来，全场崩盘 | V2（Node 1 设计简化到"复制粘贴即过"） |
| 3 | **潜水者比例** | ★★★★ | 30 人场只有 12 人在交，社交压力反噬 | V3（潜水者拯救机制） |
| 4 | **网络抖动断线** | ★★★★ | Realtime 断线、重连数据丢失 | V4（断线重连协议 + 离线提交队列） |
| 5 | **投票串通/刷分** | ★★★★ | 朋友互投、机器人刷票 | V3（vote_weight 算法 + 同 IP 检测） |
| 6 | **主持人误操作** | ★★★ | 主持人不小心点了"下一关" | V2（5 大按钮加二次确认 + 1 步撤销） |
| 7 | **第 60–70 分钟疲劳谷** | ★★★ | 经验数据：在线培训第 1 小时末注意力大幅下降 | V3（强制中场 + 难度曲线设计） |
| 8 | **手机/桌面双屏切换** | ★★★ | 用户用电脑跑 AI，用手机看平台，认证一致性问题 | V2（双屏入场流） |
| 9 | **服务端驱动 UI 的边界** | ★★ | SDUI 太灵活会失控，太死板就回到硬编码 | V4（SDUI Schema 严格定义） |
| 10 | **题目难度量化失真** | ★★ | 教研觉得 Node 5 简单，实际是全场最难 | V5（A/B 框架做难度校准） |
| 11 | **可观测性缺失** | ★★ | 出问题时无法定位是 DB、Realtime 还是前端 | V4（事件埋点矩阵） |
| 12 | **会后留存为零** | ★★★ | 散场后用户再也不来，复购率为零 | V5（recap 页 + 7 天回访邮件） |

每一条风险在对应迭代里都会有"具体如何解决"的方案，不只是口号。

---

## 8. V1 摘要 / 关键决策

1. **聚焦 B 类（公开付费课）** 作为冷启动场景，30–200 人是黄金区间。
2. **匿名入场** —— 用 `event_code + 暱称` 而不是账号。
3. **主持人台自研** —— 放弃 Retool，统一 Next.js 应用。
4. **`curriculum_nodes` × `event_nodes` 两层结构** —— 题目模板与场次实例解耦。
5. **FSM 状态挂在节点级别** —— 而非事件级别。
6. **5+1 按钮原则** —— 主持人的操作面板必须能在 200 人盯着时不出错。
7. **12 个已识别风险** —— 后续 4 个迭代逐一对照解决。

---

## 9. 留给下一版的开放议题

1. 视觉系统：现在只有功能，没有"好看到想截图"的吸引力——V2 解决。
2. 双屏体验：用户用电脑跑 AI 工具时怎么提交？扫码？还是输入 short code？——V2 解决。
3. 微动效：提交后的卡片是"啪"地飞上去，还是"嗖"地滑上去？——V2 给出动效规范。
4. 12 个风险的具体方案——V2–V5 分头解决。

下一版 → `iteration-2-ux-system.md`
