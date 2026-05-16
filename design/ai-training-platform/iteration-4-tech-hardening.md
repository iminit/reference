# 迭代 4 · 技术架构硬化 (V1.3)

## 这一版要解决的问题

| 编号 | 风险 | V4 解决方式 |
| --- | --- | --- |
| #4 网络抖动断线 | 断线重连协议 + 离线提交队列 |
| #9 SDUI 边界失控 | 严格 JSON Schema + 版本化 |
| #11 可观测性缺失 | 三层埋点矩阵 |
| 200 并发下的延迟 | Realtime 通道分流 + DB 索引设计 |
| Realtime 完全挂掉 | 三级降级策略 |
| 投票实时计算 | 在 DB 用 Generated Column + Trigger |

V4 是给运维和工程师看的，但它直接决定了用户在最关键的"提交那一刻"是否流畅。

---

## 1. 容量规划：单场 200 人的真实负载

### 1.1 高峰场景

**Worst case：Node 5 倒数最后 30 秒**

- 200 人同时输入（典型："正在打字"事件 200 events/sec）
- 200 人陆续提交，时间窗 60 秒（约 3.3 inserts/sec）
- 200 人都在看瀑布流，每人订阅 1 个 `submissions` 表的 INSERT 流（200 个并发订阅）
- 进入 VOTING 后，每人 3 票/节点 × 200 = 600 votes 在 90 秒窗口（~6.7 inserts/sec）

### 1.2 估算总量

| 指标 | 单场 | 月（20 场） |
| --- | --- | --- |
| Submissions | 200 × 20 = 4,000 | 80,000 |
| Votes | 200 × 60 = 12,000 | 240,000 |
| Realtime 消息（含 broadcast） | ~50 万 | ~1,000 万 |
| 在线连接 peak | 200 | 200（并发上限） |

Supabase 默认配额：
- Realtime 并发连接：500（足够）
- Realtime 消息上限：200/秒（**不够**——broadcast 高峰会爆）
- DB connections：60（用 PgBouncer pooling 后 ∞）

**结论**：需要付费档（Pro 或 Team），且 Broadcast 需要做客户端节流。

---

## 2. Supabase Realtime 三通道详细设计

### 2.1 三通道分工

```
┌────────────────────────────────────────────────────────────────┐
│  Channel A: presence:event_{id}                                │
│  ────────────────────────────────                               │
│  用途：花名册（谁在线、谁离线）                                   │
│  事件：sync / join / leave                                      │
│  载荷：{ participant_id, display_name, avatar_url, device_type } │
│  频次：低（用户进出时）                                          │
│  Fan-out：200 个客户端                                          │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  Channel B: broadcast:event_{id}:node_{seq}                    │
│  ────────────────────────────────                               │
│  用途：高频瞬态事件（打字、投票动画、表情）                       │
│  事件：'typing' / 'vote_burst' / 'reaction'                     │
│  载荷：{ from, kind, position?, ts }                            │
│  频次：高（200 events/sec 峰值）                                 │
│  Fan-out：200 个客户端                                          │
│  ⚠ 客户端必须做节流 —— 每秒不超过 5 个 typing 事件               │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  Channel C: postgres_changes:event_{id}                        │
│  ────────────────────────────────                               │
│  用途：持久化数据变更（提交、投票计数、FSM 切换）                 │
│  订阅：                                                          │
│    - submissions: INSERT WHERE event_id = X                     │
│    - submissions: UPDATE WHERE event_id = X (用于 vote_count)   │
│    - event_nodes: UPDATE WHERE event_id = X (FSM 状态变化)      │
│  频次：中（~10 events/sec 峰值）                                 │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 为什么不订阅 `peer_votes` 表

200 人 × 3 票 × 20 节点 = 12,000 行的频繁插入，全 fan-out 出去 = 240 万条消息。

**正确做法**：投票走 broadcast + DB 写入，**前端不订阅 `peer_votes` 的变更**，而是订阅 `submissions.vote_count`（generated column）的更新。

```sql
ALTER TABLE submissions ADD COLUMN vote_count int GENERATED ALWAYS AS (
  -- 此处实际用 trigger 维护，不是真正 generated（generated 不能跨表）
) STORED;
```

实际实现：

```sql
CREATE OR REPLACE FUNCTION sync_vote_count() RETURNS TRIGGER AS $$
BEGIN
  UPDATE submissions SET vote_count = (
    SELECT COALESCE(SUM(vote_weight), 0)
    FROM peer_votes
    WHERE submission_id = NEW.submission_id
  )
  WHERE id = NEW.submission_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vote_count_after_insert
  AFTER INSERT OR DELETE ON peer_votes
  FOR EACH ROW EXECUTE FUNCTION sync_vote_count();
