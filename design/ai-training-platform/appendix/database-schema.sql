-- =============================================================================
--  LightningClass · 数据库 Schema v1.0
--
--  适配 Supabase Postgres 15。本文件应能在新库直接 psql 执行。
--  设计思路见 ../iteration-1-foundation.md § 5 和 iteration-4-tech-hardening.md § 3。
-- =============================================================================

-- 启用必要扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- 暱称搜索
CREATE EXTENSION IF NOT EXISTS "pg_cron";     -- 物化视图刷新

-- =============================================================================
-- 1. 课程模板（curriculum_nodes）
--    20 个题目的"模板"，与具体 event 解耦
-- =============================================================================

CREATE TABLE curriculum_nodes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,             -- 'node-01-ai-self-intro'
  display_name         text NOT NULL,
  phase                text NOT NULL CHECK (phase IN (
    'icebreak',         -- 1–5
    'workplace',        -- 6–10
    'multimodal',       -- 11–15
    'agentic'           -- 16–20
  )),
  recommended_seq      smallint NOT NULL CHECK (recommended_seq BETWEEN 1 AND 20),
  difficulty           smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  default_duration_sec smallint NOT NULL DEFAULT 180 CHECK (default_duration_sec BETWEEN 60 AND 600),
  question_md          text NOT NULL,
  ai_tools             text[] NOT NULL DEFAULT '{}',     -- ['chatgpt', 'claude']
  sdui_payload         jsonb NOT NULL,                   -- 见 server-driven-ui-schema.md
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curriculum_nodes_phase_seq ON curriculum_nodes (phase, recommended_seq);

-- =============================================================================
-- 2. 培训场次（training_events）
--    一场具体的 2 小时活动
-- =============================================================================

CREATE TABLE training_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code        text NOT NULL UNIQUE,                -- 'abc123', 入场短码
  session_name      text NOT NULL,                       -- '五月公开课 #042'
  host_user_id      uuid,                                -- 主持人，引用 auth.users
  status            text NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled',     -- 已排期未开始
    'lobby',         -- 候场厅开放
    'running',       -- 进行中
    'finale',        -- 颁奖典礼
    'finished',      -- 已结束
    'archived'       -- 归档（30 天后）
  )),
  active_node_id    uuid,                                -- 当前激活的节点（FK 在 event_nodes 创建后补）
  scheduled_at      timestamptz NOT NULL,
  started_at        timestamptz,
  finished_at       timestamptz,
  capacity          int NOT NULL DEFAULT 100 CHECK (capacity BETWEEN 10 AND 500),
  experiments       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- A/B 实验配置
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_events_status_scheduled ON training_events (status, scheduled_at);
CREATE INDEX idx_training_events_event_code ON training_events (event_code);

-- =============================================================================
-- 3. 事件节点实例（event_nodes）
--    每场 event 复制 20 个 curriculum_node 进来；FSM 状态挂在这一层
-- =============================================================================

CREATE TABLE event_nodes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES training_events(id) ON DELETE CASCADE,
  node_id           uuid NOT NULL REFERENCES curriculum_nodes(id),
  sequence_order    smallint NOT NULL CHECK (sequence_order BETWEEN 1 AND 20),
  state             text NOT NULL DEFAULT 'locked' CHECK (state IN (
    'locked',        -- 锁定，等待主持人公布
    'reveal',        -- 已公布题目，未开放提交
    'open',          -- 提交开放
    'voting',        -- 投票开放
    'result',        -- 揭榜
    'done'           -- 已归档
  )),
  duration_sec      smallint NOT NULL,           -- 复制自 curriculum_nodes.default_duration_sec，主持人可临场改
  overrides         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 临场修改的 SDUI 部分覆盖
  state_changed_at  timestamptz NOT NULL DEFAULT now(),
  opened_at         timestamptz,
  closed_at         timestamptz,
  UNIQUE(event_id, sequence_order)
);

-- 反向引用：让 training_events.active_node_id 的外键完整
ALTER TABLE training_events
  ADD CONSTRAINT fk_active_node FOREIGN KEY (active_node_id)
  REFERENCES event_nodes(id) ON DELETE SET NULL;

CREATE INDEX idx_event_nodes_event_state ON event_nodes (event_id, state);
CREATE INDEX idx_event_nodes_event_seq ON event_nodes (event_id, sequence_order);

-- =============================================================================
-- 4. 学员（participants）
--    匿名入场，没有 email/password
-- =============================================================================

