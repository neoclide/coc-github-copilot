"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  activate: () => activate
});
module.exports = __toCommonJS(index_exports);
var import_coc2 = require("coc.nvim");

// package.json
var version = "0.0.1";

// src/attach.ts
var import_coc = require("coc.nvim");
function register(subscriptions, client, config) {
  let { nvim } = import_coc.workspace;
  subscriptions.push(import_coc.commands.registerCommand("github-copilot.signIn", async () => {
    client.sendRequest("signIn", {}).then(async (result) => {
      try {
        await nvim.call("setreg", ["+", result.userCode]);
      } catch (e) {
      }
      await import_coc.window.showInformationMessage(`Please copy your user code: ${result.userCode}`, "Continue").then((selected) => {
        if (selected != null) {
          import_coc.commands.executeCommand(result.command.command, ...result.command.arguments);
        }
      });
    });
  }));
  subscriptions.push(import_coc.commands.registerCommand("github-copilot.signOut", async () => {
    await client.sendRequest("signOut", {});
  }));
  const statusIcon = config.get("statusIcon", "");
  let statusItem = import_coc.window.createStatusBarItem(99);
  subscriptions.push(statusItem);
  statusItem.text = statusIcon;
  client.onDidChangeState((e) => {
    if (e.newState === import_coc.State.Running || e.newState === import_coc.State.Starting) {
      statusItem.show();
    } else {
      statusItem.hide();
    }
  }, null, subscriptions);
  client.onNotification("didChangeStatus", (event) => {
    let msg = event.message ?? "";
    switch (event.kind) {
      case "Error":
        if (msg.length > 0) {
          if (msg.includes("token is invalid")) {
            import_coc.window.showErrorMessage(msg, "Sign in").then((res) => {
              if (res != null) {
                void import_coc.commands.executeCommand("github-copilot.signIn");
              }
            });
          } else {
            import_coc.window.showErrorMessage(msg);
          }
        }
        statusItem.text = statusIcon + ` ${msg}`;
        break;
      case "Warning":
        if (msg.length > 0) import_coc.window.showWarningMessage(msg);
        break;
      case "Inactive":
        statusItem.text = statusIcon + " Ignored";
        break;
      default:
        statusItem.text = statusIcon;
    }
    if (msg) client.outputChannel.appendLine("Status changed " + msg);
  });
  import_coc.events.on("InlineShown", (item) => {
    client.sendNotification("textDocument/didShowCompletion", { item });
  }, null, subscriptions);
  import_coc.events.on("InlineAccept", (acceptedLength, item) => {
    client.sendNotification("textDocument/didPartiallyAcceptCompletion", { item, acceptedLength });
  }, null, subscriptions);
  subscriptions.push(
    import_coc.window.onDidChangeActiveTextEditor((e) => {
      if (client.isRunning()) {
        client.sendNotification("textDocument/didFocus", {
          textDocument: {
            uri: e?.document.uri
          }
        });
      }
    })
  );
}

// src/index.ts
async function activate(context) {
  const { subscriptions } = context;
  const config = import_coc2.workspace.getConfiguration("github-copilot");
  if (!config.get("enable", true)) return;
  const filetypes = config.get("filetypes", ["*"]);
  const clientOptions = {
    documentSelector: filetypes ?? ["*"],
    // Enable for all file types
    synchronize: {
      configurationSection: ["github.copilot", "telemetry", "github-enterprise", "http"]
    },
    initializationOptions: {
      editorInfo: {
        name: import_coc2.workspace.isVim ? "Vim" : "Neovim",
        version: import_coc2.workspace.env.version
      },
      editorPluginInfo: {
        name: "coc-github-copilot",
        version
      }
    },
    outputChannelName: "github-copilot",
    middleware: {
      sendRequest: (type, param, token, next) => {
        if (typeof type === "object" && type.method == "textDocument/inlineCompletion") {
          let doc = import_coc2.window.activeTextEditor?.document;
          if (!doc || doc.getVar("copilot_disable")) {
            return Promise.resolve(void 0);
          }
          param.textDocument = param.textDocument ?? { uri: doc.uri };
          param.textDocument.version = doc.version;
          param.formattingOptions = import_coc2.window.activeTextEditor?.options;
        }
        return next(type, param, token);
      }
    }
  };
  const serverOptions = {
    module: context.asAbsolutePath("node_modules/@github/copilot-language-server/dist/language-server.js"),
    transport: import_coc2.TransportKind.ipc,
    options: {
      cwd: import_coc2.workspace.root,
      env: {
        GITHUB_TOKEN: config.get("token", process.env.GITHUB_TOKEN ?? "")
      }
    }
  };
  const client = new import_coc2.LanguageClient(
    "github-copilot",
    "GitHub Copilot",
    serverOptions,
    clientOptions
  );
  register(context.subscriptions, client, config);
  subscriptions.push(
    import_coc2.services.registerLanguageClient(client)
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate
});
//# sourceMappingURL=index.js.map
