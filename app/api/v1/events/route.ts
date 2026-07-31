import { NextRequest, NextResponse, after } from "next/server";
import { ingestBodySchema } from "@/ingest/event-schema";
import { extractIngestKey, resolveTenant } from "@/lib/ingest-auth";
import { processEvents } from "@/ingest/process";
import { evaluateAlerts } from "@/lib/alerts";

export const runtime = "nodejs";

// CORS: 브라우저 SDK(각 고객 사이트 오리진)에서 직접 인제스트하므로 허용한다.
// 인제스트 키는 클라이언트에 노출되는 공개 성격이라 오리진 와일드카드(*)가 적절하다.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

// 브라우저는 preflight(OPTIONS)뿐 아니라 실제 응답에도 CORS 헤더를 요구한다.
function withCors<T extends NextResponse>(res: T): T {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.headers.set(key, value);
  }
  return res;
}

// OPTIONS /api/v1/events — CORS preflight
export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

// POST /api/v1/events — SDK 이벤트 인제스트 (SPEC 4, 13-1)
export async function POST(req: NextRequest) {
  // 1) 테넌트 해석: project/environment 는 ingest key 에서만 (클라이언트 불신).
  const rawKey = extractIngestKey(req.headers.get("authorization"));
  const tenant = await resolveTenant(rawKey);
  if (!tenant) {
    return withCors(
      NextResponse.json({ error: "invalid ingest key" }, { status: 401 }),
    );
  }

  // 2) 파싱 + strict 검증(화이트리스트).
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return withCors(
      NextResponse.json({ error: "invalid json" }, { status: 400 }),
    );
  }

  const parsed = ingestBodySchema.safeParse(json);
  if (!parsed.success) {
    return withCors(
      NextResponse.json(
        { error: "invalid payload", details: parsed.error.flatten() },
        { status: 422 },
      ),
    );
  }

  // 3) 처리(재-새니타이즈 → 그룹화 → 저장).
  try {
    const result = await processEvents(tenant, parsed.data.events);
    // 알림 평가는 응답 후 실행(인제스트 경로를 블로킹하지 않음).
    after(() => evaluateAlerts(tenant.projectId));
    return withCors(NextResponse.json({ ok: true, ...result }, { status: 202 }));
  } catch (err) {
    console.error("[ingest] processing failed", (err as Error)?.stack ?? err);
    return withCors(
      NextResponse.json({ error: "processing failed" }, { status: 500 }),
    );
  }
}