CREATE TABLE participants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES training_events(id) ON DELETE CASCADE,
  display_name      text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 16),
  avatar_url        text,                                -- 预设的随机头像
  role              text NOT NULL DEFAULT 'learner' CHECK (role IN (
    'learner',       -- 学员
    'host',          -- 主持人
    'assistant',     -- 助教
    'spectator'      -- 旁听
  )),
  device_type       text CHECK (device_type IN ('phone', 'desktop', 'tablet')),
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  total_xp          int NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  is_first_submitter_count smallint NOT NULL DEFAULT 0,  -- 累计成为"首位提交者"次数
  streak_count      smallint NOT NULL DEFAULT 0,         -- 连续提交计数（衰减式）
  fingerprint_hash  text,                                -- IP+UA 哈希，用于反作弊（脱敏）
  UNIQUE(event_id, display_name)
);

CREATE INDEX idx_participants_event_xp ON participants (event_id, total_xp DESC);
CREATE INDEX idx_participants_event_last_seen ON participants (event_id, last_seen_at DESC);
CREATE INDEX idx_participants_fingerprint ON participants (fingerprint_hash) WHERE fingerprint_hash IS NOT NULL;

-- =============================================================================
-- 5. 提交（submissions）
-- =============================================================================

CREATE TABLE submissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_node_id      uuid NOT NULL REFERENCES event_nodes(id) ON DELETE CASCADE,
  participant_id     uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  content            text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb, -- {tool: 'midjourney', image_url: '...'}
  idempotency_key    text NOT NULL,                      -- 防重提交
  is_first_submitter boolean NOT NULL DEFAULT false,
  vote_count         numeric(10, 2) NOT NULL DEFAULT 0,  -- trigger 维护，因 vote_weight 是小数
  raw_vote_count     int NOT NULL DEFAULT 0,             -- 不带权重的票数
  xp_earned          int NOT NULL DEFAULT 0,             -- 异步计算
  rank_in_node       smallint,                           -- result 阶段算
  created_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE(event_node_id, participant_id),                 -- 每节点每人 1 条提交（覆盖式更新）
  UNIQUE(event_node_id, participant_id, idempotency_key) -- 幂等保护
);

CREATE INDEX idx_submissions_node_created ON submissions (event_node_id, created_at DESC);
CREATE INDEX idx_submissions_node_votes ON submissions (event_node_id, vote_count DESC);
CREATE INDEX idx_submissions_participant ON submissions (participant_id, created_at DESC);

-- =============================================================================
-- 6. 同侪投票（peer_votes）
-- =============================================================================

CREATE TABLE peer_votes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id      uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  event_node_id      uuid NOT NULL REFERENCES event_nodes(id) ON DELETE CASCADE,
  voter_id           uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  vote_weight        numeric(4, 2) NOT NULL DEFAULT 1.00 CHECK (vote_weight BETWEEN 0 AND 3),
  created_at         timestamptz NOT NULL DEFAULT now(),
  collusion_flag     boolean NOT NULL DEFAULT false,    -- 标记可疑投票

  UNIQUE(submission_id, voter_id)                        -- 一人一票一作品
  -- "不能投自己" 用 trigger 实现，因 CHECK 约束不能含子查询
);

-- 禁止给自己投票（DB 级硬约束）
CREATE OR REPLACE FUNCTION check_no_self_vote() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM submissions
    WHERE id = NEW.submission_id AND participant_id = NEW.voter_id
  ) THEN
    RAISE EXCEPTION 'Cannot vote for own submission'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_self_vote
  BEFORE INSERT ON peer_votes
  FOR EACH ROW EXECUTE FUNCTION check_no_self_vote();

CREATE INDEX idx_peer_votes_node_voter ON peer_votes (event_node_id, voter_id);
CREATE INDEX idx_peer_votes_submission ON peer_votes (submission_id);

-- 每节点每人最多 3 票 —— 用 trigger 而不是约束（约束无法跨行计数）
CREATE OR REPLACE FUNCTION check_vote_quota() RETURNS TRIGGER AS $$
DECLARE
  vote_count_int int;
BEGIN
  SELECT COUNT(*) INTO vote_count_int
  FROM peer_votes
  WHERE event_node_id = NEW.event_node_id
    AND voter_id = NEW.voter_id;

  IF vote_count_int >= 3 THEN
    RAISE EXCEPTION 'Vote quota exceeded: 3 per node per voter'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_vote_quota
  BEFORE INSERT ON peer_votes
  FOR EACH ROW EXECUTE FUNCTION check_vote_quota();

