"""Seed for `walk_cashbook_phrase.py` (#1758): two made-up Won projects and a Cashbook import whose courier spend's
remark names the first only through a phrase, then (`again`) the next upload of the same statement.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_phrase_seed.py seed <stamp>
    devenv.sh script <task> .claude/skills/verify/bin/cashbook_phrase_seed.py again <stamp> <stamp2>

THE PROJECTS. `QX Walkmall<stamp> Court` and `Walkmall<stamp> Annexe` share the word `walkmall<stamp>`, so it names
neither (the import drops a word two projects claim), and `qx` is too short to count: the courier spend's remark
"Courier charges for QX Walkmall<stamp> site" is booked Non Project, as "vr mall" is for `VR Mall Food Court`. Only a
learned phrase places it.

THE PRE-FILL (the owner's rule of 2026-11-26). For `Walkmall<stamp> Annexe` the remark's only run of its name's words,
`Walkmall<stamp>`, is a word `QX Walkmall<stamp> Court` holds too, so nothing is pre-filled. A third project,
`Walkmal<stamp> Depot`, has no word the remark spells exactly, so the box suggests the closest spelling,
`Walkmall<stamp>`.

`seed` makes the projects, the walk's two made-up users (as `cashbook_move_seed.py` does) and the import (the made-up
statement of the Cashbook tests, each Txn Id stamped, the job run inline with the bill download replaced). Prints
`txn:`, `batch:`, `project:`, `project_name:`, `other_project(_name):`, `near_project(_name):`, `remark:` and
`phrase:` (the words the box should
start with). `again` imports the statement once more under `<stamp2>`, the same remark, and prints `txn:` and
`batch:`. An env cannot reach the wallet's bill storage, so both imports are seeded, not uploaded. Writes only to the
env DB.
"""

import dataclasses
import sys
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import ONE_LINK, STATEMENT, _fake_bills
from nirmaan_stack.services.outflow_import.parser import parse_statement

MODE, STAMP = sys.argv[1], sys.argv[2]
WORD = f"Walkmall{STAMP}"
PHRASE = f"QX {WORD}"
#: One letter short of the remark's word: the third project's name, which no remark word spells exactly.
NEAR = f"Walkmal{STAMP}"
REMARK = f"Courier charges for {PHRASE} site"


def _users():
    for email, name, role in (
        ("walk-accountant@example.com", "Walk Accountant", "Nirmaan Accountant"),
        ("walk-accountant-lead@example.com", "Walk Accountant Lead", "Nirmaan Accountant Lead"),
    ):
        if not frappe.db.exists("User", email):
            user = frappe.new_doc("User")
            user.update({"email": email, "first_name": name, "send_welcome_email": 0})
            user.flags.no_welcome_mail = True
            user.insert(ignore_permissions=True)
        frappe.get_doc("User", email).add_roles(role)
        # Raw: `Nirmaan Users` is the app's user mirror; the walk only needs its profile, which feeds no recompute.
        frappe.db.set_value("Nirmaan Users", email, "role_profile", f"{role} Profile", update_modified=False)
    frappe.db.commit()


def _project(name: str) -> str:
    existing = frappe.db.get_value("Projects", {"project_name": name}, "name")
    if existing:
        return existing
    doc = frappe.new_doc("Projects")
    doc.project_name = name
    doc.tendering_status = "Won"
    doc.project_start_date = frappe.utils.now()[:19]
    doc.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    doc.project_scopes = {"scopes": []}
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


def _import(suffix: str) -> str:
    parsed = parse_statement(STATEMENT.read_bytes(), source="Cashbook")
    parsed = dataclasses.replace(
        parsed,
        rows=[
            dataclasses.replace(
                r, transfer_id=r.transfer_id + suffix, remarks=REMARK if r.transfer_id == ONE_LINK else r.remarks
            )
            for r in parsed.rows
        ],
    )
    batch = cb._stage(
        parsed, cb._build_plan(parsed), file_url="/private/files/walk-1758-statement.xlsx",
        filename=f"walk-1758-{suffix}.xlsx", user="Administrator",
    ).name
    frappe.db.commit()
    # No RQ worker on an env: nothing is queued.
    with patch.object(bills, "fetch_bill", _fake_bills()), patch.object(frappe, "enqueue", lambda *a, **k: None):
        cb._cashbook_worker(batch, "Administrator")
    frappe.db.commit()
    print(f"txn: {ONE_LINK + suffix}")
    print(f"batch: {batch}")
    return batch


if MODE == "seed":
    _users()
    project = _project(f"{PHRASE} Court")
    other = _project(f"{WORD} Annexe")
    near = _project(f"{NEAR} Depot")
    _import(f"P{STAMP}")
    print(f"project: {project}")
    print(f"project_name: {PHRASE} Court")
    print(f"other_project: {other}")
    print(f"other_project_name: {WORD} Annexe")
    print(f"near_project: {near}")
    print(f"near_project_name: {NEAR} Depot")
    print(f"remark: {REMARK}")
    print(f"phrase: {PHRASE}")
elif MODE == "again":
    _import(f"Q{sys.argv[3]}")
else:
    raise SystemExit(f"unknown mode {MODE!r}: seed or again")
