import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolTextResponse } from "../../factory.js";
import { maxOutputCharsSchema } from "../../schemas.js";

type ResourceCategory = "official" | "engine" | "cloud" | "luau" | "history" | "raw" | "community";

type RobloxApiResource = {
  id: string;
  name: string;
  categories: ResourceCategory[];
  authority: "official" | "community";
  url: string;
  description: string;
  template?: string;
  note?: string;
};

const RESOURCES: RobloxApiResource[] = [
  {
    id: "creator-docs",
    name: "Roblox Creator Hub documentation",
    categories: ["official", "engine", "cloud"],
    authority: "official",
    url: "https://create.roblox.com/docs",
    description: "Primary Roblox creator documentation index.",
  },
  {
    id: "creator-docs-llms",
    name: "Roblox Creator Hub AI documentation index",
    categories: ["official", "engine", "cloud"],
    authority: "official",
    url: "https://create.roblox.com/docs/llms.txt",
    description: "Machine-friendly Creator Hub documentation index intended for agents/LLMs.",
  },
  {
    id: "engine-api",
    name: "Roblox Engine API reference",
    categories: ["official", "engine"],
    authority: "official",
    url: "https://create.roblox.com/docs/reference/engine",
    description: "Official classes, data types, enums, globals, libraries, members, security and release notes.",
    template: "Class: https://create.roblox.com/docs/reference/engine/classes/{ClassName}",
  },
  {
    id: "engine-api-llms",
    name: "Roblox Engine API AI index",
    categories: ["official", "engine"],
    authority: "official",
    url: "https://create.roblox.com/docs/reference/engine/llms.txt",
    description: "Machine-friendly index for the official Engine API reference.",
  },
  {
    id: "cloud-api",
    name: "Roblox Open Cloud / HTTP API reference",
    categories: ["official", "cloud"],
    authority: "official",
    url: "https://create.roblox.com/docs/cloud",
    description: "Official Open Cloud and documented Roblox HTTP APIs, grouped by feature and by domain.",
    note: "Prefer API-key/OAuth endpoints when available; legacy cookie APIs have weaker stability guarantees.",
  },
  {
    id: "cloud-api-llms",
    name: "Roblox Cloud API AI index",
    categories: ["official", "cloud"],
    authority: "official",
    url: "https://create.roblox.com/docs/cloud/llms.txt",
    description: "Machine-friendly index for Roblox Cloud/Open Cloud documentation.",
  },
  {
    id: "cloud-domains",
    name: "Roblox Cloud API reference by domain",
    categories: ["official", "cloud"],
    authority: "official",
    url: "https://create.roblox.com/docs/cloud/reference/domains",
    description: "Domain-oriented index for documented endpoints such as games.roblox.com, groups.roblox.com and catalog.roblox.com.",
    template: "Domain: https://create.roblox.com/docs/cloud/reference/domains/{domainSlug}",
  },
  {
    id: "cloud-features",
    name: "Roblox Cloud API reference by feature",
    categories: ["official", "cloud"],
    authority: "official",
    url: "https://create.roblox.com/docs/cloud/reference/features",
    description: "Use-case oriented endpoint index for users, groups, universes, places, assets and other features.",
    template: "Feature: https://create.roblox.com/docs/cloud/reference/features/{featureSlug}",
  },
  {
    id: "robloxapi-ref",
    name: "Roblox API Reference",
    categories: ["engine", "history", "community"],
    authority: "community",
    url: "https://robloxapi.github.io/ref/",
    description: "Fast community Engine API reference with class/member history, tags, security and thread-safety metadata.",
    template: "Class: https://robloxapi.github.io/ref/class/{ClassName}.html | Enum: https://robloxapi.github.io/ref/enum/{EnumName}.html",
  },
  {
    id: "maximumadhd-api-history",
    name: "MaximumADHD Roblox API History",
    categories: ["engine", "history", "community"],
    authority: "community",
    url: "https://maximumadhd.github.io/Roblox-API-History.html",
    description: "Chronological engine API changes across Roblox versions; useful for additions, removals and security/tag changes.",
  },
  {
    id: "client-tracker",
    name: "MaximumADHD Roblox Client Tracker",
    categories: ["engine", "history", "raw", "community"],
    authority: "community",
    url: "https://github.com/MaximumADHD/Roblox-Client-Tracker",
    description: "Current client-tracking repository containing API dumps and other extracted client metadata.",
  },
  {
    id: "api-dump-json",
    name: "Current Roblox API-Dump.json",
    categories: ["engine", "raw", "community"],
    authority: "community",
    url: "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json",
    description: "Machine-readable current JSON API dump from the Roblox Client Tracker.",
  },
  {
    id: "full-api-dump-json",
    name: "Current Roblox Full-API-Dump.json",
    categories: ["engine", "raw", "community"],
    authority: "community",
    url: "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/Full-API-Dump.json",
    description: "More complete machine-readable API dump including classes/enums omitted from the standard dump and extra metadata.",
  },
  {
    id: "anaminus-api",
    name: "Anaminus ROBLOX API Reference",
    categories: ["engine", "history", "community"],
    authority: "community",
    url: "https://anaminus.github.io/api/",
    description: "Historical API-dump-based browser; useful as a secondary cross-check for older API versions.",
    note: "Prefer Creator Hub and robloxapi.github.io for current behavior.",
  },
  {
    id: "anaminus-client-data",
    name: "Anaminus ROBLOX Client Data",
    categories: ["engine", "raw", "history", "community"],
    authority: "community",
    url: "https://anaminus.github.io/rbx/",
    description: "Historical client-data/API-dump archive and information about retrieving Roblox API dump data.",
  },
  {
    id: "luau",
    name: "Luau language documentation",
    categories: ["official", "luau"],
    authority: "official",
    url: "https://luau.org/",
    description: "Official Luau language documentation for syntax, types, runtime behavior and language features.",
  },
  {
    id: "luau-library",
    name: "Luau standard library",
    categories: ["official", "luau"],
    authority: "official",
    url: "https://luau.org/library/",
    description: "Official Luau builtin/standard-library reference.",
  },
  {
    id: "creator-docs-source",
    name: "Roblox creator-docs source repository",
    categories: ["official", "engine", "community"],
    authority: "official",
    url: "https://github.com/Roblox/creator-docs",
    description: "Open-source source tree behind Creator Hub guides and a read-only Engine API reference snapshot.",
  },
  {
    id: "devforum-api-index",
    name: "DevForum community Roblox API endpoint index",
    categories: ["cloud", "community"],
    authority: "community",
    url: "https://devforum.roblox.com/t/all-of-robloxs-apis/2290645",
    description: "Community-maintained/legacy list of Roblox web API domains.",
    note: "May be stale. Cross-check every endpoint against the current Creator Hub Cloud reference before relying on it.",
  },
];

