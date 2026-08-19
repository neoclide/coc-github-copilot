export interface ConfigurationInspect<T> {
  defaultValue?: T
  globalValue?: T
  workspaceValue?: T
  workspaceFolderValue?: T
}

export interface CheckStatusResult {
  status: string
  user?: string
}

export interface CheckFileStatusResult {
  status: string
  reason?: string
}

export interface QuotaValue {
  percentRemaining?: number
  unlimited?: boolean
  overagePermitted?: boolean
}

export interface CheckQuotaResult {
  completions?: QuotaValue
  copilotPlan?: string
  resetDate?: string
}

export interface BufferStatus {
  configEnabled: boolean
  configSource: string
  globalEnabled: boolean
  languageId: string
  languageOverride?: boolean
  filetype: string
  filetypeEnabled: boolean
  copilotDisabled: boolean
  inlineDisabled: boolean
}

export interface StatusReport {
  service: string
  running: boolean
  authentication?: CheckStatusResult
  authenticationError?: string
  buffer?: BufferStatus
  file?: CheckFileStatusResult
  fileError?: string
}

export function configurationSource(inspect: ConfigurationInspect<boolean> | undefined): string {
  if (!inspect) return 'unknown'
  if (inspect.workspaceFolderValue !== undefined) return 'workspace folder'
  if (inspect.workspaceValue !== undefined) return 'workspace'
  if (inspect.globalValue !== undefined) return 'user'
  if (inspect.defaultValue !== undefined) return 'default'
  return 'unknown'
}

export function isFiletypeEnabled(filetypes: Array<string | null>, filetype: string): boolean {
  return filetypes.some(item => item == null || item === '*' || item === filetype)
}

export function formatServiceState(state: number): string {
  switch (state) {
    case 1:
      return 'Stopped'
    case 2:
      return 'Running'
    case 3:
      return 'Starting'
    case 4:
      return 'Start failed'
    default:
      return 'Unknown'
  }
}

function formatAuthentication(result: CheckStatusResult): string {
  const user = result.user ? ` as ${result.user}` : ''
  switch (result.status) {
    case 'OK':
      return `Signed in${user}`
    case 'MaybeOK':
      return result.user ? `Credentials found for ${result.user} (not verified)` : 'Credentials found (not verified)'
    case 'NotSignedIn':
      return 'Not signed in'
    default:
      return user ? `${result.status}${user}` : result.status
  }
}

function formatFileStatus(result: CheckFileStatusResult): string {
  const reason = result.reason ? `: ${result.reason}` : ''
  switch (result.status) {
    case 'included':
      return 'Included'
    case 'empty':
      return 'Empty (content policy not evaluated)'
    case 'blocked':
      return `Excluded by content policy${reason}`
    case 'notfound':
      return `Not found${reason}`
    default:
      return `${result.status}${reason}`
  }
}

export function formatStatusReport(report: StatusReport): string {
  const lines = [
    'GitHub Copilot status',
    `Service: ${report.service}`
  ]

  if (report.authentication) {
    lines.push(`Authentication: ${formatAuthentication(report.authentication)}`)
  } else if (report.authenticationError) {
    lines.push(`Authentication: Unavailable (${report.authenticationError})`)
  } else if (!report.running) {
    lines.push('Authentication: Unavailable (service is not running)')
  } else {
    lines.push('Authentication: Unknown')
  }

  if (!report.buffer) {
    lines.push('Current buffer: Not attached')
  } else {
    const disabledBy: string[] = []
    if (!report.buffer.configEnabled) {
      if (report.buffer.languageOverride === false) {
        disabledBy.push(`current language (${report.buffer.languageId || '(none)'}) override is false`)
      } else if (!report.buffer.globalEnabled) {
        disabledBy.push('global github-copilot.enableCompletion is false')
      } else {
        disabledBy.push(`github-copilot.enableCompletion is false (${report.buffer.configSource})`)
      }
    }
    if (!report.buffer.filetypeEnabled) {
      disabledBy.push(`filetype ${report.buffer.filetype || '(none)'} is not enabled`)
    }
    if (report.buffer.copilotDisabled) {
      disabledBy.push('current buffer b:coc_copilot_disable is set')
    }
    if (report.buffer.inlineDisabled) {
      disabledBy.push('b:coc_inline_disable is set')
    }
    if (report.file?.status === 'blocked') {
      disabledBy.push('file is excluded by content policy')
    }

    lines.push(`Current buffer: ${disabledBy.length === 0 ? 'Enabled' : 'Disabled'}`)
    lines.push(`Effective configuration: github-copilot.enableCompletion=${String(report.buffer.configEnabled)} (${report.buffer.configSource})`)
    lines.push(`Global configuration: github-copilot.enableCompletion=${String(report.buffer.globalEnabled)}`)
    if (report.buffer.languageOverride !== undefined) {
      lines.push(`Language override (${report.buffer.languageId || '(none)'}): github-copilot.enableCompletion=${String(report.buffer.languageOverride)}`)
    }
    if (disabledBy.length > 0) lines.push(`Disabled by: ${disabledBy.join(', ')}`)
  }

  if (report.file) {
    lines.push(`File status: ${formatFileStatus(report.file)}`)
  } else if (report.fileError) {
    lines.push(`File status: Unavailable (${report.fileError})`)
  } else if (report.buffer && !report.running) {
    lines.push('File status: Unavailable (service is not running)')
  }

  return lines.join('\n')
}

function formatPercent(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'unknown'
  const normalized = Math.min(100, Math.max(0, value))
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1)
}

export function formatQuotaReport(result: CheckQuotaResult): string {
  const lines = [
    'GitHub Copilot quota',
    `Plan: ${result.copilotPlan || 'unknown'}`
  ]
  const completions = result.completions
  if (completions?.unlimited) {
    lines.push('Completions: Unlimited')
  } else {
    lines.push(`Completions: ${formatPercent(completions?.percentRemaining)}% remaining`)
  }
  if (completions?.overagePermitted) lines.push('Overage: Permitted')
  lines.push(`Reset date: ${result.resetDate || 'unknown'}`)
  return lines.join('\n')
}
