import type { Monitor } from "./core";

// 브라우저 JS 런타임 에러 자동 캡처. window.onerror(동기 throw) +
// unhandledrejection(await 안 한 Promise reject) 두 소스를 구독한다.
// SSR/Node 환경에서는 window 가 없어 no-op. 어떤 경우에도 앱에 예외를 던지지 않는다.

type ErrorEventLike = {
  error?: unknown;
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
};
type RejectionLike = { reason?: unknown };
type WindowLike = {
  addEventListener?: (t: string, cb: (e: unknown) => void) => void;
  removeEventListener?: (t: string, cb: (e: unknown) => void) => void;
};

/** Monitor 에 브라우저 에러 핸들러를 붙인다. 반환값은 해제 함수. */
export function captureBrowserErrors(monitor: Monitor): () => void {
  const win = (globalThis as { window?: WindowLike }).window;
  if (!win?.addEventListener) return () => {};

  const onError = (e: unknown) => {
    try {
      const ev = e as ErrorEventLike;
      // error 객체가 있으면 스택까지, 없으면(예: cross-origin) 메시지만.
      if (ev?.error != null) {
        monitor.recordError(ev.error);
      } else if (ev?.message) {
        const where = ev.filename ? ` (${ev.filename}:${ev.lineno ?? 0}:${ev.colno ?? 0})` : "";
        monitor.recordError(new Error(ev.message + where));
      }
    } catch {
      /* noop */
    }
  };

  const onRejection = (e: unknown) => {
    try {
      const reason = (e as RejectionLike)?.reason;
      if (reason != null) monitor.recordError(reason);
    } catch {
      /* noop */
    }
  };

  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);

  return () => {
    try {
      win.removeEventListener?.("error", onError);
      win.removeEventListener?.("unhandledrejection", onRejection);
    } catch {
      /* noop */
    }
  };
}
