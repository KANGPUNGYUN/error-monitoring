import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./index";

// 라벨링 데이터 접근 (docs/labeling-guide.md). 모두 project 스코프.
// gold_labels: decided=false → 미라벨, decided=true & group_id null → uncertain(제외),
//              decided=true & group_id != null → 라벨 완료.

/** 층화 샘플로 라벨링 셋을 만든다. (route,status) 버킷별 최대 perBucket 건, dev/test 교대. */
export async function buildSample(projectId: string, perBucket = 8): Promise<number> {
  const res = await db.execute(sql`
    with sampled as (
      select id,
             row_number() over (partition by route, status order by id) as rn,
             row_number() over (order by id) as g
      from events where project_id = ${projectId}
    )
    insert into gold_labels (event_id, split, decided, group_id)
    select id,
           case when g % 2 = 0 then 'dev' else 'test' end,
           false, null
    from sampled where rn <= ${perBucket}
    on conflict (event_id, split) do nothing
    returning event_id
  `);
  return (res as unknown as unknown[]).length;
}

export type LabelProgress = { total: number; decided: number; groups: number; uncertain: number };

export async function getProgress(projectId: string): Promise<LabelProgress> {
  const rows = (await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where gl.decided)::int as decided,
      count(*) filter (where gl.decided and gl.group_id is null)::int as uncertain,
      count(distinct gl.group_id)::int as groups
    from gold_labels gl
    join events e on e.id = gl.event_id
    where e.project_id = ${projectId}
  `)) as unknown as LabelProgress[];
  return rows[0] ?? { total: 0, decided: 0, groups: 0, uncertain: 0 };
}

export type LabelEvent = {
  eventId: number;
  split: string;
  route: string;
  status: number;
  exceptionType: string | null;
  messageNorm: string | null;
  topFrames: string[] | null;
  release: string | null;
};

/** 아직 판정하지 않은 다음 이벤트 1건. */
export async function nextUnlabeled(projectId: string): Promise<LabelEvent | null> {
  const rows = (await db.execute(sql`
    select gl.event_id as "eventId", gl.split as "split",
           e.route, e.status, e.exception_type as "exceptionType",
           e.message_norm as "messageNorm", e.top_frames as "topFrames", e.release
    from gold_labels gl
    join events e on e.id = gl.event_id
    where e.project_id = ${projectId} and gl.decided = false
    order by gl.event_id
    limit 1
  `)) as unknown as LabelEvent[];
  return rows[0] ?? null;
}

export type GroupSummary = {
  groupId: number;
  n: number;
  route: string;
  exceptionType: string | null;
  messageNorm: string | null;
};

/** 이 프로젝트에서 이미 만들어진 라벨 그룹들(대표 샘플 포함). */
export async function listGroups(projectId: string): Promise<GroupSummary[]> {
  return (await db.execute(sql`
    select gl.group_id as "groupId", count(*)::int as n,
           (array_agg(e.route order by e.id))[1] as route,
           (array_agg(e.exception_type order by e.id))[1] as "exceptionType",
           (array_agg(e.message_norm order by e.id))[1] as "messageNorm"
    from gold_labels gl
    join events e on e.id = gl.event_id
    where e.project_id = ${projectId} and gl.group_id is not null
    group by gl.group_id
    order by gl.group_id
  `)) as unknown as GroupSummary[];
}

async function nextGroupId(projectId: string): Promise<number> {
  const rows = (await db.execute(sql`
    select coalesce(max(gl.group_id), 0) + 1 as "next"
    from gold_labels gl join events e on e.id = gl.event_id
    where e.project_id = ${projectId}
  `)) as unknown as { next: number }[];
  return rows[0]?.next ?? 1;
}

/** 이벤트에 라벨 부여. group="new" → 새 그룹, "uncertain" → 제외, 숫자문자열 → 기존 그룹. */
export async function assignLabel(
  projectId: string,
  eventId: number,
  split: string,
  group: string,
  labeler = "human",
): Promise<void> {
  let groupId: number | null;
  if (group === "uncertain") groupId = null;
  else if (group === "new") groupId = await nextGroupId(projectId);
  else groupId = Number(group);

  await db
    .update(schema.goldLabels)
    .set({ groupId, decided: true, labeler })
    .where(and(eq(schema.goldLabels.eventId, eventId), eq(schema.goldLabels.split, split)));
}

export async function resetLabeling(projectId: string): Promise<void> {
  await db.execute(sql`
    delete from gold_labels gl using events e
    where gl.event_id = e.id and e.project_id = ${projectId}
  `);
}
