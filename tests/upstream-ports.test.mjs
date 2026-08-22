import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { decompileBytecode } from "../dist/decompiler/run.js";
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