-- vote_count 同步 trigger
CREATE OR REPLACE FUNCTION sync_submission_vote_count() RETURNS TRIGGER AS $$
DECLARE
  target_submission_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_submission_id := OLD.submission_id;
  ELSE
    target_submission_id := NEW.submission_id;
  END IF;

  UPDATE submissions SET
    vote_count = COALESCE((
      SELECT SUM(vote_weight) FROM peer_votes
      WHERE submission_id = target_submission_id AND NOT collusion_flag
    ), 0),
    raw_vote_count = COALESCE((
      SELECT COUNT(*) FROM peer_votes
      WHERE submission_id = target_submission_id AND NOT collusion_flag
    ), 0)
  WHERE id = target_submission_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_vote_count
  AFTER INSERT OR UPDATE OR DELETE ON peer_votes
  FOR EACH ROW EXECUTE FUNCTION sync_submission_vote_count();

-- =============================================================================
-- 7. 徽章（badges + participant_badges）
-- =============================================================================

CREATE TABLE badges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,               -- 'lightning', 'crowd-favorite'
  category           text NOT NULL CHECK (category IN (
    'speed',          -- 速度系
    'consensus',      -- 共识系
    'flow',           -- 心流系
    'multi',          -- 多面手系
    'generous',       -- 慷慨系
    'apex'            -- 至高系
  )),
  display_name       text NOT NULL,
  description        text NOT NULL,
  icon_emoji         text NOT NULL,
  rarity             text NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  is_hidden          boolean NOT NULL DEFAULT false,     -- 隐藏徽章
  award_rule         jsonb NOT NULL                       -- 触发条件描述（机器可读）
);

CREATE TABLE participant_badges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id     uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  badge_id           uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at         timestamptz NOT NULL DEFAULT now(),
  context            jsonb,                              -- {triggered_by: 'submission_xxx'}

  UNIQUE(participant_id, badge_id)
);

CREATE INDEX idx_participant_badges_participant ON participant_badges (participant_id, awarded_at DESC);

-- =============================================================================
-- 8. 任务队列（task_queue）
--    异步任务：XP 计算、徽章判定、collusion 重算等
-- =============================================================================

CREATE TABLE task_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type          text NOT NULL,                      -- 'calc_xp', 'award_badge', 'recompute_votes'
  payload            jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'done', 'failed'
  )),
  attempts           smallint NOT NULL DEFAULT 0,
  max_attempts       smallint NOT NULL DEFAULT 3,
  scheduled_at       timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  error_message      text
);

CREATE INDEX idx_task_queue_pending ON task_queue (scheduled_at)
  WHERE status = 'pending';
CREATE INDEX idx_task_queue_type_status ON task_queue (task_type, status);

-- =============================================================================
-- 9. 配对（pairings） — 双屏配对协议
-- =============================================================================

CREATE TABLE pairings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code         text NOT NULL UNIQUE,               -- 6 位数字
  parent_session_id  uuid NOT NULL,                       -- 手机 session
  parent_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  child_session_id   uuid,                                -- 电脑端 session，配对后写入
  paired_at          timestamptz,
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX idx_pairings_short_code ON pairings (short_code) WHERE paired_at IS NULL;
CREATE INDEX idx_pairings_parent ON pairings (parent_participant_id);

-- =============================================================================
-- 10. 物化视图：实时排行榜
-- =============================================================================

CREATE MATERIALIZED VIEW leaderboard_live AS
SELECT
  p.event_id,
  p.id AS participant_id,
  p.display_name,
  p.avatar_url,
  p.total_xp,
  COUNT(DISTINCT pb.badge_id) AS badge_count,
  ROW_NUMBER() OVER (PARTITION BY p.event_id ORDER BY p.total_xp DESC, p.joined_at ASC) AS rank
FROM participants p
LEFT JOIN participant_badges pb ON pb.participant_id = p.id
WHERE p.role = 'learner'
GROUP BY p.event_id, p.id;

CREATE UNIQUE INDEX idx_leaderboard_live_event_participant
  ON leaderboard_live (event_id, participant_id);
CREATE INDEX idx_leaderboard_live_event_rank
  ON leaderboard_live (event_id, rank);

-- 每 5 秒刷新（仅 running 状态的 event 才需要）
-- 实际部署时由 pg_cron 配置
-- SELECT cron.schedule('refresh-leaderboard', '*/5 * * * * *',
--   $$REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_live$$);

-- =============================================================================
-- 11. RLS 策略（行级安全）
-- =============================================================================

ALTER TABLE training_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_nodes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE peer_votes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairings           ENABLE ROW LEVEL SECURITY;

-- helper：从 JWT 拿到当前 participant_id
CREATE OR REPLACE FUNCTION current_participant_id() RETURNS uuid AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb->>'participant_id')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_event_id() RETURNS uuid AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb->>'event_id')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_role_text() RETURNS text AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb->>'role';
$$ LANGUAGE sql STABLE;

