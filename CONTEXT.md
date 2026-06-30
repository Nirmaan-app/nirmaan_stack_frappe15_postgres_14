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
