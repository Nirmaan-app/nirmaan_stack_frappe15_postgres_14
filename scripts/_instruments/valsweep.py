"""SLICE 12b(A) -- TEMPORARY, UNTRACKED. Validator sweep: every config in every asset on disk.

The standing rule before switching a gate on: sweep every asset on disk. A new refusal that lands on
a HISTORICAL asset is a defect in this slice, not in that asset.
"""
import glob
import json
import os
import sys

os.chdir("/workspace/development/frappe-bench/sites")
import frappe  # noqa: E402

frappe.init(site="localhost")
frappe.connect()

from nirmaan_stack.services.boq_rate_master import config_validation as CV  # noqa: E402

root = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_rate_master/data"
ok = 0
refused = []
for path in sorted(glob.glob(os.path.join(root, "rate_master_*.json"))):
    asset = json.load(open(path, encoding="utf-8"))
    for cfg in asset.get("category_configs") or []:
        c = dict(cfg)
        c.setdefault("discipline", asset.get("discipline"))
        try:
            CV._validate_config(c)
            ok += 1
        except Exception as e:  # noqa: BLE001
            refused.append((os.path.basename(path), c.get("category_id"), str(e)[:220]))

print("configs validated OK:", ok)
print("configs REFUSED:", len(refused))
for f, cid, msg in refused:
    print("   REFUSED", f, "|", cid, "|", msg)
frappe.destroy()
