import { and, eq, desc, sql } from "drizzle-orm";
import { db, schema } from "./index";

// 스코프 강제 데이터 접근 레이어 (SPEC 3.1). 모든 읽기는 project_id 로 필터한다.
// 대시보드/라벨링은 이 함수들만 통해 DB 에 접근한다(raw 쿼리 직접 호출 금지).

export async function listProjects() {
  return db
    .select({ id: schema.projects.id, name: schema.projects.name, orgId: schema.projects.orgId })
    .from(schema.projects)
    .orderBy(schema.projects.name);
}

export async function getProject(projectId: string) {
  const r = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return r[0] ?? null;
}

export type Overview = {
  total: number;
  errors: number;
  errorRate: number;
  p95: number;
  openIssues: number;
  clientErrors: number; // JS 런타임 에러 이벤트 수
};

export async function getProjectOverview(projectId: string): Promise<Overview> {
  const rows = (await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where status >= 500 or status = 429)::int as errors,
      coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::int as p95
    from events where project_id = ${projectId} and kind = 'http'
  `)) as unknown as { total: number; errors: number; p95: number }[];
  const openIssues = (await db.execute(sql`
    select count(*)::int as c from issues where project_id = ${projectId} and status = 'open'
  `)) as unknown as { c: number }[];
  const clientErrors = (await db.execute(sql`
    select count(*)::int as c from events where project_id = ${projectId} and kind = 'client_error'
  `)) as unknown as { c: number }[];
  const r = rows[0] ?? { total: 0, errors: 0, p95: 0 };
  return {
    total: r.total,
    errors: r.errors,
    errorRate: r.total ? r.errors / r.total : 0,
    p95: r.p95,
    openIssues: openIssues[0]?.c ?? 0,
    clientErrors: clientErrors[0]?.c ?? 0,
  };
}

export type RouteStat = { route: string; total: number; errors: number; p95: number };

export async function topRoutes(projectId: string, limit = 10): Promise<RouteStat[]> {
  return (await db.execute(sql`
    select route,
      count(*)::int as total,
      count(*) filter (where status >= 500 or status = 429)::int as errors,
      coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::int as p95
    from events where project_id = ${projectId} and kind = 'http'
    group by route
    order by errors desc, total desc
    limit ${limit}
  `)) as unknown as RouteStat[];
}

export async function listIssues(projectId: string, limit = 100) {
  return db
    .select()
    .from(schema.issues)
    .where(eq(schema.issues.projectId, projectId))
    .orderBy(desc(schema.issues.lastSeenAt))
    .limit(limit);
}

export async function getIssue(projectId: string, issueId: string) {
  const r = await db
    .select()
    .from(schema.issues)
    .where(and(eq(schema.issues.projectId, projectId), eq(schema.issues.id, issueId)))
    .limit(1);
  return r[0] ?? null;
}

export async function listIssueEvents(projectId: string, issueId: string, limit = 50) {
  return db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.issueId, issueId)))
    .orderBy(desc(schema.events.occurredAt))
    .limit(limit);
}

export async function listAlertRules(projectId: string) {
  return db
    .select()
    .from(schema.alertRules)
    .where(eq(schema.alertRules.projectId, projectId))
    .orderBy(desc(schema.alertRules.createdAt));
}

export async function listEnvironments(projectId: string) {
  return db
    .select({ id: schema.environments.id, name: schema.environments.name })
    .from(schema.environments)
    .where(eq(schema.environments.projectId, projectId))
    .orderBy(schema.environments.name);
}

export type IssueStatus = "open" | "resolved" | "ignored";

/** 이슈 상태 변경(해결/무시/다시 열기). project_id 스코프 강제. 변경된 행 수 반환. */
export async function updateIssueStatus(
  projectId: string,
  issueId: string,
  status: IssueStatus,
): Promise<boolean> {
  const r = await db
    .update(schema.issues)
    .set({ status })
    .where(and(eq(schema.issues.projectId, projectId), eq(schema.issues.id, issueId)))
    .returning({ id: schema.issues.id });
  return r.length > 0;
}

/** 이슈 삭제. 소속 이벤트의 issue_id 를 먼저 끊고(이벤트는 보존), 이슈+요약 삭제(cascade). */
export async function deleteIssue(projectId: string, issueId: string): Promise<boolean> {
  // 이벤트는 원 telemetry 라 지우지 않고 issue_id 만 해제한다.
  await db
    .update(schema.events)
    .set({ issueId: null })
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.issueId, issueId)));
  const r = await db
    .delete(schema.issues)
    .where(and(eq(schema.issues.projectId, projectId), eq(schema.issues.id, issueId)))
    .returning({ id: schema.issues.id }); // issue_summaries 는 FK cascade 로 함께 삭제
  return r.length > 0;
}

export async function getLatestSummary(projectId: string, issueId: string) {
  const r = await db
    .select()
    .from(schema.issueSummaries)
    .where(and(eq(schema.issueSummaries.projectId, projectId), eq(schema.issueSummaries.issueId, issueId)))
    .orderBy(desc(schema.issueSummaries.createdAt))
    .limit(1);
  return r[0] ?? null;
}
