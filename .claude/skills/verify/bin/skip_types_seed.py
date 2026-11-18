"""One made-up skipped bank line for `walk_skip_types.py` (#1628): an ICICI Bank Statement line Skipped as "Failed
payment bounced back" (a bank-rule kind that stays), in the env's latest ICICI import. Its Txn Id and remark carry
`<stamp>`. The env holds no such line, so the Unskip warning has one to show. Writes that line to the env DB only.

    devenv.sh script <task> .claude/skills/verify/bin/skip_types_seed.py <stamp>

Prints `line:`, `txn:` and `remark:`.
"""

import sys

import frappe

STAMP = sys.argv[1]
batch = frappe.get_all(
    "Outflow Import Batch", filters={"source": "ICICI Bank Statement"}, order_by="creation desc", limit=1, pluck="name"
)[0]
txn = f"WALK1628X{STAMP}"
remark = f"NEFT RETURN Walk 1628 bounced {STAMP}"
row = frappe.new_doc("Outflow Import Row")
row.update(
    {
        "import_batch": batch,
        "source": "ICICI Bank Statement",
        "transfer_id": txn,
        "bank_reference_no": txn,
        "amount": 1628.0,
        "status_raw": "SUCCESS",
        "direction": "Credit",
        "remarks": remark,
        "beneficiary_name": "Testvendor Bounce",
        "row_status": "Skipped",
        "skip_origin": "System",
        "skip_kind": "Failed payment bounced back",
        "skip_reason": "Not spending -- this line is money moving inside the bank or between our own accounts. "
        "Excluded by bank-statement rule 'neft_return_failed'.",
    }
)
row.insert(ignore_permissions=True)
frappe.db.commit()
print(f"line: {row.name}")
print(f"txn: {txn}")
print(f"remark: {remark}")
