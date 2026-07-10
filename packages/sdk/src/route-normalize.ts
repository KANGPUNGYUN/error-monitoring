// route 정규화 — 카디널리티 폭발 방지. 프레임워크 라우트 패턴이 있으면 그걸 우선 쓰고,
// 없으면 세그먼트 규칙으로 치환.

const SEGMENT_RULES: Array<{ re: RegExp; to: string }> = [
  { re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, to: ":id" },
  { re: /^\d+$/, to: ":id" },
  { re: /^[0-9a-f]{16,}$/i, to: ":hash" },
  { re: /^[A-Za-z0-9_-]{21,}$/, to: ":token" },
];

export function normalizeRoute(rawPath: string): string {
  const [pathOnly] = rawPath.split("?");
  const segments = pathOnly.split("/").map((seg) => {
    if (!seg) return seg;
    for (const { re, to } of SEGMENT_RULES) if (re.test(seg)) return to;
    return seg;
  });
  const normalized = segments.join("/");
  return normalized === "" ? "/" : normalized;
}
