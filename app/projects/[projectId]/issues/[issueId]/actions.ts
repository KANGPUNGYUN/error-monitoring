"use server";

import { revalidatePath } from "next/cache";
import { generateAndStore } from "@/lib/summarize";

export async function generateSummaryAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const issueId = String(formData.get("issueId"));
  await generateAndStore(projectId, issueId);
  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
}
