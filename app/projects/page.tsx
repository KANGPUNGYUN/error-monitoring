import Link from "next/link";
import { listProjects, getProjectOverview } from "@/db/queries";
import { Card } from "@/ui/components";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjects();
  const withStats = await Promise.all(
    projects.map(async (p) => ({ ...p, ov: await getProjectOverview(p.id) })),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-xl font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-neutral-500">모니터링 중인 프로젝트</p>

      {withStats.length === 0 && (
        <Card className="mt-6 text-sm text-neutral-500">
          프로젝트가 없습니다. <code>npm run db:seed</code> 로 데모 프로젝트를 만드세요.
        </Card>
      )}

      <div className="mt-6 space-y-3">
        {withStats.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`}>
            <Card className="transition hover:border-neutral-400 dark:hover:border-neutral-600">
              <div className="flex items-center justify-between">
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-neutral-500">
                  {p.ov.total.toLocaleString()} events ·{" "}
                  <span className={p.ov.errorRate > 0.1 ? "text-red-600 dark:text-red-400" : ""}>
                    {(p.ov.errorRate * 100).toFixed(1)}% errors
                  </span>{" "}
                  · {p.ov.openIssues} open issues
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
