# Nirmaan Stack — Domain Glossary

A shared glossary of domain terms. Definitions only — no implementation details.

## Project lifecycle & tendering

- **Status (lifecycle)** — The single field describing a Project's stage. Values: *Tendering*, *Won*, *WIP*, *Completed*, *Halted*, *Handover*, *CEO Hold*. A project holds exactly one Status at a time. *Won* replaces the former *Created* as the initial stage of a real/awarded project; *Created* is retired.

- **Tendering (project)** — A project at Status *Tendering*: a stub entered while the job is still being bid for. It carries only minimal information (Project Name, City, State, optional Customer); it has no Address, work packages, team, or timeline, and is excluded from all operational work (procurement, payment, invoices, design, etc.). It is not selectable in any operational project picker.

- **Won (project)** — A project at Status *Won*: the initial stage of a real/awarded job, carrying the full set of project information. It is reached either by entering a real project directly or by converting a Tendering project. *Won* is transient — once execution begins the Status advances to *WIP* and beyond, and the project is no longer marked *Won*. Every project that existed before this feature (formerly *Created*) becomes *Won*.

- **Convert to Won** — The one-way action that turns a *Tendering* project into a *Won* project by completing all the information a real project requires (Status moves *Tendering* → *Won*). It updates the existing project in place — its identity is preserved — and does not create a new project. There is no reverse action.

## BoQ review — structural decisions & AI assist

- **Structural decision (of a Review Row)** — a row's *classification* (preamble / line item / note / spacer / subtotal marker / header repeat) and its *parent*. This is the only thing the AI assist and the reviewer change; quantities, rates, amounts and descriptions are out of scope.

- **Source (of a row's structural decision)** — where a Review Row's in-force structural decision came from. Exactly one Source per row at a time: *Parser* (the deterministic local parser, the default), *Claude*, *Gemini*, or *Manual* (a custom decision the reviewer typed). The reviewer may replace the Parser decision with any other Source, per row.

- **AI suggestion / second opinion** — an advisory structural decision produced by an LLM provider (*Claude* or *Gemini*) for a row. A suggestion is *not in force* until the reviewer **accepts** it; an un-accepted suggestion never affects the committed BoQ.

- **Accept (a suggestion)** — the reviewer's act of adopting a provider's suggestion as the row's structural decision. An accepted decision is **sticky**: it is frozen at accept-time and does not change if the provider's AI pass is re-run — it only changes by a manual edit or by **revert**. A row has **at most one** accepted Source at a time: accepting a different Source (or making a manual edit) on an already-accepted row first reverts the standing acceptance, then applies the new one — so the row's Source is never ambiguous.

- **Revert (an acceptance)** — undoing an accept, restoring the row (and any children the accept moved) to its **baseline**: the state *before any* acceptance — *Parser*, or a prior *Manual* edit if one preceded. Revert never rewinds to a previously-accepted provider. Available only until the row is edited again or the sheet is finalized.

- **Provider** — an LLM backend that produces AI suggestions. Two exist: *Claude* (Anthropic; a **corrector** — it sees the parser's verdict and returns only the rows it would change) and *Gemini* (Google; an **independent second opinion** — it never sees the parser's verdict and re-classifies every row from raw facts).

- **Assignable classification** — the subset of classifications a human (or an accepted suggestion) may *set* on a row: *line item*, *preamble*, *note*, *spacer*. *Subtotal marker* and *header repeat* are **detection-only** — the parser (or a Provider) may *detect* them and they display as such, but they cannot be hand-assigned or accepted onto a row. A Provider suggestion of a detection-only class is informational, never acceptable.
