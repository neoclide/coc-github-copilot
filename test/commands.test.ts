import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { commands, ConfigurationTarget, workspace } from 'coc.nvim'
import type { LanguageClient } from 'coc.nvim'
import { collectStatusReport } from '../src/attach.ts'
import { applyCompletionAction, changeCompletionModel, completionCommandIds, getDocumentCompletionEnabled, getLanguageCompletionOverride } from '../src/controls.ts'

let bufferId = 0

async function waitForCurrentDocument(bufnr: number): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const doc = workspace.getDocument(bufnr)
    if (doc?.attached && doc.filetype === 'typescript') return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Buffer ${bufnr} was not attached as a TypeScript document`)
}

beforeEach(async () => {
  await workspace.nvim.command('augroup CocCopilotTest')
  await workspace.nvim.command('autocmd!')
  await workspace.nvim.command('autocmd BufNewFile * let [b:coc_copilot_disable, b:coc_inline_disable] = [1, 1]')
  await workspace.nvim.command('augroup END')
  await workspace.nvim.command(`edit! coc-copilot-test-${process.pid}-${bufferId++}.ts`)
  const bufnr = await workspace.nvim.call('bufnr', ['%']) as number
  await workspace.nvim.command('setfiletype typescript')
  await waitForCurrentDocument(bufnr)
  await workspace.getConfiguration('github-copilot', null).update('enableCompletionByLanguage', {}, ConfigurationTarget.Global)
  await workspace.getConfiguration('github-copilot', null).update('enableCompletion', false, ConfigurationTarget.Global)
  await workspace.getConfiguration('github.copilot', null).update('selectedCompletionModel', '', ConfigurationTarget.Global)
  const doc = await workspace.document
  await doc.buffer.setVar('coc_copilot_disable', 1)
  await doc.buffer.setVar('coc_inline_disable', 1)
})

describe('GitHub Copilot diagnostic commands', () => {
  it('registers the status and quota commands', () => {
    assert.equal(commands.has('github-copilot.status'), true)
    assert.equal(commands.has('github-copilot.quota'), true)
    assert.equal(commands.has('github-copilot.changeCompletionModel'), true)
    assert.equal(commands.has(completionCommandIds.enable), true)
    assert.equal(commands.has(completionCommandIds.disable), true)
  })

  it('collects configuration and buffer-local state from the editor', async () => {
    const client = {
      state: 1,
      isRunning: () => false
    } as unknown as LanguageClient

    const report = await collectStatusReport(
      client,
      workspace.getConfiguration('github-copilot')
    )

    assert.equal(report.service, 'Stopped')
    assert.equal(report.running, false)
    assert.ok(report.buffer)
    assert.equal(report.buffer.configEnabled, false)
    assert.equal(report.buffer.configSource, 'user')
    assert.equal(report.buffer.globalEnabled, false)
    assert.equal(report.buffer.languageId, 'typescript')
    assert.equal(report.buffer.languageOverride, undefined)
    assert.equal(report.buffer.filetype, 'typescript')
    assert.equal(report.buffer.filetypeEnabled, false)
    assert.equal(report.buffer.copilotDisabled, true)
    assert.equal(report.buffer.inlineDisabled, true)
    assert.equal(report.authentication, undefined)
    assert.equal(report.file, undefined)
  })

  it('collects authentication and file status independently from a running client', async () => {
    const requests: string[] = []
    const client = {
      state: 2,
      isRunning: () => true,
      sendRequest: async (method: string) => {
        requests.push(method)
        if (method === 'checkStatus') return { status: 'OK', user: 'octocat' }
        if (method === 'checkFileStatus') return { status: 'included' }
        throw new Error(`Unexpected request: ${method}`)
      }
    } as unknown as LanguageClient

    const report = await collectStatusReport(
      client,
      workspace.getConfiguration('github-copilot')
    )

    assert.equal(report.service, 'Running')
    assert.equal(report.running, true)
    assert.equal(report.authentication?.status, 'OK')
    assert.equal(report.authentication?.user, 'octocat')
    assert.equal(report.file?.status, 'included')
    assert.deepEqual(requests.sort(), ['checkFileStatus', 'checkStatus'])
  })

  it('preserves independent request failures for diagnostics', async () => {
    const client = {
      state: 2,
      isRunning: () => true,
      sendRequest: async (method: string) => {
        throw new Error(`${method} failed`)
      }
    } as unknown as LanguageClient

    const report = await collectStatusReport(
      client,
      workspace.getConfiguration('github-copilot')
    )

    assert.equal(report.authenticationError, 'checkStatus failed')
    assert.equal(report.fileError, 'checkFileStatus failed')
    assert.equal(report.authentication, undefined)
    assert.equal(report.file, undefined)
  })

  it('controls global, language and current-buffer completion scopes', async () => {
    const doc = await workspace.document

    await applyCompletionAction('enable', async (items) => {
      assert.equal(items.map(item => typeof item === 'string' ? item : item.text).join('|'), 'Global|Current language (typescript)|Current buffer')
      return 0
    })
    assert.equal(workspace.getConfiguration('github-copilot', null).get('enableCompletion'), true)
    await applyCompletionAction('disable', async (_items) => 0)
    assert.equal(workspace.getConfiguration('github-copilot', null).get('enableCompletion'), false)

    await applyCompletionAction('enable', async (_items) => 0)
    await applyCompletionAction('disable', async (_items) => 1)
    assert.equal(getLanguageCompletionOverride('typescript'), false)
    assert.equal(getDocumentCompletionEnabled(doc), false)
    assert.equal(workspace.getConfiguration('github-copilot', null).get('enableCompletion'), true)
    const report = await collectStatusReport({
      state: 1,
      isRunning: () => false
    } as unknown as LanguageClient, workspace.getConfiguration('github-copilot'))
    assert.equal(report.buffer?.configEnabled, false)
    assert.equal(report.buffer?.globalEnabled, true)
    assert.equal(report.buffer?.languageOverride, false)
    assert.equal(report.buffer?.configSource, 'current language (typescript)')
    await applyCompletionAction('enable', async (_items) => 1)
    assert.equal(getLanguageCompletionOverride('typescript'), true)

    await applyCompletionAction('enable', async (_items) => 2)
    assert.equal(await doc.buffer.getVar('coc_copilot_disable'), 0)
    await applyCompletionAction('disable', async (_items) => 2)
    assert.equal(await doc.buffer.getVar('coc_copilot_disable'), 1)
    await applyCompletionAction('enable', async (_items) => 2)
    assert.equal(await doc.buffer.getVar('coc_copilot_disable'), 0)
  })

  it('filters completion models, uses the Coc menu and updates the selected model', async () => {
    const client = {
      isRunning: () => true,
      sendRequest: async (method: string) => {
        assert.equal(method, 'copilot/models')
        return [
          { id: 'chat-model', modelName: 'Chat model', scopes: ['chat'] },
          { id: 'fast-model', modelName: 'Fast model', scopes: ['completion'] }
        ]
      }
    } as unknown as LanguageClient

    const model = await changeCompletionModel(client, async (items, option) => {
      assert.equal(items.length, 1)
      assert.equal(typeof items[0] === 'string' ? items[0] : items[0].text, 'Fast model (fast-model)')
      assert.equal(typeof option === 'string' ? option : option?.title, 'Change Completion Model')
      return 0
    })

    assert.equal(model?.id, 'fast-model')
    assert.equal(workspace.getConfiguration('github.copilot', null).get('selectedCompletionModel'), 'fast-model')
  })
})
