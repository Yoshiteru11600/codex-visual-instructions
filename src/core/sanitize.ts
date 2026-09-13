const SECRET_NAME = /(password|passwd|secret|token|authorization|cookie|api[-_]?key)/i;

export function sanitizeElementMetadata(element: Element): Record<string, string> {
  const output: Record<string, string> = {};
  for (const attribute of [...element.attributes]) {
    if (SECRET_NAME.test(attribute.name) || SECRET_NAME.test(attribute.value)) continue;
    if (attribute.name === "value" && element instanceof HTMLInputElement) continue;
    if (["id", "class", "href", "role", "aria-label", "data-testid"].includes(attribute.name)) {
      output[attribute.name] = attribute.value.slice(0, 200);
    }
  }
  return output;
}

export function sanitizeSnapshot(documentElement: Element): string {
  const clone = documentElement.cloneNode(true) as Element;
  clone.querySelectorAll("script, iframe, object, embed, base, link, [data-codex-visual-instructions]").forEach((node) => node.remove());
  clone.querySelectorAll("meta[http-equiv]").forEach((node) => {
    if (node.getAttribute("http-equiv")?.toLowerCase() === "refresh") node.remove();
  });
  clone.querySelectorAll("form").forEach((form) => form.replaceWith(...form.childNodes));
  clone.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on") || ["src", "srcset", "poster", "ping", "action", "formaction", "href"].includes(attribute.name.toLowerCase())) {
        node.removeAttribute(attribute.name);
      }
    }
    const inlineStyle = node.getAttribute("style");
    if (inlineStyle) node.setAttribute("style", stripExternalCss(inlineStyle));
  });
  clone.querySelectorAll("style").forEach((node) => { node.textContent = stripExternalCss(node.textContent ?? ""); });
  clone.querySelectorAll("input, textarea").forEach((node) => {
    node.removeAttribute("value");
    if (node instanceof HTMLTextAreaElement) node.textContent = "";
  });
  clone.querySelectorAll("[type=hidden], [name], [id]").forEach((node) => {
    const marker = `${node.getAttribute("name") ?? ""} ${node.id}`;
    if (SECRET_NAME.test(marker)) node.remove();
  });
  return `<!doctype html>${clone.outerHTML}`;
}

function stripExternalCss(css: string): string {
  return css
    .replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*;?/gi, "")
    .replace(/url\(\s*(?:["'][^"']*["']|[^)]*)\s*\)/gi, "none");
}
