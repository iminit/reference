# 系统总览图

## 1. 高阶架构

```
                        ╭──────────── 学员（手机）─────────────╮
                        │  Next.js App (PWA)                    │
                        │  - 入场页 / 候场厅                     │
                        │  - 主战场（瀑布流 + 投票）              │
                        │  - 颁奖典礼                            │
                        ╰────────────────┬──────────────────────╯
                                          │ HTTPS + WSS
                                          │
                        ╭─── 学员（电脑·可选）─╮
                        │ 子 session 仅用于    │
                        │ 提交输入与上传        │
                        ╰─────────┬───────────╯
                                  │
                                  │
                        ╭─────────┴──────────────╮
                        │   Vercel Edge Network   │
                        │   Next.js RSC + Edge Fn │
                        ╰─────────┬──────────────╯
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        │                          │                           │
   ╭────▼─────╮              ╭────▼──────╮               ╭───▼────────╮
   │ Supabase │              │ Supabase  │               │ Supabase   │
   │ Postgres │              │ Realtime  │               │ Edge       │
   │ 15       │◀────────────▶│ - Presence│               │ Functions  │
   │          │   Trigger    │ - Broadcast               │ (Deno)     │
   │ + RLS    │   Listen     │ - Changes │               │            │
   ╰─────┬────╯              ╰────┬──────╯               ╰────┬───────╯
         │                         │                            │
         │                         │                            │
         │                ┌────────┴──────┐                     │
         │                │  WebSocket    │                     │
         │                │  (亚秒级广播)  │                     │
         │                └────────┬──────┘                     │
         │                         │                            │
         └─────────────────────────┴────────────────────────────┘
                                  │
                                  │
                        ╭─────────▼─────────╮
                        │   主持人台           │
                        │   /host/[code]      │
                        │   - 5+1 按钮         │
                        │   - 实时大屏          │
                        │   - 节奏看板          │
                        ╰─────────────────────╯


  ╭──── 可观测性 ────╮         ╭──── 教研后台 ────╮
  │ PostHog          │         │ Retool / Appsmith│
  │ Sentry           │         │ - 题库 CRUD       │
  │ Vercel Analytics │         │ - SDUI 编辑器     │
  ╰──────────────────╯         ╰──────────────────╯
```

## 2. 单次提交的数据流

```
   学员手机                  Edge Function              Postgres                 Realtime               所有客户端
       │                          │                       │                       │                       │
       │  POST /api/submit        │                       │                       │                       │
       │ ─────────────────────────▶                       │                       │                       │
       │  (idempotency_key)       │                       │                       │                       │
       │                          │                       │                       │                       │
       │                          │  RPC claim_first_submitter()                   │                       │
       │                          │ ──────────────────────▶                       │                       │
       │                          │   (advisory_lock)     │                       │                       │
       │                          │ ◀──── true/false──────│                       │                       │
       │                          │                       │                       │                       │
       │                          │  INSERT submissions   │                       │                       │
       │                          │ ──────────────────────▶                       │                       │
       │                          │                       │                       │                       │
       │                          │                       │  postgres_changes     │                       │
       │                          │                       │ ──────────────────────▶                       │
       │                          │                       │                       │  fanout INSERT event │
       │                          │                       │                       │ ─────────────────────▶│
       │  201 + submission_obj    │                       │                       │                       │
       │ ◀────────────────────────│                       │                       │                       │
       │                          │                       │                       │                       │
       │                          │  enqueue task         │                       │                       │
       │                          │ (compute_xp_badges)   │                       │                       │
       │                          │ ──────────────────────▶                       │                       │
       │                          │                       │                       │                       │
       │                          │  (异步, ~500ms 后)     │                       │                       │
       │                          │   UPDATE participants │                       │                       │
       │                          │ ──────────────────────▶                       │                       │
       │                          │                       │                       │                       │
       │                          │                       │  postgres_changes     │                       │
       │                          │                       │ ──────────────────────▶                       │
       │                          │                       │                       │  XP 滚动动画           │
       │                          │                       │                       │ ─────────────────────▶│
       │                          │                       │                       │                       │
```

## 3. FSM 推进的数据流

