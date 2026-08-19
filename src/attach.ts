import { CancellationTokenSource, commands, Disposable, events, InlineCompletionItem, LanguageClient, State, Uri, window, workspace, WorkspaceConfiguration } from 'coc.nvim';
import { BufferStatus, CheckFileStatusResult, CheckQuotaResult, CheckStatusResult, configurationSource, formatQuotaReport, formatServiceState, formatStatusReport, isFiletypeEnabled, StatusReport } from './diagnostics';
import Panel, { PanelConfig } from './panel';

interface SigInResult {
  userCode: string
  command: {
    command: string
    arguments: any[]
    title: string
  }
}
const commentNamespace = 'copilotComment'
const seperatorNamespace = 'copilotSpeerator'

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

export async function collectStatusReport(client: LanguageClient, config: WorkspaceConfiguration): Promise<StatusReport> {
  const doc = await workspace.document
  let buffer: BufferStatus | undefined
  if (doc?.attached) {
    const scopedConfig = workspace.getConfiguration('github-copilot', doc)
    const configEnabled = scopedConfig.get<boolean>('enableCompletion', true)
    const filetypes = config.get<Array<string | null>>('filetypes', ['*'])
    const [copilotDisabled, inlineDisabled] = await Promise.all([
      doc.getVar('copilot_disable'),
      doc.getVar('inline_disable')
    ])
    buffer = {
      configEnabled,
      configSource: configurationSource(scopedConfig.inspect<boolean>('enableCompletion')),
      filetype: doc.filetype,
      filetypeEnabled: isFiletypeEnabled(filetypes, doc.filetype),
      copilotDisabled: Boolean(copilotDisabled),
      inlineDisabled: Boolean(inlineDisabled)
    }
  }

  const running = client.isRunning()
  let authentication: CheckStatusResult | undefined
  let authenticationError: string | undefined
  let file: CheckFileStatusResult | undefined
  let fileError: string | undefined
  if (running) {
    const [authenticationResult, fileResult] = await Promise.allSettled([
      client.sendRequest<CheckStatusResult>('checkStatus', {}),
      buffer && doc ? client.sendRequest<CheckFileStatusResult>('checkFileStatus', { uri: doc.uri }) : Promise.resolve(undefined)
    ])
    if (authenticationResult.status === 'fulfilled') {
      authentication = authenticationResult.value
    } else {
      authenticationError = errorMessage(authenticationResult.reason)
    }
    if (fileResult.status === 'fulfilled') {
      file = fileResult.value
    } else {
      fileError = errorMessage(fileResult.reason)
    }
  }

  return {
    service: formatServiceState(client.state),
    running,
    authentication,
    authenticationError,
    buffer,
    file,
    fileError
  }
}

