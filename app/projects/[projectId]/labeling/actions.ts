"use server";

import { revalidatePath } from "next/cache";
import { buildSample, assignLabel, resetLabeling } from "@/db/labeling";

export async function buildSampleAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const perBucket = Number(formData.get("perBucket") ?? 8);
  await buildSample(projectId, perBucket);
  revalidatePath(`/projects/${projectId}/labeling`);
}

export async function assignLabelAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const eventId = Number(formData.get("eventId"));
  const split = String(formData.get("split"));
  const group = String(formData.get("group"));
  await assignLabel(projectId, eventId, split, group);
  revalidatePath(`/projects/${projectId}/labeling`);
}

export async function resetLabelingAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  await resetLabeling(projectId);
  revalidatePath(`/projects/${projectId}/labeling`);
}
