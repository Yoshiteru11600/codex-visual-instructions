#!/usr/bin/env node
import { resolve } from "node:path";
import { startBridge } from "./http-server";

const valueAfter = (name: string): string | undefined => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const workspace = resolve(valueAfter("--workspace") ?? process.cwd());
const origins = process.argv.flatMap((value, index) => value === "--origin" && process.argv[index + 1] ? [process.argv[index + 1]!] : []);
if (!origins.length) throw new Error("At least one exact --origin is required");
const codexCli = valueAfter("--codex-cli");
const bridge = await startBridge({ workspace, origins, ...(codexCli ? { codexCli } : {}) });
// This one-time descriptor is the handoff mechanism. Diagnostics never include the token.
process.stdout.write(`${JSON.stringify({ endpoint: `http://127.0.0.1:${bridge.port}`, capabilityToken: bridge.token })}\n`);
const close = async (): Promise<void> => { await bridge.close(); process.exit(0); };
process.once("SIGINT", () => { void close(); }); process.once("SIGTERM", () => { void close(); });
