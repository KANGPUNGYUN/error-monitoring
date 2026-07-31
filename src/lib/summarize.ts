import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { claudeAvailable, claudeGenerate, CLAUDE_MODEL } from "./llm";

// 증거 연결형 Incident 요약 (SPEC 7). 원인 단정 금지 — 관찰 사실만 연결하고,
// 모든 claim 은 근거 event_id / metric_id 를 인용한다.
// 코어는 결정적(AI 불필요, hallucination 0). ANTHROPIC_API_KEY 가 있으면 Claude 로 자연어로 다듬는다.

export type EvidenceClaim = { claim: string; event_ids: number[]; metric_ids: string[] };

type IssueFacts = {
  title: string;
  route: string;
  status: number | null; // client_error 는 HTTP status 없음
  exceptionType: string | null;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  releases: { release: string; count: number; sampleEventId: number }[];
  topFrame: string | null;
  repEventId: number | null;
  environments: string[];
  sampleEventIds: number[];
};

async function gatherFacts(projectId: string, issueId: string): Promise<IssueFacts | null> {
  const issueRows = (await db.execute(sql`
    select title, event_count as "eventCount", first_seen_at as "firstSeen", last_seen_at as "lastSeen"
    from issues where project_id = ${projectId} and id = ${issueId} limit 1
  `)) as unknown as { title: string; eventCount: number; firstSeen: string; lastSeen: string }[];
  if (!issueRows[0]) return null;

  const rep = (await db.execute(sql`
    select id, route, status, exception_type as "exceptionType", top_frames as "topFrames"
    from events where project_id = ${projectId} and issue_id = ${issueId}
    order by id limit 1
  `)) as unknown as { id: number; route: string; status: number; exceptionType: string | null; topFrames: string[] | null }[];

  const releases = (await db.execute(sql`
    select coalesce(release, '(none)') as release, count(*)::int as count, min(id)::int as "sampleEventId"
    from events where project_id = ${projectId} and issue_id = ${issueId}
    group by release order by count desc
  `)) as unknown as { release: string; count: number; sampleEventId: number }[];

  const envs = (await db.execute(sql`
    select distinct coalesce(en.name, '(unknown)') as name
    from events e left join environments en on en.id = e.environment_id
    where e.project_id = ${projectId} and e.issue_id = ${issueId}
  `)) as unknown as { name: string }[];

  const samples = (await db.execute(sql`
    select id from events where project_id = ${projectId} and issue_id = ${issueId} order by id limit 5
  `)) as unknown as { id: number }[];

  const r = rep[0];
  return {
    title: issueRows[0].title,
    route: r?.route ?? "(unknown)",
    status: r?.status ?? null,
    exceptionType: r?.exceptionType ?? null,
    eventCount: issueRows[0].eventCount,
    firstSeen: new Date(issueRows[0].firstSeen).toISOString(),
    lastSeen: new Date(issueRows[0].lastSeen).toISOString(),
    releases,
    topFrame: r?.topFrames?.[0] ?? null,
    repEventId: r?.id ?? null,
    environments: envs.map((e) => e.name),
    sampleEventIds: samples.map((s) => s.id),
  };
}

/** 이슈 종류 라벨: 예외 타입 우선, 없으면 HTTP status, 둘 다 없으면 "에러". */
function errorLabel(f: IssueFacts): string {
  if (f.exceptionType) return f.exceptionType;
  if (f.status != null) return `HTTP ${f.status}`;
  return "에러";
}

/** 결정적 증거 빌더 — LLM 불필요, 오직 관찰 사실. */
function buildEvidence(f: IssueFacts): { summary: string; evidence: EvidenceClaim[] } {
  const evidence: EvidenceClaim[] = [];

  evidence.push({
    claim: `${f.route} 에서 ${errorLabel(f)} 이(가) ${f.eventCount}건 관측되었습니다 (최초 ${f.firstSeen}, 최근 ${f.lastSeen}).`,
    event_ids: f.sampleEventIds,
    metric_ids: ["issue.event_count", "issue.first_seen", "issue.last_seen"],
  });

  if (f.environments.length) {
    evidence.push({
      claim: `영향 환경: ${f.environments.join(", ")}.`,
      event_ids: f.sampleEventIds.slice(0, 2),
      metric_ids: ["issue.environments"],
    });
  }

  if (f.releases.length) {
    const total = f.releases.reduce((s, r) => s + r.count, 0);
    const top = f.releases[0];
    const pct = total ? Math.round((top.count / total) * 100) : 0;
    evidence.push({
      claim: `릴리스별 발생: ${f.releases.map((r) => `${r.release}=${r.count}`).join(", ")}.`,
      event_ids: f.releases.map((r) => r.sampleEventId),
      metric_ids: ["issue.by_release"],
    });
    if (pct >= 60 && top.release !== "(none)") {
      evidence.push({
        claim: `발생의 ${pct}%가 릴리스 ${top.release} 에서 관측되어 해당 배포와 시점상 연관될 수 있습니다 (원인 단정 아님, 추가 확인 필요).`,
        event_ids: [top.sampleEventId],
        metric_ids: ["issue.by_release"],
      });
    }
  }

  if (f.topFrame && f.repEventId != null) {
    evidence.push({
      claim: `대표 스택 최상단 프레임: ${f.topFrame}.`,
      event_ids: [f.repEventId],
      metric_ids: ["event.top_frame"],
    });
  }

  const summary = `${f.route} 에서 ${errorLabel(f)} ${f.eventCount}건 (최근 ${f.lastSeen}); 릴리스 ${f.releases.map((r) => r.release).join(", ")}.`;
  return { summary, evidence };
}

/** Claude 로 결정적 요약을 자연어 한 문장으로 다듬는다(선택). 사실만 재진술하도록 제약. */
async function narrate(f: IssueFacts, evidence: EvidenceClaim[]): Promise<string | null> {
  if (!claudeAvailable()) return null;
  const facts = JSON.stringify({ route: f.route, type: f.exceptionType, status: f.status, eventCount: f.eventCount, firstSeen: f.firstSeen, lastSeen: f.lastSeen, releases: f.releases, environments: f.environments, topFrame: f.topFrame }, null, 0);
  const prompt = `너는 장애 관측 요약기다. 아래 JSON 사실만 사용해 한국어 한 문장으로 요약하라.
규칙: 원인/해결책을 단정하지 마라. 주어진 수치·이름 외의 정보를 지어내지 마라. 관찰된 사실만 연결하라. 요약 문장만 출력하라.
사실: ${facts}
증거: ${JSON.stringify(evidence.map((e) => e.claim))}
요약(한 문장):`;
  try {
    const text = await claudeGenerate(prompt);
    return text ? text.split("\n")[0].slice(0, 400) : null;
  } catch {
    return null;
  }
}

export type SummaryResult = { model: string; summary: string; evidence: EvidenceClaim[] };

/** 요약 생성 + 저장. ANTHROPIC_API_KEY 있으면 자연어(Claude), 없으면 결정적. */
export async function generateAndStore(projectId: string, issueId: string): Promise<SummaryResult | null> {
  const facts = await gatherFacts(projectId, issueId);
  if (!facts) return null;

  const { summary: deterministic, evidence } = buildEvidence(facts);
  const narrated = await narrate(facts, evidence);
  const model = narrated ? `claude:${CLAUDE_MODEL}` : "deterministic";
  const summary = narrated ?? deterministic;

  await db.insert(schema.issueSummaries).values({
    issueId,
    projectId,
    model,
    summary,
    evidence,
  });

  return { model, summary, evidence };
}
