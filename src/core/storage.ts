import type { ReviewSession } from "../types";

export class SessionStorage {
  constructor(private readonly key: string) {}

  save(session: ReviewSession): void {
    try { localStorage.setItem(this.key, JSON.stringify(session)); } catch { /* storage may be disabled */ }
  }

  clear(): void {
    try { localStorage.removeItem(this.key); } catch { /* storage may be disabled */ }
  }
}
