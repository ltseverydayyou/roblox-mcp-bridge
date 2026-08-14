import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";

import {
  SendArbitraryDataToClient,
  resetPrimaryState,
  setInstanceRole,
} from "../dist/bridge/handlers/shared/communication.js";
import {
  getClientById,
  getActiveClientId,
  registerClient,
  resetRegistry,
  setActiveClientId,
} from "../dist/bridge/handlers/shared/registry.js";
import { HttpBodyTooLargeError, readBody } from "../dist/http/body.js";
import { WS as registerRelaySocket } from "../dist/http/routes/mcp-relay.js";
import {
  downloadOpenAIFile,
  sanitizeUploadedFileName,
  validateChatGptDownloadUrl,
} from "../dist/files/chatgpt-file.js";
import { compareVersions } from "../dist/update/checker.js";
import { SERVER_VERSION } from "../dist/version.js";

class FakeWebSocket extends EventEmitter {
  sent = [];

  send(message) {
    this.sent.push(JSON.parse(String(message)));
  }
}

function registerHttpClient(username) {
  return registerClient({
    username,
    userId: 1,
    placeId: 2,
    jobId: `job-${username}`,
    placeName: "Test Place",
    sessionId: `session-${username}`,
    transport: "http",
  });
}

test.beforeEach(() => {
  setInstanceRole("primary");
  resetPrimaryState();
  resetRegistry();
});

test("update version comparison handles upgrades and prereleases", () => {
  assert.equal(compareVersions("2.3.0", "2.4.0"), -1);
  assert.equal(compareVersions("2.3.0", "2.3.0"), 0);
  assert.equal(compareVersions("2.4.0", "2.3.0"), 1);
  assert.equal(compareVersions("2.3.0-beta.1", "2.3.0"), -1);
  assert.equal(compareVersions("2.3.0-beta.10", "2.3.0-beta.2"), 1);
  assert.equal(compareVersions("2.3.0+build.5", "2.3.0+build.9"), 0);
  assert.equal(compareVersions("2.3.0-1", "2.3.0-alpha"), -1);
});

test("server and package versions stay synchronized", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(SERVER_VERSION, manifest.version);
});

test("the MCP updater only requires the documented Node.js runtime", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.update, /^node\s/);
  assert.doesNotMatch(manifest.scripts.update, /^bun\s/);
});

test("the Windows manager bootstraps updates outside the checked-out package script", () => {
  const manager = readFileSync(new URL("../scripts/windows-mcp-manager.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(manager, /npm run update/);
  assert.match(manager, /pull --ff-only/);
  assert.match(manager, /install-harnesses\.mjs/);
  assert.match(manager, /--update --yes --plain --server-root/);
  assert.match(manager, /node_modules\\npm\\bin\\npm-cli\.js/);
  assert.match(manager, /function Reload-Bridge/);
  assert.match(manager, /Get-NetTCPConnection/);
  assert.match(manager, /Reload bridge/);
});

test("the Node updater bypasses broken global npm shims before trying pnpm", () => {
  const updater = readFileSync(new URL("../scripts/install-harnesses.mjs", import.meta.url), "utf8");
  assert.match(updater, /npm-cli\.js/);
  assert.match(updater, /commandExists\("bun"\).*bundledNpmCli.*commandExists\("npm"\).*commandExists\("pnpm"\)/s);
});

test("implicit routing sends a command to exactly one client", () => {
  const firstId = registerHttpClient("first");
  const secondId = registerHttpClient("second");

  const requestId = SendArbitraryDataToClient("execute", { source: "return 1" });
  assert.equal(typeof requestId, "string");

  const firstCount = getClientById(firstId)?.pendingHttpCommands.length ?? 0;
  const secondCount = getClientById(secondId)?.pendingHttpCommands.length ?? 0;
  assert.equal(firstCount + secondCount, 1);
});

test("an active client receives the command exclusively", () => {
  const firstId = registerHttpClient("first");
  const secondId = registerHttpClient("second");
  setActiveClientId(firstId);

  SendArbitraryDataToClient("execute", { source: "return 1" }, undefined, firstId);

  assert.equal(getClientById(firstId)?.pendingHttpCommands.length, 1);
  assert.equal(getClientById(secondId)?.pendingHttpCommands.length, 0);
});

test("a relay validates its selection without changing the primary selection", () => {
  const primarySelection = registerHttpClient("primary-selection");
  const relaySelection = registerHttpClient("relay-selection");
  setActiveClientId(primarySelection);

  const relay = new FakeWebSocket();
  registerRelaySocket(relay);
  relay.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        id: "selection-request",
        type: "set-active-client",
        targetClientId: relaySelection,
      })
    )
  );

  assert.equal(getActiveClientId(), primarySelection);
  assert.equal(relay.sent.at(-1)?.clientId, relaySelection);
  relay.emit("close");
});

test("request bodies are rejected once they exceed the configured bound", async () => {
  const request = Readable.from([Buffer.from("1234"), Buffer.from("5678")]);

  await assert.rejects(
    readBody(request, 6),
    (error) => error instanceof HttpBodyTooLargeError && error.statusCode === 413
  );
});

test("request bodies preserve UTF-8 content within the bound", async () => {
  const expected = JSON.stringify({ message: "hello Мир" });
  const request = Readable.from([Buffer.from(expected, "utf8")]);
  assert.equal(await readBody(request, 1024), expected);
});

test("ChatGPT file URLs require public HTTPS destinations", () => {
  assert.equal(
    validateChatGptDownloadUrl("https://files.openai.com/download/file_123").protocol,
    "https:"
  );
  assert.throws(
    () => validateChatGptDownloadUrl("http://files.openai.com/file"),
    /must use HTTPS/
  );
  assert.throws(
    () => validateChatGptDownloadUrl("https://127.0.0.1/private"),
    /local or private/
  );
  assert.throws(
    () => validateChatGptDownloadUrl("https://192.168.1.10/private"),
    /local or private/
  );
});

test("ChatGPT filenames cannot escape the staging directory", () => {
  assert.equal(sanitizeUploadedFileName("../../payload.luau", "file_123"), "payload.luau");
  assert.equal(sanitizeUploadedFileName("bad:name?.lua", "file_123"), "bad_name_.lua");
});

test("ChatGPT file redirects are validated before following them", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/private" },
    });
  };

  try {
    await assert.rejects(
      downloadOpenAIFile({
        download_url: "https://files.openai.com/file_123",
        file_id: "file_123",
        file_name: "payload.luau",
      }),
      /local or private/
    );
    assert.deepEqual(requested, ["https://files.openai.com/file_123"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatGPT file streaming enforces its byte ceiling", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("12345678", { status: 200 });

  try {
    await assert.rejects(
      downloadOpenAIFile(
        {
          download_url: "https://files.openai.com/file_123",
          file_id: "file_123",
          file_name: "payload.luau",
        },
        6
      ),
      /exceeds the 6-byte limit/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