```
   主持人台              Edge Function           Postgres              Realtime           所有客户端
       │                       │                    │                     │                   │
       │  按住 1 秒确认         │                    │                     │                   │
       │                       │                    │                     │                   │
       │  POST /fsm-transition │                    │                     │                   │
       │ ──────────────────────▶                    │                     │                   │
       │                       │                    │                     │                   │
       │                       │  RPC fsm_transition()                    │                   │
       │                       │ ───────────────────▶                     │                   │
       │                       │                    │                     │                   │
       │                       │                    │  UPDATE event_nodes │                   │
       │                       │                    │  SET state = 'open' │                   │
       │                       │                    │                     │                   │
       │                       │                    │  TRIGGER notify     │                   │
       │                       │                    │ ────────────────────▶                   │
       │                       │                    │                     │  fanout UPDATE    │
       │                       │                    │                     │ ──────────────────▶
       │                       │                    │                     │                   │
       │                       │                    │                     │  状态机镜像更新    │
       │                       │                    │                     │  UI 切到 open     │
       │                       │                    │                     │  倒计时启动        │
       │                       │                    │                     │                   │
       │  200 OK               │                    │                     │                   │
       │ ◀──────────────────────                    │                     │                   │
       │                       │                    │                     │                   │
       │  撤销窗口 30s ●────────────────────────●    │                     │                   │
       │                                            │                     │                   │
```

## 4. 双屏配对协议

```
   手机（主 session）          Edge Function          Postgres              电脑（子 session）
       │                            │                    │                          │
       │  发起配对：POST /pair       │                    │                          │
       │  (生成 short_code)          │                    │                          │
       │ ───────────────────────────▶                    │                          │
       │                            │                    │                          │
       │                            │  INSERT pairings   │                          │
       │                            │ ───────────────────▶                          │
       │                            │                    │                          │
       │  返回 6 位 short_code       │                    │                          │
       │ ◀───────────────────────────                    │                          │
       │                            │                    │                          │
       │  显示二维码 + short_code    │                    │                          │
       │                            │                    │  访问 lightning.class/pair│
       │                            │                    │ ◀────────────────────────│
       │                            │                    │                          │
       │                            │  POST /pair/claim  │                          │
       │                            │ ◀───────────────────────────────────────────  │
       │                            │  (short_code)      │                          │
       │                            │                    │                          │
       │                            │  UPDATE pairings   │                          │
       │                            │  SET child_session │                          │
       │                            │ ───────────────────▶                          │
       │                            │                    │                          │
       │                            │  生成子 session JWT │                          │
       │                            │                    │                          │
       │                            │  200 + child_jwt   │                          │
       │                            │ ───────────────────────────────────────────▶  │
       │                            │                    │                          │
       │  realtime broadcast:       │                    │                          │
       │  pairing_done              │                    │                          │
       │ ◀───────────────────────────────────────────────────────────────────────── │
       │                            │                    │                          │
       │  现在两端同步              │                    │                          │
       │  电脑端可粘贴长文/图        │                    │                          │
       │  → 同步到手机的提交框       │                    │                          │
```

## 5. 客户端状态层

```
   ╭─────────────────────── Zustand Stores ────────────────────────╮
   │                                                                │
   │  useEventStore                                                │
   │    event: TrainingEvent | null                                │
   │    activeNode: EventNode | null                               │
   │    fsmState: FsmState                                         │
   │    countdown: number                                          │
   │                                                                │
   │  useParticipantStore                                          │
   │    me: Participant                                            │
   │    roster: Map<id, Participant>                               │
   │    presence: Set<id>                                          │
   │                                                                │
   │  useSubmissionsStore                                          │
   │    byNodeId: Map<nodeId, Submission[]>                        │
   │    optimisticPending: Submission[]                            │
   │    addOptimistic(s): void                                     │
   │    confirmInsert(payload): void                               │
   │                                                                │
   │  useVotesStore                                                │
   │    castByNode: Map<nodeId, Set<submissionId>>                 │
   │    remainingByNode: Map<nodeId, number>                       │
   │    optimisticVote(s): void                                    │
   │                                                                │
   │  useGameStore                                                 │
   │    xp: number                                                 │
   │    streak: number                                             │
   │    badges: Badge[]                                            │
   │    leaderboardRank: number                                    │
   │                                                                │
   ╰────────────────────────────────────────────────────────────────╯
                              ↑
                              │ Realtime hooks
                              │
   ╭──────────────────────────┼─────────────────────────────────────╮
   │                                                                 │
   │  useRealtimePresence(eventId)        → updates participantStore │
   │  useRealtimeBroadcast(channel)        → ephemeral effects        │
   │  useRealtimePostgresChanges(table)    → updates relevant store   │
   │                                                                 │
   ╰─────────────────────────────────────────────────────────────────╯
```
