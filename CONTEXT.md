# Nirmaan Stack — Domain Glossary

A shared glossary of domain terms. Definitions only — no implementation details.

## Project lifecycle & tendering

- **Status (lifecycle)** — The single field describing a Project's stage. Values: *Tendering*, *Won*, *WIP*, *Completed*, *Halted*, *Handover*, *CEO Hold*. A project holds exactly one Status at a time. *Won* replaces the former *Created* as the initial stage of a real/awarded project; *Created* is retired.

- **Tendering (project)** — A project at Status *Tendering*: a stub entered while the job is still being bid for. It carries only minimal information (Project Name, City, State, optional Customer); it has no Address, work packages, team, or timeline, and is excluded from all operational work (procurement, payment, invoices, design, etc.). It is not selectable in any operational project picker.

- **Won (project)** — A project at Status *Won*: the initial stage of a real/awarded job, carrying the full set of project information. It is reached either by entering a real project directly or by converting a Tendering project. *Won* is transient — once execution begins the Status advances to *WIP* and beyond, and the project is no longer marked *Won*. Every project that existed before this feature (formerly *Created*) becomes *Won*.

- **Convert to Won** — The one-way action that turns a *Tendering* project into a *Won* project by completing all the information a real project requires (Status moves *Tendering* → *Won*). It updates the existing project in place — its identity is preserved — and does not create a new project. There is no reverse action.
