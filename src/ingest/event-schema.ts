import { z } from "zod";

// strict 화이트리스트 스키마 (SPEC 4.1). 정의된 필드 외 전부 거부.
// project/environment 는 바디로 받지 않는다 — 서버가 ingest key 로 해석한다.

export const errorPayloadSchema = z
  .object({
    type: z.string().max(200).optional(),
    message_norm: z.string().max(2000).optional(),
    top_frames: z.array(z.string().max(500)).max(50).optional(),
  })
  .strict();

// kind: http = API 요청 계측(method/status/duration_ms 필수)
//       client_error = 브라우저 JS 런타임 에러(error 필수, HTTP 필드 없음)
export const eventPayloadSchema = z
  .object({
    occurred_at: z.string().datetime(),
    kind: z.enum(["http", "client_error"]).optional(), // 미지정 시 http (하위 호환)
    route: z.string().min(1).max(1000),
    method: z.string().min(1).max(10).optional(),
    status: z.number().int().min(100).max(599).optional(),
    duration_ms: z.number().int().min(0).max(600_000).optional(),
    release: z.string().max(200).optional(),
    commit_sha: z.string().max(64).optional(),
    error: errorPayloadSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const kind = v.kind ?? "http";
    if (kind === "http") {
      // http 는 기존 계약 유지 — 세 필드 필수.
      if (v.method === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["method"], message: "http 이벤트는 method 필수" });
      if (v.status === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "http 이벤트는 status 필수" });
      if (v.duration_ms === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["duration_ms"], message: "http 이벤트는 duration_ms 필수" });
    } else {
      // client_error 는 에러 정보가 있어야 이슈로 그룹화 가능.
      if (!v.error || (!v.error.type && !v.error.message_norm))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "client_error 는 error.type/message_norm 필요" });
    }
  });

export const ingestBodySchema = z
  .object({
    events: z.array(eventPayloadSchema).min(1).max(500),
  })
  .strict();

export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type IngestBody = z.infer<typeof ingestBodySchema>;
