# Security Policy

## Supported versions

The latest release on `main` (currently **v1.0.0**) is the supported version.

## Reporting a vulnerability

Please report security issues **privately** via GitHub's **[Report a vulnerability](https://github.com/StChiotis/Claude-LFE/security/advisories/new)** (the *Security* tab → *Advisories*) rather than opening a public issue. You can expect an acknowledgement within a few days.

Because Claude-LFE ships Node integration hooks, git hooks, and setup scripts that run on a contributor's machine, reports about those execution surfaces are especially welcome.

## Scope

In scope: the enforcement hooks (`.claude/hooks/`), their libraries (`.claude/lib/`), the git hooks (`.githooks/`), and the sync/setup scripts (`scripts/`). Protocol documents and skill prompts are prose and are handled as ordinary issues.
