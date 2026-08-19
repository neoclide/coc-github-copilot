# coc-github-copilot

[![CI](https://github.com/neoclide/coc-github-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/neoclide/coc-github-copilot/actions/workflows/ci.yml)

Github copilot support with coc.nvim.

This extension using inline completion feature of coc.nvim, see `:h coc-inlineCompletion`.

If your network can't access copilot service directly, configure proxy is
needed, see `:h coc-config-http`.

To have service status in vim status line, enable status integration of coc.nvim,
see `:h coc-status`.

Use `:CocList services` to run or stop the language server.

Use `let b:coc_copilot_disable = 1` to disable Copilot completion for the current buffer.

## Install

In your vim/neovim, run command:

```
:CocInstall coc-github-copilot
```

## Commands

- `github-copilot.signIn` Sign in to Github Copilot.
- `github-copilot.signOut` Sign out to Github Copilot.
- `github-copilot.openPanel` Open copilot completions panel.
- `github-copilot.status` Show the service, authentication, current buffer configuration and content policy status.
- `github-copilot.diagnostics` Show extension, language server, runtime and workspace details, with actions to open the log or restart the service.
- `github-copilot.quota` Show the completion quota, plan and reset date.
- `github-copilot.changeCompletionModel` Select a completion-scoped model reported by the Copilot language server.
- `github-copilot.enable` Enable completions after choosing global, current-language or current-buffer scope.
- `github-copilot.disable` Disable completions after choosing global, current-language or current-buffer scope.

## Configurations

- `github-copilot.enableCompletion`: Enable GitHub Copilot for inline completion  Default: `true`
- `github-copilot.enableCompletionByLanguage`: Per-language completion overrides managed by the current-language commands. Default: `{}`
- `github-copilot.openPanelCommand`: Vim command to open github copilot panel for inline completion items. Default: `"keepalt vs"`
- `github-copilot.filetypes`: Enabled filetypes, use "*" or null for all filetypes.  Default: `["*"]`
- `github-copilot.trace.server.verbosity`: Trace level of communication between server and client  Default: `"messages"`
    Valid options: ["off","messages","compact","verbose"]
- `github-copilot.trace.server.format`: Text format of trace messages.  Default: `"text"`
    Valid options: ["text","json"]
- `github-copilot.statusIcon`: Status text, change to  if nerd font works on your vim.  Default: `"Copilot"`
- `github.copilot.selectedCompletionModel`: Completion model selected by `github-copilot.changeCompletionModel`. An empty value uses the server default. Default: `""`
- `github-enterprise.uri`: If you are using GitHub Copilot Enterprise, set this to the URI of your GitHub Enterprise instance.  Default: `null`

## License

MIT
