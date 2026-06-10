# agent-workboard — snippet for AGENTS.md (Codex CLI and compatible agents)

Copy the block below into your repository's `AGENTS.md` (or your global agent rules).
It teaches the agent the claim-before-edit protocol. Set `WORKBOARD_AGENT=codex` in the
environment so claims are attributed correctly.

```markdown
## Shared-codebase coordination (agent-workboard)

Other AI agents may be working in this codebase at the same time. A claim board runs at
http://127.0.0.1:5054 (the `workboard` CLI talks to it; override with WORKBOARD_URL).

Rules — follow them in this order, every session:

1. BEFORE editing any file, check the board and claim the project:
   `workboard claim --agent codex --note "<one line: what you are doing>"`
   (run from the project root — with no resource argument it claims the directory name).
2. If the claim is rejected with a conflict, DO NOT edit. Report who holds the claim
   and either wait, pick a different task, or ask the user to arbitrate.
3. To verify a specific file before touching it: `workboard check --agent codex --path <file>`
   — exit code 2 means blocked.
4. WHEN you finish (or abandon) the work, release: `workboard release --agent codex`
   Skipping release leaves a stale claim that blocks other agents until the TTL reaper
   expires it.
5. For long sessions, the claim goes stale after the TTL (default 30 min without a
   heartbeat). Re-run `workboard claim --agent codex` to refresh it.
```
