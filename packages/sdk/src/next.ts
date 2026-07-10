import type { Monitor } from "./core";

// Next.js Route Handler 래퍼. 핸들러를 감싸 시간/상태/에러를 계측한다.
//   export const GET = monitor.wrapNext(async (req) => { ... })

type NextReq = { method?: string; url?: string; nextUrl?: { pathname?: string } };
type NextHandler = (req: NextReq, ...rest: unknown[]) => Promise<Response> | Response;

function routeOf(req: NextReq): string {
  if (req.nextUrl?.pathname) return req.nextUrl.pathname;
  try {
    return new URL(req.url ?? "http://localhost/").pathname;
  } catch {
    return "/";
  }
}

export function wrapNext(monitor: Monitor, handler: NextHandler): NextHandler {
  return async (req: NextReq, ...rest: unknown[]) => {
    const start = Date.now();
    const route = routeOf(req);
    const method = req.method ?? "GET";
    try {
      const res = await handler(req, ...rest);
      monitor.record({ route, method, status: res.status, durationMs: Date.now() - start });
      return res;
    } catch (err) {
      monitor.record({ route, method, status: 500, durationMs: Date.now() - start, error: err });
      throw err; // 앱의 원래 에러 흐름 유지
    }
  };
}
