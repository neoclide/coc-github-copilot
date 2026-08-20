# 0.1.1

- add release.yml (e8b4335)
- update logo (0b32e8c)
- add logo (99b31ad)

# 0.1.0

- Add `github-copilot.status` and `github-copilot.quota` diagnostics commands.
- Add scoped completion controls with `github-copilot.enable` and `github-copilot.disable`, including global, language and buffer pickers and explicit disable diagnostics.
- Add completion model selection from the Copilot language server.
- Make Panel acceptance safe against target-buffer changes and restore the original editor state after accepting.
- Show Panel generation progress, candidate counts, completion and errors; preserve snippet placeholders when accepting suggestions.
- Add `github-copilot.diagnostics` with extension, Language Server, Node, editor and workspace details, plus log and service restart actions.
