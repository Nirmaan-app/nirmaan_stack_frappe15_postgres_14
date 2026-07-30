# Context Reference Index

Quick navigation to detailed documentation. Read only when working on related tasks.

| File | Domain | When to Read |
|------|--------|--------------|
| [doctypes.md](doctypes.md) | Data Models | Creating/modifying doctypes, understanding relationships |
| [apis.md](apis.md) | Backend APIs | Adding/modifying API endpoints |
| [integrations.md](integrations.md) | Frontend-Backend | Socket.IO, Firebase, REST patterns |
| [workflows.md](workflows.md) | Business Logic | Auto-approval, state machines, scheduled tasks |
| [patterns.md](patterns.md) | Code Conventions | Naming, file organization, error handling |
| [domain/procurement.md](domain/procurement.md) | Procurement | PR/PO/RFQ/Quotation workflows, PO delivery documents |
| [domain/service-requests.md](domain/service-requests.md) | Service Requests | Work Orders, finalization, SR remarks |
| [domain/users.md](domain/users.md) | User Management | Nirmaan Users, permissions, authentication |
| [domain/projects.md](domain/projects.md) | Projects | Project status lifecycle, status effects on features |
| [domain/internal-transfer-memos.md](domain/internal-transfer-memos.md) | Internal Transfer Memos | Inter-project material transfer (ITM) — doctype, state machine, invariants, phase roadmap |
| [domain/boq-backend.md](domain/boq-backend.md) | BoQ backend — **router** | Start here. 1.7 KB index into the five surfaces below (carved 2026-07-30 from 187 KB). Live status: `frontend/.claude/plans/boq/README.md` + `_slices.md` |
| [domain/boq-backend-wizard-endpoints.md](domain/boq-backend-wizard-endpoints.md) | Wizard endpoints | Calling or changing any wizard endpoint — the full request/response reference |
| [domain/boq-backend-revised-boq.md](domain/boq-backend-revised-boq.md) | Revised BoQ / ADR-0014 | Entry (S2), sheet mapping (S3), column-diff carry (S4), row match (S6), commit overlay (S8), cross-BoQ rate carry (S7a), Amendments B/C/D/E |
| [domain/boq-backend-doctypes-and-rules.md](domain/boq-backend-doctypes-and-rules.md) | Doctypes + pricing rules | Touching a BoQ doctype or the pricing-editor backend rules |
| [domain/boq-backend-operations.md](domain/boq-backend-operations.md) | Operations | Upload-worker prefill, template priced export, single-editor lock, template deselect |
| [domain/boq-backend-slice-changelog.md](domain/boq-backend-slice-changelog.md) | ⚠️ HISTORICAL | Rolling per-slice changelog. **Do not load, do not extend** — new slices go to `frontend/.claude/plans/boq/slices/`. Same disposition as `boq-frontend-as-built-log.md` |
| [domain/customer-po-autofill.md](domain/customer-po-autofill.md) | Customer PO autofill | Autofill of customer PO fields |
| [domain/expenses.md](domain/expenses.md) | Expenses | Expense doctypes, approval flow, project scoping |
| [domain/invoice-autofill.md](domain/invoice-autofill.md) | Invoice autofill | Invoice field autofill behaviour |
| [domain/invoice-qty.md](domain/invoice-qty.md) | Invoice quantities | Invoiced-quantity derivation and reconciliation |

### Backend surface conventions — carved from `CLAUDE.md` (2026-07-30)

`CLAUDE.md` is auto-loaded on every session, so it is now a **router**: invariants and guardrails only. The per-surface conventions it used to carry live here and are read on demand. Every content line was verified present against `git show HEAD:CLAUDE.md`.

| File | Surface | When to Read |
|------|---------|--------------|
| [conventions/backend-active-features.md](conventions/backend-active-features.md) | Active features + BoQ doctype inventory | Starting work on any active feature; the full per-doctype BoQ inventory |
| [conventions/backend-domain-gotchas.md](conventions/backend-domain-gotchas.md) | Domain gotchas | Before any backend change — the earned traps |
| [conventions/backend-rate-master.md](conventions/backend-rate-master.md) | Rate Master (RM-1) | Loader, extraction, doctypes |
| [conventions/backend-pricing-module.md](conventions/backend-pricing-module.md) | Pricing module backend | APIs, workbooks, rate resolution |
| [conventions/backend-rate-suggestion.md](conventions/backend-rate-suggestion.md) | Rate suggestion (RM-3) | Runs, events, scoring |

### Frontend Context (in `frontend/.claude/context/`)

⚠️ Two entries below were stale and are corrected here: `domain/boq-frontend.md` was **split into ten surface files at `61f82798`**, and `frontend/.claude/plans/boq-upload-plan.md` was **rotated at `15e9b81e`**. Read `frontend/.claude/context/_index.md` — it is the authority for the frontend side.

| File | Domain | When to Read |
|------|--------|--------------|
| `domain/boq-frontend-*.md` | BoQ frontend | **Ten surface files**, split from the former single `boq-frontend.md` at `61f82798`: `-wizard-upload`, `-hub`, `-sheet-config`, `-review-screen`, `-pricing-grid`, `-pricing-rollup`, `-pricing-layout`, `-pricing-controls`, `-revised-boq`, `-as-built-log`. Load only the surface you are on |
| `conventions/frontend-*.md` | BoQ frontend conventions | Six files carved from `frontend/CLAUDE.md` at the 2026-07-30 carve — pricing editor, pricing module, gotchas, rate master, wizard, review invariants |
| `domain/ceo-hold.md` | CEO Hold | Project hold status blocking, guard hooks, affected pages |
| `domain/delivery-notes.md` | Delivery Notes | DN system on POs, delivery_data JSON, 51-point linkage map across the app |
| `domain/projects.md` | Projects | Frontend status behavior, ProjectSelect component |
| `domain/customers.md` | Customers | Customer CRUD, financials, inflows |
| `domain/invoices.md` | Invoices | PO/SR invoices, 2B reconciliation |
| `domain/milestones.md` | Milestones | Daily progress reports, zone tracking |
| `role-access.md` | Access Control | Role checks, sidebar visibility, page permissions |
