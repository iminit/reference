# 附录 · FSM 状态机完整规约

设计原则见 `../iteration-1-foundation.md § 6` 和 `../iteration-2-ux-system.md § 6`。

## 1. 状态字段

```
training_events.status      ∈ {scheduled, lobby, running, finale, finished, archived}
event_nodes.state           ∈ {locked, reveal, open, voting, result, done}
training_events.active_node_id  → 当前激活的 event_nodes.id
```

全局状态 = `(events.status, event_nodes[active].state)`。

## 2. 全场生命周期

```
              ┌──────────┐
              │scheduled │  T - X 天，已排期但未到时间
              └────┬─────┘
                   │ host:open_lobby (T - 30min)
                   ▼
              ┌──────────┐
              │  lobby   │  候场厅开放，学员陆续进入
              └────┬─────┘
                   │ host:start_event
                   ▼
              ┌──────────┐
              │ running  │  正式开始，进入第一个节点
              └────┬─────┘
                   │ 完成 Node 20
                   ▼
              ┌──────────┐
              │  finale  │  颁奖典礼
              └────┬─────┘
                   │ 颁奖动画结束
                   ▼
              ┌──────────┐
              │ finished │  会议结束，recap 可用
              └────┬─────┘
                   │ T + 30 天
                   ▼
              ┌──────────┐
              │ archived │  归档
              └──────────┘
```

异常路径：
- `lobby` / `running` 中如 `host:cancel_event` → `finished`（不进 finale）
- 任意状态 `system:emergency_freeze` 不改变状态，但禁止所有写入

## 3. 单节点生命周期

```
                  ┌──────────┐
                  │  locked  │
                  └────┬─────┘
                       │ host:publish_question
                       ▼
                  ┌──────────┐
                  │  reveal  │  显示题目，未开放提交
                  └────┬─────┘
                       │ host:open_submission
                       ▼
                  ┌──────────┐
                  │   open   │  开放提交（含倒计时）
                  └────┬─────┘
              ┌────────┴─────────┐
              │ timer:end        │ host:close_submission
              ▼                  ▼
                  ┌──────────┐
                  │  voting  │  投票开放
                  └────┬─────┘
              ┌────────┴─────────┐
              │ timer:end        │ host:reveal_results
              ▼                  ▼
                  ┌──────────┐
                  │  result  │  揭榜，金框前三
                  └────┬─────┘
                       │ host:advance_node
                       ▼
                  ┌──────────┐
                  │   done   │
                  └──────────┘
```

## 4. 状态转移表（含异常）

| from | event | to | 触发者 | 副作用 |
| --- | --- | --- | --- | --- |
| `locked` | `host:publish_question` | `reveal` | 主持人 | 客户端展示题目，预启动 SDUI |
| `reveal` | `host:open_submission` | `open` | 主持人 | 启动倒计时；学员输入框激活 |
| `reveal` | `host:back_to_locked` | `locked` | 主持人 30s 内 | 撤销 |
| `open` | `timer:end` | `voting` | 系统 | 输入框锁定；UI 切到投票模式 |
| `open` | `host:close_submission` | `voting` | 主持人 | 提前结束提交 |
| `open` | `host:extend_60s` | `open` | 主持人 | 倒计时延长 60 秒（每节点最多 2 次） |
| `voting` | `timer:end` | `result` | 系统 | 计算 rank_in_node、上榜金框 |
| `voting` | `host:reveal_results` | `result` | 主持人 | 提前揭榜 |
| `voting` | `host:reset_votes` | `voting` | 主持人 | 清空本节点 votes（核选项，每场限 2 次） |
| `result` | `host:advance_node` | `done` (本节) + `reveal` (下一节) | 主持人 | 推进 `events.active_node_id` |
| `result` | `host:skip_to_node` | 跳到任意未触发节点 | 主持人 | 紧急跳关（如时间不够） |
| 任意 | `system:emergency_freeze` | 不变 | 系统/管理员 | 禁写、显示警告 |
| 任意 | `host:force_skip_node` | `done` | 主持人（需二次确认） | 跳过当前节点 |

## 5. 撤销窗口

```
locked → reveal      撤销窗口：30 秒
reveal → open        撤销窗口：30 秒
open   → voting      撤销窗口：5 秒（更短，因学员已开始投票）
voting → result      撤销窗口：5 秒
result → done        撤销窗口：0（不可撤销，因徽章已颁发）
```

撤销不是真的"回到上一个状态"，而是允许在窗口内 `host:back_to_*`，超出窗口才进入"force"操作。

## 6. 客户端 UI 状态映射

