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


const overviewGameUiScript = `
<style>
.info-card-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.info-card-label-row .info-card-label { margin-bottom: 0; }
.info-card-copy-btn { appearance: none; border: 1px solid var(--border); background: var(--surface-raised); color: var(--text-secondary); border-radius: 5px; padding: 2px 7px; font: 600 10px/1.4 var(--font); cursor: pointer; transition: border-color var(--transition), color var(--transition), background var(--transition); }
.info-card-copy-btn:hover { border-color: var(--border-light); color: var(--text); background: var(--surface-hover); }
.info-card-copy-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
<script>
(() => {
  const cards = document.querySelector(".overview-cards");
  const placeValue = document.getElementById("overviewPlaceId");
  const placeCard = placeValue?.closest(".info-card");
  if (!cards || !placeCard) return;

  const makeCopyButton = (field, label) => {
    const button = document.createElement("button");
    button.className = "info-card-copy-btn";
    button.type = "button";
    button.textContent = "Copy";
    button.title = "Copy " + label;
    button.addEventListener("click", () => {
      const client = clients.find((entry) => entry.clientId === selectedClientId);
      const value = client?.[field];
      if (value === undefined || value === null || value === "") return;
      copyText(String(value), label);
    });
    return button;
  };

  const placeLabel = placeCard.querySelector(".info-card-label");
  if (placeLabel && !placeCard.querySelector(".info-card-copy-btn")) {
    const row = document.createElement("div");
    row.className = "info-card-label-row";
    placeLabel.before(row);
    row.append(placeLabel, makeCopyButton("placeId", "Place ID"));
  }

  let gameValue = document.getElementById("overviewGameId");
  if (!gameValue) {
    const gameCard = document.createElement("div");
    gameCard.className = "info-card";
    const row = document.createElement("div");
    row.className = "info-card-label-row";
    const label = document.createElement("div");
    label.className = "info-card-label";
    label.textContent = "Game ID";
    row.append(label, makeCopyButton("gameId", "Game ID"));
    gameValue = document.createElement("div");
    gameValue.className = "info-card-value info-card-value--mono";
    gameValue.id = "overviewGameId";
    gameValue.textContent = "—";
    gameCard.append(row, gameValue);
    placeCard.after(gameCard);
  }

  const refreshGameId = () => {
    const client = clients.find((entry) => entry.clientId === selectedClientId);
    gameValue.textContent = client?.gameId || "—";
  };

  if (typeof window.updateOverview === "function") {
    const originalUpdateOverview = window.updateOverview;
    window.updateOverview = function(...args) {
      const result = originalUpdateOverview.apply(this, args);
      refreshGameId();
      return result;
    };
  }
  refreshGameId();
})();
</script>`;

let cachedHtml: string | null = null;

function loadHtml(): string {
  if (cachedHtml !== null) return cachedHtml;
  const raw = fs.readFileSync(htmlPath, "utf-8");
  cachedHtml = raw
    .replace(/\{\{WS_PORT\}\}/g, String(WS_PORT))
    .replace("</body>", `${sourceFetchUiScript}\n${overviewGameUiScript}\n</body>`);
  return cachedHtml;
}

export function GET(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(loadHtml());
}
