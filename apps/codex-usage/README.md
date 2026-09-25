# Codex Usage

Codex Usage is a local-first macOS dashboard for activity recorded by Codex and Claude Code.
It scans `~/.codex/sessions` and `~/.claude/projects`, estimates API-equivalent token cost, and shows rolling 24-hour,
7-day, 30-day, and 90-day views.

The app includes:

- hourly and daily cost/token graphs;
- a persisted Codex / Claude Code / All providers selector for dashboard and menu-bar activity;
- processed, cached, uncached, output, and reasoning token totals;
- model breakdowns and model-by-reasoning-mode breakdowns;
- live Codex and Claude weekly usage, plus conditional 5-hour windows when reported by each account;
- percentage remaining, reset countdowns, and reset dates for every reported usage window;
- de-duplication for repeated token events and copied fork/subagent history;
- LiteLLM pricing with a 24-hour offline cache;
- USD, AED, SAR, BHD, QAR, OMR, JOD, and HKD display currencies using configured peg rates
  (HKD uses the `7.80` midpoint of its supplied band);
- 44 live currencies covering the Americas, Europe, Asia-Pacific, South Asia, the Middle East,
  and Africa using daily Frankfurter reference rates with a 24-hour local cache and
  last-known-rate fallback;
- a macOS menu-bar item with a modern true-black usage popover, a visible
  Both / Codex / Claude activity and limits switcher, and an independently hideable icon;
- an independently configurable dropdown activity range that defaults to 24 hours, with 7-day,
  30-day, and 90-day options;
- custom start/end dates and times in the dashboard, covering the last two
  years of available local sessions; ranges up to two days use hourly graphs, longer ranges use
  daily graphs. Times are local, the end is exclusive, and choosing a preset exits custom mode;
- a configurable menu-bar value: cost, tokens, sessions, Codex/Claude/Both usage percentage only, percentage
  plus time left, percentage plus time left and 7/30/90-day cost, percentage plus reset date, time
  left plus reset date, or icon only;
- a native About window with author/version details, an on-demand GitHub release check, and direct
  DMG downloads when an update is available;
- optional launch at login.

Subscription billing is separate from the API-equivalent estimate shown by the app.
Claude subscription quotas are read separately from Anthropic using your Claude Code sign-in.
Run `claude auth login` if needed, then refresh. macOS may ask to allow access to
`Claude Code-credentials`. An inference-only setup-token or API key cannot read plan limits.
The app only reads existing credentials; it does not rotate tokens, modify your login, or send
inference requests. Claude limits refresh every five minutes, with a manual Refresh option.
Missing windows are hidden; temporary failures show timestamped last-known values (an asterisk
in the status item), while expired/rejected credentials show sign-in guidance. The usage endpoint
is not a public API contract and can change. Claude desktop chat history is not scanned.
Costs use current standard model rates, with unknown/ambiguous prices explicitly marked as
unavailable or partial. Provider-specific rates cannot overwrite canonical model rates.
Claude cache-read/write tokens, one-hour cache writes, fast-mode multipliers, recorded costs,
and repeated message/request IDs are handled separately. Long-context and service tiers can
differ from the standard-rate estimate.
Currency refreshes request only the fixed supported-currency list from Frankfurter; session,
token, and cost data never leave the Mac.

## Run locally

From the repository root:

```sh
pnpm install
pnpm dev:codex-usage
```

Build the renderer and Electron processes with `pnpm build:codex-usage`. Create a macOS DMG with
`pnpm dist:codex-usage:mac`.

If Codex data lives outside `~/.codex`, launch with `CODEX_HOME` set to the alternate Codex home.
If Claude Code data lives outside `~/.claude`, set `CLAUDE_CONFIG_DIR` to the directory containing
its `projects` folder. No Claude API key is needed for local activity tracking.
The account-limit reader automatically finds the installed Codex executable in common macOS locations;
set `CODEX_BINARY` to its absolute path when using a custom installation.
