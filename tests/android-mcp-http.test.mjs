import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

process.env.ROBLOX_MCP_HTTP = "true";

const { handleAndroidMcp } = await import("../dist/http/android-mcp.js");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("Android MCP remains usable when ChatGPT sends a stale session header", async () => {
  const server = createServer((req, res) => void handleAndroidMcp(req, res));
  const port = await listen(server);
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-06-18",
    "mcp-session-id": "session-from-before-android-restart",
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.match(body, /list-clients/);
    assert.equal(response.headers.get("mcp-session-id"), null);
  } finally {
    await close(server);
  }
});
