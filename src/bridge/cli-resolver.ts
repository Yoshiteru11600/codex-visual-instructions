import { access, readdir, stat } from "node:fs/promises";
import { delimiter, extname, join } from "node:path";

const existingFile = async (path: string): Promise<boolean> => {
  try { await access(path); return (await stat(path)).isFile(); } catch { return false; }
};

async function resolveWindowsDesktopCli(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const localAppData = env.LOCALAPPDATA;
  if (!localAppData) return undefined;
  const binRoot = join(localAppData, "OpenAI", "Codex", "bin");
  const direct = join(binRoot, "codex.exe");
  if (await existingFile(direct)) return direct;
  try {
    const candidates = await Promise.all((await readdir(binRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const executable = join(binRoot, entry.name, "codex.exe");
        return await existingFile(executable) ? { executable, modified: (await stat(executable)).mtimeMs } : undefined;
      }));
    return candidates.filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .sort((left, right) => right.modified - left.modified)[0]?.executable;
  } catch { return undefined; }
}

export async function resolveCodexCli(explicit?: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<string> {
  if (explicit) { await access(explicit); return explicit; }
  const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat", "codex"] : ["codex"];
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(directory.replace(/^"|"$/g, ""), name);
      try { await access(candidate); return candidate; } catch { /* next */ }
    }
  }
  if (platform === "win32") {
    const desktopCli = await resolveWindowsDesktopCli(env);
    if (desktopCli) return desktopCli;
  }
  throw new Error("Codex CLI was not found. Configure --codex-cli or add codex to PATH.");
}

export function codexSpawnCommand(executable: string): { command: string; args: string[]; shell: boolean } {
  const shell = process.platform === "win32" && [".cmd", ".bat"].includes(extname(executable).toLowerCase());
  return { command: executable, args: ["app-server"], shell };
}
