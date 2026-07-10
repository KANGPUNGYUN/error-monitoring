import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { CorpusRow, ErrorRecord, Engine } from "./types";
import { evaluate, type Metrics } from "./metrics";
import { ruleEngine } from "./engines/rule";
import { embedEngine } from "./engines/embed";

// 실험 하네스 러너 (SPEC 6.4~6.7). 오프라인, 결정적.
//  - dev 셋에서 임계치 튜닝(fit) → held-out test 셋에서 1회 보고(누출 방지).
//  - false-merge(impurity) 게이트로 채택 추천.
// 실행: npx tsx research/run.ts [--openai]

const IMPURITY_GATE = 0.1; // event-weighted impurity 허용 상한 (SPEC 6.7 채택 게이트)

function loadCorpus(path: string): CorpusRow[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CorpusRow);
}

function toRecords(rows: CorpusRow[]): ErrorRecord[] {
  return rows.map(({ eventId, exceptionType, messageNorm, topFrames, route, status, release }) => ({
    eventId,
    exceptionType,
    messageNorm,
    topFrames,
    route,
    status,
    release,
  }));
}

function toGold(rows: CorpusRow[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rows) if (r.groupId != null) m.set(r.eventId, r.groupId);
  return m;
}

const pct = (x: number) => (x * 100).toFixed(1) + "%";
const f2 = (x: number) => x.toFixed(3);

type Row = { name: string; test: Metrics; dev: Metrics; ms: number; gatePass: boolean };

async function runEngine(
  engine: Engine,
  devRecords: ErrorRecord[],
  devGold: Map<number, number>,
  testRecords: ErrorRecord[],
  testGold: Map<number, number>,
): Promise<Row> {
  const t0 = process.hrtime.bigint();
  if (engine.fit) await engine.fit(devRecords, devGold);
  const predDev = await engine.cluster(devRecords);
  const predTest = await engine.cluster(testRecords);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const dev = evaluate(devGold, predDev);
  const test = evaluate(testGold, predTest);
  return { name: engine.name, test, dev, ms, gatePass: test.eventWeightedImpurity <= IMPURITY_GATE };
}

function reportTable(rows: Row[]): string {
  const head =
    "| engine | B³ F1 | pair F1 | false-merge | evt-impurity | fragmentation | dup-alert | ARI | V-measure | #clusters | gate | ms |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|---|";
  const body = rows
    .map((r) => {
      const m = r.test;
      return `| ${r.name} | ${f2(m.bcubedF1)} | ${f2(m.pairF1)} | ${pct(m.pairFalseMergeRate)} | ${pct(m.eventWeightedImpurity)} | ${f2(m.goldClusterFragmentation)} | ${f2(m.duplicateAlertRate)} | ${f2(m.ari)} | ${f2(m.vMeasure)} | ${m.predClusters} | ${r.gatePass ? "✅" : "❌"} | ${r.ms.toFixed(0)} |`;
    })
    .join("\n");
  return `${head}\n${body}`;
}

function recommend(rows: Row[]): string {
  // SPEC 6.7: false-merge 게이트 통과 중 B³F1 최고, 동률이면 저비용(규칙/로컬).
  const passing = rows.filter((r) => r.gatePass);
  if (!passing.length) {
    return "채택 후보 없음 — 모든 엔진이 impurity 게이트(≤" + pct(IMPURITY_GATE) + ")를 넘김. false-merge 위험.";
  }
  const sorted = passing.sort((a, b) => {
    if (Math.abs(b.test.bcubedF1 - a.test.bcubedF1) > 0.01) return b.test.bcubedF1 - a.test.bcubedF1;
    return a.ms - b.ms; // 동률이면 빠른(=대개 규칙) 쪽
  });
  const win = sorted[0];
  return `채택 추천: **${win.name}** — 게이트 통과 + B³F1 최고(${f2(win.test.bcubedF1)}), evt-impurity ${pct(win.test.eventWeightedImpurity)}.`;
}

async function main() {
  const useOpenAI = process.argv.includes("--openai");
  const devRows = loadCorpus("datasets/corpus.dev.jsonl");
  const testRows = loadCorpus("datasets/corpus.test.jsonl");
  const devRecords = toRecords(devRows);
  const testRecords = toRecords(testRows);
  const devGold = toGold(devRows);
  const testGold = toGold(testRows);

  const engines: Engine[] = [
    ruleEngine("minimal"),
    ruleEngine("standard"),
    ruleEngine("strong"),
    embedEngine({ backend: "ngram" }), // 초경량 baseline
    embedEngine({ backend: "transformers" }), // 로컬 sentence-transformer (무료·오프라인·보안)
  ];
  if (useOpenAI) {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("⚠️  --openai 지정됐지만 OPENAI_API_KEY 없음 → embed-openai 스킵");
    } else {
      engines.push(embedEngine({ backend: "openai" }));
    }
  }

  const rows: Row[] = [];
  for (const e of engines) {
    rows.push(await runEngine(e, devRecords, devGold, testRecords, testGold));
  }

  const table = reportTable(rows);
  const rec = recommend(rows);
  const worst = rows
    .map((r) => `- ${r.name}: worst impure cluster size=${r.test.worstClusterSize}, distinct gold=${r.test.worstClusterDistinctGold}`)
    .join("\n");

  const md = `# 그룹화 실험 리포트 (규칙 vs 임베딩)

> 오프라인 하네스 결과 (SPEC 6). **held-out test 셋** 기준. 재현: \`npx tsx research/corpus/generate.ts && npx tsx research/run.ts\`.
> ⚠️ 현재는 **부트스트랩 합성 코퍼스**. 실제 결론은 SDK 실데이터 + 사람 라벨(docs/labeling-guide.md)로.

- test events: ${testGold.size} (labeled) / dev events: ${devGold.size}
- 채택 게이트: event-weighted impurity ≤ ${pct(IMPURITY_GATE)} (false-merge 방어)

## 결과 (test)

${table}

**${rec}**

### worst impure cluster (과병합 진단)
${worst}

## 지표 해설
- **B³ F1**: 주지표(클러스터 크기 편차에 강함). 높을수록 좋음.
- **false-merge**: 다른 이슈를 합친 pair 비율(=1-pairPrecision). 운영상 가장 치명적.
- **evt-impurity**: 오염된 예측 클러스터에 속한 이벤트 비율. 채택 게이트.
- **fragmentation / dup-alert**: 한 실제 이슈가 몇 개 그룹으로 쪼개지는지(알림 스팸).
`;

  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/grouping-eval.md", md);

  console.log("\n=== 그룹화 실험 (test 셋) ===\n");
  console.log(table);
  console.log("\n" + rec);
  console.log("\n리포트 저장: reports/grouping-eval.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
