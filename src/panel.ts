import { Buffer, CancellationTokenSource, commands, Disposable, disposeAll, FormattingOptions, InlineCompletionItem, LanguageClient, Mutex, nvim, Position, ProgressType, Range, snippetManager, StringValue, TextEdit, window, workspace } from 'coc.nvim';
import { canAcceptPanelEdit, getEditEndPosition } from './panelUtils';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function formatInsertText(text: string, opts: FormattingOptions): string {
  let lines = text.split(/\r?\n/)
  let tabSize = opts.tabSize ?? 2
  let ind = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t'
  lines = lines.map(line => {
    let space = (line.match(/^\s*/) ?? [''])[0]
    let isTab = space.startsWith('\t')
    let len = space.length
    if (isTab && opts.insertSpaces) {
      space = ind.repeat(space.length)
    } else if (!isTab && !opts.insertSpaces) {
      space = ind.repeat(Math.floor(space.length / tabSize))
    }
    return space + line.slice(len)
  })
  return lines.join('\n')
}

export async function getInsertText(item: InlineCompletionItem, formatOptions: FormattingOptions): Promise<string> {
  if (StringValue.isSnippet(item.insertText)) {
    return await snippetManager.resolveSnippet(item.insertText.value)
  }
  return formatInsertText(item.insertText, formatOptions)
}

const keys = {
  accept: '<cr>',
  next: ']]',
  prev: '[[',
}

export interface PanelConfig {
  readonly formatOptions: FormattingOptions
  readonly commentNs: number
  readonly seperatorNs: number
  readonly targetUri: string
  readonly targetWinid: number
  readonly position: Position
  readonly targetVersion: number
  readonly targetLine: string
  readonly wasInsert: boolean
}

export interface PanelItem {
  readonly startIndex: number
  readonly endIndex: number
  readonly item: InlineCompletionItem
}

export class Panel {
  private buffer: Buffer
  private lines: string[] = ['']
  private disposables: Disposable[] = []
  private listener: Disposable | undefined
  private mutex = new Mutex()
  private _disposed = false
  private interval: NodeJS.Timeout | undefined
  private items: PanelItem[] = []
  constructor(
    private _bufnr: number,
    public readonly winid: number,
    private token: string,
    private client: LanguageClient,
    private tokenSource: CancellationTokenSource | undefined,
    private config: PanelConfig
  ) {
    this.buffer = workspace.nvim.createBuffer(this._bufnr)
    this.buffer.setOption('modifiable', false)
    this.interval = setInterval(() => {
      this.setCommentVtext(true)
    }, 100)
    this.listener = client.onProgress<{ items: InlineCompletionItem[] }>(new ProgressType(), this.token, async result => {
      if (result && Array.isArray(result.items)) {
        for (const item of result.items) {
          await this.addItem(item)
        }
      }
    })
    this.addKeymappings()
  }

  private addKeymappings(): void {
    this.disposables.push(workspace.registerLocalKeymap(this._bufnr, 'n', keys.accept, async () => {
      let lnum = await workspace.nvim.call('line', '.') as number
      let curr = this.getCurrentItem(lnum - 1)
      if (curr) {
        await this.acceptItem(curr.item)
      }
    }))
    this.disposables.push(workspace.registerLocalKeymap(this._bufnr, 'n', keys.next, async () => {
      await this.navigate(true)
    }))
    this.disposables.push(workspace.registerLocalKeymap(this._bufnr, 'n', keys.prev, async () => {
      await this.navigate(false)
    }))
  }

