"""Seed the Office Rent walk (`walk_office_rent.py`) on an env DB: two made-up role users the app access gate
leaves open, an HR Executive and an Accountant, and a made-up landlord's Payee for "Who gets paid" (adding
one on screen looks its IFSC up outside the env), and Frappe's Home file folder if the env lacks it. Every HR Executive and Accountant copied from production holds
an asset, so the gate locks them (see the skill's Gotchas). Admin and the CEO are real users the gate leaves
open (`free_users.py`); the walk gives them passwords on the env DB only.

    devenv.sh script <task> .claude/skills/verify/bin/office_rent_seed.py

Idempotent: a second run leaves the users as they are. Writes to the env DB only (its own commit).
"""

import frappe

USERS = {
    "walk-hr@example.com": ("Nirmaan HR Executive Profile", ("Nirmaan HR Executive",)),
    "walk-accountant@example.com": ("Nirmaan Accountant Profile", ("Nirmaan Accountant",)),
}

for email, (profile, roles) in USERS.items():
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": email.split("@")[0].replace("-", " ").title(),
                     "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    user = frappe.get_doc("User", email)
    user.add_roles(*roles)
    # `Nirmaan Users` is created by User `after_insert`; the app's gates read its role profile.
    frappe.db.set_value("Nirmaan Users", email, "role_profile", profile, update_modified=False)
    print(f"{email}: {profile}")

#: The landlord's bank account the HR Executive picks. Made up: no real account or bank branch.
PAYEE = {"account_name": "Walk Landlord Account", "account_number": "990001613118", "ifsc": "WALK0001613",
         "bank_name": "Walk Test Bank", "bank_branch": "Walk Branch", "payee_type": "Others"}
if not frappe.db.exists("Payee", {"account_number": PAYEE["account_number"]}):
    frappe.get_doc({"doctype": "Payee", **PAYEE}).insert(ignore_permissions=True)
print(f"payee: {frappe.db.get_value('Payee', {'account_number': PAYEE['account_number']}, 'name')}")

# The env DB's copy has no File folder "Home", so every upload fails ("Could not find Folder: Home") and the
# walk's Mark Reconciled cannot attach its receipt. Frappe's own installer step makes it (Home, Attachments).
if not frappe.db.exists("File", "Home"):
    from frappe.core.doctype.file.utils import make_home_folder

    make_home_folder()
print(f"home folder: {bool(frappe.db.exists('File', 'Home'))}")

frappe.db.commit()
