// route 정규화 (SPEC 4.1, sdk-interface 6장). 카디널리티 폭발 방지.
// SDK 가 프레임워크 라우팅 메타로 이미 정규화하는 게 이상적이지만,
// 인제스트 측에서도 방어적으로 재정규화한다.

const SEGMENT_RULES: Array<{ re: RegExp; to: string }> = [
  { re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, to: ":id" }, // UUID
  { re: /^\d+$/, to: ":id" }, // 숫자 ID
  { re: /^[0-9a-f]{16,}$/i, to: ":hash" }, // 긴 16진수
  { re: /^[A-Za-z0-9_-]{21,}$/, to: ":token" }, // 긴 토큰형
];

export function normalizeRoute(rawPath: string): string {
  const [pathOnly] = rawPath.split("?");
  const segments = pathOnly.split("/").map((seg) => {
    if (!seg) return seg;
    for (const { re, to } of SEGMENT_RULES) {
      if (re.test(seg)) return to;
    }
    return seg;
  });
  const normalized = segments.join("/");
  return normalized === "" ? "/" : normalized;
}
