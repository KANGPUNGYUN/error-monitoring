import { NextRequest, NextResponse } from "next/server";
import { ingestBodySchema } from "@/ingest/event-schema";
import { extractIngestKey, resolveTenant } from "@/lib/ingest-auth";
import { processEvents } from "@/ingest/process";

export const runtime = "nodejs";

// POST /api/v1/events — SDK 이벤트 인제스트 (SPEC 4, 13-1)
export async function POST(req: NextRequest) {
  // 1) 테넌트 해석: project/environment 는 ingest key 에서만 (클라이언트 불신).
  const rawKey = extractIngestKey(req.headers.get("authorization"));
  const tenant = await resolveTenant(rawKey);
  if (!tenant) {
    return NextResponse.json({ error: "invalid ingest key" }, { status: 401 });
  }

  // 2) 파싱 + strict 검증(화이트리스트).
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = ingestBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  // 3) 처리(재-새니타이즈 → 그룹화 → 저장).
  try {
    const result = await processEvents(tenant, parsed.data.events);
    return NextResponse.json({ ok: true, ...result }, { status: 202 });
  } catch (err) {
    console.error("[ingest] processing failed", (err as Error)?.stack ?? err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
