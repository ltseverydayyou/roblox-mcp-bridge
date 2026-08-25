import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { decompileBytecode } from "../dist/decompiler/run.js";
import { reportDecompilerHealth } from "../dist/decompiler/health.js";
import {
  DEFAULT_DECOMPILER_SETTINGS,
  decompilerSettingsIssues,
  toConnectorDecompilerSettings,
} from "../dist/decompiler/settings.js";
import { resolvePackageCommand } from "../scripts/package-command.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function luacidSettings(overrides = {}) {
  const settings = structuredClone(DEFAULT_DECOMPILER_SETTINGS);
  for (const provider of Object.values(settings.providers)) provider.enabled = false;
  settings.providerOrder = ["luacid"];
  settings.providers.luacid = {
    ...settings.providers.luacid,
    enabled: true,
    ...overrides,
    options: overrides.options ? { ...overrides.options } : { ...settings.providers.luacid.options },
  };
  return settings;
}

test("Luacid HTTP sends raw bytecode, options, and an optional bearer key", async (t) => {
  const bytecode = Buffer.from("luacid-bytecode");
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.luacid.dev/decompile?indent=2&prefer_const=true");
    assert.equal(init.headers.Authorization, "Bearer paid-key");
    assert.equal(init.headers["Content-Type"], "application/octet-stream");
    assert.deepEqual(Buffer.from(init.body), bytecode);
    return new Response("return 'luacid-http'", { status: 200 });
  });
  const settings = luacidSettings({
    apiKey: "paid-key",
    options: { transport: "http", transportExplicit: true, indent: 2, prefer_const: true },
  });

  const result = await decompileBytecode(settings, {
    bytecodeBase64: bytecode.toString("base64"),
    clientId: "luacid-http-test",
  });
  assert.equal(result.ok, true);
  assert.equal(result.providerId, "luacid");
  assert.equal(result.source, "-- Decompiled with Luacid\nreturn 'luacid-http'");
});

test("Luacid automatically uses WebSocket when an API key is configured", async (t) => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  server.once("connection", (socket, request) => {
    assert.equal(request.headers.authorization, "Bearer websocket-key");
    socket.once("message", (raw) => {
      const requestBody = JSON.parse(raw.toString());
      assert.equal(requestBody.id, "decompile");
      assert.equal(requestBody.encoded_bytecode, Buffer.from("ws-bytecode").toString("base64"));
      assert.equal(requestBody.indent, "tab");
      socket.send(JSON.stringify({ decompilation: "return 'luacid-ws'" }));
    });
  });
  const settings = luacidSettings({
    endpoint: `http://127.0.0.1:${address.port}/decompile`,
    apiKey: "websocket-key",
    options: { transport: "auto", transportExplicit: false, indent: "tab" },
  });

  const result = await decompileBytecode(settings, {
    bytecodeBase64: Buffer.from("ws-bytecode").toString("base64"),
    clientId: "luacid-websocket-test",
  });
  assert.equal(result.ok, true);
  assert.equal(result.providerId, "luacid");
  assert.equal(result.source, "-- Decompiled with Luacid\nreturn 'luacid-ws'");
});

test("Luacid WebSocket requires a key in saved and connector settings", () => {
  const settings = luacidSettings({
    apiKey: "",
    options: { transport: "websocket", transportExplicit: true },
  });
  assert.match(decompilerSettingsIssues(settings).join(" "), /paid API key/);
  assert.equal(toConnectorDecompilerSettings(settings).providers.luacid.enabled, false);
});

test("dashboard exposes Luacid transport, key, and option controls", () => {
  const dashboard = fs.readFileSync(path.join(root, "src/http/assets/dashboard/dashboard.js"), "utf8");
  assert.match(dashboard, /label: 'Luacid'/);
  assert.match(dashboard, /decompilerModalLuacidTransport/);
  assert.match(dashboard, /decompilerModalLuacidOptions/);
  assert.match(dashboard, /luacid\.dev\/getkey/);
});

