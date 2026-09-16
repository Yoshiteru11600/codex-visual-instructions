import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridge } from "../dist/bridge/index.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const positionalPort = process.argv.slice(2).find((value) => /^\d+$/.test(value));
const requestedPort = Number(argument("--port") ?? positionalPort ?? 0);
const workspace = resolve(argument("--workspace") ?? repositoryRoot);
const codexCli = argument("--codex-cli");

const reservePort = (port) => new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => {
    const address = probe.address();
    const selectedPort = typeof address === "object" && address ? address.port : port;
    probe.close((error) => error ? reject(error) : resolvePort(selectedPort));
  });
});

const port = await reservePort(Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : 0);
const origin = `http://127.0.0.1:${port}`;
const bridge = await startBridge({ workspace, origins: [origin], ...(codexCli ? { codexCli } : {}) });
const viteEntry = resolve(repositoryRoot, "node_modules/vite/bin/vite.js");
const vite = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  if (!vite.killed) vite.kill();
  await bridge.close();
};

vite.once("error", async (error) => {
  console.error(`Unable to start Vite: ${error.message}`);
  await close();
  process.exitCode = 1;
});
vite.once("exit", async (code) => {
  await close();
  process.exitCode = code ?? 0;
});
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });

console.log(`Visual Review development server: ${origin}/examples/vanilla/`);
console.log(`Pairing descriptor (shown once): ${JSON.stringify(bridge.descriptor)}`);
