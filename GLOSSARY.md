# Nirmaan Stack — Domain Glossary

A shared glossary of domain terms. Definitions only — no implementation details.

## Project lifecycle & tendering

- **Tendering status** — A Project's bid outcome: *Tendering* (still being bid for), *Won* (awarded), *Lost* or *Merged*. It is one of a project's two status fields; the other is its execution **Status**. A project entered directly as a real job starts at *Won*. *Won* is permanent and never changes back, whatever happens to the project's execution afterwards. *Lost* is reached only from *Tendering*. (ADR-0001 v3.)

- **Status (execution)** — The execution stage of a Won project: *Won*, *WIP*, *Completed*, *Halted*, *Handover*, *CEO Hold*. It is blank while the project is Tendering or Lost. *Won* replaces the former *Created* as the first stage; *Created* is retired. *Avoid*: "Status" for the bid outcome, which is the **Tendering status**.

- **Tendering (project)** — A project whose Tendering status is *Tendering*: a stub entered while the job is still being bid for. It carries only minimal information (Project Name, City, State, optional Customer); it has no Address, work packages, team, or timeline, and is excluded from all operational work (procurement, payment, invoices, design, etc.). It is not selectable in any operational project picker.

- **Won (project)** — A project whose Tendering status is *Won*: a real/awarded job carrying the full set of project information. It is reached either by entering a real project directly or by converting a Tendering project. Its execution Status starts at *Won* and moves on to *WIP* and beyond, but the project stays Won as a bid throughout. Every project that existed before tendering was introduced (formerly *Created*) is Won.

- **Convert to Won** — The one-way action that turns a *Tendering* project into a *Won* project by completing all the information a real project requires. Its Tendering status moves *Tendering* → *Won*, and its execution Status starts at *Won*. It updates the existing project in place — its identity is preserved — and does not create a new project. There is no reverse action.

- **Selected BoQ** — a BoQ of a Won project that belongs to the job's live scope: one picked at **Convert to Won**, one an Admin added after the project was Won, or one an Admin later marked Selected. Once a project is Won, only its Selected BoQs can be edited by anyone other than an Admin. A BoQ stays Selected however much it is edited; only an Admin moves it back to Draft. More than one BoQ, and more than one version of the same BoQ, can be Selected at once. *Avoid*: approved BoQ, awarded BoQ, active BoQ, current version; and "selected" for a ticked box in a list, which is *checked*. (Owner, 2026-10-21.)

- **Merge BoQs / Merged (project)** — moving every BoQ of a *Tendering* project into a *Won* project, because the tender was won as part of that job: from the Tendering project's overview into an existing Won project, or in the Convert to Won / Create project wizard into the project being made. Each BoQ is ticked or not: ticked ones become **Selected BoQs**, the rest Draft (**Other BoQs**). The Tendering project becomes *Merged*: closed, pointing at the Won project it went into. **Undo merge** moves exactly those BoQs back as Draft and returns the project to *Tendering*. A project is merged into one Won project at a time; a Won project can receive many merges. Anyone who can create projects may merge and undo. *Avoid*: combine, attach, transfer BoQs. (Owner, 2026-10-21; ADR-0038.)

- **Other BoQs** — every BoQ of a Won project that is not a **Selected BoQ**. Everyone can see and open them, but only an Admin can edit them or mark them Selected. *Avoid*: superseded, rejected, archived BoQs. (Owner, 2026-10-21.)

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

- **Expense Request** — the one way a person raises an expense: every Expense raised in the app starts as one, whoever raises it. Screens call it simply an *Expense*. It is **not money**: it appears in no financial figure. A **Reviewer** decides it, unless its raiser **records without review**, in which case it is *approved on submit*. **Approval is what creates the actual Expense** — one only, either a Project Expense or a Non-Project Expense, depending on whether a project was named. From then on the request always shows its Expense's current status, as a **mirror**: the Expense is what gets approved and paid, and the request follows it, including a rejection or an undone payment. An invoice added to the request is copied onto its Expense. Deleting that Expense deletes the request with it. Rejection by a Reviewer is final and must carry a reason. (Owner, 2026-10-19: one door for every raiser.)

- **Reviewer** — the person who decides an Expense Request. An Admin may decide any request; HR and Accounts may decide a Project Manager's. Nobody may decide their own request. A request raised by someone who **records without review** has no Reviewer. (Owner, 2026-10-19.)

- **Records without review** — the role profiles whose Expense Requests are approved on submit, with no Reviewer. Admin always records without review; the others are chosen by Admin, only from profiles allowed to raise at least one expense type. It skips the Reviewer, never the amount rule: an HR raiser's ₹40,000 expense still waits for an Admin. Such a request is marked *Approved on submit (no review)*. *Avoid*: trusted recorder, direct access, skip list. (Owner, 2026-10-19.)

- **Request form (source format)** — the extra questions a particular expense type asks. Hotel and accommodation ask for the occupant, the property and the rent period; travel asks where and when. Most types ask nothing extra and use the plain form — that is normal, not a gap. Set up in **Packages Settings → Expense Packages**. When a request is approved, its answers are written onto the created Expense in readable form, so the accountant sees them where they already look.

- **Expense** — a cost recorded outside the Purchase Order / Service Request flow. Two kinds: a **Project Expense** (attributed to a specific Project; labelled "Misc Project Expense" in the UI) and a **Non-Project Expense** (company-wide, not tied to any Project). Both share the same three-stage approval lifecycle and are entered and managed together in one **Expense** area.

- **Direct Expense** — an Expense recorded straight from the Add Expense dialogs, with no Expense Request behind it. Its raiser is whoever recorded it, and it names its **Expense payee** the way a request does. *Avoid*: manual expense, new expense. (Owner, 2026-10-16.) **Retired 2026-10-19:** no new ones are recorded; every expense raised in the app now starts as an **Expense Request**. The term still names the older Expenses recorded that way. An Expense with no request behind it now comes only from an import or a PO adjustment.

- **Expense and Payment status** — the single field describing where an Expense or a Project Payment sits in its lifecycle. It advances in one direction: *Requested* → *CEO Pending* → *Approved* → *Reconciliation Pending* → *Paid*, with *Rejected* as the one way out. A record holds exactly one at a time. Not every record meets every step: only a payment above the CEO's threshold waits at *CEO Pending*, and a small Expense is auto-approved straight to *Approved*.
  - **Requested** — entered, awaiting approval; not yet sanctioned and no cash has gone out.
  - **CEO Pending** — approved by the team and waiting for the CEO, who may approve it in full or approve part of it and leave the balance here.
  - **Approved** — sanctioned to spend, but the money has **not** yet left. A staging state, not settled spend.
  - **Reconciliation Pending** — an Accountant has pressed **Mark as Done** (or it is a **Cheque payment**, which arrives here on its own the moment it is approved): the money has gone out of the bank, and the record is now waiting to be matched against the bank line that paid it. An Expense also waits here while the bank lines linked to it so far — its **linked total** — add up to less than its amount, which is how a run that left the bank as many transfers settles one Expense; it becomes *Paid* only once the linked total reaches the amount. Still not settled spend — the money is gone but nothing has proved it yet.
  - **Paid** — the cash has gone out **and** every bank line that paid it has been matched to it — one line for most records, and for an Expense as many as the run took — or somebody marked it reconciled by hand. The **final** state and the **only** one that counts as real spend.
  - **Rejected** — refused. It counts toward nothing, and re-approving it from here withholds Work Order tax as a first approval does.

- **Mark as Done** — the Accountant's action that moves a record from *Approved* to *Reconciliation Pending*, meaning "the money has left the bank". It is the step that makes a record visible to Bulk Import: from 2026-09-16 the import settles a record only from *Reconciliation Pending*, never from *Approved*. A record still sitting at *Approved* cannot be matched to a bank line, and the import says so by name — "mark it as done first" — rather than refusing without explanation. *Avoid*: marking it paid, settling it. (2026-09-16, #1289.)

