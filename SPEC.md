# AI 기반 API 모니터링 & 에러 그룹화 연구 플랫폼

## 0. 한 줄 정의

여러 프로젝트의 API를 **passive SDK**로 관찰하여 에러/성능을 통합 모니터링하고,
**"규칙 기반 vs AI 기반 에러 그룹화"를 실제 수집 데이터로 비교·검증·채택**하는
연구를 중심에 둔 플랫폼. AI는 원인을 단정하지 않고 관찰된 사실만 연결한다.

## 1. 설계 원칙 (타협 불가)

1. **Passive first** — 대상 앱 코드를 바꾸지 않는다. SDK는 관찰만 한다.
2. **실험은 분석 레이어에서** — 대상 앱을 A/B 하지 않는다. 이미 수집된 데이터를
   서로 다른 방법으로 *처리*해서 비교한다. (passive와 실험의 모순을 이걸로 해소)
3. **증거 연결형** — AI는 "원인은 X다"라고 단정하지 않는다. "언제/어떤 release
   이후/어떤 API에서/얼마나 증가" 같은 관찰 사실만 연결한다.
4. **추천은 후보일 뿐** — 최종 판단은 개발자. 모든 추천에 근거 데이터를 붙인다.
5. **테넌트 격리는 1급 요구사항** — 모든 쿼리가 `project_id`로 스코프된다.

---

## 2. 아키텍처

```
[대상 앱 + SDK]  --(HTTPS, 인제스트 키)-->  [Ingest API]
                                               |
                                     새니타이즈 / 정규화 / 샘플링
                                               |
                                          [Postgres]
                                          events(파티션)
                                          issues(그룹)
                                               |
                        +----------------------+----------------------+
                        |                       |                      |
                 [그룹화 엔진]           [AI 요약]              [규칙 후보탐지]
                 규칙 / AI 선택          증거 연결형             heuristic
                        |                       |                      |
                        +----------------------+----------------------+
                                               |
                                  [대시보드(Next.js)] / [Slack 알림]
                                               |
                                    [실험 하네스 (오프라인)]
                                    규칙 vs AI 그룹화 평가
```

---

## 3. 데이터 모델 (핵심)

- **Organization** → **Project** → **Environment**(dev/staging/prod)
- **IngestKey** — project+environment 스코프. 이 키로만 이벤트 수신.
- **Event** — 원시 텔레메트리 1건. 파티션(월/주 단위) + 짧은 raw retention + 롤업.
- **Issue** — 그룹화된 장애 단위. `fingerprint`, 최초/최근 발생, 발생 수, 영향 release.
- **Membership / Role** — MVP는 `owner` / `member` 두 단계만.
- **AlertRule** — 프로젝트별 임계치(에러율/지연) + Slack webhook.

### 3.1 테넌트 격리 (구현 전략 — "필터 잘 걸자"로는 부족)

- **project_id는 클라이언트를 절대 신뢰하지 않는다.** 인제스트 키를 서버가 조회해
  `project_id`/`environment_id`를 **서버 측에서 해석**한다. 요청 바디의 project_id는 무시.
- 모든 읽기 쿼리는 project 스코프가 강제되는 **쿼리 헬퍼/리포지토리 레이어**만 통과.
  raw SQL 직접 호출 금지(리뷰에서 차단).
- 세션 사용자 → membership 조회 → 접근 가능한 project만 노출.
- Slack webhook·AI 출력·이벤트·이슈 어느 것도 테넌트 경계를 넘지 않는다.
- DDL·인덱스는 `docs/schema.sql` 참조. 테넌트 격리 테스트를 필수 케이스로 둔다.

전체 DDL: **`docs/schema.sql`**.

---

## 4. SDK — Passive 수집

MVP는 **런타임 1개(Node.js/Express + Next.js Route Handler)** 부터. 나머지 프레임워크는 이후.

수집 필드:
- 정규화된 route (`/users/:id`, 원시 path 아님 — 카디널리티 폭발 방지)
- HTTP method, status code, response time(ms)
- error message, stack trace
- timestamp, release version, git commit SHA
- environment

