import type { MonitorConfig, CapturedEvent } from "./types";
import { Transport } from "./transport";
import { normalizeMessage, extractAppFrames, parseStack } from "./sanitize";
import { normalizeRoute } from "./route-normalize";
import { expressMiddleware, expressErrorHandler } from "./express";
import { wrapNext } from "./next";

// SDK 코어. 이벤트를 만들어 새니타이즈 + 샘플링 후 큐에 넣는다. 어떤 경우에도 대상 앱에
// 예외를 던지지 않는다(모든 공개 메서드는 try/catch 로 감싼다).

export type RequestSample = {
  route: string; // 정규화되지 않았어도 됨 — 여기서 정규화
  method: string;
  status: number;
  durationMs: number;
  error?: unknown; // Error 또는 임의 throw 값
};

export class Monitor {
  private transport: Transport;
  private readonly sampleRate: number;
  readonly config: Required<Pick<MonitorConfig, "environment">> & MonitorConfig;

  constructor(config: MonitorConfig) {
    this.config = { environment: "production", ...config };
    this.sampleRate = config.sampleRate ?? 1;
    this.transport = new Transport(
      config.endpoint,
      config.ingestKey,
      {
        maxQueue: config.maxQueue ?? 1000,
        flushIntervalMs: config.flushIntervalMs ?? 2000,
        batchSize: config.batchSize ?? 50,
      },
      config.debug ?? false,
    );
    this.transport.start();
  }

  /** 요청 1건 기록. 성공은 샘플링, 에러는 항상 전송. */
  record(sample: RequestSample): void {
    try {
      const isError = sample.status >= 500 || sample.status === 429 || sample.error != null;
      if (!isError && Math.random() > this.sampleRate) return;

      const ev: CapturedEvent = {
        occurred_at: new Date().toISOString(),
        route: normalizeRoute(sample.route),
        method: sample.method.toUpperCase(),
        status: sample.status,
        duration_ms: Math.max(0, Math.round(sample.durationMs)),
        release: this.config.release,
        commit_sha: this.config.commitSha,
      };

      if (sample.error != null) ev.error = this.buildError(sample.error);
      this.transport.enqueue(ev);
    } catch {
      // SDK 예외는 절대 밖으로 던지지 않는다.
    }
  }

  private buildError(error: unknown): CapturedEvent["error"] {
    if (error instanceof Error) {
      return {
        type: error.name,
        message_norm: normalizeMessage(error.message),
        top_frames: extractAppFrames(parseStack(error.stack)),
      };
    }
    return { type: "Error", message_norm: normalizeMessage(String(error)) };
  }

  /** Express 계측 미들웨어(라우트 전 등록). */
  expressMiddleware() {
    return expressMiddleware(this);
  }

  /** Express 에러 핸들러(라우트 후 등록 — 에러 스택 캡처). */
  expressErrorHandler() {
    return expressErrorHandler(this);
  }

  /** Next.js Route Handler 래퍼. */
  wrapNext<T extends (...args: never[]) => Promise<Response> | Response>(handler: T): T {
    return wrapNext(this, handler as never) as unknown as T;
  }

  async flush(): Promise<void> {
    try {
      await this.transport.flush();
    } catch {
      /* noop */
    }
  }

  stats() {
    return this.transport.stats();
  }
}

let singleton: Monitor | null = null;

/** SDK 초기화. 반환된 Monitor 를 미들웨어/래퍼에 넘긴다. */
export function initMonitor(config: MonitorConfig): Monitor {
  singleton = new Monitor(config);
  return singleton;
}

/** 초기화된 전역 Monitor 접근(미들웨어 내부용). */
export function getMonitor(): Monitor | null {
  return singleton;
}
