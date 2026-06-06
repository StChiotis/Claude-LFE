# Claude-LFE

[![CI](https://github.com/StChiotis/Claude-LFE/actions/workflows/ci.yml/badge.svg)](https://github.com/StChiotis/Claude-LFE/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-1105%20passing-2ea44f?style=flat-square)](https://github.com/StChiotis/Claude-LFE/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![release](https://img.shields.io/github/v/release/StChiotis/Claude-LFE?style=flat-square)](https://github.com/StChiotis/Claude-LFE/releases)
[![use this template](https://img.shields.io/badge/use_this-template-24292f?style=flat-square&logo=github)](https://github.com/StChiotis/Claude-LFE/generate)

[![Intro deck](docs/intro.gif)](https://stchiotis.github.io/Claude-LFE.intro/)

> **Want to see the full introduction deck?** Visit [stchiotis.github.io/Claude-LFE.intro](https://stchiotis.github.io/Claude-LFE.intro/)

---

> **Making AI reliable, session after session.**

The bottleneck in agentic software isn't capability — it's **trust**. A model that nails the prototype will, across dozens of sessions, lose intent, re-litigate settled decisions, and sprawl into spaghetti. **Claude-LFE** is a ready-to-clone [Claude Code](https://docs.anthropic.com/en/docs/claude-code) scaffold that keeps that from happening: the **human stays on the wheel**, **documentation is the source of truth**, and reliability is **mechanically enforced and measured** — not asserted.

It's deliberately slower. That's the trade: overhead you choose to pay so the work holds up in production, not just in the demo. The discipline is borrowed from reliability engineering in marine and biotech — FMEA, RCM, poka-yoke — ported onto AI.

Built on the [Library-First Engineering](https://github.com/StChiotis/Library-First-Engineering) framework.

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

## Author

Built by **Stylianos Chiotis** — reliability engineering (marine · biotech) ported onto AI.
Connect or reach out: [LinkedIn](https://www.linkedin.com/in/stylianos-chiotis/) · [intro deck](https://stchiotis.github.io/Claude-LFE.intro/) · [Library-First Engineering](https://github.com/StChiotis/Library-First-Engineering).

---

## License

MIT
