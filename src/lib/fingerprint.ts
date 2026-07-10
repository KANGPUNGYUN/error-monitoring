import { createHash } from "node:crypto";

// 규칙 기반 그룹화 엔진 (SPEC 5, 6.4). "스트로맨 금지" — 여러 강도의 baseline 을 둔다.
// 실험 하네스는 이 baseline 들을 AI 엔진과 동일 입력으로 대결시킨다.

export type GroupingInput = {
  exceptionType?: string | null;
  messageNorm?: string | null; // 이미 normalizeMessage 처리됨
  topFrames?: string[] | null; // 이미 extractAppFrames 처리됨
  route: string;
  status: number;
  release?: string | null;
};

export type RuleBaseline = "minimal" | "standard" | "strong";

function sha1(parts: Array<string | number | undefined | null>): string {
  const h = createHash("sha1");
  h.update(parts.map((p) => (p == null ? "" : String(p))).join("|"));
  return h.digest("hex").slice(0, 16);
}

/**
 * baseline 별 fingerprint.
 * - minimal:  route + status                       (약한 baseline, 대조군)
 * - standard: exceptionType + route + status + topFrame1
 * - strong:   exceptionType + messageNorm + topFrames(N) + route + status
 * 기본 런타임 엔진은 실험으로 채택된 것을 쓴다(SPEC 6.7).
 */
export function ruleFingerprint(
  input: GroupingInput,
  baseline: RuleBaseline = "strong",
): string {
  switch (baseline) {
    case "minimal":
      return sha1(["min", input.route, input.status]);
    case "standard":
      return sha1([
        "std",
        input.exceptionType,
        input.route,
        input.status,
        input.topFrames?.[0],
      ]);
    case "strong":
    default:
      return sha1([
        "strong",
        input.exceptionType,
        input.messageNorm,
        ...(input.topFrames ?? []),
        input.route,
        input.status,
      ]);
  }
}

/** 이슈 제목: 사람이 읽을 수 있는 대표 라벨. */
export function issueTitle(input: GroupingInput): string {
  const type = input.exceptionType ?? `HTTP ${input.status}`;
  const where = input.route;
  const msg = input.messageNorm ? `: ${input.messageNorm.slice(0, 80)}` : "";
  return `${type} @ ${where}${msg}`;
}