### 4.1 새니타이즈 (수집 단계에서 강제 — "마스킹 몇 개"로는 부족)

- **strict event schema.** 허용된 필드만 수신하고 나머지는 드롭(화이트리스트).
  블랙리스트는 새는 게 기본값이라 금지.
- **MVP에서 raw request body / raw header 수집 금지.** 이름·ID·SQL 리터럴·파일
  경로·URL·비즈니스 데이터가 스택/메시지에 섞이므로 원문 저장을 아예 안 한다.
- 메시지/스택은 정규화 + 값 마스킹(토큰/Bearer/key/email/전화/SQL 리터럴/UUID).
- 새니타이즈는 SDK(전송 전) + 인제스트(수신 시) **양쪽에서** 적용(defense in depth).
- 이 데이터가 곧 연구 라벨셋이 되므로, 새니타이즈 후에도 라벨링 가능해야 한다
  (근거: 라벨은 "새니타이즈된 텔레메트리만으로 판단" — 6장·`docs/labeling-guide.md`).

### 4.2 전송 안정성

샘플링 비율, payload 크기 제한, 재시도(지수 백오프), 오프라인 버퍼, 실패 시
**대상 앱에 영향 주지 않기**(SDK 예외는 삼킨다). rate limit은 인제스트 측에서도 건다.

---

## 5. 에러 정규화 & 그룹화

동일 장애를 하나의 **Issue**로 묶는다. 두 엔진을 모두 구현한다(← 실험 대상).
**공정한 비교를 위해 두 엔진에 동일한 새니타이즈 입력 필드를 준다.**

- **규칙 엔진(Rule) — 강한 baseline (스트로맨 금지):** 다음을 조합한 `fingerprint`:
  - exception type(클래스명)
  - **정규화된 메시지 템플릿**(숫자·UUID·경로 등 변수를 플레이스홀더로 치환)
  - top **N개 app 스택 프레임**(framework/vendor 프레임 제거 후)
  - route, status, (선택) release
  - 결정적·빠름·무료. 여러 강도의 baseline을 두어 AI와 등가 정보로 대결시킨다.
- **AI 엔진(AI):** 에러 텍스트 임베딩 → 유사도 클러스터링(또는 LLM 판정). 표현이
  달라도 의미가 같은 에러를 묶을 잠재력. 임베딩 backend는 교체 가능(6.6):
  - **로컬 sentence-transformer**(`@huggingface/transformers`, all-MiniLM-L6-v2) —
    **기본값. 무료·오프라인·API 키 불필요. 데이터가 기계 밖으로 안 나감(보안 우선).**
  - 로컬 char n-gram — 초경량 대조군.
  - OpenAI 임베딩 — 선택(키 필요, 데이터 외부 전송).
- **하이브리드:** 규칙 1차 → *저신뢰 케이스만* AI 2차(저신뢰 정의는 6.6).

플랫폼 런타임 기본값은 **실험 결과로 채택된 엔진**을 쓴다(6장).

---

## 6. 【연구 코어】 실험: 규칙 기반 vs AI 기반 그룹화

> compare → verify → adopt. 이 프로젝트의 축. 나머지는 이 실험을 뒷받침하는 인프라.

### 6.1 왜 passive와 양립하나
대상 앱을 전혀 안 건드린다. **같은 에러 데이터셋**을 두 알고리즘으로 그룹화해서
결과를 비교할 뿐이다. 실험 대상은 "우리 분석 방법"이지 "고객 앱"이 아니다.

### 6.2 정답셋 (Ground Truth) — 프로젝트의 진짜 심장 · 최대 리스크

**라벨 정의를 좁힌다(순환 논리·불가지 회피).** "same root cause"는 stack/message만으로
알 수 없다. 대신:

> **라벨 = "제공된 새니타이즈 텔레메트리만으로 판단했을 때 같은 actionable issue인가."**
> (근본 원인이 아니라 "같은 조치가 필요한 이슈"인지)

