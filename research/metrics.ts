// 그룹화 평가 지표 (SPEC 6.3). gold/pred 는 라벨된 이벤트에 대해서만 계산한다.
// pairwise F1 단독은 큰 클러스터에 과가중되므로 다층 지표를 함께 낸다.

export type Metrics = {
  events: number;
  goldGroups: number;
  predClusters: number;

  // B-cubed (주지표) — 클러스터 크기 편차에 강함
  bcubedPrecision: number;
  bcubedRecall: number;
  bcubedF1: number;

  // Pairwise (보조)
  pairPrecision: number;
  pairRecall: number;
  pairF1: number;
  // 운영 비대칭: false-merge(다른 이슈 합침) ≫ false-split
  pairFalseMergeRate: number; // FP / predicted-positive pairs = 1 - pairPrecision
  pairFalseSplitRate: number; // FN / gold-positive pairs      = 1 - pairRecall

  // 클러스터 순도 (과병합 진단)
  predClusterImpurityRate: number; // 2개 이상 gold 라벨 섞인 예측 클러스터 비율
  eventWeightedImpurity: number; // 오염된 클러스터 내 이벤트 비율
  worstClusterSize: number;
  worstClusterDistinctGold: number;

  // 분할 (과분할 진단)
  goldClusterFragmentation: number; // gold 이슈당 평균 예측 클러스터 수
  duplicateAlertRate: number; // 실제 이슈 하나가 만드는 초과 그룹 수(평균)

  // 표준 클러스터링 지표
  ari: number;
  homogeneity: number;
  completeness: number;
  vMeasure: number;
};

function comb2(n: number): number {
  return (n * (n - 1)) / 2;
}

/**
 * @param gold eventId -> gold groupId (uncertain 은 제외하고 전달)
 * @param pred eventId -> predicted clusterId
 */
