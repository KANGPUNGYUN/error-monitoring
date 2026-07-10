import { writeFileSync, mkdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/index";
import type { CorpusRow } from "../types";

// 실데이터 export: DB 의 events + gold_labels(사람 라벨, docs/labeling-guide.md)를
// 합성 코퍼스와 동일한 JSONL 포맷으로 내보낸다. 하네스는 그대로 재사용된다.
// 실행: npx tsx research/corpus/export-db.ts
//
// 전제: gold_labels 에 라벨이 적재돼 있어야 한다(라벨링 도구는 이후 슬라이스).

async function main() {
  const rows = await db.execute(sql`
    select e.id as "eventId",
           e.exception_type as "exceptionType",
           e.message_norm as "messageNorm",
           e.top_frames as "topFrames",
           e.route as "route",
           e.status as "status",
           e.release as "release",
           g.split as "split",
           g.group_id as "groupId"
    from gold_labels g
    join events e on e.id = g.event_id
    where g.decided = true
    order by e.id
  `);

  const all = rows as unknown as CorpusRow[];
  const dev = all.filter((r) => r.split === "dev");
  const test = all.filter((r) => r.split === "test");

  if (!all.length) {
    console.log("gold_labels 가 비어 있습니다. 라벨링 후 다시 실행하세요.");
    process.exit(0);
  }

  mkdirSync("datasets", { recursive: true });
  writeFileSync("datasets/corpus.dev.jsonl", dev.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync("datasets/corpus.test.jsonl", test.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const groups = new Set(all.filter((r) => r.groupId != null).map((r) => r.groupId)).size;
  console.log(`Exported real labeled data:`);
  console.log(`  total: ${all.length} | dev/test: ${dev.length}/${test.length} | gold groups: ${groups}`);
  console.log(`  이제 npx tsx research/run.ts 로 실데이터 실험을 돌릴 수 있습니다.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
