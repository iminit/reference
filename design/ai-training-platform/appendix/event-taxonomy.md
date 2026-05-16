# 附录 · 埋点与可观测性事件矩阵

设计意图见 `../iteration-4-tech-hardening.md § 7`。

埋点工具：**PostHog**（业务事件）+ **Sentry**（错误）+ **Vercel Analytics**（性能）。

## 通用 schema

所有业务事件遵循统一结构：

```json
{
  "event": "<event_name>",          // snake_case
  "distinct_id": "<participant_id>",
  "$session_id": "<session_uuid>",
  "$set": {                         // 用户属性（首次设置即可）
    "event_id": "<event_uuid>",
    "device_type": "phone|desktop|tablet",
    "ua": "<user_agent>"
  },
  "properties": {
    "ts_client": "<ISO timestamp>",
    "node_seq": "<int|null>",
    "node_state": "<fsm_state|null>",
    ...event-specific props
  }
}
```

`ts_client` 是客户端发送时间；服务端落库会另存 `ts_server`，用于检测时钟漂移。

## 事件清单（按用户旅程分组）

### 入场漏斗（funnel: entry）

| event | 触发时机 | 关键属性 | 用途 |
| --- | --- | --- | --- |
| `landing_viewed` | 打开 `/e/[code]` | `event_code` | 漏斗起点 |
| `nickname_submitted` | 输入暱称并下一步 | `name_len`, `had_emoji` | 流失定位 |
| `avatar_picked` | 选择头像 | `avatar_id`, `was_random` | – |
| `lobby_entered` | 进入候场厅 | `time_since_landing_sec` | 入场总时长 |
| `tour_card_viewed` | 引导卡片显示 | `card_idx` (1..3) | 引导完成率 |
| `tour_completed` | 完成所有引导 | `total_sec` | – |
| `tool_check_passed` | AI 工具体检通过 | `tool_name` | 工具可用率 |
| `tool_check_skipped` | 跳过体检 | – | – |

### 主战场（funnel: gameplay）

| event | 触发时机 | 关键属性 |
| --- | --- | --- |
| `node_revealed` | FSM 进入 reveal | `node_seq`, `tools[]` |
| `node_open` | FSM 进入 open | `duration_sec` |
| `prompt_copied` | 用户点"一键复制" | `node_seq`, `template_len` |
| `external_link_clicked` | 跳转 AI 工具 | `node_seq`, `target_host` |
| `pairing_initiated` | 发起双屏配对 | `direction` (qr|short_code) |
| `pairing_completed` | 配对成功 | `time_taken_sec` |
| `submission_typed` | 用户开始输入（首次按键） | `node_seq` |
| `submission_drafted` | 输入框停顿 5 秒（未提交） | `chars_typed` |
| `submission_attempted` | 点击"提交"按钮 | `chars`, `had_image_url` |
| `submission_succeeded` | 提交成功（DB 写入返回） | `latency_ms`, `is_first_submitter` |
| `submission_failed` | 提交失败 | `error_kind`, `attempt_idx` |
| `submission_optimistic_rollback` | 乐观更新被回滚 | `error_kind` |
| `node_voting_open` | FSM 进入 voting | `node_seq`, `total_submissions` |
| `vote_cast` | 用户投出一票 | `vote_idx` (1..3), `time_since_voting_open_sec` |
| `vote_undone` | 撤销投票（V2 引入） | – |
| `node_result_revealed` | FSM 进入 result | `node_seq`, `top3_ids[]` |
| `node_advanced` | FSM 进入下一节点 | `node_seq` |

### 游戏化（funnel: gamification）

| event | 触发时机 | 属性 |
| --- | --- | --- |
| `xp_earned` | XP 入账 | `amount`, `source` (base|speed|votes|streak|difficulty) |
| `streak_increased` | streak 增加 | `new_streak`, `multiplier` |
| `streak_broken` | streak 减弱（不一定归零） | `previous`, `current` |
| `badge_awarded` | 解锁徽章 | `badge_slug`, `category` |
| `rank_changed` | 排行榜位置变化 | `from`, `to`, `total_xp` |

### 休息与节奏（funnel: pacing）

| event | 触发时机 | 属性 |
| --- | --- | --- |
| `intermission_started` | 中场休息开始 | – |
| `intermission_returned` | 中场结束时在线 | `was_active_during_break` |
| `lurker_warning_shown` | 潜水者拯救 L1 提示 | `consecutive_skips` |
| `lurker_simple_version_used` | 用简化版提交 | `node_seq` |
| `lurker_excused` | 选择"继续旁观" | `at_node_seq` |

### 颁奖与会后（funnel: finale）

| event | 触发时机 | 属性 |
| --- | --- | --- |
| `finale_started` | 进入颁奖 | – |
| `finale_act1_viewed` | 复盘幕看完 | – |
| `finale_act3_top3_revealed` | 前三揭晓 | `is_in_top3` (boolean) |
| `medal_downloaded` | 下载数字奖章 | `medal_type`, `dimension` |
| `recap_link_shared` | 点分享按钮 | `platform` (wechat|weibo|copy) |
| `recap_viewed_by_visitor` | recap 被未登录用户访问 | `visitor_referer_host` |

