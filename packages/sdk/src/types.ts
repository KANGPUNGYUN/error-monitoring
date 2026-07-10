// @api-monitor/sdk — 공개 타입

export type MonitorConfig = {
  /** project+environment 를 서버가 해석하는 인제스트 키. */
  ingestKey: string;
  /** 인제스트 엔드포인트. 예: https://ingest.example.com/api/v1/events */
  endpoint: string;
  release?: string;
  commitSha?: string;
  environment?: string;
  /** 0~1. 성공 요청 샘플링 비율(에러는 항상 전송). 기본 1. */
  sampleRate?: number;
  /** 오프라인 버퍼 상한. 기본 1000. */
  maxQueue?: number;
  /** 배치 전송 주기(ms). 기본 2000. */
  flushIntervalMs?: number;
  /** 배치 크기. 기본 50. */
  batchSize?: number;
  debug?: boolean;
};

/** 전송 스키마(strict) — 서버 event-schema 와 동치. */
export type CapturedEvent = {
  occurred_at: string;
  route: string;
  method: string;
  status: number;
  duration_ms: number;
  release?: string;
  commit_sha?: string;
  error?: {
    type?: string;
    message_norm?: string;
    top_frames?: string[];
  };
};
