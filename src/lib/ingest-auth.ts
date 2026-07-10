import { createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

// 테넌트 격리의 핵심 (SPEC 3.1): project_id/environment_id 는 클라이언트가 아니라
// ingest key 에서 서버가 해석한다.

export function hashIngestKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export type ResolvedTenant = {
  projectId: string;
  environmentId: string;
};

/** Authorization 헤더에서 ingest key 추출. `Bearer <key>` 또는 원문 키. */
export function extractIngestKey(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  const m = trimmed.match(/^Bearer\s+(.+)$/i);
  return (m ? m[1] : trimmed).trim() || null;
}

/** 키를 검증하고 테넌트를 해석. 유효하지 않거나 폐기된 키면 null. */
export async function resolveTenant(rawKey: string | null): Promise<ResolvedTenant | null> {
  if (!rawKey) return null;
  const keyHash = hashIngestKey(rawKey);
  const rows = await db
    .select({
      projectId: schema.ingestKeys.projectId,
      environmentId: schema.ingestKeys.environmentId,
    })
    .from(schema.ingestKeys)
    .where(and(eq(schema.ingestKeys.keyHash, keyHash), isNull(schema.ingestKeys.revokedAt)))
    .limit(1);

  return rows[0] ?? null;
}
