import type { ReviewInstruction, ReviewSession, ReviewSessionSummary } from "../types";

export function summarizeInstructions(annotations: ReviewInstruction[]): ReviewSessionSummary {
  const byOperation: Record<string, number> = {};
  for (const instruction of annotations) {
    const type = instruction.operation.type;
    byOperation[type] = (byOperation[type] ?? 0) + 1;
  }
  return { total: annotations.length, byOperation };
}

export function refreshSessionSummary(session: ReviewSession): void {
  session.summary = summarizeInstructions(session.annotations);
}

export function markSessionDraft(session: ReviewSession): void {
  session.status = "draft";
  delete session.submittedAt;
}

export function submitSession(session: ReviewSession, submittedAt = new Date().toISOString()): boolean {
  refreshSessionSummary(session);
  if (session.annotations.length === 0) return false;
  session.status = "ready";
  session.submittedAt = submittedAt;
  return true;
}