- **`uncertain/exclude` 라벨을 허용**한다. 애매하면 정답셋에서 빼서 노이즈 오염을 막는다.
- **층화 샘플링(stratified).** 랜덤 500~1000건은 잦은 노이즈 에러에 과가중되고 경계
  케이스가 과소대표된다. exception type·route·빈도 구간별로 층화해서 뽑는다
  (희귀 에러·경계 케이스를 의도적으로 포함).
- **2인 독립 라벨 + 불일치 조정(adjudication) + IAA(inter-annotator agreement, 예:
  Cohen's κ) 보고.** 라벨 신뢰도 자체를 수치로 증명한다.
- **누출 방지(leakage):** 라벨러는 알고리즘과 같은 필드로 기계적으로 묶지 않는다
  (top frame만 보고 묶으면 규칙 엔진이 by construction 이김). AI 출력이 라벨러에게
  보이면 안 되고, 라벨을 프롬프트/임계치 튜닝에 쓴 뒤 같은 라벨로 평가하면 오염이다.
- 상세 규약·예시·애매 케이스 규칙: **`docs/labeling-guide.md`** (1급 산출물).

### 6.3 측정 지표 (pairwise F1 단독은 오해를 부른다)

큰 클러스터가 pairwise 점수를 지배하므로(200건 이슈 = 19,900 positive pair) 다층 지표:

- **B-cubed precision/recall/F1** — 클러스터 크기 편차에 강해 entity-resolution/그룹화의
  주지표로 사용.
- **Pairwise precision/recall/F1** — 보조.
- **클러스터 순도/분할 지표(운영 번역):**
  - predicted-cluster impurity rate: 2개 이상 gold 라벨을 섞은 예측 클러스터 비율
  - event-weighted impurity: 오염된 클러스터 안 이벤트 비율
  - worst-cluster impurity: 가장 오염된 클러스터와 그 라벨 구성
  - gold-cluster fragmentation: gold 이슈당 예측 클러스터 평균 수(과분할)
  - duplicate-alert rate: 실제 이슈 하나가 만들 초과 그룹 수
- **ARI, homogeneity/completeness** — 과병합 vs 과분할 진단 보조.
- **AI/하이브리드 한정:** 비용($/1k events, 현실 볼륨 기준), 지연 p50/p95.

**비대칭 강조:** false-merge(다른 이슈 합침)는 false-split보다 훨씬 나쁘다 —
알림 신뢰도를 파괴한다. F1이 이 비대칭을 숨기므로 impurity 지표를 함께 본다.

### 6.4 공정한 대결 프로토콜 (confound 제거)
- 두 엔진에 **동일한 새니타이즈 입력 필드** 제공.
- 규칙은 **강한 baseline 여러 개**(5장)로 — 약한 해시 하나만 두지 않는다.
- **dev/test 분리:** ML 학습이 없어도 임계치·프롬프트는 **dev set**에서 튜닝하고
  **held-out test set**에서 딱 한 번 보고(오버피팅·체리픽 방지).
- **모두 고정(freeze):** 모델 버전, 임베딩 모델, 프롬프트, 클러스터링 알고리즘,
  임계치, random seed, 전처리. 재현 가능해야 한다.
- 결론이 "AI가 일부러 멍청한 해시를 이겼다"가 되면 연구가 아니다.

### 6.5 실험 하네스 (오프라인, 대시보드와 분리)
- 입력: 라벨된 에러셋(dev/test). 출력: 엔진별 지표 표 + 혼동 사례 + 비용/지연.
- 재현 스크립트(시드·버전 고정). 결과·채택 근거를 리포트로 저장 → 캡스톤 결론.

### 6.6 하이브리드의 "저신뢰(low-confidence)" 정의 (측정 가능하게)
결정적 fingerprint엔 신뢰도가 없으므로 **명시 신호로 AI 라우팅을 정의**한다:
- top 프레임이 framework/vendor 코드 / 스택 없음·잘림
- 정규화 메시지가 제네릭(`Internal Server Error`, `Unhandled exception` 등)
- fingerprint 그룹에 exception type이 혼재
- 같은 메시지가 서로 무관한 여러 route에 걸침
- 의미상 이웃이 있는 저빈도 singleton
- route/status는 같은데 message/frame이 충돌
측정: **AI로 보낸 비율**, 규칙-only/AI-only 대비 품질, AI-only 대비 비용 절감,
동일 임계치에서 false-merge율.

### 6.7 Adopt (채택 규칙, 사전 정의)
- **false-merge(impurity)율이 게이트.** 허용치 초과 엔진은 품질과 무관하게 탈락.
- 게이트 통과 중 **B-cubed F1이 유의미하게 높은** 엔진을 런타임 기본값으로.
- 품질 동률이면 **비용·지연이 낮은 엔진(규칙/하이브리드)**을 택한다(운영 현실).
- 결과·채택 근거를 문서화.

### 6.8 구현 상태 (하네스 완성, `research/`)
- 오프라인 하네스 구현 완료: 규칙 3종(minimal/standard/strong) + 임베딩(로컬
  transformers / char n-gram / OpenAI) + 지표(B³·pairwise·impurity·fragmentation·
  ARI·homogeneity) + dev/test 프로토콜 + impurity 채택 게이트.
- 실행: `npm run research:gen && npm run research:eval` → `reports/grouping-eval.md`.
- **실데이터 루프 완성:** SDK 수집 → **라벨링 UI**(`/projects/[id]/labeling`, 가이드
  `docs/labeling-guide.md`) → `gold_labels` → `research/corpus/export-db.ts` →
  `research:eval`. 배관은 end-to-end 검증됨.
- **현재 데모는 합성 부트스트랩 코퍼스**(기계 검증용). 실결론은 실제 사람 라벨링 수행
  후 도출. 자세히는 `research/README.md`.

---

## 7. AI 증거 연결형 Incident 요약

원인 단정 금지. 관찰 사실만 연결한다.

- 예: *"release `abc123` 배포 후 `/api/orders`에서 에러 4.2배 증가. top 스택
  프레임 `X`. 영향 환경 prod. 최초 발생 14:03."*
- **"자유 추론 금지"는 프롬프트만으로 강제되지 않는다.** 출력을 **구조화 스키마**로
  받아 *모든 주장(claim)마다 근거 `event_id`/`metric_id` 인용을 필수 필드로* 요구한다.
  근거 없는 claim은 파서에서 거부.
- LLM은 프롬프트에 주입된 수집 사실에만 grounding.
- **LLM backend는 로컬 우선**(보안): **Ollama**(Llama 3.x / Qwen2.5 등, 로컬·무료·
  데이터 외부 유출 없음, JSON 모드로 인용 스키마 강제) 기본, OpenAI는 선택.
- 모델/프롬프트는 6장 하네스와 같은 방식으로 품질을 사후 점검 가능하게 설계.

---

## 8. 개선 후보 추천 (규칙 기반 — AI 아님, 정직하게)

"캐싱하면 빨라진다" 단정 X. 관찰 데이터 기반 **후보 플래그**:
- 예: *"`/api/report`는 p95 1.8s + 시간당 3천 호출 → 캐싱 검토 대상."*
- 순수 heuristic(응답시간·호출빈도·변경주기 임계치). LLM 불필요 → AI로 포장하지 않음.
- 최종 판단은 개발자. 각 후보에 근거 수치 첨부.

---

## 9. Slack 실시간 알림

프로젝트별 webhook. 임계치(에러율/지연) 초과 시 발송. 포함:
- 프로젝트/환경/API/status/error/발생시간
- **증거 연결형 요약(7장)** + 대시보드 딥링크
- 알림 그룹화는 채택된 그룹화 엔진(6장)을 사용 → 스팸/누락은 그룹화 품질에 직결

---

## 10. 기술 스택

- Frontend: Next.js + TypeScript + Tailwind
- Backend: Next.js Route Handlers (MVP 단순화; 규모 커지면 NestJS 분리)
- DB: PostgreSQL — MVP 볼륨 상한을 **숫자로 명시**: raw 이벤트 retention 14일,
  샘플링 상한(프로젝트당 초당 이벤트 캡), 시간 단위 롤업 후 raw 삭제. TSDB(ClickHouse/
  Timescale)는 스코프 밖으로 명시. 상한 초과는 인제스트에서 drop + 카운트만 집계.
- AI (로컬 우선 — 보안: 테넌트 데이터가 기계 밖으로 안 나감, 키·retention 약관 없음):
  - 임베딩(그룹화): **`@huggingface/transformers` all-MiniLM-L6-v2** (로컬·무료·오프라인). OpenAI는 선택.
  - LLM(요약): **Ollama** (로컬·무료). OpenAI는 선택.
  - 호스팅 무료 티어(Gemini 등)는 **무료 티어 데이터 학습 사용** 우려로 테넌트 데이터엔 비권장.
- Notification: Slack Incoming Webhook
- SDK: Node.js/Next.js 계측 (자체) — OTel은 선택적 후속

---

## 11. 스코프 경계 (Codex 리뷰 반영, 명시적 컷)

**MVP 포함:** 단일 Node SDK, Org/Project/Env + owner/member, 이벤트 인제스트/새니타이즈,
규칙+AI 그룹화 두 엔진, **그룹화 비교 실험 하네스+라벨셋(연구 코어)**, 증거 연결형 요약,
규칙 기반 후보 추천, Slack 알림, 기본 대시보드.

**MVP 제외(컷):** 캐싱/pagination/lazy-eager 등 대상 앱 A/B 실험(불가능), 인덱스 추천,
DB span 없는 slow query 분석, 미사용 기능 분석, 멀티프레임워크 SDK(1개 넘게), 풀 RBAC,
ClickHouse/Timescale 등 별도 분석 스토리지.

---

## 12. 핵심 리스크

1. **정답셋 품질** — 라벨링이 허술하면 실험 결론 전체가 무너진다. 가장 먼저·엄격하게.
2. **테넌트 격리 누락** — `project_id` 필터 하나 빠지면 데이터 유출.
3. **AI grounding 실패** — 데이터 주입 없이 자유 추론시키면 hallucinate. 요약은
   반드시 관찰 사실만 인용하도록 강제.
4. **텔레메트리 무한 확장** — 인제스트를 인프라 프로젝트로 키우지 말 것. 샘플·짧은
   retention·롤업으로 데모 규모에 고정.

---

## 13. 권장 구현 순서

1. 데이터 모델 + 인제스트 API + 새니타이즈 (테넌트 격리·strict schema부터) — `docs/schema.sql`
2. Node/Next SDK — 이벤트 전송 — `docs/sdk-interface.md`
3. 규칙 그룹화 엔진(강한 baseline 여러 개) + Issue 대시보드
4. **에러 라벨셋 구축 + 실험 하네스** — `docs/labeling-guide.md`
   (← 여기서 연구 시작. 가장 리스크 큰 가정(정답셋)을 코드 많이 짜기 전에 먼저 검증)
5. AI 그룹화 엔진 → 하네스로 규칙 vs AI vs 하이브리드 비교 → false-merge 게이트로 채택
6. 증거 연결형 요약(근거 인용 스키마) + Slack 알림
7. 규칙 기반 개선 후보 추천

### 세부 문서
- `docs/labeling-guide.md` — 정답셋 라벨링 규약(정의·층화·IAA·누출 방지)
- `docs/schema.sql` — Postgres DDL(테넌시·이벤트 파티션·이슈)
- `docs/sdk-interface.md` — SDK 공개 인터페이스·이벤트 페이로드·새니타이즈 계약
- `docs/sdk-integration-guide.md` — **각 프로젝트에 SDK 붙이는 기획안(Claude Code 런북)**

### 구현물
- `packages/sdk` — 재사용 SDK(`@api-monitor/sdk`): Express 미들웨어 · Next 래퍼 ·
  배치 전송 · 새니타이즈. **프로젝트마다 만들지 않고 설치+초기화 몇 줄.**
- `examples/demo-api` — 의도적 버그를 내는 데모 Express 앱(실 에러 코퍼스 생성원).
- `research/` — 그룹화 실험 하네스(연구 코어).
