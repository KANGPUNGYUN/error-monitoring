# demo-api

`@api-monitor/sdk` 를 붙인 데모 Express 앱. 의도적으로 다양한 버그를 내서 **실 에러
코퍼스**를 만든다(연구 하네스의 실데이터 소스).

## 실행

```bash
# 1) 플랫폼(인제스트) 먼저 띄우고 (repo 루트에서: npm run dev), seed 로 ingest key 발급
# 2) 데모 앱 실행
MONITOR_INGEST_KEY="ingest_xxx" \
MONITOR_ENDPOINT="http://localhost:3000/api/v1/events" \
PORT=4000 npm start

# 3) 트래픽 흘리기 (다른 터미널)
DEMO_URL="http://localhost:4000" N=60 npm run traffic
```

2초(배치 flush) 뒤 플랫폼 DB 에 이벤트·이슈가 쌓인다.

## 라우트 (의도된 버그)

| route | 증상 | gold 성격 |
|---|---|---|
| `GET /api/orders/:id` | TypeError (undefined.total) | varied-wording 그룹 |
| `GET /api/checkout` | TypeError (null.items) | 별도 그룹 |
| `GET /api/gateway?n=` | 내부 함수별 서로 다른 Error | generic-message 2그룹 |
| `GET /api/report` | 504 timeout | 쉬운 그룹 |
| `POST /api/signup` | 422 validation | 4xx |
| `GET /api/ok` | 200 | 성공(샘플링) |

SDK 연결은 `src/server.ts` 상단 `initMonitor` + `app.use` 두 줄이 전부다.
