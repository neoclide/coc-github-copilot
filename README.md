# coc-github-copilot

Github copilot support with coc.nvim.

This extension using inline completion feature of coc.nvim, see `:h coc-inlineCompletion`.

If your network can't access copilot service directly, configure proxy is
needed, see `:h coc-config-http`.

To have service status in vim status line, enable status integration of coc.nvim,
see `:h coc-status`.

Use `:CocList services` to run or stop the language server.

Use `let b:coc_copilot_disable = 1` on buffer create to disable copilot
completion for specific buffer.

## Install

In your vim/neovim, run command:

```
:CocInstall coc-github-copilot
```

## Commands

- `github-copilot.signIn` Sign in to Github Copilot.
- `github-copilot.signOut` Sign out to Github Copilot.
- `github-copilot.openPanel` Open copilot completions panel.

## Configurations

- `github-copilot.enableCompletion`: Enable GitHub Copilot for inline completion  Default: `true`
- `github-copilot.token`: GitHub token for authentication  Default: `""`
- `github-copilot.openPanelCommand`: Vim command to open github copilot panel for inline completion items. Default: `"keepalt vs"`
- `github-copilot.filetypes`: Enabled filetypes, use "*" or null for all filetypes.  Default: `["*"]`
- `github-copilot.trace.server.verbosity`: Trace level of communication between server and client  Default: `"messages"`
    Valid options: ["off","messages","compact","verbose"]
- `github-copilot.trace.server.format`: Text format of trace messages.  Default: `"text"`
    Valid options: ["text","json"]
- `github-copilot.statusIcon`: Status text, change to  if nerd font works on your vim.  Default: `"Copilot"`
- `github-enterprise.uri`: If you are using GitHub Copilot Enterprise, set this to the URI of your GitHub Enterprise instance.  Default: `null`

## License

MIT
