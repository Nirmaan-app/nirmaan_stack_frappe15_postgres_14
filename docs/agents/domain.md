# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

### This repo specifically

This is a **single-context** repo: root `CONTEXT.md` + root `docs/adr/`. Two extra places carry
domain knowledge here, and both are worth reading before working in their area:

- **`.claude/context/domain/*.md`** — the per-domain reference docs (procurement, projects, expenses,
  boq-backend, invoice-qty, …), indexed by `.claude/context/_index.md`. Frontend equivalents live under
  `frontend/.claude/context/`. These are richer than `CONTEXT.md` for anything BoQ- or procurement-shaped.
- **Technical Data Sheets (TDS)** live in the same single context: the glossary is the *Technical Data
  Sheets* section of root `CONTEXT.md`, the decisions are root `docs/adr/0023`–`0026`, and the historical
  build plans are under `.claude/context/domain/tds/`. (Merged 2026-09-17 from a separate TDS folder; the
  old TDS ADR-0001…0004 are now 0023…0026.) Not to be confused with tax TDS (`domain/payment-tds.md`).

Also note there are **two** always-loaded convention files: root `CLAUDE.md` (backend + app-wide) and
`frontend/CLAUDE.md` (frontend). Per-slice changelog detail belongs in the reference docs, never in either
`CLAUDE.md` — see the DOCS-UPDATE RULE in root `CLAUDE.md`.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
