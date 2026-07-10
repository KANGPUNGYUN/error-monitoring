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

export const eventPayloadSchema = z
  .object({
    occurred_at: z.string().datetime(),
    route: z.string().min(1).max(1000),
    method: z.string().min(1).max(10),
    status: z.number().int().min(100).max(599),
    duration_ms: z.number().int().min(0).max(600_000),
    release: z.string().max(200).optional(),
    commit_sha: z.string().max(64).optional(),
    error: errorPayloadSchema.optional(),
  })
  .strict();

export const ingestBodySchema = z
  .object({
    events: z.array(eventPayloadSchema).min(1).max(500),
  })
  .strict();

export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type IngestBody = z.infer<typeof ingestBodySchema>;
