# Nirmaan Stack — Domain Glossary

A shared glossary of domain terms. Definitions only — no implementation details.

## Project lifecycle & tendering

- **Status (lifecycle)** — The single field describing a Project's stage. Values: *Tendering*, *Won*, *WIP*, *Completed*, *Halted*, *Handover*, *CEO Hold*. A project holds exactly one Status at a time. *Won* replaces the former *Created* as the initial stage of a real/awarded project; *Created* is retired.

- **Tendering (project)** — A project at Status *Tendering*: a stub entered while the job is still being bid for. It carries only minimal information (Project Name, City, State, optional Customer); it has no Address, work packages, team, or timeline, and is excluded from all operational work (procurement, payment, invoices, design, etc.). It is not selectable in any operational project picker.

- **Won (project)** — A project at Status *Won*: the initial stage of a real/awarded job, carrying the full set of project information. It is reached either by entering a real project directly or by converting a Tendering project. *Won* is transient — once execution begins the Status advances to *WIP* and beyond, and the project is no longer marked *Won*. Every project that existed before this feature (formerly *Created*) becomes *Won*.

- **Convert to Won** — The one-way action that turns a *Tendering* project into a *Won* project by completing all the information a real project requires (Status moves *Tendering* → *Won*). It updates the existing project in place — its identity is preserved — and does not create a new project. There is no reverse action.

## Procurement pricing & loss

