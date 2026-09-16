import { CommandRegistry, commandForEvent, findShortcutConflicts } from "./core/commands/registry";
import { mergeConfig } from "./core/config";
import { fingerprintElement, safeTextSummary } from "./core/fingerprint";
import { HistoryStack, type HistoryEntry } from "./core/history";
import { sanitizeSnapshot } from "./core/sanitize";
import { confirmSession, hasPendingInstructions, markSessionDraft, refreshSessionSummary } from "./core/session";
import { SessionStorage } from "./core/storage";
import { getMessages, resolveLocale, type Messages } from "./locales";
import {
  IMPLEMENTATION_INSTRUCTION,
  type ApplyScope,
  type CompareMode,
  type InstallOptions,
  type IntentCategory,
  type Precision,
  type RectSnapshot,
  type ReviewInstruction,
  type ReviewSession,
  type ViewportInfo,
  type ViewportPreset,
  type VisualOperation,
  type VisualReviewHandle,
} from "./types";
import { registerVisualReviewTools } from "./webmcp";
import { ReviewWorkerClient } from "./worker-client";
import { PairingClient, parsePairingDescriptor } from "./pairing-client";
import type { BridgePairingDescriptor, BridgePairingPreview, BridgeStatus, ReviewTask, ReviewTaskEvent } from "./types";

const HOST_ATTRIBUTE = "data-codex-visual-instructions";
const STORAGE_KEY = "codex-visual-instructions:session:v1";
const PREFERENCES_KEY = "codex-visual-instructions:preferences";
const PANEL_MARGIN = 12;
type Theme = "system" | "light" | "dark" | "high-contrast";
type UiStyle = "modern" | "simple";
type UiPreferences = {
  panel?: { x?: number; y?: number; opacity?: number };
  compare?: { mode?: CompareMode; opacity?: number };
  sections?: { viewOpen?: boolean; preferencesOpen?: boolean };
  launcher?: { x?: number; y?: number; visible?: boolean };
  appearance?: { theme?: Theme; style?: UiStyle };
};
const BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "META", "LINK", "HEAD"]);
const REMOVE_REQUIREMENTS = [
  "Inspect JavaScript and framework references before deleting source.",
  "Check event handlers, ARIA relationships, form semantics, and layout dependencies.",
  "Verify the affected flow in the browser after implementation.",
];

const styles = `
  :host { all: initial; color-scheme: dark; pointer-events: none; --vi-bg:23 24 32; --vi-fg:#f5f6fb; --vi-muted:#b6b8c6; --vi-control:#282a36; --vi-control-hover:#353849; --vi-surface:#0f1017; --vi-group:#20222d; --vi-border:#ffffff29; --vi-accent:#6d5dfc; --vi-accent-border:#8d82ff; --vi-focus:#8ed7ff; --vi-danger:#ffb5bf; --vi-danger-border:#ff697d70; --vi-success:#b9f3d9; --vi-radius:14px; --vi-control-radius:7px; --vi-shadow:0 18px 60px #0008; --vi-blur:blur(12px); }
  :host([data-theme="light"]) { color-scheme:light; --vi-bg:250 250 252; --vi-fg:#171820; --vi-muted:#575a69; --vi-control:#fff; --vi-control-hover:#ececf3; --vi-surface:#f0f1f5; --vi-group:#f5f5f9; --vi-border:#20213133; --vi-accent:#5846e8; --vi-accent-border:#6d5dfc; --vi-focus:#005fcc; --vi-danger:#a4152d; --vi-danger-border:#c925425c; --vi-success:#08774f; --vi-shadow:0 18px 50px #24263a35; }
  :host([data-theme="high-contrast"]) { color-scheme:dark; --vi-bg:0 0 0; --vi-fg:#fff; --vi-muted:#fff; --vi-control:#000; --vi-control-hover:#252525; --vi-surface:#000; --vi-group:#000; --vi-border:#fff; --vi-accent:#ffe600; --vi-accent-border:#ffe600; --vi-focus:#00e5ff; --vi-danger:#ff6b6b; --vi-danger-border:#ff6b6b; --vi-success:#6dff9c; --vi-shadow:0 0 0 2px #fff; --vi-blur:none; }
  :host([data-style="simple"]) { --vi-radius:4px; --vi-control-radius:2px; --vi-shadow:0 2px 8px #0004; --vi-blur:none; }
  @media (prefers-color-scheme:light) { :host([data-theme="system"]) { color-scheme:light; --vi-bg:250 250 252; --vi-fg:#171820; --vi-muted:#575a69; --vi-control:#fff; --vi-control-hover:#ececf3; --vi-surface:#f0f1f5; --vi-group:#f5f5f9; --vi-border:#20213133; --vi-accent:#5846e8; --vi-accent-border:#6d5dfc; --vi-focus:#005fcc; --vi-danger:#a4152d; --vi-danger-border:#c925425c; --vi-success:#08774f; --vi-shadow:0 18px 50px #24263a35; } }
  *, *::before, *::after { box-sizing: border-box; }
  .launcher { position: fixed; z-index: 2147483646; right: 16px; bottom: 16px; border: 1px solid var(--vi-accent-border); border-radius: 999px; padding: 10px 15px; background: var(--vi-accent); color: #fff; font: 600 13px/1.2 system-ui,sans-serif; box-shadow: 0 8px 28px #0006; cursor: grab; touch-action:none; user-select:none; pointer-events:auto; }
  .launcher:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid var(--vi-focus); outline-offset: 2px; }
  .panel { --panel-opacity: .95; position: fixed; z-index: 2147483646; right: 12px; top: 12px; width: 330px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow: auto; border: 1px solid var(--vi-border); border-radius: var(--vi-radius); background: rgb(var(--vi-bg) / var(--panel-opacity)); color: var(--vi-fg); font: 13px/1.4 system-ui,sans-serif; box-shadow: var(--vi-shadow); backdrop-filter: var(--vi-blur); pointer-events:auto; }
  .panel[hidden], .compare[hidden], .side-compare[hidden], .guide[hidden], .resize[hidden] { display: none; }
  .head { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid var(--vi-border); position:sticky; top:0; background:rgb(var(--vi-bg) / var(--panel-opacity)); z-index:2; cursor:grab; touch-action:none; user-select:none; }
  .head:active { cursor:grabbing; } .head button { cursor:pointer; }
  .head strong { font-size:14px; } .head small { color:var(--vi-muted); } .head-actions { display:flex; gap:6px; }
  .body { padding: 12px; display:grid; gap:10px; }
  .row { display:flex; gap:7px; align-items:center; flex-wrap:wrap; }
  button, select, input, textarea { border:1px solid var(--vi-border); border-radius:var(--vi-control-radius); background:var(--vi-control); color:var(--vi-fg); font:inherit; }
  button { padding:6px 9px; cursor:pointer; } button:hover { background:var(--vi-control-hover); } button:disabled { opacity:.48; cursor:default; }
  select, input, textarea { padding:6px 8px; min-width:0; } select { flex:1; }
  textarea { width:100%; min-height:58px; resize:vertical; }
  label { color:var(--vi-muted); font-size:11px; display:grid; gap:4px; flex:1; min-width:120px; }
  .field-title { position:relative; display:flex; align-items:center; gap:5px; width:max-content; max-width:100%; }
  .field-help { display:inline-grid; place-items:center; width:18px; height:18px; padding:0; border-radius:50%; font-size:11px; font-weight:750; line-height:1; }
  .field-tooltip { position:absolute; z-index:5; left:calc(100% - 14px); bottom:calc(100% - 4px); width:230px; padding:8px 9px; border:1px solid var(--vi-border); border-radius:var(--vi-control-radius); background:rgb(var(--vi-bg)); color:var(--vi-fg); box-shadow:var(--vi-shadow); font-size:11px; font-weight:400; line-height:1.4; pointer-events:none; opacity:0; visibility:hidden; transform:translateY(5px) scale(.98); transform-origin:bottom left; transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s; }
  .field-tooltip.is-visible { opacity:1; visibility:visible; transform:translateY(0) scale(1); transition-delay:0s; }
  .row > label:last-child .field-tooltip { right:-4px; left:auto; transform-origin:bottom right; }
  .meta { padding:4px 2px 4px 10px; border-left:3px solid var(--vi-accent); color:var(--vi-fg); overflow-wrap:anywhere; }
  .meta strong { display:inline-block; margin-bottom:2px; color:var(--vi-muted); font-size:11px; font-weight:600; }
  .meta code { color:var(--vi-success); font-weight:650; } .hint { color:var(--vi-muted); font-size:11px; }
  .danger { border-color:var(--vi-danger-border); color:var(--vi-danger); }
  .active { background:var(--vi-accent); border-color:var(--vi-accent-border); }
  .handoff { padding:10px; border:1px solid var(--vi-border); border-radius:var(--vi-control-radius); background:var(--vi-group); display:grid; gap:7px; }
  .handoff .primary { width:100%; padding:9px 12px; background:var(--vi-accent); border-color:var(--vi-accent-border); color:#fff; font-weight:650; }
  .handoff .primary:hover { filter:brightness(1.08); } .handoff .primary:disabled { background:var(--vi-control); color:var(--vi-muted); }
  .handoff-status { margin:0; color:var(--vi-success); font-size:12px; } .handoff-summary { color:var(--vi-muted); font-size:11px; }
  .worker { display:grid; gap:7px; padding-top:8px; border-top:1px solid var(--vi-border); }
  .worker h3 { margin:0; font-size:12px; } .worker-status { color:var(--vi-muted); font-size:11px; }
  .worker-messages { display:grid; gap:6px; max-height:180px; overflow:auto; white-space:pre-wrap; }
  .worker-message { margin:0; padding:7px 8px; border-radius:var(--vi-control-radius); background:var(--vi-surface); color:var(--vi-fg); }
  .end-review { width:100%; margin-top:2px; }
  details { border-top:1px solid var(--vi-border); padding-top:8px; } details summary { cursor:pointer; color:var(--vi-fg); font-weight:650; padding:3px 0; }
  details .section-body { display:grid; gap:10px; padding-top:9px; }
  input[type="range"] { width:100%; padding:0; accent-color:var(--vi-accent); }
  .range-value { color:var(--vi-fg); font-variant-numeric:tabular-nums; }
  .hover, .selection { position:fixed; z-index:2147483644; pointer-events:none; border:2px solid #6d5dfc; border-radius:3px; }
  .hover { border-style:dashed; border-color:#45d7b0; }
  .selection::after { content:attr(data-label); position:absolute; left:-2px; top:-20px; padding:2px 5px; color:white; background:#6d5dfc; border-radius:3px 3px 0 0; font:10px/1.4 system-ui,sans-serif; white-space:nowrap; }
  .resize { position:fixed; z-index:2147483647; width:14px; height:14px; border-radius:4px; background:#fff; border:3px solid #6d5dfc; cursor:nwse-resize; touch-action:none; pointer-events:auto; }
  .compare { position:fixed; z-index:2147483643; background:#fff; border:0; box-shadow:0 0 0 1px #0004; pointer-events:none; }
  .compare.original { inset:0; width:100vw; height:100vh; }
  .compare.side-by-side { top:0; right:0; width:50vw; height:100vh; border-left:3px solid #6d5dfc; }
  .compare.overlay { inset:0; width:100vw; height:100vh; opacity:.5; pointer-events:none; }
  .side-compare { position:fixed; inset:0; z-index:2147483643; display:grid; grid-template-columns:1fr 1fr; background:#fff; pointer-events:auto; touch-action:pan-y; }
  .compare-surface { position:relative; overflow:hidden; height:100vh; background:#fff; }
  .compare-surface + .compare-surface { border-left:3px solid var(--vi-accent); }
  .compare-surface iframe { position:absolute; inset:0; width:200%; height:200%; border:0; transform:scale(.5); transform-origin:top left; pointer-events:none; }
  .side-label { position:absolute; z-index:1; top:10px; left:10px; padding:4px 8px; border-radius:999px; background:#111c; color:#fff; font:600 11px/1.3 system-ui,sans-serif; }
  .guide { position:fixed; z-index:2147483642; top:0; left:50%; height:100vh; border:1px dashed #6d5dfc99; background:#6d5dfc0c; pointer-events:none; transform:translateX(-50%); }
  .guide::before { content:attr(data-label); position:absolute; top:8px; left:8px; padding:3px 6px; border-radius:4px; background:#6d5dfc; color:#fff; font:11px system-ui,sans-serif; }
  dialog { max-width:560px; max-height:calc(100vh - 32px); overflow:auto; border:1px solid var(--vi-border); border-radius:var(--vi-radius); background:rgb(var(--vi-bg)); color:var(--vi-fg); padding:18px; font:13px/1.5 system-ui,sans-serif; pointer-events:auto; }
  dialog::backdrop { background:#0009; } dialog .row { justify-content:flex-end; margin-top:14px; }
  .bridge-status { margin:0; color:var(--vi-muted); font-size:12px; } .pairing-summary { display:grid; gap:6px; padding:9px; background:var(--vi-group); overflow-wrap:anywhere; }
  .help-content { display:grid; gap:12px; } .help-content h2 { margin:0; font-size:18px; } .help-content h3 { margin:0 0 3px; font-size:13px; } .help-content p { margin:0; color:var(--vi-muted); }
`;

