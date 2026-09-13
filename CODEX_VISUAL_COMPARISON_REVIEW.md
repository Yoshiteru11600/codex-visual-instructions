# Visual comparison behavior review

## Target

- Repository: `Yoshiteru11600/codex-visual-instructions`
- Branch: `dev`
- Base commit: `76731b6`

## Background

The demo previously opened in side-by-side mode by default. Its Original pane also removed stylesheet links, resource URLs, ordinary links, and CSS `url()` values, so the snapshot appeared as mostly unstyled HTML.

The intended workflow is instead:

1. Open the original application normally with its existing CSS, images, and links intact.
2. Start review mode and edit the live page in place.
3. Show Original, Side-by-side, or Overlay only when the reviewer explicitly selects a comparison mode.

## Changes

### Default presentation

- Changed `review.defaultCompareMode` from `side-by-side` to `edited`.
- The comparison iframe is hidden at startup, leaving the live reviewed page full width.
- Project-level configuration can still select another default mode.

### Original snapshot fidelity

- Preserve stylesheet links.
- Preserve `src`, `srcset`, `poster`, and ordinary `href` attributes.
- Preserve inline styles, style blocks, `url()` values, and CSS imports.
- Preserve the document base URL so relative visual resources resolve as the original page expects.

### Snapshot interaction boundary

The Original snapshot remains non-interactive:

- scripts, iframes, objects, and embeds are removed;
- meta refresh is removed;
- forms are unwrapped;
- inline event handlers and submission-related attributes are removed;
- the comparison iframe ignores pointer events.

This keeps Original as a visual reference rather than a second operable application surface. It intentionally allows the browser to request the original page's stylesheet, image, font, and other presentation resources.

## Tests updated

- Default configuration expects `edited` mode.
- Snapshot sanitization verifies that active behavior is removed while stylesheet, image, link, and CSS resource references remain.

## Manual verification

Using the Vanilla example:

- startup displayed the styled live page at full width;
- switching to Side-by-side displayed styled Edited and Original panes;
- switching back to Edited hid the comparison iframe.

The Vite server needed to be restarted after rebuilding `dist/index.js` because the already-running server retained the previously transformed module.

## Automated verification

- `pnpm typecheck`: passed
- `pnpm lint`: passed
- `pnpm test`: passed, 20 tests
- `pnpm build`: passed
- `pnpm test:e2e`: passed, 11 tests

## Out of scope

- Protocol or `VisualOperation` schema changes
- Source mapping or Git integration
- Send/copy controls
- Keyboard modifier UX and snapping
- Changes to drag or resize lifecycle behavior

## Reviewer focus

1. Is preserving stylesheet and presentation-resource requests acceptable for a local development review tool?
2. Does `pointer-events: none` provide the intended non-interactive Original semantics in all comparison modes?
3. Are any additional navigation-capable attributes missing from the sanitizer boundary?
4. Does changing the default to Edited preserve explicit project configuration behavior?