| FSM 状态 | 学员端 UI | 主持人端 UI |
| --- | --- | --- |
| `locked` | 节点地图灰色锁标 | "公布题目"按钮亮 |
| `reveal` | 题目大字渐入 + 倒计时未启动 | "开放提交"亮，预览学员视图 |
| `open` | 输入框激活 + 倒计时沙漏 | "关闭提交"亮 + 节奏看板 + 实时瀑布流 |
| `voting` | 输入框锁定 + 卡片旁出现投票按钮 | "展示榜单"亮 + 投票分布看板 |
| `result` | 前三名金框 + 其他卡片按 vote_count 重排 | "进入下一关"亮 + 点评提示 |
| `done` | 节点头像在地图上变绿色 ✓ | 显示已完成节点统计 |

## 7. 状态机的实现位置

**前端**：客户端订阅 `event_nodes.UPDATE` 的 Realtime 事件，本地维护一个有限状态机镜像，纯渲染。

**主持人台**：每次按钮点击调用 Edge Function `/functions/fsm-transition`，由它执行 SQL 事务并广播：

```typescript
// /functions/fsm-transition/index.ts
export default async (req: Request) => {
  const { event_id, event_node_id, transition } = await req.json()

  const { data, error } = await supabase.rpc('fsm_transition', {
    p_event_node_id: event_node_id,
    p_transition: transition,
    p_host_id: getCurrentUserId(req)
  })

  if (error) return new Response(error.message, { status: 400 })
  return Response.json(data)
}
```

**数据库**：核心转移逻辑在 PL/pgSQL 函数 `fsm_transition`，保证原子性。

```sql
CREATE OR REPLACE FUNCTION fsm_transition(
  p_event_node_id uuid,
  p_transition text,
  p_host_id uuid
) RETURNS jsonb AS $$
DECLARE
  current_state text;
  new_state text;
BEGIN
  SELECT state INTO current_state FROM event_nodes
  WHERE id = p_event_node_id FOR UPDATE;

  new_state := CASE
    WHEN current_state = 'locked' AND p_transition = 'publish' THEN 'reveal'
    WHEN current_state = 'reveal' AND p_transition = 'open'    THEN 'open'
    WHEN current_state = 'open' AND p_transition = 'close'     THEN 'voting'
    WHEN current_state = 'voting' AND p_transition = 'reveal'  THEN 'result'
    WHEN current_state = 'result' AND p_transition = 'advance' THEN 'done'
    ELSE NULL
  END;

  IF new_state IS NULL THEN
    RAISE EXCEPTION 'Invalid transition: % from %', p_transition, current_state;
  END IF;

  UPDATE event_nodes
  SET state = new_state, state_changed_at = now(),
      opened_at = CASE WHEN new_state = 'open' THEN now() ELSE opened_at END,
      closed_at = CASE WHEN new_state = 'voting' THEN now() ELSE closed_at END
  WHERE id = p_event_node_id;

  -- advance_node 时把 active_node_id 推进到下一个
  IF p_transition = 'advance' THEN
    UPDATE training_events SET active_node_id = (
      SELECT id FROM event_nodes
      WHERE event_id = (SELECT event_id FROM event_nodes WHERE id = p_event_node_id)
        AND sequence_order = (SELECT sequence_order + 1 FROM event_nodes WHERE id = p_event_node_id)
      LIMIT 1
    )
    WHERE id = (SELECT event_id FROM event_nodes WHERE id = p_event_node_id);
  END IF;

  -- 入队"节点结束后"任务（计算 XP、徽章）
  IF new_state = 'result' THEN
    INSERT INTO task_queue (task_type, payload)
    VALUES ('compute_node_results', jsonb_build_object('event_node_id', p_event_node_id));
  END IF;

  RETURN jsonb_build_object('from', current_state, 'to', new_state);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## 8. 不变量（invariants）

任何时刻必须满足：

- 同一 `event` 最多有 1 个 `event_node` 不是 `locked` 或 `done` 状态
- `training_events.active_node_id` 指向的节点必须是非 `done` 状态（除 `finale`/`finished`）
- `participants.last_seen_at` 与 `presence` 频道事件偏差 < 60 秒
- `submissions.is_first_submitter = true` 的记录在每个 event_node 中**最多 1 条**

## 9. 测试用例摘要

```
test "host can publish then open submission"
  given: node in locked
  when:  host triggers publish then open
  then:  state = open, opened_at set

test "cannot transition from open to result directly"
  given: node in open
  when:  host triggers reveal
  then:  raises invalid transition

test "first_submitter only awarded once under concurrency"
  given: node in open
  when:  10 concurrent inserts in 5ms
  then:  exactly 1 row has is_first_submitter = true
```

完整测试集见后续 `test/fsm.test.ts`（V1.0 sprint W4 交付）。
