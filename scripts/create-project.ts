import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index";
import { hashIngestKey } from "../src/lib/ingest-auth";

// 새 모니터링 프로젝트 등록 스크립트.
// 프로젝트 + 환경 + 인제스트 키를 만들고 키를 한 번 출력한다(해시만 저장되므로 재조회 불가).
//
// 실행 예:
//   DATABASE_URL="<neon-url>" npx tsx scripts/create-project.ts "My API" production
//   DATABASE_URL="<neon-url>" npx tsx scripts/create-project.ts "My API" staging "My Org"
//
// 인자: [프로젝트명] [환경명=production] [조직명=Default Org]
async function main() {
  const projectName = process.argv[2];
  const envName = process.argv[3] ?? "production";
  const orgName = process.argv[4] ?? "Default Org";

  if (!projectName) {
    console.error('사용법: npx tsx scripts/create-project.ts "<프로젝트명>" [환경명] [조직명]');
    process.exit(1);
  }

  // 같은 이름의 조직이 있으면 재사용, 없으면 생성.
  const existingOrg = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.name, orgName))
    .limit(1);
  const org =
    existingOrg[0] ??
    (await db.insert(schema.organizations).values({ name: orgName }).returning())[0];

  const [project] = await db
    .insert(schema.projects)
    .values({ orgId: org.id, name: projectName })
    .returning();

  const [env] = await db
    .insert(schema.environments)
    .values({ projectId: project.id, name: envName })
    .returning();

  const rawKey = `ingest_${randomBytes(24).toString("hex")}`;
  await db.insert(schema.ingestKeys).values({
    projectId: project.id,
    environmentId: env.id,
    keyHash: hashIngestKey(rawKey),
  });

  console.log("생성 완료:");
  console.log("  조직:      ", org.name, `(${org.id})`);
  console.log("  프로젝트:  ", project.name, `(${project.id})`);
  console.log("  환경:      ", env.name, `(${env.id})`);
  console.log("\n  INGEST KEY (한 번만 표시됩니다 — 안전하게 저장하세요):");
  console.log("  " + rawKey);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
