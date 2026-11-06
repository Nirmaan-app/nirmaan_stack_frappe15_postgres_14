---
extends: feature, bug-fix, refactoring
when: Any pstack build in this repo, so its terms and decisions land in the knowledge base that Matt Pocock's skills read.
---

# Shared knowledge base

`GLOSSARY.md` and `docs/adr/` are this repo's one knowledge base. Matt Pocock's skills (`/grilling`, `/to-spec`, `/to-tickets`) read and write it, and pstack builds do the same, so each side finds the other's work.

- **In** "over the affected subsystem": read the knowledge base first, as `docs/agents/domain.md` says, and name the `GLOSSARY.md` sections and ADRs you read in every delegate's brief. Done when the brief lists them, or says the area has none.
- **Before** "Run **Opening a PR**": load the `mattpocock-skills:domain-modeling` skill and apply it to what this task built. Write each new or changed term to `GLOSSARY.md` in that skill's format, without asking. Offer an ADR only when that skill's three tests pass, and write it after the user's yes. Commit both on the task's branch. Done when every term the diff introduces is in the glossary and every ADR that passed the tests was offered.
