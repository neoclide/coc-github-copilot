import { CancellationTokenSource, commands, Disposable, events, InlineCompletionItem, LanguageClient, State, Uri, window, workspace, WorkspaceConfiguration } from 'coc.nvim';
import Panel, { PanelConfig } from './panel';

interface SigInResult {
  userCode: string
  command: {
    command: string
    arguments: any[]
    title: string
  }
}
const commentNamespace = 'copolitComment'
const seperatorNamespace = 'copolitSpeerator'

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
    nvim.command(`silent! bwipeout ${bufnrs.join(' ')}`, true)
  }))

  events.on('BufUnload', async (bufnr: number) => {
    for (const [uri, panel] of panels.entries()) {
      if (panel.bufnr === bufnr) {
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
    const cmd = config.get<string>('panelCommand', 'keepalt vs')
    const uri = `github-copolit:///panel/${partialResultToken}`
    nvim.pauseNotification()
    nvim.command(`${cmd} ${uri}`, true)
    nvim.call('bufnr', ['%'], true)
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
    const panel = new Panel(res[0][1] as number, partialResultToken, client, tokenSource, conf)
    panels.set(panelUri.toString(), panel);
    const token = tokenSource.token
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
  }

  subscriptions.push(workspace.registerTextDocumentContentProvider('github-copolit', {
    provideTextDocumentContent: async (uri: Uri): Promise<string> => {
      let panel = panels.get(uri.toString());
      if (!panel) return ''
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
      await window.showInformationMessage(`Please copy your user code: ${result.userCode}`, 'Continue').then(selected => {
        if (selected != null) {
          commands.executeCommand(result.command.command, ...result.command.arguments)
        }
      })
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

  client.onNotification('didChangeStatus', event => {
    let msg: string = event.message ?? ''
    statusItem.isProgress = event.busy === true
    switch (event.kind) {
      case 'Error':
        if (msg.length > 0) {
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
