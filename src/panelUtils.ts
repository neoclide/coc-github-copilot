import type { Position } from 'coc.nvim'

export function canAcceptPanelEdit(
  currentVersion: number,
  requestedVersion: number,
  dirty: boolean,
  currentLine: string | undefined,
  originalLine: string
): boolean {
  return currentVersion === requestedVersion && !dirty || currentLine === originalLine
}

export function getEditEndPosition(start: Position, text: string): Position {
  const lines = text.split(/\r?\n/)
  if (lines.length === 1) {
    return { line: start.line, character: start.character + lines[0].length }
  }
  return {
    line: start.line + lines.length - 1,
    character: lines[lines.length - 1].length
  }
}
