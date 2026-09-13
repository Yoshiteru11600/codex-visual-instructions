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
  clone.querySelectorAll("script, [data-codex-visual-instructions]").forEach((node) => node.remove());
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
