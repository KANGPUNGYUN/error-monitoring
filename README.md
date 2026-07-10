# API Monitor Platform

AI 기반 API 모니터링 & 에러 그룹화 연구 플랫폼. 상세 설계는 [`SPEC.md`](./SPEC.md).

연구 코어: **규칙 기반 vs AI 기반 에러 그룹화**를 라벨링된 정답셋으로 비교·검증·채택
(compare → verify → adopt). 자세한 내용은 SPEC 6장 + [`docs/`](./docs/).

## 구현 진행 (SPEC 13장)

- [x] **1. 데이터 모델 + 인제스트 API + 새니타이즈 + 테넌트 격리**
- [x] **2. Node/Next SDK** ([`packages/sdk`](./packages/sdk)) + 데모 앱([`examples/demo-api`](./examples/demo-api)) + 통합 기획안([`docs/sdk-integration-guide.md`](./docs/sdk-integration-guide.md))
- [x] **3. Issue 대시보드** (`/projects` → 프로젝트 overview(KPI·routes·issues) → 이슈 상세(프레임·이벤트 타임라인)). 테넌트 스코프 강제(`src/db/queries.ts`).
- [x] **4. 실험 하네스 + 지표 + 라벨링 UI (연구 루프 완성)** ([`research/`](./research/))
  - [x] 규칙 3종 + 임베딩 엔진(로컬 transformers), B³/pairwise/impurity/fragmentation/ARI 지표, dev/test 프로토콜, 채택 게이트
  - [x] 사람 라벨링 UI(`/projects/[id]/labeling`) → `gold_labels` → `export-db.ts` → 실데이터 실험 (end-to-end 검증됨)
  - [ ] 실제 사람 라벨링 수행(현재 데모는 합성 코퍼스 + 자동라벨 스모크로 배관만 검증)
- [ ] 5. AI 그룹화 엔진(OpenAI) → 규칙 vs AI vs 하이브리드 비교 → 채택
- [x] **6. 증거 연결형 요약** — 이슈 상세에 결정적 fact-only 요약(근거 event_id 인용, 원인 단정 금지). Ollama 있으면 자연어로 narration(`src/lib/summarize.ts`, `src/lib/llm.ts`). Slack 알림은 후속.
- [x] **7. 규칙 기반 개선 후보 추천** — 관측 데이터로 캐싱/지연/에러율/타임아웃 후보 플래그(근거 수치 첨부, "검토 대상" 단정 금지). `src/lib/candidates.ts`, 프로젝트 overview에 표시.

- [x] **8. Slack 실시간 알림** — 인제스트 후 `after()`로 임계치(error_rate/latency_p95) 평가 → 초과 시 Slack webhook(증거 요약 + 대시보드 링크), 쿨다운=윈도우. 규칙 관리 UI(`/projects/[id]/alerts`). `src/lib/alerts.ts`.

연구 ⑤(AI 실비교)는 라벨만 있으면 배선 완료 상태(`research/run.ts --openai` 또는 로컬 transformers).

연구 하네스 실행: `npm run research:gen && npm run research:eval` → `reports/grouping-eval.md`. 자세히는 [`research/README.md`](./research/README.md).

## 로컬 실행

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Docker Postgres + Redis
pnpm db:push        # 스키마 반영 (docs/schema.sql 과 동치)
pnpm db:seed        # 데모 org/project/env + ingest key 출력
pnpm dev            # http://localhost:3000
```

시드가 출력한 ingest key 로 `POST /api/v1/events` 를 호출하면 이벤트가 수집되고
규칙 엔진이 이슈로 그룹화한다(시드 출력의 curl 예시 참고).

## 스택

Next.js(App Router) · TypeScript · Tailwind · Drizzle ORM · PostgreSQL · Redis · Zod.
Neon 등으로 옮기려면 `DATABASE_URL` 만 교체.

## 문서

- [`SPEC.md`](./SPEC.md) — 전체 설계 + 연구 코어
- [`docs/labeling-guide.md`](./docs/labeling-guide.md) — 정답셋 라벨링 규약
- [`docs/schema.sql`](./docs/schema.sql) — Postgres DDL(참조용)
- [`docs/sdk-interface.md`](./docs/sdk-interface.md) — SDK 인터페이스·페이로드 계약