### 主持人（funnel: host）

| event | 触发时机 | 属性 |
| --- | --- | --- |
| `host_logged_in` | 主持人入场 | `event_id` |
| `host_button_clicked` | 5+1 按钮点击 | `button`, `was_undone_within_30s` |
| `host_undo_used` | 1 步撤销 | `undid_transition` |
| `host_emergency_extend` | 延长 60 秒 | `node_seq`, `count_this_node` |
| `host_force_skip` | 紧急跳关 | `node_seq`, `reason_text` |
| `host_vote_reset` | 重置某节点投票 | `node_seq`, `vote_count_before` |

### 系统（funnel: system）

| event | 触发时机 | 属性 |
| --- | --- | --- |
| `realtime_connected` | WS 建立 | `latency_ms` |
| `realtime_disconnected` | WS 断开 | `reason`, `last_event_age_ms` |
| `realtime_reconnect_attempt` | 重连尝试 | `attempt_idx`, `backoff_ms` |
| `realtime_reconnect_succeeded` | 重连成功 | `total_downtime_sec` |
| `fallback_polling_activated` | 降级到 HTTP 轮询 | `from_realtime_for_sec` |
| `error_thrown` | JS 异常 | `component`, `error_kind` |

## 关键漏斗与看板

### 1. 入场漏斗（landing → 首次提交）

```
landing_viewed
  ├ ↓ 95%
  nickname_submitted
    ├ ↓ 99%
    avatar_picked
      ├ ↓ 99%
      lobby_entered
        ├ ↓ 80%
        tour_completed
          ├ ↓ 75%
          tool_check_passed
            ├ ↓ 95%
            (Node 1 reveal → first submission_succeeded)
```

**Drop-off 监控阈值**：任何一步 < 85% 自动报警。

### 2. 单节点完成率漏斗

```
node_revealed (= 100%)
  ├ ↓
  prompt_copied (期望 60%+)
    ├ ↓
    external_link_clicked (期望 50%+)
      ├ ↓
      submission_attempted (期望 90%+ for icebreak, 70%+ for agentic)
        ├ ↓
        submission_succeeded (期望 95%+ of attempts)
```

### 3. 全场完课率指标

```
完课率 = COUNT(distinct participant who succeeded in Node 20)
       ÷ COUNT(distinct participant who entered lobby)
```

目标 ≥ 80%（V5 上线发售 Go/No-Go 标准）。

### 4. 投票健康度

```
vote_concentration (基尼系数, on submissions in 1 node) ∈ [0.3, 0.55]
vote_diversity     (per voter, unique recipients / total) > 0.65
collusion_flags    < 5%
```

主持人台显示绿/黄/红三色信号。

## Sentry 错误分类

| group | 严重性 | 处理 SLA |
| --- | --- | --- |
| `RealtimeChannel.*` | P1 | 15 分钟响应 |
| `SubmissionWriteFailed` | P0 | 5 分钟响应（直接影响用户） |
| `FsmInvalidTransition` | P1 | 15 分钟 |
| `SduiRenderError` | P2 | 1 小时 |
| `PairingCodeInvalid` | P3 | 当日 |
| `AnalyticsSendFailed` | P3 | 当日 |

## Web Vitals 上限

| 指标 | 入场页 | 主战场 | 颁奖典礼 |
| --- | --- | --- | --- |
| LCP | < 1.5s | < 2.0s | < 2.5s |
| FID/INP | < 100ms | < 200ms | < 300ms |
| CLS | < 0.05 | < 0.1 | < 0.1 |

颁奖典礼放宽是因为动画粒子大量加载，但 LCP 必须在动画"看到鼓点起"之前。

## 数据隐私

- `fingerprint_hash` = SHA-256(IP + UA + tz)，**不可逆**
- 暱称、提交内容会出现在 PostHog，故 PostHog 项目设置 **EU 数据驻留**
- 用户行使"被遗忘权"时，触发 `task_queue` 的 `purge_participant` 任务，30 天内清除所有事件
- 30 天后 PostHog 自动归档（项目级 retention 配置）

## 看板（PostHog Dashboard 配置）

**仪表盘 A：单场实时**（主持人台嵌入）
- 在线人数（实时）
- 当前节点提交率
- 实时排行榜前 10
- 投票活跃度（events/min）

**仪表盘 B：跨场对比**（运营用）
- 各场完课率
- 各节点平均提交率（横向对比）
- NPS 分布
- 推荐传播率

**仪表盘 C：A/B 实验**（产品用）
- 实验组 × 对照组的关键指标对比
- 显著性检验（用 PostHog 内置）

完整 PostHog 项目配置文件见 `analytics/posthog-project-config.json`（V1.0 sprint W6 交付）。
