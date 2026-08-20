# 8. The sheet-finalize gate is fully hard (structural breaks block; "Mark anyway" removed)

Date: 2026-06-29

## Status

Accepted. The S2 slice of the commit-preflight work (surfacing `#7`/`#8` in the review screen). **Reverses** the soft "warn & confirm" finalize gate. Builds on [ADR-0007](./0007-preamble-level-relax.md) (the `#7` relax) + the S1 preflight. Branch `feature/boq-commit-preflight`.

## Context

The finalize gate (`review_screen.mark_sheet_parsed_check_done`) was **soft**: structural breaks (`line_item_as_parent`, `cycle`) were shown, but a `confirm=True` ("Mark anyway") re-call finalized the sheet *despite* them (returning `overridden: true`).

S1 made the **commit** hard-block the two structural errors — `#7` (sub-heading level line-up) and `#8` (item under a non-heading): the BOQ Nodes controller `frappe.throw`s on them, and the preflight surfaces them as blocking errors that exclude the sheet from the commit. S2 surfaces those same `#7`/`#8` in the review screen, computed by the *shared* validators (`commit_validation.build_sheet_node_plan` + `validate_node_plan`) over the same `ai_*`-free human>parser tree the commit uses — so review and commit can never disagree.

The crux: `#7`/`#8`/`cycle` are genuine commit-blockers that **cannot be acknowledged away** — the controller throws regardless. A soft override that lets the user finalize past them just produces a **finalized-but-uncommittable** sheet: the user finalizes, reaches the commit dialog, is blocked, and bounces back to review. The override was pointless once commit hard-blocks the same breaks.

## Decision

1. **The finalize gate is fully hard.** Any structural break ⇒ `mark_sheet_parsed_check_done` returns `{ok: False, breaks}` **regardless of `confirm`**. Finalize succeeds only when `breaks` is empty. (`confirm` stays in the Python signature for HTTP back-compat but is inert.)
2. **"Mark anyway" + `overridden` are retired.** The frontend's "Structural issues found" → `confirm=True` re-call is removed; the **Finalize button is disabled while any structural break exists**, and the must-fix panel (already rendered in the review tree) shows what to fix. `overridden` is dropped from the response + the TS type.
3. **The model collapses to two clean tiers:** structural breaks (`#7`, `#8`, `cycle`) = **hard must-fix** (block finalize); advisory flags (`orphan` / `parser` / `classifier_warning`) = **soft** (never block; `orphan` stays the dismissable amber advisory from the 2026-06-26 demotion).
4. **`#8` is generalized.** `review_screen.check_structural_integrity` drops its narrow `line_item_as_parent` block (item-under-item only) in favour of the shared `line_item_parent_not_preamble` (item under **any** non-heading — another item *or* a note), a strict superset. `check_structural_integrity` now computes only `cycle`; `#7`/`#8` come from `commit_validation.structural_errors_for_sheet`.

## Consequences

- A **finalized sheet is guaranteed structurally committable** (re `#7`/`#8`/`cycle`) — the commit dialog never surprises the user with a structural error on a sheet they already finalized. The review↔commit asymmetry that motivated this work is closed.
- Review becomes the single place structure is *enforced*; the commit dialog enforces nothing structural that review didn't already.
- The soft "warn & confirm" finalize affordance is gone — intentional. Scope decision (S2): review surfaces **errors only** (`#7`/`#8`); the soft commit warnings (`#15`/`#16`/`#20`/`#22`) stay in the commit dialog's "Looks OK" gate, not duplicated in review.
- `review_screen` + `commit_validation` share one cycle-free import path (the merge calls `structural_errors_for_sheet` via a lazy function-level import, since `commit_validation` imports `resolve_effective` from `review_screen` at module load). `test_review_screen` 232 → 236.
- The commit-side controller `frappe.throw` guards + the preflight are unchanged — they remain the durable backstop / defense-in-depth.

