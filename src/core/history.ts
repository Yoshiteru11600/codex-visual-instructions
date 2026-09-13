export interface HistoryEntry {
  label: string;
  redo(): void;
  undo(): void;
}

export class HistoryStack {
  #past: HistoryEntry[] = [];
  #future: HistoryEntry[] = [];

  execute(entry: HistoryEntry): void {
    entry.redo();
    this.#past.push(entry);
    this.#future = [];
  }

  undo(): boolean {
    const entry = this.#past.pop();
    if (!entry) return false;
    entry.undo();
    this.#future.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.#future.pop();
    if (!entry) return false;
    entry.redo();
    this.#past.push(entry);
    return true;
  }

  clear(): void {
    this.#past = [];
    this.#future = [];
  }

  get canUndo(): boolean { return this.#past.length > 0; }
  get canRedo(): boolean { return this.#future.length > 0; }
}
