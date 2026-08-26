# Codex Usage

Codex Usage is a local-only macOS dashboard for activity recorded by the Codex CLI and Codex app.
It scans `~/.codex/sessions`, estimates API-equivalent token cost, and shows rolling 24-hour,
7-day, 30-day, and 90-day views.

The app includes:

- hourly and daily cost/token graphs;
- processed, cached, uncached, output, and reasoning token totals;
- model and reasoning-mode breakdowns;
- live Codex and Spark weekly usage, reset countdowns, and reset dates from the signed-in Codex CLI session;
- de-duplication for repeated token events and copied fork/subagent history;
- LiteLLM pricing with a 24-hour offline cache;
- a native macOS menu-bar item and pull-down menu, with an independently hideable icon;
- a configurable menu-bar value: cost, tokens, sessions, Codex/Spark usage percentage only,
  percentage plus time left, percentage plus reset date, time left plus reset date, or icon only;
- a native About window with author/version details and an on-demand GitHub release check;
- optional launch at login.

Subscription billing is separate from the API-equivalent estimate shown by the app.

## Run locally

From the repository root:

```sh
pnpm install
pnpm dev:codex-usage
```

Build the renderer and Electron processes with `pnpm build:codex-usage`. Create a macOS DMG with
`pnpm dist:codex-usage:mac`.

If Codex data lives outside `~/.codex`, launch with `CODEX_HOME` set to the alternate Codex home.
The weekly limit reader automatically finds the installed Codex executable in common macOS locations;
set `CODEX_BINARY` to its absolute path when using a custom installation.
