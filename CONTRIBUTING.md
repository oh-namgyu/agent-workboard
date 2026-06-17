# Contributing to agent-workboard

Thanks for your interest!

## Development setup

```bash
npm install
npm test            # node --test (server + CLI + hook integration)
npm start           # serve on http://127.0.0.1:5054
```

## Guidelines

- This is a **coordination tool, not a security boundary** — it's intentionally
  unauthenticated and fail-open (see SECURITY.md). Keep it that way.
- The PreToolUse hook (`src/hooks.js`) is the core enforcement path; cover any
  change to it with a test (`test/hook.test.js`).
- Run `npm test` before opening a PR; describe what changed and how you verified it.
