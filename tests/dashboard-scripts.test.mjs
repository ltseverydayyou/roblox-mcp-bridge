import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadScriptTreeHelpers() {
  const source = readFileSync(
    new URL("../src/http/assets/dashboard/dashboard.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function scriptPathParts");
  const end = source.indexOf("function getNodeAt", start);
  assert.notEqual(start, -1, "script tree helpers should exist");
  assert.notEqual(end, -1, "script tree helper boundary should exist");

  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test("a script with a child script stays a file in the dashboard tree", () => {
  const context = loadScriptTreeHelpers();
  context.scripts = [
    {
      debugId: "parent-script",
      path: "game.ServerScriptService.ParentScript",
      lines: 10,
      bytes: 100,
    },
    {
      debugId: "child-script",
      path: "game.ServerScriptService.ParentScript.ChildScript",
      lines: 5,
      bytes: 50,
    },
  ];

  const tree = vm.runInContext("buildScriptTree(scripts)", context);
  const service = tree.children.game.children.ServerScriptService;

  assert.deepEqual(
    Array.from(service.scripts, (script) => script.name),
    ["ParentScript.luau"],
  );
  assert.equal(service.scripts[0].childFolderName, "ParentScript");
  assert.equal(
    vm.runInContext(
      "getScriptChildNode(buildScriptTree(scripts).children.game.children.ServerScriptService, buildScriptTree(scripts).children.game.children.ServerScriptService.scripts[0]) !== null",
      context,
    ),
    true,
  );
  assert.deepEqual(
    Array.from(service.children.ParentScript.scripts, (script) => script.name),
    ["ChildScript.luau"],
  );
  assert.equal(service.children.ParentScript.children.ChildScript, undefined);
});

test("a metadata-only parent script still forms a hybrid script node", () => {
  const context = loadScriptTreeHelpers();
  context.scripts = [
    {
      debugId: "unavailable-parent",
      path: "Players.Player.PlayerGui.MainUI.Initiator",
      className: "LocalScript",
      sourceAvailable: false,
      sourceError: "Unable to get script bytecode.",
      lines: 0,
      bytes: 0,
    },
    {
      debugId: "mapped-child",
      path: "Players.Player.PlayerGui.MainUI.Initiator.ChildScript",
      className: "LocalScript",
      sourceAvailable: true,
      lines: 20,
      bytes: 500,
    },
  ];

  const tree = vm.runInContext("buildScriptTree(scripts)", context);
  const mainUi = tree.children.Players.children.Player.children.PlayerGui.children.MainUI;
  const parent = mainUi.scripts[0];

  assert.equal(parent.name, "Initiator.luau");
  assert.equal(parent.className, "LocalScript");
  assert.equal(parent.sourceAvailable, false);
  assert.equal(parent.childFolderName, "Initiator");
  assert.equal(mainUi.children.Initiator.scripts[0].name, "ChildScript.luau");
});
