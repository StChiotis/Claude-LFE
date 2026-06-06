# Claude-LFE

**Claude-native Library-First Engineering template.**

A ready-to-clone project scaffold for any new project adopting the [Library-First Engineering (LFE)](https://github.com/StChiotis/Library-First-Engineering) framework with full Claude Code integration wired and ready.

---

## What's included

| Component | Location | Purpose |
|:---|:---|:---|
| **LFE skills** | `.agents/skills/` + `.claude/skills/` mirror | Full LFE skill set covering bootstrap, planning, building, inspection, archival, hygiene, recovery, and navigation |
| **Claude Code hooks** | `.claude/hooks/` | Persona-discipline + plan-critique write gates, coordination-file frontmatter validators (with sub-validators per file type), state-aware SessionStart reminder, checkpoint-flip state mutator |
| **Inspector specialist skills** | `.agents/skills/lfe-*-check/` | Security (OWASP Top-10), performance, complexity, dependency-audit, and mutation-reasoning passes the Inspector runs as in-chat skills |
| **statusLine** | `.claude/statusline.mjs` | Live pipeline state rendered below the Claude Code prompt |
| **LFE protocol docs** | `.docs/protocol/` | PERSONAS, ASSEMBLY_LINE, GOVERNANCE, COORDINATION_FILES, LOOP_ARCHITECTURE |
| **Sync tooling** | `scripts/` + `.githooks/` | `sync-claude-skills.mjs` + pre-commit drift guard |
| **Quality layer** | `.docs/quality/` | PROTOCOL_DEBT, RETENTION_RUNBOOK, inspector-config |
| **Skill-accuracy harness** | `.agents/skills/_evals/` + `.claude/lib/skill-eval*.mjs` + `/lfe-skill-eval` | Measures whether the five **defect-catching** reasoning skills — security, performance, complexity, mutation-reasoning, and plan-critique (the checks whose job is to *find* a problem, not the ~18 workflow skills) — actually catch planted defects; renders `.docs/quality/skill-eval-scorecard.md` |

---

## Getting started

```bash
# 1. Clone into your new project folder
git clone <this-repo> my-new-project
cd my-new-project

# 2. Activate the pre-commit drift guard
npm install

# 3. Open in Claude Code and bootstrap
/lfe-boot

# 4. Run the Day 0 domain extraction interview
/lfe-extract-domain
```

After `/lfe-extract-domain` completes, `CONTEXT.md` and `.docs/domain/domain-knowledge.md` will be populated with your project's domain language and then you're ready for your first mission.

> **Fresh-clone note:** `CONTEXT.md` is **intentionally absent** in a fresh clone — it is not missing or broken. `/lfe-extract-domain` creates it from your Day-0 domain interview. Likewise, `.docs/domain/` ships with only a Shelf Index ([`.docs/domain/README.md`](.docs/domain/README.md)) explaining what belongs there; the domain files are created on Day 0.

---

## Key docs

| Document | Purpose |
|:---|:---|
| [`LLM_AGENT_GUIDE.md`](LLM_AGENT_GUIDE.md) | Canonical agent rules: workflow, skills, coordination layer, project bindings |
| [`pipeline_status.md`](pipeline_status.md) | Live session cursor — active persona, mission state, coordination file tracker |
| [`.docs/protocol/`](.docs/protocol/) | LFE protocol: personas, assembly line, governance, coordination file schema |
| [`CONTEXT.md`](CONTEXT.md) | Domain vocabulary *(populated by `/lfe-extract-domain`)* |
| [`.docs/README.md`](.docs/README.md) | Documentation floor map |

---

## Framework philosophy

> *"Thinking in the Human · Processing in the AI · Truth in the Documentation"*

See [`README.md`](https://github.com/StChiotis/Library-First-Engineering) on the public LFE repo for the full philosophy.

---

## License

MIT