-- training_events: 只能读自己所在的 event
CREATE POLICY tev_select ON training_events FOR SELECT
  USING (id = current_event_id());

CREATE POLICY tev_host_update ON training_events FOR UPDATE
  USING (current_role_text() = 'host' AND host_user_id = current_participant_id());

-- event_nodes: 自己 event 的可读，主持人可更新 state
CREATE POLICY enod_select ON event_nodes FOR SELECT
  USING (event_id = current_event_id());

CREATE POLICY enod_host_update ON event_nodes FOR UPDATE
  USING (
    event_id = current_event_id()
    AND current_role_text() = 'host'
  );

-- participants: 同 event 互相可见（仅 display_name + avatar + total_xp），但敏感字段限本人
CREATE POLICY part_select ON participants FOR SELECT
  USING (event_id = current_event_id());

CREATE POLICY part_self_update ON participants FOR UPDATE
  USING (id = current_participant_id());

-- submissions: 同 event 可读；只能创建/更新自己的
CREATE POLICY subm_select ON submissions FOR SELECT
  USING (
    event_node_id IN (SELECT id FROM event_nodes WHERE event_id = current_event_id())
  );

CREATE POLICY subm_self_insert ON submissions FOR INSERT
  WITH CHECK (participant_id = current_participant_id());

CREATE POLICY subm_self_update ON submissions FOR UPDATE
  USING (participant_id = current_participant_id())
  WITH CHECK (participant_id = current_participant_id());

-- peer_votes: 同 event 可读；只能创建自己的，不能投自己
CREATE POLICY votes_select ON peer_votes FOR SELECT
  USING (
    event_node_id IN (SELECT id FROM event_nodes WHERE event_id = current_event_id())
  );

CREATE POLICY votes_self_insert ON peer_votes FOR INSERT
  WITH CHECK (
    voter_id = current_participant_id()
    AND submission_id NOT IN (
      SELECT id FROM submissions WHERE participant_id = current_participant_id()
    )
  );

-- participant_badges: 同 event 可读
CREATE POLICY pbadges_select ON participant_badges FOR SELECT
  USING (
    participant_id IN (SELECT id FROM participants WHERE event_id = current_event_id())
  );

-- pairings: 只能操作自己的
CREATE POLICY pair_select ON pairings FOR SELECT
  USING (parent_participant_id = current_participant_id());

CREATE POLICY pair_self_insert ON pairings FOR INSERT
  WITH CHECK (parent_participant_id = current_participant_id());

-- =============================================================================
-- 12. 维护视图与函数
-- =============================================================================

-- 主持人台用的"健康度看板"
CREATE OR REPLACE VIEW v_event_health AS
SELECT
  e.id AS event_id,
  e.session_name,
  COUNT(DISTINCT p.id) FILTER (WHERE p.last_seen_at > now() - interval '30 seconds') AS online_now,
  COUNT(DISTINCT p.id) AS total_joined,
  (SELECT COUNT(*) FROM submissions s
   JOIN event_nodes en ON en.id = s.event_node_id
   WHERE en.event_id = e.id AND en.id = e.active_node_id) AS current_node_submissions,
  (SELECT en.sequence_order FROM event_nodes en WHERE en.id = e.active_node_id) AS active_node_seq,
  (SELECT en.state FROM event_nodes en WHERE en.id = e.active_node_id) AS active_node_state
FROM training_events e
LEFT JOIN participants p ON p.event_id = e.id AND p.role = 'learner'
WHERE e.status IN ('lobby', 'running', 'finale')
GROUP BY e.id;

-- "首位提交者"判定：用 advisory lock 防并发
CREATE OR REPLACE FUNCTION claim_first_submitter(p_event_node_id uuid, p_participant_id uuid)
RETURNS boolean AS $$
DECLARE
  is_first boolean;
BEGIN
  -- 用事务级 advisory lock 序列化同一节点的判定
  PERFORM pg_advisory_xact_lock(hashtext(p_event_node_id::text));

  SELECT NOT EXISTS (
    SELECT 1 FROM submissions
    WHERE event_node_id = p_event_node_id AND is_first_submitter = true
  ) INTO is_first;

  IF is_first THEN
    UPDATE submissions
    SET is_first_submitter = true
    WHERE event_node_id = p_event_node_id AND participant_id = p_participant_id;
  END IF;

  RETURN is_first;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
--  Schema 文件结束。
--  完整 ER 图 + 索引说明请参考 ../iteration-4-tech-hardening.md。
-- =============================================================================
