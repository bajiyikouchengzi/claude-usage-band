export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type LastTurn = { input: number; output: number; cacheRead: number; cacheWrite: number; tps: number }
// cap5h: the 5h window's estimated size in dollars at API list prices, learned from
// how far the window's percentage moved while this machine's sessions spent.
export type Stats = { limits: Limit[]; ctxPercent?: number; costUsd?: number; cap5h?: number; last?: LastTurn }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { stats: Stats }
  }
}
