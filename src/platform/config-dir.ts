import os from "node:os";
import path from "node:path";

export function getRobloxMcpConfigDir(): string {
  const isAndroid =
    process.platform === "android" ||
    Boolean(process.env.ANDROID_ROOT || process.env.ANDROID_DATA);

  if (isAndroid) {
    const sharedRoot = process.env.EXTERNAL_STORAGE || "/storage/emulated/0";
    return path.join(sharedRoot, "Android MCP");
  }

  return path.join(os.homedir(), ".roblox-mcp");
}
