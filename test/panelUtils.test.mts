import assert from 'node:assert/strict'
import test from 'node:test'
import { canAcceptPanelEdit, formatPanelProgress, getEditEndPosition } from '../src/panelUtils.ts'

test('canAcceptPanelEdit accepts an unchanged version', () => {
  assert.equal(canAcceptPanelEdit(3, 3, false, 'changed', 'original'), true)
})

test('canAcceptPanelEdit accepts unrelated edits when the original line is unchanged', () => {
  assert.equal(canAcceptPanelEdit(4, 3, false, 'original', 'original'), true)
})

test('canAcceptPanelEdit rejects dirty or versioned edits to the original line', () => {
  assert.equal(canAcceptPanelEdit(3, 3, true, 'changed', 'original'), false)
  assert.equal(canAcceptPanelEdit(4, 3, false, 'changed', 'original'), false)
  assert.equal(canAcceptPanelEdit(4, 3, false, undefined, 'original'), false)
})

test('getEditEndPosition handles single-line, multiline and UTF-16 text', () => {
  assert.deepEqual(getEditEndPosition({ line: 2, character: 4 }, 'abc'), { line: 2, character: 7 })
  assert.deepEqual(getEditEndPosition({ line: 2, character: 4 }, 'a\nbc'), { line: 3, character: 2 })
  assert.deepEqual(getEditEndPosition({ line: 0, character: 0 }, '🤖'), { line: 0, character: 2 })
})

test('formatPanelProgress reports generation count, completion and errors', () => {
  assert.equal(formatPanelProgress(2, false, undefined, '2/5', '⠋'), '⠋ Generating suggestions (2) — 2/5')
  assert.equal(formatPanelProgress(1, true, undefined, 'Done'), 'Generated 1 suggestion — Done')
  assert.equal(formatPanelProgress(0, true, 'server unavailable', undefined), 'Error: server unavailable')
})
