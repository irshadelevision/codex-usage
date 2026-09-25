# Codex Usage

Codex Usage is a local-first macOS menu-bar app and dashboard for understanding activity recorded
by Codex and Claude Code. It reads local session files, estimates API-equivalent
token cost, and displays the account limits reported by the signed-in Codex CLI session.

## Features

- Rolling 24-hour, 7-day, 30-day, and 90-day activity views.
- Codex, Claude Code, or combined activity in the dashboard and menu bar; custom dashboard
  ranges cover up to two years of available local history.
- Hourly and daily cost/token graphs.
- Processed, cached, uncached, output, and reasoning token totals.
- Model, mode, and model-by-reasoning-mode breakdowns.
- Codex weekly usage with percentage remaining, reset countdowns, and reset dates.
- Conditional Codex 5-hour usage limits; a 5-hour row is hidden when the CLI does not
  report that bucket for the account.
- A display-only banked-reset indicator with its expiry when reset credits are reported. The app
  never consumes a reset.
- A true-black macOS dashboard and modern menu-bar popover with a prominent
  Both / Codex / Claude activity switcher. Both shows separate provider totals.
- Configurable menu-bar text for usage, remaining time, reset date, fixed-range cost combinations,
  cost, tokens, or sessions, plus an option to hide the icon when text is shown.
- USD and common international currencies, using fixed peg rates where appropriate and daily
  Frankfurter reference rates for supported floating currencies.
- A native About window with the author, app version, GitHub update check, and latest-DMG download.
- Optional launch at login and close/minimize-to-menu-bar behavior.

Session, token, and cost data stay on the Mac. Subscription billing is separate from the
API-equivalent estimate displayed by the app.
The provider selector applies to activity, graphs, breakdowns, and menu-bar costs/tokens/sessions.
Subscription-limit percentages and reset information remain Codex-only: Claude's local transcripts
do not report subscription quotas. Claude desktop chat history is not scanned.

## Requirements

- macOS.
- Existing Codex activity in `~/.codex/sessions` and/or Claude Code activity in
  `~/.claude/projects` for local activity charts.
- For live Codex account limits, [Codex CLI](https://developers.openai.com/codex/cli)
  installed and authenticated with `codex login`.

If Codex uses a different data directory, launch with `CODEX_HOME` set to that directory. If the
CLI is installed in a custom location, set `CODEX_BINARY` to the executable's absolute path.
For an alternate Claude Code configuration directory, set `CLAUDE_CONFIG_DIR`; the scanner reads
its `projects` folder, including subagent transcripts. No Claude API key is required.

## Install

Download the latest Apple-silicon DMG from
[GitHub Releases](https://github.com/irshadelevision/codex-usage/releases/latest), open it, and drag
Codex Usage into Applications.

Current release builds are ad-hoc signed rather than Developer ID notarized. If macOS quarantines a
downloaded build, remove the quarantine attribute after confirming that the DMG came from this
repository:

```sh
xattr -dr com.apple.quarantine "/Applications/Codex Usage.app"
```

## Develop

From the repository root:

```sh
pnpm install
pnpm dev:codex-usage
```

Useful commands:

```sh
pnpm --filter @codex-usage/app test
pnpm --filter @codex-usage/app typecheck
pnpm build:codex-usage
pnpm dist:codex-usage:mac
```

Release artifacts are written to `apps/codex-usage/release`.

## Data sources

- Local activity: Codex session JSONL files and Claude Code project JSONL files.
- Account limits: the local Codex CLI app-server session.
- Token pricing: LiteLLM pricing data with a local cache.
- Floating exchange rates: Frankfurter reference rates with a local cache and last-known fallback.

The app does not require an exchange-rate API key.

### Understanding cost estimates

Prices use the current published standard token rates, not historical subscription billing.
Provider-qualified rates cannot overwrite direct model prices. Unknown or ambiguous models keep
their token counts, but their costs are excluded and clearly marked unavailable/partial.
Long-context tiers, negotiated discounts, and service tiers may differ from these estimates.

Claude input, cache reads, and cache writes are counted separately. One-hour cache writes and
fast-mode multipliers are applied when reported and published. A recorded `costUSD` takes
precedence when available. Repeated Claude message/request pairs are counted once across files;
synthetic error responses are ignored. Missing Claude reasoning metadata is shown as unknown.
