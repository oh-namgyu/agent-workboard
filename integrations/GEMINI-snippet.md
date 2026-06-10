# agent-workboard — snippet for GEMINI.md (Gemini CLI and compatible agents)

Copy the block below into your repository's `GEMINI.md` (or your global context file).
Set `WORKBOARD_AGENT=gemini` in the environment so claims are attributed correctly.

```markdown
## Shared-codebase coordination (agent-workboard)

Multiple AI agents may edit this codebase concurrently. A claim board (agent-workboard)
is the single source of truth for "who is working where". CLI: `workboard`
(server default http://127.0.0.1:5054, override with WORKBOARD_URL).

Protocol:

1. Check in before editing: `workboard claim --agent gemini --note "<task summary>"`
   from the project root. A conflict response means another agent holds this project —
   do not edit; report the holder and wait or switch tasks.
2. Claim only a subtree when appropriate: `workboard claim "src/docs/**" --kind path --agent gemini`
   — this blocks other agents only for files matching the glob.
3. Probe a single file: `workboard check --agent gemini --path <file>` (exit 2 = blocked).
4. Check out when done: `workboard release --agent gemini`. Never leave a session
   without releasing — stale claims block everyone else until the TTL reaper runs.
```
