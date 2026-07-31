"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateAndStore } from "@/lib/summarize";
import { updateIssueStatus, deleteIssue, type IssueStatus } from "@/db/queries";

export async function generateSummaryAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const issueId = String(formData.get("issueId"));
  await generateAndStore(projectId, issueId);
  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
}

const VALID: IssueStatus[] = ["open", "resolved", "ignored"];

/** 이슈 상태 변경(해결/무시/다시 열기). */
export async function setIssueStatusAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const issueId = String(formData.get("issueId"));
  const status = String(formData.get("status")) as IssueStatus;
  if (!VALID.includes(status)) return;
  await updateIssueStatus(projectId, issueId, status);
  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  revalidatePath(`/projects/${projectId}`);
}

/** 이슈 삭제 후 프로젝트 페이지로 이동. */
export async function deleteIssueAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const issueId = String(formData.get("issueId"));
  await deleteIssue(projectId, issueId);
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}