- **Mode of Payment** — how a Project Payment is paid: **Online** or **Cheque**. Chosen when a PO payment is requested; a Work Order payment is always Online. From 2026-10-20 a payment is Cheque only when it is requested that way on its PO; an Online payment is never moved onto a Cheque. A Cheque payment whose Cheque is *Cancelled* is *Rejected* with it, not switched back to Online (owner, 2026-10-16). A payment whose mode is Cheque always has a Cheque linked. Every payment raised before 2026-09-19 is Online. *Avoid*: payment type (that is the PO payment term's own field — Advance, Credit, …). (Owner, 2026-10-13.)

- **Cheque payment** — a PO's Project Payment requested with a cheque's number and date; from 2026-10-16 a Work Order is never paid by cheque (one already on a cheque finishes as it is). The cheque is already written, so there is nothing for an Accountant to pay: it is approved like an online payment, passing **through** *Approved*, and is then moved straight to *Reconciliation Pending* without a **Mark as Done**. It draws on exactly one **Payment cheque**, through one of that Cheque's lines. From 2026-10-20 a new Cheque carries exactly one payment, made with it on the PO page; an older Cheque may carry several. The payments on one Cheque are approved together or rejected together, never one without the others, and the **Cheque's total** decides which approvals they need. It is approved in full or rejected, never part-approved or re-amounted. It is never put on hold and never reverted to *Approved*: cancelling its Cheque is the way back. It is cleared by reconciling against the cheque number — no bank receipt is needed. It becomes *Paid* only when its Cheque is cleared by an imported bank-statement line, together with every other payment on that Cheque; it is never paid on its own, by a match made by hand or by editing the payment, and a *Paid* one is never set back. This holds for the payments on an **Old-type cheque** too. (Owner, 2026-09-19; approved as one Cheque, PO only, 2026-10-16; one payment per new Cheque 2026-10-20; paid only with its Cheque 2026-10-23.)

- **Cheque** — one paper cheque the company writes, recorded on its own with a photo of it. It is identified by the name of the bank it is drawn on together with its cheque number (the first six digits of the magnetic strip at its foot); no two cheques share both. It is made out to one payee: a **Payee**, or a name typed in when whoever is paid has no Payee (no bank account on record). Every Cheque is of one **Cheque type**: a **Payment cheque** or a **Security Deposit cheque**. Each change of its status records who made it. A Cheque never pays an Expense. *Avoid*: cheque document, cheque payment (that is the Project Payment that draws on it). (Owner, 2026-10-12; revised 2026-10-13; payee made a Payee 2026-10-14; types and Pending 2026-10-16.)

- **Payment cheque** — a **Cheque** the bank will cash, paying one or more **Cheque payments** listed as its **Cheque lines**. It is drawn on ICICI Bank, the only bank whose statement can clear it. It is **Approval Pending** while its payments wait for approval, **Issued** once they are approved, **Cleared** once the bank has paid it, and **Cancelled** when it is torn up, stopped or bounced. It needs no approval of its own: it is approved, or rejected, through its payments, all of them together. Its lines change only while it is Approval Pending, and its payments can be approved only once every line names its payment. Cancelling it rejects every payment on it. A cheque with a line already *Paid* cannot be cancelled: the money has left the bank. It becomes Cleared, and its payments *Paid*, only when a bank-statement line with its cheque number and amount is imported; nobody clears a cheque by hand. The import clears it whatever its status was: payments still waiting are approved by the import, and payments rejected with a Cancelled cheque become *Paid*, the cheque's history saying it was cancelled but the bank paid it. Every line on it is paid in full. A cheque recorded before 2026-10-16 that pays Expenses, has no lines or is made out to a typed name is an **Old-type cheque**: it is drawn on ICICI Bank like any other, it is kept as it is, is cleared by the import like any other and may still be cancelled by hand, but no new one like it is made. *Avoid*: Pending (say Approval Pending), cheque payment (that is the Project Payment), encashable cheque. (Owner, 2026-10-16; Approval Pending and import-only clearing 2026-10-20; no cancel once a line is Paid 2026-10-22.)

- **Security Deposit cheque** — a **Cheque** handed over as a guarantee, which nobody expects the bank to cash. It is made out to a Vendor or a typed name, pays no Project Payment, and may name the POs it secures; it never secures a Work Order. It is **Issued** from the moment it is recorded, on the issue date typed for it, and **Cancelled** when it comes back or is torn up, with a note saying why. Bank-statement lines are never matched to it. *Avoid*: security cheque, SD cheque, guarantee cheque. (Owner, 2026-10-16; Work Orders dropped 2026-10-20.)

- **Issue date** — the day a **Cheque** became *Issued*: for a **Payment cheque**, the day its payments reached *Approved*; for a **Security Deposit cheque**, the day it was handed over. *Avoid*: approval date (that is the payment's own). (Owner, 2026-10-16.)

- **Cheque/Payment date** — one date on a **Cheque** that changes meaning once. Until the cheque is *Cleared* it is the date written on the paper, which may be later than the day the cheque was handed over. When a bank-statement line clears a **Payment cheque**, it becomes the day the bank paid it, and the paper date is not kept on the Cheque. That day is also the payment date of every payment on it. A **Security Deposit cheque** is never cleared, so its date is always the paper date. It is not the **Issue date**. *Avoid*: cheque date, clearance date (two names for what is now one date). (Owner, 2026-10-20.)

- **Cheque line** — one thing a **Cheque** pays, and the amount it pays for it: a **PO** of the cheque's Vendor, in a project, with the Project Payment drawn for it if there is one yet. Work Order payments and Expenses are never on a Cheque. A Cheque's lines may span projects. A payment sits on at most one Cheque that is not *Cancelled*. *Avoid*: cheque item, allocation. (Owner, 2026-10-13; expense lines dropped 2026-10-16.)

- **Ad-hoc cheque** — a **Cheque** with no lines, recorded with a description of what it pays for (rent, a deposit, …). *Avoid*: manual cheque, other cheque. (Owner, 2026-10-13.)

- **Raiser's own step** — an approval step the person raising a payment or expense already holds is not asked of them again. An **L1 approver** (the Admin profile, or `Administrator`) raising one between ₹15,000 and ₹50,000 lands it at *Approved*; above ₹50,000 it lands at *CEO Pending* with L1 already done. The **CEO** raising one lands it at *Approved* at any amount. Everyone else follows the plain amount rule. For an Expense the raiser is whoever raised its **Expense Request**, never the reviewer who approved that request. But when an L1 approver is that **Reviewer**, the review itself is the L1 step, so the Expense lands as it would for an L1 raiser; an HR or Accounts review is not. Accountants are not L1 for this rule. (Reviewer as L1: owner, 2026-10-19.) Applies to PO payments, Work Order payments, Project Expenses and Non-Project Expenses. (Owner, 2026-09-21.)

- **Revert to Approved** — sending a Project Payment at *Reconciliation Pending* back to *Approved*, meaning "it was marked done by mistake". From *Approved* it can be marked done again or deleted. It is refused while a bank line is matched to the payment. Admin, Accountant and Accountant Lead only. (Owner, 2026-09-21.)

- **Editing a record by status** — a PO or Work Order payment cannot be edited in the app at any status; the only correction is *Revert to Approved*. An Expense, once raised, is edited only by Accountant or Accountant Lead, never once *Rejected*; once *Paid*, only Admin and Accountant Lead may change it, and only its description, comment, invoice, project, vendor and type, never its payment details. **For Expenses the server enforces this** on every save, Desk included; its status changes only through the decision call (Owner, 2026-10-20, spec #1494 story 50). For PO and Work Order payments these remain **screen rules only**, with two server locks. A payment whose tax is in a TDS challan can't be deleted, rejected or have its amount changed anywhere, Desk included, and its tax record is locked too; the refusal names the challan. A **Cheque payment**'s status moves into or out of *Paid* only by its Cheque clearing, and a payment in Cheque mode always has its Cheque, except an older one already *Paid* or *Rejected* (Owner, 2026-10-23, ADR-0035 Amendment B). Otherwise a correction can still be made in Desk, and editing a *Paid* payment's amount there recounts its order. A tax record's figures may be corrected in Desk until its tax is in a challan, and each correction recounts the order; its challan and status are set only by Pay TDS. (Owner, 2026-09-21; the challan lock 2026-10-21, #1535.)

- **Payment reference** — what finds a payment, expense, inflow or refund again in the bank's records. A record made or settled from an imported line takes it from that line: a bank-statement line gives its **whole narration** (with the cheque number added on a cheque line), a payout gateway gives its bank reference, and a petty-cash wallet gives its transaction id. Bulk Import shows the reference it will save before anything is saved. *Avoid*: UTR, which names only one kind of reference. (Owner, 2026-10-15.)

- **Settled spend (outflow)** — expense money that has actually left, i.e. an Expense at status *Paid*. **Only** *Paid* Expenses are included in any financial rollup — project outflow, the cashflow gap / CEO-Hold, project Financials totals, the Outflow reports, and the 30-day payment dashboard. *Requested* and *Approved* Expenses are commitments, not settled spend, and are excluded from every such number.
- **Project outflow** — the money that has left for a project: every *Paid* Project Payment on the project, whatever state its order is in now, less the project's *Received* Vendor Refunds, plus its *Paid* Expenses, **plus the TDS on its Paid Work Order payments and the tax recorded on its Paid PO payments** — both the tax withheld from the vendor and the tax the company paid on top — counted on the payment's own date, not the challan's (a challan covers many projects). It counts **cash**, not orders, so money paid against an order later made Inactive or Merged still counts. One figure, used by the project's Financials, the cashflow gap / CEO-Hold and every report that totals a project's outflow. A list of bank cash-outs (the Outflow report, the WO Payment Voucher report) lists payments only and is not this figure; with one project selected, the Outflow report's note walks its list to it (list − refunds + TDS). **It is the only figure a screen calls "outflow"**: every other money-out figure is named for what it counts (*Payments + Paid Expenses*, *Cash Out (30 Days)*, *Paid on Active POs*, …). (Owner, 2026-10-15; TDS added 2026-10-19; PO tax 2026-10-21; the only "outflow" 2026-10-22.)
  *Avoid*: total paid, spend (for this figure); "outflow" for any other figure.

- **Auto-approval (of a small Expense)** — a positive Expense of less than ₹15,000 is created directly at *Approved*, skipping *Requested*. It is an **approval shortcut only** — it makes no claim that the money has been paid, so an auto-approved Expense is still not counted as settled spend until it is separately marked *Paid*. A refund (non-positive amount) or an amount of ₹15,000 or more follows the full *Requested → Approved → Paid* path. (2026-09-04: threshold raised from ₹5,000 to ₹10,000, inclusive. 2026-09-15: raised to ₹15,000 and made exclusive — exactly ₹15,000 needs approval — matching every payment and expense's amount tiers.)

- **TDS withheld (on an Office Rent expense)** — rent tax (section 194-I) kept back from the landlord: always **10%** of an **Office Rent** Expense, whatever its size, and no other expense type. The raiser enters the full rent and is shown, before submitting, what the tax will be and what the landlord gets. The tax is withheld **once, when the Expense is approved from an earlier step**, exactly as for a *Work Order payment* (see *TDS withheld (on a Work Order payment)*), so the approvals it needs are decided on the full rent. From then on the Expense's amount is the **net** — what leaves the bank — and the full rent survives only on the tax record; that amount can no longer be changed (except by the few rupees a bank line corrects it by, which leaves the tax as it was), the Expense cannot be deleted once its tax is paid under a challan, and tax withheld is never removed, not even by a rejection. The approvers are shown the rent, the tax and the net. The tax is **not** spend while it is withheld: it counts only once it is paid to the government, as an Expense of its own, so no total counts it twice. That tax is paid to the department under the same challans as Work Order tax, each record naming its section. The raiser names the month and year the rent is for, the office, the landlord and the landlord's PAN, which become part of the Expense's description, and picks the landlord's bank account as who gets paid; the landlord is not a record of its own. An Office Rent Expense without the landlord's name and PAN is not approved until they are given, so no tax is withheld that cannot be filed; and once an Expense is approved, its type cannot be changed to or from Office Rent. Office Rent Expenses approved before this existed carry no tax. *Avoid*: rent deduction, TDS on rent payment. (Owner, 2026-10-20.)

## Inflows

- **Project Inflow** — money received from a customer against a specific Project, optionally against one of that Project's invoices. It counts the moment it is recorded; there is no approval step.

- **Non-Project Inflow** — money the company receives that belongs to no Project and no customer. Like a Project Inflow it counts the moment it is recorded (no approval step), and it is never netted against spend. (2026-09-14: introduced; replaces the negative Non-Project Expense "receipt" as the way a bank-statement credit with no project is recorded.)
  *Avoid*: receipt, negative expense.

- **Inflow Type** — the kind of a Non-Project Inflow, exactly one of:
  - **Interest Payout** — interest paid to the company (e.g. on a deposit).
  - **FD Closure** — proceeds of a fixed deposit that was closed.
  - **Loan Received** — a loan disbursed to the company.
  - **Others** — anything else; a description saying what it is is then required.
  A vendor refund is **not** a Non-Project Inflow; it is a *Vendor Refund* (below).

- **Vendor Refund** — money a Vendor sends back to the company against one of its own orders (a Purchase Order, a Work Order, or a Misc. Expense). It lowers that order's paid amount, and it is never an Inflow. It is the **only** record of that money: a PO Adjustment settles part of its balance by pointing at a Vendor Refund, never by recording the money again as a negative payment. A Vendor Refund may exceed the order's current overpayment, because the money can arrive before the revision that explains it. It is *Reconciliation Pending* when it is recorded before its bank line is matched (the vendor says it sent the money), and *Received* once a bank credit line is matched to it; one recorded straight from a bank line starts at *Received*. **Only a Received refund counts**: a Reconciliation Pending one lowers no paid amount and clears no adjustment balance, but it holds back that much of the order's overpaid credit so nothing else spends it. A Reconciliation Pending refund that will never match ends either *Cancelled* (it counts for nothing and holds nothing) or, by an Admin with a stated reason, *Received* with no bank line (it counts, and its bank line may still be matched to it later). A *Cancelled* refund that no bank line was ever matched to may be deleted by an Admin or Procurement; its number is never given to another refund. (2026-09-17: introduced; replaces recording a refund as a Non-Project Inflow of type *Others*. 2026-10-09: made the only record of refunded money. 2026-10-13: a Cancelled refund may be deleted.)
  *Avoid*: refund inflow, negative payment (for a refund), RA Vendor.

- **Transaction direction (of an imported bank row)** — *Inflow* is money received (a bank credit); *Outflow* is money paid (a debit). A row whose source states no direction counts as Outflow. The import screen's own facet labels the same two values *Received* / *Paid*.

- **Total Unreconciled Outflow** — how much bank money has been paid out and still needs reconciling: every imported bank line whose direction is *Outflow* and which still owes somebody a decision, across every import, every source and all time. Shown on the Payments summary card with the number of lines. It excludes lines already settled, lines skipped, and transfers the bank refused, because none of those is outstanding work. It is the same figure Bulk Import shows as *Still open* under *Paid out* with no filters, and the two are never allowed to disagree. It is **not** a 30-day figure and is never added to the 30-day outflow beside it. (2026-09-16.)
  *Avoid*: unmatched outflow, open outflow, unreconciled payments.

- **Already imported (a bank statement line)** — a line of an uploaded statement that the system already holds, from an earlier import or from earlier in the same file: the same transfer with the same bank status, whatever that status is (a line still in flight included). It is **not saved**; the import keeps only a count of how many such lines it left out, and a file holding nothing else is refused. A line that repeats an earlier one with a **different** bank status (e.g. SUCCESS, later REVERSED) is not an exact repeat: it is saved as a skipped line whose reason names both statuses. A line still in flight (e.g. QUEUED) is never the earlier line of such a status change: its later SUCCESS is new work. (2026-10-01, [ADR-0031](docs/adr/0031-already-imported-lines-are-not-saved.md); any status added by Amendment B.)
  *Avoid*: duplicate row, skipped duplicate — an exact repeat is never a row.

- **Already recorded (an imported bank line)** — a line whose money a record already holds, found by that record's *payment reference* appearing in the line within 15 days of it. When the amounts agree within ₹5 the line is a **duplicate**: it is skipped, and nothing can be created or linked from it. When they disagree by more, the money may have been **recorded differently** — one record covering several bank lines, or a mistyped amount — so recording the line asks for confirmation first. A record that another bank line already accounts for is never *recorded differently* for this one: that line explains it whole. A bank branch code (IFSC) inside a reference never identifies the money — thousands of unrelated payers share one. (2026-10-15.)
  *Avoid*: duplicate, for a record whose amount disagrees — that is *recorded differently*, which a person must judge.

- **Statement month (of an imported statement)** — a calendar month that the statement's declared period overlaps; a statement whose period spans two months belongs to both. A statement with no declared period belongs to the month it was uploaded. It is **not** the Bulk Import screen's *Period*, which is when the money on a line moved. (2026-10-14.)
  *Avoid*: period, upload month.

- **Skipped by hand (an imported bank line)** — a line an Admin or Accountant Lead set aside because it has nothing to link, with a typed reason; the Skipped list shows who and when. Every other skipped line is a **system skip** — money already recorded, a transfer the bank refused, a bank-statement exclusion rule, or a repeat of an earlier statement whose bank status has since changed (an exact repeat is not saved at all — see *Already imported*) — so the same money is never recorded twice. Whether a skipped line can later be brought back is decided by its **skip kind** — the reason it was skipped, shown as Skip Type — and not by who skipped it: a hand skip can come back, and so can a line skipped as already recorded or by a bank-statement rule; a line already imported, repeated in the same file, carrying no amount, or refused by the bank never can, and nor can any Cashbook line. (2026-09-15, [ADR-0022](docs/adr/0022-unreconcile-and-unskip.md); what can be brought back amended 2026-09-17 by [Amendment C](docs/adr/0022-unreconcile-and-unskip.md).)
  *Avoid*: manual skip for a system skip a person merely confirmed.

- **Bounced transfer (an imported bank line)** — money that left the bank and was sent back, so the statement shows the same money twice: the transfer going out, and the transfer coming back. The out line is **skipped by hand** with the reason "bounced"; the line coming back is a **system skip** under the bank rule *Failed payment bounced back*. Neither line is linked to any record, and no record's amount is raised to cover it — the money never stayed out, so nothing was spent. Different from a transfer **the bank refused** outright, which never left the account and so appears only once. (2026-09-18, [ADR-0027](docs/adr/0027-many-lines-one-expense.md).)
  *Avoid*: calling the pair a refused transfer — the bank refused nothing; the money left and came back.

- **Unreconcile (an imported bank line)** — undoing a match on a settled bank line, with a typed reason, one record at a time or all at once (**Reverse all**, which changes nothing unless every record can be undone). Each record says first what will happen to it; a Project Payment goes back to *Reconciliation Pending* with its UTR and payment date cleared, and an existing Project Expense or Non-Project Expense goes back to *Reconciliation Pending* with its payment date, reference and "paid by" cleared — the status a bank line settles FROM, so the record can be matched to the right line without anyone pressing Mark as Done a second time; either is then free to match another line. A record the import itself created (a Project Inflow, a Non-Project Inflow, or a new expense) is deleted instead — unless someone edited it after the import made it — and a bank credit whose inflow was deleted can be recorded again. A **part payment** is joined back together — the leftover payment is deleted, the payment gets its full amount back and the PO's two payment terms become one — but only while the leftover is untouched; a leftover already paid by another transfer must have that transfer unreconciled first. The match record is kept, marked Reversed. A Reversed match record is history only: it never stops anyone deleting the record it names, which may then name a record that no longer exists. A live one always does, for everyone — the line must be unreconciled first, and the refusal names that line (owner, 2026-10-16). The line keeps its previous suggestion but is marked **Confirm by hand**: "Confirm all matched" leaves it out and refuses it, until a person settles it from the line itself. Unreconciling a Work Order payment **never changes its amount and never withholds tax** — see *TDS withheld*. Cashbook lines cannot be unreconciled yet. (2026-09-15, [ADR-0022](docs/adr/0022-unreconcile-and-unskip.md); the revert target amended 2026-09-16 by [Amendment B](docs/adr/0022-unreconcile-and-unskip.md).)

- **TDS withheld (on a Work Order payment)** — tax deducted at source, kept back from what a vendor is paid on a Work Order and later paid to the tax department under a challan. It is withheld **once, when the payment is approved from an earlier step**: when it is approved from *Requested*, *CEO Pending* or *Rejected*, or when it is created already *Approved*. A payment that comes back to *Approved* from *Reconciliation Pending* or *Paid* is **not** withheld from again, because that is an undo, not a decision to pay. Undoing a reconciliation no longer enters *Approved* at all — since 2026-09-16 it lands at *Reconciliation Pending* — so it is doubly clear of this rule; the *Approved* cases above are kept for every other way a payment can step back. The amount stored on the payment is the **net** figure, what actually leaves the bank; the original gross survives only on the tax record. None of these steps back removes tax already withheld. **Rejecting** a payment removes its tax record and puts its amount back to the full bill, so no tax is held for money that didn't go out; a payment whose tax is already in a TDS challan can't be rejected (2026-10-21, #1535). Tax is deposited under a challan (Pay TDS) only for *Paid* payments. A payment the CEO part-approves is the one deliberate exception: each part is taxed at its own approval, so such a payment can carry one tax record per part. A leftover created by splitting a payment in Bulk Import carries none — the tax stays withheld once, on the original. (2026-09-16, [ADR-0022 Amendment A](docs/adr/0022-unreconcile-and-unskip.md).)
- **TDS paid by company (Admin action)** — marks the tax on one Work Order payment, recorded as withheld from the vendor, as paid by the company on top instead. No amount changes: the payment still says what the vendor got, and the tax record keeps its figures. The tax then leaves the Work Order's *Amount Paid* (it was never the vendor's) and stays in its Total TDS and in *Project outflow*, so a Work Order whose vendor was paid the full bill reads its true Amount Due. Allowed before the payment is *Paid*, and after while its tax is not in a TDS challan; recorded with who did it and when. A payment whose tax was withheld can't have its amount raised; the refusal points here. (2026-10-22, #1537.)
  ⚠️ **Not the Technical Data Sheet**, which the same three letters name elsewhere in this system.
  *Avoid*: tax deducted again, re-deduction, TDS on Approved.

- **Unskip (an imported bank line)** — bringing a skipped line back, with a typed reason; which lines may come back is decided by the **skip kind** (see *Skipped by hand*). The line goes back to matching and is checked again straight away: it may come back needing a record, matched to a record, or skipped again because its money has since been recorded. A line a bank-statement rule skipped gets no such re-check — those rules are applied when the statement is read in — so it comes back as open work, and the dialog warns that the line was read as money moving between our own accounts. (2026-09-15, [ADR-0022](docs/adr/0022-unreconcile-and-unskip.md); amended 2026-09-17 by [Amendment C](docs/adr/0022-unreconcile-and-unskip.md).)

## Porter deliveries

- **Porter Statement** — Porter's monthly export of every delivery booked on the company's Porter account, one line per order, each line naming the Porter Invoice that bills it. It is the record of what the Porter wallet actually spent: the bank only shows money moving *into* that wallet (a *Porter wallet top-up*, never a spend). Imported once a month; nothing from it is recorded unless every Porter Invoice it names agrees with it. (Owner, 2026-10-15.)
  *Avoid*: Porter payout report, Porter wallet statement.

- **Porter Invoice** — one tax invoice Porter issues for a month's completed orders in one city under one of its billing entities; a Porter Statement normally names several. Its total is the **Porter fare** of its completed orders only. (Owner, 2026-10-15.) It *agrees* with the Porter Statement when its PDF's Porter fare matches (within ₹1) and its invoice date falls between the statement's first order and seven days after its last; a GSTIN, tax or invoice-number difference does not stop it agreeing, and is shown only as a warning, since the GST is taken from the statement. (Spec #1554, 2026-10-25.)
  *Avoid*: consolidated note (Porter's own file name for it).

- **Porter Order** — one delivery booked on Porter, identified by its CRN, belonging to exactly one Porter Invoice. A completed Porter Order is recorded as exactly **one** Expense — a Project Expense when it can be attributed to a project, otherwise a Non-Project Expense — and the Porter Order keeps the delivery's details (addresses, who booked it, its fare and tax). A Porter Order is **not** itself an Expense. (Owner, 2026-10-15.)
  *Avoid*: Porter Expense, Porter transaction, trip.

- **Cancelled Porter order** — a line on a Porter Statement whose order did not complete. Porter does not bill it, so it counts toward no Porter Invoice and becomes no Expense; the import keeps it only as a skipped line. (Owner, 2026-10-15.)

- **Porter fare** — what Porter charges for an order, before GST; it is the amount the Porter wallet pays and therefore the **amount of the Expense**. Porter's GST is charged under **reverse charge**: the company, not Porter, pays it to the government, so it is never part of what Porter is paid and never part of the Expense's amount. It is kept on the Porter Order as the order's *reverse-charge GST*. (Owner, 2026-10-15.)
  *Avoid*: amount incl. GST, invoice amount (for the fare alone, which is ambiguous).

- **Not a project (a Porter Order)** — a person's deliberate choice, made while choosing projects for a Porter import, that a completed Porter Order belongs to no project, so it becomes a Non-Project Expense. It is recorded like any other choice a person makes there. A Porter Order becomes a Non-Project Expense only because a person chose Not a project for it, or because an earlier import taught a sure (Strong) Non-Project placement for the same remark and city; an order the system could not place is never made Non-Project by default, and Create waits until someone chooses. (Owner, 2026-10-25, spec #1554.)
  *Avoid*: blank project, no project found (that is the system's doubt, not a choice).

- **Rectify (an imported Porter order)** — moving a completed Porter Order's Expense to where it belongs after the import: from Non-Project to a project, from one project to another, or from a project to Non-Project. It **replaces** the Expense with one identical in money, date, reference and invoice, and the import's record of the old placement is kept as reversed, with the typed reason. The Porter Order itself never changes. Offered wherever an imported line can be unreconciled, to the same people. On screen it reads "Move to another project"; the domain term stays Rectify. (Owner, 2026-10-15; screen label #1558.)
  *Avoid*: unreconcile (which takes the Expense away and leaves the line open), re-import, edit project.

## Company credit cards

- **Credit Card Statement** — the bank's monthly statement for one company credit card, listing every spend and every credit on that card in its billing period. It is the record of what the card spent: the bank statement only shows the card's bill being paid, never what the card bought. A Credit Card Statement is known by its **card holder** and its billing period; the company receives one per card per month, and each card has one holder. Only a statement issued to the company (Stratos Infra Technologies) is a company card's statement. (Owner, 2026-10-25.)
  *Avoid*: card bill, CC statement.

- **Card spend** — a line of a Credit Card Statement that is money the card paid out (a line not marked CR). Each one is recorded as exactly one *Paid* **Non-Project** Expense (a card never pays for a project's work), with no vendor, and then waits for its invoice. (Owner, 2026-10-25.)

- **Card payment (a statement credit)** — money paid *into* the card to settle its bill (auto-debit, UPI or any other payment received), or a cashback. It is not a spend and not a refund, so it is skipped by rule, with its reason shown. (Owner, 2026-10-25.)

- **Paired card refund** — a credit from a merchant on the same Credit Card Statement as a spend from that same merchant of exactly the same amount. Both lines are skipped, each naming the other: the money came back, so nothing was spent. One credit cancels one spend, the latest one before it. (Owner, 2026-10-25.)

- **Unpaired card credit** — a merchant credit with no spend of the same amount on the same statement (a partial refund, or a refund of an earlier month). It is never skipped silently: it is kept as an open line for someone to decide. (Owner, 2026-10-25.)

## Vendor invoices & credit notes

- **Vendor Invoice** — a recorded vendor bill entered against a Purchase Order or a Work Order (Service Request). Distinct from a *Project Invoice*, which bills the Customer.

- **Invoice amounts (base, GST, total)** — every Vendor Invoice carries three figures: the **Invoice Base Amount** (the taxable value before GST), the **Invoice GST Amount** (all GST on the bill), and the **Invoice Amount** (the grand total incl. GST, which is what *Total Amount Invoiced* sums). All three are read from the bill by extraction and confirmed by the user, on Purchase Order and Work Order invoices alike. Base + GST need not equal the total exactly — round-off, other charges and TCS sit in the gap. The GST is IGST, or CGST + SGST, or a plain Tax line — exactly one of the three on any bill. *Avoid*: net amount, taxable amount, invoice value.

- **Vendor Invoice status** — the single field for where a Vendor Invoice sits: *Pending* → *Approved* or *Rejected*. A new invoice starts *Pending* and holds exactly one status at a time. *Rejected* never counts toward anything. **"Counts toward the invoiced total" is not one rule** — three different totals coexist, deliberately; see *Total Amount Invoiced* below before using either word.

- **Total Amount Invoiced** (`amount_invoiced`, stored on Procurement Orders and Service Requests) — the money a vendor has **billed and we have accepted**: `SUM(Vendor Invoices.invoice_amount WHERE status = 'Approved')`. *Approved only* — a *Pending* bill is not yet a liability of this kind. Credit notes are **included**, because they are stored negative and net off in the sum. It is a derived cache, recomputed from source by the Vendor Invoices doc events, never incremented by a delta. Do **not** confuse it with the two neighbouring totals that answer different questions: the invoice-approval tables total *Pending + Approved* (the two disagree on real data), and `invoice_qty` counts *Pending + Approved* **quantities** with credit notes **excluded**. Harmonising them is a bug, not a cleanup.

- **Amount Paid** (`amount_paid`, stored on Purchase Orders and Work Orders) — the money that has really reached the vendor for one order: its *Paid* Project Payments less its *Received* Vendor Refunds. A payment at *Reconciliation Pending* does not count yet, for the same reason a waiting refund does not: there is no bank proof. On a Work Order it is **what has been settled against the order**: what the vendor got **plus the TDS withheld from the vendor** on those payments, because that tax was the vendor's money, paid to the tax office for them. Tax the company pays **on top** (a Miscellaneous / Transportation Work Order) is **not** part of it: the vendor was never owed it, and it is shown beside Amount Paid instead (owner, 2026-10-19, reversing the 2026-10-15 "TDS is not part of it" ruling). A PO counts the same way: the vendor's tax recorded on its Paid payments is part of its Amount Paid, though no PO payment ever has tax withheld; the only PO tax records are on 86 old payments, which a one-time patch cut to what the vendor got. A PO payment still at the full bill with its old "tds" box filled in holds its tax inside its amount, and nothing is added on top (owner, 2026-10-21, [ADR-0034](docs/adr/0034-stored-amount-paid-is-the-one-paid-figure.md) Amendment B). What the vendor alone got is **Paid to vendor**. It is **the** paid figure of an order: every screen, report and total that shows what an order (or a set of orders) has been paid reads it, and none adds up payments again. It is a derived cache, recounted from source by every payment and refund change, never typed in by hand, and checked against its source by the *Amount Paid Mismatch* report ([ADR-0034](docs/adr/0034-stored-amount-paid-is-the-one-paid-figure.md)). (Owner, 2026-10-15.)
  *Avoid*: total paid (for anything else), amount paid till now, gross paid.

- **Paid to vendor (on a Work Order)** — the part of a Work Order's *Amount Paid* that reached the vendor's bank: Amount Paid less the TDS withheld from the vendor. Shown only as a breakdown of Amount Paid, never as a paid figure on its own. *Avoid*: net paid, amount paid (for this).

- **Amount Due** (`amount_due`, stored on both doctypes) — what is owed on an order, and **the formula differs by doctype on purpose**: a Purchase Order uses `amount_invoiced − amount_paid` ("billed to us and not yet paid"); a Work Order uses `total_amount − amount_paid` ("ordered value not yet settled"; the TDS withheld from the vendor is already inside Amount Paid, so it is not owed again), which is what WO screens have always shown and what their print footnote states (owner, 2026-10-19; before that the tax was taken off separately because Amount Paid left it out). Moving Work Orders onto the PO formula would change most rows. It may go **negative** when an order is overpaid. The split lives in one constant so neither side can drift.

- **Current Liabilities** — a **third, separate** figure: `max(0, po_amount_delivered − amount_paid)`, per PO before summing. Based on what physically **arrived**, not what was billed, and clamped at zero so an overpayment never reads as a negative liability. It is *not* Amount Due and the two disagree on roughly half of all POs. It feeds the CEO-Hold cashflow gap. **Merged, Cancelled and Inactive POs are left out**: what they delivered is counted on the PO that replaced them (owner, 2026-10-15).

- **Approved invoice** — a Vendor Invoice at status *Approved*: treated as financially committed (it counts toward the invoiced total and drives billing status). Editing or deleting one is restricted to an *Admin* — the rationale and the (deliberately uneven) enforcement live in [ADR-0014](docs/adr/0014-invoice-mutation-permissions.md). On a **Work Order** the server enforces all of it (ADR-0014 Amendment A): only the invoice-approval roles approve or reject, only Accountants and Admin edit, and only Admin changes an Approved one's amount, number or date; anyone else rejects it and uploads it again.

- **Credit Note** — a **Purchase-Order-only** Vendor Invoice variant recording a vendor credit: its amount is stored negative and it is excluded from the PO's invoiced quantity. Work Orders (Service Requests) have no credit notes.

- **Generated invoice** — on a *GST-off Work Order*, the invoice the company drafts for the vendor to sign, because a vendor without a GST number cannot issue a tax invoice. It is saved as its own record (a **WO Generated Invoice**: *RA number*, type **RA** or **FINAL**, amount, invoice date, invoice number, status) and printed from that record, titled "Invoice". Its life: *Generated* → *Signed* (the vendor's signed copy is uploaded, which creates a *Pending* Vendor Invoice) → *Approved* (that Vendor Invoice is approved); it is *Voided* by hand before upload, with a reason, or when its Vendor Invoice is rejected. It is never edited: a wrong one is voided and a new one generated. Its amount may not pass the smaller of the Work Order's amount and its *Amount Paid* (incl. TDS), less what is already billed or waiting: Approved and Pending Vendor Invoices, and generated invoices not yet uploaded. A **FINAL** bills what is left, only once the Work Order is fully paid, at most one per Work Order; nothing is generated after it. Generate is offered only on a Work Order whose GST flag is off, and only to Admin, PMO, Procurement and Project Leads. (#1546, spec #1528.) *Avoid*: tax invoice (for this), SR invoice.

- **RA number** — the running number of a Work Order's *generated invoices*: 1, 2, 3, … per Work Order, assigned by the system, never typed and never reused (a voided invoice keeps its number), and not restarted by a new financial year. A FINAL takes the next number too, but prints "FINAL" instead of "RA-n". On an older Work Order the first one starts after the highest "RA-n" already written on its saved invoice number or its Vendor Invoices. "RA" is a running-account bill. *Avoid*: RA No. (typed), bill number.

- **Admin (Nirmaan)** — the elevated actor these financial-mutation rules gate on: the *Administrator* user or a holder of the *Nirmaan Admin Profile*. Deliberately narrower than the broader "privileged" role sets (e.g. PMO Executive, Accountant Lead) used on read/visibility surfaces.

## Work Order lifecycle

- **Finalized (Work Order)** — an *Approved* Work Order whose scope is closed: a flag on it, not a status. While finalized it cannot be amended or deleted, and its items, total, vendor, *GST flag* and terms cannot change, on the screen, in Desk or through the API, for anyone, Admin included. The one GST change allowed is *Match GST to vendor*. Payments, invoices, remarks, the Nirmaan GST, the PDF and *Generate invoice* stay open. It is set by **Finalize** and cleared only by **Revert Finalization**, each recorded as an undeletable remark; the flag cannot be ticked or unticked by hand. The Work Order page shows a banner naming what is locked, and the server refuses a locked change with the same words. *Avoid*: closed, locked, completed. (Spec #1528, #1539.)

- **Amendment (of a Work Order)** — a change to an *Approved* Work Order's items, vendor, categories or Nirmaan GST, typed with a reason in the Amend sheet, that waits for Admin or a Project Lead to **accept** it or **revert** it. Amend can't start while any payment on the Work Order is neither *Paid* nor *Rejected*; the refusal lists those payments. An amendment may not bring the total below *Amount Paid* or below the approved invoices, may not change the vendor once the Work Order has a payment that is not *Rejected* or an invoice (a Vendor Invoice not *Rejected*, or a generated invoice not *Voided*), and may not swap in a vendor on *GST Hold* (a held vendor's own Work Orders may still be amended). While it waits the Work Order is **under amendment**: it stays in All WO and the project's Work Order table with an "Under amendment" badge, and no payment can be requested on it. The approver sees the Amend sheet's reason. Accepting one that changed the vendor sets the *GST flag* from the new vendor. Reverting writes back the items, vendor, categories and Nirmaan GST from before. Each amendment's snapshot is kept and marked *Accepted* or *Reverted*. All of it is checked on the server, so Desk and the API meet the same rules. *Avoid*: revision (that is a PO's), edit, change request. (Spec #1528, #1540.)

## Work-order GST

- **GST flag (of a Work Order)** — whether a Work Order (Service Request) was raised with GST *on* or *off*. With GST on, the Work Order's total already includes 18% GST; with GST off, its total is the bare value with no GST in it. The UI labels it "Incl. GST" (Yes / No). **It follows the vendor:** on exactly when the vendor has a GST number. The server sets it at approval and when an accepted amendment changes the vendor; no one can switch it by hand, on the screen or in Desk. An existing Work Order never changes by itself: the one other way it moves is *Match GST to vendor*. It cannot be turned **off** while the Work Order's vendor has a GST number (owner, 2026-10-20), nor while the Work Order has a *GST payment* that is not deleted. ([ADR-0028 Amendment A](docs/adr/0028-gst-hold.md).)

- **GST-off Work Order** — a Work Order whose *GST flag* is off (`gst = "false"`, labelled "GST Applicable" off on the approved WO page). A new Work Order starts GST-on; approval sets it from the vendor's GST number — off when the vendor has none. An older one can be GST-off although its vendor has a GST number (an approval bug left 46 so, and a vendor may register later); those are on the GST mismatch list for *Match GST to vendor*.

- **Match GST to vendor** — the Admin and Accountant action that sets one Approved Work Order's *GST flag* from its vendor's GST number, Finalized ones included. It only ever moves the flag towards the vendor, shows the new total and Amount Due before it is confirmed, is refused while turning GST off would orphan a *GST payment*, and is recorded as an undeletable remark on the Work Order. The Work Orders it is for are listed under All WO → *GST mismatch*: every Approved Work Order whose flag disagrees with its vendor, both directions. *Avoid*: GST switch, GST toggle. ([ADR-0028 Amendment A](docs/adr/0028-gst-hold.md).)

- **Notional GST** — the GST a GST-off Work Order *would* have carried: 18% of its total. It is not owed, paid or invoiced anywhere — a what-if figure showing how much GST was never charged on work ordered without it. A GST-on Work Order has none (its GST is real and already inside its total). Only **Approved** Work Orders count — the same set as the Work Order side of "PO + WO Amount" — so a Work Order under amendment drops out of both until it is approved again. *Avoid*: GST payable, GST liability, missing GST.

- **GST payment (on a Work Order)** — a Work Order payment that pays GST only, never base value. A payment is either a GST payment or a base payment, never a mix. No TDS is withheld from a GST payment, because TDS is only ever taken on base value. Every payment made before GST payments existed is a base payment. A GST payment is drawn from the Work Order as a whole, not from any one invoice. ([ADR-0030](docs/adr/0030-wo-gst-paid-as-its-own-payment.md).)

- **GST Invoiced (of a Work Order)** — the GST a vendor has billed on a Work Order **and we have accepted**: the sum of the *Invoice GST Amount* over its **Approved** invoices only. It is the GST twin of *Total Amount Invoiced*, derived from the invoices and never kept by hand, so it falls again when an approved invoice is rejected, edited or deleted. It measures GST billed, not GST paid. *Avoid*: approved GST payment amount, GST pool.

- **Work Order payment limit (GST-on)** — how much may be requested on a GST-on Work Order. **Base left** = the Work Order's base value (its total without GST) minus its base payments, counted before TDS. **GST left** = the smaller of *GST Invoiced* and the Work Order's own GST, minus its GST payments. All payments together can never go above the Work Order's total incl. GST. A payment counts toward these limits at every status, *Rejected* included, until it is deleted. An edit that raises a saved payment or moves it to another Work Order is held to the same limit, measured as if that payment were requested anew; lowering one never is (#1536). The Work Order's own GST caps GST left so that base value can never be paid out as GST and escape TDS. *Avoid*: payable pool, allowed payment.

- **Invoice check (on a Work Order payment)** — a new Work Order payment may be raised only while the Work Order's **raised** money is less than ₹100 above its *Total Amount Invoiced*. **Raised** is every payment on it that is not *Rejected*, base and GST alike, at any status, counted before TDS. The check looks at the Work Order **before** the new payment, so the payment itself may be any size the *Work Order payment limit* allows: a first payment (an advance) always passes, and each later one waits until approved invoices have caught up with what was raised. It applies to every Work Order, Misc and Transport included, and on every way a new payment is entered; a payment split from an existing one is not new. A payment raised by an **L1 approver** (the Admin profile, or `Administrator`) or by the **CEO** skips it. A Work Order payment is never negative: money coming back is a *Vendor Refund*. *Avoid*: invoice gate, advance rule. (Owner, 2026-10-17, #1488.)

## Vendor holds

Two separate holds sit on a Vendor. They share the word "hold" and nothing else — never merge them in UI copy, code or reports.

- **Vendor Hold** — the *credit* hold: `vendor_status` = On-Hold when the vendor's available credit is used up. Blocks dispatch and payments on "PO Approved" POs. Set by the daily credit job; cleared automatically when credit frees up.

- **GST Hold** — the *GST* hold: the `gst_hold` checkbox. The daily job turns it ON for a Service or Material & Service vendor with **no GST number** whose **GST-off Work Orders** created this financial year (not Rejected) total **more than ₹15,00,000**, summed on their Work Order total. A vendor on GST Hold **cannot get a new Work Order**, nor be swapped into one by an *Amendment*; its existing Work Orders carry on. The job only ever turns it ON — it stays ON when the total drops, when the vendor gets a GST number and into the next financial year. Only *Remove GST Hold* (Admin) takes it off. A change by hand on the field switches no Work Order; an untick on a vendor that still qualifies is put back ON the next morning. *Avoid*: "vendor on hold" for this — that phrase means Vendor Hold. ([ADR-0028](docs/adr/0028-gst-hold.md).)

- **Remove GST Hold** — the Admin action on the Vendor page. It only clears GST Hold: it changes no Work Order, and no GST number is needed. If the vendor has registered, someone enters its GST number; its new Work Orders are then approved GST-on and its old GST-off ones appear on the GST mismatch list for *Match GST to vendor*. A vendor that still qualifies is put back on GST Hold the next morning. ([ADR-0028 Amendment A](docs/adr/0028-gst-hold.md).)

## Payees

- **Payee** — one bank account the company pays into, with the name of the person or business that holds it: account holder name, account number, IFSC, bank and branch. It is an address book entry: picking it fills in a payment's or Expense's **pay-to account**, and nothing paid points back at it. No two Payees share an account number and IFSC. A Vendor links to one Payee; one Payee may serve several Vendors (the same company listed once per branch or state). A Payee with no Vendor is used for Expenses, and, when it is a person's **own bank account**, for their Reimbursements. Every Payee has an account; someone with no bank account on record is not a Payee. When its holder moves banks, the Payee's account is edited and each edit records who made it; changing or removing a Payee never changes what was already paid. A Payee no Vendor links to may be deleted ([ADR-0033](docs/adr/0033-payee-is-one-bank-account.md)). *Avoid*: beneficiary, recipient, party, vendor bank details, bank account (for the record). (Owner, 2026-10-14; made an address book 2026-10-15.)

- **Payee type** — where a Payee was created, set once and never changed: *Users* (a person's **own bank account**, added from Raise Reimbursement), *Vendors* (a Vendor's bank details) or *Others* (anywhere else: the Payees page, an Expense's Add new payee). It records the origin, not current use: a Payee later linked to a Vendor or taken as someone's own account keeps its type. Payees made before it existed were typed once from what linked to them then. A *Users* Payee is never used on an Expense Request: its picker doesn't list them, and typing one's account in Add new payee says it can't be used (owner, 2026-10-27). (Owner, 2026-10-23.)

- **Pay-to account** — the holder name, account number, IFSC, bank and branch a PO or Work Order payment, Expense Request or Expense will be paid into, held on that record itself. It is copied from a Payee when the record is raised (a PO or Work Order payment from its Vendor's Payee), so the raiser sees where the money will go before submitting. On an Expense Request or Expense the raiser may change it until approval; after that only Accounts may, and only until it is paid. A PO or Work Order payment's is never edited by hand. If its Vendor's Payee has changed since it was raised, or it was raised with none, it takes the Vendor's current account when it is put in a bank file or marked paid, so it always records the account the money actually went to; the payer is told before that happens. Once a record is *Reconciliation Pending* or *Paid* its pay-to account says where the money went and can no longer change: for an Expense the server refuses it (2026-10-20, ADR-0033 Amendment A); for a PO or Work Order payment it is a screen rule, like **Editing a record by status**. Each change records who made it. *Avoid*: payee details, bank snapshot, paid-to. (Owner, 2026-10-15.)

- **Ineligible (payment or Expense)** — a PO or Work Order payment with no pay-to account whose Vendor has no Payee either, or an Expense of a *Required* type with no pay-to account. There is nowhere to send its money, so the payment screens don't let it be ticked, put in a bank file or marked paid until an account is added: on the Vendor's page, or with Change account on the Expense. A screen rule. (Owner, 2026-10-16.)

- **Kept out of the bank file** — an Expense of an *Optional* or *Not asked* type with no pay-to account (paid by card or cash), and any payment made by cheque. It can be ticked and marked paid, but is never put in an ICICI or Cashfree file, and the export says which rows it left out. Contrast **Ineligible**. (Owner, 2026-10-16.)

- **Expense payee** — whoever an Expense is to be paid to, named by picking an existing Payee or adding a new one, which fills in the **pay-to account**: on the Expense Request, where approval carries the account onto the Expense, or on a **Direct Expense** itself when it is recorded. A Project Expense or Expense Request may also name a Vendor; its pay-to account is then copied from that Vendor's Payee, and no other account can be typed while the Vendor is named. Each **expense type** says whether its pay-to account is *Required*, *Optional* or *Not asked*. *This replaces the 2026-08-18 rule that a request asks for no payee bank details.* (Owner, 2026-10-14; revised 2026-10-15.)

- **Own bank account** — the one Payee named on a person's user record, into which their Reimbursements are paid. A person has at most one; the Payee itself is unchanged and holds no link to the person. Only the person adds it, from Raise Reimbursement: an account already on record with nobody's name on it becomes theirs, one that is already another person's is refused, and a second is refused. The person may correct theirs (holder name, number, IFSC) from the Payee tab of their profile, unless a Vendor is also paid into it (that one Accounts changes); claims already raised keep the account they were raised with. Deleting a person keeps their account in Payees, linked to nobody, and keeps their claims, which carry their own copy of the claimant and the account ([ADR-0033 Amendment B](docs/adr/0033-payee-is-one-bank-account.md)). *Avoid*: user payee, employee account. (Owner, 2026-10-22.)

## Reimbursements

- **Reimbursement** — a Nirmaan user's claim to be repaid money they spent for work: a type (Travel, Food or Others), a title, a description (required above ₹2,000), an amount, the receipts (PDFs and pictures merged into one PDF, other files kept as they are) and the **pay-to account** copied from the **claimant**'s **own bank account**. It is never an Expense Request. It is *Pending Approval* until decided, then *Approved* (for the full amount, recording who approved it) or *Rejected* (final, with a reason). Approving it creates the Non-Project Expense that pays it (with no Expense Type: its link to the claim marks it); Accounts pays that expense from Project Payments & Expenses, and the claim turns *Paid* when the expense is paid, or *Rejected* if the expense is rejected there ([ADR-0040](docs/adr/0040-an-approved-reimbursement-becomes-a-non-project-expense.md), superseding [ADR-0041](docs/adr/0041-reimbursement-is-money-outside-the-ledgers.md)). The claimant may edit a claim only while it is Pending Approval, and delete it while it is Pending Approval or Rejected; a claim rejected in Payments takes its Rejected expense with it (owner, 2026-10-27). *Avoid*: expense claim, reimbursement request, expense request (that is a different thing). (Owner, 2026-10-22; paid through a Non-Project Expense 2026-10-23.)

- **Claimant** — the person who raised a Reimbursement, always the person it repays. Taken from the login, never typed. Their name and role profile are saved on the claim when it is raised, so the claim still names them, and still goes to the right approver, if they are later renamed, move role or are deleted. *Avoid*: requester, raiser (for this record), employee. (Owner, 2026-10-22.)

- **HR approval limit** — ₹2,000. HR (HR Executive or HR Lead) may decide a Reimbursement of ₹2,000 or less whose claimant is not in HR; Admin decides everything else, every claim raised by someone in HR included, and may decide their own. Unrelated to the Expense and Payment amount tiers (₹15,000 / ₹50,000). (Owner, 2026-10-22.)

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
  *Unlinked TDS Item*. "TDS SKU" is an informal synonym; the canonical noun is **TDS Item**.
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
  does not change when someone later edits the catalogue. A row waiting for approval is *New* only when
  approving it will add a Make to the catalogue; every other waiting row is *Pending*. Users see both as
  *Pending*, and see *Approved* as **Approved by Admin**, to tell it apart from the client's answer.

- **Client Status** — the client's answer on a Project TDS row the Admin has already approved:
  **Approved by Client** or **Rejected by Client**, or none yet. It is a second decision on top of the
  Admin's approval, not a replacement: the row stays *Approved by Admin*. Only an Admin-approved row can
  carry one. Each mark records who set it and when; a rejection may carry the client's reason. It can be
  switched between the two answers, which records who and when again; only an Admin can clear it back to
  none. A row with a Client Status **cannot be deleted by anyone**. A row *Rejected by Client* still holds
  its TDS Item + Make on the project: that Make cannot be picked again (the way back is switching the row
  to *Approved by Client*), but another Make of the same TDS Item can. (2026-10-08,
  [ADR-0025 Amendment B](docs/adr/0025-tds-phase2-group-driven-consumption.md).)
  *Avoid*: client approval, final approval, Approved (alone, for the client's answer).

- **Request Type** — what a waiting Project TDS row asks the approver for: **From Repository** (an
  existing Repository Entry), **New Make** (a Make the TDS Item has no entry for yet; approval adds it to
  the catalogue), or **Project Custom** (a *Project Custom Item*; approval touches nothing outside the
  project). It matters only while the row awaits approval.
  *Avoid*: From TDS, New Item, Custom Item (as request labels).

- **Project TDS Setting** — a project's report branding: client, architect, consultant and contractor
  names and logos, used on the report cover.

- **Unlinked TDS Item** — a TDS Item in the shared catalogue with **no member SKUs**. It is inferred from
  having zero members, not from a flag. Legacy `CUS-` catalogue rows became Unlinked TDS Items.
  *Avoid*: Custom Item, custom group.

- **Project Custom Item** — an item one project needs that the catalogue does not hold, recorded only on
  that project's TDS rows with its own name, work package, category, make and datasheet. It belongs to
  that project alone and **never enters the TDS Repository**, even when approved. Each row is one name +
  one Make; the same name in two Makes is two rows. (2026-10-07: reinstated; reverses ADR-0025's rule
  that every approved custom joins the shared catalogue.)
  *Avoid*: Custom Item, PCUS item, project-only custom.

- **Approval-time promotion** — approving a request for a **new Make** on an existing TDS Item writes the
  catalogue: the Make becomes a new Repository Entry, born *Verified*. Admin-only. A project can no longer
  create a new TDS Item this way; something the catalogue lacks entirely becomes a *Project Custom Item*.

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
  **only** approver of Project TDS rows. Sets and clears a row's Client Status. Deletes any Project TDS
  row, at any status, unless it has a Client Status.
- **PMO Executive** — project-level manager. Uses **Request New** to request a new Make or a Project Custom Item, manages
  Project TDS setup, and may set an item's TDS group from the Items side. Sets a row's Client Status, but
  cannot clear it. Deletes Project TDS rows **at any status**, like an Admin (owner ruling, changed from
  Pending/Rejected-only), unless the row has a Client Status. Cannot approve, and cannot author groups or
  entries.
- **Project user** (leads, managers, others) — can only pick existing catalogue entries for their
  projects. No edit, no delete, no Request New.

⚠️ **The delete rules and the approver rule are screen-level only, not enforced.** Project TDS rows are
deleted straight through the standard document API with no server check, and every Nirmaan role holds
write and delete on them — so any role can delete any row, *Approved* included, through the REST API.
Approval is checked only inside the approve endpoint. Closing either gap needs a server-side check.

## Assets

- **Holder** — the one person an asset is assigned to right now. Only the holder signs its declaration, asks to
  return it and sends its monthly audit. *Avoid*: owner, user (both mean other things here).

- **Declaration** — the form the holder signs to say they have received the asset and will look after it. Every
  holder signs their own in the app, Admin included. An asset with no declaration yet is **Pending Declaration**.

- **Return Request** — the holder saying "I've given this back". The asset stays assigned until a manager
  approves (it becomes unassigned) or rejects (the holder keeps it). *Avoid*: return by.

- **Monthly audit** — once a month, the holder of an asset whose category needs it answers "Is it working?" -- with
  optional remarks if it is, a description and an optional image if it isn't -- to show the asset still exists and
  how it is. Only assigned assets with a signed declaration owe one. Until it is sent, the app is locked (the app
  access gate).

- **Audit month** — the month an audit is FOR, written `MM/YYYY`. From the 28th, a new audit is for the next
  month; an audit sent late is still for the month it belonged to.

- **Grace days** — the 28th to the 7th of the next month: an audit still unsent from the month just ended can be
  sent without counting as missed.

- **Audit Requested / Audit Fulfilled / Audit Missed** — the three audit entries in an asset's history: an audit
  was opened, sent, or not sent by the 7th after its month.

- **Overdue (audit)** — the holder has missed at least one month in a row; shown as "overdue since" the first
  missed month, and cleared when an audit is sent. There is deliberately no count of missed months.

- **Red answer / issue** — an audit answer that points to a problem: today "No, it is not working" (older audits:
  not with me, damaged, missing parts). It must carry a description (since 2026-10-21; older ones may have none).
  "2 issues" means two red answers. The audit never changes the asset's condition; people read the answers.

- **App access gate / locked app** — while a person has asset tasks pending, or (Project Manager, Project Lead and
  material procurement) no project assigned, the app shows them only the dashboard card that says what to do;
  the sidebar and every other page come back when it is done. *Avoid*: blocked user (that is Frappe's disabled
  user).

- **Asset history** — the permanent, append-only record of everything that happened to an asset. Seen by Admin
  and HR only.
