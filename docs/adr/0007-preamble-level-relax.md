# 7. Relax the preamble level-line-up commit guard (#7) to a strictly-shallower parent

Date: 2026-06-29

## Status

Accepted (pending owner review by Nitesh). **Nudges** the recorded *"all structural validations KEPT — level/parent rules"* decision under capture-only (Phase 5 Slice 2.5, `.claude/context/domain/boq-backend.md`). The invariant *"a sub-heading must sit under a higher-level section heading"* is **unchanged**; only the strictness of "higher-level" is relaxed. Built on `feature/boq-commit-preflight`.

## Context

Commit guard **#7** (the `BOQ Nodes` controller, `boq_nodes.py`) hard-stopped a committed sub-heading whose parent was not a section heading at **exactly one level above**:

```python
if doc.level > 1 and (parent.node_type != "Preamble" or parent.level != doc.level - 1):
    frappe.throw("An L{0} Preamble's parent must be an L{1} Preamble")
```

This is a **latent false-positive**, diagnosed during the commit-preflight work (see `docs/boq/commit-validations.html` #7, *"real, but a surprise"*):

- A committed node's `level` comes from the **parser/numbering axis** (frozen at parse — numbering style / `preamble_level_override`), while its `parent_node` comes from the **human/AI re-parent axis** (`review_screen.resolve_effective`). The review screen's entire purpose is re-parenting; the frontend already derives display depth from the parent chain, **not** the stored `level`.
- On a **fresh, un-edited parse** the two axes agree (the parser's stack invariant guarantees every L≥2 heading sits under a real L(N−1) heading), so #7 is **provably inert**.
- After a **legitimate human re-parent that crosses a numbering gap** (e.g. numbering jumps `1` → `1.1.1`, or a reviewer files a deep-numbered heading directly under a shallower valid heading), `level` and `parent_node` diverge and the *structurally-fine* sheet **hard-stops at commit** — with **no prior warning in review** (review has no level rule), and no way to see/fix `level` there.

The commit-preflight feature moves validation **before** the write and makes **errors block** a sheet. If #7 stayed strict, a legitimately re-parented sheet would surface a blocking error the user cannot resolve — so #7 had to be corrected. The analogous `combined_rate` structural throw was already relaxed to a warning under capture-only (Slice 3b), and #7's sibling #22 only *warns* on the same kind of computed-level mismatch — so a strict-equality hard stop here was already internally inconsistent.

## Decision

1. **Relax the rule to "strictly shallower".** A section heading deeper than L1 is acceptable iff its parent is a section heading (`node_type == "Preamble"`) at **any strictly-shallower level** (`parent_level < node_level`), instead of **exactly** `node_level − 1`. L0/L1 headings remain unconstrained. So an L3 directly under an L1 (a numbering gap) is now allowed; an L3 under an L3 / under an item is still rejected.

2. **One shared predicate.** The rule is the single function `commit_validation.preamble_parent_ok(node_level, parent_node_type, parent_level)`, imported by **both** the durable `boq_nodes.validate` backstop (`frappe.throw`) **and** the pre-commit `validate_node_plan` (previewable error). They are verified to be the same function object, so the preview and the write can never diverge on this rule.

3. **#7 stays a blocking error, not a warning.** Unlike `combined_rate`/#22, a genuinely broken parent (non-shallower, or a non-heading parent) is still a hard stop — but it now only fires on a *truly* broken tree, which re-parenting in review fixes. The new preflight surfaces it before any write with a plain-English message + a "re-parent in review" remediation, so it is never a post-commit surprise.

## Consequences

- A legitimately re-parented BoQ that crosses a numbering gap now commits instead of hard-stopping; a genuinely broken heading tree is still blocked (pre-commit, actionably).
- The committed `level` may now legitimately skip (an L3 under an L1). Display depth already comes from the parent chain, so no consumer regresses; `level` remains an informational numbering hint.
- The strict-consecutive guard is removed — the only structural truth enforced is "parent is a strictly-shallower section heading," matching how the tree is actually built and edited.
- The boq_nodes controller test that asserted the old strict behaviour is replaced by two tests: L3-under-L1 now saves; L3-under-equal-level-L3 still throws.
- `resolve_effective`, the level computation, and the commit write/freeze path are otherwise untouched (capture-only preserved).
