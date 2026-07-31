import { notFound } from "next/navigation";
import { getProject, getIssue, listIssueEvents, getLatestSummary } from "@/db/queries";
import { Card, Crumbs, StatusBadge, IssueStatusBadge, ago } from "@/ui/components";
import { generateSummaryAction } from "./actions";
import { IssueActions } from "./IssueActions";

type EvidenceClaim = { claim: string; event_ids: number[]; metric_ids: string[] };

export const dynamic = "force-dynamic";

export default async function IssuePage({
  params,
}: {
  params: Promise<{ projectId: string; issueId: string }>;
}) {
  const { projectId, issueId } = await params;
  const [project, issue] = await Promise.all([getProject(projectId), getIssue(projectId, issueId)]);
  if (!project || !issue) notFound();
  const [events, summary] = await Promise.all([
    listIssueEvents(projectId, issueId),
    getLatestSummary(projectId, issueId),
  ]);
  const rep = events[0]; // 대표 이벤트(top frames 표시)
  const claims = (summary?.evidence as EvidenceClaim[] | undefined) ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Crumbs
        items={[
          { href: "/projects", label: "Projects" },
          { href: `/projects/${projectId}`, label: project.name },
          { label: "Issue" },
        ]}
      />

      <div className="flex items-start justify-between gap-3">
        <h1 className="font-mono text-lg font-semibold">{issue.title}</h1>
        <div className="flex items-center gap-2">
          {issue.kind === "client_error" && (
            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              JS
            </span>
          )}
          <IssueStatusBadge status={issue.status} />
        </div>
      </div>
      <div className="mt-2 text-sm text-neutral-500">
        {issue.eventCount} events · first {ago(issue.firstSeenAt)} · last {ago(issue.lastSeenAt)}
        {issue.affectedReleases?.length ? ` · releases ${issue.affectedReleases.join(", ")}` : ""}
      </div>

      {/* 이슈 관리 액션 */}
      <div className="mt-4">
        <IssueActions projectId={projectId} issueId={issueId} status={issue.status} />
      </div>

      {/* 증거 연결형 요약 (SPEC 7) */}
      <Card className="mt-5">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-neutral-500">증거 연결형 요약</div>
          <form action={generateSummaryAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="issueId" value={issueId} />
            <button className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-500 dark:border-neutral-700">
              {summary ? "다시 생성" : "요약 생성"}
            </button>
          </form>
        </div>
        {summary ? (
          <>
            <p className="mt-2 text-sm">{summary.summary}</p>
            <div className="mt-1 text-[11px] text-neutral-400">
              모델: {summary.model} · 원인 단정 아님, 관찰 사실만 연결
            </div>
            {claims.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-neutral-100 pt-3 text-xs dark:border-neutral-800">
                {claims.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-neutral-400">•</span>
                    <span>
                      {c.claim}{" "}
                      <span className="text-neutral-400">
                        [근거 {c.event_ids.map((e) => `#${e}`).join(", ") || c.metric_ids.join(", ")}]
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">
            아직 요약이 없습니다. "요약 생성"을 누르세요. (ANTHROPIC_API_KEY 있으면 자연어, 없으면 결정적 사실 요약)
          </p>
        )}
      </Card>

      {/* 대표 스택 프레임 */}
      {rep?.topFrames?.length ? (
        <Card className="mt-5">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Top frames</div>
          <pre className="mt-2 overflow-x-auto text-xs leading-relaxed">
            {rep.topFrames.map((f) => `  ${f}`).join("\n")}
          </pre>
          {rep.messageNorm && (
            <div className="mt-3 font-mono text-xs text-neutral-600 dark:text-neutral-400">
              {rep.exceptionType}: {rep.messageNorm}
            </div>
          )}
        </Card>
      ) : null}

      {/* 이벤트 타임라인 */}
      <h2 className="mt-8 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        Events ({events.length})
      </h2>
      <Card className="mt-2 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Route</th>
              <th className="px-4 py-2">Method</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Duration</th>
              <th className="px-4 py-2">Release</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/50">
                <td className="px-4 py-2 whitespace-nowrap text-neutral-500">{ago(e.occurredAt)}</td>
                <td className="px-4 py-2 font-mono text-xs">{e.route}</td>
                <td className="px-4 py-2">{e.method ?? "-"}</td>
                <td className="px-4 py-2">
                  {e.status != null ? <StatusBadge status={e.status} /> : (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                      JS error
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">{e.durationMs != null ? `${e.durationMs}ms` : "-"}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{e.release ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
