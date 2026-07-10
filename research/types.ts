// 실험 하네스 공용 타입 (SPEC 6). 오프라인 — DB/대시보드와 분리.

/** 엔진에 주어지는 에러 레코드 (새니타이즈된 필드만 — 프로덕션과 동일 입력). */
export type ErrorRecord = {
  eventId: number;
  exceptionType: string | null;
  messageNorm: string | null;
  topFrames: string[] | null;
  route: string;
  status: number;
  release: string | null;
};

/** 정답셋 라벨 (docs/labeling-guide.md). groupId=null 이면 uncertain → 평가 제외. */
export type GoldLabel = {
  eventId: number;
  split: "dev" | "test";
  groupId: number | null;
};

/** 코퍼스 1행: 엔진 입력 + gold. */
export type CorpusRow = ErrorRecord & { split: "dev" | "test"; groupId: number | null };

/** 그룹화 결과: eventId -> clusterId (문자열). */
export type Clustering = Map<number, string>;

/** 그룹화 엔진 인터페이스. cluster(records) 는 부수효과 없이 클러스터링만 반환. */
export type Engine = {
  name: string;
  /** dev 셋에서 임계치 등 하이퍼파라미터를 튜닝(선택). test 전에 1회만. */
  fit?: (records: ErrorRecord[], gold: Map<number, number>) => Promise<void> | void;
  cluster: (records: ErrorRecord[]) => Promise<Clustering> | Clustering;
};
