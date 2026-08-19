import { commands, ConfigurationTarget, Disposable, LanguageClient, MenuItem, window, workspace } from 'coc.nvim'
import type { Document } from 'coc.nvim'

const completionSetting = 'github-copilot.enableCompletion'

export type CompletionScope = 'global' | 'language' | 'buffer'
export type CompletionAction = 'enable' | 'disable'

export interface CopilotModel {
  id: string
  modelName: string
  scopes: string[]
}

export const completionCommandIds: Record<CompletionAction, string> = {
  enable: 'github-copilot.enable',
  disable: 'github-copilot.disable'
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

function languageOverrideKey(languageId: string): string {
  return `[${languageId}]`
}

function getLanguageSettings(languageId: string): Record<string, unknown> | undefined {
  if (!languageId) return undefined
  return workspace.getConfiguration(undefined, null)
    .inspect<Record<string, unknown>>(languageOverrideKey(languageId))
    ?.globalValue
}

export function getLanguageCompletionOverride(languageId: string): boolean | undefined {
  const configured = workspace.getConfiguration('github-copilot', null)
    .get<Record<string, boolean>>('enableCompletionByLanguage', {})[languageId]
  if (typeof configured === 'boolean') return configured
  const value = getLanguageSettings(languageId)?.[completionSetting]
  return typeof value === 'boolean' ? value : undefined
}

export function getDocumentLanguageCompletionOverride(doc: Document): boolean | undefined {
  const configured = getLanguageCompletionOverride(doc.languageId)
  if (configured !== undefined) return configured

  // coc.nvim resolves native [language] sections when a languageId is present,
  // but ConfigurationInspect does not expose the language-specific value.
  const scoped = workspace.getConfiguration('github-copilot', doc).get<boolean>('enableCompletion', true)
  const resource = workspace.getConfiguration('github-copilot', { uri: doc.uri, languageId: '' })
    .get<boolean>('enableCompletion', true)
  return scoped === resource ? undefined : scoped
}

export function getDocumentCompletionEnabled(doc: Document): boolean {
  return getDocumentLanguageCompletionOverride(doc)
    ?? workspace.getConfiguration('github-copilot', doc).get<boolean>('enableCompletion', true)
}

async function getCurrentDocument() {
  const doc = await workspace.document
  if (!doc?.attached) throw new Error('Current document is not attached')
  return doc
}

export async function setCompletionEnabled(scope: CompletionScope, enabled: boolean): Promise<void> {
  if (scope === 'global') {
    await workspace.getConfiguration('github-copilot', null)
      .update('enableCompletion', enabled, ConfigurationTarget.Global)
    return
  }

  const doc = await getCurrentDocument()
  if (scope === 'language') {
    if (!doc.languageId) throw new Error('Current document has no language ID')
    const config = workspace.getConfiguration('github-copilot', null)
    const current = config.get<Record<string, boolean>>('enableCompletionByLanguage', {})
    await config.update('enableCompletionByLanguage', {
      ...current,
      [doc.languageId]: enabled
    }, ConfigurationTarget.Global)
    return
  }

  await doc.buffer.setVar('coc_copilot_disable', enabled ? 0 : 1)
}

function scopeLabel(scope: CompletionScope): string {
  switch (scope) {
    case 'global':
      return 'globally'
    case 'language':
      return 'for the current language'
    case 'buffer':
      return 'for the current buffer'
  }
}

function scopePickerLabel(scope: CompletionScope, languageId?: string): string {
  if (scope === 'global') return 'Global'
  if (scope === 'language') return `Current language${languageId ? ` (${languageId})` : ''}`
  return 'Current buffer'
}

export async function pickCompletionScope(
  action: CompletionAction,
  showMenu: typeof window.showMenuPicker = window.showMenuPicker
): Promise<CompletionScope | undefined> {
  const doc = await workspace.document
  const scopes: CompletionScope[] = ['global', 'language', 'buffer']
  const items: MenuItem[] = scopes.map(scope => ({ text: scopePickerLabel(scope, doc?.languageId) }))
  const index = await showMenu(items, {
    title: `${action === 'enable' ? 'Enable' : 'Disable'} GitHub Copilot completions at…`,
    position: 'center'
  })
  return index >= 0 && index < scopes.length ? scopes[index] : undefined
}

export async function applyCompletionAction(
  action: CompletionAction,
  showMenu: typeof window.showMenuPicker = window.showMenuPicker
): Promise<CompletionScope | undefined> {
  const scope = await pickCompletionScope(action, showMenu)
  if (!scope) return undefined
  await setCompletionEnabled(scope, action === 'enable')
  return scope
}

function completionModels(value: unknown): CopilotModel[] {
  if (!Array.isArray(value)) return []
  return value.filter((model): model is CopilotModel => {
    if (typeof model !== 'object' || model === null) return false
    const candidate = model as Partial<CopilotModel>
    return typeof candidate.id === 'string'
      && typeof candidate.modelName === 'string'
      && Array.isArray(candidate.scopes)
      && candidate.scopes.includes('completion')
  })
}

export async function changeCompletionModel(
  client: LanguageClient,
  showMenu: typeof window.showMenuPicker = window.showMenuPicker
): Promise<CopilotModel | undefined> {
  if (!client.isRunning()) throw new Error('GitHub Copilot client is not running.')
  const models = completionModels(await client.sendRequest<unknown>('copilot/models', {}))
  if (models.length === 0) throw new Error('No completion models are available.')

  const config = workspace.getConfiguration('github.copilot', null)
  const current = config.get<string>('selectedCompletionModel', '')
  const items: MenuItem[] = models.map(model => ({
    text: `${model.modelName} (${model.id})${model.id === current ? ' · current' : ''}`
  }))
  const index = await showMenu(items, { title: 'Change Completion Model', position: 'center' })
  if (index < 0 || index >= models.length) return undefined

  const model = models[index]
  await config.update('selectedCompletionModel', model.id, ConfigurationTarget.Global)
  return model
}

export function registerControls(subscriptions: Disposable[], client: LanguageClient): void {
  for (const action of ['enable', 'disable'] as CompletionAction[]) {
    subscriptions.push(commands.registerCommand(completionCommandIds[action], async () => {
      try {
        const scope = await applyCompletionAction(action)
        if (scope) void window.showInformationMessage(`GitHub Copilot completions ${action}d ${scopeLabel(scope)}.`)
      } catch (error) {
        void window.showErrorMessage(`Unable to update GitHub Copilot completions: ${errorMessage(error)}`)
      }
    }))
  }

  subscriptions.push(commands.registerCommand('github-copilot.changeCompletionModel', async () => {
    try {
      const model = await changeCompletionModel(client)
      if (model) void window.showInformationMessage(`GitHub Copilot completion model set to ${model.modelName} (${model.id}).`)
    } catch (error) {
      void window.showErrorMessage(`Unable to change GitHub Copilot completion model: ${errorMessage(error)}`)
    }
  }))
}
