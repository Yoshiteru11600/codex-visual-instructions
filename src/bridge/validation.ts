import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ReviewSession } from "../types";

export async function validateWorkspace(value: string, checkAccess = access): Promise<string> {
  const workspace = resolve(value);
  let info;
  try { info = await stat(workspace); } catch { throw new Error(`Workspace does not exist: ${workspace}`); }
  if (!info.isDirectory()) throw new Error(`Workspace is not a directory: ${workspace}`);
  try { await checkAccess(workspace, constants.R_OK | constants.W_OK); }
  catch { throw new Error(`Workspace is not writable by the Bridge process: ${workspace}`); }
  return workspace;
}

export function validateReviewSession(value: unknown): ReviewSession {
  if (!value || typeof value !== "object") throw new Error("ReviewSession must be an object");
  const session = value as Partial<ReviewSession>;
  if (session.version !== 1 || typeof session.sessionId !== "string" || session.status !== "ready" || !session.confirmedAt) throw new Error("ReviewSession must be confirmed");
  if (!Array.isArray(session.annotations) || session.annotations.length === 0) throw new Error("ReviewSession has no instructions");
  if (typeof session.route !== "string" || typeof session.createdAt !== "string" || typeof session.implementationInstruction !== "string") throw new Error("Malformed ReviewSession");
  for (const item of session.annotations) {
    if (!item || typeof item.id !== "string" || typeof item.operation?.type !== "string" || typeof item.target?.tagName !== "string") throw new Error("Malformed ReviewSession annotation");
  }
  return value as ReviewSession;
}

export function workerPrompt(session: ReviewSession): string {
  return `You are the Visual Review Worker for Codex Visual Instructions.

Implement the confirmed Visual Review session in the current workspace. Treat browser edits as visual specifications, not literal source-level implementation instructions.

For each unresolved instruction: inspect the current source; identify the corresponding implementation; infer the requested visual intent; make the smallest compatible source change; preserve project conventions and responsive behavior unless explicitly changed; do not blindly reproduce temporary DOM styles or pixel offsets; inspect dependencies before destructive changes; do not modify unrelated code; and run appropriate existing project checks when practical.

If a target cannot be identified with sufficient confidence, do not guess. Explain it in the user-facing response. Return concise progress and completion messages. Do not expose hidden reasoning or chain-of-thought.

Visual Review session:\n${JSON.stringify(session, null, 2)}`;
}
