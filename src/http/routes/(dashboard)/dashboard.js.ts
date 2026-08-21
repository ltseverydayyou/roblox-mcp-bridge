import fs from "fs";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { assetsDir } from "../../paths.js";

const assetPath = path.join(assetsDir, "dashboard", "dashboard.js");

let cached: string | null = null;

export function GET(_req: IncomingMessage, res: ServerResponse): void {
  if (cached === null) cached = fs.readFileSync(assetPath, "utf-8");
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(cached);
}
