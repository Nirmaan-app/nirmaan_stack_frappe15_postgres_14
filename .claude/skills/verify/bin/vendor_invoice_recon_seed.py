"""Seed the Vendor Invoice Recon walk (`walk_vendor_invoice_recon.py`) on an env DB.

- `walk-accountant@example.com`, a made-up Accountant the app access gate leaves open (every Accountant copied
  from production holds an asset, so the gate locks them; see the skill's Gotchas).
- `walk-long-name@example.com`, a made-up user whose full name is too long for the "Invoice Added By" column.
- The two newest Pending Vendor Invoices get those uploaders: one the long-name user, one an email with no
  Nirmaan Users row (the column falls back to the email).

    devenv.sh script <task> .claude/skills/verify/bin/vendor_invoice_recon_seed.py

Prints one JSON line: {"long_name": <invoice>, "email": <invoice>}. Idempotent: a second run picks the invoices it
seeded before. Writes to the env DB only (its own commit). `uploaded_by` feeds no derived field, so a plain
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
    # `Nirmaan Users` is created by User `after_insert`; the app's gates read its role profile.
    values = {"full_name": f"{first} {last}".strip()}
    if profile:
        values["role_profile"] = profile
    frappe.db.set_value("Nirmaan Users", email, values, update_modified=False)


ensure_user(ACCOUNTANT, "Walk", "Accountant", "Nirmaan Accountant Profile", ("Nirmaan Accountant",))
first, _, last = LONG_NAME.partition(" ")
ensure_user(LONG_USER, first, last, None, ())
assert not frappe.db.exists("Nirmaan Users", NO_NAME_EMAIL)


def seeded(uploader: str) -> str | None:
    return frappe.db.get_value("Vendor Invoices", {"status": "Pending", "uploaded_by": uploader}, "name")


picked = {"long_name": seeded(LONG_USER), "email": seeded(NO_NAME_EMAIL)}
free = frappe.get_all("Vendor Invoices", filters={"status": "Pending", "uploaded_by": ["not in", [LONG_USER, NO_NAME_EMAIL]]},
                      order_by="creation desc", pluck="name")
for key, uploader in (("long_name", LONG_USER), ("email", NO_NAME_EMAIL)):
    if not picked[key]:
        picked[key] = free.pop(0)
        frappe.db.set_value("Vendor Invoices", picked[key], "uploaded_by", uploader, update_modified=False)

frappe.db.commit()
print(json.dumps(picked))