export function evaluate(gold: Map<number, number>, pred: Map<number, string>): Metrics {
  const ids = [...gold.keys()].filter((id) => pred.has(id));
  const n = ids.length;

  // 멤버십 맵
  const goldMembers = new Map<number, number[]>();
  const predMembers = new Map<string, number[]>();
  for (const id of ids) {
    const g = gold.get(id)!;
    const p = pred.get(id)!;
    (goldMembers.get(g) ?? goldMembers.set(g, []).get(g)!).push(id);
    (predMembers.get(p) ?? predMembers.set(p, []).get(p)!).push(id);
  }
  const goldOf = new Map(ids.map((id) => [id, gold.get(id)!]));
  const predOf = new Map(ids.map((id) => [id, pred.get(id)!]));

  // ── Pairwise ──
  let tp = 0,
    fp = 0,
    fn = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = ids[i],
        b = ids[j];
      const sameGold = goldOf.get(a) === goldOf.get(b);
      const samePred = predOf.get(a) === predOf.get(b);
      if (samePred && sameGold) tp++;
      else if (samePred && !sameGold) fp++;
      else if (!samePred && sameGold) fn++;
    }
  }
  const pairPrecision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const pairRecall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const pairF1 =
    pairPrecision + pairRecall === 0
      ? 0
      : (2 * pairPrecision * pairRecall) / (pairPrecision + pairRecall);

  // ── B-cubed ──
  let sumP = 0,
    sumR = 0;
  for (const id of ids) {
    const pMembers = predMembers.get(predOf.get(id)!)!;
    const gMembers = goldMembers.get(goldOf.get(id)!)!;
    const correctInPred = pMembers.filter((j) => goldOf.get(j) === goldOf.get(id)).length;
    const correctInGold = gMembers.filter((j) => predOf.get(j) === predOf.get(id)).length;
    sumP += correctInPred / pMembers.length;
    sumR += correctInGold / gMembers.length;
  }
  const bcubedPrecision = n === 0 ? 1 : sumP / n;
  const bcubedRecall = n === 0 ? 1 : sumR / n;
  const bcubedF1 =
    bcubedPrecision + bcubedRecall === 0
      ? 0
      : (2 * bcubedPrecision * bcubedRecall) / (bcubedPrecision + bcubedRecall);

  // ── 클러스터 순도 ──
  let impureClusters = 0;
  let eventsInImpure = 0;
  let worstClusterSize = 0;
  let worstClusterDistinctGold = 0;
  for (const [, members] of predMembers) {
    const distinct = new Set(members.map((id) => goldOf.get(id))).size;
    if (distinct > 1) {
      impureClusters++;
      eventsInImpure += members.length;
    }
    if (distinct > worstClusterDistinctGold || (distinct === worstClusterDistinctGold && members.length > worstClusterSize)) {
      worstClusterDistinctGold = distinct;
      worstClusterSize = members.length;
    }
  }
  const predClusterImpurityRate = predMembers.size === 0 ? 0 : impureClusters / predMembers.size;
  const eventWeightedImpurity = n === 0 ? 0 : eventsInImpure / n;

  // ── 분할 ──
  let fragTotal = 0;
  for (const [, members] of goldMembers) {
    const distinctPred = new Set(members.map((id) => predOf.get(id))).size;
    fragTotal += distinctPred;
  }
  const goldClusterFragmentation = goldMembers.size === 0 ? 0 : fragTotal / goldMembers.size;
  const duplicateAlertRate = goldMembers.size === 0 ? 0 : (fragTotal - goldMembers.size) / goldMembers.size;

  // ── 대조표 기반: ARI, homogeneity/completeness ──
  const goldKeys = [...goldMembers.keys()];
  const predKeys = [...predMembers.keys()];
  const contingency = new Map<string, number>();
  for (const id of ids) {
    const key = `${goldOf.get(id)}|${predOf.get(id)}`;
    contingency.set(key, (contingency.get(key) ?? 0) + 1);
  }

  // ARI
  let sumCombN = 0;
  for (const v of contingency.values()) sumCombN += comb2(v);
  let sumCombA = 0;
  for (const g of goldKeys) sumCombA += comb2(goldMembers.get(g)!.length);
  let sumCombB = 0;
  for (const p of predKeys) sumCombB += comb2(predMembers.get(p)!.length);
  const combTotal = comb2(n);
  const expected = combTotal === 0 ? 0 : (sumCombA * sumCombB) / combTotal;
  const maxIndex = (sumCombA + sumCombB) / 2;
  const ari = maxIndex - expected === 0 ? 1 : (sumCombN - expected) / (maxIndex - expected);

  // Homogeneity / Completeness (entropy)
  const log = (x: number) => (x <= 0 ? 0 : Math.log(x));
  let hC = 0; // H(gold)
  for (const g of goldKeys) {
    const p = goldMembers.get(g)!.length / n;
    hC -= p * log(p);
  }
  let hK = 0; // H(pred)
  for (const p of predKeys) {
    const q = predMembers.get(p)!.length / n;
    hK -= q * log(q);
  }
  let hCgivenK = 0;
  let hKgivenC = 0;
  for (const [key, cnt] of contingency) {
    const [gStr, pStr] = key.split("|");
    const aC = goldMembers.get(Number(gStr))!.length;
    const bK = predMembers.get(pStr)!.length;
    hCgivenK -= (cnt / n) * log(cnt / bK);
    hKgivenC -= (cnt / n) * log(cnt / aC);
  }
  const homogeneity = hC === 0 ? 1 : 1 - hCgivenK / hC;
  const completeness = hK === 0 ? 1 : 1 - hKgivenC / hK;
  const vMeasure =
    homogeneity + completeness === 0 ? 0 : (2 * homogeneity * completeness) / (homogeneity + completeness);

  return {
    events: n,
    goldGroups: goldMembers.size,
    predClusters: predMembers.size,
    bcubedPrecision,
    bcubedRecall,
    bcubedF1,
    pairPrecision,
    pairRecall,
    pairF1,
    pairFalseMergeRate: 1 - pairPrecision,
    pairFalseSplitRate: 1 - pairRecall,
    predClusterImpurityRate,
    eventWeightedImpurity,
    worstClusterSize,
    worstClusterDistinctGold,
    goldClusterFragmentation,
    duplicateAlertRate,
    ari,
    homogeneity,
    completeness,
    vMeasure,
  };
}
