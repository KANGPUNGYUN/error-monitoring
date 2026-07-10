import { notFound } from "next/navigation";
import { getProject } from "@/db/queries";
import { getProgress, nextUnlabeled, listGroups } from "@/db/labeling";
import { Card, Crumbs, StatusBadge } from "@/ui/components";
import { buildSampleAction, assignLabelAction, resetLabelingAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LabelingPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [progress, current, groups] = await Promise.all([
    getProgress(projectId),
    nextUnlabeled(projectId),
    listGroups(projectId),
  ]);

  const pct = progress.total ? Math.round((progress.decided / progress.total) * 100) : 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Crumbs
        items={[
          { href: "/projects", label: "Projects" },
          { href: `/projects/${projectId}`, label: project.name },
          { label: "Labeling" },
        ]}
      />
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">에러 그룹화 라벨링</h1>
        <a className="text-xs text-neutral-500 hover:underline" href="https://github.com" >
          가이드: docs/labeling-guide.md
        </a>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        "제공된 텔레메트리만으로 판단했을 때 <b>같은 actionable issue</b>인가"로 묶으세요.
        확신 없으면 <b>Uncertain</b>(제외).
      </p>

      {/* 진행률 */}
      {progress.total > 0 && (
        <Card className="mt-5">
          <div className="flex items-center justify-between text-sm">
            <span>
              {progress.decided} / {progress.total} 판정 · 그룹 {progress.groups}개 · uncertain{" "}
              {progress.uncertain}
            </span>
            <span className="text-neutral-500">{pct}%</span>
          </div>
          <div className="mt-2 h-2 w-full rounded bg-neutral-200 dark:bg-neutral-800">
            <div className="h-2 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </Card>
      )}

      {/* 샘플 없음 → 생성 */}
      {progress.total === 0 && (
        <Card className="mt-6">
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            라벨링 셋이 없습니다. 수집된 이벤트에서 층화 샘플을 만듭니다.
          </div>
          <form action={buildSampleAction} className="mt-3 flex items-center gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="text-sm text-neutral-500">
              버킷당{" "}
              <input
                name="perBucket"
                type="number"
                defaultValue={8}
                className="w-16 rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700"
              />{" "}
              건
            </label>
            <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900">
              라벨링 셋 생성
            </button>
          </form>
        </Card>
      )}

      {/* 라벨링 대상 이벤트 */}
      {current && (
        <>
          <Card className="mt-6">
            <div className="flex items-center justify-between">
              <div className="font-mono text-sm">
                {current.exceptionType ?? `HTTP ${current.status}`} <StatusBadge status={current.status} />
              </div>
              <div className="text-xs text-neutral-500">
                event #{current.eventId} · {current.split}
              </div>
            </div>
            <div className="mt-2 font-mono text-xs text-neutral-500">{current.route}</div>
            {current.messageNorm && (
              <div className="mt-2 font-mono text-sm">{current.messageNorm}</div>
            )}
            {current.topFrames?.length ? (
              <pre className="mt-3 overflow-x-auto rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-950">
                {current.topFrames.map((f) => `  ${f}`).join("\n")}
              </pre>
            ) : null}
          </Card>

          {/* 그룹 배정 */}
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">이 이벤트를 배정</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {groups.map((g) => (
                <form key={g.groupId} action={assignLabelAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="eventId" value={current.eventId} />
                  <input type="hidden" name="split" value={current.split} />
                  <input type="hidden" name="group" value={String(g.groupId)} />
                  <button
                    className="rounded border border-neutral-300 px-2.5 py-1 text-left text-xs hover:border-neutral-500 dark:border-neutral-700"
                    title={`${g.exceptionType ?? ""} ${g.messageNorm ?? ""}`}
                  >
                    <span className="font-medium">#{g.groupId}</span> ({g.n}) ·{" "}
                    <span className="font-mono">{g.route}</span>
                  </button>
                </form>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <form action={assignLabelAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="eventId" value={current.eventId} />
                <input type="hidden" name="split" value={current.split} />
                <input type="hidden" name="group" value="new" />
                <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">
                  + 새 그룹
                </button>
              </form>
              <form action={assignLabelAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="eventId" value={current.eventId} />
                <input type="hidden" name="split" value={current.split} />
                <input type="hidden" name="group" value="uncertain" />
                <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                  Uncertain (제외)
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      {/* 완료 */}
      {progress.total > 0 && !current && (
        <Card className="mt-6">
          <div className="text-sm">
            ✅ 라벨링 완료 — {progress.groups}개 그룹, uncertain {progress.uncertain}건.
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            이제 <code>npx tsx research/corpus/export-db.ts</code> → <code>npm run research:eval</code>
            로 <b>실데이터 실험</b>을 돌리세요.
          </div>
        </Card>
      )}

      {/* 리셋 */}
      {progress.total > 0 && (
        <form action={resetLabelingAction} className="mt-8">
          <input type="hidden" name="projectId" value={projectId} />
          <button className="text-xs text-neutral-400 hover:text-red-500 hover:underline">
            라벨링 초기화
          </button>
        </form>
      )}
    </main>
  );
}
