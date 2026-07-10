# SDK 통합 기획안 — 각 프로젝트에 모니터링 붙이기 (Claude Code 런북)

> 대상 프로젝트의 개발자(또는 그 프로젝트에서 실행하는 Claude Code)가 그대로 따라
> 할 수 있는 절차서. **비즈니스 로직은 건드리지 않는다.** 설치 + 초기화 3~5줄이 전부.

## 0. 핵심 개념 (오해 방지)

- **SDK는 프로젝트마다 만들지 않는다.** 재사용 패키지 `@api-monitor/sdk` **하나**를 각
  프로젝트가 **설치**하고 몇 줄로 초기화할 뿐이다.
- SDK는 **passive** — 요청/응답/에러를 관찰만 하고 앱 동작을 바꾸지 않는다. 전송은
  오프-패스(비동기 배치)라 요청 지연에 영향 없고, SDK 내부 예외는 절대 앱으로 안 던진다.
- 인증은 **인제스트 키 1개**. project+environment 는 서버가 키로 해석한다(클라이언트가
  project_id 를 못 위조함). JWT/유저 인증 불필요.

## 1. 사전 준비 (프로젝트당 1회)

1. 모니터링 플랫폼에서 이 프로젝트의 **인제스트 키**를 발급받는다
   (Organization → Project → Environment 단위. dev/staging/prod 각각 별도 키 권장).
2. 인제스트 엔드포인트 URL 을 확인한다. 예: `https://<플랫폼>/api/v1/events`
   (로컬 개발이면 `http://localhost:3000/api/v1/events`).
3. 아래 환경변수를 프로젝트에 추가한다(값은 커밋하지 말 것 — `.env`/시크릿 매니저):

```bash
MONITOR_INGEST_KEY="ingest_xxx"          # 발급받은 키
MONITOR_ENDPOINT="https://.../api/v1/events"
RELEASE="1.4.2"                          # 선택: 배포 버전(에러↔릴리스 연결에 유용)
GIT_COMMIT_SHA="abc123"                  # 선택
```

## 2. 설치

```bash
npm install @api-monitor/sdk
# (아직 npm 미배포 상태라면 워크스페이스/로컬 링크로 설치. 배포 후에는 위 한 줄.)
```

지원 런타임(MVP): **Node.js (Express) / Next.js (App Router)**. 다른 언어/프레임워크는
6장 참고.

## 3. 프레임워크별 연결 (택1)

### 3a. Express

```ts
import express from "express";
import { initMonitor } from "@api-monitor/sdk";

const monitor = initMonitor({
  ingestKey: process.env.MONITOR_INGEST_KEY!,
  endpoint: process.env.MONITOR_ENDPOINT!,
  environment: "production",
  release: process.env.RELEASE,
  commitSha: process.env.GIT_COMMIT_SHA,
});

const app = express();
app.use(monitor.expressMiddleware());   // ① 라우트 정의 "전"
// ... 기존 라우트 그대로 ...
app.use(monitor.expressErrorHandler()); // ② 라우트 "후"(에러 스택 캡처)
// ... 기존 최종 에러 핸들러 있으면 그 앞에 두면 됨 ...
```

### 3b. NestJS (Express 기반)

`main.ts` 에서 underlying Express 인스턴스에 미들웨어를 건다:

```ts
import { initMonitor } from "@api-monitor/sdk";
const monitor = initMonitor({ /* 위와 동일 */ });

const app = await NestFactory.create(AppModule);
const http = app.getHttpAdapter().getInstance(); // express instance
http.use(monitor.expressMiddleware());
// 에러 캡처는 Nest ExceptionFilter 로도 가능(고급). 최소 구성은 미들웨어만.
await app.listen(3000);
```

### 3c. Next.js (App Router — Route Handlers)

각 API route 핸들러를 `wrapNext` 로 감싼다:

```ts
// app/api/orders/route.ts
import { initMonitor } from "@api-monitor/sdk";
const monitor = initMonitor({ /* 위와 동일 */ }); // 모듈 최상단 1회

export const GET = monitor.wrapNext(async (req) => {
  // ... 기존 핸들러 ...
  return Response.json({ ok: true });
});
```

공통 초기화를 한 곳(`lib/monitor.ts`)에 두고 각 route 에서 import 하면 깔끔하다.

## 4. 검증

1. 앱을 띄우고 몇 개 요청(성공 + 일부러 500 유발)을 보낸다.
2. 2초(배치 flush) 뒤 플랫폼 대시보드/DB 에 이벤트·이슈가 뜨는지 확인.
3. `debug: true` 로 초기화하면 SDK 가 `[monitor] sent N events` 를 콘솔에 찍는다.

## 5. 보안 (이 SDK가 지키는 것)

- 전송 전 **새니타이즈**: 토큰/이메일/전화/UUID/SQL 리터럴 마스킹, 스택 프레임은
  **basename만 보존**(절대경로·username 유출 방지), 메시지는 값 치환 템플릿화.
