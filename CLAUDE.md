# CLAUDE.md — Nirmaan Stack

Nirmaan Stack is a construction project-management and procurement ERP: a Frappe app whose whitelisted Python
APIs serve a React + TypeScript SPA. Core domains: Procurement (PR → RFQ → PO → DC/DN), Projects, Vendor
Management, Service Requests, Financial Tracking, Inventory, and Document AI invoice autofill.

Stack: Frappe v15, Python 3.10, PostgreSQL 14 (never MariaDB), Redis, Socket.IO; React 18, TypeScript, Vite,
shadcn/ui, Tailwind, Zustand, TanStack Table, `frappe-react-sdk`. Frontend conventions file: `frontend/CLAUDE.md`
(not `frontend/.claude/CLAUDE.md`).

## Before you write code

**Before writing, reviewing or testing code, or writing a migration, read `CODING_STANDARDS.md`** (frontend code:
also `frontend/CODING_STANDARDS.md`). Before changing code in a domain, read that domain's doc from
[Domain docs](#domain-docs).

Three standards fail silently when broken, so they are summarised here too (full text in `CODING_STANDARDS.md`):

- **Raw SQL skips hooks.** `frappe.db.sql` writes, `frappe.db.set_value` and bulk writes fire no `doc_events`.
  At such a call site, run the affected recompute or state why skipping it is correct, and recompute derived
  fields from source, never by a delta. Patches and repair scripts are where this bites.
- **Cast a bound `SUBSTRING` offset:** `SUBSTRING(col FROM %s::integer)`. An uncast `%s` arrives as text and
  selects the regex overload, so the predicate quietly never matches.
- **Generated and append-only paths are never hand-edited:** doctype JSON, existing files in `patches/`,
  `www/frontend.html`, `frontend/src/components/ui/`, `nirmaan_stack/public/`. Change the source or use the
  tool instead; the sanctioned doctype-JSON exceptions are in `CODING_STANDARDS.md` § Don't touch.

## Session workflow

- **Tickets and specs are GitHub issues.** Read the ticket and its parent spec first:
  `gh issue view <n> --comments --repo Nirmaan-app/nirmaan_stack_frappe15_postgres_14`.
- **Ad-hoc work (no ticket): write a plan and wait for the user's review before writing code.** Under
  `/implement`, the ticket is the approved plan: build it without re-planning or stopping for review.
- **Commit once per ticket, on the current branch;** branch only when the user asks. Run
  `python3 scripts/residence_check.py` before each commit.
- **Never push, and never close issues.** The user does both, by hand.
- **Per ticket, run the affected test modules, not the whole app.** This overrides `/implement`'s "full test suite
  once at the end". Affected means: the test modules of the package you changed, every test module that imports
  a module you changed (`grep -rln "<dotted.package.path>" nirmaan_stack --include='test_*.py'`; grep the
  package, not the module, so `from <package> import <module>` is caught too), and, for a
  doctype change, every test module that names that doctype. Run each with `--module` (see [Commands](#commands)).
  The full suite (`--app nirmaan_stack`, about 25 minutes) runs only when the user asks; the user runs it before
  pushing.
- **Work in place on the current branch; create a git worktree only when the user asks.** `bench` resolves this
  app through `sites/apps.txt` and an editable install pointing at the main checkout, so a backend test run from
  a worktree exercises the main checkout's code, not the change — a green result there proves nothing. The one
  sanctioned exception is a frontend-only browser walk: a second vite on `:8081`, with the worktree's
  `node_modules` symlinked to the main checkout's. Stating the preference here is also what makes a
  worktree-creating skill stand down.

**Docs discipline — DOCS-UPDATE RULE.** Per-commit as-built detail (hashes, test counts, build logs, dated
narratives) goes to the on-demand reference docs only: `frontend/.claude/plans/boq-upload-plan.md` (live status,
source of truth), `.claude/context/domain/boq-backend.md`, `frontend/.claude/context/domain/boq-frontend.md`.
Touch a `CLAUDE.md` only when a stable convention or an owner-locked invariant changes. A domain rule goes in that
domain doc's Load-bearing invariants section, with at most a pointer row in Domain docs; a coding rule goes in
`CODING_STANDARDS.md` (frontend: `frontend/CODING_STANDARDS.md`). The `.claude/hooks/guard_claude_md.py`
PreToolUse hook enforces this and redirects changelog-style text to the reference docs (patterns: `.claude/hooks/README.md`).

## Commands

Tests run in-container through the bench runner:

```bash
bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_pricing   # one module
bench run-tests --app nirmaan_stack
```

`python -m unittest <module>` fails at import: `services/boq_ai_assist.py` calls `frappe.logger("boq_ai")` at
module load, which opens `/workspace/development/logs/boq_ai.log` before a bench context exists.

**Ad-hoc DB queries from host** (bench CLI broken on host — click version mismatch):
```bash
cat > /tmp/q.py <<'EOF'
import os; os.chdir('/workspace/development/frappe-bench/sites')
import frappe; frappe.init(site='localhost'); frappe.connect()
# ... query ...
frappe.destroy()
EOF
docker cp /tmp/q.py frappe_docker_devcontainer-frappe-1:/tmp/q.py
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 env/bin/python /tmp/q.py
```
`os.chdir` to `sites/` is required before `frappe.init()`. On Windows Git Bash, prefix `MSYS_NO_PATHCONV=1` on
every `docker exec` / `docker cp` that passes a UNIX path, or `/tmp/...` becomes `C:/Users/.../Temp/...` (handover §9 #93, §11 #33).

**BoQ dev environment** (setup, clean bench restart, the CSRF clear-site-data login fix, :8080 live vs :8000
stale, read-only DB inspect): `BoQ_Environment_Testing_Runbook_v1_0.md` in project knowledge, a digest of handover
§9 #118-#123 + caveats TT/UU/VV/WW (the source of truth).

## Domain docs

Read the doc for the area you touch before writing code; where it has a Load-bearing invariants section, read
that first. Paths are under `.claude/context/domain/` unless given in full.

The BoQ docs are too large to read whole: `frontend/.claude/plans/boq-upload-plan.md` (~3 MB), `boq-backend.md`
(~250 KB), `boq-rate-master.md`. List the headings with `grep -n '^#' <file>`, then read only that range.

| Touching… | Read |
|---|---|
| **BoQ status**: the active phase or slice, the design spec, as-built records | `frontend/.claude/plans/boq-upload-plan.md` |
| **BoQ wizard**: upload, parser, review tree, AI-assist prompts, commit, BoQ doctypes, a wizard-vs-app-wide scope fork | `boq-backend.md` § Load-bearing invariants |
| **Reading an uploaded file's bytes** (BoQ upload worker, any upload code) | `CODING_STANDARDS.md` § Writing backend Python |
| **BoQ classification**: `BoQ Row Category`, engines, rules runner, routing, AI voter, truth snapshots | `boq-classification.md` |
| **BoQ pricing editor**: rate gates, copy-forward, revision carry, classification freeze | `boq-pricing-editor.md` |
| **BCS cost layer** (not the rate-master "BCS") | `boq-pricing-editor.md` § BCS |
| **Rate Master / Rate Suggestion**: catalogue, category configs, pipelines, rate files, asset mints, AI extraction, rate-helper panel | `boq-rate-master.md` § Load-bearing invariants |
| **BoQ frontend**; the pricing editor (`PricingGrid.tsx`, `SheetPricingPage.tsx`) | `frontend/.claude/context/domain/boq-frontend.md`; `boq-pricing-editor-frontend.md` beside it |
| **Pricing Module** (`api/pricing/`, not the BoQ pricing editor) | `pricing-module.md` |
| **Procurement**: PR/PO/RFQ, PR packages, Critical PO Task links, delivery documents, vendor credit, Loss Justification | `procurement.md` § Load-bearing invariants |
| **Projects**, CEO Hold | `projects.md` |
| **Users**, the Administrator account | `users.md` |
| **Service Requests** | `service-requests.md` |
| **Internal Transfer Memos** | `internal-transfer-memos.md` |
| **Expenses** | `expenses.md` |
| **Invoice Autofill**, **Invoice Qty** | `invoice-autofill.md`, `invoice-qty.md` |
| **Outflow import** (bank statement settles payments and expenses) | `outflow-import.md` |
| **Payment TDS** (tax deducted at source, not Technical Data Sheets) | `payment-tds.md` |
| **Technical Data Sheets**: the TDS Repository, Project TDS requests and their approval (not tax TDS) | `tds.md` § Load-bearing invariants |
| **Vendor Hold** | `frontend/.claude/context/domain/vendor-hold.md` |
| **Monthly WIP report** | `.claude/plans/monthly-wip-plan.md` |
| **Doctypes**, **APIs** | `.claude/context/doctypes.md`, `.claude/context/apis.md` |
| Anything else; the session changelog | `.claude/context/_index.md`, `frontend/.claude/context/_index.md`; `.claude/CHANGELOG.md` |

## Agent skills

Read by the installed engineering skills (`/triage`, `/to-spec`, `/code-review`, …); edit `docs/agents/` to change it.

- **Issue tracker:** GitHub issues on `Nirmaan-app/nirmaan_stack_frappe15_postgres_14`, via the `gh` CLI. PRs are
  not a request surface. See `docs/agents/issue-tracker.md`.
- **Triage labels:** the five canonical roles use their default strings: `needs-triage`, `needs-info`,
  `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- **Domain docs:** single-context — root `GLOSSARY.md` + root `docs/adr/` — plus the per-domain reference docs
  under `.claude/context/domain/` and `frontend/.claude/context/`. See `docs/agents/domain.md`.
- **Coding standards:** `CODING_STANDARDS.md` and `frontend/CODING_STANDARDS.md` (the `/code-review` Standards axis
  reads both).
