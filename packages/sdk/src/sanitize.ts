// 클라이언트 측 새니타이즈 (전송 전). 서버 인제스트에서도 재적용됨(defense in depth).
// 값 마스킹 + 메시지 정규화 + app 프레임 추출.

// 시크릿/PII 규칙 (메시지·프레임 공통 적용).
const SECRET_RULES: Array<{ re: RegExp; to: string }> = [
  { re: /\b(?:bearer\s+)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gi, to: "<JWT>" },
  { re: /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, to: "<APIKEY>" },
  { re: /\bbearer\s+[A-Za-z0-9._-]+/gi, to: "bearer <TOKEN>" },
  { re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, to: "<EMAIL>" },
  { re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, to: "<UUID>" },
  { re: /(?<![\w.])\+?\d[\d ()-]{7,}\d(?![\w.])/g, to: "<PHONE>" },
  { re: /'[^']*'/g, to: "'<VAL>'" },
];

// 긴 파일 경로 마스킹 — 메시지에만 적용(프레임은 basename 을 보존).
const PATH_RULE = { re: /(\/[\w.-]+){3,}/g, to: "<PATH>" };

function maskSecrets(input: string): string {
  let out = input;
  for (const { re, to } of SECRET_RULES) out = out.replace(re, to);
  return out;
}

export function maskValues(input: string): string {
  return maskSecrets(input).replace(PATH_RULE.re, PATH_RULE.to);
}

export function normalizeMessage(message: string): string {
  let out = maskValues(message);
  out = out
    .replace(/\b0x[0-9a-f]+\b/gi, "<HEX>")
    .replace(/\b\d+\b/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
  return out.slice(0, 500);
}

// 스택 프레임의 경로를 basename 으로 축약 (username 등 절대경로 유출 방지 + 파일명 보존).
//   at fn (/Users/x/proj/order.service.ts:42:3) -> at fn (order.service.ts:42:3)
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

/** Error.stack 문자열을 프레임 배열로 파싱.
 *  V8/Node·Chrome: "at fn (file:line:col)"
 *  Firefox/Safari: "fn@file:line:col" → "at fn (file:line:col)" 로 정규화. */
export function parseStack(stack: string | undefined): string[] {
  if (!stack) return [];
  const out: string[] = [];
  for (const raw of stack.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("at ")) {
      out.push(l);
    } else if (l.includes("@") && !l.endsWith("@")) {
      // Firefox/Safari: "name@url:line:col" (name 이 비면 "@url...").
      const at = l.indexOf("@");
      const name = l.slice(0, at) || "<anonymous>";
      const loc = l.slice(at + 1);
      out.push(`at ${name} (${loc})`);
    }
  }
  return out;
}

/** framework/vendor 프레임 제거 + basename 축약 + 시크릿 마스킹 후 top N. */
export function extractAppFrames(frames: string[] | undefined, topN = 5): string[] {
  if (!frames?.length) return [];
  const app = frames.filter((f) => !FRAMEWORK_FRAME_HINTS.some((h) => f.includes(h)));
  return (app.length ? app : frames)
    .slice(0, topN)
    .map((f) => maskSecrets(basenameizeFrame(f)).trim());
}
