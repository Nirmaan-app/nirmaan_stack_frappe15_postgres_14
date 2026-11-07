"""Seed the Vendor Invoice Recon walk (`walk_vendor_invoice_recon.py`) on an env DB.

- `walk-accountant@example.com`, a made-up Accountant the app access gate leaves open (every Accountant copied
  from production holds an asset, so the gate locks them; see the skill's Gotchas).
- `walk-long-name@example.com`, a made-up user whose full name is too long for the "Invoice Added By" column.
- The two newest Pending Vendor Invoices get those uploaders: one the long-name user, one an email with no
  Nirmaan Users row (the column falls back to the email). So do the two newest Approved ones of each document
  type, for the PO and WO Invoices 2B Recon tabs ("Invoice Uploaded By", #1650).

    devenv.sh script <task> .claude/skills/verify/bin/vendor_invoice_recon_seed.py

Prints one JSON line: {"long_name": <invoice>, "email": <invoice>, "po_long_name", "po_email", "wo_long_name",
"wo_email": <invoice>} and the made-up users it used, which the walk
reads instead of its own copy. Idempotent: a second run picks the invoices it seeded before. Writes to the env DB only (its own commit). `uploaded_by` feeds no derived field, so a plain
`set_value` is enough.
"""

import json

import frappe

ACCOUNTANT = "walk-accountant@example.com"
LONG_USER = "walk-long-name@example.com"
LONG_NAME = "Walkerton Fairweather-Longbottom Montgomery"
NO_NAME_EMAIL = "walk-no-name-uploader.for-recon@example-builders.test"


def ensure_user(email: str, first: str, last: str, profile: str | None, roles: tuple[str, ...]) -> None:
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": first, "last_name": last, "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    if roles:
        frappe.get_doc("User", email).add_roles(*roles)
    # `Nirmaan Users` is created by User `after_insert`; the app's gates read its role profile, and the column reads
    # its full name. Skipping its `on_update` is fine: that only fills asset departments, which no walk reads.
    values = {"full_name": f"{first} {last}".strip()}
    if profile:
        values["role_profile"] = profile
    frappe.db.set_value("Nirmaan Users", email, values, update_modified=False)


ensure_user(ACCOUNTANT, "Walk", "Accountant", "Nirmaan Accountant Profile", ("Nirmaan Accountant",))
first, _, last = LONG_NAME.partition(" ")
ensure_user(LONG_USER, first, last, None, ())
assert not frappe.db.exists("Nirmaan Users", NO_NAME_EMAIL)


def seed(prefix: str, filters: dict) -> dict[str, str]:
    """Give the two newest invoices matching `filters` the made-up uploaders, or find the ones a past run gave."""
    def seeded(uploader: str) -> str | None:
        return frappe.db.get_value("Vendor Invoices", {**filters, "uploaded_by": uploader}, "name")

    picked = {f"{prefix}long_name": seeded(LONG_USER), f"{prefix}email": seeded(NO_NAME_EMAIL)}
    free = frappe.get_all("Vendor Invoices", filters={**filters, "uploaded_by": ["not in", [LONG_USER, NO_NAME_EMAIL]]},
                          order_by="creation desc", pluck="name")
    for key, uploader in ((f"{prefix}long_name", LONG_USER), (f"{prefix}email", NO_NAME_EMAIL)):
        if not picked[key]:
            picked[key] = free.pop(0)
            frappe.db.set_value("Vendor Invoices", picked[key], "uploaded_by", uploader, update_modified=False)
    return picked


picked = {
    **seed("", {"status": "Pending"}),
    # The 2B Recon tabs list only Approved invoices, one tab per document type (#1650).
    **seed("po_", {"status": "Approved", "document_type": "Procurement Orders"}),
    **seed("wo_", {"status": "Approved", "document_type": "Service Requests"}),
}

frappe.db.commit()
print(json.dumps({**picked, "accountant": ACCOUNTANT, "long_user": LONG_USER, "long_text": LONG_NAME,
                  "no_name_email": NO_NAME_EMAIL}))
