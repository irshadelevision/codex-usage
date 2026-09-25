# Codex Usage

Codex Usage is a local-first macOS menu-bar app and dashboard for understanding activity recorded
by Codex and Claude Code. It reads local session files, estimates API-equivalent
token cost, and displays account limits from your signed-in Codex CLI and Claude Code accounts.

## Features

- Rolling 24-hour, 7-day, 30-day, and 90-day activity views.
- Codex, Claude Code, or combined activity in the dashboard and menu bar; custom dashboard
  ranges cover up to two years of available local history.
- Hourly and daily cost/token graphs.
- Processed, cached, uncached, output, and reasoning token totals.
- Model, mode, and model-by-reasoning-mode breakdowns.
- Codex and Claude weekly usage with percentage remaining, reset countdowns, and reset dates.
- Conditional Codex and Claude 5-hour usage limits; a 5-hour row is hidden when the provider does not
  report that bucket for the account.
- A display-only banked-reset indicator with its expiry when reset credits are reported. The app
  never consumes a reset.
- A true-black macOS dashboard and modern menu-bar popover with a prominent
  Both / Codex / Claude switcher for activity and limits. Both shows separate provider totals.
- Configurable menu-bar text for usage, remaining time, reset date, fixed-range cost combinations,
  cost, tokens, or sessions, plus an option to hide the icon when text is shown.
- Show Claude's 5-hour and weekly limits together in the status item. Choose a
  **Claude 5-hour + weekly** option under **Menu bar → Displayed value** for percentages,
  separate reset countdowns/dates, or a 7-, 30-, or 90-day Claude cost alongside both limits.
- USD and common international currencies, using fixed peg rates where appropriate and daily
  Frankfurter reference rates for supported floating currencies.
- A native About window with the author, app version, GitHub update check, and latest-DMG download.
- Optional launch at login and close/minimize-to-menu-bar behavior.

Session, token, and cost data stay on the Mac. Subscription billing is separate from the
API-equivalent estimate displayed by the app.
The provider selector applies to activity, graphs, breakdowns, limits, and menu-bar costs/tokens/sessions.
Explicit Codex/Claude/Both status-item options independently select that provider's quotas and costs.
Claude desktop chat history is not scanned.

## Requirements

- macOS.
- Existing Codex activity in `~/.codex/sessions` and/or Claude Code activity in
  `~/.claude/projects` for local activity charts.
- For live Codex account limits, [Codex CLI](https://developers.openai.com/codex/cli)
  installed and authenticated with `codex login`.
- For live Claude limits, Claude Code signed in with `claude auth login`. No API key is needed.
  An inference-only `claude setup-token` cannot read plan limits.

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
- Codex limits: the local Codex CLI app-server session.
- Claude limits: Anthropic's OAuth usage endpoint, using the selected Claude Code profile's native
  Keychain credential or `.credentials.json`. macOS may ask to allow access to
  `Claude Code-credentials`. Credentials stay in the main process and are sent only to Anthropic;
  they are not copied to app settings, logs, or renderer data. The app never refreshes or modifies
  Claude Code's rotating tokens and never sends inference requests.
- Token pricing: LiteLLM pricing data with a local cache.
- Floating exchange rates: Frankfurter reference rates with a local cache and last-known fallback.

The app does not require an exchange-rate API key.

Claude limits refresh every five minutes, or when you click Refresh. Missing windows remain
unavailable instead of being inferred from local costs. If sign-in expires, open Claude Code to
renew it and refresh the app. Temporary failures preserve timestamped last-known values; an
asterisk in the status item marks stale quotas. Authentication failures clear those quotas.
The Claude usage endpoint is not a public API contract and can change; failures do not prevent
local activity or Codex usage from loading.

### Understanding cost estimates

Prices use the current published standard token rates, not historical subscription billing.
Provider-qualified rates cannot overwrite direct model prices. Unknown or ambiguous models keep
their token counts, but their costs are excluded and clearly marked unavailable/partial.
Long-context tiers, negotiated discounts, and service tiers may differ from these estimates.

Claude input, cache reads, and cache writes are counted separately. One-hour cache writes and
fast-mode multipliers are applied when reported and published. A recorded `costUSD` takes
precedence when available. Repeated Claude message/request pairs are counted once across files;
synthetic error responses are ignored. Missing Claude reasoning metadata is shown as unknown.
