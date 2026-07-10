import type { CapturedEvent, MonitorConfig } from "./types";

// 배치 전송 큐. 요청 경로를 블로킹하지 않고(오프-패스), 실패해도 절대 throw 하지 않는다.
// 실패 시 재큐(백오프) + maxQueue 초과분 drop(카운트만 유지).

type Required_ = Required<Pick<MonitorConfig, "maxQueue" | "flushIntervalMs" | "batchSize">>;

export class Transport {
  private queue: CapturedEvent[] = [];
  private dropped = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending = false;
  private backoff = 0;

  constructor(
    private readonly endpoint: string,
    private readonly ingestKey: string,
    private readonly opts: Required_,
    private readonly debug: boolean,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
    // 프로세스가 타이머 때문에 살아있지 않게.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(ev: CapturedEvent) {
    if (this.queue.length >= this.opts.maxQueue) {
      this.dropped++;
      return;
    }
    this.queue.push(ev);
    if (this.queue.length >= this.opts.batchSize) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    if (this.backoff > Date.now()) return;
    this.sending = true;
    const batch = this.queue.splice(0, this.opts.batchSize);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.ingestKey}`,
        },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) throw new Error(`ingest ${res.status}`);
      this.backoff = 0;
      if (this.debug) console.log(`[monitor] sent ${batch.length} events`);
    } catch (err) {
      // 재큐(앞쪽에) + 지수 백오프. 절대 throw 하지 않음.
      for (let i = batch.length - 1; i >= 0; i--) {
        if (this.queue.length < this.opts.maxQueue) this.queue.unshift(batch[i]);
        else this.dropped++;
      }
      const step = this.backoff === 0 ? 1000 : Math.min((this.backoff - Date.now()) * 2 || 1000, 30000);
      this.backoff = Date.now() + step;
      if (this.debug) console.warn(`[monitor] flush failed (${(err as Error).message}); retry after ${step}ms`);
    } finally {
      this.sending = false;
    }
  }

  stats() {
    return { queued: this.queue.length, dropped: this.dropped };
  }
}
