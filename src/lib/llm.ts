// 호스팅 AI 요약 클라이언트 (SPEC 7). Anthropic Claude API 사용.
// ANTHROPIC_API_KEY 가 없으면 호출부에서 결정적 요약으로 degrade 한다(키 없이도 앱 동작).

import Anthropic from "@anthropic-ai/sdk";

// 기본은 최상위 Opus. 비용/지연이 중요하면 CLAUDE_MODEL=claude-haiku-4-5 등으로 교체.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic(); // ANTHROPIC_API_KEY 를 환경에서 자동 로드
  return client;
}

/** API 키 존재 여부. 없으면 호출부는 결정적 요약으로 degrade. */
export function claudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Claude 텍스트 생성. 실패 시 throw(호출부에서 catch → degrade). */
export async function claudeGenerate(prompt: string): Promise<string> {
  const c = getClient();
  if (!c) throw new Error("ANTHROPIC_API_KEY 미설정");
  const res = await c.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
