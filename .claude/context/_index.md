# Context Reference Index

Quick navigation to detailed documentation. Read only when working on related tasks.
How to write code here (placement, raw SQL, patches, schema changes, tests, don't-touch paths): root `CODING_STANDARDS.md`;
for frontend code, `frontend/CODING_STANDARDS.md`.

| File | Domain | When to Read |
|------|--------|--------------|
| [doctypes.md](doctypes.md) | Data Models | Creating/modifying doctypes, understanding relationships |
| [apis.md](apis.md) | Backend APIs | Adding/modifying API endpoints |
| [integrations.md](integrations.md) | Frontend-Backend | Socket.IO, Firebase, REST patterns |
| [workflows.md](workflows.md) | Business Logic | Auto-approval, state machines, scheduled tasks |
| [patterns.md](patterns.md) | Code examples | Controller methods, permissions model, error handling, realtime publishing, print formats (the rules are in root `CODING_STANDARDS.md`) |
| [domain/procurement.md](domain/procurement.md) | Procurement | **Load-bearing invariants** (PR package = tags not `work_package`, Critical PO Task ↔ PO links, Loss Justification); PR/PO/RFQ/Quotation workflows, PO delivery documents |
| [domain/service-requests.md](domain/service-requests.md) | Service Requests | Work Orders, finalization, SR remarks |
| [domain/users.md](domain/users.md) | User Management | Nirmaan Users, permissions, authentication |
| [domain/projects.md](domain/projects.md) | Projects | Project status lifecycle, status effects on features |
| [domain/internal-transfer-memos.md](domain/internal-transfer-memos.md) | Internal Transfer Memos | Inter-project material transfer (ITM) — doctype, state machine, invariants, phase roadmap |
| [domain/material-test-certificates.md](domain/material-test-certificates.md) | Material Test Certificates | **Load-bearing invariants** (status rule, one line per MTC per PO, profile-based project scope, file kept on delete, PO cascade, index names); doctypes, file map, screens, tests |
| [domain/boq-backend.md](domain/boq-backend.md) | BoQ backend | **Load-bearing invariants** at the top (BoQ doctypes, parser / review tree / commit, wizard scope discipline); then wizard endpoints, commit pipeline, parse/review, slice changelog (relocated from CLAUDE.md 2026-06-25). Live status: `../../frontend/.claude/plans/boq-upload-plan.md` |
| [domain/boq-rate-master.md](domain/boq-rate-master.md) | BoQ Rate Master | Priced-item catalog + category configs, the derivation-pipeline interpreter vocabulary, asset export/import + retirement, the CSV round trip, the deployment freeze, and BoQ Rate Suggestion (AI attribute extraction + pricing helper). Relocated from CLAUDE.md 2026-08-19; the current **Load-bearing invariants** sit at the top |
| [domain/boq-classification.md](domain/boq-classification.md) | BoQ row classification | Load-bearing invariants for `BoQ Row Category`, engines/disciplines, rules runner (nearest-hit, decay, notes-fallback), routing policy, AI voter, truth snapshots |
| [domain/boq-pricing-editor.md](domain/boq-pricing-editor.md) | BoQ pricing editor + BCS | Load-bearing invariants for the committed-sheet pricing editor: lock, priceability / category / amount-formula gates, copy-forward + revision carry, classification freeze, and the BCS internal cost layer |
| [domain/pricing-module.md](domain/pricing-module.md) | Pricing Module | Standalone Pricing Workbook module: doctypes, gzip transport, read/write access split, checkout lock, tests |
| [domain/customer-po-autofill.md](domain/customer-po-autofill.md) | Customer PO autofill | Autofill of customer PO fields |
| [domain/expenses.md](domain/expenses.md) | Expenses | Expense doctypes, approval flow, project scoping |
| [domain/invoice-autofill.md](domain/invoice-autofill.md) | Invoice autofill | Invoice field autofill behaviour |
| [domain/invoice-qty.md](domain/invoice-qty.md) | Invoice quantities | Invoiced-quantity derivation and reconciliation |
| [domain/non-project-inflows.md](domain/non-project-inflows.md) | Non-Project Inflows | Company money-in with no project/customer: doctype, validation, role permissions, receipt adoption, the `/non-project-inflows` page (#1265, ADR-0016 Amendment A) |
| [domain/outflow-import.md](domain/outflow-import.md) | Bulk Import Outflow | Bank-statement import that settles Approved→Paid across the three ledgers: matcher, status deriver, tolerance, decision screen |
| [domain/payment-tds.md](domain/payment-tds.md) | Payment TDS (tax deducted at source) | Deduction + TDS Challan Attachment doctypes, the recompute-from-source rule for `reconciled_amount`, paying under a challan, restating a deduction when a payment is edited, Gemini challan extraction, the Reports-hub ledger. **Not** the Technical Data Sheet family |
| [domain/tds.md](domain/tds.md) | Technical Data Sheets (TDS) | Load-bearing invariants: catalogue shape, project rows as snapshots, stored status meanings, the one owner per request rule, the write endpoints, datasheet ownership, known gaps. **Not** tax TDS |
| [domain/tds/](domain/tds/) | Technical Data Sheets (TDS) | Historical Phase 1–3 build plans for the TDS Repository (TDS Items, Repository Entries, item-owned membership, Project TDS). Glossary: root `GLOSSARY.md` § Technical Data Sheets; decisions: `docs/adr/0023`–`0026`. **Not** tax TDS |

### Frontend Context (in `frontend/.claude/context/`)

| File | Domain | When to Read |
|------|--------|--------------|
| `domain/boq-pricing-editor-frontend.md` | BoQ pricing editor (frontend) | Load-bearing invariants of `PricingGrid.tsx` / `SheetPricingPage.tsx` |
| `domain/boq-frontend.md` | BoQ frontend | Wizard + review-screen load-bearing invariants, pricing-editor component contracts, full per-slice as-built detail (relocated from frontend/CLAUDE.md 2026-06-25) |
| `domain/ceo-hold.md` | CEO Hold | Project hold status blocking, guard hooks, affected pages |
| `domain/delivery-notes.md` | Delivery Notes | DN system on POs, delivery_data JSON, 51-point linkage map across the app |
| `domain/projects.md` | Projects | Frontend status behavior, ProjectSelect component |
| `domain/customers.md` | Customers | Customer CRUD, financials, inflows |
| `domain/invoices.md` | Invoices | PO/SR invoices, 2B reconciliation |
| `domain/milestones.md` | Milestones | Daily progress reports, zone tracking |
| `role-access.md` | Access Control | Role checks, sidebar visibility, page permissions |
