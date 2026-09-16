export type Locale = "auto" | "en" | "ja" | "fr" | "ru";
export type IntentCategory =
  | "spacing"
  | "alignment"
  | "visual-hierarchy"
  | "responsive"
  | "copy"
  | "visibility"
  | "interaction"
  | "exact-position"
  | "other";
export type Precision = "exact" | "approximate" | "relationship" | "intent-only";
export type ApplyScope =
  | "current-viewport"
  | "current-breakpoint"
  | "all-narrower"
  | "all-wider"
  | "all-viewports";
export type CompareMode = "edited" | "original" | "side-by-side" | "overlay";
export type ViewportPreset = "desktop" | "tablet" | "mobile" | "custom";
export type ReviewSessionStatus = "draft" | "ready";

export interface ReviewSessionSummary {
  total: number;
  pending: number;
  resolved: number;
  /** Counts all instructions, including resolved instructions. */
  byOperation: Record<string, number>;
}

export type CommandId =
  | "review.toggle"
  | "selection.parent"
  | "selection.firstChild"
  | "selection.previousSibling"
  | "selection.nextSibling"
  | "edit.nudgeUp"
  | "edit.nudgeDown"
  | "edit.nudgeLeft"
  | "edit.nudgeRight"
  | "compare.next"
  | "session.submit"
  | "settings.open";

export interface ElementFingerprint {
  cssSelector?: string;
  tagName: string;
  id?: string;
  classes?: string[];
  testId?: string;
  ariaLabel?: string;
  textSnippet?: string;
  domPath?: string;
}

export interface RectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type VisualOperation =
  | { type: "move"; delta: { x: number; y: number }; before: RectSnapshot; after: RectSnapshot }
  | { type: "resize"; before: RectSnapshot; after: RectSnapshot }
  | { type: "replace-text"; before: string; after: string }
  | { type: "hide"; intent: "not-visible" }
  | { type: "remove"; intent: "delete-from-ui-and-source" }
  | { type: "align"; axis: "horizontal" | "vertical"; delta: { x: number; y: number } }
  | { type: "equal-spacing"; axis: "horizontal" | "vertical" };

export interface ReviewInstruction {
  id: string;
  target: ElementFingerprint;
  operation: VisualOperation;
  intent: IntentCategory;
  comment: string;
  precision: Precision;
  tolerance?: number;
  viewport: ViewportInfo;
  applyScope: ApplyScope;
  risk: "low" | "medium" | "high";
  verificationRequired: boolean;
  implementationRequirements: string[];
  resolved: boolean;
  createdAt: string;
}

export interface ViewportInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
  preset: ViewportPreset;
}

export interface ReviewSession {
  version: 1;
  sessionId: string;
  route: string;
  viewport: ViewportInfo;
  createdAt: string;
  status: ReviewSessionStatus;
  confirmedAt?: string;
  summary: ReviewSessionSummary;
  annotations: ReviewInstruction[];
  implementationInstruction: string;
}

export interface ShortcutConfig {
  [commandId: string]: string;
}

export interface VisualReviewConfig {
  version: 1;
  locale: Locale;
  shortcuts: ShortcutConfig;
  review: {
    navigationPolicy: "block-all" | "allow";
    defaultViewport: ViewportPreset;
    defaultCompareMode: CompareMode;
    scrollSync: "ratio" | "none";
  };
  privacy: { telemetry: false };
}

export interface InstallOptions {
  config?: PartialDeep<VisualReviewConfig>;
  startActive?: boolean;
  storageKey?: string;
  /** @deprecated Use the explicit pairing flow instead. */
  workerBridge?: WorkerBridgeConfig;
}

export interface WorkerBridgeConfig {
  endpoint: string;
  capabilityToken: string;
}

export type BridgeReadiness =
  | { status: "ready" }
  | { status: "workspace_invalid" | "cli_unavailable"; message: string };
export type BridgeErrorCode = "invalid_descriptor" | "pairing_expired" | "pairing_already_used" | "origin_mismatch" | "invalid_token" | "bridge_not_ready" | "workspace_invalid" | "cli_unavailable" | "workspace_busy" | "review_session_already_running" | "review_session_invalid" | "task_not_found" | "protocol_error";
export interface BridgeErrorBody { code: BridgeErrorCode; message: string }
export interface BridgePairingDescriptor { version: 1; endpoint: string; pairingToken: string; allowedOrigin: string; workspace: string; expiresAt: string }
export interface BridgePairingPreview { endpoint: string; allowedOrigin: string; workspace: string; expiresAt: string; readiness: BridgeReadiness; activeTask: boolean }
export interface BridgeStatus { workspace: string; readiness: BridgeReadiness; state: "running"; activeTask: boolean; taskStatus?: ReviewTaskStatus }

export type ReviewTaskStatus =
  | "queued" | "accepted" | "inspecting" | "implementing" | "verifying"
  | "completed" | "failed" | "cancelled";

export interface ReviewTaskMessage { itemId: string; text: string }
export interface ReviewTaskError { code: string; message: string }
export interface ReviewTask {
  id: string;
  reviewSessionId: string;
  status: ReviewTaskStatus;
  messages: ReviewTaskMessage[];
  error?: ReviewTaskError;
}

export type ReviewTaskEvent =
  | { type: "snapshot"; task: ReviewTask }
  | { type: "status"; status: ReviewTaskStatus }
  | { type: "agent-message-delta"; itemId: string; delta: string }
  | { type: "error"; error: ReviewTaskError };

export type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? PartialDeep<T[K]> : T[K];
};

export interface VisualReviewHandle {
  readonly session: ReviewSession;
  readonly active: boolean;
  start(): void;
  stop(): void;
  destroy(): void;
  undo(): void;
  redo(): void;
  confirm(): boolean;
  serialize(): string;
  clear(): void;
}

export const IMPLEMENTATION_INSTRUCTION = `The browser edits are visual specifications, not source-level implementation instructions.

For each review instruction:

1. Locate the corresponding source in the current workspace.
2. Inspect the existing HTML/CSS/JavaScript/TypeScript/framework structure.
3. Infer the user's visual intent from the before/after state and attached intent/comment.
4. Do not blindly reproduce temporary DOM styles or pixel offsets.
5. Prefer the project's existing layout system, components, utilities, and conventions.
6. Preserve responsive behavior unless the instruction explicitly changes it.
7. For destructive or structural changes, inspect JavaScript/framework references, event handlers, ARIA relationships, form semantics, and layout dependencies.
8. Implement all compatible instructions together rather than independently when a shared source-level change is more appropriate.
9. Reload the page after implementation and verify the result visually.
10. Do not modify files unrelated to the requested visual changes without a clear reason.`;
