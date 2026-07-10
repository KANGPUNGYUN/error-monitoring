# SDK 인터페이스 (Node.js / Next.js) — MVP

> 원칙: passive(대상 앱 로직 불변), 실패해도 대상 앱에 영향 없음(예외 삼킴),
> 전송 전 새니타이즈(SPEC 4.1). 인증은 ingest key 하나로 끝(JWT 불필요).

## 1. 초기화

```ts
import { initMonitor } from "@org/api-monitor";

const monitor = initMonitor({
  ingestKey: process.env.MONITOR_INGEST_KEY!,  // project+env는 서버가 이 키로 해석
  endpoint: "https://ingest.example.com/v1/events",
  release: process.env.RELEASE ?? undefined,
  commitSha: process.env.GIT_COMMIT_SHA ?? undefined,
  environment: "production",                    // 서버 검증과 대조용(신뢰는 키 기준)
  sampleRate: 1.0,                              // 0~1, 초당 캡은 서버에서도 강제
  maxQueue: 1000,                               // 오프라인 버퍼 상한
});
```

## 2. Express 미들웨어

```ts
import express from "express";
const app = express();

app.use(monitor.expressMiddleware());          // 요청/응답/에러 자동 계측
// ... routes ...
app.use(monitor.expressErrorHandler());        // 에러 스택 캡처(next(err) 경로)
```

## 3. Next.js Route Handler 래퍼

```ts
// app/api/orders/route.ts
import { withMonitor } from "@org/api-monitor/next";

export const POST = withMonitor(async (req) => {
  // ... 핸들러 ...
  return Response.json({ ok: true });
});
```

## 4. 이벤트 페이로드 (전송 스키마 — strict)

SDK가 서버로 보내는 단위. **허용 필드만.** raw body/header 없음.

```jsonc
{
  "occurred_at": "2026-07-09T14:03:11.221Z",
  "route": "/users/:id",          // 정규화 필수(원시 path 금지 — 카디널리티 폭발)
  "method": "GET",
  "status": 500,
  "duration_ms": 1840,
  "release": "abc123",
  "commit_sha": "abc123def",
  "error": {
    "type": "TypeError",          // exception 클래스명
    "message_norm": "Cannot read properties of <VAL>",  // 값 마스킹된 템플릿
    "top_frames": [               // framework/vendor 프레임 제거 후 top N
      "at OrderService.create (order.service.ts:42)",
      "at handler (route.ts:11)"
    ]
  }
}
```

- `error`는 에러 발생 시에만 포함. 성공 요청은 메트릭만.
- environment/project는 **바디로 보내지 않는다**(서버가 ingest key로 해석).

## 5. 새니타이즈 계약 (SDK 측, 전송 전)

- 값 마스킹: token/Bearer/API key 패턴, email, 전화, UUID, SQL 리터럴, 파일 경로.
- message는 변수 치환 템플릿화(`id=123` → `id=<VAL>`, UUID → `<UUID>`).
- top_frames는 app 코드만(node_modules/framework 프레임 필터).
- 화이트리스트 방식: 정의된 필드 외 어떤 것도 실어 보내지 않는다.
- 서버(인제스트)도 동일 새니타이즈 재적용(defense in depth).

## 6. route 정규화

- 파라미터를 플레이스홀더로: `/users/123` → `/users/:id`, `/orders/abc-uuid` → `/orders/:id`.
- 프레임워크 라우팅 메타가 있으면 그걸 사용(Express `req.route.path`, Next segment).
- 없으면 SDK가 숫자/UUID/해시 세그먼트를 규칙으로 치환.

## 7. 전송 안정성

- 비동기 배치 전송(요청 경로를 블로킹하지 않음).
- 실패: 지수 백오프 재시도 → 실패 지속 시 `maxQueue`까지 버퍼, 초과분 drop + drop 카운트.
- **SDK 내부 예외는 절대 밖으로 던지지 않는다**(대상 앱 보호).
- 서버는 프로젝트별 rate limit + payload 크기 제한 + 초당 이벤트 캡을 강제.

## 8. 계측 오버헤드 목표

- 요청당 추가 지연 < 1ms(전송은 오프-패스).
- 메모리: 버퍼 상한으로 유계.
- 이 수치는 벤치로 검증(대상 앱 미변경, SDK on/off 비교).
