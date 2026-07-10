"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { sendTestAlert } from "@/lib/alerts";

export async function createAlertRuleAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const environmentId = String(formData.get("environmentId") || "");
  const metric = String(formData.get("metric"));
  const threshold = String(formData.get("threshold"));
  const windowMin = Number(formData.get("windowMin") || 5);
  const slackWebhook = String(formData.get("slackWebhook"));
  if (!slackWebhook) return;

  await db.insert(schema.alertRules).values({
    projectId,
    environmentId: environmentId || null,
    metric,
    threshold,
    windowMin,
    slackWebhook,
  });
  revalidatePath(`/projects/${projectId}/alerts`);
}

export async function deleteAlertRuleAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const id = String(formData.get("id"));
  await db
    .delete(schema.alertRules)
    .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.projectId, projectId)));
  revalidatePath(`/projects/${projectId}/alerts`);
}

export async function testAlertAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const id = String(formData.get("id"));
  const rows = await db
    .select()
    .from(schema.alertRules)
    .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.projectId, projectId)))
    .limit(1);
  if (rows[0]) await sendTestAlert(rows[0]);
  revalidatePath(`/projects/${projectId}/alerts`);
}