```

`submissions.vote_count` 变更时，订阅了 `submissions` UPDATE 的客户端会收到新值，但**不会**收到具体的每张票详情（这种是 broadcast 干的）。

### 2.3 客户端节流策略

```ts
// 打字事件：每个用户最多每 300ms 发一次
const sendTyping = throttle(() => {
  channel.send({ type: 'broadcast', event: 'typing', payload: {...} })
}, 300, { leading: true, trailing: false })

// 投票点击：本地立即更新 UI，broadcast 立即发，DB 写入 batch（500ms 批）
const queueVote = (submissionId: string) => {
  optimisticVoteUpdate(submissionId)         // 立即 UI 反馈
  broadcastVote(submissionId)                // 立即广播动画
  voteBatcher.add({ submissionId })          // 缓冲到 batch
}
voteBatcher.flushEvery(500) // 每 500ms 批量写 DB
```

---

## 3. 数据库优化

### 3.1 核心索引

```sql
-- 瀑布流查询（最热）
CREATE INDEX idx_submissions_event_node_created ON submissions
  (event_node_id, created_at DESC);

-- 学员个人作品集
CREATE INDEX idx_submissions_participant ON submissions
  (participant_id, created_at DESC);

-- 投票去重 + 计票
CREATE UNIQUE INDEX uniq_vote_one_per_pair ON peer_votes
  (submission_id, voter_id);

-- 每节点每人 3 票约束（用部分索引 + trigger 双重保险）
-- 见 appendix/database-schema.sql

-- FSM 状态查询
CREATE INDEX idx_event_nodes_event_state ON event_nodes
  (event_id, state);

-- 排行榜（leaderboard）
CREATE INDEX idx_participants_event_xp ON participants
  (event_id, total_xp DESC);
```

### 3.2 行级安全（RLS）策略

```sql
-- 关键：参与者只能读自己 event 的内容
CREATE POLICY "participants read own event"
ON submissions FOR SELECT
USING (
  event_id IN (
    SELECT event_id FROM participants
    WHERE id = current_setting('request.jwt.claims', true)::jsonb->>'participant_id'::uuid
  )
);

-- 投票：不能投自己
CREATE POLICY "no self vote"
ON peer_votes FOR INSERT
WITH CHECK (
  voter_id != (
    SELECT participant_id FROM submissions WHERE id = submission_id
  )
);

-- FSM：只有主持人可以更新 event_nodes.state
CREATE POLICY "only host can change state"
ON event_nodes FOR UPDATE
USING (
  current_setting('request.jwt.claims', true)::jsonb->>'role' = 'host'
  AND event_id = (
    SELECT event_id FROM event_hosts
    WHERE host_id = current_setting('...')::uuid
  )
);
```

完整 RLS 策略见 `appendix/database-schema.sql`。

### 3.3 写入优化：投票的批量插入

前端 batch 500ms 内的投票事件，由 Edge Function 批量 INSERT：

```ts
// Edge Function: /functions/submit-votes
export default async function (req: Request) {
  const { votes } = await req.json()
  // votes: [{ submission_id, voter_id, vote_weight }]

  const { error } = await supabase
    .from('peer_votes')
    .insert(votes, { defaultToNull: false })
    .select()

  // 单次插入最多 ~50 条，避免长事务
}
```

### 3.4 读取优化：排行榜物化视图（V2 时引入）

V1 用 plain query 就够（200 行排序），V2 在主持人台引入：

```sql
CREATE MATERIALIZED VIEW leaderboard_live AS
SELECT
  p.id, p.display_name, p.avatar_url,
  p.total_xp,
  COUNT(DISTINCT b.badge_id) as badge_count,
  ROW_NUMBER() OVER (PARTITION BY p.event_id ORDER BY p.total_xp DESC) as rank
