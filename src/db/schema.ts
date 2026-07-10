import {
  pgTable,
  uuid,
  text,
  timestamp,
  smallint,
  integer,
  bigserial,
  bigint,
  boolean,
  numeric,
  jsonb,
  primaryKey,
  unique,
  index,
} from "drizzle-orm/pg-core";

// 참고: 이 스키마는 docs/schema.sql 을 Drizzle 로 옮긴 것이다.
// events 파티셔닝은 MVP에서 drizzle-kit push 이후 수동 SQL 로 적용한다(주 단위).

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // MVP 역할: owner / member
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.orgId)],
);

export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // development / staging / production
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("environments_project_name").on(t.projectId, t.name)],
);

// Ingest key: 서버가 이 키로 project_id/environment_id 를 해석한다(클라이언트 불신).
export const ingestKeys = pgTable(
  "ingest_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(), // sha256(key)
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ingest_keys_project_idx").on(t.projectId)],
);

// 이벤트 (raw telemetry). strict schema: 허용 필드만. raw body/header 없음.
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    route: text("route").notNull(), // 정규화됨: /users/:id
    method: text("method").notNull(),
    status: smallint("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    release: text("release"),
    commitSha: text("commit_sha"),
    exceptionType: text("exception_type"),
    messageNorm: text("message_norm"),
    topFrames: text("top_frames").array(),
    issueId: uuid("issue_id"),
  },
  (t) => [
    index("events_project_time_idx").on(t.projectId, t.occurredAt),
    index("events_project_issue_idx").on(t.projectId, t.issueId),
    index("events_project_status_idx").on(t.projectId, t.status),
  ],
);

// 이슈 (그룹화 단위)
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    eventCount: integer("event_count").notNull().default(0),
    status: text("status").notNull().default("open"), // open / resolved / ignored
    affectedReleases: text("affected_releases").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("issues_project_fingerprint").on(t.projectId, t.fingerprint),
    index("issues_project_lastseen_idx").on(t.projectId, t.lastSeenAt),
  ],
);

// AI 증거 연결형 요약: 모든 claim 은 근거 event_id 를 인용해야 한다(SPEC 7).
export const issueSummaries = pgTable(
  "issue_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    model: text("model").notNull(),
    summary: text("summary").notNull(),
    evidence: jsonb("evidence").notNull(), // [{claim, event_ids[], metric_ids[]}]
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("issue_summaries_issue_idx").on(t.issueId)],
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id").references(() => environments.id, {
      onDelete: "cascade",
    }),
    metric: text("metric").notNull(), // error_rate / latency_p95
    threshold: numeric("threshold").notNull(),
    windowMin: integer("window_min").notNull().default(5),
    slackWebhook: text("slack_webhook").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }), // 쿨다운
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alert_rules_project_idx").on(t.projectId)],
);

// 연구용 정답셋 라벨 (dev/test) — docs/labeling-guide.md
export const goldLabels = pgTable(
  "gold_labels",
  {
    eventId: bigint("event_id", { mode: "number" }).notNull(),
    split: text("split").notNull(), // dev / test
    groupId: integer("group_id"), // null + decided = uncertain(제외), null + !decided = 미라벨
    decided: boolean("decided").notNull().default(false),
    labeler: text("labeler"),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.split] })],
);
