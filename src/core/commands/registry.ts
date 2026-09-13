import type { CommandId, ShortcutConfig } from "../../types";

export type CommandHandler = () => void;

export class CommandRegistry {
  readonly #commands = new Map<CommandId, CommandHandler>();

  register(id: CommandId, handler: CommandHandler): () => void {
    this.#commands.set(id, handler);
    return () => this.#commands.delete(id);
  }

  execute(id: CommandId): boolean {
    const command = this.#commands.get(id);
    if (!command) return false;
    command();
    return true;
  }
}

const normalizePart = (part: string): string => {
  const lower = part.trim().toLowerCase();
  if (lower === "control" || lower === "cmdorctrl" || lower === "cmd") return "ctrl";
  if (lower === "option") return "alt";
  return lower;
};

export function normalizeShortcut(shortcut: string): string {
  const ordering = ["ctrl", "alt", "shift", "meta"];
  const parts = shortcut.split("+").map(normalizePart).filter(Boolean);
  return [
    ...ordering.filter((modifier) => parts.includes(modifier)),
    ...parts.filter((part) => !ordering.includes(part)),
  ].join("+");
}

export function shortcutFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("meta");
  const key = event.key.toLowerCase();
  if (!['control', 'alt', 'shift', 'meta'].includes(key)) parts.push(key);
  return normalizeShortcut(parts.join("+"));
}

export function commandForEvent(event: KeyboardEvent, shortcuts: ShortcutConfig): CommandId | undefined {
  const pressed = shortcutFromEvent(event);
  return Object.entries(shortcuts).find(([, value]) => normalizeShortcut(value) === pressed)?.[0] as
    | CommandId
    | undefined;
}

export function findShortcutConflicts(shortcuts: ShortcutConfig): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  const browserReserved = new Set(["ctrl+l", "ctrl+t", "ctrl+w", "ctrl+r", "ctrl+shift+i", "meta+l", "meta+t", "meta+w"]);
  for (const [id, value] of Object.entries(shortcuts)) {
    const normalized = normalizeShortcut(value);
    const prior = seen.get(normalized);
    if (prior) conflicts.push(`${id} conflicts with ${prior}`);
    if (browserReserved.has(normalized)) conflicts.push(`${id} may conflict with a browser shortcut`);
    seen.set(normalized, id);
  }
  return conflicts;
}
