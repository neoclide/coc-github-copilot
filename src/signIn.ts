export interface SigInResult {
  userCode?: unknown
  status?: unknown
  user?: unknown
  command?: {
    command?: unknown
    arguments?: unknown
  }
}

export interface SigInCommand {
  command: string
  arguments: unknown[]
}

export function getSignInCommand(result: SigInResult): SigInCommand | undefined {
  const command = result.command
  if (typeof command?.command !== 'string' || command.command.length === 0) return undefined
  return {
    command: command.command,
    arguments: Array.isArray(command.arguments) ? command.arguments : []
  }
}

export function isAlreadySignedIn(result: SigInResult): boolean {
  return result.status === 'AlreadySignedIn' || result.status === 'OK' || result.status === 'MaybeOK'
}
