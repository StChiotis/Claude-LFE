# Contributing

This repo follows the **Library-First Engineering (LFE)** workflow. Two paths below: adopters operating in an LFE-adopting project, and contributors improving the LFE framework upstream. Both paths follow the same persona-based protocol.

## For adopters

1. **Read [`LLM_AGENT_GUIDE.md`](LLM_AGENT_GUIDE.md) and [`USER_MANUAL.md`](USER_MANUAL.md) first.** They are the canonical operating instructions.
2. **Every session starts with `/lfe-boot`.** Do not skip the orientation step.
3. **One change per session, one pipeline at a time.** Parallel pipelines defeat the file-based coordination model.
4. **Respect the persona contracts in [`.docs/protocol/PERSONAS.md`](.docs/protocol/PERSONAS.md).** The Architect cannot edit `src/`; the Builder cannot rewrite plans; the Inspector cannot edit production code; the Archivist cannot change behavior.
5. **PRs must use the LFE compliance template** in [`.github/pull_request_template.md`](.github/pull_request_template.md).

## Contributing upstream

Framework improvements — to LFE itself (protocol files in `.docs/protocol/`, skill definitions in `.agents/skills/`, hook code in `.claude/hooks/`) — belong in the LFE upstream repository at <https://github.com/StChiotis/Library-First-Engineering>, not in your adopter fork.

1. **Distinguish framework vs domain.** If your change improves how LFE itself works (a new skill, a hook bugfix, a protocol clarification), it's an upstream contribution. If it implements your product's business logic or domain-specific patterns, it stays in your fork.
2. **Use the standard pipeline.** Upstream contributions still flow through the Architect → Builder → Inspector → Archivist cycle, with `/lfe-boot` at session start and human approval at the slice + plan gates.
3. **Fork and PR.** Standard GitHub workflow: fork the upstream LFE repo, branch, open a PR. The upstream repo uses the same `.github/pull_request_template.md` compliance template as adopter forks.
4. **LFE-SOURCE protection.** `.agents/skills/**` are LFE-SOURCE-locked — they should not be modified in adopter forks. If you find a bug or want an enhancement in a skill, propose it upstream rather than patching your local copy.

## License

See [`LICENSE`](LICENSE).