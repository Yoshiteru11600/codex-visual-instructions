import { randomBytes } from "node:crypto";
import type { BridgePairingDescriptor } from "../types";

export class PairingSession {
  readonly pairingToken: string;
  readonly expiresAt: string;
  private used = false;
  private runtimeToken: string | null = null;
  private readonly now: () => number;
  constructor(readonly endpoint: string, readonly allowedOrigin: string, readonly workspace: string, options: { now?: () => number; random?: () => string; ttlMs?: number } = {}) {
    this.now = options.now ?? Date.now; const random = options.random ?? (() => randomBytes(32).toString("base64url"));
    this.pairingToken = random(); this.expiresAt = new Date(this.now() + (options.ttlMs ?? 300_000)).toISOString();
  }
  descriptor(): BridgePairingDescriptor { return { version: 1, endpoint: this.endpoint, pairingToken: this.pairingToken, allowedOrigin: this.allowedOrigin, workspace: this.workspace, expiresAt: this.expiresAt }; }
  verify(token: string, now = this.now()): "valid" | "expired" | "used" | "invalid" {
    if (token !== this.pairingToken) return "invalid";
    if (this.used) return "used";
    if (now >= Date.parse(this.expiresAt)) return "expired";
    return "valid";
  }
  approve(token: string, random = () => randomBytes(32).toString("base64url")): string {
    const result = this.verify(token); if (result !== "valid") throw new Error(result);
    this.used = true; this.runtimeToken = random(); return this.runtimeToken;
  }
  isRuntimeToken(token: string): boolean { return Boolean(this.runtimeToken && token === this.runtimeToken); }
  isApproved(): boolean { return this.runtimeToken !== null; }
  invalidate(): void { this.runtimeToken = null; this.used = true; }
}
