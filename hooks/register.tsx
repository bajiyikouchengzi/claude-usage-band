import type { EngineInterface, Register, SessionMeasureInput } from 'claude-code'

import type { Limit, Stats } from '../types'

const stats = { plugin: 'usage-band', key: 'stats' } as const
const empty: Stats = { limits: [] }

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 2)}k` : `${n}`)

const left = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${m % 60}m` : `${m}m`
}

type Level = 'ok' | 'warn' | 'bad'
const level = (p: number): Level => (p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok')

// One accent per metric, [light, dark]. Only the numbers and marks take it; labels stay grey.
const PALETTE = {
  green: ['#16a34a', '#4ade80'],
  violet: ['#7c3aed', '#a78bfa'],
  rose: ['#e11d48', '#fb7185'],
  emerald: ['#059669', '#34d399'],
  blue: ['#2563eb', '#60a5fa'],
  indigo: ['#4f46e5', '#818cf8'],
  amber: ['#d97706', '#fbbf24'],
  sky: ['#0284c7', '#38bdf8'],
  warn: ['#ea580c', '#fb923c'],
  bad: ['#dc2626', '#f87171'],
} as const
type Hue = keyof typeof PALETTE
// A limit keeps its own accent until it nears the cap.
const hueAt = (p: number, own: Hue): Hue => {
  const lv = level(p)
  return lv === 'ok' ? own : lv
}
const paletteCss = (i: 0 | 1) =>
  Object.entries(PALETTE)
    .map(([n, c]) => `.t-${n}{fill:${c[i]}}.f-${n}{fill:${c[i]}}.s-${n}{stroke:${c[i]}}`)
    .join('')

// The band on desktop is one SVG: no DOM to measure text in, so widths come from
// rough per-glyph advances of the system UI font at 12px (tabular digits).
const ADV: Record<string, number> = { ' ': 3.4, '.': 3.4, '/': 4.6, '%': 9.6, $: 7.2, i: 3, l: 3, t: 4.2, f: 4, r: 4.6, m: 10.2, w: 9.4 }
const textWidth = (str: string, bold = false) =>
  [...str].reduce((w, c) => w + (ADV[c] ?? (c >= '0' && c <= '9' ? 7.2 : 6.6)), 0) * (bold ? 1.04 : 1)

const esc = (v: string) => v.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

const bandSvg = (s: Stats, now: number): { source: string; width: number } => {
  const H = 26
  const mid = H / 2
  const base = 17
  const out: string[] = []
  let x = 2

  const text = (v: string, cls: string, bold = false) => {
    out.push(`<text x="${x.toFixed(1)}" y="${base}" class="${cls}">${esc(v)}</text>`)
    x += textWidth(v, bold)
  }
  const gap = (n: number) => (x += n)
  const sep = () => {
    gap(14)
    out.push(`<rect x="${x.toFixed(1)}" y="${mid - 6}" width="1" height="12" class="track"/>`)
    gap(15)
  }
  const bar = (pct: number, hue: Hue, w = 52) => {
    const fill = Math.max(0, Math.min(1, pct / 100)) * w
    out.push(`<rect x="${x.toFixed(1)}" y="${mid - 2.5}" width="${w}" height="5" rx="2.5" class="track"/>`)
    if (fill > 0) {
      out.push(`<rect x="${x.toFixed(1)}" y="${mid - 2.5}" width="${Math.max(fill, 5).toFixed(1)}" height="5" rx="2.5" class="f-${hue}"/>`)
    }
    x += w
  }
  const ring = (pct: number, hue: Hue) => {
    const r = 5
    const c = 2 * Math.PI * r
    const cx = x + r + 1
    out.push(`<circle cx="${cx}" cy="${mid}" r="${r}" fill="none" stroke-width="2" class="track-s"/>`)
    out.push(
      `<circle cx="${cx}" cy="${mid}" r="${r}" fill="none" stroke-width="2" stroke-linecap="round" class="s-${hue}" ` +
        `stroke-dasharray="${((Math.min(pct, 100) / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${cx} ${mid})"/>`,
    )
    x += 2 * r + 2
  }

  s.limits.forEach((l, i) => {
    if (i > 0) gap(18)
    const hue = hueAt(l.percentUsed, l.kind === 'seven_day' ? 'violet' : 'green')
    text(label[l.kind] ?? l.kind, 'l')
    gap(7)
    bar(l.percentUsed, hue)
    gap(8)
    text(`${l.percentUsed}%`, `v t-${hue}`, true)
    const reset = left(l.resetsAt, now)
    if (reset) {
      gap(6)
      text(reset, 'm')
    }
    if (l.kind === 'five_hour' && s.spent5h !== undefined) {
      gap(10)
      text(money(s.spent5h), `v t-${hue}`, true)
      if (s.cap5h !== undefined) {
        gap(4)
        text(`/ ≈${money(s.cap5h)}`, 'm')
      }
    }
  })

  if (s.last) {
    if (s.limits.length) sep()
    const pair = (lab: string, val: string, hue: Hue, i: number) => {
      if (i > 0) gap(14)
      text(lab, 'l')
      gap(4)
      text(val, `v t-${hue}`, true)
    }
    pair('in', k(s.last.input), 'rose', 0)
    pair('out', k(s.last.output), 'emerald', 1)
    gap(14)
    text(`${s.last.tps}`, 'v t-blue', true)
    gap(3)
    text('t/s', 'l')
    pair('cache', k(s.last.cacheRead), 'indigo', 1)
  }

  if (s.costUsd !== undefined || s.ctxPercent !== undefined) {
    if (s.limits.length || s.last) sep()
    if (s.costUsd !== undefined) {
      text('session', 'l')
      gap(4)
      text(money(s.costUsd), 'v t-amber', true)
    }
    if (s.ctxPercent !== undefined) {
      const hue = hueAt(s.ctxPercent, 'sky')
      if (s.costUsd !== undefined) gap(16)
      text('ctx', 'l')
      gap(6)
      ring(s.ctxPercent, hue)
      gap(5)
      text(`${s.ctxPercent}%`, `v t-${hue}`, true)
    }
  }

  const width = Math.ceil(x + 4)
  const style = `
text{font:12px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.1px}
.l{fill:#8b8b86}.m{fill:#a9a9a4}.v{fill:#2b2b29;font-weight:600}
.track{fill:#0000000f}.track-s{stroke:#00000014}
${paletteCss(0)}
@media (prefers-color-scheme:dark){
.l{fill:#9b9b96}.m{fill:#76766f}.v{fill:#ededea}
.track{fill:#ffffff1c}.track-s{stroke:#ffffff24}
${paletteCss(1)}}`
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">` +
    `<style>${style}</style>${out.join('')}</svg>`
  return { source, width }
}

const label: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

const money = (v: number) => `$${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}`

const altText = (s: Stats, now: number) =>
  [
    ...s.limits.map(l => `${label[l.kind] ?? l.kind} ${l.percentUsed}% (resets in ${left(l.resetsAt, now)})`),
    s.spent5h !== undefined &&
      `5h window spend ${money(s.spent5h)}${s.cap5h !== undefined ? ` of about ${money(s.cap5h)}` : ''} at API prices`,
    s.last && `in ${k(s.last.input)}, out ${k(s.last.output)}, ${s.last.tps} t/s, cache ${k(s.last.cacheRead)}`,
    s.costUsd !== undefined && `this session ${money(s.costUsd)}`,
    s.ctxPercent !== undefined && `context ${s.ctxPercent}%`,
  ]
    .filter(Boolean)
    .join(' · ')

// Spend is kept in files every session on this machine can read, under
// <claude config dir>/usage-band/:
//   ledger/<session id>.json  one per session, written by that session alone:
//                             its last cost reading and its spend per 5h window;
//                             `pre` is what it spent in the window before it began
//                             tracking, counted in the spend but not in the cap
//   windows.json              per window, all sessions' spend and how far the
//                             percentage moved while they spent; feeds cap5h
type WindowSpend = { usd: number; pre?: number; pct0: number; pct: number }
type SessionLedger = { lastCost: number; windows: Record<string, WindowSpend> }
type WindowTotal = { usd: number; dpct: number; at: number }

const KEEP_MS = 7 * 24 * 3600_000
const FIVE_HOURS_MS = 5 * 3600_000
// A session file untouched for this long holds nothing of the current window.
const LIVE_MS = 6 * 3600_000
// Below this many points of movement the 0.1-point rounding swamps the ratio.
const MIN_PCT = 2

const capFrom = (windows: WindowTotal[]) => {
  const pct = windows.reduce((n, x) => n + x.dpct, 0)
  const usd = windows.reduce((n, x) => n + x.usd, 0)
  return pct >= MIN_PCT ? (usd / pct) * 100 : undefined
}

// The window a reading belongs to, by its reset time rounded to the minute.
const windowKey = (resetsAt: string) => new Date(Math.round(Date.parse(resetsAt) / 60_000) * 60_000).toISOString()

async function dataDir($: EngineInterface) {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const base = config ?? (home ? `${home}/.claude` : undefined)
  return base && `${base}/usage-band`
}

async function readJson<T>($: EngineInterface, path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return undefined
  }
}

