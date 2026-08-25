import fs from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = "9d80f75345138d83284626b02cd9ab576f4fbc04";
const files = [
  "connector.luau",
  "src/http/assets/dashboard/dashboard.js",
  "tests/upstream-ports.test.mjs",
];

execFileSync("git", ["checkout", BASE, "--", ...files], { stdio: "inherit" });

function replaceExact(path, oldText, newText) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(oldText)) {
    throw new Error(`Expected patch target was not found in ${path}`);
  }
  fs.writeFileSync(path, source.replace(oldText, newText));
}

replaceExact(
  "connector.luau",
  `    local source, errorMessage, needsBuiltin = RequestServerDecompile(prepared.bytecode)\n    if not source then\n        local builtinSource, builtinLatencyMs = TryBuiltInDecompile(script)\n        if builtinSource then\n            local normalizedSource = RequestServerDecompile(prepared.bytecode, {\n                requestedProvider = "builtin",\n                builtinSource = builtinSource,\n                builtinLatencyMs = builtinLatencyMs,\n            })\n            source = normalizedSource or builtinSource\n            errorMessage = nil\n        elseif needsBuiltin then\n            source, errorMessage = RequestServerDecompile(prepared.bytecode, {\n                disabledProviders = { "builtin" },\n            })\n        end\n    end\n`,
  `    local source, errorMessage, needsBuiltin = RequestServerDecompile(prepared.bytecode)\n    --// Only invoke the executor decompiler when the server's ordered provider\n    --// chain explicitly reaches the built-in provider. A generic network/provider\n    --// failure must not silently bypass the configured decompiler order. \\\\--\n    if not source and needsBuiltin then\n        local builtinSource, builtinLatencyMs = TryBuiltInDecompile(script)\n        if builtinSource then\n            local normalizedSource = RequestServerDecompile(prepared.bytecode, {\n                requestedProvider = "builtin",\n                builtinSource = builtinSource,\n                builtinLatencyMs = builtinLatencyMs,\n            })\n            source = normalizedSource or builtinSource\n            errorMessage = nil\n        else\n            source, errorMessage = RequestServerDecompile(prepared.bytecode, {\n                disabledProviders = { "builtin" },\n            })\n        end\n    end\n`,
);

replaceExact(
  "src/http/assets/dashboard/dashboard.js",
  `        const sourcePending = !sourceAvailable && s.sourceError === 'Source mapping pending.';\n        const sourceStatusText = sourcePending ? 'mapping pending' : 'source unavailable';\n        const sourceStatusTitle = sourceAvailable ? '' : ' title="' + escapeHtml(s.sourceError || 'The executor could not read or decompile this script.') + '"';\n        html += '<div class="scripts-frow scripts-frow--file' + (childNode ? ' scripts-frow--hybrid' : '') + (sourceAvailable ? '' : ' scripts-frow--unavailable') + '" data-debug-id="' + escapeHtml(s.debugId) + '" data-path="' + escapeHtml(s.path) + '">';\n        html += '<div class="scripts-fname">' + FILE_ICON + '<span class="scripts-fname-text">' + escapeHtml(s.name) + '</span>' + (childCount ? '<span class="scripts-fname-count">' + childCount + ' children</span>' : '') + (sourceAvailable ? '' : '<span class="scripts-source-unavailable"' + sourceStatusTitle + '>' + sourceStatusText + '</span>') + '</div>';\n`,
  `        const sourcePending = !sourceAvailable && s.sourceError === 'Source mapping pending.';\n        const sourceStatusTitle = sourcePending ? ' title="' + escapeHtml(s.sourceError) + '"' : '';\n        html += '<div class="scripts-frow scripts-frow--file' + (childNode ? ' scripts-frow--hybrid' : '') + (sourcePending ? ' scripts-frow--unavailable' : '') + '" data-debug-id="' + escapeHtml(s.debugId) + '" data-path="' + escapeHtml(s.path) + '">';\n        html += '<div class="scripts-fname">' + FILE_ICON + '<span class="scripts-fname-text">' + escapeHtml(s.name) + '</span>' + (childCount ? '<span class="scripts-fname-count">' + childCount + ' children</span>' : '') + (sourcePending ? '<span class="scripts-source-unavailable"' + sourceStatusTitle + '>mapping pending</span>' : '') + '</div>';\n`,
);