test("slow-provider load balancing never promotes built-in ahead of configured fallbacks", async (t) => {
  const settings = structuredClone(DEFAULT_DECOMPILER_SETTINGS);
  for (const provider of Object.values(settings.providers)) provider.enabled = false;
  settings.providerOrder = ["luaexpert", "luacid", "builtin"];
  settings.providers.luaexpert.enabled = true;
  settings.providers.luacid.enabled = true;
  settings.providers.luacid.options = {
    ...settings.providers.luacid.options,
    transport: "http",
    transportExplicit: true,
  };
  settings.providers.builtin.enabled = true;
  settings.runtime.adaptiveFallback = false;
  settings.runtime.loadBalanceSlowProviders = true;
  settings.runtime.overallTimeoutMs = 5000;

  reportDecompilerHealth("priority-order-test", [
    { id: "luaexpert", status: "slow", slowCount: 1 },
    { id: "luacid", status: "healthy", slowCount: 0 },
    { id: "builtin", status: "healthy", slowCount: 0 },
  ]);

  let releaseLuaExpert;
  let releaseLuacid;
  const luaExpertGate = new Promise((resolve) => { releaseLuaExpert = resolve; });
  const luacidGate = new Promise((resolve) => { releaseLuacid = resolve; });
  let luaExpertCalls = 0;
  let luacidCalls = 0;

  t.mock.method(globalThis, "fetch", async (url) => {
    const target = String(url);
    if (target.includes("lua.expert")) {
      luaExpertCalls += 1;
      if (luaExpertCalls === 1) await luaExpertGate;
      return new Response("return 'luaexpert'", { status: 200 });
    }
    if (target.includes("luacid.dev")) {
      luacidCalls += 1;
      if (luacidCalls === 1) await luacidGate;
      return new Response("return 'luacid'", { status: 200 });
    }
    throw new Error(`Unexpected decompiler URL: ${target}`);
  });

  const input = {
    bytecodeBase64: Buffer.from("priority-bytecode").toString("base64"),
    builtinAvailable: true,
    builtinSource: "return 'builtin'",
    clientId: "priority-order-test",
  };

  const first = decompileBytecode(settings, input);
  while (luaExpertCalls < 1) await new Promise((resolve) => setImmediate(resolve));

  const second = decompileBytecode(settings, input);
  while (luacidCalls < 1) await new Promise((resolve) => setImmediate(resolve));

  const third = decompileBytecode(settings, input);
  releaseLuaExpert();
  releaseLuacid();

  const results = await Promise.all([first, second, third]);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(results.some((result) => result.providerId === "builtin"), false);
});

test("connector only invokes built-in decompile when the server explicitly requests it", () => {
  const connector = fs.readFileSync(path.join(root, "connector.luau"), "utf8");
  assert.match(connector, /if not source and needsBuiltin then/);
  assert.doesNotMatch(connector, /if not source then\s+local builtinSource/);
});

test("scripts browser does not render a source unavailable badge", () => {
  const dashboard = fs.readFileSync(path.join(root, "src/http/assets/dashboard/dashboard.js"), "utf8");
  assert.doesNotMatch(dashboard, /sourceStatusText/);
  assert.doesNotMatch(dashboard, />source unavailable<\/span>/i);
  assert.match(dashboard, />mapping pending<\/span>/);
});

test("current Claude Code Windows shims resolve without a command shell", () => {
  const windowsNode = String.raw`C:\Program Files\nodejs\node.exe`;
  const windowsShim = String.raw`C:\Users\Jordan\AppData\Roaming\npm\claude.cmd`;
  const windowsExe = String.raw`C:\Users\Jordan\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`;
  const args = ["mcp", "add", "roblox-mcp", "--scope", "user"];
  assert.deepEqual(resolvePackageCommand(windowsShim, args, {
    platform: "win32",
    execPath: windowsNode,
    fileExists: (candidate) => candidate === windowsExe,
  }), {
    command: windowsExe,
    args,
    shell: false,
  });

  const windowsCli = String.raw`C:\Users\Jordan\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js`;
  assert.deepEqual(resolvePackageCommand(windowsShim, args, {
    platform: "win32",
    execPath: windowsNode,
    fileExists: (candidate) => candidate === windowsCli,
  }), {
    command: windowsNode,
    args: [windowsCli, ...args],
    shell: false,
  });
});
