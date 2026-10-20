export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type LastTurn = { input: number; output: number; cacheRead: number; cacheWrite: number; tps: number }
export type Stats = { limits: Limit[]; ctxPercent?: number; costUsd?: number; last?: LastTurn }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { stats: Stats }
  }
}