- **Benchmark (item)** — The reference amount a selected vendor quote is judged against for a single item. It is the *Target Amount* (a discounted target/benchmark rate applied to the item's quantity) when a target rate exists for that item, otherwise the *Lowest Quoted* amount (L1 — the cheapest quote received for that item in the current RFQ round). Target takes priority over L1.

- **Savings / Loss** — The signed gap between an item's Benchmark and the amount of the selected vendor quote. A positive gap is a *Saving* (the chosen quote beats the Benchmark); a negative gap is a *Loss* (the chosen quote costs more than the Benchmark). It is not a financial loss booked anywhere — it is a procurement variance against the Benchmark.

- **Loss %** — The size of a Loss expressed as a percentage of the Benchmark. It is zero when there is a Saving or no Benchmark.

- **Loss Justification** — The written reason a Procurement Executive must give for any item whose Loss % exceeds 10%. It is captured when vendor quotes are sent for approval and shown read-only to approvers; an item that needs one cannot be approved until it is present. It applies on both the Procurement Request and the Sent Back approval paths.
## BoQ review — structural decisions & AI assist

- **Structural decision (of a Review Row)** — a row's *classification* (preamble / line item / note / spacer / subtotal marker / header repeat) and its *parent*. This is the only thing the AI assist and the reviewer change; quantities, rates, amounts and descriptions are out of scope.

- **Source (of a row's structural decision)** — where a Review Row's in-force structural decision came from. Exactly one Source per row at a time: *Parser* (the deterministic local parser, the default), *Claude*, *Gemini*, or *Manual* (a custom decision the reviewer typed). The reviewer may replace the Parser decision with any other Source, per row.

- **AI suggestion / second opinion** — an advisory structural decision produced by an LLM provider (*Claude* or *Gemini*) for a row. A suggestion is *not in force* until the reviewer **accepts** it; an un-accepted suggestion never affects the committed BoQ.

- **Accept (a suggestion)** — the reviewer's act of adopting a provider's suggestion as the row's structural decision. An accepted decision is **sticky**: it is frozen at accept-time and does not change if the provider's AI pass is re-run — it only changes by a manual edit or by **revert**. A row has **at most one** accepted Source at a time: accepting a different Source (or making a manual edit) on an already-accepted row first reverts the standing acceptance, then applies the new one — so the row's Source is never ambiguous.

- **Revert (an acceptance)** — undoing an accept, restoring the row (and any children the accept moved) to its **baseline**: the state *before any* acceptance — *Parser*, or a prior *Manual* edit if one preceded. Revert never rewinds to a previously-accepted provider. Available only until the row is edited again or the sheet is finalized.

- **Provider** — an LLM backend that produces AI suggestions. Two exist: *Claude* (Anthropic; a **corrector** — it sees the parser's verdict and returns only the rows it would change) and *Gemini* (Google; an **independent second opinion** — it never sees the parser's verdict and re-classifies every row from raw facts).

- **Assignable classification** — the subset of classifications a human (or an accepted suggestion) may *set* on a row: *line item*, *preamble*, *note*, *spacer*. *Subtotal marker* and *header repeat* are **detection-only** — the parser (or a Provider) may *detect* them and they display as such, but they cannot be hand-assigned or accepted onto a row. A Provider suggestion of a detection-only class is informational, never acceptable.

## Vendor credit & adjustment application

- **Overpaid credit (of a PO)** — money already paid on a Purchase Order beyond its current (revised) value, held on that PO's adjustment as a negative balance. It is real, reusable credit — not a written-off loss.

- **Vendor adjustment credit** — the total overpaid credit a *Vendor* holds across all of its Purchase Orders (the sum of each PO's overpaid credit). It is scoped to the **Vendor** and spans **Projects**: credit earned on a PO in one project may be applied to a PO in another, provided the Vendor is the same.

- **Apply credit** — moving overpaid credit onto a PO that still owes money, reducing what that PO owes. The PO giving up credit is the **source**; the PO receiving it is the **destination**. Source and destination must share the same Vendor; they need not share a Project. Recorded as a *Return* payment on the source and a *Credit* term on the destination (the money nets to zero across the two).

- **Credit push ("Adjust Payments")** — resolving a PO's *own* overpaid credit from that PO: sending it to other POs, writing it off (ad-hoc), or recording a vendor refund. Initiated from the overpaid (source) PO.

- **Credit pull ("Apply to this PO")** — applying a Vendor's overpaid credit (held on its *other* POs) into the PO currently being viewed, which is the destination. Push and pull are two directions of the same *Apply credit* operation.
## BoQ sheet parsing configuration

- **Header row** — the single primary header row a reviewer declares for a sheet (Section 1). The **data region begins on the very next row** (`header_row + 1`). A *second* header tier sitting **above** the header row (e.g. a merged group row) is named via the "Top header row" control and is read only for area/column names — it is excluded from data by virtue of being above the header row. Extra header tiers sitting **below** the header row (a rate-split sub-label row, area-tier rows like floors/towers) are **not** auto-excluded; the reviewer removes them with *manual excluded rows*.

- **First data row** — the first row of actual data: `header_row + 1`, advanced past any *manual excluded rows* that immediately follow the header. The honest answer to "where does data start". It **replaces** the old `header_row + header_row_count` estimate, which wrongly assumed any extra header rows always sit *below* the header row (they sit *above* it, per the "Top header row" control + the parser's area-detection — only the old skip logic disagreed; see [[adr-data-starts-next-row]]).

- **Data region** — every row at or after the first data row that is not a manual excluded row. Individual rows in the data region may still be *classified* as spacer / subtotal marker / header-repeat by the parser — that is classification (a reversible label on a kept row), not exclusion.

- **Area structure** — the mapping of a spreadsheet column to the project area it measures (e.g. column G → "7th floor / T-1"). It is carried by the sheet's *area names* (Section 2) + *column→area mapping* (Section 3), authored by the reviewer. It is **separate** from the header declaration: it is never auto-derived from the area-tier rows.

- **Excluded rows (manual)** — rows the reviewer explicitly removes from the data region *in addition to* the header row, expressed as a list of **skip definitions**. Each skip definition is either a **single row** (one row number) or a **row range** (a start row + an end row, inclusive). This is the primary tool for the two cases the single header row can't cover: extra header tiers *below* the header row (rate splits, area tiers), and a column-header that *repeats mid-sheet* or a stray banner between data rows. They exclude *by position* (not by classification), anywhere in the sheet.

## Expense workflow & settlement

- **Expense Request** — an *ask* for an expense, raised by someone who may not record one directly (a Project Manager). It is **not money**: it appears in no financial figure. A senior reviews it, and **approval is what creates the actual Expense** — one only, either a Project Expense or a Non-Project Expense, depending on whether a project was named. It does reach *Paid*, but only as a **mirror**: the Expense is what gets paid, and the request follows it. Deleting that Expense deletes the request with it. Rejection is final and must carry a reason.

- **Reviewer** — the person who decides an Expense Request. Who that is depends on the **expense type**, so accommodation can be reviewed by one team and everything else by another. Nobody may decide their own request.

- **Request form (source format)** — the extra questions a particular expense type asks. Hotel and accommodation ask for the occupant, the property and the rent period; travel asks where and when. Most types ask nothing extra and use the plain form — that is normal, not a gap. Set up in **Packages Settings → Expense Packages**. When a request is approved, its answers are written onto the created Expense in readable form, so the accountant sees them where they already look.

- **Expense** — a cost recorded outside the Purchase Order / Service Request flow. Two kinds: a **Project Expense** (attributed to a specific Project; labelled "Misc Project Expense" in the UI) and a **Non-Project Expense** (company-wide, not tied to any Project). Both share the same three-stage approval lifecycle and are entered and managed together in one **Expense** area.

- **Expense and Payment status** — the single field describing where an Expense or a Project Payment sits in its lifecycle. It advances in one direction: *Requested* → *CEO Pending* → *Approved* → *Reconciliation Pending* → *Paid*, with *Rejected* as the one way out. A record holds exactly one at a time. Not every record meets every step: only a payment above the CEO's threshold waits at *CEO Pending*, and a small Expense is auto-approved straight to *Approved*.
  - **Requested** — entered, awaiting approval; not yet sanctioned and no cash has gone out.
  - **CEO Pending** — approved by the team and waiting for the CEO, who may approve it in full or approve part of it and leave the balance here.
  - **Approved** — sanctioned to spend, but the money has **not** yet left. A staging state, not settled spend.
  - **Reconciliation Pending** — an Accountant has pressed **Mark as Done** (or it is a **Cheque payment**, which arrives here on its own the moment it is approved): the money has gone out of the bank, and the record is now waiting to be matched against the bank line that paid it. An Expense also waits here while the bank lines linked to it so far — its **linked total** — add up to less than its amount, which is how a run that left the bank as many transfers settles one Expense; it becomes *Paid* only once the linked total reaches the amount. Still not settled spend — the money is gone but nothing has proved it yet.
  - **Paid** — the cash has gone out **and** every bank line that paid it has been matched to it — one line for most records, and for an Expense as many as the run took — or somebody marked it reconciled by hand. The **final** state and the **only** one that counts as real spend.
  - **Rejected** — refused. It counts toward nothing, and re-approving it from here withholds Work Order tax as a first approval does.

- **Mark as Done** — the Accountant's action that moves a record from *Approved* to *Reconciliation Pending*, meaning "the money has left the bank". It is the step that makes a record visible to Bulk Import: from 2026-09-16 the import settles a record only from *Reconciliation Pending*, never from *Approved*. A record still sitting at *Approved* cannot be matched to a bank line, and the import says so by name — "mark it as done first" — rather than refusing without explanation. *Avoid*: marking it paid, settling it. (2026-09-16, #1289.)

- **Mode of Payment** — how a Project Payment is paid: **Online** or **Cheque**. Chosen when the payment is requested and fixed from then on. Every payment raised before 2026-09-19 is Online. *Avoid*: payment type (that is the PO payment term's own field — Advance, Credit, …).

- **Cheque payment** — a Project Payment requested with a cheque's number and date. The cheque is already written, so there is nothing for an Accountant to pay: it is approved exactly like an online payment — it passes **through** *Approved*, so a Work Order's tax is withheld and its amount netted as usual — and is then moved straight to *Reconciliation Pending* without a **Mark as Done**. It is written for the amount **after** tax, so the payment and the cheque agree. **One cheque may cover several payments**: they share its number, and at reconciliation they may all carry the same reference. It is approved in full or rejected, never part-approved or re-amounted, and it is cleared by reconciling against the cheque number — no bank receipt is needed. (Owner, 2026-09-19.)

- **Settled spend (outflow)** — expense money that has actually left, i.e. an Expense at status *Paid*. **Only** *Paid* Expenses are included in any financial rollup — project outflow, the cashflow gap / CEO-Hold, project Financials totals, the Outflow reports, and the 30-day payment dashboard. *Requested* and *Approved* Expenses are commitments, not settled spend, and are excluded from every such number.

- **Auto-approval (of a small Expense)** — a positive Expense of ₹10,000 or less is created directly at *Approved*, skipping *Requested*. It is an **approval shortcut only** — it makes no claim that the money has been paid, so an auto-approved Expense is still not counted as settled spend until it is separately marked *Paid*. A refund (non-positive amount) or an amount above ₹10,000 follows the full *Requested → Approved → Paid* path. (2026-09-04: threshold raised from ₹5,000 and the comparison made inclusive — exactly ₹10,000 auto-approves.)

## Inflows

- **Project Inflow** — money received from a customer against a specific Project, optionally against one of that Project's invoices. It counts the moment it is recorded; there is no approval step.

- **Non-Project Inflow** — money the company receives that belongs to no Project and no customer. Like a Project Inflow it counts the moment it is recorded (no approval step), and it is never netted against spend. (2026-09-14: introduced; replaces the negative Non-Project Expense "receipt" as the way a bank-statement credit with no project is recorded.)
  *Avoid*: receipt, negative expense.

- **Inflow Type** — the kind of a Non-Project Inflow, exactly one of:
  - **Interest Payout** — interest paid to the company (e.g. on a deposit).
  - **FD Closure** — proceeds of a fixed deposit that was closed.
  - **Loan Received** — a loan disbursed to the company.
  - **Others** — anything else; a description saying what it is is then required.
  A **vendor refund** is conceptually separate and will get its own workflow; until then it is recorded as a Non-Project Inflow of type *Others*.

- **Transaction direction (of an imported bank row)** — *Inflow* is money received (a bank credit); *Outflow* is money paid (a debit). A row whose source states no direction counts as Outflow. The import screen's own facet labels the same two values *Received* / *Paid*.

- **Total Unreconciled Outflow** — how much bank money has been paid out and still needs reconciling: every imported bank line whose direction is *Outflow* and which still owes somebody a decision, across every import, every source and all time. Shown on the Payments summary card with the number of lines. It excludes lines already settled, lines skipped, and transfers the bank refused, because none of those is outstanding work. It is the same figure Bulk Import shows as *Still open* under *Paid out* with no filters, and the two are never allowed to disagree. It is **not** a 30-day figure and is never added to the 30-day outflow beside it. (2026-09-16.)
  *Avoid*: unmatched outflow, open outflow, unreconciled payments.

- **Skipped by hand (an imported bank line)** — a line an Admin or Accountant Lead set aside because it has nothing to link, with a typed reason; the Skipped list shows who and when. Every other skipped line is a **system skip** — money already recorded, a transfer the bank refused, a bank-statement exclusion rule, or a repeat of an earlier statement — so the same money is never recorded twice. Whether a skipped line can later be brought back is decided by its **skip kind** — the reason it was skipped, shown as Skip Type — and not by who skipped it: a hand skip can come back, and so can a line skipped as already recorded or by a bank-statement rule; a line already imported, repeated in the same file, carrying no amount, or refused by the bank never can, and nor can any Cashbook line. (2026-09-15, [ADR-0022](docs/adr/0022-unreconcile-and-unskip.md); what can be brought back amended 2026-09-17 by [Amendment C](docs/adr/0022-unreconcile-and-unskip.md).)
  *Avoid*: manual skip for a system skip a person merely confirmed.

- **Bounced transfer (an imported bank line)** — money that left the bank and was sent back, so the statement shows the same money twice: the transfer going out, and the transfer coming back. The out line is **skipped by hand** with the reason "bounced"; the line coming back is a **system skip** under the bank rule *Failed payment bounced back*. Neither line is linked to any record, and no record's amount is raised to cover it — the money never stayed out, so nothing was spent. Different from a transfer **the bank refused** outright, which never left the account and so appears only once. (2026-09-18, [ADR-0027](docs/adr/0027-many-lines-one-expense.md).)
  *Avoid*: calling the pair a refused transfer — the bank refused nothing; the money left and came back.

- **Unreconcile (an imported bank line)** — undoing a match on a settled bank line, with a typed reason, one record at a time or all at once (**Reverse all**, which changes nothing unless every record can be undone). Each record says first what will happen to it; a Project Payment goes back to *Reconciliation Pending* with its UTR and payment date cleared, and an existing Project Expense or Non-Project Expense goes back to *Reconciliation Pending* with its payment date, reference and "paid by" cleared — the status a bank line settles FROM, so the record can be matched to the right line without anyone pressing Mark as Done a second time; either is then free to match another line. A record the import itself created (a Project Inflow, a Non-Project Inflow, or a new expense) is deleted instead — unless someone edited it after the import made it — and a bank credit whose inflow was deleted can be recorded again. A **part payment** is joined back together — the leftover payment is deleted, the payment gets its full amount back and the PO's two payment terms become one — but only while the leftover is untouched; a leftover already paid by another transfer must have that transfer unreconciled first. The match record is kept, marked Reversed. The line keeps its previous suggestion but is marked **Confirm by hand**: "Confirm all matched" leaves it out and refuses it, until a person settles it from the line itself. Unreconciling a Work Order payment **never changes its amount and never withholds tax** — see *TDS withheld*. Cashbook lines cannot be unreconciled yet. (2026-09-15, [ADR-0022](docs/adr/0022-unreconcile-and-unskip.md); the revert target amended 2026-09-16 by [Amendment B](docs/adr/0022-unreconcile-and-unskip.md).)

- **TDS withheld (on a Work Order payment)** — tax deducted at source, kept back from what a vendor is paid on a Work Order and later paid to the tax department under a challan. It is withheld **once, when the payment is approved from an earlier step**: when it is approved from *Requested*, *CEO Pending* or *Rejected*, or when it is created already *Approved*. A payment that comes back to *Approved* from *Reconciliation Pending* or *Paid* is **not** withheld from again, because that is an undo, not a decision to pay. Undoing a reconciliation no longer enters *Approved* at all — since 2026-09-16 it lands at *Reconciliation Pending* — so it is doubly clear of this rule; the *Approved* cases above are kept for every other way a payment can step back. The amount stored on the payment is the **net** figure, what actually leaves the bank; the original gross survives only on the tax record. Tax already withheld is never removed by any of this — nothing in the app can reverse a tax record. A payment the CEO part-approves is the one deliberate exception: each part is taxed at its own approval, so such a payment can carry one tax record per part. A leftover created by splitting a payment in Bulk Import carries none — the tax stays withheld once, on the original. (2026-09-16, [ADR-0022 Amendment A](docs/adr/0022-unreconcile-and-unskip.md).)
  ⚠️ **Not the Technical Data Sheet**, which the same three letters name elsewhere in this system.
  *Avoid*: tax deducted again, re-deduction, TDS on Approved.

- **Unskip (an imported bank line)** — bringing a skipped line back, with a typed reason; which lines may come back is decided by the **skip kind** (see *Skipped by hand*). The line goes back to matching and is checked again straight away: it may come back needing a record, matched to a record, or skipped again because its money has since been recorded. A line a bank-statement rule skipped gets no such re-check — those rules are applied when the statement is read in — so it comes back as open work, and the dialog warns that the line was read as money moving between our own accounts. (2026-09-15, [ADR-0022](docs/adr/0022-unreconcile-and-unskip.md); amended 2026-09-17 by [Amendment C](docs/adr/0022-unreconcile-and-unskip.md).)

## Vendor invoices & credit notes

- **Vendor Invoice** — a recorded vendor bill entered against a Purchase Order or a Work Order (Service Request). Distinct from a *Project Invoice*, which bills the Customer.

- **Vendor Invoice status** — the single field for where a Vendor Invoice sits: *Pending* → *Approved* or *Rejected*. A new invoice starts *Pending* and holds exactly one status at a time. *Rejected* never counts toward anything. **"Counts toward the invoiced total" is not one rule** — three different totals coexist, deliberately; see *Total Amount Invoiced* below before using either word.

- **Total Amount Invoiced** (`amount_invoiced`, stored on Procurement Orders and Service Requests) — the money a vendor has **billed and we have accepted**: `SUM(Vendor Invoices.invoice_amount WHERE status = 'Approved')`. *Approved only* — a *Pending* bill is not yet a liability of this kind. Credit notes are **included**, because they are stored negative and net off in the sum. It is a derived cache, recomputed from source by the Vendor Invoices doc events, never incremented by a delta. Do **not** confuse it with the two neighbouring totals that answer different questions: the invoice-approval tables total *Pending + Approved* (the two disagree on real data), and `invoice_qty` counts *Pending + Approved* **quantities** with credit notes **excluded**. Harmonising them is a bug, not a cleanup.

- **Amount Due** (`amount_due`, stored on both doctypes) — what is owed on an order, and **the formula differs by doctype on purpose**: a Purchase Order uses `amount_invoiced − amount_paid` ("billed to us and not yet paid"); a Work Order uses `total_amount − amount_paid` ("ordered value not yet paid"), which is what WO screens have always shown and what their print footnote states. Moving Work Orders onto the PO formula would change most rows. It may go **negative** when an order is overpaid. The split lives in one constant so neither side can drift.

- **Current Liabilities** — a **third, separate** figure: `max(0, po_amount_delivered − amount_paid)`, per PO before summing. Based on what physically **arrived**, not what was billed, and clamped at zero so an overpayment never reads as a negative liability. It is *not* Amount Due and the two disagree on roughly half of all POs. It feeds the CEO-Hold cashflow gap.

- **Approved invoice** — a Vendor Invoice at status *Approved*: treated as financially committed (it counts toward the invoiced total and drives billing status). Editing or deleting one is restricted to an *Admin* — the rationale and the (deliberately uneven) enforcement live in [ADR-0014](docs/adr/0014-invoice-mutation-permissions.md).

- **Credit Note** — a **Purchase-Order-only** Vendor Invoice variant recording a vendor credit: its amount is stored negative and it is excluded from the PO's invoiced quantity. Work Orders (Service Requests) have no credit notes.

- **Admin (Nirmaan)** — the elevated actor these financial-mutation rules gate on: the *Administrator* user or a holder of the *Nirmaan Admin Profile*. Deliberately narrower than the broader "privileged" role sets (e.g. PMO Executive, Accountant Lead) used on read/visibility surfaces.

## Work-order GST

- **GST flag (of a Work Order)** — whether a Work Order (Service Request) was raised with GST *on* or *off*. With GST on, the Work Order's total already includes 18% GST; with GST off, its total is the bare value with no GST in it. The UI labels it "Incl. GST" (Yes / No).

- **GST-off Work Order** — a Work Order whose *GST flag* is off (`gst = "false"`, labelled "GST Applicable" off on the approved WO page). A new Work Order starts GST-on; approval switches it off.

- **Notional GST** — the GST a GST-off Work Order *would* have carried: 18% of its total. It is not owed, paid or invoiced anywhere — a what-if figure showing how much GST was never charged on work ordered without it. A GST-on Work Order has none (its GST is real and already inside its total). Only **Approved** Work Orders count — the same set as the Work Order side of "PO + WO Amount" — so a Work Order under amendment drops out of both until it is approved again. *Avoid*: GST payable, GST liability, missing GST.

## Vendor holds

Two separate holds sit on a Vendor. They share the word "hold" and nothing else — never merge them in UI copy, code or reports.

- **Vendor Hold** — the *credit* hold: `vendor_status` = On-Hold when the vendor's available credit is used up. Blocks dispatch and payments on "PO Approved" POs. Set by the daily credit job; cleared automatically when credit frees up.

- **GST Hold** — the *GST* hold: the `gst_hold` checkbox. The daily job turns it ON for a Service or Material & Service vendor with **no GST number** whose **GST-off Work Orders** created this financial year (not Rejected) total **more than ₹15,00,000**, summed on their Work Order total. A vendor on GST Hold **cannot get a new Work Order**; its existing Work Orders carry on. The job only ever turns it ON — it stays ON when the total drops, when the vendor gets a GST number and into the next financial year. Only *Remove GST Hold* (Admin) takes it off. A change by hand on the field switches no Work Order; an untick on a vendor that still qualifies is put back ON the next morning. *Avoid*: "vendor on hold" for this — that phrase means Vendor Hold. ([ADR-0028](docs/adr/0028-gst-hold.md).)

- **Remove GST Hold** — the Admin action on the Vendor page. It switches the vendor's GST-off Work Orders of this financial year to GST-on (each total gains 18%, so a paid one shows a new balance due) and then clears GST Hold. A Work Order not in Approved status is skipped and stays GST-off.

## Module residence

- **Placement vs residence** — *Placement* is which folder a file lives in (already legislated in CLAUDE.md). *Residence* is which single module **owns** a concept — a business calculation, a data shape, a document's state, or write-safety. A concept with no residence scatters across call sites and drifts. The ten residence rules and the residence map live in [ADR-0010](docs/adr/0010-module-residence-rules.md).

- **Deep module** — a module whose interface is much smaller than its implementation: it owns a concept behind a narrow seam, so callers depend on the seam, not the internals. A *shallow* module (interface nearly as large as its implementation) leaks its concept to every caller. The codebase spans both: BoQ / ITM / PO-Adjustments are deep; Service Requests / Procurement are shallow.

- **Residence map** — the one-screen table (in ADR-0010) that answers "where does this go?" before code is written: calculations → a pure module; JSON/child-table shapes → one accessor; `workflow_state` → one deriver; endpoints → thin orchestrators; counts/aggregates → the database; mutations → the write-safety seam.

## Procurement approval

- **Awaiting approval (of a PR or Sent Back)** — a Procurement Request or Sent Back Category ready for line-item approval: its `workflow_state` is *Vendor Selected* or *Partially Approved* **and** at least one of its order-list items is still *Pending*. It is the single rule behind the sidebar "Approve" count and the approval screens; a PR and an SB share it (they share the order-list child table). Its one home is a single pure module (ADR-0010, rule B1) — replacing the copy of this rule that was scattered across the sidebar-count and approval endpoints.
## BoQ concurrency & directional guard

- **Upstream stage** — a BoQ pre-pricing stage whose output a later stage consumes: *Config*, *Review*, and the backward actions *re-parse*, *re-commit*, *un-finalize*, and *root-metadata* (tax treatment / version) edits. Contrast *Downstream stage*.

- **Downstream stage** — the stage that consumes an upstream stage's output. For a committed sheet the downstream stage is **Pricing** of its current committed version (*Tendering* is a later downstream stage). The BoQ phases form a one-way ladder: Config → Review → Commit → Pricing/Tendering.

- **Orphanable work** — priced cells on a sheet's *current committed version*: the work an upstream change would strand. On a re-commit they survive on the now-frozen version but are not carried into the new one (only rates copy forward, and only partially). Zero orphanable work means an upstream change is free forward progress.

- **Live (downstream)** — an orphanable sheet is *Live* when **another** user holds a fresh single-editor pricing lock on its current committed version. A *Live* directional warning names that user. Contrast *Vacated*. A lock held by the *same* user performing the upstream action does not count as Live (you are never warned about yourself).

- **Vacated (downstream)** — orphanable work exists but no other user is currently *Live* on it (nobody holds a fresh pricing lock). A *Vacated* directional warning states only the count — no name.

- **Presence-escalated warning** — the directional guard's response: an unmissable warning that always fires when *orphanable work* exists (*Vacated* → count only) and escalates with the editor's name when the downstream stage is *Live*. It never blocks — the user may proceed after acknowledging. Surfaced at two touchpoints: on entering a pre-phase screen (a banner) and on saving within it (an interrupting confirm). [[0011-boq-concurrency-locking]]

## BoQ create-from-template & quantities

- **Template-origin BoQ** — a BoQ created by cloning the master template rather than by uploading a workbook. It has **no source spreadsheet**, so it cannot be re-parsed, and both its structure and its later priced spreadsheet are *generated*, never read back from an original. Contrast an **upload-origin BoQ**.

- **Area (quantity area)** — a named subdivision of the project (e.g. a tower or a floor) whose quantities are measured separately. Areas are **BoQ-wide** — one set for the whole BoQ — and are fixed when the BoQ is created from a template. A *single-area* BoQ has one implicit area; a *multi-area* BoQ carries a quantity per area on each line item. (Distinct from *Area structure* under sheet parsing, which maps an uploaded spreadsheet column to an area; here the areas are declared by the user at create time, not discovered from a file.)

- **Total Quantity (of a line item)** — a line item's quantity across the whole BoQ: the single entered quantity when the BoQ is single-area, and the **sum of the per-area quantities** when it is multi-area. In the multi-area case it is a *derived* total — never entered directly — and always equals the sum of the areas. In the review grid a multi-area Total updates live as the areas are typed.

- **Priced BoQ (download)** — the spreadsheet a user downloads once a BoQ is priced, carrying the entered rates and the amounts they imply. For an **upload-origin** BoQ it is the original workbook with prices stamped into it; for a **template-origin** BoQ — which has no original — it is **generated from the committed BoQ** as a plain but lightly-styled workbook, and comprises the priced trade sheets, the approved-makes list, and a computed cost summary.

## Snag tracking

- **Snag** — a single defect, incomplete item or observation recorded against a Project during a site walk (e.g. "detector cables are hanging and not properly laid"). It is a unit of work to be closed, not a financial or procurement record. A Snag belongs to exactly one Project.

- **Snag Batch** — one sheet's worth of Snags, brought into the system by a single import of one worksheet. A Batch is the unit a Snag arrives in and the unit it can be removed in. Snags outside any Batch exist only when added by hand. *Avoid*: upload, import job, snag list (the "Snag List" is the whole set for a Project, not a Batch).

- **Category (of a Snag)** — the discipline or trade a Snag belongs to as written by whoever produced the source list (e.g. *Fire & Life Safety*, *Electrical*, *Lighting*, *Documentation*). It is the source author's vocabulary, recorded verbatim; it is deliberately **not** a Nirmaan *Work Header* and carries no relationship to Work Packages. *Avoid*: work header, discipline, trade.

- **Area (of a Snag)** — the place in the building a Snag was observed, as written by the source author (e.g. *Food Box – General*, *LT Room*, *Opp. McD Shop*). Free text in the author's own words; two spellings of the same place are two Areas. *Avoid*: zone, location.

- **Snag Status** — the single field describing how far a Snag is from closed. Values: *Pending* (nothing done yet — the state every imported Snag starts in), *WIP* (being worked), *Completed* (closed), *Not Applicable* (judged not to be a real Snag, or no longer relevant). A Snag holds exactly one Status at a time.

- **Skipped row** — a row in a source worksheet that the import declined to read as a Snag ON ITS OWN,
  always with a stated reason (blank, repeated header, summary block, no description, above the header
  row). A skipped row is only ever a DEFAULT: it is shown unticked with its reason, and anyone may tick
  it, after which it is imported like any other. The importer never overrides a human's tick.

- **Remark (of a Snag)** — the one free-text field on a Snag. It arrives holding whatever the source
  author wrote against that row, and from then on it is the working note: anyone who may change the
  Snag's Status may rewrite it in the same action. It is therefore the CURRENT remark, not a record of
  the original one — an edit overwrites, and the imported text survives only in the batch's stored
  source file and the version log. Singular, because the plural collides with the import mapping's
  `remarks` key, which names an Excel COLUMN rather than any text. *Avoid*: comments, notes,
  source remarks.

- **Manual Snag** — a Snag entered by hand rather than imported, belonging to no Batch. It behaves identically to an imported Snag in every other respect.

## Technical Data Sheets (TDS)

⚠️ **"TDS" names two unrelated things in this system.** This section is the **Technical Data Sheet**:
a manufacturer's datasheet PDF for a product, kept in a shared catalogue and bundled per project into a
signed submittal report. It is **not** *TDS withheld* (tax deducted at source) above. When the context
does not make it obvious, say "Technical Data Sheet" or "tax TDS" in full.

The catalogue is three levels deep: an **Items SKU** belongs to a **TDS Item** (the group), and each
**TDS Repository Entry** is one Make's datasheet for that group. Decisions:
[ADR-0023](docs/adr/0023-tds-item-grouping-model.md) (the grouping model),
[ADR-0024](docs/adr/0024-tds-phase1-restructure-in-place-freeze-consumption.md) (Phase 1),
[ADR-0025](docs/adr/0025-tds-phase2-group-driven-consumption.md) (Phase 2),
[ADR-0026](docs/adr/0026-tds-membership-n1-owned-by-item.md) (membership).

- **TDS Item** *("TDS SKU")* — the **group**: a named set of catalogue items that one datasheet family
  covers. It belongs to **one Work Package**; its members may come from **several Categories** inside
  that package, so a TDS Item has no category of its own. It has **no Make and no datasheet** — those
  live on its Repository Entries, one per Make. **Members are optional**: a TDS Item with none is a
  *Custom Item*. "TDS SKU" is an informal synonym; the canonical noun is **TDS Item**.
  *Avoid*: TDS group record, spec group.

- **TDS Repository Entry** — one datasheet: a **(TDS Item, Make)** pair plus its PDF and a
  *Verified / Not Verified* status. A group has at most one entry per Make.
  *Avoid*: TDS row, repository item.

- **TDS Repository** — the company-wide catalogue of TDS Items and their Repository Entries. Not tied to
  any project. Maintained by Admins.

- **Items SKU** — a row of the **Items** master (item code, name, category). It belongs to **at most one**
  TDS Item, and the **item owns that link** — a group's members are simply the items that name it
  (ADR-0026, which replaced the original many-to-many).

- **Members mirror** — a read-only copy of a group's members kept on the TDS Item, only so the Frappe
  Desk form can list them. It is **not** a second source of truth: nothing in the product reads it, and
  membership changes only by changing an item's link, never by editing the mirror (ADR-0026 Amendment B).

- **Project TDS** — the per-project workflow: picking TDS Items for a project, sending them for
  approval, and exporting the merged project TDS report PDF.

- **Project TDS row** *(`Project TDS Item List`)* — one picked **TDS Item + Make** on a project, with its
  own approval status (*New*, *Pending*, *Approved*, *Rejected*). It is a **snapshot**: the group id and
  name, make, work package and datasheet are copied onto the row when it is picked, so a signed report
  does not change when someone later edits the catalogue. Picking an existing entry makes a *Pending*
  row; asking for something the catalogue lacks makes a *New* row (a *request*).

- **Project TDS Setting** — a project's report branding: client, architect, consultant and contractor
  names and logos, used on the report cover.

- **Custom Item** — something with **no Items-master SKU**, recorded as a TDS Item with **no members** —
  "custom" is inferred from having zero members, not from a flag. No Items-master row is ever created
  for it. Legacy `CUS-` catalogue rows became member-less TDS Items. The old project-only custom
  (`PCUS-`) is **retired**: every approved custom joins the shared catalogue (ADR-0025).

- **Approval-time promotion** — approving a *New* request writes the catalogue: a missing Make becomes a
  new Repository Entry, a brand-new group becomes a new member-less TDS Item plus its entry, and both are
  born *Verified*. Admin-only.

- **Verified / Not Verified** — a Repository Entry's status: has this datasheet been vetted. Approving any
  project row that uses the entry marks it *Verified*. It is separate from a project row's approval
  status — every project pick still needs its own approval, whatever the entry's status.

- **Coverage** — the member items of a picked group, shown for information on the project row and the
  report (the report's *Model No.* is the members' categories, and its sample description lists the
  member names). Coverage is **read live from the catalogue** when the report is built, so it can move
  after signing; only the **datasheet** is the frozen, signed artefact. The row also keeps a frozen copy of
  the categories, used only when the group no longer exists or has no members.
  ⚠️ *Open question, 2026-09-17:* the code that freezes that category copy says it exists "so the signed
  PDF stays historically accurate", but the report prefers the live categories whenever the group still
  has members. The two intents disagree; which one is right is an owner call.

### Who can do what (TDS)

- **Admin** (`Nirmaan Admin Profile`) — full control of the TDS Repository (groups and entries). The
  **only** approver of Project TDS rows. Deletes any Project TDS row, at any status.
- **PMO Executive** — project-level manager. Uses **Request New** to propose new groups or makes, manages
  Project TDS setup, and may set an item's TDS group from the Items side. Deletes Project TDS rows **at
  any status**, like an Admin (owner ruling, changed from Pending/Rejected-only). Cannot approve, and
  cannot author groups or entries.
- **Project user** (leads, managers, others) — can only pick existing catalogue entries for their
  projects. No edit, no delete, no Request New.

⚠️ **The delete rules and the approver rule are screen-level only, not enforced.** Project TDS rows are
deleted straight through the standard document API with no server check, and every Nirmaan role holds
write and delete on them — so any role can delete any row, *Approved* included, through the REST API.
Approval is checked only inside the approve endpoint. Closing either gap needs a server-side check.
