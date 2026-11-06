#!/usr/bin/env python3
"""Worked example of a feature walk: Purchase Orders as a Procurement Executive.

    python3 .claude/skills/verify/bin/walk_purchase_orders.py --task <task> --user <email> --password <pw>

Sidebar "Purchase Orders" -> the "Delivered PO" tab -> the first PO's link -> its page. It saves three steps of
evidence and prints the PO id and the evidence folder. Check the page's figures against the DB with
`devenv.sh script <task> .claude/skills/verify/bin/po_db.py <po id>`.
"""

import argparse
import re

from drive import save, session, sidebar

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--user", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

with session(a.task, a.user, a.password) as (page, out):
    sidebar(page, "Purchase Orders")
    page.get_by_role("button", name=re.compile(r"^All POs \d+$")).wait_for()
    save(page, out, "01-po-list")

    page.get_by_role("button", name=re.compile(r"^Delivered PO \d+$")).click()
    page.wait_for_url(re.compile(r"tab=Delivered\+PO"))
    page.wait_for_load_state("networkidle")
    save(page, out, "02-delivered-tab")

    link = page.get_by_role("link", name=re.compile(r"^PO\/")).first
    po = link.inner_text()
    link.click()
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    page.get_by_text("PO Details").wait_for()
    save(page, out, "03-po-page")
    print(f"po: {po}")
    print(f"evidence: {out}")
