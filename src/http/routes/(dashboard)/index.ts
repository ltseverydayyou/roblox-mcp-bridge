import fs from "fs";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { WS_PORT } from "../../../config.js";
import { assetsDir } from "../../paths.js";

const htmlPath = path.join(assetsDir, "dashboard", "index.html");

const sourceFetchUiScript = `
<script>
(() => {
  const originalOpenScriptSource = window.openScriptSource;
  if (typeof originalOpenScriptSource !== "function") return;

  window.openScriptSource = async function(debugId, lineNumber = null) {
    const row = Array.from(document.querySelectorAll(".scripts-frow[data-debug-id]"))
      .find((element) => element.dataset.debugId === debugId);
    const badge = row?.querySelector(".scripts-source-unavailable") || null;
    const previousText = badge?.textContent || "source unavailable";
    const previousTitle = badge?.getAttribute("title") || "";

    if (badge) {
      badge.textContent = "fetching...";
      badge.setAttribute("title", "Fetching and decompiling source from the connected client...");
    }

    let loaded = false;
    try {
      const result = await originalOpenScriptSource(debugId, lineNumber);
      loaded = typeof scriptsViewingFileSourceAvailable !== "undefined"
        && scriptsViewingFile === debugId
        && scriptsViewingFileSourceAvailable === true;

      if (loaded && typeof fetchScripts === "function") {
        Promise.resolve(fetchScripts()).catch(() => {});
      }

      return result;
    } finally {
      if (!loaded && badge && badge.isConnected) {
        badge.textContent = previousText;
        if (previousTitle) badge.setAttribute("title", previousTitle);
        else badge.removeAttribute("title");
      }
    }
  };
})();
</script>`;

let cachedHtml: string | null = null;

function loadHtml(): string {
  if (cachedHtml !== null) return cachedHtml;
  const raw = fs.readFileSync(htmlPath, "utf-8");
  cachedHtml = raw
    .replace(/\{\{WS_PORT\}\}/g, String(WS_PORT))
    .replace("</body>", `${sourceFetchUiScript}\n</body>`);
  return cachedHtml;
}

export function GET(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(loadHtml());
}
