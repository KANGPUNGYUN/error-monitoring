import { randomBytes } from "node:crypto";
import { db, schema } from "../src/db/index";
import { hashIngestKey } from "../src/lib/ingest-auth";

// 개발용 시드: org/project/env + ingest key 1개 생성.
// 실행: pnpm db:seed  (docker Postgres 가 떠 있고 db:push 완료 상태여야 함)
async function main() {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Demo Org" })
    .returning();

  const [project] = await db
    .insert(schema.projects)
    .values({ orgId: org.id, name: "Demo API" })
    .returning();

  const [env] = await db
    .insert(schema.environments)
    .values({ projectId: project.id, name: "production" })
    .returning();

  const rawKey = `ingest_${randomBytes(24).toString("hex")}`;
  await db.insert(schema.ingestKeys).values({
    projectId: project.id,
    environmentId: env.id,
    keyHash: hashIngestKey(rawKey),
  });

  console.log("Seeded:");
  console.log("  org:        ", org.id);
  console.log("  project:    ", project.id);
  console.log("  environment:", env.id, "(production)");
  console.log("\n  INGEST KEY (한 번만 표시, 저장하세요):");
  console.log("  " + rawKey);
  console.log("\n테스트:");
  console.log(`  curl -X POST http://localhost:3000/api/v1/events \\
    -H "Authorization: Bearer ${rawKey}" \\
    -H "Content-Type: application/json" \\
    -d '{"events":[{"occurred_at":"2026-07-09T14:03:11.000Z","route":"/users/123","method":"GET","status":500,"duration_ms":1840,"release":"abc123","error":{"type":"TypeError","message_norm":"Cannot read properties of undefined","top_frames":["at OrderService.create (order.service.ts:42)"]}}]}'`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
