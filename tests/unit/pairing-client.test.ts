import { describe, expect, it } from "vitest";
import { BridgeClientError, parsePairingDescriptor } from "../../src/pairing-client";

const descriptor = (overrides: Record<string, unknown> = {}) => JSON.stringify({ version: 1, endpoint: "http://127.0.0.1:5182", pairingToken: "secret", allowedOrigin: "http://localhost:5173", workspace: "C:\\workspace\\app", expiresAt: "2030-01-01T00:00:00.000Z", ...overrides });
describe("pairing descriptor", () => {
  it("accepts an exact loopback descriptor", () => { expect(parsePairingDescriptor(descriptor(), "http://localhost:5173", Date.parse("2029-01-01"))).toMatchObject({ version: 1, pairingToken: "secret" }); });
  it.each(["http://example.com:5182", "http://localhost:5182", "http://127.0.0.1:5182/path", "http://u@127.0.0.1:5182", "http://127.0.0.1:5182?x=1"])("rejects endpoint %s", (endpoint) => { expect(() => parsePairingDescriptor(descriptor({ endpoint }), "http://localhost:5173", Date.parse("2029-01-01"))).toThrow(BridgeClientError); });
  it.each(["http://127.0.0.1:5173", "http://localhost:4173", "https://localhost:5173"])("rejects origin mismatch %s", (origin) => { expect(() => parsePairingDescriptor(descriptor(), origin, Date.parse("2029-01-01"))).toThrow(/does not match/); });
  it("rejects malformed, incomplete and expired values without echoing the token", () => { expect(() => parsePairingDescriptor("not json", "http://localhost:5173")).toThrow(/valid JSON/); try { parsePairingDescriptor(descriptor({ expiresAt: "2020-01-01T00:00:00.000Z" }), "http://localhost:5173"); } catch (error) { expect(String(error)).not.toContain("secret"); } });
});
