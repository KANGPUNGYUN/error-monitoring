import type { Monitor } from "./core";

// Express 계측. 비즈니스 로직 불변 — app.use 두 줄만 추가한다.
//   app.use(monitor.expressMiddleware())   // 라우트 전
//   ... routes ...
//   app.use(monitor.expressErrorHandler()) // 라우트 후(에러 스택 캡처)

type Req = {
  method: string;
  originalUrl?: string;
  url?: string;
  baseUrl?: string;
  path?: string;
  route?: { path?: string };
};
type Res = {
  statusCode: number;
  locals?: Record<string, unknown>;
  on: (event: string, cb: () => void) => void;
};
type Next = (err?: unknown) => void;

function resolveRoute(req: Req): string {
  // 프레임워크 라우트 패턴 우선(카디널리티 안전): baseUrl + route.path
  if (req.route?.path) return `${req.baseUrl ?? ""}${req.route.path}` || req.route.path;
  return req.originalUrl ?? req.url ?? req.path ?? "/";
}

export function expressMiddleware(monitor: Monitor) {
  return (req: Req, res: Res, next: Next) => {
    const start = Date.now();
    if (!res.locals) res.locals = {};
    res.locals.__monError = undefined;
    res.on("finish", () => {
      monitor.record({
        route: resolveRoute(req),
        method: req.method,
        status: res.statusCode,
        durationMs: Date.now() - start,
        error: res.locals?.__monError,
      });
    });
    next();
  };
}

export function expressErrorHandler(_monitor: Monitor) {
  return (err: unknown, _req: Req, res: Res, next: Next) => {
    if (res.locals) res.locals.__monError = err;
    next(err);
  };
}
