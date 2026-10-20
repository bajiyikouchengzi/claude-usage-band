export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type LastTurn = { input: number; output: number; cacheRead: number; cacheWrite: number; tps: number }
// spent5h: what this machine's Claude Code sessions spent in the current 5h window, in
// dollars at API list prices. cap5h: the window's estimated size in the same dollars,
// from how far its percentage moved against that spend.
export type Stats = {
  limits: Limit[]
  ctxPercent?: number
  costUsd?: number
  spent5h?: number
  cap5h?: number
  last?: LastTurn
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { stats: Stats }
  }
}
