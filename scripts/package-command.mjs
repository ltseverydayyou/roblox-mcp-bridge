import fsSync from "node:fs";
import path from "node:path";

const PACKAGE_COMMANDS = new Set(["npm", "pnpm"]);
const WINDOWS_NODE_CLI_PATHS = Object.freeze({
  claude: [
    ["node_modules", "@anthropic-ai", "claude-code", "cli.js"],
    ["node_modules", "@anthropic-ai", "claude-code", "cli.mjs"],
  ],
});
const WINDOWS_NATIVE_CLI_PATHS = Object.freeze({
  claude: [["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"]],
  code: [["..", "Code.exe"]],
});

export function resolvePackageCommand(command, args, options = {}) {
  const platform = options.platform || process.platform;
  const execPath = options.execPath || process.execPath;
  const environment = options.env || process.env;
  const fileExists = options.fileExists || fsSync.existsSync;
  const pathApi = platform === "win32" ? path.win32 : path;
  const commandName = pathApi.basename(String(command)).replace(/\.cmd$/i, "").toLowerCase();

  if (
    platform === "win32" &&
    String(command).toLowerCase().endsWith(".cmd") &&
    Object.hasOwn(WINDOWS_NATIVE_CLI_PATHS, commandName)
  ) {
    const shimDirectory = path.win32.dirname(command);
    const executable = WINDOWS_NATIVE_CLI_PATHS[commandName]
      .map((parts) => path.win32.resolve(shimDirectory, ...parts))
      .find((candidate) => fileExists(candidate));
    if (!executable && !Object.hasOwn(WINDOWS_NODE_CLI_PATHS, commandName)) {
      throw new Error(
        `Could not locate the ${commandName} executable behind ${command}. Reinstall ${commandName} and try again.`
      );
    }
    if (executable) return { command: executable, args: [...args], shell: false };
  }

  if (
    platform === "win32" &&
    String(command).toLowerCase().endsWith(".cmd") &&
    Object.hasOwn(WINDOWS_NODE_CLI_PATHS, commandName)
  ) {
    const shimDirectory = path.win32.dirname(command);
    const cliPath = WINDOWS_NODE_CLI_PATHS[commandName]
      .map((parts) => path.win32.join(shimDirectory, ...parts))
      .find((candidate) => fileExists(candidate));
    if (!cliPath) {
      throw new Error(
        `Could not locate the ${commandName} CLI behind ${command}. Reinstall ${commandName} and try again.`
      );
    }
    return { command: execPath, args: [cliPath, ...args], shell: false };
  }

  if (platform !== "win32" || !PACKAGE_COMMANDS.has(commandName)) {
    return {
      command,
      args: [...args],
      shell: platform === "win32" && String(command).toLowerCase().endsWith(".cmd"),
    };
  }

  const cliName = commandName === "npm" ? "npm-cli.js" : "pnpm.cjs";
  const configuredCli = String(environment.npm_execpath || "");
  const candidates = [
    pathApi.join(pathApi.dirname(execPath), "node_modules", "npm", "bin", cliName),
    pathApi.basename(configuredCli).toLowerCase() === cliName ? configuredCli : null,
    commandName === "pnpm" && environment.PNPM_HOME
      ? pathApi.join(environment.PNPM_HOME, cliName)
      : null,
  ].filter(Boolean);
  const cliPath = candidates.find((candidate) => fileExists(candidate));
  if (!cliPath) {
    throw new Error(
      `Could not locate ${cliName}. Reinstall Node.js with npm or make its CLI available on PATH.`
    );
  }
  return { command: execPath, args: [cliPath, ...args], shell: false };
}