FROM participants p
LEFT JOIN participant_badges b ON b.participant_id = p.id
GROUP BY p.id;

-- 每 5 秒刷新（pg_cron）
SELECT cron.schedule('refresh-leaderboard', '*/5 * * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_live$$);
```

---

## 4. 服务端驱动 UI（SDUI）的严格规约

### 4.1 为什么需要 SDUI

让 `event_nodes.sdui_payload` 控制：
- 输入组件类型（text / textarea / url / image_url / multi_select）
- 校验规则（min_len / max_len / regex）
- 引导文案（占位符、提示词模板）
- 视觉强调（主题色、AI 工具图标）

让教研后台可以新增/改题而不发版。

### 4.2 但严格定义边界

完全自由 = 灾难（教研可以一个 nb 配置写崩前端）。所以定义 JSON Schema：

```typescript
type SduiPayload = {
  version: '1.0'
  theme: {
    accent: 'peach' | 'sky' | 'sun' | 'coral'      // 闭集
    icon: AiToolIconKey                              // 闭集
  }
  layout: 'single-input' | 'split-prompt-input' | 'multi-step'
  input: InputSpec
  guide: GuideSpec
  validation: ValidationSpec
  hints?: HintSpec[]
}

type InputSpec =
  | { kind: 'text';      maxLen: number; placeholder: string }
  | { kind: 'textarea';  maxLen: number; minLen?: number; placeholder: string }
  | { kind: 'url';       allowedHosts?: string[] }
  | { kind: 'image_url'; allowedHosts?: string[] }
  | { kind: 'multi';     fields: InputSpec[] }      // 最多嵌套 1 层

type GuideSpec = {
  copy_paste_template?: string        // 一键复制框内容
  example?: string
  warning?: string                    // "新手陷阱"
}
```

完整 schema 见 `appendix/server-driven-ui-schema.md`。

### 4.3 版本化

`sdui_payload.version` 是强制字段。前端按版本路由到不同 renderer：

```tsx
function NodeRenderer({ payload }: { payload: SduiPayload }) {
  switch (payload.version) {
    case '1.0': return <RendererV1 payload={payload} />
    case '1.1': return <RendererV11 payload={payload} />
    default: return <FallbackRenderer />
  }
}
```

V1.0 上线后 schema 不可破坏性变更——只能加新版本。

### 4.4 Renderer 的容错

```tsx
<ErrorBoundary fallback={<FallbackInput />}>
  <NodeRenderer payload={sduiPayload} />
</ErrorBoundary>
```

`<FallbackInput />` 是一个最朴素的"纯文本输入框 + 提交按钮"，确保 SDUI 解析失败也不会让用户失能。

---

## 5. 断线重连协议（解决风险 #4）

### 5.1 断线场景分类

| 场景 | 概率 | 处理 |
| --- | --- | --- |
| 移动网络切换 | 30% | 静默重连，无感 |
| WiFi 短断 5–30s | 15% | 静默重连 + 状态同步 |
| 完全离线 > 30s | 5% | 提示 + 缓存待提交内容 |
| 设备休眠 > 5min | 8% | 重新认证 + 同步全量 |

### 5.2 三阶段处理

**Stage 1（0–5 秒）：静默重连**

```ts
realtime.onClose = () => {
  showInlineToast('网络重连中...', { quiet: true })
  reconnectWithBackoff()
}
```

UI 顶部出现细线进度条，不打断当前操作。

**Stage 2（5–30 秒）：明确提示**

```
┌────────────────────────────────────┐
│  ⚡ 重连中… 你的内容已自动保存       │
│  ━━━━━━━━━━━━━━━━━━━━━━━○         │
│                                     │
│  [立即重试]                          │
└────────────────────────────────────┘
```

输入框保持可用（写入 localStorage），提交按钮变成"待联网提交"（队列）。

**Stage 3（30 秒+）：完整恢复**

重连成功后：
1. 重新 fetch 当前 event 状态
2. 重新订阅 Realtime 三通道
3. 检查 localStorage 待提交队列，逐个尝试发送
4. 如果当前节点已切换，提示"你错过了 1 个节点，已自动跳过"

### 5.3 提交去重

如果用户在断线时点了提交，重连后又自动重发，可能造成重复提交。

解决方案：

```ts
// 前端生成 submission idempotency key
const submitKey = `${participantId}-${eventNodeId}-${attempt}`

// 数据库层：
CREATE UNIQUE INDEX uniq_submission_idempotency
  ON submissions (event_node_id, participant_id, idempotency_key);

// 后端：INSERT ... ON CONFLICT DO NOTHING RETURNING *;
```

---

## 6. 三级降级策略

### 6.1 Realtime 完全不可用

**症状**：Supabase Realtime 整体宕机或客户端 WS 持续失败 > 60 秒

**降级**：

```
正常态                      降级 1                       降级 2
─────────              ─────────────              ─────────────
WS 实时推送              HTTP 轮询 (5s)              HTTP 轮询 (15s)
顶部花名册实时             花名册 5s 刷新              花名册关闭
打字气泡                   关闭                       关闭
投票动画                   关闭                       关闭
瀑布流即时                 5s 刷新                    15s 刷新
```

主持人台显示明显警告 banner：`"实时模式异常，已切换到 5s 同步。学员体验受影响但不会丢数据。"`

### 6.2 DB 写入慢

**症状**：单次提交 INSERT > 3 秒

**降级**：客户端直接显示 "提交已记录"（基于乐观更新），后台 retry。
失败 3 次后才显示 "网络拥堵，请稍后重试"。

### 6.3 主持人台失联

**症状**：主持人 5 分钟无操作 + 无心跳

**降级**：
- 学员侧显示 "主持人暂时离开，进度已暂停" 横幅
- 自动倒计时不再推进
- 助教（后台权限）可临时接管 FSM

---

## 7. 可观测性矩阵

### 7.1 三层埋点

**Layer 1: 系统指标（Sentry + Vercel Analytics）**

```
Web Vitals: LCP, FID, CLS, INP（实时上报）
Error: JS 错误 + Realtime 连接失败 + API 4xx/5xx
Performance: 路由切换耗时、组件渲染耗时
```

**Layer 2: 业务事件（PostHog）**

每个用户动作发一个事件，统一 schema：

```json
{
  "event": "submission_created",
  "user_id": "...",
  "session_id": "...",
  "event_id": "...",
  "node_seq": 7,
  "properties": {
    "content_len": 234,
    "had_ai_tool_indicator": true,
    "time_since_open_sec": 87,
    "device_type": "phone"
  }
}
```

完整事件清单见 `appendix/event-taxonomy.md`。

**Layer 3: 运营看板**

每场训练的"主持人看到的" + "我们运营看到的"：

```
运营看板（PostHog Dashboard）：
  - 实时同时在线
  - 各节点完成率（漏斗）
  - 各节点平均提交时长
  - 投票分布的 Gini 系数（监测共谋）
  - 错误率
  - 中场前后留存率
```

### 7.2 关键报警

| 报警 | 阈值 | 处理 |
| --- | --- | --- |
| 单场提交成功率 < 80% | 任一节点 | 飞书 @值班工程师 |
| Realtime 连接失败 > 5% | 5 分钟窗口 | PagerDuty |
| DB CPU > 80% | 持续 1 分钟 | 自动扩容预案 |
| 节点完成率 < 50% | 任一节点 | 主持人台显示警告 |

---

## 8. 异步任务

### 8.1 哪些事情用 Edge Function 异步

```
同步（写 DB 时立即处理）：
  ✅ 提交去重检查
  ✅ 首位提交者打标
  ✅ 投票权重计算（按当前 voter quality）

异步（队列，最终一致）：
  ✅ XP 计算与累加
  ✅ 徽章解锁判定
  ✅ vote_weight 的 collusion 重算
  ✅ 节点结束后的 result_tally
  ✅ 数字奖章生成（颁奖典礼时）

按节奏（pg_cron）：
  ✅ 物化视图刷新（5s）
  ✅ 会话健康度检查（30s）
  ✅ 离线用户清理（5min）
```

### 8.2 任务队列实现

直接用 PostgreSQL + `pg_cron` + `pg_notify`，不引入额外组件（如 Sidekiq）：

```sql
CREATE TABLE task_queue (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  payload jsonb not null,
  status text default 'pending', -- pending / running / done / failed
  attempts int default 0,
  scheduled_at timestamptz default now(),
  ...
);

CREATE INDEX idx_task_queue_pending
  ON task_queue (scheduled_at)
  WHERE status = 'pending';
```

Edge Function 用 `SKIP LOCKED` 抓取任务：

```sql
UPDATE task_queue SET status = 'running'
WHERE id = (
  SELECT id FROM task_queue
  WHERE status = 'pending' AND scheduled_at <= now()
  ORDER BY scheduled_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

---

## 9. 性能预算

| 操作 | 目标延迟 | 测量点 |
| --- | --- | --- |
| 入场页加载 | LCP < 1.5s | Web Vitals |
| 主战场首屏 | LCP < 2.0s | Web Vitals |
| 点击提交到看到自己卡片 | < 200ms | 客户端埋点 |
| 投票点击到 +1 数字 | < 100ms | 客户端埋点 |
| FSM 状态切换到所有客户端 UI 更新 | < 800ms | 服务端+客户端 |
| 排行榜刷新 | < 1s | 客户端 |
| 颁奖典礼烟花启动 | < 500ms | 客户端 |

任何一个超标都进入"延迟改进 sprint"。

---

## 10. 安全清单

1. **JWT 短期 + 刷新** — session token 1 小时，refresh token 24 小时
2. **RLS 全开** — 没有任何表是 `SECURITY DEFINER` 走绕过
3. **服务端校验** — 所有"长度上限""URL host 白名单"在 DB 层 CHECK + Edge Function 双校验
4. **XSS** — 用户提交全部 escape 渲染，禁止 `dangerouslySetInnerHTML`，markdown 经 DOMPurify
5. **URL 钓鱼** — 用户提交的链接渲染时显示 host，hover 显示完整 URL，外站打开
6. **速率限制** — Edge Function 用 IP + participant_id 双维度 rate limit（10 提交/分钟、30 投票/分钟）
7. **管理员二次验证** — `/admin` 路由用 TOTP，所有题库修改有审计日志
8. **数据导出脱敏** — 后台导出 CSV 时 IP 哈希、邮箱掩码

---

## 11. V4 摘要 / 关键决策

1. **Realtime 三通道分工明确** —— presence/broadcast/postgres_changes 各司其职
2. **不订阅 peer_votes**，订阅 `submissions.vote_count` —— 消息量降 100×
3. **客户端节流** —— typing 300ms、vote batch 500ms
4. **DB 索引六条 + RLS 全开** —— 安全与性能并重
5. **SDUI 严格 JSON Schema + 版本化** —— 灵活但有边界
6. **断线重连三阶段** —— 静默 → 提示 → 完整恢复
7. **idempotency key** —— 提交去重防重复
8. **三级降级策略** —— Realtime 挂了也能跑
9. **三层埋点 + 关键报警** —— 出问题能定位
10. **PostgreSQL 自带任务队列** —— 不引入额外组件

---

## 12. 留给下一版的开放议题

1. 0–90 秒入场体验怎么设计？—— V5
2. 会前/会中/会后三段式运营 SOP？—— V5
3. 商业模型（B2B/B2C/B2B2C 怎么选）？—— V5
4. A/B 实验框架？—— V5
5. 12 周上线路线图？—— V5

下一版 → `iteration-5-production.md`
