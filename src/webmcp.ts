import type { ReviewSession } from "./types";

interface SiteToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(input: Record<string, unknown>): Promise<unknown> | unknown;
}

interface ModelContext {
  registerTool(definition: SiteToolDefinition): Promise<void> | void;
  unregisterTool?(name: string): Promise<void> | void;
}

declare global {
  interface Document { modelContext?: ModelContext }
}

const TOOL_NAMES = [
  "visual_review_get_session",
  "visual_review_list_instructions",
  "visual_review_get_instruction",
  "visual_review_mark_resolved",
  "visual_review_clear_session",
] as const;

export async function registerVisualReviewTools(
  getSession: () => ReviewSession,
  persist: () => void,
  clear: () => void,
): Promise<() => void> {
  if (window.top !== window || typeof document.modelContext?.registerTool !== "function") return () => undefined;
  const tools: SiteToolDefinition[] = [
    {
      name: TOOL_NAMES[0],
      description: "Get the complete local visual review session and source-implementation guidance.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => getSession(),
    },
    {
      name: TOOL_NAMES[1],
      description: "List all visual review instructions in the current page session.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({ annotations: getSession().annotations }),
    },
    {
      name: TOOL_NAMES[2],
      description: "Get one visual review instruction by its stable instruction id.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: ({ id }) => ({ instruction: getSession().annotations.find((item) => item.id === id) ?? null }),
    },
    {
      name: TOOL_NAMES[3],
      description: "Mark a visual review instruction as resolved after source implementation and browser verification.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      execute: ({ id }) => {
        const item = getSession().annotations.find((annotation) => annotation.id === id);
        if (!item) return { updated: false, reason: "not-found" };
        item.resolved = true;
        persist();
        return { updated: true, instruction: item };
      },
    },
    {
      name: TOOL_NAMES[4],
      description: "Clear the local visual review session and restore previewed page changes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => { clear(); return { cleared: true }; },
    },
  ];
  for (const tool of tools) await document.modelContext.registerTool(tool);
  return () => {
    for (const name of TOOL_NAMES) void document.modelContext?.unregisterTool?.(name);
  };
}
