# Coordination patterns

How to structure claims, hooks, and human overrides when several AI agents share one codebase.
These patterns come from running a claim board in production with three agents (Claude Code,
Codex CLI, Gemini CLI) editing the same projects daily.

## 1. Claim granularity — default to the project, opt into globs

| Granularity | Resource example | When |
|---|---|---|
| **Project (default)** | `my-app` | One agent works one repo at a time. Lowest noise, easiest to reason about. |
| **Path glob (opt-in)** | `src/api/**` (`--kind path`) | Two agents intentionally split one repo (e.g. one owns the API, one owns the UI). |

Start with project-level claims. File-level claims look attractive but flood the board and
turn every commit into claim churn. Only reach for globs when you deliberately partition a
repo between agents — and keep the partitions coarse (a directory, not a file).

## 2. Claim is check-in, release is check-out — both are mandatory

The failure mode that actually happens is not "two agents edit one file"; it is **an agent
that releases but never claimed**, or claims and never releases. The board only works when
claim/release wrap the session like check-in/check-out:

- **Claim before the first edit** — not after. The `SessionStart` hook automates this.
- **Release when done** — the `SessionEnd` hook automates this; the TTL reaper (next section)
  is the backstop, not the mechanism.
- Quick "one-line fix" sessions are not exempt. They are exactly the sessions that collide.

## 3. Convention vs enforcement

A protocol written in AGENTS.md is a convention — agents usually follow it. The
`PreToolUse` hook is enforcement — the edit physically fails with the holder's name in the
error. Use both:

- **Enforcement (hooks)** where supported: Claude Code's `PreToolUse` returns exit 2 and the
  agent sees *why* it was blocked, so it coordinates instead of retrying.
- **Convention (snippets)** everywhere else: Codex/Gemini follow the claim-check-release
  protocol from their context files, and their edits are still visible on the board.

Fail-open is deliberate: if the board server is down, hooks allow everything rather than
bricking the agent session. The board is a coordination layer, not a security boundary.

## 4. TTL and heartbeat — claims must die

Agents crash, sessions get killed, laptops sleep. Any claim without a fresh heartbeat:

- after **TTL** (default 30 min): flagged `stale` (⚠ on the dashboard) — treat as "probably dead",
- after **2× TTL**: auto-released by the reaper with `released_by: ttl-reaper` (status `expired`).

Long-running sessions stay alive by re-claiming (idempotent — it refreshes the heartbeat) or
calling `POST /api/claims/:id/heartbeat`. Tune with `WORKBOARD_TTL_MIN`.

## 5. Human override

Humans outrank agents. The dashboard's **Force release** exists for the judgment call —
"that agent is gone, I need this now". The release is recorded in history with
`released_by: dashboard`, so an agent returning to a vanished claim can see what happened
instead of assuming corruption.

## 6. Scope honestly: one machine, trusted agents

The default setup is loopback-only coordination between agents on one machine. There is no
authentication — anyone who can reach the port can claim and release. If you bind beyond
loopback (LAN, containers), put it behind a reverse proxy with auth, and remember: agents can
still bypass the board by simply not calling it. It prevents accidents, not malice.
