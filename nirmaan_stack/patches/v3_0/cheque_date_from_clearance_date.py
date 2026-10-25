# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Give each Cleared cheque its clearance date as its Cheque/Payment Date (#1520, spec #1514, ADR-0035
Amendment A).

WHAT IT DOES
    The cheque date and the clearance date are one Cheque/Payment Date now (`Cheques.cheque_date`): the paper
    date until the bank import clears a Payment cheque, then the day the bank paid. The `clearance_date` field
    is hidden in the same change, and no code writes it. For every Cheque at Cleared with a clearance date, this
    copies that date into `cheque_date`, so a cheque cleared before the change reads the same as one cleared
    after it. Every other Cheque keeps its paper date: an Issued, Approval Pending or Cancelled one, and every
    Security Deposit cheque (never cleared). A Cleared cheque with no clearance date keeps its date too, and is
    listed. The paper date it overwrites is not kept on the Cheque (owner's choice); each payment's own
    `cheque_date` still holds it.

THE OLD COLUMN
    `clearance_date` stays on the doctype as a hidden field, only so the earlier cheque patches still run on a
    site that first gets Cheques in this release: the cheque-types patch (#1478) selects it. It is read with
    raw SQL. On such a site that patch has already written each Cleared cheque's last payment date into
    `cheque_date` and left `clearance_date` blank, so those cheques are listed here as having no clearance
    date, with the right date already in place.

IDEMPOTENT
    Only a Cleared cheque whose `cheque_date` differs from its clearance date is written, so a second run
    writes nothing.

HOOKS
    A raw write, so no `doc_events` fire and no Version row is written. Skipping them is correct: copying a
    date moves no money and changes no payment (each payment's payment date was already set from the bank
    line when the cheque cleared), and the Cheques `validate` controller has nothing to say about the date of
    a Cleared cheque. `modified` is left as it was.
"""

import frappe

from nirmaan_stack.services.cheques.rules import CLEARED
from nirmaan_stack.services.cheques.writer import CHEQUES

PATCH = "cheque_date_from_clearance_date"
OLD_COLUMN = "clearance_date"


def execute():
    result = copy_clearance_dates()
    frappe.db.commit()
    for line in summary(result):
        print(f"{PATCH}: {line}")
        frappe.logger("cheques").info(f"{PATCH}: {line}")


def copy_clearance_dates(cheques: list[str] | None = None) -> dict:
    """Copy each Cleared Cheque's clearance date into its `cheque_date` -- over every Cheque, or only `cheques`,
    which is what the tests pass so they never touch a Cheque they did not plant. Commits nothing.

    Returns `{changed: [{cheque, cheque_no, from_date, to_date}], no_clearance_date: [{cheque, cheque_no}]}`.
    """
    result = {"changed": [], "no_clearance_date": []}
    if (cheques is not None and not cheques) or not frappe.db.has_column(CHEQUES, OLD_COLUMN):
        return result
    scope, params = "", {"cleared": CLEARED}
    if cheques is not None:
        scope, params["cheques"] = "AND name IN %(cheques)s", tuple(cheques)
    rows = frappe.db.sql(
        f"""SELECT name, cheque_no, cheque_date, {OLD_COLUMN} AS cleared_on FROM "tab{CHEQUES}"
            WHERE status = %(cleared)s {scope} ORDER BY name""",
        params, as_dict=True,
    )
    for row in rows:
        if not row.cleared_on:
            result["no_clearance_date"].append({"cheque": row.name, "cheque_no": row.cheque_no})
        elif str(row.cheque_date) != str(row.cleared_on):
            result["changed"].append({"cheque": row.name, "cheque_no": row.cheque_no,
                                      "from_date": str(row.cheque_date), "to_date": str(row.cleared_on)})

    # Raw on purpose (see HOOKS above): a date copy moves no money and fires no payment hook.
    if result["changed"]:
        frappe.db.sql(
            f"""UPDATE "tab{CHEQUES}" SET cheque_date = {OLD_COLUMN}
                WHERE status = %(cleared)s AND {OLD_COLUMN} IS NOT NULL AND name IN %(names)s""",
            {"cleared": CLEARED, "names": tuple(c["cheque"] for c in result["changed"])},
        )
    return result


def summary(result: dict) -> list[str]:
    """What the patch prints: the counts, every Cheque it changed and every Cleared Cheque it could not date."""
    lines = [
        f"{len(result['changed'])} Cleared Cheque(s) given their clearance date as their Cheque/Payment Date; "
        f"{len(result['no_clearance_date'])} Cleared Cheque(s) had no clearance date and keep their date"
    ]
    lines += [f"dated {c['cheque']} ({c['cheque_no']}): {c['from_date']} -> {c['to_date']}" for c in result["changed"]]
    lines += [f"no clearance date: {c['cheque']} ({c['cheque_no']})" for c in result["no_clearance_date"]]
    return lines
