"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProject, type CreateProjectResult } from "./actions";
import { Card } from "@/ui/components";

type Success = Extract<CreateProjectResult, { ok: true }>;

export function NewProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Success | null>(null);
  const [copied, setCopied] = useState(false);

  const endpoint =
    typeof window !== "undefined" ? `${window.location.origin}/api/v1/events` : "/api/v1/events";

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const res = await createProject(formData);
    setPending(false);
    if (res.ok) {
      setCreated(res);
      router.refresh(); // 목록 즉시 갱신
    } else {
      setError(res.error);
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.ingestKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 미지원 — 무시 */
    }
  }

  function reset() {
    setCreated(null);
    setOpen(false);
    setError(null);
    setCopied(false);
  }

  // ── 생성 성공: 인제스트 키를 한 번만 표시 ──
  if (created) {
    return (
      <Card className="mt-6 border-emerald-300 dark:border-emerald-800">
        <div className="flex items-center justify-between">
          <div className="font-medium text-emerald-700 dark:text-emerald-400">
            &ldquo;{created.projectName}&rdquo; 생성 완료
          </div>
          <button
            onClick={reset}
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            닫기
          </button>
        </div>

        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          아래 <b>인제스트 키</b>는 지금 한 번만 표시됩니다(서버엔 해시만 저장). 안전하게 저장하세요.
        </p>

        <div className="mt-2 text-xs uppercase tracking-wide text-neutral-500">Ingest Key</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-neutral-100 px-2 py-1.5 text-xs dark:bg-neutral-800">
            {created.ingestKey}
          </code>
          <button
            onClick={copyKey}
            className="shrink-0 rounded border border-neutral-300 px-2 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {copied ? "복사됨 ✓" : "복사"}
          </button>
        </div>

        <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">Endpoint</div>
        <code className="mt-1 block overflow-x-auto rounded bg-neutral-100 px-2 py-1.5 text-xs dark:bg-neutral-800">
          {endpoint}
        </code>

        <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">
          연결 예시 (환경변수)
        </div>
        <pre className="mt-1 overflow-x-auto rounded bg-neutral-100 px-2 py-1.5 text-xs leading-relaxed dark:bg-neutral-800">
{`MONITOR_INGEST_KEY="${created.ingestKey}"
MONITOR_ENDPOINT="${endpoint}"`}
        </pre>
      </Card>
    );
  }

  // ── 폼 ──
  return (
    <div className="mt-6">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          + 새 프로젝트
        </button>
      ) : (
        <Card>
          <form action={onSubmit} className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-neutral-500" htmlFor="name">
                프로젝트 이름
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={100}
                autoFocus
                placeholder="예: My Real API"
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <div>
              <label
                className="text-xs uppercase tracking-wide text-neutral-500"
                htmlFor="environment"
              >
                환경
              </label>
              <input
                id="environment"
                name="environment"
                type="text"
                maxLength={40}
                defaultValue="production"
                placeholder="production"
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>

            {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                {pending ? "생성 중…" : "생성"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                취소
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