// Adds this session's spend since its last reading to the current window, then totals
// the window over every session's ledger and refreshes the cap estimate.
async function measureSpend($: EngineInterface, resetsAt: string, pct: number, cost: number) {
  const dir = await dataDir($)
  if (!dir) return undefined
  const now = await $.clock.now()
  const w = windowKey(resetsAt)

  const minePath = `${dir}/ledger/${await $.session.id()}.json`
  const mine = (await readJson<SessionLedger>($, minePath)) ?? { lastCost: cost, windows: {} }
  // A cost below the last reading means the ledger restarted (a resumed process): all of it is new.
  const delta = cost >= mine.lastCost ? cost - mine.lastCost : cost
  // A session whose last reading was in an earlier window crossed a reset: the new
  // window started at 0%, not at this reading's percentage.
  const isCrossed = !mine.windows[w] && Object.keys(mine.windows).some(k => k < w)
  const cur = mine.windows[w] ?? { usd: 0, pct0: isCrossed ? 0 : pct, pct }
  // A session that began inside this window spent all of its cost in it, the part
  // before tracking began too. Settled once per window; 0 for one begun earlier.
  let ownPre = cur.pre
  if (ownPre === undefined) {
    const hasEarlierWindow = Object.keys(mine.windows).some(k => k < w)
    const startedAt = (await $.session.usage()).startedAt
    const isInside = !hasEarlierWindow && startedAt >= Date.parse(resetsAt) - FIVE_HOURS_MS
    ownPre = isInside ? Math.max(0, mine.lastCost - cur.usd) : 0
  }
  const windows: Record<string, WindowSpend> = {
    [w]: { usd: cur.usd + delta, pre: ownPre, pct0: Math.min(cur.pct0, pct), pct },
  }
  for (const [k, v] of Object.entries(mine.windows)) {
    if (k !== w && now - Date.parse(k) < KEEP_MS) windows[k] = v
  }
  const next: SessionLedger = { lastCost: cost, windows }
  await $.fs.write(minePath, JSON.stringify(next))

  // usd: spend tracked against the percentage's movement; pre: spend from before tracking
  let usd = 0
  let pre = 0
  let pct0 = pct
  const files = await $.fs.list(`${dir}/ledger`).catch(() => [])
  for (const f of files) {
    if (f.kind !== 'file' || !f.name.endsWith('.json') || now - f.mtimeMs > LIVE_MS) continue
    const x = (await readJson<SessionLedger>($, `${dir}/ledger/${f.name}`))?.windows?.[w]
    if (x) {
      usd += x.usd
      pre += x.pre ?? 0
      pct0 = Math.min(pct0, x.pct0)
    }
  }

  const totals = (await readJson<Record<string, WindowTotal>>($, `${dir}/windows.json`)) ?? {}
  const kept: Record<string, WindowTotal> = { [w]: { usd, dpct: pct - pct0, at: now } }
  for (const [k, v] of Object.entries(totals)) {
    if (k !== w && now - v.at < KEEP_MS) kept[k] = v
  }
  await $.fs.write(`${dir}/windows.json`, JSON.stringify(kept))

  return { spent5h: usd + pre, cap5h: capFrom(Object.values(kept)) }
}

