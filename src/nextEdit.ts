import { languages, workspace } from 'coc.nvim'
import type { CancellationToken, Disposable, DocumentSelector, LanguageClient, NextEditItem, NextEditProvider, Position, TextDocument } from 'coc.nvim'

interface CopilotInlineEdit {
  textDocument: NextEditItem['textDocument']
  range: NextEditItem['range']
  text: string
  command?: NextEditItem['command']
}

interface CopilotInlineEditResult {
  edits?: unknown[]
}

export function toNextEditItems(result: unknown): NextEditItem[] {
  if (!result || typeof result !== 'object') return []
  const edits = (result as CopilotInlineEditResult).edits
  if (!Array.isArray(edits)) return []
  const items: NextEditItem[] = []
  for (const value of edits) {
    if (!value || typeof value !== 'object') continue
    const edit = value as CopilotInlineEdit
    if (typeof edit.text !== 'string' || !edit.textDocument || !edit.range) continue
    const { text, ...item } = edit
    items.push({ ...item, newText: text })
  }
  return items
}

export function createNextEditProvider(client: LanguageClient): NextEditProvider {
  return {
    async provideNextEdits(document: TextDocument, position: Position, _context, token: CancellationToken): Promise<NextEditItem[]> {
      if (!client.isRunning() || token.isCancellationRequested) return []
      const doc = workspace.getDocument(document.uri)
      if (!doc?.attached || await doc.buffer.getVar('coc_copilot_disable')) return []
      if (!client.isRunning() || token.isCancellationRequested) return []
      const result = await client.sendRequest<unknown>('textDocument/copilotInlineEdit', {
        textDocument: { uri: document.uri, version: document.version },
        position
      }, token)
      return toNextEditItems(result)
    },
    async handleDidShowNextEdit(item: NextEditItem): Promise<void> {
      const id = item.command?.arguments?.[0]
      if (!client.isRunning() || typeof id !== 'string' || id.length === 0) return
      await client.sendNotification('textDocument/didShowInlineEdit', { item })
    }
  }
}

export function registerNextEditProvider(subscriptions: Disposable[], selector: DocumentSelector, client: LanguageClient): void {
  subscriptions.push(languages.registerNextEditProvider(selector, createNextEditProvider(client)))
}