---

## Amendment A — `#8` narrowed: an item MAY parent an item (2026-08-19, owner ruling)

**This amends Decision point 4 only. The gate stays fully hard; points 1–3 are untouched.**

Point 4 generalized `#8` from *item-under-item* to *item under **any** non-heading*, calling the
new rule "a strict superset". The superset half was right and stays. The premise underneath it —
that an item under another item is a defect at all — was wrong.

**What was wrong with it.** Real bills nest a sub-item under its parent item: a rate breakdown, an
accessory line, a sub-component priced separately beneath the assembly it belongs to. The review
screen has *always* allowed a human to pick that parenting — the parent picker only greys out
cycle-unsafe rows — so the product offered the move and then refused to finalize the sheet, with no
override (point 1 removed the escape hatch, correctly, for genuine blockers). The result was a
dead end reachable in two clicks, and the only way out was to undo work the user meant to do.

**The narrowing.** `#8` now fires only when a Line Item's parent is a note, a subtotal marker, or a
repeated header (`node_type == "Other"`). Those are text/marker rows that hold no children in any
meaningful sense, so an item filed under one is almost always an accident — the case `#8` can still
speak to. The wire code `line_item_parent_not_preamble` is **unchanged**: it is the discriminant of
the frontend `StructuralBreak` union, and renaming it would be a breaking contract change for no
behavioural gain. Its user-facing sentence changed; its identity did not.

**One predicate, two sites.** `commit_validation.line_item_parent_ok(parent_node_type)` is the single
definition, mirroring the existing `preamble_parent_ok`. It is read by the previewable validator
(`validate_node_plan` `#8`) **and** by the durable `BOQ Nodes` controller backstop. Relaxing either
alone re-opens exactly the review↔commit asymmetry this ADR exists to close — review would finalize a
sheet the controller then throws on.

**`#16` widened in the same change.** `pricingRollup` sums a node's own amount **plus** its
descendants', so a priced parent double-counts. That is precisely why `#16` already warned about a
priced *heading* with children; once an item can be a parent, a priced parent *item* is the identical
shape. `#16` now covers both, voiced per type. It stays **advisory** — nesting a breakdown under a
priced parent is sometimes what the bill genuinely says, so this informs, it never blocks.

**The prompts followed (owner Option B, same day).** Both classification prompts stated the
prohibition and it had become false, so leaving them would have told the models a rule the product no
longer enforces. The owner chose to state the permission EXPLICITLY rather than fall silent — so the
models can propose the nesting where a bill genuinely shows one — over the alternative of deleting the
sentence and saying nothing (the mechanism note-under-note uses). ONE sentence, verbatim-identical on
both engines:

> `- A line_item may be the parent of another line_item when the child row is a sub-component or a`
> `breakdown of it; otherwise a line_item's parent is the preamble heading its section.`

Done pin-first-reword-second: the three pins were moved to the new wording and shown RED against the
unchanged prompts before either prompt was touched. A NEW cross-engine drift guard
(`test_line_item_parent_rule_is_identical_on_both_engines`) asserts both prompts carry the identical
literal — previously each pin repeated it in its own file and nothing checked they still matched, so
editing one engine left the other green and the drift was invisible. Note-under-note silence is
untouched and still negative-pinned on both engines.

**Unverified against real model behaviour.** No test can see what a model returns, and the
classification corpus (Set-1/Set-2) is spent, so this ships on reasoning rather than measurement. It
compounds the accepted loss below: the models are now *invited* to nest items, and no structural gate
checks the result. A live AI pass on a real sheet is owed.

**Consequence — an accepted loss.** Item-under-item is now unverified by any structural gate. If a
parser or AI regression started emitting it, nothing would flag it. That is the cost of the ruling and
was accepted: the shape is legitimate, so a gate cannot tell an intended nesting from an accidental
one. `#16` is the only remaining signal, and only when the parent is priced.
