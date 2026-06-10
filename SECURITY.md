# Security Policy

## Threat model — read this first

agent-workboard is a **local coordination tool, not a security boundary**:

- The server binds to `127.0.0.1` by default and has **no authentication**. Anyone who can
  reach the port can create, release, or force-release any claim.
- Hooks **fail open**: if the board is unreachable, agents are allowed to edit. This is by
  design — the board prevents accidents between cooperating agents, not malicious actors.
- An agent can always bypass the board by simply not calling it.

If you bind beyond loopback (`WORKBOARD_HOST=0.0.0.0`, Docker, LAN), put the server behind a
reverse proxy that adds authentication, and treat the network it is exposed to as trusted.

## Data

The SQLite database (default `~/.agent-workboard/workboard.db`) stores agent names, resource
names/globs, and free-text notes. Do not put secrets in claim notes.

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub Security Advisories on this repository
("Report a vulnerability"). You should receive a response within a week. Please do not open
public issues for security reports.
