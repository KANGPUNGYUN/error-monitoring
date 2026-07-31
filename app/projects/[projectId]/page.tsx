import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectOverview, topRoutes, listIssues } from "@/db/queries";
import { detectCandidates } from "@/lib/candidates";
import { Card, Stat, Crumbs, IssueStatusBadge, ago } from "@/ui/components";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [ov, routes, issues, candidates] = await Promise.all([
    getProjectOverview(projectId),
    topRoutes(projectId),
    listIssues(projectId),
    detectCandidates(projectId),
  ]);

  const sevTone: Record<string, string> = {
    high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    med: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    low: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Crumbs items={[{ href: "/projects", label: "Projects" }, { label: project.name }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <div className="flex gap-2">
          <Link
            href={`/projects/${projectId}/alerts`}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-500 dark:border-neutral-700"
          >
            알림 →
          </Link>
          <Link
            href={`/projects/${projectId}/labeling`}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-500 dark:border-neutral-700"
          >
            라벨링 →
          </Link>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Requests" value={ov.total.toLocaleString()} />
        <Stat label="Errors" value={ov.errors.toLocaleString()} tone={ov.errors > 0 ? "warn" : "ok"} />
        <Stat label="Error rate" value={`${(ov.errorRate * 100).toFixed(1)}%`} tone={ov.errorRate > 0.1 ? "bad" : "ok"} />
        <Stat label="p95 latency" value={`${ov.p95} ms`} tone={ov.p95 > 1000 ? "warn" : "ok"} />
        <Stat label="JS errors" value={ov.clientErrors.toLocaleString()} tone={ov.clientErrors > 0 ? "warn" : "ok"} />
      </div>

      {/* Top routes */}
      <h2 className="mt-8 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Routes</h2>
      <Card className="mt-2 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="px-4 py-2">Route</th>
              <th className="px-4 py-2 text-right">Requests</th>
              <th className="px-4 py-2 text-right">Errors</th>
              <th className="px-4 py-2 text-right">Err %</th>
              <th className="px-4 py-2 text-right">p95</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.route} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/50">
                <td className="px-4 py-2 font-mono text-xs">{r.route}</td>
                <td className="px-4 py-2 text-right">{r.total}</td>
                <td className="px-4 py-2 text-right">{r.errors}</td>
                <td className={`px-4 py-2 text-right ${r.total && r.errors / r.total > 0.1 ? "text-red-600 dark:text-red-400" : ""}`}>
                  {r.total ? ((r.errors / r.total) * 100).toFixed(0) : 0}%
                </td>
                <td className="px-4 py-2 text-right">{r.p95}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* 개선 후보 (규칙 기반 heuristic — SPEC 8) */}
      <h2 className="mt-8 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        개선 후보 ({candidates.length})
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        관측 데이터 기반 <b>검토 후보</b>일 뿐입니다(규칙 기반, AI 아님). 최종 판단은 개발자.
      </p>
      <div className="mt-2 space-y-2">
        {candidates.map((c, i) => (
          <Card key={i}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${sevTone[c.severity]}`}>
                    {c.title}
                  </span>
                  <span className="font-mono text-xs text-neutral-500">{c.route}</span>
                </div>
                <div className="mt-1.5 text-sm text-neutral-700 dark:text-neutral-300">{c.reason}</div>
              </div>
            </div>
          </Card>
        ))}
        {candidates.length === 0 && (
          <Card className="text-sm text-neutral-500">현재 플래그된 개선 후보가 없습니다.</Card>
        )}
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        참고: pagination·인덱스 추천은 응답 크기·DB span 신호가 필요해 현재 미수집(후속 로드맵).
      </p>

      {/* Issues */}
      <h2 className="mt-8 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        Issues ({issues.length})
      </h2>
      <div className="mt-2 space-y-2">
        {issues.map((i) => (
          <Link key={i.id} href={`/projects/${projectId}/issues/${i.id}`}>
            <Card
              className={`transition hover:border-neutral-400 dark:hover:border-neutral-600 ${
                i.status !== "open" ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {i.kind === "client_error" && (
                      <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                        JS
                      </span>
                    )}
                    <div className="truncate font-mono text-sm">{i.title}</div>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {i.eventCount} events · last {ago(i.lastSeenAt)}
                    {i.affectedReleases?.length ? ` · releases ${i.affectedReleases.join(", ")}` : ""}
                  </div>
                </div>
                <IssueStatusBadge status={i.status} />
              </div>
            </Card>
          </Link>
        ))}
        {issues.length === 0 && (
          <Card className="text-sm text-neutral-500">아직 이슈가 없습니다. 데모 앱 트래픽을 흘려보세요.</Card>
        )}
      </div>
    </main>
  );
}
