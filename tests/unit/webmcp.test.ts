import { describe, expect, it, vi } from "vitest";
import { registerVisualReviewTools } from "../../src/webmcp";
import { IMPLEMENTATION_INSTRUCTION, type ReviewSession } from "../../src/types";

describe("WebMCP registration", () => {
  it("registers top-level tools with read-only annotations", async () => {
    const definitions: Array<{ name: string; annotations?: { readOnlyHint?: boolean }; execute?: () => unknown }> = [];
    Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool: vi.fn((tool) => definitions.push(tool)) } });
    const session: ReviewSession = { version:1, sessionId:"review-1", route:"/", viewport:{width:1,height:1,devicePixelRatio:1,preset:"desktop"}, createdAt:"now", status:"ready", confirmedAt:"later", summary:{ total:1, pending:1, resolved:0, byOperation:{ move:1 } }, annotations:[], implementationInstruction:IMPLEMENTATION_INSTRUCTION };
    await registerVisualReviewTools(() => session, vi.fn(), vi.fn());
    expect(definitions.map((tool) => tool.name)).toContain("visual_review_get_session");
    expect(definitions.find((tool) => tool.name === "visual_review_get_session")?.annotations?.readOnlyHint).toBe(true);
    const getSession = definitions.find((tool) => tool.name === "visual_review_get_session");
    expect(getSession?.execute?.()).toMatchObject({ status: "ready", confirmedAt: "later", summary: { total: 1, pending: 1, resolved: 0 } });
  });
});
