"""Read and set what the BoQ screen walks of spec #1654 need from the env DB (#1666-#1668), from the host.

    devenv.sh script <task> .claude/skills/verify/bin/bgops_boq_state.py ai-off
    devenv.sh script <task> .claude/skills/verify/bin/bgops_boq_state.py ai-set <value>
    devenv.sh script <task> .claude/skills/verify/bin/bgops_boq_state.py parse-flags <boq> [<sheet>]
    devenv.sh script <task> .claude/skills/verify/bin/bgops_boq_state.py hold-queue <seconds>

`ai-off` switches the BoQ AI setting off and prints `BGOPS {"before": <value>}` (the env holds a real AI key; the
walks call no provider); `ai-set` puts a value back. `parse-flags` prints the BoQ's parse flag and job id and, for the
sheet, its draft's parse and check flags (read-only). `hold-queue` queues Frappe's own sleep job
(`background_jobs.test_job`) on the env's `long` queue, so an operation queued after it waits that long for a worker
(the suggest walk uses it to keep a match queued long enough for the screen's poll to see it).
"""

import json
import sys

import frappe

from nirmaan_stack.api.boq.wizard.ai_settings import SETTINGS_DOCTYPE

cmd, args = sys.argv[1], sys.argv[2:]
if cmd == "ai-off":
    before = frappe.db.get_single_value(SETTINGS_DOCTYPE, "enabled")
    frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", 0)
    frappe.db.commit()
    frappe.clear_cache(doctype=SETTINGS_DOCTYPE)
    print("BGOPS " + json.dumps({"before": before}))
elif cmd == "ai-set":
    frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", int(args[0]))
    frappe.db.commit()
    frappe.clear_cache(doctype=SETTINGS_DOCTYPE)
    print("BGOPS " + json.dumps({"enabled": int(args[0])}))
elif cmd == "parse-flags":
    boq = args[0]
    out = {"boq": frappe.db.get_value("BOQs", boq, ["parse_in_progress", "parse_job_id"], as_dict=True)}
    if len(args) > 1:
        out["sheet"] = frappe.db.get_value("BoQ Sheet Draft", {"parent": boq, "sheet_name": args[1]},
                                           ["wizard_status", "parse_in_progress", "ai_in_progress"], as_dict=True)
    print("BGOPS " + json.dumps(out, default=str))
elif cmd == "hold-queue":
    frappe.enqueue("frappe.utils.background_jobs.test_job", queue="long", s=int(args[0]))
    print("BGOPS " + json.dumps({"held_s": int(args[0])}))
else:
    sys.exit(f"unknown command {cmd}")
