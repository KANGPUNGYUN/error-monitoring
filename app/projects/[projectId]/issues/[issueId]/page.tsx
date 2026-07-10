import { notFound } from "next/navigation";
import { getProject, getIssue, listIssueEvents } from "@/db/queries";
import { Card, Crumbs, StatusBadge, IssueStatusBadge, ago } from "@/ui/components";

export const dynamic = "force-dynamic";

export default async function IssuePage({
  params,
}: {
  params: Promise<{ projectId: string; issueId: string }>;
}) {
  const { projectId, issueId } = await params;
  const [project, issue] = await Promise.all([getProject(projectId), getIssue(projectId, issueId)]);
  if (!project || !issue) notFound();
  const events = await listIssueEvents(projectId, issueId);
  const rep = events[0]; // 대표 이벤트(top frames 표시)

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
        <IssueStatusBadge status={issue.status} />
      </div>
      <div className="mt-2 text-sm text-neutral-500">
        {issue.eventCount} events · first {ago(issue.firstSeenAt)} · last {ago(issue.lastSeenAt)}
        {issue.affectedReleases?.length ? ` · releases ${issue.affectedReleases.join(", ")}` : ""}
      </div>

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
                <td className="px-4 py-2">{e.method}</td>
                <td className="px-4 py-2"><StatusBadge status={e.status} /></td>
                <td className="px-4 py-2 text-right">{e.durationMs}ms</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{e.release ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
