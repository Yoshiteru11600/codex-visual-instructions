import type { ReviewInstruction, ReviewSession, ReviewSessionSummary } from "../types";

export function summarizeInstructions(annotations: ReviewInstruction[]): ReviewSessionSummary {
  const byOperation: Record<string, number> = {};
  let resolved = 0;
  for (const instruction of annotations) {
    if (instruction.resolved) resolved += 1;
    const type = instruction.operation.type;
    byOperation[type] = (byOperation[type] ?? 0) + 1;
  }
  return { total: annotations.length, pending: annotations.length - resolved, resolved, byOperation };
}

export function hasPendingInstructions(session: ReviewSession): boolean {
  return session.annotations.some((instruction) => !instruction.resolved);
}

export function refreshSessionSummary(session: ReviewSession): void {
  session.summary = summarizeInstructions(session.annotations);
}

export function markSessionDraft(session: ReviewSession): void {
  session.status = "draft";
  delete session.confirmedAt;
}

export function confirmSession(session: ReviewSession, confirmedAt = new Date().toISOString()): boolean {
  refreshSessionSummary(session);
  if (!hasPendingInstructions(session)) return false;
  session.status = "ready";
  session.confirmedAt = confirmedAt;
  return true;
}
