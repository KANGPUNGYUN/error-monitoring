# 실험 하네스 — 규칙 기반 vs AI 기반 에러 그룹화

이 프로젝트의 **연구 코어**(SPEC 6장). 오프라인 — DB/대시보드/dev 서버와 분리.
compare → verify → adopt: 여러 그룹화 엔진을 동일 정답셋으로 비교하고, false-merge
게이트를 통과한 최고 성능 엔진을 런타임 기본값으로 채택한다.

## 실행

```bash
# 1) 부트스트랩 합성 코퍼스 생성 (기계 검증용, SEED 고정)
npm run research:gen

# 2) 실험 실행 → reports/grouping-eval.md
npm run research:eval

# OpenAI 임베딩까지 함께 비교 (선택, OPENAI_API_KEY 필요)
npx tsx research/run.ts --openai
```

기본 실행은 규칙 3종 + `embed-local`(char n-gram) + `embed-transformers`(로컬
sentence-transformer)를 비교한다. **API 키 없이도 진짜 의미 임베딩 vs 규칙 비교가
성립**한다(데이터가 기계 밖으로 안 나감). 첫 실행 시 all-MiniLM-L6-v2 가중치(~90MB)만
HuggingFace CDN에서 받는다(당신 데이터가 나가는 게 아니라 모델이 들어옴).

## 실데이터로 교체

합성 코퍼스는 **기계 검증용 stand-in** 이다. 실제 연구 결론은 SDK 실데이터 + 사람
라벨(`docs/labeling-guide.md`)로 낸다. gold_labels 에 라벨을 적재한 뒤:

```bash
npx tsx research/corpus/export-db.ts   # DB events+gold_labels → datasets/*.jsonl
npm run research:eval                    # 동일 하네스 재사용
```

## 구성

- `corpus/generate.ts` — 합성 코퍼스(과분할/과병합/route-sensitive 난이도 심음)
- `corpus/export-db.ts` — DB 실데이터를 동일 JSONL 포맷으로 export
- `engines/rule.ts` — 규칙 엔진 3종(minimal/standard/strong baseline)
- `engines/embed.ts` — 임베딩 엔진 backend 3종: 로컬 transformers(기본) / char
  n-gram / OpenAI(선택). dev 에서 임계치 튜닝
- `metrics.ts` — B³·pairwise·impurity·fragmentation·ARI·homogeneity/completeness
- `run.ts` — dev fit → held-out test 평가 → 채택 게이트 → 리포트

## 프로토콜 (SPEC 6.4)

- dev 셋에서만 하이퍼파라미터(임계치) 튜닝, **test 는 고정값으로 1회 보고**(누출 방지).
- SEED 고정, 엔진/임계치 freeze → 재현 가능.
- 채택 게이트: **event-weighted impurity ≤ 10%** (false-merge 방어). 게이트 통과 중
  B³F1 최고, 동률이면 저비용(규칙) 채택.

## 주의 (연구 방어)

- 합성 코퍼스의 절대 점수는 의미 없다. 데이터가 프레임으로 완전 분리되면 규칙이
  trivially 이길 수 있다. **실데이터 + 사람 라벨**에서만 결론을 낸다.
- `embed-local`(char n-gram)은 초경량 대조군일 뿐이다. 진짜 의미 임베딩은
  `embed-transformers`(로컬 sentence-transformer, 기본 포함). OpenAI까지 보려면 `--openai`.
