-- Postgres DDL — AI 기반 API 모니터링 & 에러 그룹화 플랫폼 (MVP)
-- 원칙: 모든 도메인 테이블은 project 스코프. project_id는 서버가 ingest key에서
--       해석하며 클라이언트 입력을 신뢰하지 않는다(SPEC 3.1).
-- 볼륨: raw event retention 14일 + 시간 롤업 후 삭제(SPEC 10).

-- ─────────────────────────────────────────────────────────────
-- 테넌시
-- ─────────────────────────────────────────────────────────────
create table organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  created_at   timestamptz not null default now()
);

create table users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  created_at   timestamptz not null default now()
);

-- MVP 역할: owner / member 만
create table memberships (
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null check (role in ('owner','member')),
  primary key (org_id, user_id)
);

create table projects (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now()
);
create index on projects (org_id);

create table environments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  name         text not null check (name in ('development','staging','production')),
  created_at   timestamptz not null default now(),
  unique (project_id, name)
);

-- Ingest key: 서버가 이 키로 project_id/environment_id를 해석한다.
-- 키 원문은 저장하지 않고 해시만 저장.
create table ingest_keys (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  environment_id uuid not null references environments(id) on delete cascade,
  key_hash       text not null unique,          -- sha256(key)
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index on ingest_keys (project_id);

-- ─────────────────────────────────────────────────────────────
-- 이벤트 (raw telemetry) — 시간 파티션
-- ─────────────────────────────────────────────────────────────
-- strict schema: 허용 필드만. raw request body/header는 저장하지 않는다(SPEC 4.1).
create table events (
  id             bigserial,
  project_id     uuid not null,
  environment_id uuid not null,
  occurred_at    timestamptz not null,
  route          text not null,                 -- 정규화됨: /users/:id
  method         text not null,
  status         smallint not null,
  duration_ms    integer not null,
  release        text,
  commit_sha     text,
  exception_type text,                          -- 그룹화 입력
  message_norm   text,                          -- 정규화 메시지 템플릿(값 마스킹됨)
  top_frames     text[],                        -- top N app 프레임(framework 제거)
  issue_id       uuid,                          -- 그룹화 결과(런타임 채택 엔진)
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- 파티션은 주 단위 생성(운영 스크립트). 예시 1개:
-- create table events_2026w28 partition of events
--   for values from ('2026-07-06') to ('2026-07-13');

create index on events (project_id, occurred_at desc);
create index on events (project_id, issue_id);
create index on events (project_id, status);

-- 시간 롤업(파생 집계) — raw 삭제 후에도 대시보드 지표 유지
create table event_rollup_hourly (
  project_id     uuid not null,
  environment_id uuid not null,
  bucket_hour    timestamptz not null,
  route          text not null,
  status_class   smallint not null,             -- 2,3,4,5 (xx)
  count          integer not null,
  error_count    integer not null,
  p50_ms         integer,
  p95_ms         integer,
  primary key (project_id, environment_id, bucket_hour, route, status_class)
);

-- ─────────────────────────────────────────────────────────────
-- 이슈 (그룹화 단위)
-- ─────────────────────────────────────────────────────────────
create table issues (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  fingerprint    text not null,                 -- 규칙 엔진 결과 or 채택 엔진 결과
  title          text not null,
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null,
  event_count    integer not null default 0,
  status         text not null default 'open'   check (status in ('open','resolved','ignored')),
  affected_releases text[],
  created_at     timestamptz not null default now(),
  unique (project_id, fingerprint)
);
create index on issues (project_id, last_seen_at desc);

-- AI 증거 연결형 요약: 모든 claim은 근거 event_id/metric을 인용해야 한다(SPEC 7).
create table issue_summaries (
  id           uuid primary key default gen_random_uuid(),
  issue_id     uuid not null references issues(id) on delete cascade,
  project_id   uuid not null,                   -- 테넌트 필터 편의
  model        text not null,
  summary      text not null,
  evidence     jsonb not null,                  -- [{claim, event_ids[], metric_ids[]}]
  created_at   timestamptz not null default now()
);
create index on issue_summaries (issue_id);

-- ─────────────────────────────────────────────────────────────
-- 알림
-- ─────────────────────────────────────────────────────────────
create table alert_rules (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  environment_id uuid references environments(id) on delete cascade,
  metric         text not null check (metric in ('error_rate','latency_p95')),
  threshold      numeric not null,
  window_min     integer not null default 5,
  slack_webhook  text not null,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);
create index on alert_rules (project_id);

-- ─────────────────────────────────────────────────────────────
-- 연구용: 정답셋 라벨 (dev/test 분리) — docs/labeling-guide.md
-- ─────────────────────────────────────────────────────────────
create table gold_labels (
  event_id     bigint not null,
  split        text not null check (split in ('dev','test')),
  group_id     integer,                         -- null 이면 uncertain(제외)
  labeler      text,
  primary key (event_id, split)
);

-- ─────────────────────────────────────────────────────────────
-- 테넌트 격리 노트
-- ─────────────────────────────────────────────────────────────
-- - 애플리케이션 쿼리는 리포지토리 헬퍼를 통해서만 실행하고 project_id를 강제한다.
-- - 선택: Postgres RLS로 이중 방어.
--     alter table events enable row level security;
--     create policy events_tenant on events
--       using (project_id = current_setting('app.project_id')::uuid);
--   (요청마다 set_config('app.project_id', ...) 로 세팅)
