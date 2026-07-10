import { notFound } from "next/navigation";
import { getProject, listAlertRules, listEnvironments } from "@/db/queries";
import { Card, Crumbs, ago } from "@/ui/components";
import { createAlertRuleAction, deleteAlertRuleAction, testAlertAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();
  const [rules, envs] = await Promise.all([listAlertRules(projectId), listEnvironments(projectId)]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Crumbs
        items={[
          { href: "/projects", label: "Projects" },
          { href: `/projects/${projectId}`, label: project.name },
          { label: "Alerts" },
        ]}
      />
      <h1 className="text-xl font-semibold">Slack 알림 규칙</h1>
      <p className="mt-1 text-sm text-neutral-500">
        임계치 초과 시 Slack 으로 증거 요약 + 대시보드 링크를 보냅니다. 쿨다운 = 윈도우 시간.
      </p>

      {/* 규칙 생성 */}
      <Card className="mt-5">
        <form action={createAlertRuleAction} className="space-y-3">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="text-xs text-neutral-500">
              환경
              <select name="environmentId" className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700">
                <option value="">전체</option>
                {envs.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-neutral-500">
              지표
              <select name="metric" className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700">
                <option value="error_rate">error_rate (0~1)</option>
                <option value="latency_p95">latency_p95 (ms)</option>
              </select>
            </label>
            <label className="text-xs text-neutral-500">
              임계치
              <input name="threshold" defaultValue="0.5" className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700" />
            </label>
            <label className="text-xs text-neutral-500">
              윈도우(분)
              <input name="windowMin" type="number" defaultValue={5} className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700" />
            </label>
          </div>
          <label className="block text-xs text-neutral-500">
            Slack Webhook URL
            <input name="slackWebhook" placeholder="https://hooks.slack.com/services/..." className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-neutral-700" />
          </label>
          <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900">
            규칙 추가
          </button>
        </form>
      </Card>

      {/* 규칙 목록 */}
      <div className="mt-6 space-y-2">
        {rules.map((r) => (
          <Card key={r.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <span className="font-medium">{r.metric}</span> ≥ {r.threshold}
                <span className="text-neutral-500"> · {r.windowMin}분 윈도우</span>
                <div className="mt-0.5 truncate font-mono text-xs text-neutral-400">
                  {r.slackWebhook.replace(/^(https?:\/\/[^/]+).*/, "$1/…")}
                  {r.lastFiredAt ? ` · 마지막 발송 ${ago(r.lastFiredAt)}` : " · 미발송"}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <form action={testAlertAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="id" value={r.id} />
                  <button className="rounded border border-neutral-300 px-2 py-1 text-xs hover:border-neutral-500 dark:border-neutral-700">
                    테스트
                  </button>
                </form>
                <form action={deleteAlertRuleAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="id" value={r.id} />
                  <button className="rounded border border-neutral-300 px-2 py-1 text-xs text-red-600 hover:border-red-400 dark:border-neutral-700">
                    삭제
                  </button>
                </form>
              </div>
            </div>
          </Card>
        ))}
        {rules.length === 0 && (
          <Card className="text-sm text-neutral-500">등록된 알림 규칙이 없습니다.</Card>
        )}
      </div>
    </main>
  );
}
