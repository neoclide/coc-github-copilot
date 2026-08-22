import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { CancellationToken, commands, Disposable, InlineCompletionTriggerKind, languages, ProviderName, Range, workspace } from 'coc.nvim'
import type { Document, LanguageClient, NextEditProvider } from 'coc.nvim'
import { createNextEditProvider, toNextEditItems } from '../src/nextEdit.ts'

const providerName = 'coc-copilot-next-edit-test'
let bufferId = 0

async function waitForDocument(bufnr: number, line: string): Promise<Document> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const doc = workspace.getDocument(bufnr)
    if (doc?.attached && doc.getline(0) === line && !doc.dirty) return doc
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Buffer ${bufnr} did not synchronize line ${JSON.stringify(line)}`)
}

async function waitFor(check: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

beforeEach(async () => {
  await workspace.nvim.command(`edit! coc-copilot-next-edit-${process.pid}-${bufferId++}.js`)
  await workspace.nvim.command('setfiletype javascript')
  await workspace.nvim.call('setline', [1, 'const value = old'])
  const bufnr = await workspace.nvim.call('bufnr', ['%']) as number
  const doc = await waitForDocument(bufnr, 'const value = old')
  await doc.buffer.setVar('coc_copilot_disable', 0)
})

describe('Copilot next edit provider', () => {
  it('registers for supported documents during extension activation', () => {
    assert.equal(languages.hasProvider(ProviderName.NextEdit, {
      uri: 'file:///tmp/coc-copilot-next-edit.js',
      languageId: 'javascript'
    }), true)
  })

  it('converts Copilot edits and ignores malformed response entries', () => {
    const textDocument = { uri: 'file:///tmp/next-edit.js', version: 3 }
    const range = Range.create(0, 0, 0, 1)
    const command = { title: 'Accept inline edit', command: 'copilot.accept', arguments: ['result-id'] }

    const items = toNextEditItems({
      edits: [null, { text: 1 }, { text: 'missing document', range }, { text: 'replacement', textDocument, range, command }]
    })
    assert.equal(items.length, 1)
    assert.equal(items[0].textDocument.uri, textDocument.uri)
    assert.equal(items[0].textDocument.version, textDocument.version)
    assert.equal(items[0].range.start.line, 0)
    assert.equal(items[0].range.end.character, 1)
    assert.equal(items[0].command?.command, 'copilot.accept')
    assert.equal(items[0].command?.arguments?.[0], 'result-id')
    assert.equal(items[0].newText, 'replacement')
    assert.equal(toNextEditItems(undefined).length, 0)
    assert.equal(toNextEditItems({ edits: {} }).length, 0)
  })

  it('requests, shows and accepts an edit through coc.nvim Next Edit', async () => {
    const requests: Array<{ method: string; params: any; token: CancellationToken }> = []
    const notifications: Array<{ method: string; params: any }> = []
    const client = {
      isRunning: () => true,
      sendRequest: async (method: string, params: any, token: CancellationToken) => {
        requests.push({ method, params, token })
        return {
          edits: [{
            textDocument: params.textDocument,
            range: Range.create(0, 0, 0, 'const value = old'.length),
            text: 'const value = 42',
            command: { title: 'Accept inline edit', command: 'coc-copilot-next-edit.accept', arguments: ['result-id'] }
          }]
        }
      },
      sendNotification: async (method: string, params: any) => {
        notifications.push({ method, params })
      }
    } as unknown as LanguageClient
    const provider = createNextEditProvider(client)
    Object.defineProperty(provider, '__extensionName', { value: providerName })
    let accepted = false
    const disposables: Disposable[] = [
      languages.registerNextEditProvider([{ language: 'javascript' }], provider),
      commands.registerCommand('coc-copilot-next-edit.accept', () => { accepted = true })
    ]

    try {
      const doc = await workspace.document
      const triggered = await commands.executeCommand('editor.action.triggerNextEdit', { provider: providerName })

      assert.equal(triggered, true)
      assert.equal(requests.length, 1)
      assert.equal(requests[0].method, 'textDocument/copilotInlineEdit')
      assert.equal(requests[0].params.textDocument.uri, doc.uri)
      assert.equal(requests[0].params.textDocument.version, doc.version)
      assert.equal(requests[0].params.position.line, 0)
      assert.equal(requests[0].token.isCancellationRequested, false)
      await waitFor(() => notifications.length === 1, 'Copilot was not notified when the next edit was shown')
      assert.equal(notifications[0].method, 'textDocument/didShowInlineEdit')
      assert.equal(notifications[0].params.item.command.arguments.length, 1)
      assert.equal(notifications[0].params.item.command.arguments[0], 'result-id')

      await workspace.nvim.call('coc#nextedit#accept', [])
      await waitForDocument(doc.bufnr, 'const value = 42')
      await waitFor(() => accepted, 'Copilot acceptance command was not executed')
    } finally {
      await workspace.nvim.call('coc#nextedit#cancel', [])
      for (const disposable of disposables) disposable.dispose()
    }
  })

  it('does not contact the server when cancelled, stopped or buffer-disabled', async () => {
    let requests = 0
    let running = true
    const client = {
      isRunning: () => running,
      sendRequest: async () => { requests++; return { edits: [] } }
    } as unknown as LanguageClient
    const provider: NextEditProvider = createNextEditProvider(client)
    const doc = await workspace.document

    const items = await provider.provideNextEdits(
      doc.textDocument,
      { line: 0, character: 0 },
      { triggerKind: InlineCompletionTriggerKind.Invoked },
      CancellationToken.Cancelled
    )
    assert.equal(Array.isArray(items) ? items.length : -1, 0)

    await doc.buffer.setVar('coc_copilot_disable', 1)
    const disabledItems = await provider.provideNextEdits(
      doc.textDocument,
      { line: 0, character: 0 },
      { triggerKind: InlineCompletionTriggerKind.Automatic },
      CancellationToken.None
    )
    assert.equal(Array.isArray(disabledItems) ? disabledItems.length : -1, 0)

    await doc.buffer.setVar('coc_copilot_disable', 0)
    running = false
    const stoppedItems = await provider.provideNextEdits(
      doc.textDocument,
      { line: 0, character: 0 },
      { triggerKind: InlineCompletionTriggerKind.Automatic },
      CancellationToken.None
    )
    assert.equal(Array.isArray(stoppedItems) ? stoppedItems.length : -1, 0)
    assert.equal(requests, 0)
  })
})
