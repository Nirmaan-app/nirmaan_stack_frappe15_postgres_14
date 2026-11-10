"""Read what All Invoices shows (#1646). Read-only.

    devenv.sh script <task> .claude/skills/verify/bin/all_invoices_db.py <expense bill> [...] -- <porter invoice> [...]
    devenv.sh script <task> .claude/skills/verify/bin/all_invoices_db.py --file <file url>   # its Porter Invoice

Prints one line `ALL_INVOICES_DB {json}`: {"bills": {name: {...}}, "porter": {name: {...}}, "vendor_invoices":
{document_type: count}} -- the Vendor Invoices All Invoices' PO and WO pills count (status Pending, Approved or
Rejected), and the number of Porter Invoices.
"""

import json
import sys

import frappe

args = sys.argv[1:]
if args[:1] == ["--file"]:  # which Porter Invoice holds this file
    print("ALL_INVOICES_DB " + json.dumps({"file_owner": frappe.db.get_value("Porter Invoice", {"invoice_file": args[1]}, "name")}))
    sys.exit(0)
cut = args.index("--") if "--" in args else len(args)
bills, porters = args[:cut], args[cut + 1:]
answer = {
    "bills": {b: frappe.db.get_value("Expense Bill", b, ["expense", "is_latest", "bill_check", "status", "auto_approved",
                                                         "rejection_reason", "invoice_no", "read_total", "line_amount"],
                                      as_dict=True) for b in bills},
    "porter": {p: frappe.db.get_value("Porter Invoice", p, ["validation_status", "validation_message", "invoice_file"],
                                      as_dict=True) for p in porters},
    "vendor_invoices": dict(frappe.db.sql("""SELECT document_type, COUNT(*) FROM "tabVendor Invoices"
        WHERE status IN ('Pending', 'Approved', 'Rejected') GROUP BY document_type""")),
    "porter_count": frappe.db.count("Porter Invoice"),
    "porter_with_pdf": frappe.db.sql("""SELECT name, invoice_file FROM "tabPorter Invoice"
        WHERE COALESCE(invoice_file, '') != '' ORDER BY creation DESC LIMIT 1""", as_dict=True),
}
print("ALL_INVOICES_DB " + json.dumps(answer, default=str))
