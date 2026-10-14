# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move the vendors' bank details into Payees (#1424, spec #1420, ADR-0033).

WHY THIS PATCH EXISTS
    A Payee is now the one record of a bank account (ADR-0033). The vendors' five bank fields stay in
    place until ticket 12 of the spec deletes them; this patch gives every vendor with an account
    number its Payee first, and every vendor-linked expense that Payee.

WHAT IT MAKES
    Vendors with no Payee yet are grouped by (account number without spaces, dashes or leading zeros,
    IFSC): the Payee module's identity rule (`services/payees/rules.parse_details`). Each group
    becomes one Active Payee (`writer.backfill_payee`), and every vendor in it links to that Payee:
    * holder name: the longest in the group. A group where no vendor has one takes the longest vendor
      name instead, and the log lists it for the owner to check (two live vendors at spec time);
    * account number: the longest form in the group, so leading zeros a vendor recorded are kept;
    * bank and branch: as recorded on the vendor whose holder name was kept (else the first vendor that
      has one). The IFSC lookup is NOT asked: the patch copies what is on record.
    A group whose account + IFSC is already an Active Payee (added on the Payees page before this ran)
    links to it and leaves it unchanged.
    A vendor with no account number gets no Payee. A group the Payee rules refuse (no IFSC, a malformed
    IFSC or account number), or whose Payee is Inactive, is skipped: its vendors keep no Payee and the
    log names them with the reason. Nothing is invented for them. Each group is written inside its own
    savepoint, so one refusal never stops the others.
    Then every Expense Request and Project Expense with no Payee whose vendor has one gets that Payee.
    Non Project Expenses name no vendor and stay as they are; so does every other past expense.

THE LOG
    Counts; each merged Payee (a group of more than one vendor) with its vendors and their recorded
    holder names; each holder name taken from a vendor name; each skipped group and why.

IDEMPOTENT
    Only vendors with no Payee are read, and only expenses with no Payee are written, so a second run
    makes and changes nothing. Skipped vendors are skipped again, with the same log lines.

HOOKS
    The Payee insert runs its `validate` (cleaning, completeness, duplicate refusal). The vendor and
    expense `payee` links are raw UPDATEs that skip `doc_events` and leave `modified` alone, which is
    correct: no hook on `Vendors`, `Expense Request` or `Project Expenses` reads `payee` or derives
    anything from it, and a link moves no money figure.

The `patches.txt` line sits under [post_model_sync], after the sync that adds `Payee` and the
`payee` links (#1422).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.rules import (
    INACTIVE,
    PAYEE_DOCTYPE,
    details_problem,
    parse_details,
)
from nirmaan_stack.services.payees.writer import backfill_payee, existing_payee

PATCH = "move_vendor_bank_details_to_payees"
#: The doctypes that name a vendor and so take its Payee.
VENDOR_LINKED_EXPENSES = ("Expense Request", "Project Expenses")


def execute():
    if not frappe.db.table_exists(PAYEE_DOCTYPE) or not frappe.db.has_column("Vendors", "payee"):
        print(f"{PATCH}: Payee / Vendors.payee absent, skipping")
        return
    result = move_vendor_bank_details()
    frappe.db.commit()
    for line in summary(result):
        print(f"{PATCH}: {line}")
        frappe.logger("payees").info(f"{PATCH}: {line}")


def move_vendor_bank_details(vendors: list[str] | None = None) -> dict:
    """Give every vendor with an account number and no Payee its Payee, then every vendor-linked
    expense with no Payee its vendor's -- or only for `vendors` and their expenses, which is what the
    tests pass so they never touch a vendor they did not plant. Commits nothing.

    Returns `{made: [payee], linked_vendors: int, linked_to_existing: int, linked_expenses: int,
    no_account: int, merged: [group], filled_names: [group], skipped: [{vendors, account_number,
    ifsc, reason}]}`; a group is `{payee, account_name, vendors: [{name, vendor_name, account_name}]}`.
    """
    result = {
        "made": [], "linked_vendors": 0, "linked_to_existing": 0, "linked_expenses": 0, "no_account": 0,
        "merged": [], "filled_names": [], "skipped": [],
    }
    if vendors is not None and not vendors:
        return result
    groups: dict[tuple[str, str], list[dict]] = {}
    for vendor in _vendors_without_payee(vendors):
        if not (vendor.account_number or "").strip():
            result["no_account"] += 1
            continue
        details = parse_details(vendor.account_name, vendor.account_number, vendor.ifsc)
        groups.setdefault((details.normalized_account, details.ifsc), []).append(vendor)

    for key in sorted(groups):
        _move_group(groups[key], result)

    result["linked_expenses"] = _link_expenses(vendors)
    return result


