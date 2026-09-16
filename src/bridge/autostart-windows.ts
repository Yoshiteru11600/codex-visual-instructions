import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AutostartAdapter, AutostartOptions } from "./autostart";

const SHORTCUT = "CodexVisualBridge.lnk";
const encodePowerShell = (script: string): string => Buffer.from(script, "utf16le").toString("base64");
const literal = (value: string): string => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value).toString("base64")}'))`;

export function createWindowsAutostart(options: Required<Pick<AutostartOptions, "executable" | "cliPath" | "env">> & Pick<AutostartOptions, "run">): AutostartAdapter {
  const run = options.run!; const path = join(options.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", SHORTCUT); const argumentsValue = `"${options.cliPath}" daemon`;
  const inspect = async (): Promise<"missing" | "match" | "foreign"> => {
    const script = `$p=${literal(path)};if(!(Test-Path -LiteralPath $p)){Write-Output 'missing';exit 0};$s=(New-Object -ComObject WScript.Shell).CreateShortcut($p);if($s.TargetPath -eq ${literal(options.executable)} -and $s.Arguments -eq ${literal(argumentsValue)}){Write-Output 'match'}else{Write-Output 'foreign'}`;
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)]); if (result.code !== 0) throw new Error("Unable to inspect current-user autostart shortcut"); return result.stdout.trim() as "missing" | "match" | "foreign";
  };
  return {
    status: async () => { try { return await inspect() === "match" ? "enabled" : "disabled"; } catch { return "unavailable"; } },
    install: async () => {
      const current = await inspect(); if (current === "match") return; if (current === "foreign") throw new Error(`${SHORTCUT} exists but is not managed by Codex Visual Bridge`);
      const script = `$p=${literal(path)};$s=(New-Object -ComObject WScript.Shell).CreateShortcut($p);$s.TargetPath=${literal(options.executable)};$s.Arguments=${literal(argumentsValue)};$s.WorkingDirectory=${literal(dirname(options.cliPath))};$s.WindowStyle=7;$s.Description='Codex Visual Bridge current-user controller';$s.Save()`;
      const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)]); if (result.code !== 0) throw new Error(`Unable to register current-user autostart${result.stderr.trim() ? `: ${result.stderr.trim()}` : ""}`);
    },
    remove: async () => { const current = await inspect(); if (current === "missing") return; if (current === "foreign") throw new Error(`${SHORTCUT} is not managed by Codex Visual Bridge`); await rm(path, { force: true }); },
  };
}
