import { ruleFingerprint, type RuleBaseline } from "../../src/lib/fingerprint";
import type { Engine, Clustering } from "../types";

// 규칙 기반 엔진 (SPEC 5). 결정적 — fit 불필요.
export function ruleEngine(baseline: RuleBaseline): Engine {
  return {
    name: `rule-${baseline}`,
    cluster(records) {
      const m: Clustering = new Map();
      for (const r of records) m.set(r.eventId, ruleFingerprint(r, baseline));
      return m;
    },
  };
}
