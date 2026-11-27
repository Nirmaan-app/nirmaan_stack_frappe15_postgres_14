"""Seed the Software Developer walk (ADR-0051) on an env DB: a made-up developer and a made-up Accountant to rename.

    devenv.sh script <task> .claude/skills/verify/bin/software_developer_seed.py

Both get their role profile the way the Users screen gives it (on the Frappe User), so their Roles and their
`Nirmaan Users.role_profile` copy are what the app writes. Re-running changes nothing. Commits to the env DB only.
"""

import frappe

DEVELOPER = "dev.walker@example.com"
TARGET = "rename.target@example.com"
PEOPLE = (
    (DEVELOPER, "Devi", "Walker", "Nirmaan Software Developer Profile"),
    (TARGET, "Rena", "Target", "Nirmaan Accountant Profile"),
)

for email, first, last, profile in PEOPLE:
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": first, "last_name": last, "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    user = frappe.get_doc("User", email)
    if user.role_profile_name != profile:
        user.role_profile_name = profile
        user.save(ignore_permissions=True)
frappe.db.commit()
for email, *_ in PEOPLE:
    print(email, frappe.db.get_value("Nirmaan Users", email, "role_profile"))
