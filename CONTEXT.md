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
