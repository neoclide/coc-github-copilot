import { ExtensionContext, LanguageClient, LanguageClientOptions, ServerOptions, services, TransportKind, window, workspace } from 'coc.nvim'
import { version } from '../package.json'
import { register } from './attach'

export async function activate(context: ExtensionContext): Promise<void> {
  const { subscriptions } = context
  const config = workspace.getConfiguration('github-copilot')
  if (!config.get('enable', true)) return
  const filetypes = config.get<string[]>('filetypes', ['*'])

  // Create the language client options
  const clientOptions: LanguageClientOptions = {
    documentSelector: filetypes ?? ['*'], // Enable for all file types
    synchronize: {
      configurationSection: ['github.copilot', 'telemetry', 'github-enterprise', 'http'],
    },
    initializationOptions: {
      editorInfo: {
        name: workspace.isVim ? 'Vim' : 'Neovim',
        version: workspace.env.version
      },
      editorPluginInfo: {
        name: 'coc-github-copilot',
        version: version
      }
    },
    outputChannelName: 'github-copilot',
    middleware: {
      sendRequest: (type, param: any, token, next) => {
        if (typeof type === 'object' && type.method == 'textDocument/inlineCompletion') {
          let textDocument = param.textDocument
          let doc = workspace.getDocument(textDocument.uri)
          if (!doc || doc.getVar('copilot_disable')) {
            return Promise.resolve(undefined as any)
          }
          param.textDocument = param.textDocument ?? { uri: doc.uri }
          param.textDocument.version = doc.version
          param.formattingOptions = window.activeTextEditor?.options
        }
        return next(type, param, token)
      }
    }
  }

  // Configure the server options for GitHub Copilot
  const serverOptions: ServerOptions = {
    module: context.asAbsolutePath('node_modules/@github/copilot-language-server/dist/language-server.js'),
    transport: TransportKind.ipc,
    options: {
      cwd: workspace.root,
      env: {
        GITHUB_TOKEN: config.get<string>('token', process.env.GITHUB_TOKEN ?? ''),
      },
    },
  }

  // Create the language client
  const client = new LanguageClient(
    'github-copilot',
    'GitHub Copilot',
    serverOptions,
    clientOptions
  )
  register(context.subscriptions, client, config)

  // Register the language client
  subscriptions.push(
    services.registerLanguageClient(client)
  )
}
