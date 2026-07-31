"use server";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { hashIngestKey } from "@/lib/ingest-auth";

// 프로젝트 생성 Server Action (대시보드 UI). 프로젝트 + 환경 + 인제스트 키를 만들고
// raw 키를 한 번 반환한다(해시만 저장되므로 이후 재조회 불가 — 클라이언트가 즉시 표시).

export type CreateProjectResult =
  | {
      ok: true;
      projectId: string;
      projectName: string;
      environment: string;
      ingestKey: string;
    }
  | { ok: false; error: string };

const ORG_NAME = "Default Org";

export async function createProject(formData: FormData): Promise<CreateProjectResult> {
  const name = String(formData.get("name") ?? "").trim();
  const environment = (String(formData.get("environment") ?? "").trim() || "production").slice(0, 40);

  if (!name) return { ok: false, error: "프로젝트 이름을 입력하세요." };
  if (name.length > 100) return { ok: false, error: "프로젝트 이름이 너무 깁니다(최대 100자)." };

  try {
    // 조직은 없으면 만들고, 있으면 재사용(단일 테넌트 데모 기준).
    const existing = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.name, ORG_NAME))
      .limit(1);
    const org =
      existing[0] ??
      (await db.insert(schema.organizations).values({ name: ORG_NAME }).returning())[0];

    const [project] = await db
      .insert(schema.projects)
      .values({ orgId: org.id, name })
      .returning();

    const [env] = await db
      .insert(schema.environments)
      .values({ projectId: project.id, name: environment })
      .returning();

    const rawKey = `ingest_${randomBytes(24).toString("hex")}`;
    await db.insert(schema.ingestKeys).values({
      projectId: project.id,
      environmentId: env.id,
      keyHash: hashIngestKey(rawKey),
    });

    revalidatePath("/projects");
    return {
      ok: true,
      projectId: project.id,
      projectName: project.name,
      environment: env.name,
      ingestKey: rawKey,
    };
  } catch (err) {
    console.error("[createProject] failed", (err as Error)?.stack ?? err);
    return { ok: false, error: "프로젝트 생성 중 오류가 발생했습니다." };
  }
}