  public async acceptItem(item: InlineCompletionItem): Promise<boolean> {
    const doc = workspace.getDocument(this.config.targetUri)
    if (!doc?.attached) {
      void window.showWarningMessage(`Target buffer ${this.config.targetUri} is not attached`)
      return false
    }

    const range = item.range ?? Range.create(this.config.position, this.config.position)
    const currentLine = range.start.line === this.config.position.line ? doc.getline(range.start.line) : undefined
    if (!canAcceptPanelEdit(doc.version, this.config.targetVersion, doc.dirty, currentLine, this.config.targetLine)) {
      void window.showErrorMessage('Target buffer has changed since requesting the completion.')
      return false
    }

    const insertText = await getInsertText(item, this.config.formatOptions)
    const endPosition = getEditEndPosition(range.start, insertText)
    await doc.applyEdits([TextEdit.replace(range, insertText)])
    if (item.command) {
      try {
        await commands.executeCommand(item.command.command, ...item.command.arguments ?? [])
      } catch (err) {
        this.client.error(`Error on executing command "${item.command.command}"`, err, true)
      }
    }

    this.dispose()
    await workspace.nvim.command(`silent! bwipeout! ${this._bufnr}`)
    let moved = await workspace.nvim.call('win_gotoid', [this.config.targetWinid]) as number
    if (!moved) {
      const winid = await workspace.nvim.call('bufwinid', [doc.bufnr]) as number
      if (winid > 0) moved = await workspace.nvim.call('win_gotoid', [winid]) as number
    }
    if (moved) {
      await window.moveTo(endPosition)
      if (this.config.wasInsert) {
        const atLineEnd = endPosition.character >= doc.getline(endPosition.line).length
        await workspace.nvim.call('feedkeys', [atLineEnd ? 'a' : 'i', 'in'])
      }
    } else {
      void window.showWarningMessage(`Target buffer ${this.config.targetUri} is not visible`)
    }
    return true
  }

  private async navigate(next: boolean): Promise<void> {
    let lnum = await workspace.nvim.call('line', '.') as number
    lnum = lnum == 1 ? 2 : lnum
    let curr = this.getCurrentItem(lnum - 1)
    if (!curr) return
    let idx = next ? curr.index + 1 : curr.index - 1
    if (next && idx >= this.items.length) {
      idx = 0
    } else if (!next && idx < 0) {
      idx = this.items.length - 1
    }
    let item = this.items[idx]
    if (item) {
      let startIndex = item.startIndex + 2
      workspace.nvim.call('cursor', [startIndex, 1], true)
      workspace.nvim.command(`normal! zt`, true)
    }
  }

  public setCommentVtext(progress = false): void {
    if (this._disposed) return
    let text = progress ? frames[Math.floor((new Date).getMilliseconds() / 100)] + ' Loading suggestions ' : ''
    if (this.items.length > 0) text += `Press ${keys.accept} to accepted the suggestion, press "${keys.next}" or "${keys.prev}" to navigate`
    this.buffer.clearNamespace(this.config.commentNs)
    this.buffer.setVirtualText(this.config.commentNs, 0, [[text, 'Comment']], {
      indent: false,
      virt_lines: []
    } as any)
    workspace.nvim.redrawVim()
  }

  public addSeperators(): void {
    this.buffer.clearNamespace(this.config.seperatorNs)
    let idx = 1
    let total = this.items.length
    for (let obj of this.items) {
      let { startIndex } = obj
      this.buffer.setVirtualText(this.config.seperatorNs, startIndex, [[`Suggestion ${idx}/${total}`, 'CocInlineAnnotation']], {
        indent: false,
        virt_lines: []
      } as any)
      idx++
    }
  }

  public detachListener(): void {
    this.setCommentVtext(false)
    clearInterval(this.interval)
    this.listener?.dispose()
    this.listener = undefined
  }

  public addItem(item: InlineCompletionItem): void {
    this.mutex.use(async () => {
      if (this._disposed) return
      let content = await getInsertText(item, this.config.formatOptions)
      let startIndex = this.lines.length
      nvim.pauseNotification()
      this.buffer.setOption('modifiable', true, true)
      this.appendLines([''])
      this.appendLines(content.split(/\r?\n/))
      this.buffer.setOption('modifiable', false, true)
      let endIndex = this.lines.length
      this.items.push({ startIndex, endIndex, item })
      this.addSeperators()
      nvim.resumeNotification(true)
    }).catch(_e => {
      // ignore
    })
  }

  private appendLines(lines: string[]): void {
    this.lines.push(...lines)
    workspace.nvim.call('appendbufline', [this._bufnr, '$', lines], true)
  }

  public getCurrentItem(lineidx: number): { index: number, item: InlineCompletionItem } | undefined {
    for (let i = 0; i < this.items.length; i++) {
      let obj = this.items[i]
      if (obj.startIndex <= lineidx && obj.endIndex > lineidx) {
        return { index: i, item: obj.item }
      }
    }
  }

  public get linecount(): number {
    return this.lines.length
  }


  public get bufnr(): number {
    return this._bufnr
  }

  public get content(): string {
    return this.lines.join('\n')
  }

  public dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.items = []
    if (this.interval) {
      clearInterval(this.interval)
    }
    this.listener?.dispose()
    this.listener = undefined
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = undefined
    }
    disposeAll(this.disposables)
    this.disposables = []
    this.lines = []
  }
}

export default Panel
