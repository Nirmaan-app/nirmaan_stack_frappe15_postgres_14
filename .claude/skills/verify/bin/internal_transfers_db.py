"""Read what the Internal Transfers walk checks on screen, as JSON (#1619). Read-only.

    devenv.sh script <task> .claude/skills/verify/bin/internal_transfers_db.py [<line>]

`tab`: Internal Transfer lines the main table shows (every source; a card spend never is one). `figure`: the
summary's Internal transfers figure, all time: lines, and the money their records moved out and in (refused
transfers left out, as the panel does). `moved_kinds_skipped`: Skipped lines still under a moved Skip Type. With
<line>: that line's status, note and record.
"""

import json
import sys

import frappe

tab = frappe.db.sql("""select count(*) from "tabOutflow Import Row" where row_status = 'Internal Transfer'""")[0][0]
fig = frappe.db.sql(
    """select count(*), coalesce(sum(case when it.direction='Out' then it.amount else 0 end), 0),
              coalesce(sum(case when it.direction='In' then it.amount else 0 end), 0)
       from "tabOutflow Import Row" r left join "tabInternal Transfer" it on it.import_row = r.name
       where r.row_status = 'Internal Transfer' and upper(trim(coalesce(r.status_raw, ''))) = 'SUCCESS'"""
)[0]
moved = frappe.db.sql(
    """select skip_kind, count(*) from "tabOutflow Import Row" where row_status = 'Skipped'
       and skip_kind in ('Cashfree wallet top-up','Cashbook wallet top-up','Porter wallet top-up',
       'Wallet money returned','Bank internal transfer','Credit card bill payment','Credit card auto-debit')
       group by 1"""
)
out = {"tab": int(tab), "figure": [int(fig[0]), float(fig[1]), float(fig[2])], "moved_kinds_skipped": dict(moved)}
if len(sys.argv) > 1:
    line = frappe.db.get_value("Outflow Import Row", sys.argv[1], ["row_status", "outcome_note", "decided_by"],
                               as_dict=True)
    rec = frappe.get_all("Internal Transfer", filters={"import_row": sys.argv[1]},
                         fields=["from_place", "to_place", "made_by", "marked_by", "mark_reason"])
    out["line"] = {**line, "records": rec}
print("JSON:" + json.dumps(out, default=str))