const ALLOWED_HOSTS = new Set([
  "create.roblox.com",
  "robloxapi.github.io",
  "maximumadhd.github.io",
  "anaminus.github.io",
  "luau.org",
  "www.luau.org",
  "devforum.roblox.com",
]);

function isAllowedRawGitHub(url: URL): boolean {
  if (url.hostname !== "raw.githubusercontent.com") return false;
  return (
    url.pathname.startsWith("/MaximumADHD/Roblox-Client-Tracker/") ||
    url.pathname.startsWith("/Roblox/creator-docs/")
  );
}

function isAllowedGitHub(url: URL): boolean {
  if (url.hostname !== "github.com") return false;
  return (
    url.pathname === "/MaximumADHD/Roblox-Client-Tracker" ||
    url.pathname.startsWith("/MaximumADHD/Roblox-Client-Tracker/") ||
    url.pathname === "/Roblox/creator-docs" ||
    url.pathname.startsWith("/Roblox/creator-docs/")
  );
}

function validateReferenceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS Roblox reference URLs are allowed.");
  }
  if (!ALLOWED_HOSTS.has(url.hostname) && !isAllowedRawGitHub(url) && !isAllowedGitHub(url)) {
    throw new Error(`Host/path is not in the Roblox reference allowlist: ${url.hostname}${url.pathname}`);
  }
  return url;
}

