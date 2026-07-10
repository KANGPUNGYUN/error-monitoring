// 로컬 우선 LLM 클라이언트 (SPEC 7). 기본 Ollama — 데이터가 기계 밖으로 안 나감.
// 미설치/미실행이면 호출부에서 결정적 요약으로 degrade 한다.

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

export async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ollama 텍스트 생성. 실패 시 throw(호출부에서 catch → degrade). */
export async function ollamaGenerate(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { response?: string };
  return (json.response ?? "").trim();
}
