import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configurationSource,
  formatQuotaReport,
  formatServiceState,
  formatStatusReport,
  isFiletypeEnabled
} from '../src/diagnostics.ts'

test('configurationSource uses the most specific defined value', () => {
  assert.equal(configurationSource({ defaultValue: true }), 'default')
  assert.equal(configurationSource({ defaultValue: true, globalValue: false }), 'user')
  assert.equal(configurationSource({ globalValue: true, workspaceValue: false }), 'workspace')
  assert.equal(configurationSource({ workspaceValue: true, workspaceFolderValue: false }), 'workspace folder')
  assert.equal(configurationSource(undefined), 'unknown')
})

test('isFiletypeEnabled handles exact, wildcard, null and empty selectors', () => {
  assert.equal(isFiletypeEnabled(['typescript'], 'typescript'), true)
  assert.equal(isFiletypeEnabled(['*'], 'text'), true)
  assert.equal(isFiletypeEnabled([null], 'text'), true)
  assert.equal(isFiletypeEnabled([], 'typescript'), false)
  assert.equal(isFiletypeEnabled(['javascript'], 'typescript'), false)
})

test('formatServiceState covers all language client states', () => {
  assert.equal(formatServiceState(1), 'Stopped')
  assert.equal(formatServiceState(2), 'Running')
  assert.equal(formatServiceState(3), 'Starting')
  assert.equal(formatServiceState(4), 'Start failed')
  assert.equal(formatServiceState(99), 'Unknown')
})

test('formatStatusReport combines service, login, local disable and content policy', () => {
  const report = formatStatusReport({
    service: 'Running',
    running: true,
    authentication: { status: 'MaybeOK', user: 'octocat' },
    buffer: {
      configEnabled: true,
      configSource: 'workspace',
      globalEnabled: true,
      languageId: 'typescript',
      filetype: 'typescript',
      filetypeEnabled: true,
      copilotDisabled: true,
      inlineDisabled: false
    },
    file: { status: 'blocked', reason: 'Content excluded by repository policy' }
  })

  assert.match(report, /Service: Running/)
  assert.match(report, /Authentication: Credentials found for octocat \(not verified\)/)
  assert.match(report, /Current buffer: Disabled/)
  assert.match(report, /Effective configuration: github-copilot\.enableCompletion=true \(workspace\)/)
  assert.match(report, /current buffer b:coc_copilot_disable is set/)
  assert.match(report, /file is excluded by content policy/)
  assert.match(report, /File status: Excluded by content policy: Content excluded by repository policy/)
})

test('formatStatusReport preserves local diagnostics when the service is stopped', () => {
  const report = formatStatusReport({
    service: 'Stopped',
    running: false,
    buffer: {
      configEnabled: false,
      configSource: 'current language (markdown)',
      globalEnabled: true,
      languageId: 'markdown',
      languageOverride: false,
      filetype: 'markdown',
      filetypeEnabled: false,
      copilotDisabled: false,
      inlineDisabled: true
    }
  })

  assert.match(report, /Authentication: Unavailable \(service is not running\)/)
  assert.match(report, /Current buffer: Disabled/)
  assert.match(report, /current language \(markdown\) override is false/)
  assert.match(report, /Global configuration: github-copilot\.enableCompletion=true/)
  assert.match(report, /Language override \(markdown\): github-copilot\.enableCompletion=false/)
  assert.match(report, /filetype markdown is not enabled/)
  assert.match(report, /b:coc_inline_disable is set/)
  assert.match(report, /File status: Unavailable \(service is not running\)/)
})

test('formatStatusReport distinguishes global and current-buffer disables', () => {
  const report = formatStatusReport({
    service: 'Stopped',
    running: false,
    buffer: {
      configEnabled: false,
      configSource: 'user',
      globalEnabled: false,
      languageId: 'typescript',
      filetype: 'typescript',
      filetypeEnabled: true,
      copilotDisabled: true,
      inlineDisabled: false
    }
  })

  assert.match(report, /global github-copilot\.enableCompletion is false/)
  assert.match(report, /current buffer b:coc_copilot_disable is set/)
})

test('formatQuotaReport shows percentage, plan, overage and reset date', () => {
  const report = formatQuotaReport({
    completions: { percentRemaining: 42.56, overagePermitted: true },
    copilotPlan: 'business',
    resetDate: '2026-09-01'
  })

  assert.equal(report, [
    'GitHub Copilot quota',
    'Plan: business',
    'Completions: 42.6% remaining',
    'Overage: Permitted',
    'Reset date: 2026-09-01'
  ].join('\n'))
})

test('formatQuotaReport handles unlimited and incomplete responses', () => {
  assert.match(formatQuotaReport({ completions: { unlimited: true } }), /Completions: Unlimited/)
  assert.match(formatQuotaReport({}), /Completions: unknown% remaining/)
  assert.match(formatQuotaReport({}), /Reset date: unknown/)
})
