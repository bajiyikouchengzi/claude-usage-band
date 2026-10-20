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
    if (l.kind === 'five_hour' && s.cap5h !== undefined) {
      gap(10)
      text('cap', 'l')
      gap(4)
      text(`≈${money(s.cap5h)}`, `v t-${hue}`, true)
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
    if (s.costUsd !== undefined) text(`$${s.costUsd.toFixed(2)}`, 'v t-amber', true)
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

// One observation: this session spent dCost while the 5h window rose dPct points.
type Sample = { t: number; dCost: number; dPct: number }
const SAMPLES = 'cap5h.samples'
const KEEP_MS = 7 * 24 * 3600_000
// Below this many points of movement the 0.1-point rounding swamps the ratio.
const MIN_PCT = 2

const capFrom = (samples: Sample[]) => {
  const pct = samples.reduce((n, x) => n + x.dPct, 0)
  const usd = samples.reduce((n, x) => n + x.dCost, 0)
  return pct >= MIN_PCT ? (usd / pct) * 100 : undefined
}

const altText = (s: Stats, now: number) =>
  [
    ...s.limits.map(l => `${label[l.kind] ?? l.kind} ${l.percentUsed}% (resets in ${left(l.resetsAt, now)})`),
    s.cap5h !== undefined && `5h cap about ${money(s.cap5h)} at API prices`,
    s.last && `in ${k(s.last.input)}, out ${k(s.last.output)}, ${s.last.tps} t/s, cache ${k(s.last.cacheRead)}`,
    s.costUsd !== undefined && `$${s.costUsd.toFixed(2)}`,
    s.ctxPercent !== undefined && `context ${s.ctxPercent}%`,
  ]
    .filter(Boolean)
    .join(' · ')

// The last reading of this session: the cost and the 5h percentage, and which window.
// A module variable on purpose: after a reload the next reading only sets a fresh baseline.
let baseline: { cost: number; pct: number; window: string } | undefined

async function apply($: EngineInterface, r: SessionMeasureInput) {
  const { value: s = empty } = await $.state.get(stats)
  let cap5h = s.cap5h
  const fh = r.rateLimits.find(l => l.kind === 'five_hour')
  const cost = r.cost?.usd
  if (fh && cost !== undefined) {
    const now = await $.clock.now()
    const window = fh.resetsAt ? new Date(Math.round(Date.parse(fh.resetsAt) / 60_000) * 60_000).toISOString() : ''
    let samples = (((await $.store.get(SAMPLES)) as Sample[] | undefined) ?? []).filter(x => now - x.t < KEEP_MS)
    if (baseline && baseline.window === window && cost > baseline.cost && fh.percentUsed >= baseline.pct) {
      samples = [...samples, { t: now, dCost: cost - baseline.cost, dPct: fh.percentUsed - baseline.pct }].slice(-2000)
      await $.store.set(SAMPLES, samples)
    }
    baseline = { cost, pct: fh.percentUsed, window }
    cap5h = capFrom(samples)
  }
  await $.state.set(stats, {
    ...s,
    limits: r.rateLimits.map(({ kind, percentUsed, resetsAt }): Limit => ({ kind, percentUsed, resetsAt })),
    ctxPercent: r.context.percent,
    costUsd: cost,
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
            {l.kind === 'five_hour' && s.cap5h !== undefined && <Text dimColor> cap ≈{money(s.cap5h)}</Text>}
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
        {s.costUsd !== undefined && <Text key="cost" bold>${s.costUsd.toFixed(2)}</Text>}
        {s.ctxPercent !== undefined && (
          <Text key="ctx">
            <Text dimColor>ctx </Text><Text bold color={tone(s.ctxPercent)}>{s.ctxPercent}%</Text>
          </Text>
        )}
      </Box>
    )
  })
}
