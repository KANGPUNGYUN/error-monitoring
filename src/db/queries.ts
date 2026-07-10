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
};

export async function getProjectOverview(projectId: string): Promise<Overview> {
  const rows = (await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where status >= 500 or status = 429)::int as errors,
      coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::int as p95
    from events where project_id = ${projectId}
  `)) as unknown as { total: number; errors: number; p95: number }[];
  const openIssues = (await db.execute(sql`
    select count(*)::int as c from issues where project_id = ${projectId} and status = 'open'
  `)) as unknown as { c: number }[];
  const r = rows[0] ?? { total: 0, errors: 0, p95: 0 };
  return {
    total: r.total,
    errors: r.errors,
    errorRate: r.total ? r.errors / r.total : 0,
    p95: r.p95,
    openIssues: openIssues[0]?.c ?? 0,
  };
}

export type RouteStat = { route: string; total: number; errors: number; p95: number };

export async function topRoutes(projectId: string, limit = 10): Promise<RouteStat[]> {
  return (await db.execute(sql`
    select route,
      count(*)::int as total,
      count(*) filter (where status >= 500 or status = 429)::int as errors,
      coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::int as p95
    from events where project_id = ${projectId}
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

export async function getLatestSummary(projectId: string, issueId: string) {
  const r = await db
    .select()
    .from(schema.issueSummaries)
    .where(and(eq(schema.issueSummaries.projectId, projectId), eq(schema.issueSummaries.issueId, issueId)))
    .orderBy(desc(schema.issueSummaries.createdAt))
    .limit(1);
  return r[0] ?? null;
}
