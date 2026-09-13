import type { ElementFingerprint } from "../types";

const escapeCss = (value: string): string =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

export function safeTextSummary(element: Element, limit = 120): string | undefined {
  if (element instanceof HTMLInputElement) {
    if (["password", "hidden"].includes(element.type)) return undefined;
    return element.getAttribute("placeholder")?.slice(0, limit);
  }
  const text = element.textContent?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, limit) : undefined;
}

export function cssSelectorFor(element: Element): string {
  if (element.id) return `#${escapeCss(element.id)}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement && parts.length < 6) {
    let part = current.tagName.toLowerCase();
    const classes = [...current.classList].filter((name) => !name.startsWith("cvi-")).slice(0, 2);
    if (classes.length) part += classes.map((name) => `.${escapeCss(name)}`).join("");
    const parent: Element | null = current.parentElement;
    if (parent) {
      const peers = [...parent.children].filter((child) => child.tagName === current!.tagName);
      if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(" > ");
}

export function domPathFor(element: Element): string {
  const indices: number[] = [];
  let current: Element | null = element;
  while (current?.parentElement) {
    indices.unshift([...current.parentElement.children].indexOf(current));
    current = current.parentElement;
  }
  return indices.join("/");
}

export function fingerprintElement(element: Element): ElementFingerprint {
  const id = element.id || undefined;
  const classes = [...element.classList].filter((name) => !name.startsWith("cvi-")).slice(0, 8);
  const testId = element.getAttribute("data-testid") ?? undefined;
  const ariaLabel = element.getAttribute("aria-label")?.slice(0, 120) || undefined;
  const textSnippet = safeTextSummary(element);
  return {
    tagName: element.tagName.toLowerCase(),
    cssSelector: cssSelectorFor(element),
    domPath: domPathFor(element),
    ...(id ? { id } : {}),
    ...(classes.length ? { classes } : {}),
    ...(testId ? { testId } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
    ...(textSnippet ? { textSnippet } : {}),
  };
}

export function resolveFingerprint(fingerprint: ElementFingerprint, root: ParentNode = document): Element | null {
  const candidates = [
    fingerprint.id ? `#${escapeCss(fingerprint.id)}` : undefined,
    fingerprint.testId ? `[data-testid="${fingerprint.testId.replace(/"/g, '\\"')}"]` : undefined,
    fingerprint.ariaLabel ? `[aria-label="${fingerprint.ariaLabel.replace(/"/g, '\\"')}"]` : undefined,
    fingerprint.cssSelector,
  ].filter((value): value is string => Boolean(value));
  for (const selector of candidates) {
    try {
      const match = root.querySelector(selector);
      if (match?.tagName.toLowerCase() === fingerprint.tagName) return match;
    } catch { /* malformed selectors remain unresolved */ }
  }
  return null;
}
