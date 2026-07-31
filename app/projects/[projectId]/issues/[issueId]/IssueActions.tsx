"use client";

import { useState } from "react";
import { setIssueStatusAction, deleteIssueAction } from "./actions";

// 이슈 관리 액션 바: 상태(open/resolved/ignored)에 따라 버튼을 노출한다.
// 삭제는 확인 단계를 거친다(원 telemetry 이벤트는 보존, 이슈 그룹만 삭제).

export function IssueActions({
  projectId,
  issueId,
  status,
}: {
  projectId: string;
  issueId: string;
  status: string;
}) {
  const [confirming, setConfirming] = useState(false);

  const Hidden = () => (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="issueId" value={issueId} />
    </>
  );

  const btn =
    "rounded border px-2.5 py-1 text-xs transition disabled:opacity-50 border-neutral-300 hover:border-neutral-500 dark:border-neutral-700 dark:hover:border-neutral-500";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "resolved" && (
        <form action={setIssueStatusAction}>
          <Hidden />
          <input type="hidden" name="status" value="resolved" />
          <button
            className={`${btn} text-emerald-700 dark:text-emerald-400`}
            title="이 이슈를 해결됨으로 표시"
          >
            ✓ 해결
          </button>
        </form>
      )}

      {status !== "ignored" && (
        <form action={setIssueStatusAction}>
          <Hidden />
          <input type="hidden" name="status" value="ignored" />
          <button className={btn} title="알림/목록에서 낮은 우선순위로">
            무시
          </button>
        </form>
      )}

      {status !== "open" && (
        <form action={setIssueStatusAction}>
          <Hidden />
          <input type="hidden" name="status" value="open" />
          <button className={btn} title="다시 열기">
            다시 열기
          </button>
        </form>
      )}

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className={`${btn} text-red-600 dark:text-red-400`}
          title="이슈 그룹 삭제(이벤트는 보존)"
        >
          삭제
        </button>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-neutral-500">삭제할까요?</span>
          <form action={deleteIssueAction}>
            <Hidden />
            <button className={`${btn} border-red-400 text-red-600 dark:text-red-400`}>
              예, 삭제
            </button>
          </form>
          <button onClick={() => setConfirming(false)} className={btn}>
            취소
          </button>
        </span>
      )}
    </div>
  );
}
