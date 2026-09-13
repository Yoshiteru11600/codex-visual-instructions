import { describe, expect, it } from "vitest";
import { HistoryStack } from "../../src/core/history";

describe("HistoryStack", () => {
  it("undoes and redoes visual entries", () => {
    let value = 0; const history = new HistoryStack();
    history.execute({ label: "move", redo: () => { value = 10; }, undo: () => { value = 0; } });
    expect(value).toBe(10); expect(history.undo()).toBe(true); expect(value).toBe(0);
    expect(history.redo()).toBe(true); expect(value).toBe(10);
  });
});