async function fetchAllowed(url: URL, timeoutMs: number): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/plain,text/markdown,application/json,text/html;q=0.9,*/*;q=0.5",
          "User-Agent": "roblox-mcp-bridge-reference-fetcher/1.0",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Reference server returned HTTP ${response.status} without a redirect location.`);
      current = validateReferenceUrl(new URL(location, current).toString());
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects while fetching Roblox reference URL.");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatResources(resources: RobloxApiResource[]): string {
  const lines = [
    "Roblox API/reference source directory",
    "Priority: official Creator Hub/Luau first; robloxapi.github.io for fast engine metadata/history; MaximumADHD history/client tracker for version diffs/raw dumps; older community references only as cross-checks.",
    "",
  ];

  for (const resource of resources) {
    lines.push(`[${resource.id}] ${resource.name} (${resource.authority})`);
    lines.push(resource.url);
    lines.push(resource.description);
    if (resource.template) lines.push(`Template: ${resource.template}`);
    if (resource.note) lines.push(`Note: ${resource.note}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export default function register(server: McpServer): void {
  server.registerTool(
    "get-roblox-api-resources",
    {
      title: "Get Roblox API reference resources",
      description:
        "Return curated official and community Roblox API/documentation providers, AI indexes, API history, and machine-readable dumps. Use before guessing an Engine API, Luau builtin, Open Cloud/web endpoint, security tag, or version-history detail.",
      inputSchema: z.object({
        category: z.enum(["all", "official", "engine", "cloud", "luau", "history", "raw", "community"]).optional().default("all"),
        query: z.string().max(200).optional().describe("Optional case-insensitive filter across id, name, description and URL."),
        maxOutputChars: maxOutputCharsSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ category, query, maxOutputChars }) => {
      const needle = query?.trim().toLowerCase();
      const filtered = RESOURCES.filter((resource) => {
        if (category !== "all" && !resource.categories.includes(category as ResourceCategory)) return false;
        if (!needle) return true;
        return [resource.id, resource.name, resource.description, resource.url, resource.template, resource.note]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      });
      return toolTextResponse(
        filtered.length > 0 ? formatResources(filtered) : "No Roblox API resources matched the requested filters.",
        {
          maxOutputChars,
          truncationHint: "Rerun get-roblox-api-resources with a category or query filter.",
        }
      );
    }
  );

  server.registerTool(
    "fetch-roblox-api-reference",
    {
      title: "Fetch Roblox API reference",
      description:
        "Fetch a public page/file from the vetted Roblox API reference providers returned by get-roblox-api-resources. Supports Creator Hub/LLM indexes, robloxapi.github.io, MaximumADHD history/raw API dumps, Anaminus references, Luau docs and selected DevForum reference pages. Never sends authentication or cookies.",
      inputSchema: z.object({
        url: z.string().url().max(2000),
        timeoutMs: z.number().int().min(1000).max(20000).optional().default(10000),
        maxDownloadBytes: z.number().int().min(1024).max(8 * 1024 * 1024).optional().default(2 * 1024 * 1024),
        maxOutputChars: maxOutputCharsSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url: rawUrl, timeoutMs, maxDownloadBytes, maxOutputChars }) => {
      try {
        const url = validateReferenceUrl(rawUrl);
        const response = await fetchAllowed(url, timeoutMs);
        if (!response.ok) {
          return toolTextResponse(`Failed to fetch ${url.toString()}: HTTP ${response.status} ${response.statusText}`, {}, true);
        }

        const advertisedLength = Number(response.headers.get("content-length") ?? "0");
        if (advertisedLength > maxDownloadBytes) {
          return toolTextResponse(
            `Reference is ${advertisedLength} bytes, above maxDownloadBytes=${maxDownloadBytes}. Increase maxDownloadBytes only if the larger source is necessary.`,
            {},
            true
          );
        }

        const body = await response.arrayBuffer();
        if (body.byteLength > maxDownloadBytes) {
          return toolTextResponse(
            `Reference download reached ${body.byteLength} bytes, above maxDownloadBytes=${maxDownloadBytes}.`,
            {},
            true
          );
        }

        const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
        let text = new TextDecoder("utf-8", { fatal: false }).decode(body);
        if (contentType.includes("text/html") || /<html\b/i.test(text.slice(0, 1000))) {
          text = htmlToText(text);
        }

        const header = [
          `Source: ${url.toString()}`,
          `Content-Type: ${contentType || "unknown"}`,
          `Downloaded: ${body.byteLength} bytes`,
          "",
        ].join("\n");

        return toolTextResponse(header + text, {
          maxOutputChars,
          truncationHint: "Fetch a narrower provider page (for example one class/enum/domain) instead of a large index or dump.",
        });
      } catch (error) {
        return toolTextResponse(`Failed to fetch Roblox API reference: ${(error as Error).message || error}`, {}, true);
      }
    }
  );
}