def summary(result: dict) -> list[str]:
    """What the patch logs: the counts, the merged Payees, the holder names taken from vendor names,
    then each skipped group and why."""
    lines = [
        f"{len(result['made'])} Payee(s) made; {result['linked_vendors']} vendor(s) linked "
        f"({result['linked_to_existing']} to a Payee already on record); {result['linked_expenses']} "
        f"expense(s) / expense request(s) given their vendor's Payee; {result['no_account']} vendor(s) "
        f"with no account number left without one; {len(result['skipped'])} group(s) skipped"
    ]
    lines += [
        f"merged {g['payee']} \"{g['account_name']}\": " + ", ".join(
            f"{v['name']} \"{v['vendor_name']}\" (holder \"{v['account_name'] or ''}\")" for v in g["vendors"]
        )
        for g in result["merged"]
    ]
    lines += [
        f"holder name taken from the vendor name: {g['payee']} \"{g['account_name']}\" "
        f"({', '.join(v['name'] for v in g['vendors'])})"
        for g in result["filled_names"]
    ]
    lines += [
        f"skipped {', '.join(s['vendors'])} (account {s['account_number']}, IFSC {s['ifsc'] or 'none'}), "
        f"left without a Payee: {s['reason']}"
        for s in result["skipped"]
    ]
    return lines


def _vendors_without_payee(vendors: list[str] | None) -> list:
    scope = "AND name IN %(vendors)s" if vendors is not None else ""
    return frappe.db.sql(
        f"""SELECT name, vendor_name, account_name, account_number, ifsc, bank_name, bank_branch
            FROM "tabVendors"
            WHERE COALESCE(payee, '') = '' {scope}
            ORDER BY creation, name""",
        {"vendors": tuple(vendors or ())},
        as_dict=True,
    )


def _clean(text) -> str:
    return parse_details(text, None, None).account_name


def _longest(values: list[str]) -> str:
    """The longest value; the first of equal ones."""
    return max(values, key=len, default="")


def _move_group(group: list[dict], result: dict) -> None:
    holders = [_clean(v.account_name) for v in group]
    filled = not any(holders)
    if filled:
        holders = [_clean(v.vendor_name) for v in group]
    holder = _longest(holders)
    keeper = group[holders.index(holder)]
    numbers = [parse_details(None, v.account_number, None).account_number for v in group]
    details = parse_details(holder, _longest(numbers), group[0].ifsc)
    names = [v.name for v in group]

    problem = details_problem(details)
    existing = None if problem else existing_payee(details)
    if existing and frappe.db.get_value(PAYEE_DOCTYPE, existing, "status") == INACTIVE:
        problem = f"its account and IFSC are Payee {existing}, which is Inactive."
    if problem:
        _skip(result, names, details, problem)
        return

    savepoint = f"payee_move_{frappe.generate_hash(length=8)}"
    frappe.db.savepoint(savepoint)
    try:
        if existing:
            payee, made = existing, False
            holder = frappe.db.get_value(PAYEE_DOCTYPE, existing, "account_name")
        else:
            bank = next((v for v in [keeper, *group] if (v.bank_name or "").strip()), keeper)
            payee, made = backfill_payee(details, bank.bank_name, bank.bank_branch).name, True
        frappe.db.sql(
            """UPDATE "tabVendors" SET payee = %(payee)s
               WHERE name IN %(names)s AND COALESCE(payee, '') = ''""",
            {"payee": payee, "names": tuple(names)},
        )
    except frappe.ValidationError as e:
        frappe.db.rollback(save_point=savepoint)
        _skip(result, names, details, str(e) or "refused")
        return

    result["linked_vendors"] += len(group)
    if made:
        result["made"].append(payee)
    else:
        result["linked_to_existing"] += len(group)
    entry = {
        "payee": payee,
        "account_name": holder,
        "vendors": [{"name": v.name, "vendor_name": v.vendor_name, "account_name": v.account_name} for v in group],
    }
    if len(group) > 1:
        result["merged"].append(entry)
    if filled and made:
        result["filled_names"].append(entry)


def _skip(result: dict, names: list[str], details, reason: str) -> None:
    result["skipped"].append({
        "vendors": names, "account_number": details.account_number, "ifsc": details.ifsc, "reason": reason,
    })


def _link_expenses(vendors: list[str] | None) -> int:
    """Give each vendor-linked Expense Request and Project Expense with no Payee its vendor's Payee.
    Returns how many were written."""
    scope = "AND x.vendor IN %(vendors)s" if vendors is not None else ""
    written = 0
    for doctype in VENDOR_LINKED_EXPENSES:
        written += len(frappe.db.sql(
            f"""UPDATE "tab{doctype}" x SET payee = v.payee
                FROM "tabVendors" v
                WHERE v.name = x.vendor AND COALESCE(v.payee, '') <> '' AND COALESCE(x.payee, '') = ''
                  {scope}
                RETURNING x.name""",
            {"vendors": tuple(vendors or ())},
        ))
    return written
