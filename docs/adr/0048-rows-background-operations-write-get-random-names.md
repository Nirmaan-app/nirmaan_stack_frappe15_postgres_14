# ADR 0048 — Rows that background operations write get random names, not counted numbers

**Status:** Accepted · 2026-11-08 (grill with the owner, Q12 and Q19) · Spec #1654

Every connection runs at REPEATABLE READ (`frappe/database/postgres/database.py:186`), and a counted name such as
`BRCT-.YY.-.#####` is taken from one row of `tabSeries` under `SELECT ... FOR UPDATE` (`frappe/model/naming.py:396`).
When two transactions overlap and both take a number from the same series, the later one fails with
`SerializationFailure` once the first commits, however late it asks, and Frappe does not retry it. On prod this failed
11 classify operations in the 3 hours two `long` workers ran (2026-10-17), and with one worker it already fails
action-item reconciles (#1651) and pricing saves (#1652).

We decided that the high-volume rows background operations write, whose names no user sees or types, are named by
`hash` (random, from `frappe.generate_hash`, no shared table): BoQ Review Row, BoQ Row Category, BoQ Rate Suggestion
Run, BoQ Rate Match Run, and BoQ Cell Pricing and Project Action Item once their readers are checked the same way.
Existing rows keep their counted names. Rows whose number users see (BOQs, `BOQ-.YY.-`) keep the counter and take a
session-level advisory lock per series around the operation instead.

We measured four fixes on a dev env, 10 runs each of two concurrent clones at 2 workers (today: 0 of 10 both
succeed): an advisory lock inside the transaction (0/10, the snapshot is already stale), a session advisory lock
(10/10), retry via `RetryBackgroundJobError` (10/10, but RQ then records every retried success as failed), one lock per
kind (10/10, but it serializes operations that do not clash), and random names (10/10, and the only one that also
covers web requests). On the owner's incident, two classify engines from one click at 2 workers: 0/5 today, 10/10
with random names, the click finishing in 24.9 s against 48.2 s with one worker.

The cost: these names are no longer in creation order and carry no year; nothing reads them that way today (no
`order_by name`, no Link field, no screen shows them; the only stored copy, `BoQ Nodes.review_row_name`, is written
and never read). The change goes through Frappe's doctype tooling, never a hand edit of the doctype JSON. The investigation's evidence is summarised in spec #1654.
