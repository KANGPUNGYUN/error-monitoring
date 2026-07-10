import { writeFileSync, mkdirSync } from "node:fs";
import { normalizeMessage, extractAppFrames } from "../../src/lib/sanitize";
import { mulberry32, pick, shuffle } from "../prng";
import type { CorpusRow } from "../types";

// ─────────────────────────────────────────────────────────────
// 부트스트랩 합성 코퍼스 (SPEC 6). 실제 라벨링(docs/labeling-guide.md) 전까지
// 하네스 기계를 세우고 검증하기 위한 stand-in gold set.
// ⚠️ 이것은 연구 "결과"가 아니라 기계 검증용 데이터다. SDK 실데이터로 교체한다.
//
// 규칙 vs AI 가 실제로 갈리도록 다음 난이도를 의도적으로 심는다:
//  - varied-wording: 같은 이슈인데 메시지 문구가 다양 → 규칙(정규화 메시지) 과분할
//  - generic-message: 서로 다른 이슈가 제네릭 메시지 공유 → 약한 규칙 과병합
//  - route-sensitive: 같은 예외/메시지라도 route 가 다르면 다른 이슈
// ─────────────────────────────────────────────────────────────

const SEED = 42;
const rng = mulberry32(SEED);

const EMAILS = ["john@acme.com", "jane@corp.io", "bob@x.dev", "al@y.net"];
const IDS = () => Math.floor(rng() * 100000);
const RELEASES = ["v1.2.0", "v1.2.1", "v1.3.0"];

type RawEvent = {
  exceptionType: string | null;
  message: string;
  frames: string[];
  route: string;
  status: number;
};

type Archetype = {
  id: string;
  // 한 gold 그룹의 이벤트 1건을 생성
  gen: () => RawEvent;
};

// 같은 근본 이슈인데 문구가 다양한 NullReference (varied-wording)
function nullRefVariedWording(route: string, frame: string): Archetype {
  const phrasings = [
    () => `Cannot read properties of undefined (reading 'total') for user ${pick(rng, EMAILS)}`,
    () => `undefined is not an object (evaluating 'order.total') uid=${IDS()}`,
    () => `TypeError: order.total is undefined, user ${pick(rng, EMAILS)}`,
    () => `cannot access 'total' of undefined order id=${IDS()}`,
  ];
  return {
    id: `nullref:${route}`,
    gen: () => ({
      exceptionType: "TypeError",
      message: pick(rng, phrasings)(),
      frames: [frame, "at handler (route.ts:11)", "at /app/node_modules/next/dist/server.js:9"],
      route,
      status: 500,
    }),
  };
}

// 서로 다른 이슈들이 같은 제네릭 메시지를 공유 (generic-message)
function genericFailure(route: string, frame: string): Archetype {
  const generic = ["Internal Server Error", "Request failed", "Unhandled exception"];
  return {
    id: `generic:${route}:${frame}`,
    gen: () => ({
      exceptionType: "Error",
      message: pick(rng, generic),
      frames: [frame, "at /app/node_modules/express/lib/router.js:1"],
      route,
      status: 500,
    }),
  };
}

// 일관된 DB 타임아웃 이슈 (쉬운 그룹)
function dbTimeout(route: string): Archetype {
  return {
    id: `dbtimeout:${route}`,
    gen: () => ({
      exceptionType: "TimeoutError",
      message: `Query timed out after ${1000 + Math.floor(rng() * 4000)}ms on connection ${IDS()}`,
      frames: ["at Pool.query (db.ts:88)", "at ReportService.load (report.service.ts:34)"],
      route,
      status: 504,
    }),
  };
}

