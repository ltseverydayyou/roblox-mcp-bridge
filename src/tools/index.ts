import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import registerSetActiveClient from "./impl/clients/set-active-client.js";
import registerListClients from "./impl/clients/list-clients.js";

import registerExecute from "./impl/execution/execute.js";
import registerExecuteFile from "./impl/execution/execute-file.js";
import registerImportChatGptFiles from "./impl/files/import-chatgpt-files.js";
import registerExecuteChatGptLuau from "./impl/files/execute-chatgpt-luau.js";

import registerGetScriptContent from "./impl/inspection/get-script-content.js";
import registerGetDataByCode from "./impl/inspection/get-data-by-code.js";
import registerGetConsoleOutput from "./impl/inspection/get-console-output.js";
import registerSearchInstances from "./impl/inspection/search-instances.js";
import registerInspectInstances from "./impl/inspection/inspect-instances.js";
import registerScriptGrep from "./impl/inspection/script-grep.js";
import registerSemanticSearchScripts from "./impl/inspection/semantic-search-scripts.js";
import registerGetGameInfo from "./impl/inspection/get-game-info.js";
import registerGetDescendantsTree from "./impl/inspection/get-descendants-tree.js";
import registerAdvancedInspection from "./impl/inspection/advanced.js";

import registerRemoteSpy from "./impl/remote-spy/remote-spy.js";

import registerTypeTextBox from "./impl/gui/type-text-box.js";
import registerClickButton from "./impl/gui/click-button.js";

import registerScreenshotWindow from "./impl/windows/screenshot-window.js";
import registerListRobloxWindows from "./impl/windows/list-roblox-windows.js";
import registerCheckForUpdates from "./impl/server/check-for-updates.js";

export function registerAllTools(server: McpServer): void {
  registerCheckForUpdates(server);

  registerSetActiveClient(server);

  registerListClients(server);

  registerExecute(server);
  registerExecuteFile(server);
  registerImportChatGptFiles(server);
  registerExecuteChatGptLuau(server);

  registerGetScriptContent(server);
  registerGetDataByCode(server);
  registerGetConsoleOutput(server);
  registerSearchInstances(server);
  registerInspectInstances(server);
  registerScriptGrep(server);
  registerSemanticSearchScripts(server);
  registerGetGameInfo(server);
  registerGetDescendantsTree(server);
  registerAdvancedInspection(server);

  registerRemoteSpy(server);

  registerTypeTextBox(server);
  registerClickButton(server);

  registerScreenshotWindow(server);
  registerListRobloxWindows(server);
}
