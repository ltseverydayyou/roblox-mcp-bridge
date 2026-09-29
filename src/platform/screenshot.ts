import {
  isSupported as isWindowsSupported,
  performScreenshot as performWindowsScreenshot,
  type ScreenshotResult,
} from "./windows-screenshot.js";

const ANDROID_SCREENSHOT_URL = "http://127.0.0.1:17654/screenshot";

export type { ScreenshotResult } from "./windows-screenshot.js";

export function isAndroidRuntime(): boolean {
  return (
    process.platform === "android" ||
    Boolean(process.env.ANDROID_ROOT || process.env.ANDROID_DATA)
  );
}

export function isSupported(): boolean {
  return isWindowsSupported() || isAndroidRuntime();
}

export async function performScreenshot(pid?: number, maxWidth?: number): Promise<ScreenshotResult> {
  if (isWindowsSupported()) {
    return performWindowsScreenshot(pid, maxWidth);
  }

  if (!isAndroidRuntime()) {
    return { error: `Screenshots are not supported on ${process.platform}.` };
  }

  const width = Math.max(320, Math.min(Math.floor(maxWidth || 1280), 3840));
  try {
    const response = await fetch(`${ANDROID_SCREENSHOT_URL}?maxWidth=${width}`);
    const result = (await response.json()) as ScreenshotResult;
    if (!response.ok && !result.error) {
      return { error: `Android screenshot service returned HTTP ${response.status}.` };
    }
    return result;
  } catch (error) {
    return {
      error:
        "Android screenshot capture is unavailable. Enable Roblox MCP Manager under Android Settings > Accessibility > Installed apps, then retry. " +
        `(${(error as Error).message || error})`,
    };
  }
}