// 검증 실패 4xx (일관)
function validation(route: string): Archetype {
  return {
    id: `validation:${route}`,
    gen: () => ({
      exceptionType: "ValidationError",
      message: `field 'email' invalid: ${pick(rng, EMAILS)}`,
      frames: ["at validate (schema.ts:20)", "at handler (route.ts:5)"],
      route,
      status: 422,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// gold 그룹 구성
// ─────────────────────────────────────────────────────────────
type GroupSpec = { archetype: Archetype; size: number };

function buildGroupSpecs(): GroupSpec[] {
  const specs: GroupSpec[] = [];

  // varied-wording 이슈 6개 (중간 크기) — 규칙 과분할 유발
  const nullRoutes = ["/api/orders/:id", "/api/cart", "/api/checkout", "/api/users/:id", "/api/report", "/api/invoice/:id"];
  for (const r of nullRoutes) {
    specs.push({ archetype: nullRefVariedWording(r, "at OrderService.create (order.service.ts:42)"), size: 10 + Math.floor(rng() * 15) });
  }

  // generic-message: 같은 route 에서 서로 다른 frame(=다른 근본이슈) 4개 — 약한 규칙 과병합
  const genRoute = "/api/gateway";
  for (const f of ["at A.h (a.ts:1)", "at B.h (b.ts:2)", "at C.h (c.ts:3)", "at D.h (d.ts:4)"]) {
    specs.push({ archetype: genericFailure(genRoute, f), size: 6 + Math.floor(rng() * 8) });
  }

  // db timeout 이슈 3개 (쉬움)
  for (const r of ["/api/report", "/api/export", "/api/analytics"]) {
    specs.push({ archetype: dbTimeout(r), size: 5 + Math.floor(rng() * 10) });
  }

  // validation 이슈 3개
  for (const r of ["/api/signup", "/api/profile", "/api/settings"]) {
    specs.push({ archetype: validation(r), size: 4 + Math.floor(rng() * 6) });
  }

  // 싱글턴 이슈 12개 (희귀 — 층화 포함)
  for (let i = 0; i < 12; i++) {
    const r = `/api/misc/${i}`;
    specs.push({ archetype: nullRefVariedWording(r, `at Misc${i}.run (misc${i}.ts:7)`), size: 1 });
  }

  return specs;
}

// ─────────────────────────────────────────────────────────────
// 생성
// ─────────────────────────────────────────────────────────────
function main() {
  const specs = buildGroupSpecs();
  const rows: CorpusRow[] = [];
  let eventId = 1;
  let groupId = 1;

  for (const { archetype, size } of specs) {
    const groupEvents: CorpusRow[] = [];
    for (let i = 0; i < size; i++) {
      const raw = archetype.gen();
      groupEvents.push({
        eventId: eventId++,
        exceptionType: raw.exceptionType,
        messageNorm: normalizeMessage(raw.message),
        topFrames: extractAppFrames(raw.frames),
        route: raw.route,
        status: raw.status,
        release: pick(rng, RELEASES),
        split: "dev", // 아래에서 재배정
        groupId,
      });
    }
    // 그룹 내 stratified split: 약 절반 dev / 절반 test (싱글턴은 교대)
    const shuffled = shuffle(rng, groupEvents);
    shuffled.forEach((ev, idx) => {
      ev.split = idx % 2 === 0 ? "dev" : "test";
    });
    rows.push(...shuffled);
    groupId++;
  }

  // uncertain 이벤트 ~8% (groupId=null, 평가 제외) — 애매 케이스 시뮬레이션
  const uncertainCount = Math.floor(rows.length * 0.08);
  for (let i = 0; i < uncertainCount; i++) {
    const r = pick(rng, ["/api/orders/:id", "/api/gateway", "/api/report"]);
    rows.push({
      eventId: eventId++,
      exceptionType: pick(rng, ["Error", "TypeError", null]),
      messageNorm: normalizeMessage(pick(rng, ["Internal Server Error", "unexpected", "failed"])),
      topFrames: extractAppFrames(["at ? (unknown)"]),
      route: r,
      status: 500,
      release: pick(rng, RELEASES),
      split: i % 2 === 0 ? "dev" : "test",
      groupId: null,
    });
  }

  const dev = rows.filter((r) => r.split === "dev");
  const test = rows.filter((r) => r.split === "test");

  mkdirSync("datasets", { recursive: true });
  writeFileSync("datasets/corpus.dev.jsonl", dev.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync("datasets/corpus.test.jsonl", test.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const goldGroups = new Set(rows.filter((r) => r.groupId != null).map((r) => r.groupId)).size;
  console.log(`Generated corpus (SEED=${SEED}):`);
  console.log(`  total events:   ${rows.length}`);
  console.log(`  dev / test:     ${dev.length} / ${test.length}`);
  console.log(`  gold groups:    ${goldGroups}`);
  console.log(`  uncertain(excl):${uncertainCount}`);
  console.log(`  wrote datasets/corpus.dev.jsonl, datasets/corpus.test.jsonl`);
  console.log(`\n⚠️  부트스트랩 데이터입니다. 실제 연구 결론은 SDK 실데이터 + 사람 라벨링으로.`);
}

main();