- **raw request body / header 는 수집하지 않는다.**
- route 는 정규화되어 전송(`/users/123` → `/users/:id`) — PII·카디널리티 방지.
- 인제스트 키만 있으면 되고, 유저 인증/JWT 는 SDK 로 흐르지 않는다.

## 6. Node 가 아닌 스택 (Spring Boot / Django / FastAPI 등)

현재 SDK는 **Node/Next 전용**이다. 다른 언어는 두 경로:

- **언어별 SDK**(후속 로드맵) — 동일한 이벤트 스키마(`docs/sdk-interface.md`)로 POST
  하면 되므로, 얇은 클라이언트만 있으면 된다.
- **직접 POST** — 프레임워크 미들웨어에서 요청 종료 시 `POST /api/v1/events` 로 아래
  스키마를 보내면 즉시 동작한다(언어 무관):

```json
{ "events": [{
  "occurred_at": "2026-07-10T14:03:11Z", "route": "/api/orders/:id",
  "method": "GET", "status": 500, "duration_ms": 1840,
  "release": "1.4.2", "commit_sha": "abc123",
  "error": { "type": "TypeError", "message_norm": "...", "top_frames": ["..."] }
}]}
```
헤더: `Authorization: Bearer <ingest-key>`. **보내기 전에 반드시 새니타이즈**(값 마스킹).

## 7. 롤백

`initMonitor` 호출과 `app.use(...)` 두 줄만 제거하면 원상복구. 앱 로직은 바뀐 게 없다.

---

## 8. Claude Code 런북 (각 프로젝트에서 붙여넣기)

대상 프로젝트 디렉터리에서 Claude Code 를 열고 아래를 그대로 붙여넣으면, 프레임워크를
감지해 위 연결을 대신 해준다. `<...>` 부분만 채운다.

### 8a. 범용 프롬프트 (프레임워크 자동 감지)

```
이 프로젝트에 API 모니터링 SDK(@api-monitor/sdk)를 붙여줘. 요구사항:

1. 이 저장소의 웹 프레임워크를 감지해(Express / NestJS / Next.js App Router 등)
   그에 맞는 방식으로 연결해. 비즈니스 로직/기존 라우트는 절대 수정하지 마.
2. @api-monitor/sdk 를 설치(package.json 에 추가).
3. 초기화 코드는 lib/monitor(.ts|.js) 한 곳에 두고, 엔트리(예: server.ts / main.ts /
   app/api/*)에서 재사용해.
   - Express/Nest: app.use(monitor.expressMiddleware()) 를 라우트 정의 전,
     app.use(monitor.expressErrorHandler()) 를 라우트 후(기존 에러 핸들러 앞)에 추가.
   - Next App Router: 각 route handler 를 monitor.wrapNext(...) 로 감싸(또는 공통
     헬퍼로).
4. 설정은 환경변수로만: MONITOR_INGEST_KEY, MONITOR_ENDPOINT, RELEASE(선택),
   GIT_COMMIT_SHA(선택). 키/URL 을 코드에 하드코딩하지 마. .env.example 에 항목 추가.
5. 끝나면: 어떤 파일을 바꿨는지 요약하고, 로컬에서 앱을 띄워 요청 몇 개(성공 + 의도적
   500)를 보내 SDK 가 이벤트를 전송하는지(debug:true 로그) 검증해줘.

제약: passive 원칙 준수(요청 지연·앱 동작 변경 없음). SDK 초기화 실패가 앱을 죽이면 안 됨.
```

### 8b. 프레임워크를 이미 아는 경우

위 프롬프트 첫 줄을 다음으로 교체:
- Express: `이 Express 앱에 @api-monitor/sdk 를 3a 방식(미들웨어 2줄)으로 붙여줘.`
- NestJS: `이 NestJS 앱의 main.ts 에서 underlying Express 에 미들웨어를 붙여줘.`
- Next: `이 Next.js App Router 프로젝트의 모든 route handler 를 monitor.wrapNext 로 감싸줘.`

### 8c. 검증 프롬프트 (붙인 뒤)

```
방금 붙인 모니터링이 실제로 동작하는지 확인해줘. 앱을 로컬로 띄우고,
성공 요청과 일부러 에러를 내는 요청을 보낸 뒤, SDK debug 로그에 [monitor] sent 가
찍히는지 / 플랫폼 인제스트가 202 를 주는지 확인하고 결과를 요약해줘.
실패하면 원인(엔드포인트/키/네트워크)을 진단해줘.
```

---

## 부록: 왜 이 방식인가 (한 줄 근거)

- **키 하나 + 몇 줄** → 온보딩 마찰 최소화(경쟁 도구 대비 wedge).
- **passive + 새니타이즈** → 남의 앱 데이터를 안전하게 다룸(멀티테넌트 신뢰).
- **동일 스키마** → 언어가 달라도 같은 플랫폼에서 통합 모니터링(SPEC 목표 ①).
