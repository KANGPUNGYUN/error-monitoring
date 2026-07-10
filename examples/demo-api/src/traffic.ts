// 데모 앱에 트래픽을 흘려 실 에러 코퍼스를 만든다.
// 실행: PORT 로 뜬 demo-api 대상. npm run traffic

const base = process.env.DEMO_URL ?? "http://localhost:4000";
const N = Number(process.env.N ?? 60);

async function hit(path: string, init?: RequestInit) {
  try {
    await fetch(base + path, init);
  } catch {
    /* ignore */
  }
}

async function main() {
  const tasks: Promise<void>[] = [];
  for (let i = 0; i < N; i++) {
    tasks.push(hit(`/api/orders/${1000 + i}`));
    tasks.push(hit(`/api/checkout`));
    tasks.push(hit(`/api/gateway?n=${i}`));
    tasks.push(hit(`/api/report`));
    tasks.push(hit(`/api/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: i % 3 === 0 ? "bad" : "ok@x.com" }) }));
    tasks.push(hit(`/api/ok`));
    tasks.push(hit(`/api/dashboard`)); // 느린 성공 GET (캐싱 후보)
  }
  await Promise.all(tasks);
  console.log(`sent ~${N * 6} requests to ${base}. SDK 가 배치로 인제스트에 전송합니다(2s flush).`);
}

main();
