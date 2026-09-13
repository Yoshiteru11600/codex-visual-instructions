import { createOverlay } from "./overlay";
import type { InstallOptions, VisualReviewHandle } from "./types";

export * from "./types";
export { DEFAULT_CONFIG, mergeConfig } from "./core/config";
export { CommandRegistry, commandForEvent, findShortcutConflicts, normalizeShortcut, shortcutFromEvent } from "./core/commands/registry";
export { fingerprintElement, resolveFingerprint } from "./core/fingerprint";
export { HistoryStack } from "./core/history";
export { sanitizeElementMetadata, sanitizeSnapshot } from "./core/sanitize";
export { confirmSession, hasPendingInstructions, markSessionDraft, refreshSessionSummary, summarizeInstructions } from "./core/session";
export { registerVisualReviewTools } from "./webmcp";

/**
 * Installs the review overlay. Nothing runs merely by importing this package.
 * Consumers should call this only behind their own development-mode guard.
 */
export function install(options: InstallOptions = {}): VisualReviewHandle {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("codex-visual-instructions can only be installed in a browser document");
  }
  return createOverlay(options);
}
