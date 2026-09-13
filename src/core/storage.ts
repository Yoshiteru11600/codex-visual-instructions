import type { ReviewSession } from "../types";

export class SessionStorage {
  constructor(private readonly key: string) {}

  save(session: ReviewSession): void {
    try { localStorage.setItem(this.key, JSON.stringify(session)); } catch { /* storage may be disabled */ }
  }

  load(): ReviewSession | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) as ReviewSession : null;
    } catch { return null; }
  }

  clear(): void {
    try { localStorage.removeItem(this.key); } catch { /* storage may be disabled */ }
  }
}
