# usage-band

A Claude Code plugin that adds a slim usage band above the prompt, in the Claude desktop app (Code tab) and in the terminal:

```
5h ━━──── 5%  4h25m    7d ━━━━── 41%  20h45m  │  in 10  out 2.24k  62 t/s  cache 581k  │  $1.56  ctx ◔ 12%
```

一个 Claude Code 插件：在输入框上方显示一条用量统计栏。

| Item | Meaning |
| --- | --- |
| `5h` / `7d` | Rate-limit windows: percent used and time until reset (subscription accounts only) |
| `in` / `out` / `cache` | Last turn's uncached input, output and cache-read tokens |
| `t/s` | Last turn's output tokens ÷ turn wall time (approximate; includes tool time) |
| `$` | Session cost at API list prices (not what a subscription is billed) |
| `ctx` | How full the context window is |

Limits and context turn orange at 70% and red at 90%.

## Install

At the prompt of a Claude Code session:

```
/plugin install usage-band --marketplace bajiyikouchengzi/claude-usage-band
```

Answer `y` to add the marketplace, then pick a scope. Or from a shell:

```bash
claude plugin install usage-band --marketplace bajiyikouchengzi/claude-usage-band
```

Then run `/reload-plugins` (or start a new session). The band appears once the session has figures, after the first reply.

## How it works / 安全性

It uses Claude Code's plugin hooks API only (`session.measure`, `turn.complete`, `ui.render` on `AbovePrompt`). Every figure is one Claude Code already keeps locally, the same as `/cost` and the status line. The plugin makes no network requests, reads no credentials and does not modify the app.

插件只使用 Claude Code 官方插件接口，数据来自 Claude Code 本地已有的统计，不发网络请求、不读取凭证、不修改客户端。

## Requirements

- A recent Claude Code / Claude desktop app with plugin hooks support. The hooks API is early access and may change between releases.
- `5h` / `7d` appear on Pro / Max subscriptions only.

## Develop

```bash
claude --plugin-dir ./
```

Loading it once this way lays the API types in `.claude-plugin/types/`, which `tsconfig.json` extends, so `tsc -p .` type-checks it. `claude plugin validate .` checks the manifest and hooks module.

## License

MIT
