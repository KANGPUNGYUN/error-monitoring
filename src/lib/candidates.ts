import { sql } from "drizzle-orm";
import { db } from "@/db";

// 규칙 기반 개선 후보 탐지 (SPEC 8). AI 아님 — 순수 heuristic.
// 관측 데이터로 "검토 후보"를 플래그하고 근거 수치를 첨부한다. 최종 판단은 개발자.
// 단정 금지("빨라집니다" X) — "검토 대상입니다" 형태.

// 임계치(문서화·튜닝 가능).
const MIN_TRAFFIC = 20; // 후보 판단 최소 표본
const CACHE_P95_MS = 300; // 캐싱 후보 최소 p95
const CACHE_GET_RATIO = 0.7; // GET 비중
const CACHE_MAX_ERR = 0.1; // 안정적(에러율 낮음)
const SLOW_P95_MS = 800; // 일반 지연 후보
const HIGH_ERR = 0.3; // 에러율 높음
const TIMEOUT_SHARE = 0.2; // 504 비중

export type Candidate = {
  route: string;
  kind: "caching" | "slow" | "high_error" | "timeout";
  title: string;
  reason: string;
  severity: "high" | "med" | "low";
  metrics: { total: number; p95: number; errorRate: number; getRatio: number; timeoutShare: number };
};

type RouteAgg = {
  route: string;
  total: number;
  errors: number;
  timeouts: number;
  gets: number;
  p95: number;
};

export async function detectCandidates(projectId: string): Promise<Candidate[]> {
  const rows = (await db.execute(sql`
    select route,
      count(*)::int as total,
      count(*) filter (where status >= 500 or status = 429)::int as errors,
      count(*) filter (where status = 504)::int as timeouts,
      count(*) filter (where method = 'GET')::int as gets,
      coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::int as p95
    from events where project_id = ${projectId}
    group by route
  `)) as unknown as RouteAgg[];

  const out: Candidate[] = [];

  for (const r of rows) {
    if (r.total < 10) continue;
    const errorRate = r.errors / r.total;
    const getRatio = r.gets / r.total;
    const timeoutShare = r.timeouts / r.total;
    const m = { total: r.total, p95: r.p95, errorRate, getRatio, timeoutShare };

    // 타임아웃 빈발
    if (timeoutShare >= TIMEOUT_SHARE) {
      out.push({
        route: r.route,
        kind: "timeout",
        title: "타임아웃 빈발",
        reason: `504가 ${Math.round(timeoutShare * 100)}% (${r.timeouts}/${r.total}) — 쿼리/커넥션 풀/타임아웃 설정 검토 대상입니다.`,
        severity: "high",
        metrics: m,
      });
    }

    // 에러율 높음
    if (errorRate >= HIGH_ERR && timeoutShare < TIMEOUT_SHARE) {
      out.push({
        route: r.route,
        kind: "high_error",
        title: "에러율 높음",
        reason: `에러율 ${Math.round(errorRate * 100)}% (${r.errors}/${r.total}) — 안정화가 최적화보다 우선 검토 대상입니다.`,
        severity: "high",
        metrics: m,
      });
    }

    // 캐싱 후보: GET 위주 + 느림 + 자주 + 안정적
    const isCaching =
      r.total >= MIN_TRAFFIC &&
      getRatio >= CACHE_GET_RATIO &&
      r.p95 >= CACHE_P95_MS &&
      errorRate < CACHE_MAX_ERR;
    if (isCaching) {
      out.push({
        route: r.route,
        kind: "caching",
        title: "캐싱 검토 대상",
        reason: `p95 ${r.p95}ms, 호출 ${r.total}건, GET ${Math.round(getRatio * 100)}%, 에러율 ${Math.round(errorRate * 100)}% — 자주 불리고 느린 안정적 조회라 캐싱 검토 대상입니다.`,
        severity: r.p95 >= 1000 ? "high" : "med",
        metrics: m,
      });
    }

    // 일반 지연(캐싱 후보로 안 잡힌 느린 라우트)
    if (!isCaching && r.p95 >= SLOW_P95_MS && r.total >= MIN_TRAFFIC && errorRate < HIGH_ERR) {
      out.push({
        route: r.route,
        kind: "slow",
        title: "지연 큼",
        reason: `p95 ${r.p95}ms (호출 ${r.total}건) — 응답 지연 최적화 검토 대상입니다.`,
        severity: r.p95 >= 2000 ? "high" : "med",
        metrics: m,
      });
    }
  }

  const rank = { high: 0, med: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.metrics.p95 - a.metrics.p95);
}
