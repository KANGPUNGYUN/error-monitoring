import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ResolvedTenant } from "@/lib/ingest-auth";
import { normalizeRoute } from "@/lib/route-normalize";
import { normalizeMessage, extractAppFrames } from "@/lib/sanitize";
import { ruleFingerprint, issueTitle, type GroupingInput } from "@/lib/fingerprint";
import type { EventPayload } from "./event-schema";

// 런타임 기본 그룹화 엔진 (SPEC 6.7 채택 결과). 실험 전까지는 strong 규칙.
const RUNTIME_BASELINE = "strong" as const;

type NormalizedEvent = {
  occurredAt: Date;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  release: string | null;
  commitSha: string | null;
  exceptionType: string | null;
  messageNorm: string | null;
  topFrames: string[] | null;
  grouping: GroupingInput;
};

/** 수신 payload 를 서버 측에서 재-새니타이즈 + 정규화 (defense in depth). */
function normalizeEvent(p: EventPayload): NormalizedEvent {
  const route = normalizeRoute(p.route);
  const exceptionType = p.error?.type ?? null;
  const messageNorm = p.error?.message_norm
    ? normalizeMessage(p.error.message_norm)
    : null;
  const topFrames = p.error?.top_frames ? extractAppFrames(p.error.top_frames) : null;

  return {
    occurredAt: new Date(p.occurred_at),
    route,
    method: p.method.toUpperCase(),
    status: p.status,
    durationMs: p.duration_ms,
    release: p.release ?? null,
    commitSha: p.commit_sha ?? null,
    exceptionType,
    messageNorm,
    topFrames,
    grouping: {
      exceptionType,
      messageNorm,
      topFrames,
      route,
      status: p.status,
      release: p.release ?? null,
    },
  };
}

const isError = (status: number) => status >= 500 || status === 429;

/** 에러 이벤트를 이슈로 그룹화(upsert)하고 issue_id 를 돌려준다. */
async function upsertIssue(
  projectId: string,
  ev: NormalizedEvent,
): Promise<string | null> {
  // 에러가 아닌 성공 요청은 이슈를 만들지 않는다(메트릭만).
  if (!isError(ev.status) && !ev.exceptionType) return null;

  const fingerprint = ruleFingerprint(ev.grouping, RUNTIME_BASELINE);
  const title = issueTitle(ev.grouping);

  const rows = await db
    .insert(schema.issues)
    .values({
      projectId,
      fingerprint,
      title,
      firstSeenAt: ev.occurredAt,
      lastSeenAt: ev.occurredAt,
      eventCount: 1,
      affectedReleases: ev.release ? [ev.release] : [],
    })
    .onConflictDoUpdate({
      target: [schema.issues.projectId, schema.issues.fingerprint],
      set: {
        lastSeenAt: sql`greatest(${schema.issues.lastSeenAt}, ${ev.occurredAt.toISOString()}::timestamptz)`,
        firstSeenAt: sql`least(${schema.issues.firstSeenAt}, ${ev.occurredAt.toISOString()}::timestamptz)`,
        eventCount: sql`${schema.issues.eventCount} + 1`,
        affectedReleases: ev.release
          ? sql`(select array(select distinct unnest(${schema.issues.affectedReleases} || array[${ev.release}::text])))`
          : schema.issues.affectedReleases,
      },
    })
    .returning({ id: schema.issues.id });

  return rows[0]?.id ?? null;
}

export type IngestResult = { accepted: number; issues: number };

/**
 * 검증된 payload 배열을 처리:
 * 재-새니타이즈 → 그룹화(규칙) → 이슈 upsert → 이벤트 insert.
 * projectId/environmentId 는 tenant 에서만 온다(클라이언트 불신).
 */
export async function processEvents(
  tenant: ResolvedTenant,
  payloads: EventPayload[],
): Promise<IngestResult> {
  const issueIds = new Set<string>();
  const rows: (typeof schema.events.$inferInsert)[] = [];

  for (const p of payloads) {
    const ev = normalizeEvent(p);
    const issueId = await upsertIssue(tenant.projectId, ev);
    if (issueId) issueIds.add(issueId);

    rows.push({
      projectId: tenant.projectId,
      environmentId: tenant.environmentId,
      occurredAt: ev.occurredAt,
      route: ev.route,
      method: ev.method,
      status: ev.status,
      durationMs: ev.durationMs,
      release: ev.release,
      commitSha: ev.commitSha,
      exceptionType: ev.exceptionType,
      messageNorm: ev.messageNorm,
      topFrames: ev.topFrames,
      issueId,
    });
  }

  if (rows.length) await db.insert(schema.events).values(rows);

  return { accepted: rows.length, issues: issueIds.size };
}
