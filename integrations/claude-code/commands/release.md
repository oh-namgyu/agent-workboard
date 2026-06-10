---
description: Release your agent-workboard claim when you finish working
allowed-tools: Bash
---

Release the claim held by this agent on the agent-workboard.

Run: `{{WORKBOARD}} release $ARGUMENTS`

- With no argument, this releases the claim on the current project (directory name).
- Confirm the release to the user. If there was no matching active claim, say so — it may have expired via TTL.
