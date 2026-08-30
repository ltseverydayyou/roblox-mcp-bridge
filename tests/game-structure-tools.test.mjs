import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolSource = readFileSync(path.join(root, "src/tools/impl/inspection/game-structure.ts"), "utf8");
const toolIndex = readFileSync(path.join(root, "src/tools/index.ts"), "utf8");
const connector = readFileSync(path.join(root, "connector.luau"), "utf8");

for (const name of ["get-game-structure", "inspect-remotes", "inspect-interactions"]) {
  test(`${name} is registered and uses the existing bounded code probe transport`, () => {
    assert.match(toolSource, new RegExp(`server\\.registerTool\\(\\s*"${name}"`));
    assert.match(toolSource, /type: "get-data-by-code"/);
  });
}

test("game structure registration module is loaded by the MCP tool index", () => {
  assert.match(toolIndex, /registerGameStructure/);
});

test("the existing connector code-probe handler remains available", () => {
  assert.match(connector, /Bridge:BindToType\("get-data-by-code"/);
});

test("structure probes use bounded GetChildren traversal and avoid heavy executor introspection", () => {
  assert.match(toolSource, /maxNodesPerRoot/);
  assert.match(toolSource, /maxNodes/);
  assert.match(toolSource, /GetChildren/);
  assert.doesNotMatch(toolSource, /getgc\s*\(/i);
  assert.doesNotMatch(toolSource, /hookfunction\s*\(/i);
  assert.doesNotMatch(toolSource, /hookmetamethod\s*\(/i);
});
