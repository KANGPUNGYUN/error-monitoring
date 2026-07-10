// 새니타이즈 (SPEC 4.1). SDK 전송 전 + 인제스트 수신 시 양쪽에서 적용(defense in depth).
// 화이트리스트 스키마는 event-schema.ts 가 담당하고, 여기서는 값 마스킹/정규화를 한다.

// 시크릿/PII 규칙 (메시지·프레임 공통).
const SECRET_RULES: Array<{ re: RegExp; to: string }> = [
  { re: /\b(?:bearer\s+)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gi, to: "<JWT>" },
  { re: /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, to: "<APIKEY>" },
  { re: /\bbearer\s+[A-Za-z0-9._-]+/gi, to: "bearer <TOKEN>" },
  { re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, to: "<EMAIL>" },
  { re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, to: "<UUID>" },
  { re: /(?<![\w.])\+?\d[\d ()-]{7,}\d(?![\w.])/g, to: "<PHONE>" },
  { re: /'[^']*'/g, to: "'<VAL>'" },
];

// 긴 파일 경로 마스킹 — 메시지에만 적용(프레임은 basename 보존).
const PATH_RULE = { re: /(\/[\w.-]+){3,}/g, to: "<PATH>" };

function maskSecrets(input: string): string {
  let out = input;
  for (const { re, to } of SECRET_RULES) out = out.replace(re, to);
  return out;
}

/** 문자열에서 민감 값 마스킹(메시지용 — 경로 포함). */
export function maskValues(input: string): string {
  return maskSecrets(input).replace(PATH_RULE.re, PATH_RULE.to);
}

/**
 * 에러 메시지를 그룹화 가능한 템플릿으로 정규화.
 * 값 마스킹 + 숫자/16진수 등 변수를 플레이스홀더로 치환.
 */
export function normalizeMessage(message: string): string {
  let out = maskValues(message);
  out = out
    .replace(/\b0x[0-9a-f]+\b/gi, "<HEX>")
    .replace(/\b\d+\b/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
  return out.slice(0, 500);
}

// 스택 프레임 경로를 basename 으로 축약(절대경로 유출 방지 + 파일명 보존).
function basenameizeFrame(frame: string): string {
  return frame.replace(/[\/\\][^\s():]*[\/\\]([\w.-]+(?::\d+){0,2})/g, "$1");
}

const FRAMEWORK_FRAME_HINTS = [
  "node_modules",
  "/next/",
  "next/dist",
  "internal/",
  "node:internal",
  "webpack-internal",
  "react-dom",
];

/** 스택 프레임에서 framework/vendor 프레임 제거 + basename 축약 + 시크릿 마스킹 후 top N. */
export function extractAppFrames(frames: string[] | undefined, topN = 5): string[] {
  if (!frames?.length) return [];
  const appFrames = frames.filter(
    (f) => !FRAMEWORK_FRAME_HINTS.some((h) => f.includes(h)),
  );
  const chosen = (appFrames.length ? appFrames : frames).slice(0, topN);
  return chosen.map((f) => maskSecrets(basenameizeFrame(f)).trim());
}