replaceExact(
  "tests/upstream-ports.test.mjs",
  `import { decompileBytecode } from "../dist/decompiler/run.js";\nimport {\n  DEFAULT_DECOMPILER_SETTINGS,\n  decompilerSettingsIssues,\n  toConnectorDecompilerSettings,\n} from "../dist/decompiler/settings.js";\n`,
  `import { decompileBytecode } from "../dist/decompiler/run.js";\nimport { reportDecompilerHealth } from "../dist/decompiler/health.js";\nimport {\n  DEFAULT_DECOMPILER_SETTINGS,\n  decompilerSettingsIssues,\n  toConnectorDecompilerSettings,\n} from "../dist/decompiler/settings.js";\n`,
);

const testPath = "tests/upstream-ports.test.mjs";
let tests = fs.readFileSync(testPath, "utf8");
const marker = `test("current Claude Code Windows shims resolve without a command shell", () => {`;
const inserted = `test("slow-provider load balancing never promotes built-in ahead of configured fallbacks", async (t) => {\n  const settings = structuredClone(DEFAULT_DECOMPILER_SETTINGS);\n  for (const provider of Object.values(settings.providers)) provider.enabled = false;\n  settings.providerOrder = ["luaexpert", "luacid", "builtin"];\n  settings.providers.luaexpert.enabled = true;\n  settings.providers.luacid.enabled = true;\n  settings.providers.luacid.options = {\n    ...settings.providers.luacid.options,\n    transport: "http",\n    transportExplicit: true,\n  };\n  settings.providers.builtin.enabled = true;\n  settings.runtime.adaptiveFallback = false;\n  settings.runtime.loadBalanceSlowProviders = true;\n  settings.runtime.overallTimeoutMs = 5000;\n\n  reportDecompilerHealth("priority-order-test", [\n    { id: "luaexpert", status: "slow", slowCount: 1 },\n    { id: "luacid", status: "healthy", slowCount: 0 },\n    { id: "builtin", status: "healthy", slowCount: 0 },\n  ]);\n\n  let releaseLuaExpert;\n  let releaseLuacid;\n  const luaExpertGate = new Promise((resolve) => { releaseLuaExpert = resolve; });\n  const luacidGate = new Promise((resolve) => { releaseLuacid = resolve; });\n  let luaExpertCalls = 0;\n  let luacidCalls = 0;\n\n  t.mock.method(globalThis, "fetch", async (url) => {\n    const target = String(url);\n    if (target.includes("lua.expert")) {\n      luaExpertCalls += 1;\n      if (luaExpertCalls === 1) await luaExpertGate;\n      return new Response("return 'luaexpert'", { status: 200 });\n    }\n    if (target.includes("luacid.dev")) {\n      luacidCalls += 1;\n      if (luacidCalls === 1) await luacidGate;\n      return new Response("return 'luacid'", { status: 200 });\n    }\n    throw new Error(\`Unexpected decompiler URL: \${target}\`);\n  });\n\n  const input = {\n    bytecodeBase64: Buffer.from("priority-bytecode").toString("base64"),\n    builtinAvailable: true,\n    builtinSource: "return 'builtin'",\n    clientId: "priority-order-test",\n  };\n\n  const first = decompileBytecode(settings, input);\n  while (luaExpertCalls < 1) await new Promise((resolve) => setImmediate(resolve));\n\n  const second = decompileBytecode(settings, input);\n  while (luacidCalls < 1) await new Promise((resolve) => setImmediate(resolve));\n\n  const third = decompileBytecode(settings, input);\n  releaseLuaExpert();\n  releaseLuacid();\n\n  const results = await Promise.all([first, second, third]);\n  assert.equal(results.every((result) => result.ok), true);\n  assert.equal(results.some((result) => result.providerId === "builtin"), false);\n});\n\ntest("connector only invokes built-in decompile when the server explicitly requests it", () => {\n  const connector = fs.readFileSync(path.join(root, "connector.luau"), "utf8");\n  assert.match(connector, /if not source and needsBuiltin then/);\n  assert.doesNotMatch(connector, /if not source then\\s+local builtinSource/);\n});\n\ntest("scripts browser does not render a source unavailable badge", () => {\n  const dashboard = fs.readFileSync(path.join(root, "src/http/assets/dashboard/dashboard.js"), "utf8");\n  assert.doesNotMatch(dashboard, /sourceStatusText/);\n  assert.doesNotMatch(dashboard, />source unavailable<\\/span>/i);\n  assert.match(dashboard, />mapping pending<\\/span>/);\n});\n\n`;
if (!tests.includes(marker)) throw new Error("Test insertion marker not found");
tests = tests.replace(marker, inserted + marker);
fs.writeFileSync(testPath, tests);

console.log("Restored large files and applied intended decompiler patches.");
