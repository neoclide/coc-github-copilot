import { commands, Disposable, events, LanguageClient, State, window, workspace, WorkspaceConfiguration } from 'coc.nvim';

interface SigInResult {
  userCode: string
  command: {
    command: string
    arguments: any[]
    title: string
  }
}

export function register(subscriptions: Disposable[], client: LanguageClient, config: WorkspaceConfiguration): void {
  let { nvim } = workspace
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
    await client.sendRequest('signOut', {})
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
    client.sendNotification('textDocument/didShowCompletion', { item })
  }, null, subscriptions)

  events.on('InlineAccept' as any, (acceptedLength, item) => {
    if (acceptedLength) {
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
