export enum PageState {
  Pending = 'pending',
  Retry = 'retry',
  Success = 'success',
  Failed = 'failed',
  Aborted = 'aborted',
}

const TERMINAL_STATES = new Set([PageState.Success, PageState.Failed, PageState.Aborted])

export function isTerminal(state: PageState): boolean {
  return TERMINAL_STATES.has(state)
}