async function apply($: EngineInterface, r: SessionMeasureInput) {
  const { value: s = empty } = await $.state.get(stats)
  let { spent5h, cap5h } = s
  const fh = r.rateLimits.find(l => l.kind === 'five_hour')
  const cost = r.cost?.usd
  if (fh?.resetsAt && cost !== undefined) {
    const m = await measureSpend($, fh.resetsAt, fh.percentUsed, cost)
    if (m) ({ spent5h, cap5h } = m)
  }
  await $.state.set(stats, {
    ...s,
    limits: r.rateLimits.map(({ kind, percentUsed, resetsAt }): Limit => ({ kind, percentUsed, resetsAt })),
    ctxPercent: r.context.percent,
    costUsd: cost,
    spent5h,
    cap5h,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const u = await $.session.usage()
    await apply($, { context: u.context, rateLimits: u.rateLimits, cost: u.cost, changed: [] })
    return r
  })

  on('session.measure', async ($, e, next) => {
    await apply($, e)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u && !e.agentId) {
      const secs = Math.max(e.durationMs / 1000, 0.001)
      const { value: s = empty } = await $.state.get(stats)
      await $.state.set(stats, {
        ...s,
        last: {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens,
          cacheWrite: u.cache_creation_input_tokens,
          tps: Math.round(u.output_tokens / secs),
        },
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: s = empty } = await $.state.get(stats)
    if (!s.limits.length && !s.last && s.ctxPercent === undefined) return next(e)

    const now = await $.clock.now()

    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const { Box, Svg } = $.ui.resolve(e)
      const { source, width } = bandSvg(s, now)
      return (
        <Box paddingX="xs">
          <Svg source={source} width={width} height={26} alt={altText(s, now)} />
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const tone = (p: number) => ({ ok: undefined, warn: 'warning', bad: 'error' } as const)[level(p)]
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {s.limits.map(l => (
          <Text key={l.kind}>
            <Text dimColor>{label[l.kind] ?? l.kind} </Text>
            <Text bold color={tone(l.percentUsed)}>{l.percentUsed}%</Text>
            <Text dimColor> {left(l.resetsAt, now)}</Text>
            {l.kind === 'five_hour' && s.spent5h !== undefined && (
              <Text>
                {'  '}
                <Text bold>{money(s.spent5h)}</Text>
                {s.cap5h !== undefined && <Text dimColor> / ≈{money(s.cap5h)}</Text>}
              </Text>
            )}
          </Text>
        ))}
        {s.last && (
          <Text key="turn">
            <Text dimColor>in </Text><Text bold>{k(s.last.input)}</Text>
            <Text dimColor>  out </Text><Text bold>{k(s.last.output)}</Text>
            <Text dimColor>  </Text><Text bold>{s.last.tps}</Text><Text dimColor> t/s  cache </Text>
            <Text bold>{k(s.last.cacheRead)}</Text>
          </Text>
        )}
        {s.costUsd !== undefined && (
          <Text key="cost">
            <Text dimColor>session </Text>
            <Text bold>{money(s.costUsd)}</Text>
          </Text>
        )}
        {s.ctxPercent !== undefined && (
          <Text key="ctx">
            <Text dimColor>ctx </Text><Text bold color={tone(s.ctxPercent)}>{s.ctxPercent}%</Text>
          </Text>
        )}
      </Box>
    )
  })
}
