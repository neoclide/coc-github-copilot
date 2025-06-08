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

## License

MIT
