import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { Disposable, Range, TextEdit, workspace } from 'coc.nvim'
import type { Document, LanguageClient, Position } from 'coc.nvim'
import { Panel, PanelConfig } from '../src/panel.ts'

let bufferId = 0

async function waitForDocument(bufnr: number, line: string): Promise<Document> {
  const deadline = Date.now() + 2000
  let actual: string | undefined
  while (Date.now() < deadline) {
    const doc = workspace.getDocument(bufnr)
    actual = doc?.getline(0)
    if (doc?.attached && actual === line && !doc.dirty) return doc
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Buffer ${bufnr} did not synchronize line ${JSON.stringify(line)}, actual: ${JSON.stringify(actual)}`)
}

async function waitForInsertMode(): Promise<void> {
  const deadline = Date.now() + 2000
  let mode = ''
  while (Date.now() < deadline) {
    mode = await workspace.nvim.call('mode') as string
    if (/^i/.test(mode)) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Editor did not enter insert mode, actual: ${mode}`)
}

function fakeClient(): LanguageClient {
  return {
    onProgress: () => Disposable.create(() => {}),
    error: () => {}
  } as unknown as LanguageClient
}

async function createPanel(doc: Document, position: Position, wasInsert: boolean): Promise<Panel> {
  const targetWinid = await workspace.nvim.call('win_getid') as number
  await workspace.nvim.command('vnew')
  const bufnr = await workspace.nvim.call('bufnr', ['%']) as number
  const winid = await workspace.nvim.call('win_getid') as number
  const config: PanelConfig = {
    formatOptions: { tabSize: 2, insertSpaces: true },
    commentNs: await workspace.nvim.createNamespace('coc-copilot-test-comment'),
    seperatorNs: await workspace.nvim.createNamespace('coc-copilot-test-separator'),
    targetUri: doc.uri,
    targetWinid,
    position,
    targetVersion: doc.version,
    targetLine: doc.getline(position.line),
    wasInsert
  }
  return new Panel(bufnr, winid, 'test-token', fakeClient(), undefined, config)
}

beforeEach(async () => {
  await workspace.nvim.command(`edit! coc-copilot-panel-${process.pid}-${bufferId++}.ts`)
  await workspace.nvim.command('setfiletype typescript')
  await workspace.nvim.call('setline', [1, 'const value = '])
  const bufnr = await workspace.nvim.call('bufnr', ['%']) as number
  await waitForDocument(bufnr, 'const value = ')
})

describe('Copilot panel acceptance', () => {
  it('applies the item, closes the panel, moves to the edit end and restores insert mode', async () => {
    const doc = await workspace.document
    const position = { line: 0, character: 'const value = '.length }
    const panel = await createPanel(doc, position, true)
    const panelBufnr = panel.bufnr

    assert.equal(await panel.acceptItem({
      insertText: '42',
      range: Range.create(position, position)
    }), true)

    await waitForDocument(doc.bufnr, 'const value = 42')
    assert.equal(await workspace.nvim.call('bufnr', ['%']), doc.bufnr)
    assert.equal(await workspace.nvim.call('bufexists', [panelBufnr]), 0)
    await waitForInsertMode()
    await workspace.nvim.input('X')
    await waitForDocument(doc.bufnr, 'const value = 42X')
    await workspace.nvim.command('stopinsert')
  })

  it('rejects an item when the original target line changed', async () => {
    const doc = await workspace.document
    const position = { line: 0, character: 'const value = '.length }
    const panel = await createPanel(doc, position, false)
    const panelBufnr = panel.bufnr
    await doc.applyEdits([TextEdit.replace(
      Range.create(0, 0, 0, 'const value = '.length),
      'const changed = '
    )])
    await waitForDocument(doc.bufnr, 'const changed = ')

    assert.equal(await panel.acceptItem({
      insertText: '42',
      range: Range.create(position, position)
    }), false)
    assert.equal(doc.getline(0), 'const changed = ')
    assert.equal(await workspace.nvim.call('bufexists', [panelBufnr]), 1)

    panel.dispose()
    await workspace.nvim.command(`silent! bwipeout! ${panelBufnr}`)
  })

  it('restores insert mode at a completion ending before existing text', async () => {
    const initial = 'const value = tail'
    await workspace.nvim.call('setline', [1, initial])
    const bufnr = await workspace.nvim.call('bufnr', ['%']) as number
    const doc = await waitForDocument(bufnr, initial)
    const position = { line: 0, character: 'const value = '.length }
    const panel = await createPanel(doc, position, true)

    assert.equal(await panel.acceptItem({
      insertText: '42',
      range: Range.create(position, position)
    }), true)
    await waitForDocument(doc.bufnr, 'const value = 42tail')
    await waitForInsertMode()
    await workspace.nvim.input('X')
    await waitForDocument(doc.bufnr, 'const value = 42Xtail')
    await workspace.nvim.command('stopinsert')
  })
})
