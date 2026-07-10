import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Slack 실시간 알림 (SPEC 9). 임계치(에러율/지연) 초과 시 증거 요약 + 대시보드 링크 전송.
// 인제스트 후 after() 로 평가되어 응답 경로를 블로킹하지 않는다. 절대 throw 하지 않는다.

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

type SlackBlock = Record<string, unknown>;

/** Slack Incoming Webhook 전송. 실패해도 throw 하지 않음. */
export async function sendSlack(
  webhook: string,
  text: string,
  blocks?: SlackBlock[],
): Promise<boolean> {
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blocks ? { text, blocks } : { text }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type Rule = typeof schema.alertRules.$inferSelect;

type WindowStat = { total: number; errors: number; p95: number; topRoute: string | null; topRouteErrors: number };

async function windowStats(rule: Rule): Promise<WindowStat> {
  const envFilter = rule.environmentId
    ? sql`and environment_id = ${rule.environmentId}`
    : sql``;
  const rows = (await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where status >= 500 or status = 429)::int as errors,
      coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::int as p95
    from events
    where project_id = ${rule.projectId}
      and occurred_at >= now() - (${rule.windowMin} || ' minutes')::interval
      ${envFilter}
  `)) as unknown as { total: number; errors: number; p95: number }[];
  const top = (await db.execute(sql`
    select route, count(*) filter (where status >= 500 or status = 429)::int as errors
    from events
    where project_id = ${rule.projectId}
      and occurred_at >= now() - (${rule.windowMin} || ' minutes')::interval
      ${envFilter}
    group by route order by errors desc limit 1
  `)) as unknown as { route: string; errors: number }[];
  const s = rows[0] ?? { total: 0, errors: 0, p95: 0 };
  return { ...s, topRoute: top[0]?.route ?? null, topRouteErrors: top[0]?.errors ?? 0 };
}

async function projectEnvNames(rule: Rule): Promise<{ project: string; env: string }> {
  const p = (await db.execute(sql`
    select p.name as project, coalesce(en.name, 'all') as env
    from projects p
    left join environments en on en.id = ${rule.environmentId ?? null}
    where p.id = ${rule.projectId} limit 1
  `)) as unknown as { project: string; env: string }[];
  return p[0] ?? { project: "?", env: "all" };
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/** 한 룰을 평가하고 초과 시 발송. 발송했으면 true. */
export async function evaluateRule(rule: Rule): Promise<boolean> {
  if (!rule.enabled) return false;
  // 쿨다운: 마지막 발송 후 window_min 분 이내면 skip
  if (rule.lastFiredAt) {
    const elapsedMin = (Date.now() - new Date(rule.lastFiredAt).getTime()) / 60000;
    if (elapsedMin < rule.windowMin) return false;
  }

  const s = await windowStats(rule);
  if (s.total === 0) return false;

  const threshold = Number(rule.threshold);
  let exceeded = false;
  let valueText = "";
  let headline = "";

  if (rule.metric === "error_rate") {
    const rate = s.errors / s.total;
    exceeded = rate >= threshold;
    valueText = `${pct(rate)} (임계 ${pct(threshold)})`;
    headline = `error_rate ${pct(rate)} > ${pct(threshold)}`;
  } else if (rule.metric === "latency_p95") {
    exceeded = s.p95 >= threshold;
    valueText = `${s.p95}ms (임계 ${threshold}ms)`;
    headline = `p95 ${s.p95}ms > ${threshold}ms`;
  }

  if (!exceeded) return false;

  const { project, env } = await projectEnvNames(rule);
  const link = `${APP_URL}/projects/${rule.projectId}`;
  const text = `🚨 [${project}/${env}] ${headline} (최근 ${rule.windowMin}분)`;
  const evidence =
    `최근 ${rule.windowMin}분 · 총 ${s.total}건 중 에러 ${s.errors}건` +
    (s.topRoute ? ` · 최다 \`${s.topRoute}\`(${s.topRouteErrors}건)` : "");

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `🚨 ${rule.metric} 임계 초과` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Project:*\n${project}` },
        { type: "mrkdwn", text: `*Environment:*\n${env}` },
        { type: "mrkdwn", text: `*Metric:*\n${rule.metric}` },
        { type: "mrkdwn", text: `*Value:*\n${valueText}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: evidence } },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "대시보드 열기" }, url: link },
      ],
    },
  ];

  const ok = await sendSlack(rule.slackWebhook, text, blocks);
  if (ok) {
    await db
      .update(schema.alertRules)
      .set({ lastFiredAt: new Date() })
      .where(eq(schema.alertRules.id, rule.id));
  }
  return ok;
}

/** 프로젝트의 모든 활성 룰 평가(인제스트 후 호출). */
export async function evaluateAlerts(projectId: string): Promise<void> {
  try {
    const rules = await db
      .select()
      .from(schema.alertRules)
      .where(and(eq(schema.alertRules.projectId, projectId), eq(schema.alertRules.enabled, true)));
    for (const rule of rules) await evaluateRule(rule);
  } catch (err) {
    console.error("[alerts] evaluation failed", err);
  }
}

/** 테스트 발송(룰 설정 검증용) — 임계치 무관하게 샘플 메시지. */
export async function sendTestAlert(rule: Rule): Promise<boolean> {
  const { project, env } = await projectEnvNames(rule);
  return sendSlack(
    rule.slackWebhook,
    `✅ [${project}/${env}] 테스트 알림 — ${rule.metric} 룰이 정상 연결되었습니다.`,
    [
      { type: "section", text: { type: "mrkdwn", text: `✅ *테스트 알림*\n${project} / ${env} · ${rule.metric} 임계 ${rule.threshold}` } },
    ],
  );
}
