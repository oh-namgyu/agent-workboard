---
description: Claim a resource on the agent-workboard before editing shared code
allowed-tools: Bash
---

Claim a resource on the agent-workboard so other agents won't edit it concurrently.

Run: `{{WORKBOARD}} claim $ARGUMENTS`

- With no argument, this claims the current project (directory name).
- To claim a path pattern instead, pass it with `--kind path`, e.g. `src/api/** --kind path`.
- If the command reports a conflict (exit 2), do NOT edit the resource. Report who holds the claim and suggest waiting or coordinating.
