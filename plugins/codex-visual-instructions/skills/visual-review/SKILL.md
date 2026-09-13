---
name: visual-review
description: Implement UI changes from a live codex-visual-instructions WebMCP review session. Use when a page exposes visual_review tools or the user asks to apply its visual review; do not use for ordinary UI requests without a review session.
---

# Visual Review

Read the page's session through `visual_review_get_session`. If the full-session tool is unavailable, use `visual_review_list_instructions` and fetch individual items as needed. Keep the session payload local to the user's task.

Browser edits are visual specifications, not source-level implementation instructions.

For each instruction:

1. Locate the corresponding source in the current workspace using the target fingerprint as evidence, not as a guaranteed source mapping.
2. Inspect the existing HTML, CSS, JavaScript, TypeScript, framework, component, and responsive structure.
3. Infer the user's intent from the operation, before/after state, intent category, comment, precision, viewport, and apply scope.
4. Do not copy temporary DOM styles, transforms, dimensions, or pixel offsets literally unless the instruction explicitly requires exact positioning and the project design supports it.
5. Prefer existing layout systems, components, utilities, tokens, and conventions. Preserve responsive behavior unless explicitly changed.
6. Combine compatible instructions when one coherent source change is more appropriate.
7. For high-risk or structural changes, inspect JavaScript references, event handlers, ARIA relationships, forms, framework state, and layout dependencies before editing.
8. Avoid unrelated files. Implement the requested source changes, reload the page, and visually verify the affected viewports.
9. Mark an instruction resolved only after implementation and verification. Do not clear the session unless the user asks.

If a fingerprint resolves ambiguously or to a different element after re-render, stop automatic application for that item and report it as unresolved rather than guessing.
