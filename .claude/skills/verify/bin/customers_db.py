"""Read Customers rows for `walk_customers.py` (#1694). Read-only: commits nothing.

    devenv.sh script <task> .claude/skills/verify/bin/customers_db.py list
    devenv.sh script <task> .claude/skills/verify/bin/customers_db.py customer <customer id>
    devenv.sh script <task> .claude/skills/verify/bin/customers_db.py by-company <company name>
    devenv.sh script <task> .claude/skills/verify/bin/customers_db.py pincode

Prints one JSON line:
  list        the customer count and the ten newest customers, as the list page sorts them (creation desc), each
              with its age in seconds (the list's server cache holds a page for 5 minutes);
  customer    one customer's row, its Address and its project counts (all, and WIP), as the customer page shows them;
  by-company  the same for the customers with that company name (a walk's made-up one), as a list;
  pincode     one Pincodes row with a city and state, for the create form.
"""

from __future__ import annotations

import json
import sys

import frappe
from frappe.utils import now_datetime

LIST_FIELDS = ["name", "company_name", "customer_nickname", "company_contact_person", "company_phone",
               "company_email", "creation"]
ADDRESS_FIELDS = ["address_line1", "address_line2", "city", "state", "pincode"]


def customer(name: str) -> dict | None:
    """The customer's row, address and project counts; None when no Customers row has that ID."""
    row = frappe.db.get_value("Customers", name, ["*"], as_dict=True)
    if row is None:
        return None
    address = (frappe.db.get_value("Address", row.company_address, ADDRESS_FIELDS, as_dict=True)
               if row.company_address else None)
    return {
        "customer": row,
        "address": address,
        "projects": frappe.db.count("Projects", {"customer": name}),
        "active_projects": frappe.db.count("Projects", {"customer": name, "status": "WIP"}),
    }


mode, *args = sys.argv[1:]
if mode == "list":
    newest = frappe.get_all("Customers", fields=LIST_FIELDS, order_by="creation desc", limit=10)
    for row in newest:
        row["age_sec"] = int((now_datetime() - row.creation).total_seconds())
    out = {"total": frappe.db.count("Customers"), "newest": newest}
elif mode == "customer":
    out = customer(args[0])
    if out is None:
        sys.exit(f"customers_db: no Customers row with ID {args[0]!r}")
elif mode == "by-company":
    out = {"rows": [customer(n) for n in frappe.get_all("Customers", {"company_name": args[0]}, pluck="name")]}
elif mode == "pincode":
    rows = frappe.db.sql(
        """select pincode, city, state from "tabPincodes"
           where coalesce(city, '') != '' and coalesce(state, '') != '' and length(pincode) = 6
           order by pincode limit 1""",
        as_dict=True,
    )
    if not rows:
        sys.exit("customers_db: no Pincodes row with a 6-digit PIN, a city and a state")
    out = rows[0]
else:
    sys.exit(f"customers_db: unknown mode {mode!r}")
print(json.dumps(out, default=str))
