# CONTEXT — CEO Hold & Project Action Items

Glossary of the domain language for the "auto CEO Hold on pending delivery notes" feature.
Glossary only — no implementation detail. Terms are resolved during the design grill.

## Terms

### Pending Delivery Note
A **Purchase Order** that is dispatched (≥1 item dispatched) but not yet fully delivered, is
Billable, and is in a live status. Surfaced as exactly **one `DN_PENDING` Project Action Item
per PO**. This counts **POs awaiting delivery** — NOT Delivery Note *documents*, and NOT
undelivered line items. A PO with 3 partial DNs filed still counts as 1; a fully-delivered PO
counts as 0. (Resolved 2026-06-23, FORK 0.)

### CEO Hold
A project status that restricts most procurement / payment / expense operations. Stored as a
free-text status value (not an enumerated Select). A project is on CEO Hold while a
[[Manual CEO Hold]] is active **OR** it has one or more active [[Hold Reason]]s.
A manual attempt to move a project off CEO Hold is **rejected** while any [[Hold Reason]] is
still active (the system condition is the source of truth).
See [[Manual CEO Hold]], [[Automatic CEO Hold]].

### Manual CEO Hold
A [[CEO Hold]] set by a human — today only `nitesh@nirmaan.app` — via the project status dropdown.

### Automatic CEO Hold
A [[CEO Hold]] set by the system with no human action, stamped against a system identity rather
than a real user. Today there is exactly one: the [[Cashflow Hold]].

### Cashflow Hold
The existing [[Automatic CEO Hold]], set when a project's cashflow gap exceeds its configured
limit. Stamped `ceo_hold_by = "System (Cashflow Cron)"`.

### Delivery-Pending Hold
The new [[Automatic CEO Hold]] this feature adds, set when a project has more than 4
[[Pending Delivery Note]]s.

### Hold Reason
An active **system** reason a project is on [[CEO Hold]] (today: [[Cashflow Hold]] or
[[Delivery-Pending Hold]]), recorded as one record per source. A [[Manual CEO Hold]] is tracked
separately and is NOT a Hold Reason. A project leaves [[CEO Hold]] only when it has no active
manual hold AND zero active Hold Reasons. Does not exist on the data model today.
