# Runs inside a frappe container with env/bin/python: a cheap fingerprint of the live data, as fp_* lines.
# Two databases with the same fingerprint were restored from the same backup and have had no writes since
# (tabVersion grows on every tracked document change).
import os

os.chdir("/workspace/development/frappe-bench/sites")
import frappe  # noqa: E402

frappe.init(site="localhost")
frappe.connect()


def one(sql):
	try:
		return frappe.db.sql(sql)[0]
	except Exception:
		frappe.db.rollback()
		return ("ERR", "ERR")


items = one('select count(*), max(modified) from "tabBoQ Rate Master Item"')
snapshot = one('select name, modified from "tabBoQ Rate Master Snapshot" order by modified desc limit 1')
versions = one('select count(*), max(creation) from "tabVersion"')
print(f"fp_rm_items={items[0]} (newest {items[1]})")
print(f"fp_rm_snapshot={snapshot[0]}")
print(f"fp_versions={versions[0]} (newest {versions[1]})")
frappe.destroy()