function uuid(): string {
  // Generate a UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function register(subscriptions: Disposable[], client: LanguageClient, config: WorkspaceConfiguration): void {
  const { nvim } = workspace
  const panels: Map<string, Panel> = new Map();
  subscriptions.push(Disposable.create(() => {
    let bufnrs: number[] = []
    for (let panel of panels.values()) {
      bufnrs.push(panel.bufnr)
      panel.dispose()
    }
    panels.clear()
    if (bufnrs.length > 0) {
      nvim.command(`silent! bwipeout ${bufnrs.join(' ')}`, true)
    }
  }))

  events.on('WinClosed', async (winid: number) => {
    for (const [uri, panel] of panels.entries()) {
      if (panel.winid === winid) {
        panel.dispose()
        panels.delete(uri);
        break
      }
    }
  }, null, subscriptions)

  let commentNs: number
  let seperatorNs: number
  async function openPanel(client: LanguageClient, config: WorkspaceConfiguration): Promise<void> {
    const doc = await workspace.document
    if (!doc || !doc.attached) {
      void window.showErrorMessage('Current document is not attached');
      return
    }

    const targetWinid = await nvim.call('win_getid') as number
    if (!commentNs) commentNs = await nvim.createNamespace(commentNamespace)
    if (!seperatorNs) seperatorNs = await nvim.createNamespace(seperatorNamespace)
    const position = await window.getCursorPosition()
    const formattingOptions = await workspace.getFormatOptions(doc.uri)
    const partialResultToken = uuid()
    const params = {
      textDocument: {
        uri: doc.uri,
        version: doc.version
      },
      position,
      formattingOptions,
      partialResultToken
    }
    const cmd = config.get<string>('openPanelCommand', 'keepalt vs')
    const uri = `github-copilot:///panel/${partialResultToken}`
    nvim.pauseNotification()
    nvim.command(`${cmd} ${uri}`, true)
    nvim.call('bufnr', ['%'], true)
    nvim.call('win_getid', [], true)
    nvim.command('setlocal nospell nofoldenable nowrap noswapfile', true)
    nvim.command('setlocal buftype=nofile bufhidden=wipe', true)
    nvim.command(`setfiletype ${doc.filetype}`, true)
    let res = await nvim.resumeNotification()
    let panelUri = Uri.parse(uri)
    const tokenSource = new CancellationTokenSource()
    const conf: PanelConfig = {
      formatOptions: formattingOptions,
      commentNs,
      seperatorNs,
      targetUri: doc.uri,
      targetWinid,
      position
    }
    const panel = new Panel(res[0][1] as number, res[0][2] as number, partialResultToken, client, tokenSource, conf)
    panels.set(panelUri.toString(), panel);
    const token = tokenSource.token
    try {
      await client.sendRequest<{ items: InlineCompletionItem[] }>('textDocument/copilotPanelCompletion', params, token).then(res => {
        if (!token.isCancellationRequested) {
          if (res && Array.isArray(res.items)) {
            for (const item of res.items) {
              panel.addItem(item)
            }
          }
        }
        panel.detachListener()
      })
    } catch (e) {
      panel.detachListener()
      if (token.isCancellationRequested) return
      const message = e instanceof Error ? e.message : String(e)
      void window.showErrorMessage(`GitHub Copilot client error: ${message}`)
    }
  }

  subscriptions.push(workspace.registerTextDocumentContentProvider('github-copilot', {
    provideTextDocumentContent: async (uri: Uri): Promise<string> => {
      let panel = panels.get(uri.toString());
      if (!panel) return ''
      let buf = nvim.createBuffer(panel.bufnr)
      await buf.setOption('modifiable', true)
      nvim.command(`syntax on`, true)
      setTimeout(() => {
        panel.addSeperators()
      }, 10)
      return panel.content
    }
  }))

  subscriptions.push(commands.registerCommand('github-copilot.signIn', async () => {
    client.sendRequest<SigInResult>('signIn', {}).then(async result => {
      try {
        await nvim.call('setreg', ['+', result.userCode])
      } catch (e) {
        // ignore Error
      }
      void window.showInformationMessage(`Please copy your user code: ${result.userCode}`, 'Continue').then(selected => {
        if (selected != null) {
          commands.executeCommand(result.command.command, ...result.command.arguments)
        }
      })
    }, e => {
      const message = e instanceof Error ? e.message : String(e)
      void window.showErrorMessage(`Error on signIn: ${message}`)
    })
  }))

  subscriptions.push(commands.registerCommand('github-copilot.signOut', async () => {
    if (client.isRunning()) {
      await client.sendRequest('signOut', {})
    } else {
      void window.showErrorMessage('GitHub Copilot client is not running.')
    }
  }))

  subscriptions.push(commands.registerCommand('github-copilot.openPanel', async () => {
    if (client.isRunning()) {
      await openPanel(client, config)
    } else {
      void window.showErrorMessage('GitHub Copilot client is not running.')
    }
  }))

  subscriptions.push(commands.registerCommand('github-copilot.status', async () => {
    void window.showInformationMessage(formatStatusReport(await collectStatusReport(client, config)))
  }))

  subscriptions.push(commands.registerCommand('github-copilot.quota', async () => {
    if (!client.isRunning()) {
      void window.showErrorMessage('GitHub Copilot client is not running.')
      return
    }
    try {
      const result = await client.sendRequest<CheckQuotaResult>('checkQuota', {})
      void window.showInformationMessage(formatQuotaReport(result))
    } catch (e) {
      const message = errorMessage(e)
      void window.showErrorMessage(`Error checking GitHub Copilot quota: ${message}`)
    }
  }))

  const statusIcon = config.get('statusIcon', '')
  let statusItem = window.createStatusBarItem(99)
  subscriptions.push(statusItem)
  statusItem.text = statusIcon

  client.onDidChangeState(e => {
    if (e.newState === State.Running || e.newState === State.Starting) {
      statusItem.show()
    } else {
      statusItem.hide()
    }
  }, null, subscriptions)

  let limitReached = false
  client.onNotification('didChangeStatus', event => {
    let msg: string = event.message ?? ''
    statusItem.isProgress = event.busy === true
    switch (event.kind) {
      case 'Error':
        if (msg.length > 0) {
          if (msg.includes('limit reached')) {
            if (limitReached) return
            limitReached = true
          }
          if (msg.includes('token is invalid')) {
            window.showErrorMessage(msg, 'Sign in').then(res => {
              if (res != null) {
                void commands.executeCommand('github-copilot.signIn')
              }
            })
          } else {
            window.showErrorMessage(msg)
          }
        }
        statusItem.text = statusIcon + ` ${msg}`
        break
      case 'Warning':
        if (msg.length > 0) window.showWarningMessage(msg)
        break
      case 'Inactive':
        statusItem.text = statusIcon + ' Ignored'
        break
      default:
        statusItem.text = statusIcon
    }
    if (msg) client.outputChannel.appendLine('Status changed ' + msg)
  })

  events.on('InlineShown' as any, item => {
    if (client.isRunning()) {
      client.sendNotification('textDocument/didShowCompletion', { item })
    }
  }, null, subscriptions)

  events.on('InlineAccept' as any, (acceptedLength, item) => {
    if (acceptedLength && client.isRunning()) {
      client.sendNotification('textDocument/didPartiallyAcceptCompletion', { item, acceptedLength })
    }
  }, null, subscriptions)

  subscriptions.push(
    window.onDidChangeActiveTextEditor(e => {
      if (e && client.isRunning()) {
        client.sendNotification('textDocument/didFocus', {
          textDocument: {
            uri: e.document.uri
          }
        })
      }
    })
  )
}
