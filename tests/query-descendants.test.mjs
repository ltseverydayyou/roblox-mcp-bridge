import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const connector = readFileSync(new URL("../connector.luau", import.meta.url), "utf8");

function handlerSource(name) {
  const marker = `Bridge:BindToType("${name}"`;
  const start = connector.indexOf(marker);
  assert.notEqual(start, -1, `${name} handler should exist`);
  const next = connector.indexOf("Bridge:BindToType(", start + marker.length);
  return connector.slice(start, next === -1 ? connector.length : next);
}

test("typed inspection handlers use QueryDescendants instead of raw descendant scans", () => {
  const expectations = [
    ["inspect-visible-gui", 'QueryDescendants("GuiObject")'],
    ["inspect-animations", 'QueryDescendants("Animator")'],
    ["inspect-sounds", 'QueryDescendants("Sound")'],
    ["get-performance-stats", 'QueryDescendants("Sound, Animator, LuaSourceContainer, GuiObject, BasePart")'],
  ];

  for (const [name, selector] of expectations) {
    const source = handlerSource(name);
    assert.ok(source.includes(selector));
    assert.doesNotMatch(source, /GetDescendants\s*\(/);
  }
});

test("state snapshots use typed QueryDescendants selectors", () => {
  const start = connector.indexOf("local function CaptureStateSnapshot");
  const end = connector.indexOf("local function DiffStateSnapshots", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = connector.slice(start, end);

  assert.match(source, /guiRoot:QueryDescendants\("GuiObject"\)/);
  assert.match(source, /game:QueryDescendants\("Sound"\)/);
  assert.match(source, /character:QueryDescendants\("Animator"\)/);
  assert.doesNotMatch(source, /GetDescendants\s*\(/);
});
