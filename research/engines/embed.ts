import type { Engine, ErrorRecord, Clustering } from "../types";
import { evaluate } from "../metrics";

// 임베딩 기반 그룹화 엔진 (SPEC 5, 6.4의 "AI 엔진"). backend 3종:
//  - "transformers": 로컬 sentence-transformer (@huggingface/transformers, all-MiniLM-L6-v2).
//                    완전 오프라인·무료·API 키 불필요. 데이터가 기계 밖으로 안 나감(보안).
//  - "ngram":        로컬 char n-gram 코사인 (초경량 baseline, AI 대용품).
//  - "openai":       OpenAI 임베딩 (OPENAI_API_KEY 필요, 데이터 외부 전송).
// dev 에서 임계치를 튜닝하고 test 는 고정 임계치로 평가한다(dev/test 누출 방지).

type Backend = "transformers" | "ngram" | "openai";
type Vec = Map<string, number>;

function composeText(r: ErrorRecord): string {
  return [r.exceptionType, r.messageNorm, r.topFrames?.[0], r.route]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function charNgrams(text: string, n = 3): Vec {
  const v: Vec = new Map();
  const s = `  ${text}  `;
  for (let i = 0; i + n <= s.length; i++) {
    const g = s.slice(i, i + n);
    v.set(g, (v.get(g) ?? 0) + 1);
  }
  return v;
}

function denseToVec(arr: number[]): Vec {
  const v: Vec = new Map();
  arr.forEach((x, i) => v.set(String(i), x));
  return v;
}

function norm(v: Vec): number {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s);
}

function cosine(a: Vec, aNorm: number, b: Vec, bNorm: number): number {
  if (aNorm === 0 || bNorm === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, x] of small) {
    const y = large.get(k);
    if (y) dot += x * y;
  }
  return dot / (aNorm * bNorm);
}

// ── backend: transformers (로컬, lazy load) ──
let extractorPromise: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>> | null = null;
async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2"),
    ) as Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>>;
  }
  return extractorPromise;
}
async function transformersEmbed(texts: string[]): Promise<Vec[]> {
  const extractor = await getExtractor();
  const out: Vec[] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const res = await extractor(batch, { pooling: "mean", normalize: true });
    for (const row of res.tolist()) out.push(denseToVec(row));
  }
  return out;
}

// ── backend: openai (외부 API) ──
async function openaiEmbed(texts: string[]): Promise<Vec[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const out: Vec[] = [];
  for (let i = 0; i < texts.length; i += 200) {
    const batch = texts.slice(i, i + 200);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: batch }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    for (const d of json.data) out.push(denseToVec(d.embedding));
  }
  return out;
}

const THRESHOLDS = [0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

const BACKEND_NAME: Record<Backend, string> = {
  transformers: "embed-transformers",
  ngram: "embed-local",
  openai: "embed-openai",
};

export function embedEngine(opts: { backend?: Backend } = {}): Engine {
  const backend: Backend = opts.backend ?? "transformers";
  const cache = new Map<string, Vec>();
  let threshold = 0.6;

  async function fillCache(records: ErrorRecord[]): Promise<void> {
    const texts = records.map(composeText);
    const missingIdx: number[] = [];
    texts.forEach((t, i) => {
      if (!cache.has(t)) missingIdx.push(i);
    });
    if (!missingIdx.length) return;
    const missingTexts = missingIdx.map((i) => texts[i]);
    let vecs: Vec[];
    if (backend === "transformers") vecs = await transformersEmbed(missingTexts);
    else if (backend === "openai") vecs = await openaiEmbed(missingTexts);
    else vecs = missingTexts.map((t) => charNgrams(t));
    missingIdx.forEach((idx, k) => cache.set(texts[idx], vecs[k]));
  }

  function embOf(r: ErrorRecord): { vec: Vec; norm: number } {
    const v = cache.get(composeText(r))!;
    return { vec: v, norm: norm(v) };
  }

  // 그리디 nearest-centroid 클러스터링 (결정적: eventId 순서).
  function greedyCluster(records: ErrorRecord[], th: number): Clustering {
    const order = records.slice().sort((a, b) => a.eventId - b.eventId);
    const clusters: { sum: Vec; sumNorm: number; id: string }[] = [];
    const assign: Clustering = new Map();
    for (const r of order) {
      const e = embOf(r);
      let best = -1;
      let bestSim = -1;
      for (let c = 0; c < clusters.length; c++) {
        const sim = cosine(e.vec, e.norm, clusters[c].sum, clusters[c].sumNorm);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (best >= 0 && bestSim >= th) {
        const cl = clusters[best];
        for (const [k, x] of e.vec) cl.sum.set(k, (cl.sum.get(k) ?? 0) + x);
        cl.sumNorm = norm(cl.sum);
        assign.set(r.eventId, cl.id);
      } else {
        const id = `emb-${clusters.length}`;
        const sum: Vec = new Map(e.vec);
        clusters.push({ sum, sumNorm: norm(sum), id });
        assign.set(r.eventId, id);
      }
    }
    return assign;
  }

  return {
    name: BACKEND_NAME[backend],
    async fit(records, gold) {
      await fillCache(records);
      let bestTh = THRESHOLDS[0];
      let bestF1 = -1;
      for (const th of THRESHOLDS) {
        const m = evaluate(gold, greedyCluster(records, th));
        if (m.bcubedF1 > bestF1) {
          bestF1 = m.bcubedF1;
          bestTh = th;
        }
      }
      threshold = bestTh;
    },
    async cluster(records) {
      await fillCache(records);
      return greedyCluster(records, threshold);
    },
  };
}
