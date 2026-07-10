import express from "express";
import { initMonitor } from "@api-monitor/sdk";

// ── SDK 초기화 (비즈니스 로직 불변, 이 블록 + app.use 두 줄이 전부) ──
const monitor = initMonitor({
  ingestKey: process.env.MONITOR_INGEST_KEY ?? "",
  endpoint: process.env.MONITOR_ENDPOINT ?? "http://localhost:3000/api/v1/events",
  environment: "production",
  release: process.env.RELEASE ?? "demo-1.0.0",
  commitSha: process.env.GIT_COMMIT_SHA ?? "deadbee",
  debug: true,
});

const app = express();
app.use(express.json());
app.use(monitor.expressMiddleware()); // ← 라우트 전

// ── 의도적으로 다양한 버그를 내는 데모 라우트 (연구용 실 에러 코퍼스 생성) ──

// varied-wording NullReference (같은 근본이슈, 문구 다양) — route 별 gold 그룹
app.get("/api/orders/:id", (_req, _res) => {
  const o: any = undefined;
  return o.total; // throws TypeError
});
app.get("/api/checkout", (_req, _res) => {
  const cart: any = null;
  return cart.items.length; // throws TypeError (다른 표현)
});

// generic-message: 같은 route, 서로 다른 내부 함수(=다른 근본이슈)
function gatewayA() {
  throw new Error("Internal Server Error");
}
function gatewayB() {
  throw new Error("Request failed");
}
app.get("/api/gateway", (req, _res) => {
  if ((Number(req.query.n) || 0) % 2 === 0) gatewayA();
  else gatewayB();
});

// DB 타임아웃 시뮬레이션 (504)
app.get("/api/report", (_req, res) => {
  res.status(504).json({ error: "Query timed out after 3200ms on connection 918" });
});

// 검증 실패 (422)
app.post("/api/signup", (req, res) => {
  const email = req.body?.email;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(422).json({ error: "field 'email' invalid" });
    return;
  }
  res.json({ ok: true });
});

// 성공 (200) — 샘플링 대상
app.get("/api/ok", (_req, res) => res.json({ ok: true }));

// 느린 성공 GET — 자주 불리고 느린 안정적 조회(캐싱 후보 대상)
app.get("/api/dashboard", (_req, res) => {
  setTimeout(() => res.json({ widgets: 12 }), 650 + Math.floor(Math.random() * 200));
});

app.use(monitor.expressErrorHandler()); // ← 라우트 후 (에러 스택 캡처)

// 최종 에러 핸들러(앱 고유) — 500 응답
app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "internal" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`demo-api on http://localhost:${port}`));
