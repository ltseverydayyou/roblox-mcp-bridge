import fs from "node:fs";

const path = "tests/bridge.test.mjs";
const source = fs.readFileSync(path, "utf8");
const oldText = "  assert.match(connector, /if not source then\\s+local builtinSource, builtinLatencyMs = TryBuiltInDecompile\\(script\\)/);";
const newText = "  assert.match(connector, /if not source and needsBuiltin then\\s+local builtinSource, builtinLatencyMs = TryBuiltInDecompile\\(script\\)/);";

if (source.includes(newText)) {
  console.log("bridge.test.mjs is already updated.");
} else {
  if (!source.includes(oldText)) throw new Error("Expected bridge.test.mjs assertion was not found.");
  fs.writeFileSync(path, source.replace(oldText, newText));
  console.log("Updated bridge.test.mjs for explicit built-in fallback gating.");
}
