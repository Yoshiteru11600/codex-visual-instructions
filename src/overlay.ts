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

const HOST_ATTRIBUTE = "data-codex-visual-instructions";
const STORAGE_KEY = "codex-visual-instructions:session:v1";
const BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "META", "LINK", "HEAD"]);
const REMOVE_REQUIREMENTS = [
  "Inspect JavaScript and framework references before deleting source.",
  "Check event handlers, ARIA relationships, form semantics, and layout dependencies.",
  "Verify the affected flow in the browser after implementation.",
];

const styles = `
  :host { all: initial; color-scheme: dark; pointer-events: none; }
  *, *::before, *::after { box-sizing: border-box; }
  .launcher { position: fixed; z-index: 2147483646; right: 16px; bottom: 16px; border: 0; border-radius: 999px; padding: 10px 15px; background: #6d5dfc; color: #fff; font: 600 13px/1.2 system-ui,sans-serif; box-shadow: 0 8px 28px #0006; cursor: pointer; pointer-events:auto; }
  .launcher:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid #8ed7ff; outline-offset: 2px; }
  .panel { position: fixed; z-index: 2147483646; right: 12px; top: 12px; width: 330px; max-height: calc(100vh - 24px); overflow: auto; border: 1px solid #ffffff26; border-radius: 14px; background: #171820f2; color: #f5f6fb; font: 13px/1.4 system-ui,sans-serif; box-shadow: 0 18px 60px #0008; backdrop-filter: blur(12px); pointer-events:auto; }
  .panel[hidden], .compare[hidden], .guide[hidden], .resize[hidden] { display: none; }
  .head { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid #ffffff1c; position:sticky; top:0; background:#171820; z-index:2; }
  .head strong { font-size:14px; } .head small { color:#b6b8c6; }
  .body { padding: 12px; display:grid; gap:10px; }
  .row { display:flex; gap:7px; align-items:center; flex-wrap:wrap; }
  button, select, input, textarea { border:1px solid #ffffff29; border-radius:7px; background:#282a36; color:#f8f8fb; font:inherit; }
  button { padding:6px 9px; cursor:pointer; } button:hover { background:#353849; } button:disabled { opacity:.42; cursor:default; }
  select, input, textarea { padding:6px 8px; min-width:0; } select { flex:1; }
  textarea { width:100%; min-height:58px; resize:vertical; }
  label { color:#c9cad5; font-size:11px; display:grid; gap:4px; flex:1; min-width:120px; }
  .meta { padding:9px; border-radius:8px; background:#0f1017; color:#d9dae3; overflow-wrap:anywhere; }
  .meta code { color:#9fe7d7; } .hint { color:#989bab; font-size:11px; }
  .danger { border-color:#ff697d70; color:#ffb5bf; }
  .active { background:#6d5dfc; border-color:#8d82ff; }
  .handoff { padding:10px; border:1px solid #ffffff1c; border-radius:9px; background:#20222d; display:grid; gap:7px; }
  .handoff .primary { width:100%; padding:9px 12px; background:#6d5dfc; border-color:#8d82ff; font-weight:650; }
  .handoff .primary:hover { background:#7a6cfe; } .handoff .primary:disabled { background:#282a36; }
  .handoff-status { margin:0; color:#b9f3d9; font-size:12px; } .handoff-summary { color:#b6b8c6; font-size:11px; }
  .hover, .selection { position:fixed; z-index:2147483644; pointer-events:none; border:2px solid #6d5dfc; border-radius:3px; }
  .hover { border-style:dashed; border-color:#45d7b0; }
  .selection::after { content:attr(data-label); position:absolute; left:-2px; top:-20px; padding:2px 5px; color:white; background:#6d5dfc; border-radius:3px 3px 0 0; font:10px/1.4 system-ui,sans-serif; white-space:nowrap; }
  .resize { position:fixed; z-index:2147483647; width:14px; height:14px; border-radius:4px; background:#fff; border:3px solid #6d5dfc; cursor:nwse-resize; touch-action:none; pointer-events:auto; }
  .compare { position:fixed; z-index:2147483643; background:#fff; border:0; box-shadow:0 0 0 1px #0004; pointer-events:none; }
  .compare.original { inset:0; width:100vw; height:100vh; }
  .compare.side-by-side { top:0; right:0; width:50vw; height:100vh; border-left:3px solid #6d5dfc; }
  .compare.overlay { inset:0; width:100vw; height:100vh; opacity:.5; pointer-events:none; }
  .guide { position:fixed; z-index:2147483642; top:0; left:50%; height:100vh; border:1px dashed #6d5dfc99; background:#6d5dfc0c; pointer-events:none; transform:translateX(-50%); }
  .guide::before { content:attr(data-label); position:absolute; top:8px; left:8px; padding:3px 6px; border-radius:4px; background:#6d5dfc; color:#fff; font:11px system-ui,sans-serif; }
  dialog { max-width:430px; border:1px solid #ff697d70; border-radius:12px; background:#1d1f29; color:#fff; padding:18px; font:13px/1.5 system-ui,sans-serif; pointer-events:auto; }
  dialog::backdrop { background:#0009; } dialog .row { justify-content:flex-end; margin-top:14px; }
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

  let localPreferences = {};
  try { localPreferences = JSON.parse(localStorage.getItem("codex-visual-instructions:preferences") ?? "{}"); } catch { /* ignored */ }
  const config = mergeConfig(localPreferences, options.config ?? {});
  let locale = resolveLocale(config.locale);
  let messages = getMessages(locale);
  let active = false;
  let compareMode: CompareMode = config.review.defaultCompareMode;
  let preset: ViewportPreset = config.review.defaultViewport;
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
    <section class="panel" aria-label="Visual instruction controls" hidden>
      <header class="head"><div><strong data-i18n="title"></strong><br><small data-count></small></div><button type="button" data-action="toggle"></button></header>
      <div class="body">
        <div class="row"><button data-action="undo" data-i18n="undo"></button><button data-action="redo" data-i18n="redo"></button><button data-action="clear-selection" data-i18n="clear"></button></div>
        <div class="meta" data-meta></div>
        <div class="row"><button data-action="hide" data-i18n="hide"></button><button class="danger" data-action="remove" data-i18n="remove"></button><button data-action="align" data-i18n="alignLeft"></button><button data-action="spacing" data-i18n="equalSpacing"></button></div>
        <label><span data-i18n="editText"></span><div class="row"><input data-text-input type="text" autocomplete="off"><button data-action="text" data-i18n="applyText"></button></div><small class="hint" data-text-warning></small></label>
        <label><span data-i18n="intent"></span><select data-intent><option value="spacing">Spacing</option><option value="alignment">Alignment</option><option value="visual-hierarchy">Visual hierarchy</option><option value="responsive">Responsive</option><option value="copy">Copy</option><option value="visibility">Visibility</option><option value="interaction">Interaction</option><option value="exact-position">Exact position</option><option value="other" selected>Other</option></select></label>
        <label><span data-i18n="comment"></span><textarea data-comment maxlength="1000"></textarea></label>
        <div class="row"><label><span data-i18n="precision"></span><select data-precision><option value="exact">Exact</option><option value="approximate" selected>Approximate</option><option value="relationship">Relationship</option><option value="intent-only">Intent only</option></select></label><label><span data-i18n="scope"></span><select data-scope><option value="current-viewport">Current viewport</option><option value="current-breakpoint">Current breakpoint</option><option value="all-narrower">All narrower</option><option value="all-wider">All wider</option><option value="all-viewports">All viewports</option></select></label></div>
        <div class="row"><label><span data-i18n="compare"></span><select data-compare><option value="edited">Edited</option><option value="original">Original</option><option value="side-by-side">Side by side</option><option value="overlay">Overlay</option></select></label><label><span data-i18n="viewport"></span><select data-viewport><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option><option value="custom">Custom</option></select></label></div>
        <div class="handoff"><div class="handoff-summary" data-handoff-summary></div><p class="handoff-status" data-handoff-status hidden></p><button class="primary" type="button" data-action="handoff"></button></div>
        <div class="row"><label>Language<select data-locale><option value="auto">Auto</option><option value="en">English</option><option value="ja">日本語</option><option value="fr">Français</option><option value="ru">Русский</option></select></label></div>
        <label>Toggle shortcut<div class="row"><input data-shortcut-input><button data-action="save-shortcut">Save</button></div><small class="hint" data-shortcut-warning></small></label>
        <p class="hint">Alt+Shift+Arrow: DOM traversal · Arrow: 1px · Shift+Arrow: 10px · Esc: clear/cancel</p>
      </div>
    </section>
    <div class="hover" hidden></div><div data-selections></div><div class="resize" role="slider" aria-label="Resize selected element" hidden></div>
    <iframe class="compare" title="Original visual snapshot" sandbox="allow-same-origin" hidden></iframe>
    <div class="guide" hidden></div>
    <dialog><p data-warning></p><div class="row"><button data-action="cancel-remove">Cancel</button><button class="danger" data-action="confirm-remove">Remove preview</button></div></dialog>
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
  const guide = $(".guide") as HTMLElement;
  const dialog = $("dialog") as HTMLDialogElement;
  const meta = $("[data-meta]") as HTMLElement;
  const textInput = $("[data-text-input]") as HTMLInputElement;
  const shortcutInput = $("[data-shortcut-input]") as HTMLInputElement;
  const textButton = shadow.querySelector<HTMLButtonElement>("[data-action=text]")!;
  const textWarning = $("[data-text-warning]") as HTMLElement;
  const handoffButton = shadow.querySelector<HTMLButtonElement>("[data-action=handoff]")!;

  compareFrame.srcdoc = originalSnapshot;
  shortcutInput.value = config.shortcuts["review.toggle"] ?? "Alt+Shift+R";

  const persist = (): void => { session.viewport = viewportInfo(preset); refreshSessionSummary(session); storage.save(session); render(); };
  const persistSpecificationChange = (): void => { markSessionDraft(session); persist(); };
  const confirmHandoff = (): boolean => {
    if (!confirmSession(session)) { render(); return false; }
    persist();
    return true;
  };
  const toggleHandoff = (): void => {
    if (session.status === "ready") { markSessionDraft(session); persist(); }
    else confirmHandoff();
  };
  const saveLocalPreference = (patch: Record<string, unknown>): void => {
    try {
      const current = JSON.parse(localStorage.getItem("codex-visual-instructions:preferences") ?? "{}");
      localStorage.setItem("codex-visual-instructions:preferences", JSON.stringify({ ...current, ...patch }));
    } catch { /* storage may be disabled */ }
  };

  const renderTranslations = (): void => {
    shadow.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n as keyof Messages;
      element.textContent = messages[key];
    });
    launcher.textContent = active ? messages.stop : messages.start;
    shadow.querySelectorAll<HTMLButtonElement>("[data-action=toggle]").forEach((button) => { button.textContent = active ? messages.stop : messages.start; });
    $("[data-warning]").textContent = messages.removeWarning;
  };

  const updateBoxes = (): void => {
    if (hoverTarget && active) {
      const rect = hoverTarget.getBoundingClientRect();
      Object.assign(hoverBox.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      hoverBox.hidden = false;
    } else hoverBox.hidden = true;
    selectionLayer.replaceChildren();
    selected.forEach((element, index) => {
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
    panel.hidden = !active;
    launcher.hidden = active;
    $("[data-count]").textContent = `${session.annotations.length} ${messages.sessionCount}`;
    const operationSummary = Object.entries(session.summary.byOperation).map(([type, count]) => `${type}: ${count}`).join(" · ");
    $("[data-handoff-summary]").textContent = `pending: ${session.summary.pending} · resolved: ${session.summary.resolved}${operationSummary ? ` · ${operationSummary}` : ""}`;
    const handoffStatus = $("[data-handoff-status]") as HTMLElement;
    handoffStatus.hidden = session.status !== "ready";
    handoffStatus.textContent = session.status === "ready" ? messages.handoffReady : "";
    handoffButton.textContent = session.status === "ready" ? messages.editInstructions : messages.requestChanges;
    handoffButton.disabled = !hasPendingInstructions(session);
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
      if (primary instanceof HTMLAnchorElement) meta.append(document.createElement("br"), document.createTextNode(`Target: ${primary.getAttribute("href") ?? ""}`));
    } else meta.textContent = messages.noSelection;
    const editableText = primary ? editableDirectText(primary) : null;
    textInput.value = editableText?.data ?? "";
    textInput.disabled = !editableText;
    textButton.disabled = !editableText;
    textWarning.textContent = primary && !editableText ? "Text editing is available only for one unambiguous direct text node." : "";
    shadow.querySelector<HTMLButtonElement>("[data-action=undo]")!.disabled = !history.canUndo;
    shadow.querySelector<HTMLButtonElement>("[data-action=redo]")!.disabled = !history.canRedo;
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
    if (!active || event.composedPath().includes(host)) return;
    const candidate = document.elementFromPoint(event.clientX, event.clientY);
    hoverTarget = isSelectable(candidate, host) ? candidate : null;
    updateBoxes();
  };

  let drag: { target: HTMLElement; startX: number; startY: number; from: { x: number; y: number }; before: RectSnapshot; moved: boolean } | null = null;
  let canceledDragTarget: HTMLElement | null = null;
  const cancelDragPreview = (): void => {
    if (!drag) return;
    const current = drag;
    drag = null;
    canceledDragTarget = current.moved ? current.target : null;
    applyPreviewTransform(current.target, current.from);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!active || event.composedPath().includes(host) || !(event.target instanceof HTMLElement)) return;
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
    if (!active || event.composedPath().includes(host)) return;
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
  let resize: { target: HTMLElement; startX: number; startY: number; before: RectSnapshot; beforeWidth: string; beforeHeight: string; hadStyleAttribute: boolean } | null = null;
  const cancelResizePreview = (): void => {
    if (!resize) return;
    const current = resize;
    resize = null;
    current.target.style.width = current.beforeWidth;
    current.target.style.height = current.beforeHeight;
    if (!current.hadStyleAttribute && current.target.getAttribute("style") === "") current.target.removeAttribute("style");
    updateBoxes();
  };
  function start(): void { if (active) return; active = true; originalOpen = window.open; attachReviewListeners(); render(); }
  function stop(): void { cancelDragPreview(); cancelResizePreview(); if (!active) return; active = false; detachReviewListeners(); hoverTarget = null; render(); }

  const setCompare = (mode: CompareMode): void => {
    compareMode = mode;
    compareFrame.hidden = mode === "edited";
    compareFrame.className = `compare ${mode}`;
    (shadow.querySelector("[data-compare]") as HTMLSelectElement).value = mode;
    attachScrollSync();
  };
  const setViewport = (value: ViewportPreset): void => {
    preset = value;
    const widths: Record<ViewportPreset, number> = { desktop: window.innerWidth, tablet: 768, mobile: 390, custom: Math.max(320, Math.round(window.innerWidth * 0.72)) };
    guide.style.width = `${Math.min(widths[value], window.innerWidth)}px`;
    guide.dataset.label = `${value} · ${widths[value]}px (layout guide)`;
    guide.hidden = value === "desktop";
    persistSpecificationChange();
  };

  resizeHandle.addEventListener("pointerdown", (event) => {
    const target = selected.at(-1); if (!target) return;
    event.preventDefault(); event.stopPropagation();
    resize = { target, startX: event.clientX, startY: event.clientY, before: rectOf(target), beforeWidth: target.style.width, beforeHeight: target.style.height, hadStyleAttribute: target.hasAttribute("style") };
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
    cancelResizePreview();
    const instruction = newInstruction(current.target, { type: "resize", before: current.before, after });
    executeVisual({ label: "resize", instruction, apply: () => { current.target.style.width = afterWidth; current.target.style.height = afterHeight; updateBoxes(); }, revert: () => { current.target.style.width = current.beforeWidth; current.target.style.height = current.beforeHeight; updateBoxes(); } });
  });

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
    locale = resolveLocale(value); messages = getMessages(locale);
    saveLocalPreference({ locale: value });
    render();
  });
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
      const frameWindow = compareFrame.contentWindow; const frameDocument = compareFrame.contentDocument;
      if (!frameWindow || !frameDocument) return;
      const frameMax = Math.max(1, frameDocument.documentElement.scrollHeight - compareFrame.clientHeight);
      frameWindow.scrollTo(0, scrollY / max * frameMax);
    };
    window.addEventListener("scroll", scrollSyncHandler, { passive: true });
  }
  const onCompareLoad = (): void => { attachScrollSync(); };
  compareFrame.addEventListener("load", onCompareLoad);
  window.addEventListener("scroll", updateBoxes, { passive: true });
  window.addEventListener("resize", updateBoxes, { passive: true });
  document.addEventListener("keydown", onKeyDown, true);

  let destroyed = false;
  let unregisterTools = (): void => undefined;
  void registerVisualReviewTools(() => session, persist, clear).then((unregister) => {
    if (destroyed) unregister();
    else unregisterTools = unregister;
  });

  function clear(): void {
    cancelDragPreview();
    cancelResizePreview();
    while (history.canUndo) history.undo();
    history.clear(); restorePreviewTransforms(); session.annotations = []; markSessionDraft(session); refreshSessionSummary(session); selected = []; storage.clear(); render();
  }
  function destroy(): void {
    destroyed = true; stop(); clear(); unregisterTools(); detachScrollSync();
    compareFrame.removeEventListener("load", onCompareLoad);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", updateBoxes);
    window.removeEventListener("resize", updateBoxes);
    host.remove();
  }
  setCompare(compareMode);
  if (options.startActive) start(); else render();

  return {
    get session() { return session; }, get active() { return active; }, start, stop, destroy,
    undo: () => { history.undo(); }, redo: () => { history.redo(); },
    confirm: confirmHandoff,
    serialize: () => JSON.stringify(session, null, 2), clear,
  };
}
