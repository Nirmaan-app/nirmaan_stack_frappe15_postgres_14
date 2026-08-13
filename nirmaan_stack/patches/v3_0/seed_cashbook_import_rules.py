# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Seed the Cashbook import's two lookup tables (slice 3).

WHY A PATCH RATHER THAN A FIXTURE
    `Outflow Import Expense Rule` and `Outflow Import Project Alias` are OPERATIONAL data: an
    accountant is expected to add a nickname the week a project picks one up, and to move a keyword
    when the chart of accounts changes. A fixture would be re-imported on every migrate and would
    quietly revert those edits -- the same trap the rate-master notes record for an in-system edit
    never written back to its asset. A patch runs ONCE and then leaves the table alone, which is
    what seed data means.

    `Petty Cash` is the opposite case and ships as a FIXTURE (`fixtures/expense_type.json`),
    because it is not operational: it is the fallback every unmatched row lands on, and an
    environment without it cannot import a Cashbook statement at all. It carries BOTH the `project`
    and `non_project` flags, which is unusual but not novel -- `Travel Expenses (Bus)` and
    `Travel Expenses (Train)` already do, so the "the two flags are disjoint" line in the root
    CLAUDE.md was already describing a convention rather than a constraint.

IDEMPOTENT, AND IT SKIPS RATHER THAN OVERWRITES
    Every insert is guarded by an existence check on the natural key, so a re-run changes nothing.
    Critically it does NOT update a row it finds: if somebody has already moved "courier" to a
    different expense type, that is a decision, and a patch re-running must not undo it.

    A rule naming an expense type that does not exist is SKIPPED WITH A LOG, never a throw. This
    runs inside `bench migrate`, and failing the whole migration of an unrelated environment over a
    missing seed row would be wildly out of proportion.

THE KEYWORD MAP IS OWNER-AUTHORED. It was drafted from a real 115-row statement and ratified; the
readable copy lives in `docs/outflow-import/cashbook-expense-rules.md`, which is GENERATED from
this table so the two cannot drift.

The corresponding patches.txt wiring
(`nirmaan_stack.patches.v3_0.seed_cashbook_import_rules` under [post_model_sync]) is added
separately by the maintainer -- it is intentionally not part of this patch.
"""

import frappe

ALIAS_DOCTYPE = "Outflow Import Project Alias"
RULE_DOCTYPE = "Outflow Import Expense Rule"

# (phrase, project_name). Resolved to a project id at run time, because a project's NAME is what a
# human can check and its id is not.
ALIASES = (
    ("VR Mall", "VR Mall Food Court"),
    ("EY", "Ernst & Young"),
    ("tekus", "Telus GIFT City"),
    ("Qubest", "Qburst"),
)

# (keyword, ledger, expense_type). Longest keyword wins at match time -- see
# `candidates.load_expense_rules` -- so a phrase may safely overlap a shorter word here.
RULES = (
    # -- movement of materials and people ---------------------------------------------------
    ("transport", "Project", "Material Transportation Charges"),
    ("porter", "Project", "Material Transportation Charges"),
    ("freight", "Project", "Material Transportation Charges"),
    ("shifting", "Project", "Material Transportation Charges"),
    ("travels", "Project", "Material Transportation Charges"),
    ("logistics", "Project", "Material Transportation Charges"),
    ("rapido", "Project", "Material Transportation Charges"),
    ("courier", "Project", "Material Transportation Charges"),
    ("speed post", "Project", "Material Transportation Charges"),
    ("courier", "Non Project", "Postage & Courier"),
    ("speed post", "Non Project", "Postage & Courier"),
    # -- loading ------------------------------------------------------------------------------
    ("unload", "Project", "Loading & Unloading Charges"),
    ("loading", "Project", "Loading & Unloading Charges"),
    # -- buying things ------------------------------------------------------------------------
    ("locally purchased", "Project", "Material Purchases"),
    ("local purchase", "Project", "Material Purchases"),
    ("purchased", "Project", "Material Purchases"),
    ("purchase", "Project", "Material Purchases"),
    # -- paper --------------------------------------------------------------------------------
    ("printout", "Project", "Project Printing Charges"),
    ("print out", "Project", "Project Printing Charges"),
    ("printing", "Project", "Project Printing Charges"),
    ("print", "Project", "Project Printing Charges"),
    ("printout", "Non Project", "Printing & Stationery"),
    ("print out", "Non Project", "Printing & Stationery"),
    ("printing", "Non Project", "Printing & Stationery"),
    ("print", "Non Project", "Printing & Stationery"),
    ("bond paper", "Non Project", "Printing & Stationery"),
    ("business card", "Non Project", "Printing & Stationery"),
    # -- feeding people -----------------------------------------------------------------------
    ("food", "Non Project", "Staff Welfare Expenses"),
    ("blinkit", "Non Project", "Staff Welfare Expenses"),
    ("cake", "Non Project", "Staff Welfare Expenses"),
    ("grocery", "Non Project", "Staff Welfare Expenses"),
    ("grossery", "Non Project", "Staff Welfare Expenses"),
    ("snack", "Non Project", "Staff Welfare Expenses"),
    # -- keeping things working ---------------------------------------------------------------
    ("repair", "Non Project", "Repair & Maintenance"),
    ("rental", "Non Project", "Repair & Maintenance"),
    ("scaffolding", "Project", "Scaffolding Rent"),
    ("labour", "Project", "Labour Charges"),
    ("chipping", "Project", "Labour Charges"),
    # -- utilities ----------------------------------------------------------------------------
    ("internet", "Non Project", "Internet & Mobile Charges"),
    ("mobile", "Non Project", "Internet & Mobile Charges"),
    ("electricity", "Non Project", "Electricity Expenses"),
    ("water", "Non Project", "Electricity Expenses"),
)


def execute():
    _seed_aliases()
    _seed_rules()
    frappe.db.commit()


def _seed_aliases():
    for phrase, project_name in ALIASES:
        if frappe.db.exists(ALIAS_DOCTYPE, {"keyword": phrase}):
            continue
        project = frappe.db.get_value("Projects", {"project_name": project_name}, "name")
        if not project:
            frappe.logger("outflow_import").info(
                f"seed_cashbook_import_rules: no project named {project_name!r}, alias skipped"
            )
            continue
        frappe.get_doc(
            {
                "doctype": ALIAS_DOCTYPE,
                "keyword": phrase,
                "project": project,
                "active": 1,
            }
        ).insert(ignore_permissions=True)


def _seed_rules():
    for keyword, ledger, expense_type in RULES:
        if frappe.db.exists(RULE_DOCTYPE, {"keyword": keyword, "ledger": ledger}):
            continue
        if not frappe.db.exists("Expense Type", expense_type):
            frappe.logger("outflow_import").info(
                f"seed_cashbook_import_rules: no expense type {expense_type!r}, rule skipped"
            )
            continue
        frappe.get_doc(
            {
                "doctype": RULE_DOCTYPE,
                "keyword": keyword,
                "ledger": ledger,
                "expense_type": expense_type,
                "active": 1,
            }
        ).insert(ignore_permissions=True)
