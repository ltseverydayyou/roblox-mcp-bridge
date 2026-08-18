# Roblox API reference sources for MCP agents

The bridge exposes two read-only MCP tools:

- `get-roblox-api-resources` returns this curated source directory with filters.
- `fetch-roblox-api-reference` downloads a public reference page/file from a strict allowlist. It never sends Roblox cookies, API keys, or other authentication.

## Preferred order

1. **Official Roblox Creator Hub / Luau** for current documented behavior.
2. **Roblox API Reference (`robloxapi.github.io`)** for a compact engine reference, history, security and thread-safety metadata.
3. **MaximumADHD API History / Roblox Client Tracker** for release-to-release changes and raw API dumps.
4. **Anaminus / DevForum community references** only as secondary or historical cross-checks.

## Official Roblox / Luau

- Creator Hub docs: https://create.roblox.com/docs
- Creator Hub AI index: https://create.roblox.com/docs/llms.txt
- Engine API: https://create.roblox.com/docs/reference/engine
- Engine API AI index: https://create.roblox.com/docs/reference/engine/llms.txt
- Engine class template: `https://create.roblox.com/docs/reference/engine/classes/{ClassName}`
- Open Cloud / documented HTTP APIs: https://create.roblox.com/docs/cloud
- Cloud AI index: https://create.roblox.com/docs/cloud/llms.txt
- Cloud reference by domain: https://create.roblox.com/docs/cloud/reference/domains
- Cloud reference by feature: https://create.roblox.com/docs/cloud/reference/features
- Luau: https://luau.org/
- Luau standard library: https://luau.org/library/
- Creator docs source: https://github.com/Roblox/creator-docs

## Community / raw engine data

- Roblox API Reference: https://robloxapi.github.io/ref/
- Class template: `https://robloxapi.github.io/ref/class/{ClassName}.html`
- Enum template: `https://robloxapi.github.io/ref/enum/{EnumName}.html`
- MaximumADHD Roblox API History: https://maximumadhd.github.io/Roblox-API-History.html
- Roblox Client Tracker: https://github.com/MaximumADHD/Roblox-Client-Tracker
- Current API dump: https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json
- Current full API dump: https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/Full-API-Dump.json
- Anaminus API reference: https://anaminus.github.io/api/
- Anaminus client data: https://anaminus.github.io/rbx/
- Older DevForum API-domain index: https://devforum.roblox.com/t/all-of-robloxs-apis/2290645

The DevForum list and older Anaminus material can be stale. The agent should cross-check them against current Creator Hub documentation before relying on an endpoint or engine behavior.