const id = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const rectOf = (element: Element): RectSnapshot => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

const isSelectable = (element: Element | null, host: HTMLElement): element is HTMLElement => {
  if (!(element instanceof HTMLElement) || element === host || host.contains(element)) return false;
  if (BLOCKED_TAGS.has(element.tagName) || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width > 0;
};

const viewportInfo = (preset: ViewportPreset): ViewportInfo => ({
  width: window.innerWidth,
  height: window.innerHeight,
  devicePixelRatio: window.devicePixelRatio,
  preset,
});

const editableDirectText = (element: HTMLElement): Text | null => {
  const textNodes = [...element.childNodes].filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  );
  return textNodes.length === 1 ? textNodes[0]! : null;
};

export function createOverlay(options: InstallOptions = {}): VisualReviewHandle {
  const existing = document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
  if (existing) throw new Error("codex-visual-instructions is already installed on this page");

  let localPreferences: Parameters<typeof mergeConfig>[0] & UiPreferences = {};
  try { localPreferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "{}"); } catch { /* ignored */ }
  const config = mergeConfig(localPreferences, options.config ?? {});
  let locale = resolveLocale(config.locale);
  let messages = getMessages(locale);
  let active = false;
  let reviewStarted = false;
  let compareMode: CompareMode = localPreferences.compare?.mode ?? config.review.defaultCompareMode;
  let preferredCompareMode: CompareMode = compareMode;
  let compareOpacity = Math.min(1, Math.max(0, localPreferences.compare?.opacity ?? 0.5));
  let panelOpacity = Math.min(1, Math.max(0.6, localPreferences.panel?.opacity ?? 0.95));
  let panelPosition = localPreferences.panel?.x === undefined || localPreferences.panel?.y === undefined
    ? null : { x: localPreferences.panel.x, y: localPreferences.panel.y };
  let launcherPosition = localPreferences.launcher?.x === undefined || localPreferences.launcher?.y === undefined
    ? null : { x: localPreferences.launcher.x, y: localPreferences.launcher.y };
  let launcherVisible = localPreferences.launcher?.visible ?? true;
  let theme: Theme = localPreferences.appearance?.theme ?? "system";
  let uiStyle: UiStyle = localPreferences.appearance?.style ?? "modern";
  let preset: ViewportPreset = config.review.defaultViewport;
  let preferredViewport: ViewportPreset = preset;
  let selected: HTMLElement[] = [];
  let hoverTarget: HTMLElement | null = null;
  let intent: IntentCategory = "other";
  let comment = "";
  let precision: Precision = "approximate";
  let applyScope: ApplyScope = "current-viewport";
  const runtimeDeltas = new Map<HTMLElement, { x: number; y: number }>();
  const transformStates = new Map<HTMLElement, { inline: string; computed: string; hadStyleAttribute: boolean }>();
  const originalSnapshot = sanitizeSnapshot(document.documentElement);
  const history = new HistoryStack();
  const commands = new CommandRegistry();
  const storage = new SessionStorage(options.storageKey ?? STORAGE_KEY);
  const session: ReviewSession = {
    version: 1,
    sessionId: id("review"),
    route: `${location.pathname}${location.search}${location.hash}`,
    viewport: viewportInfo(preset),
    createdAt: new Date().toISOString(),
    status: "draft",
    summary: { total: 0, pending: 0, resolved: 0, byOperation: {} },
    annotations: [],
    implementationInstruction: IMPLEMENTATION_INSTRUCTION,
  };

  const host = document.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "true");
  // Keep the light-DOM host from becoming a page-sized hit target. Interactive
  // Shadow DOM controls opt back into pointer events in the isolated stylesheet.
  host.style.cssText = "position:fixed;inset:0;width:0;height:0;pointer-events:none;z-index:2147483640";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  shadow.append(style);
  const shell = document.createElement("div");
  shell.innerHTML = `
    <button class="launcher" type="button" data-action="toggle"></button>
    <section class="panel" data-i18n-aria="title" hidden>
      <header class="head"><div><strong data-i18n="title"></strong><br><small data-count></small></div><div class="head-actions"><button type="button" data-action="help" data-i18n="help"></button><button type="button" data-action="toggle"></button></div></header>
      <div class="body">
        <div class="row"><button data-action="undo" data-i18n="undo"></button><button data-action="redo" data-i18n="redo"></button><button data-action="clear-selection" data-i18n="clear"></button></div>
        <div class="meta" data-meta></div>
        <div class="row"><button data-action="hide" data-i18n="hide"></button><button class="danger" data-action="remove" data-i18n="remove"></button><button data-action="align" data-i18n="alignLeft"></button><button data-action="spacing" data-i18n="equalSpacing"></button></div>
        <label><span class="field-title"><span data-i18n="editText"></span><button class="field-help" type="button" data-i18n-aria="fieldHelp">?</button><span class="field-tooltip" role="tooltip" data-i18n="textHelp"></span></span><div class="row"><input data-text-input type="text" autocomplete="off"><button data-action="text" data-i18n="applyText"></button></div><small class="hint" data-text-warning></small></label>
        <label><span class="field-title"><span data-i18n="intent"></span><button class="field-help" type="button" data-i18n-aria="fieldHelp">?</button><span class="field-tooltip" role="tooltip" data-i18n="intentHelp"></span></span><select data-intent><option value="spacing" data-i18n="spacingOption"></option><option value="alignment" data-i18n="alignmentOption"></option><option value="visual-hierarchy" data-i18n="visualHierarchyOption"></option><option value="responsive" data-i18n="responsiveOption"></option><option value="copy" data-i18n="copyOption"></option><option value="visibility" data-i18n="visibilityOption"></option><option value="interaction" data-i18n="interactionOption"></option><option value="exact-position" data-i18n="exactPositionOption"></option><option value="other" data-i18n="otherOption" selected></option></select></label>
        <label><span class="field-title"><span data-i18n="comment"></span><button class="field-help" type="button" data-i18n-aria="fieldHelp">?</button><span class="field-tooltip" role="tooltip" data-i18n="commentHelp"></span></span><textarea data-comment maxlength="1000"></textarea></label>
        <div class="row"><label><span class="field-title"><span data-i18n="precision"></span><button class="field-help" type="button" data-i18n-aria="fieldHelp">?</button><span class="field-tooltip" role="tooltip" data-i18n="precisionHelp"></span></span><select data-precision><option value="exact" data-i18n="exactOption"></option><option value="approximate" data-i18n="approximateOption" selected></option><option value="relationship" data-i18n="relationshipOption"></option><option value="intent-only" data-i18n="intentOnlyOption"></option></select></label><label><span class="field-title"><span data-i18n="scope"></span><button class="field-help" type="button" data-i18n-aria="fieldHelp">?</button><span class="field-tooltip" role="tooltip" data-i18n="scopeHelp"></span></span><select data-scope><option value="current-viewport" data-i18n="currentViewportOption"></option><option value="current-breakpoint" data-i18n="currentBreakpointOption"></option><option value="all-narrower" data-i18n="allNarrowerOption"></option><option value="all-wider" data-i18n="allWiderOption"></option><option value="all-viewports" data-i18n="allViewportsOption"></option></select></label></div>
        <div class="handoff"><div class="handoff-summary" data-handoff-summary></div><p class="handoff-status" data-handoff-status hidden></p><button class="primary" type="button" data-action="handoff"></button><div class="worker" data-worker><button type="button" class="bridge-status" data-bridge-status data-action="pairing-settings" aria-live="polite"></button><button class="primary" type="button" data-action="worker-request" data-i18n="askCodex"></button><div data-worker-result hidden><h3 data-i18n="codex"></h3><span class="worker-status" data-worker-status></span><div class="worker-messages" data-worker-messages aria-live="polite"></div><div class="row"><button type="button" data-action="worker-cancel" data-i18n="cancel"></button><button type="button" data-action="worker-retry" data-i18n="retry"></button></div></div></div></div>
        <details data-section="view"><summary data-i18n="view"></summary><div class="section-body">
          <div class="row"><label><span data-i18n="compare"></span><select data-compare><option value="edited" data-i18n="editedOption"></option><option value="original" data-i18n="originalOption"></option><option value="side-by-side" data-i18n="sideBySideOption"></option><option value="overlay" data-i18n="overlayOption"></option></select></label><label><span data-i18n="viewport"></span><select data-viewport><option value="desktop" data-i18n="desktopOption"></option><option value="tablet" data-i18n="tabletOption"></option><option value="mobile" data-i18n="mobileOption"></option><option value="custom" data-i18n="customOption"></option></select></label></div>
          <label><span><span data-i18n="overlayOpacity"></span>: <output class="range-value" data-compare-opacity-value></output></span><input data-compare-opacity type="range" min="0" max="100" step="1" data-i18n-aria="overlayOpacity"></label>
        </div></details>
        <details data-section="preferences"><summary data-i18n="preferences"></summary><div class="section-body">
          <div class="row"><label><span data-i18n="language"></span><select data-locale><option value="auto" data-i18n="autoOption"></option><option value="en">English</option><option value="ja">日本語</option><option value="fr">Français</option><option value="ru">Русский</option></select></label></div>
          <label><span><span data-i18n="panelOpacity"></span>: <output class="range-value" data-panel-opacity-value></output></span><input data-panel-opacity type="range" min="60" max="100" step="1" data-i18n-aria="panelOpacity"></label>
          <div class="row"><label><span data-i18n="theme"></span><select data-theme><option value="system" data-i18n="systemTheme"></option><option value="light" data-i18n="lightTheme"></option><option value="dark" data-i18n="darkTheme"></option><option value="high-contrast" data-i18n="highContrastTheme"></option></select></label><label><span data-i18n="style"></span><select data-style><option value="modern" data-i18n="modernStyle"></option><option value="simple" data-i18n="simpleStyle"></option></select></label></div>
          <label class="row"><input data-launcher-visible type="checkbox"><span data-i18n="showLauncher"></span></label>
          <label><span data-i18n="toggleShortcut"></span><div class="row"><input data-shortcut-input><button data-action="save-shortcut" data-i18n="save"></button></div><small class="hint" data-shortcut-warning></small></label>
          <button type="button" data-action="reset-panel" data-i18n="resetPanelPosition"></button>
          <button type="button" data-action="reset-launcher" data-i18n="resetLauncherPosition"></button>
          <p class="hint" data-i18n="shortcutHint"></p>
        </div></details>
        <button class="danger end-review" type="button" data-action="end-review" data-i18n="endReview"></button>
      </div>
    </section>
    <div class="hover" hidden></div><div data-selections></div><div class="resize" role="slider" data-i18n-aria="resizeLabel" hidden></div>
    <iframe class="compare" data-i18n-title="originalSnapshotTitle" sandbox="allow-same-origin" hidden></iframe>
    <div class="side-compare" hidden><div class="compare-surface"><span class="side-label" data-i18n="editedSurface"></span><iframe data-side-edited sandbox="allow-same-origin"></iframe></div><div class="compare-surface"><span class="side-label" data-i18n="originalSurface"></span><iframe data-side-original sandbox="allow-same-origin"></iframe></div></div>
    <div class="guide" hidden></div>
    <dialog data-remove-dialog><p data-warning></p><div class="row"><button data-action="cancel-remove" data-i18n="cancel"></button><button class="danger" data-action="confirm-remove" data-i18n="removePreview"></button></div></dialog>
    <dialog data-end-dialog aria-labelledby="visual-end-dialog-title"><h2 id="visual-end-dialog-title" data-i18n="endReview"></h2><p data-end-warning></p><div class="row"><button data-action="cancel-end" data-i18n="back"></button><button data-action="cancel-worker-end" data-i18n="cancelWorker"></button><button data-action="confirm-end" data-i18n="confirmInstructions"></button><button class="danger" data-action="discard-end" data-i18n="discardAndEnd"></button></div></dialog>
    <dialog data-help-dialog><div class="help-content"><h2 data-i18n="helpTitle"></h2><section><h3 data-i18n="helpFlowTitle"></h3><p data-i18n="helpFlow"></p></section><section><h3 data-i18n="helpEditingTitle"></h3><p data-i18n="helpEditing"></p></section><section><h3 data-i18n="helpKeyboardTitle"></h3><p data-i18n="helpKeyboard"></p></section><section><h3 data-i18n="helpCompareTitle"></h3><p data-i18n="helpCompare"></p></section><section><h3 data-i18n="helpPrecisionTitle"></h3><p data-i18n="helpPrecision"></p></section><section><h3 data-i18n="helpScopeTitle"></h3><p data-i18n="helpScope"></p></section><section><h3 data-i18n="helpHandoffTitle"></h3><p data-i18n="helpHandoff"></p></section></div><div class="row"><button data-action="close-help" data-i18n="closeHelp"></button></div></dialog>
    <dialog data-pairing-dialog><h2 data-i18n="pairingTitle"></h2><p data-i18n="pairingHelp"></p><textarea data-pairing-input autocomplete="off" spellcheck="false"></textarea><p class="hint" data-pairing-error aria-live="polite"></p><div class="pairing-summary" data-pairing-summary hidden></div><div class="row"><button data-action="close-pairing" data-i18n="back"></button><button data-action="check-pairing" data-i18n="checkConnection"></button><button data-action="approve-pairing" data-i18n="approveConnection" hidden></button></div></dialog>
  `;
  shadow.append(shell);
  document.documentElement.append(host);

  const $ = <T extends Element>(selector: string): T => shadow.querySelector<T>(selector)!;
  const launcher = $(".launcher") as HTMLButtonElement;
  const panel = $(".panel") as HTMLElement;
  const hoverBox = $(".hover") as HTMLElement;
  const selectionLayer = $("[data-selections]") as HTMLElement;
  const resizeHandle = $(".resize") as HTMLElement;
  const compareFrame = $(".compare") as HTMLIFrameElement;
  const sideCompare = $(".side-compare") as HTMLElement;
  const editedSideFrame = $("[data-side-edited]") as HTMLIFrameElement;
  const originalSideFrame = $("[data-side-original]") as HTMLIFrameElement;
  const guide = $(".guide") as HTMLElement;
  const dialog = $("[data-remove-dialog]") as HTMLDialogElement;
  const endDialog = $("[data-end-dialog]") as HTMLDialogElement;
  const endReviewButton = $("[data-action=end-review]") as HTMLButtonElement;
  const cancelEndButton = $("[data-action=cancel-end]") as HTMLButtonElement;
  const cancelWorkerEndButton = $("[data-action=cancel-worker-end]") as HTMLButtonElement;
  const confirmEndButton = $("[data-action=confirm-end]") as HTMLButtonElement;
  const discardEndButton = $("[data-action=discard-end]") as HTMLButtonElement;
  const helpDialog = $("[data-help-dialog]") as HTMLDialogElement;
  const pairingDialog = $("[data-pairing-dialog]") as HTMLDialogElement;
  const pairingInput = $("[data-pairing-input]") as HTMLTextAreaElement;
  const pairingError = $("[data-pairing-error]") as HTMLElement;
  const pairingSummary = $("[data-pairing-summary]") as HTMLElement;
  const pairingApproveButton = $("[data-action=approve-pairing]") as HTMLButtonElement;
  const bridgeStatusText = $("[data-bridge-status]") as HTMLElement;
  const meta = $("[data-meta]") as HTMLElement;
  const textInput = $("[data-text-input]") as HTMLInputElement;
  const shortcutInput = $("[data-shortcut-input]") as HTMLInputElement;
  const textButton = shadow.querySelector<HTMLButtonElement>("[data-action=text]")!;
  const textWarning = $("[data-text-warning]") as HTMLElement;
  const handoffButton = shadow.querySelector<HTMLButtonElement>("[data-action=handoff]")!;
  const workerContainer = $("[data-worker]") as HTMLElement;
  const workerRequestButton = $("[data-action=worker-request]") as HTMLButtonElement;
  const workerResult = $("[data-worker-result]") as HTMLElement;
  const workerStatus = $("[data-worker-status]") as HTMLElement;
  const workerMessages = $("[data-worker-messages]") as HTMLElement;
  const workerCancelButton = $("[data-action=worker-cancel]") as HTMLButtonElement;
  const workerRetryButton = $("[data-action=worker-retry]") as HTMLButtonElement;
  const viewSection = $("[data-section=view]") as HTMLDetailsElement;
  const preferencesSection = $("[data-section=preferences]") as HTMLDetailsElement;
  const panelOpacityInput = $("[data-panel-opacity]") as HTMLInputElement;
  const compareOpacityInput = $("[data-compare-opacity]") as HTMLInputElement;
  const launcherVisibleInput = $("[data-launcher-visible]") as HTMLInputElement;
  const themeInput = $("[data-theme]") as HTMLSelectElement;
  const styleInput = $("[data-style]") as HTMLSelectElement;

  compareFrame.srcdoc = originalSnapshot;
  originalSideFrame.srcdoc = originalSnapshot;
  shortcutInput.value = config.shortcuts["review.toggle"] ?? "Alt+Shift+R";
  viewSection.open = localPreferences.sections?.viewOpen ?? false;
  preferencesSection.open = localPreferences.sections?.preferencesOpen ?? false;
  let workerClient = options.workerBridge ? new ReviewWorkerClient(options.workerBridge) : null;
  let bridgeStatus: BridgeStatus | null = null;
  let pairingDescriptor: BridgePairingDescriptor | null = null;
  let pairingPreview: BridgePairingPreview | null = null;
  let pairingBusy = false;
  let pendingWorkerStart = false;
  let workerTask: ReviewTask | null = null;
  let workerStarting = false;
  let workerStream: AbortController | null = null;
  const runningWorkerStatuses = new Set(["queued", "accepted", "inspecting", "implementing", "verifying"]);

  const fieldHelpButtons = [...shadow.querySelectorAll<HTMLButtonElement>(".field-help")];
  const closeFieldHelp = (except?: HTMLButtonElement): void => {
    for (const button of fieldHelpButtons) {
      if (button === except) continue;
      const tooltip = button.nextElementSibling as HTMLElement;
      tooltip.classList.remove("is-visible");
      button.setAttribute("aria-expanded", "false");
    }
  };
  fieldHelpButtons.forEach((button, index) => {
    const tooltip = button.nextElementSibling as HTMLElement;
    tooltip.id = `visual-field-help-${index + 1}`;
    button.setAttribute("aria-controls", tooltip.id);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const willOpen = !tooltip.classList.contains("is-visible");
      closeFieldHelp(willOpen ? button : undefined);
      tooltip.classList.toggle("is-visible", willOpen);
      button.setAttribute("aria-expanded", String(willOpen));
    });
  });

  const persist = (): void => { session.viewport = viewportInfo(preset); refreshSessionSummary(session); storage.save(session); render(); };
  const persistSpecificationChange = (): void => { markSessionDraft(session); persist(); };
  const confirmHandoff = (): boolean => {
    if (!confirmSession(session)) { render(); return false; }
    persist();
    return true;
  };
  const toggleHandoff = (): void => {
    if (workerTask && runningWorkerStatuses.has(workerTask.status)) return;
    if (session.status === "ready") { markSessionDraft(session); persist(); }
    else confirmHandoff();
  };
  const applyWorkerEvent = (event: ReviewTaskEvent): void => {
    if (!workerTask) return;
    if (event.type === "snapshot") workerTask = event.task;
    else if (event.type === "status") {
      workerTask.status = event.status;
      if (!runningWorkerStatuses.has(event.status) && workerTask.error?.code === "cancel_failed") delete workerTask.error;
    }
    else if (event.type === "agent-message-delta") {
      let message = workerTask.messages.find((entry) => entry.itemId === event.itemId);
      if (!message) { message = { itemId: event.itemId, text: "" }; workerTask.messages.push(message); }
      message.text += event.delta;
    } else { workerTask.error = event.error; workerTask.status = "failed"; }
    render();
  };
  const clearPairingSecret = (): void => { pairingInput.value = ""; pairingDescriptor = null; pairingPreview = null; pairingSummary.hidden = true; pairingSummary.replaceChildren(); pairingApproveButton.hidden = true; };
  const openPairing = (startAfterApproval: boolean): void => { pendingWorkerStart = startAfterApproval; pairingError.textContent = ""; clearPairingSecret(); pairingDialog.showModal(); pairingInput.focus(); render(); };
  const checkPairing = async (): Promise<void> => {
    if (pairingBusy) return; pairingBusy = true; pairingError.textContent = ""; pairingApproveButton.hidden = true;
    try {
      pairingDescriptor = parsePairingDescriptor(pairingInput.value);
      pairingPreview = await new PairingClient(pairingDescriptor).preview();
      pairingSummary.replaceChildren(...[
        `${messages.currentOrigin}: ${location.origin}`, `${messages.localBridge}: ${pairingPreview.endpoint}`, `${messages.targetWorkspace}: ${pairingPreview.workspace}`,
      ].map((text) => { const item = document.createElement("div"); item.textContent = text; return item; }));
      pairingSummary.hidden = false; pairingApproveButton.hidden = pairingPreview.readiness.status !== "ready";
      if (pairingPreview.readiness.status !== "ready") pairingError.textContent = pairingPreview.readiness.message;
    } catch (error) { pairingError.textContent = error instanceof Error ? error.message : String(error); pairingDescriptor = null; pairingPreview = null; }
    finally { pairingBusy = false; render(); }
  };
  const approvePairing = async (): Promise<void> => {
    if (pairingBusy || !pairingDescriptor || !pairingPreview) return; pairingBusy = true; pairingError.textContent = "";
    try {
      const approved = await new PairingClient(pairingDescriptor).approve(); workerClient = new ReviewWorkerClient(approved.connection); bridgeStatus = approved.status;
      const shouldStart = pendingWorkerStart && session.status === "ready" && hasPendingInstructions(session); pendingWorkerStart = false; clearPairingSecret(); pairingDialog.close(); render();
      if (shouldStart) await startWorkerTask();
    } catch (error) { pairingError.textContent = error instanceof Error ? error.message : String(error); }
    finally { pairingBusy = false; render(); }
  };
  const startWorkerTask = async (): Promise<void> => {
    if (session.status !== "ready" || !hasPendingInstructions(session)) return;
    if (workerTask && runningWorkerStatuses.has(workerTask.status)) return;
    if (!workerClient) { openPairing(true); return; }
    workerStarting = true; render();
    workerStream?.abort(); workerStream = new AbortController();
    try {
      bridgeStatus = await workerClient.status();
      workerTask = await workerClient.createTask(session); render();
      await workerClient.stream(workerTask.id, applyWorkerEvent, workerStream.signal);
    } catch (error) {
      if (workerStream.signal.aborted) return;
      workerTask = workerTask ?? { id: "local", reviewSessionId: session.sessionId, status: "failed", messages: [] };
      workerTask.status = "failed"; workerTask.error = { code: "bridge_error", message: error instanceof Error ? error.message : String(error) }; render();
    } finally { workerStarting = false; render(); }
  };
  const cancelWorkerTask = async (): Promise<void> => {
    if (!workerClient || !workerTask || !runningWorkerStatuses.has(workerTask.status)) return;
    try {
      workerTask = await workerClient.cancel(workerTask.id);
      if (workerTask.status === "cancelled") workerStream?.abort();
    } catch (error) {
      workerTask.error = { code: "cancel_failed", message: `${messages.cancelFailed} ${error instanceof Error ? error.message : String(error)}` };
    }
    render();
  };
  const saveLocalPreference = (patch: Record<string, unknown>): void => {
    try {
      const current = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "{}");
      for (const key of ["panel", "compare", "sections", "review", "shortcuts", "launcher", "appearance"]) {
        if (typeof patch[key] === "object" && patch[key] !== null) patch[key] = { ...(current[key] ?? {}), ...(patch[key] as object) };
      }
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...current, ...patch }));
    } catch { /* storage may be disabled */ }
  };

  const renderTranslations = (): void => {
    shadow.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n as keyof Messages;
      element.textContent = messages[key];
    });
    shadow.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((element) => {
      element.setAttribute("aria-label", messages[element.dataset.i18nAria as keyof Messages]);
    });
    shadow.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", messages[element.dataset.i18nTitle as keyof Messages]);
    });
    launcher.textContent = active ? messages.minimize : (reviewStarted ? messages.resume : messages.start);
    shadow.querySelectorAll<HTMLButtonElement>("[data-action=toggle]").forEach((button) => { button.textContent = active ? messages.minimize : (reviewStarted ? messages.resume : messages.start); });
    $("[data-warning]").textContent = messages.removeWarning;
  };

  const clampPanelPosition = (position: { x: number; y: number }): { x: number; y: number } => {
    const rect = panel.getBoundingClientRect();
    const maxX = Math.max(PANEL_MARGIN, window.innerWidth - rect.width - PANEL_MARGIN);
    const maxY = Math.max(PANEL_MARGIN, window.innerHeight - Math.min(rect.height, window.innerHeight - PANEL_MARGIN * 2) - PANEL_MARGIN);
    return { x: Math.min(maxX, Math.max(PANEL_MARGIN, position.x)), y: Math.min(maxY, Math.max(PANEL_MARGIN, position.y)) };
  };
  const applyPanelPosition = (): void => {
    panel.style.setProperty("--panel-opacity", String(panelOpacity));
    if (!panelPosition || panel.hidden) return;
    panelPosition = clampPanelPosition(panelPosition);
    panel.style.left = `${panelPosition.x}px`;
    panel.style.top = `${panelPosition.y}px`;
    panel.style.right = "auto";
  };
  const resetPanelPosition = (): void => {
    panelPosition = null;
    panel.style.left = "auto";
    panel.style.top = `${PANEL_MARGIN}px`;
    panel.style.right = `${PANEL_MARGIN}px`;
    saveLocalPreference({ panel: { x: undefined, y: undefined, opacity: panelOpacity } });
  };
  const clampLauncherPosition = (position: { x: number; y: number }): { x: number; y: number } => {
    const rect = launcher.getBoundingClientRect();
    return {
      x: Math.min(Math.max(PANEL_MARGIN, window.innerWidth - rect.width - PANEL_MARGIN), Math.max(PANEL_MARGIN, position.x)),
      y: Math.min(Math.max(PANEL_MARGIN, window.innerHeight - rect.height - PANEL_MARGIN), Math.max(PANEL_MARGIN, position.y)),
    };
  };
  const applyLauncherPosition = (): void => {
    if (!launcherPosition || launcher.hidden) return;
    launcherPosition = clampLauncherPosition(launcherPosition);
    launcher.style.left = `${launcherPosition.x}px`;
    launcher.style.top = `${launcherPosition.y}px`;
    launcher.style.right = "auto";
    launcher.style.bottom = "auto";
  };
  const resetLauncherPosition = (): void => {
    launcherPosition = null;
    launcher.style.left = "auto"; launcher.style.top = "auto";
    launcher.style.right = "16px"; launcher.style.bottom = "16px";
    saveLocalPreference({ launcher: { x: undefined, y: undefined, visible: launcherVisible } });
  };
  const applyAppearance = (): void => {
    host.dataset.theme = theme;
    host.dataset.style = uiStyle;
    themeInput.value = theme;
    styleInput.value = uiStyle;
  };

  const updateBoxes = (): void => {
    if (hoverTarget && active) {
      const rect = hoverTarget.getBoundingClientRect();
      Object.assign(hoverBox.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      hoverBox.hidden = false;
    } else hoverBox.hidden = true;
    selectionLayer.replaceChildren();
    if (active) selected.forEach((element, index) => {
      if (!element.isConnected) return;
      const rect = element.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "selection";
      box.dataset.label = `${index + 1}: ${element.tagName.toLowerCase()}`;
      Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      selectionLayer.append(box);
    });
    const primary = selected.at(-1);
    if (primary?.isConnected && active) {
      const rect = primary.getBoundingClientRect();
      Object.assign(resizeHandle.style, { left: `${rect.right - 7}px`, top: `${rect.bottom - 7}px` });
      resizeHandle.hidden = false;
    } else resizeHandle.hidden = true;
  };

  const render = (): void => {
    renderTranslations();
    applyAppearance();
    panel.hidden = !active;
    launcher.hidden = active || !launcherVisible;
    launcherVisibleInput.checked = launcherVisible;
    applyLauncherPosition();
    applyPanelPosition();
    panelOpacityInput.value = String(Math.round(panelOpacity * 100));
    compareOpacityInput.value = String(Math.round(compareOpacity * 100));
    $("[data-panel-opacity-value]").textContent = `${panelOpacityInput.value}%`;
    $("[data-compare-opacity-value]").textContent = `${compareOpacityInput.value}%`;
    compareOpacityInput.disabled = compareMode !== "overlay";
    if (preset !== "desktop") {
      const widths: Record<ViewportPreset, number> = { desktop: window.innerWidth, tablet: 768, mobile: 390, custom: Math.max(320, Math.round(window.innerWidth * 0.72)) };
      guide.dataset.label = `${messages[`${preset}Option` as keyof Messages]} · ${widths[preset]}px (${messages.layoutGuide})`;
    }
    $("[data-count]").textContent = `${session.annotations.length} ${messages.sessionCount}`;
    $("[data-end-warning]").textContent = messages.unconfirmedInstructions.replace("{count}", String(session.summary.pending));
    const operationLabels: Record<string, keyof Messages> = {
      move: "operationMove", resize: "operationResize", "replace-text": "operationReplaceText",
      hide: "operationHide", remove: "operationRemove", align: "operationAlign", "equal-spacing": "operationEqualSpacing",
    };
    const operationSummary = Object.entries(session.summary.byOperation).map(([type, count]) => `${messages[operationLabels[type] ?? "otherOption"]}: ${count}`).join(" · ");
    $("[data-handoff-summary]").textContent = `${messages.pending}: ${session.summary.pending} · ${messages.resolved}: ${session.summary.resolved}${operationSummary ? ` · ${operationSummary}` : ""}`;
    const handoffStatus = $("[data-handoff-status]") as HTMLElement;
    handoffStatus.hidden = session.status !== "ready";
    const allResolved = session.summary.total > 0 && session.summary.pending === 0;
    handoffStatus.textContent = session.status === "ready" ? (allResolved ? messages.allResolved : messages.handoffReady) : "";
    handoffButton.textContent = session.status === "ready" ? messages.editInstructions : messages.requestChanges;
    const workerRunning = workerStarting || Boolean(workerTask && runningWorkerStatuses.has(workerTask.status));
    handoffButton.disabled = !hasPendingInstructions(session) || workerRunning;
    workerContainer.hidden = false;
    bridgeStatusText.textContent = workerClient ? `${messages.bridgeConnected} — ${bridgeStatus?.workspace.split(/[\\/]/).pop() ?? "Codex"}` : messages.bridgeDisconnected;
    workerRequestButton.disabled = session.status !== "ready" || !hasPendingInstructions(session) || workerRunning;
    workerResult.hidden = !workerTask;
    if (workerTask) {
      const statusKey = workerTask.status === "completed" ? "completed" : workerTask.status === "failed" ? "failed" : workerTask.status === "cancelled" ? "cancelled" : workerTask.status === "queued" ? "waiting" : "working";
      workerStatus.textContent = messages[statusKey];
      workerMessages.replaceChildren(...workerTask.messages.map((message) => { const paragraph = document.createElement("p"); paragraph.className = "worker-message"; paragraph.textContent = message.text; return paragraph; }));
      if (workerTask.error) { const paragraph = document.createElement("p"); paragraph.className = "worker-message"; paragraph.textContent = workerTask.error.message; workerMessages.append(paragraph); }
      workerCancelButton.hidden = !workerRunning; workerRetryButton.hidden = workerTask.status !== "failed" && workerTask.status !== "cancelled";
    }
    cancelWorkerEndButton.hidden = !workerRunning;
    confirmEndButton.hidden = workerRunning;
    discardEndButton.hidden = workerRunning;
    const primary = selected.at(-1);
    meta.replaceChildren();
    if (primary) {
      const heading = document.createElement("strong");
      heading.textContent = messages.selected;
      const code = document.createElement("code");
      code.textContent = `<${primary.tagName.toLowerCase()}${primary.id ? `#${primary.id}` : ""}>`;
      meta.append(heading, document.createElement("br"), code);
      const summary = safeTextSummary(primary);
      if (summary) meta.append(document.createElement("br"), document.createTextNode(summary));
      if (primary instanceof HTMLAnchorElement) meta.append(document.createElement("br"), document.createTextNode(`${messages.target}: ${primary.getAttribute("href") ?? ""}`));
    } else meta.textContent = messages.noSelection;
    const editableText = primary ? editableDirectText(primary) : null;
    textInput.value = editableText?.data ?? "";
    textInput.disabled = !editableText;
    textButton.disabled = !editableText;
    textWarning.textContent = primary && !editableText ? messages.textWarning : "";
    shadow.querySelector<HTMLButtonElement>("[data-action=undo]")!.disabled = !history.canUndo;
    shadow.querySelector<HTMLButtonElement>("[data-action=redo]")!.disabled = !history.canRedo;
    shadow.querySelector<HTMLButtonElement>("[data-action=clear-selection]")!.disabled = selected.length === 0;
    shadow.querySelector<HTMLButtonElement>("[data-action=align]")!.disabled = selected.length < 2;
    shadow.querySelector<HTMLButtonElement>("[data-action=spacing]")!.disabled = selected.length < 3;
    updateBoxes();
  };

  const applyPreviewTransform = (element: HTMLElement, value: { x: number; y: number }): void => {
    let state = transformStates.get(element);
    if (!state) {
      state = { inline: element.style.transform, computed: getComputedStyle(element).transform, hadStyleAttribute: element.hasAttribute("style") };
      transformStates.set(element, state);
    }
    if (value.x === 0 && value.y === 0) {
      element.style.transform = state.inline;
      if (!state.hadStyleAttribute && element.getAttribute("style") === "") element.removeAttribute("style");
      runtimeDeltas.delete(element);
    } else {
      const base = state.computed === "none" ? "" : ` ${state.computed}`;
      element.style.transform = `translate(${value.x}px, ${value.y}px)${base}`;
      runtimeDeltas.set(element, value);
    }
    updateBoxes();
  };

  const restorePreviewTransforms = (): void => {
    for (const [element, state] of transformStates) {
      element.style.transform = state.inline;
      if (!state.hadStyleAttribute && element.getAttribute("style") === "") element.removeAttribute("style");
    }
    transformStates.clear();
    runtimeDeltas.clear();
  };

  const newInstruction = (target: HTMLElement, operation: VisualOperation): ReviewInstruction => {
    const risk = operation.type === "remove" ? "high" : operation.type === "hide" ? "medium" : "low";
    return {
      id: id("instruction"), target: fingerprintElement(target), operation, intent, comment, precision,
      ...(precision === "approximate" ? { tolerance: 4 } : {}),
      viewport: viewportInfo(preset), applyScope, risk, verificationRequired: risk === "high",
      implementationRequirements: risk === "high" ? REMOVE_REQUIREMENTS : ["Implement the visual intent using the project's existing layout and component conventions.", "Reload and verify the result in the browser."],
      resolved: false, createdAt: new Date().toISOString(),
    };
  };

  const executeVisual = (entry: Omit<HistoryEntry, "redo" | "undo"> & { instruction: ReviewInstruction; apply: () => void; revert: () => void }): void => {
    const full: HistoryEntry = {
      label: entry.label,
      redo: () => { entry.apply(); if (!session.annotations.some((item) => item.id === entry.instruction.id)) session.annotations.push(entry.instruction); persistSpecificationChange(); },
      undo: () => { entry.revert(); session.annotations = session.annotations.filter((item) => item.id !== entry.instruction.id); persistSpecificationChange(); },
    };
    history.execute(full);
  };

  const transformElement = (element: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, beforeRect: RectSnapshot): void => {
    const operation: VisualOperation = { type: "move", delta: { x: to.x - from.x, y: to.y - from.y }, before: beforeRect, after: { ...beforeRect, x: beforeRect.x + to.x - from.x, y: beforeRect.y + to.y - from.y } };
    const instruction = newInstruction(element, operation);
    executeVisual({ label: "move", instruction, apply: () => applyPreviewTransform(element, to), revert: () => applyPreviewTransform(element, from) });
  };

  const nudge = (dx: number, dy: number): void => {
    for (const element of selected) {
      const from = runtimeDeltas.get(element) ?? { x: 0, y: 0 };
      transformElement(element, from, { x: from.x + dx, y: from.y + dy }, rectOf(element));
    }
  };

  const selectRelative = (direction: "parent" | "firstChild" | "previousSibling" | "nextSibling"): void => {
    const primary = selected.at(-1);
    if (!primary) return;
    let candidate: Element | null = direction === "parent" ? primary.parentElement
      : direction === "firstChild" ? primary.firstElementChild
      : direction === "previousSibling" ? primary.previousElementSibling : primary.nextElementSibling;
    while (candidate && !isSelectable(candidate, host)) candidate = direction === "parent" ? candidate.parentElement
      : direction === "firstChild" ? candidate.nextElementSibling
      : direction === "previousSibling" ? candidate.previousElementSibling : candidate.nextElementSibling;
    if (isSelectable(candidate, host)) { selected = [candidate]; render(); }
  };

  commands.register("review.toggle", () => { if (active) stop(); else start(); });
  commands.register("selection.parent", () => selectRelative("parent"));
  commands.register("selection.firstChild", () => selectRelative("firstChild"));
  commands.register("selection.previousSibling", () => selectRelative("previousSibling"));
  commands.register("selection.nextSibling", () => selectRelative("nextSibling"));
  commands.register("session.submit", () => { confirmHandoff(); });
  commands.register("compare.next", () => {
    const modes: CompareMode[] = ["edited", "original", "side-by-side", "overlay"];
    setCompare(modes[(modes.indexOf(compareMode) + 1) % modes.length]!);
  });

  const onPointerMove = (event: PointerEvent): void => {
    if (!active || compareMode === "side-by-side" || event.composedPath().includes(host)) return;
    const candidate = document.elementFromPoint(event.clientX, event.clientY);
    hoverTarget = isSelectable(candidate, host) ? candidate : null;
    updateBoxes();
  };

  let drag: { target: HTMLElement; startX: number; startY: number; from: { x: number; y: number }; before: RectSnapshot; moved: boolean } | null = null;
  let canceledDragTarget: HTMLElement | null = null;
  let resizeClickGuard: { handler: (event: MouseEvent) => void; timeout: number } | null = null;
  const clearResizeClickGuard = (): void => {
    if (!resizeClickGuard) return;
    document.removeEventListener("click", resizeClickGuard.handler, true);
    window.clearTimeout(resizeClickGuard.timeout);
    resizeClickGuard = null;
  };
  const cancelDragPreview = (): void => {
    if (!drag) return;
    const current = drag;
    drag = null;
    canceledDragTarget = current.moved ? current.target : null;
    applyPreviewTransform(current.target, current.from);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!active || compareMode === "side-by-side" || event.composedPath().includes(host) || !(event.target instanceof HTMLElement)) return;
    if (selected.includes(event.target) && event.button === 0) {
      drag = { target: event.target, startX: event.clientX, startY: event.clientY, from: runtimeDeltas.get(event.target) ?? { x: 0, y: 0 }, before: rectOf(event.target), moved: false };
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const onDragMove = (event: PointerEvent): void => {
    if (!drag) return;
    const dx = event.clientX - drag.startX; const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    applyPreviewTransform(drag.target, { x: drag.from.x + dx, y: drag.from.y + dy });
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!drag) {
      if (canceledDragTarget) window.setTimeout(() => { canceledDragTarget = null; }, 0);
      return;
    }
    const current = drag; drag = null;
    if (current.moved) {
      const to = { x: current.from.x + event.clientX - current.startX, y: current.from.y + event.clientY - current.startY };
      applyPreviewTransform(current.target, current.from);
      transformElement(current.target, current.from, to, current.before);
    }
  };

  const onClick = (event: MouseEvent): void => {
    if (resizeClickGuard) {
      clearResizeClickGuard();
      event.preventDefault(); event.stopImmediatePropagation();
      return;
    }
    if (!active || event.composedPath().includes(host)) return;
    if (compareMode === "side-by-side") { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (canceledDragTarget && event.composedPath().includes(canceledDragTarget)) {
      canceledDragTarget = null;
      event.preventDefault(); event.stopImmediatePropagation();
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    const candidate = event.target instanceof Element ? event.target : null;
    if (!isSelectable(candidate, host)) return;
    selected = event.shiftKey ? (selected.includes(candidate) ? selected.filter((item) => item !== candidate) : [...selected, candidate]) : [candidate];
    render();
  };
  const blockSubmit = (event: Event): void => { if (active) { event.preventDefault(); event.stopImmediatePropagation(); } };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.composedPath().includes(host)) return;
    const command = commandForEvent(event, config.shortcuts);
    if (command && commands.execute(command)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (!active) return;
    if (event.key === "Escape") { cancelDragPreview(); cancelResizePreview(); selected = []; hoverTarget = null; render(); event.preventDefault(); return; }
    if (event.key.startsWith("Arrow") && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const step = event.shiftKey ? 10 : 1;
      const delta: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
      const [dx, dy] = delta[event.key] ?? [0, 0]; nudge(dx, dy); event.preventDefault(); event.stopImmediatePropagation();
    }
  };

  let originalOpen = window.open;
  const attachReviewListeners = (): void => {
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onDragMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    document.addEventListener("submit", blockSubmit, true);
    if (config.review.navigationPolicy === "block-all") window.open = (() => null) as typeof window.open;
  };
  const detachReviewListeners = (): void => {
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onDragMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onClick, true);
    document.removeEventListener("submit", blockSubmit, true);
    window.open = originalOpen;
  };
  const guardCanceledResizeClick = (): void => {
    clearResizeClickGuard();
    const handler = (event: MouseEvent): void => {
      event.preventDefault(); event.stopImmediatePropagation();
      clearResizeClickGuard();
    };
    const timeout = window.setTimeout(() => {
      clearResizeClickGuard();
    }, 500);
    resizeClickGuard = { handler, timeout };
    document.addEventListener("click", handler, true);
  };
  let resize: { target: HTMLElement; pointerId: number; startX: number; startY: number; before: RectSnapshot; beforeWidth: string; beforeHeight: string; hadStyleAttribute: boolean } | null = null;
  const cancelResizePreview = (guardClick = true): void => {
    if (!resize) return;
    const current = resize;
    resize = null;
    if (resizeHandle.hasPointerCapture(current.pointerId)) {
      resizeHandle.releasePointerCapture(current.pointerId);
      if (guardClick) guardCanceledResizeClick();
    }
    current.target.style.width = current.beforeWidth;
    current.target.style.height = current.beforeHeight;
    if (!current.hadStyleAttribute && current.target.getAttribute("style") === "") current.target.removeAttribute("style");
    updateBoxes();
  };
  function start(): void {
    if (active) return;
    if (!reviewStarted) {
      setCompare(preferredCompareMode, false);
      applyViewportDisplay(preferredViewport);
      session.viewport = viewportInfo(preferredViewport);
    }
    active = true;
    reviewStarted = true;
    originalOpen = window.open;
    attachReviewListeners();
    render();
  }
  function stop(): void { cancelDragPreview(); cancelResizePreview(); if (!active) return; active = false; detachReviewListeners(); hoverTarget = null; render(); }

  const panelHeader = $(".head") as HTMLElement;
  let panelDrag: { pointerId: number; offsetX: number; offsetY: number } | null = null;
  panelHeader.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as Element).closest("button,input,select,textarea,a,summary")) return;
    const rect = panel.getBoundingClientRect();
    panelPosition = { x: rect.left, y: rect.top };
    panelDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    panelHeader.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  panelHeader.addEventListener("pointermove", (event) => {
    if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
    panelPosition = clampPanelPosition({ x: event.clientX - panelDrag.offsetX, y: event.clientY - panelDrag.offsetY });
    applyPanelPosition();
  });
  const finishPanelDrag = (event: PointerEvent): void => {
    if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
    panelDrag = null;
    if (panelPosition) saveLocalPreference({ panel: { ...panelPosition, opacity: panelOpacity } });
  };
  panelHeader.addEventListener("pointerup", finishPanelDrag);
  panelHeader.addEventListener("pointercancel", finishPanelDrag);
  let launcherDrag: { pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null = null;
  let suppressLauncherClick = false;
  launcher.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    launcherDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: rect.left, originY: rect.top, moved: false };
    launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener("pointermove", (event) => {
    if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) return;
    const dx = event.clientX - launcherDrag.startX; const dy = event.clientY - launcherDrag.startY;
    if (!launcherDrag.moved && Math.hypot(dx, dy) < 4) return;
    launcherDrag.moved = true;
    launcherPosition = clampLauncherPosition({ x: launcherDrag.originX + dx, y: launcherDrag.originY + dy });
    applyLauncherPosition();
    event.preventDefault();
  });
  const finishLauncherDrag = (event: PointerEvent): void => {
    if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) return;
    const moved = launcherDrag.moved; launcherDrag = null;
    if (!moved || !launcherPosition) return;
    suppressLauncherClick = true;
    saveLocalPreference({ launcher: { ...launcherPosition, visible: launcherVisible } });
    window.setTimeout(() => { suppressLauncherClick = false; }, 0);
  };
  launcher.addEventListener("pointerup", finishLauncherDrag);
  launcher.addEventListener("pointercancel", finishLauncherDrag);

  const setCompare = (mode: CompareMode, save = true): void => {
    compareMode = mode;
    const sideBySide = mode === "side-by-side";
    sideCompare.hidden = !sideBySide;
    if (sideBySide) editedSideFrame.srcdoc = sanitizeSnapshot(document.documentElement);
    else editedSideFrame.removeAttribute("srcdoc");
    compareFrame.hidden = mode === "edited" || sideBySide;
    compareFrame.className = `compare ${mode}`;
    compareFrame.style.opacity = mode === "overlay" ? String(compareOpacity) : "";
    (shadow.querySelector("[data-compare]") as HTMLSelectElement).value = mode;
    if (save) {
      preferredCompareMode = mode;
      saveLocalPreference({ compare: { mode, opacity: compareOpacity }, review: { defaultCompareMode: mode } });
    }
    attachScrollSync();
    render();
  };
  const applyViewportDisplay = (value: ViewportPreset): void => {
    preset = value;
    const widths: Record<ViewportPreset, number> = { desktop: window.innerWidth, tablet: 768, mobile: 390, custom: Math.max(320, Math.round(window.innerWidth * 0.72)) };
    guide.style.width = `${Math.min(widths[value], window.innerWidth)}px`;
    guide.dataset.label = `${messages[`${value}Option` as keyof Messages]} · ${widths[value]}px (${messages.layoutGuide})`;
    guide.hidden = value === "desktop";
    (shadow.querySelector("[data-viewport]") as HTMLSelectElement).value = value;
  };
  const setViewport = (value: ViewportPreset): void => {
    applyViewportDisplay(value);
    preferredViewport = value;
    saveLocalPreference({ review: { defaultViewport: value } });
    persistSpecificationChange();
  };

  resizeHandle.addEventListener("pointerdown", (event) => {
    const target = selected.at(-1); if (!target) return;
    event.preventDefault(); event.stopPropagation();
    resize = { target, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, before: rectOf(target), beforeWidth: target.style.width, beforeHeight: target.style.height, hadStyleAttribute: target.hasAttribute("style") };
    resizeHandle.setPointerCapture(event.pointerId);
  });
  resizeHandle.addEventListener("pointermove", (event) => {
    if (!resize) return;
    resize.target.style.width = `${Math.max(8, resize.before.width + event.clientX - resize.startX)}px`;
    resize.target.style.height = `${Math.max(8, resize.before.height + event.clientY - resize.startY)}px`;
    updateBoxes();
  });
  resizeHandle.addEventListener("pointerup", () => {
    if (!resize) return;
    const current = resize;
    const afterWidth = current.target.style.width; const afterHeight = current.target.style.height; const after = rectOf(current.target);
    cancelResizePreview(false);
    const instruction = newInstruction(current.target, { type: "resize", before: current.before, after });
    executeVisual({ label: "resize", instruction, apply: () => { current.target.style.width = afterWidth; current.target.style.height = afterHeight; updateBoxes(); }, revert: () => { current.target.style.width = current.beforeWidth; current.target.style.height = current.beforeHeight; updateBoxes(); } });
  });
  resizeHandle.addEventListener("pointercancel", () => cancelResizePreview(false));

  const applyVisibility = (type: "hide" | "remove"): void => {
    for (const target of selected) {
      const property = type === "hide" ? "visibility" : "display";
      const before = target.style[property];
      const after = type === "hide" ? "hidden" : "none";
      const operation: VisualOperation = type === "hide" ? { type: "hide", intent: "not-visible" } : { type: "remove", intent: "delete-from-ui-and-source" };
      const instruction = newInstruction(target, operation);
      executeVisual({ label: type, instruction, apply: () => { target.style[property] = after; updateBoxes(); }, revert: () => { target.style[property] = before; updateBoxes(); } });
    }
  };

  const replaceText = (): void => {
    const target = selected.at(-1); if (!target) return;
    const textNode = editableDirectText(target); if (!textNode) return;
    const before = textNode.data; const after = textInput.value;
    if (before === after) return;
    const instruction = newInstruction(target, { type: "replace-text", before, after });
    executeVisual({ label: "replace-text", instruction, apply: () => { textNode.data = after; updateBoxes(); }, revert: () => { textNode.data = before; updateBoxes(); } });
  };

  const alignLeft = (): void => {
    if (selected.length < 2) return;
    const targetX = Math.min(...selected.map((element) => element.getBoundingClientRect().left));
    for (const element of selected) {
      const rect = rectOf(element); const from = runtimeDeltas.get(element) ?? { x: 0, y: 0 };
      transformElement(element, from, { x: from.x + targetX - rect.x, y: from.y }, rect);
      const last = session.annotations.at(-1); if (last) last.operation = { type: "align", axis: "vertical", delta: { x: targetX - rect.x, y: 0 } };
      persistSpecificationChange();
    }
  };
  const equalSpacing = (): void => {
    if (selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const first = sorted[0]!.getBoundingClientRect(); const last = sorted.at(-1)!.getBoundingClientRect();
    const totalWidths = sorted.reduce((sum, element) => sum + element.getBoundingClientRect().width, 0);
    const gap = (last.right - first.left - totalWidths) / (sorted.length - 1);
    let cursor = first.left;
    for (const element of sorted) {
      const rect = rectOf(element); const from = runtimeDeltas.get(element) ?? { x: 0, y: 0 };
      transformElement(element, from, { x: from.x + cursor - rect.x, y: from.y }, rect);
      const lastItem = session.annotations.at(-1); if (lastItem) lastItem.operation = { type: "equal-spacing", axis: "horizontal" };
      persistSpecificationChange();
      cursor += rect.width + gap;
    }
  };

  shadow.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]"); if (!button) return;
    const action = button.dataset.action;
    if (button === launcher && suppressLauncherClick) { event.preventDefault(); return; }
    if (action === "toggle") { if (active) stop(); else start(); }
    else if (action === "undo") history.undo();
    else if (action === "redo") history.redo();
    else if (action === "clear-selection") { selected = []; render(); }
    else if (action === "hide") applyVisibility("hide");
    else if (action === "remove") { if (selected.length) dialog.showModal(); }
    else if (action === "cancel-remove") dialog.close();
    else if (action === "confirm-remove") { dialog.close(); applyVisibility("remove"); }
    else if (action === "text") replaceText();
    else if (action === "align") alignLeft();
    else if (action === "spacing") equalSpacing();
    else if (action === "handoff") toggleHandoff();
    else if (action === "worker-request" || action === "worker-retry") void startWorkerTask();
    else if (action === "pairing-settings") openPairing(false);
    else if (action === "check-pairing") void checkPairing();
    else if (action === "approve-pairing") void approvePairing();
    else if (action === "close-pairing") { pendingWorkerStart = false; clearPairingSecret(); pairingDialog.close(); render(); }
    else if (action === "worker-cancel") void cancelWorkerTask();
    else if (action === "end-review") requestEndReview();
    else if (action === "cancel-end") { endDialog.close(); endReviewButton.focus(); }
    else if (action === "cancel-worker-end") { void cancelWorkerTask().then(() => endDialog.close()); }
    else if (action === "confirm-end") { if (confirmHandoff()) endDialog.close(); }
    else if (action === "discard-end") discardAndEndReview();
    else if (action === "help") helpDialog.showModal();
    else if (action === "close-help") helpDialog.close();
    else if (action === "reset-panel") resetPanelPosition();
    else if (action === "reset-launcher") resetLauncherPosition();
    else if (action === "save-shortcut") {
      config.shortcuts["review.toggle"] = shortcutInput.value;
      const conflicts = findShortcutConflicts(config.shortcuts);
      $("[data-shortcut-warning]").textContent = conflicts.join(" · ");
      saveLocalPreference({ shortcuts: config.shortcuts });
    }
  });
  shadow.querySelector<HTMLSelectElement>("[data-intent]")!.addEventListener("change", (event) => { intent = (event.target as HTMLSelectElement).value as IntentCategory; persistSpecificationChange(); });
  shadow.querySelector<HTMLTextAreaElement>("[data-comment]")!.addEventListener("input", (event) => { comment = (event.target as HTMLTextAreaElement).value; persistSpecificationChange(); });
  shadow.querySelector<HTMLSelectElement>("[data-precision]")!.addEventListener("change", (event) => { precision = (event.target as HTMLSelectElement).value as Precision; persistSpecificationChange(); });
  shadow.querySelector<HTMLSelectElement>("[data-scope]")!.addEventListener("change", (event) => { applyScope = (event.target as HTMLSelectElement).value as ApplyScope; persistSpecificationChange(); });
  shadow.querySelector<HTMLSelectElement>("[data-compare]")!.addEventListener("change", (event) => setCompare((event.target as HTMLSelectElement).value as CompareMode));
  shadow.querySelector<HTMLSelectElement>("[data-viewport]")!.value = preset;
  shadow.querySelector<HTMLSelectElement>("[data-viewport]")!.addEventListener("change", (event) => setViewport((event.target as HTMLSelectElement).value as ViewportPreset));
  shadow.querySelector<HTMLSelectElement>("[data-locale]")!.value = config.locale;
  shadow.querySelector<HTMLSelectElement>("[data-locale]")!.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value as typeof config.locale;
    config.locale = value;
    locale = resolveLocale(value); messages = getMessages(locale);
    saveLocalPreference({ locale: value });
    render();
  });
  panelOpacityInput.addEventListener("input", () => {
    panelOpacity = Number(panelOpacityInput.value) / 100;
    panel.style.setProperty("--panel-opacity", String(panelOpacity));
    $("[data-panel-opacity-value]").textContent = `${panelOpacityInput.value}%`;
    saveLocalPreference({ panel: { ...(panelPosition ?? {}), opacity: panelOpacity } });
  });
  compareOpacityInput.addEventListener("input", () => {
    compareOpacity = Number(compareOpacityInput.value) / 100;
    compareFrame.style.opacity = compareMode === "overlay" ? String(compareOpacity) : "";
    $("[data-compare-opacity-value]").textContent = `${compareOpacityInput.value}%`;
    saveLocalPreference({ compare: { mode: compareMode, opacity: compareOpacity } });
  });
  launcherVisibleInput.addEventListener("change", () => {
    launcherVisible = launcherVisibleInput.checked;
    saveLocalPreference({ launcher: { ...(launcherPosition ?? {}), visible: launcherVisible } });
    render();
  });
  themeInput.addEventListener("change", () => {
    theme = themeInput.value as Theme;
    saveLocalPreference({ appearance: { theme, style: uiStyle } });
    applyAppearance();
  });
  styleInput.addEventListener("change", () => {
    uiStyle = styleInput.value as UiStyle;
    saveLocalPreference({ appearance: { theme, style: uiStyle } });
    applyAppearance();
  });
  viewSection.addEventListener("toggle", () => saveLocalPreference({ sections: { viewOpen: viewSection.open } }));
  preferencesSection.addEventListener("toggle", () => saveLocalPreference({ sections: { preferencesOpen: preferencesSection.open } }));
  let scrollSyncHandler: (() => void) | null = null;
  function detachScrollSync(): void {
    if (scrollSyncHandler) window.removeEventListener("scroll", scrollSyncHandler);
    scrollSyncHandler = null;
  }
  function attachScrollSync(): void {
    detachScrollSync();
    if (config.review.scrollSync !== "ratio" || compareMode === "edited") return;
    scrollSyncHandler = (): void => {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const frames = compareMode === "side-by-side" ? [editedSideFrame, originalSideFrame] : [compareFrame];
      for (const frame of frames) {
        const frameWindow = frame.contentWindow; const frameDocument = frame.contentDocument;
        if (!frameWindow || !frameDocument) continue;
        const frameMax = Math.max(1, frameDocument.documentElement.scrollHeight - frame.clientHeight);
        frameWindow.scrollTo(0, scrollY / max * frameMax);
      }
    };
    window.addEventListener("scroll", scrollSyncHandler, { passive: true });
    scrollSyncHandler();
  }
  const onCompareLoad = (): void => { attachScrollSync(); };
  compareFrame.addEventListener("load", onCompareLoad);
  editedSideFrame.addEventListener("load", onCompareLoad);
  originalSideFrame.addEventListener("load", onCompareLoad);
  endDialog.addEventListener("cancel", () => window.setTimeout(() => endReviewButton.focus(), 0));
  window.addEventListener("scroll", updateBoxes, { passive: true });
  const onWindowResize = (): void => {
    applyPanelPosition(); applyLauncherPosition(); updateBoxes();
    window.requestAnimationFrame(() => { if (!destroyed) { applyPanelPosition(); applyLauncherPosition(); } });
  };
  window.addEventListener("resize", onWindowResize, { passive: true });
  document.addEventListener("keydown", onKeyDown, true);

  let destroyed = false;
  let unregisterTools = (): void => undefined;
  void registerVisualReviewTools(() => session, persist, clear).then((unregister) => {
    if (destroyed) unregister();
    else unregisterTools = unregister;
  });

  function rollbackReviewWork(): void {
    cancelDragPreview();
    cancelResizePreview();
    while (history.canUndo) history.undo();
    history.clear();
    restorePreviewTransforms();
    session.annotations = [];
    markSessionDraft(session);
    refreshSessionSummary(session);
    selected = [];
    hoverTarget = null;
  }
  function resetSessionWork(): void {
    delete session.confirmedAt;
    Object.assign(session, {
      sessionId: id("review"),
      route: `${location.pathname}${location.search}${location.hash}`,
      viewport: viewportInfo(preset),
      createdAt: new Date().toISOString(),
      status: "draft" as const,
      summary: { total: 0, pending: 0, resolved: 0, byOperation: {} },
      annotations: [],
    });
  }
  function requestEndReview(): void {
    refreshSessionSummary(session);
    if (workerTask && runningWorkerStatuses.has(workerTask.status)) {
      render();
      $("[data-end-warning]").textContent = messages.workerRunningEnd;
      endDialog.showModal(); cancelWorkerEndButton.focus(); return;
    }
    if (session.status === "draft" && hasPendingInstructions(session)) {
      render();
      endDialog.showModal();
      cancelEndButton.focus();
      return;
    }
    discardAndEndReview();
  }
  function discardAndEndReview(): void {
    if (active) detachReviewListeners();
    active = false;
    rollbackReviewWork();
    setCompare("edited", false);
    applyViewportDisplay("desktop");
    intent = "other"; comment = ""; precision = "approximate"; applyScope = "current-viewport";
    (shadow.querySelector("[data-intent]") as HTMLSelectElement).value = intent;
    (shadow.querySelector("[data-comment]") as HTMLTextAreaElement).value = comment;
    (shadow.querySelector("[data-precision]") as HTMLSelectElement).value = precision;
    (shadow.querySelector("[data-scope]") as HTMLSelectElement).value = applyScope;
    resetSessionWork();
    reviewStarted = false;
    storage.clear();
    if (endDialog.open) endDialog.close();
    render();
    if (!launcher.hidden) launcher.focus();
  }
  function clear(): void {
    rollbackReviewWork();
    storage.clear();
    render();
  }
  function destroy(): void {
    destroyed = true; workerStream?.abort(); clearPairingSecret(); if (pairingDialog.open) pairingDialog.close(); workerClient = null; bridgeStatus = null; stop(); clear(); unregisterTools(); detachScrollSync();
    compareFrame.removeEventListener("load", onCompareLoad);
    editedSideFrame.removeEventListener("load", onCompareLoad);
    originalSideFrame.removeEventListener("load", onCompareLoad);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", updateBoxes);
    window.removeEventListener("resize", onWindowResize);
    host.remove();
  }
  setCompare(compareMode, false);
  if (options.startActive) start(); else render();

  return {
    get session() { return session; }, get active() { return active; }, start, stop, destroy,
    undo: () => { history.undo(); }, redo: () => { history.redo(); },
    confirm: confirmHandoff,
    serialize: () => JSON.stringify(session, null, 2), clear,
  };
}
