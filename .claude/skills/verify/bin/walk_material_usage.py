"""Walk a project's Material Usage tab with incoming Internal Transfer Memos (graduated from PR #1731's walk).

    python3 -I .claude/skills/verify/bin/walk_material_usage.py <env> <out dir> [mu_admin | mu_lead ...]

It picks a project and item with PO quantity, an incoming ITM (Approved or later, from another project) and a
Delivery Challan filed against that ITM, and reads every expected number from the env DB first (db/facts.txt).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import FeatureWalk, open_project, pin, settle  # noqa: E402

fw = FeatureWalk("Material Usage with incoming ITMs", "material-usage.md")
w = fw.w
w.change("mu_ordered", "Material Usage › Ordered Qty counts ITMs",
         "Ordered Qty = PO qty + ITM qty, counting an ITM from status Approved onward. Hovering shows the split: "
         "PO Ordered Quantity / Internal Transfer Memo Qty.")
w.change("mu_numbers", "Material Usage › PO / ITM Number(s)",
         "ITM ids are listed with the POs (\"2 POs · 1 ITM\"). An ITM's paid badge reads Fully Paid once Delivered, "
         "Unpaid before that.")
w.change("mu_docs", "Material Usage › DCs / MIRs include ITM documents",
         "The DC popover lists documents filed against an ITM, each with an ITM tag and a link to the ITM.")
w.change("mu_powise", "Material Usage › PO/ITM Wise tab",
         "ITMs get their own rows, and a Type column (PO / ITM filter) is the second column. ITM rows show "
         "\"From <source project>\" and \"-\" for Rate.")

facts = fw.db("facts", r'''
ITM_OK = ("Approved", "Dispatched", "Partially Delivered", "Delivered")
PO_OUT = ("Merged", "Inactive", "PO Amendment")
pairs = frappe.db.sql("""
SELECT itm.target_project p, i.item_id, MAX(itm.creation) latest
FROM "tabInternal Transfer Memo Item" i JOIN "tabInternal Transfer Memo" itm ON itm.name = i.parent
WHERE itm.status IN %(ok)s AND COALESCE(itm.source_project, '') != ''
  AND EXISTS (SELECT 1 FROM "tabPO Delivery Documents" d JOIN "tabDC Item" di ON di.parent = d.name
              WHERE d.parent_doctype = 'Internal Transfer Memo' AND d.parent_docname = itm.name
                AND d.type = 'Delivery Challan' AND di.item_id = i.item_id)
  AND (SELECT COUNT(DISTINCT pi.category) FROM "tabPurchase Order Item" pi JOIN "tabProcurement Orders" po ON po.name = pi.parent
       WHERE po.project = itm.target_project AND pi.item_id = i.item_id AND po.status NOT IN %(out)s) = 1
GROUP BY itm.target_project, i.item_id ORDER BY latest DESC, i.item_id
""", {"ok": ITM_OK, "out": PO_OUT}, as_dict=1)
pick = next(r for r in pairs if frappe.db.count("Items", {"item_name": frappe.db.get_value("Items", r.item_id, "item_name")}) == 1
            and candidates("Nirmaan Procurement Lead Profile", [r.p]))
P, ITEM = pick.p, pick.item_id
po_rows = frappe.db.sql("""SELECT po.name, SUM(pi.quantity) q FROM "tabPurchase Order Item" pi
    JOIN "tabProcurement Orders" po ON po.name = pi.parent
    WHERE po.project = %s AND pi.item_id = %s AND po.status NOT IN %s GROUP BY po.name""", (P, ITEM, PO_OUT), as_dict=1)
itms = frappe.db.sql("""SELECT itm.name, itm.status, SUM(i.transfer_quantity) q FROM "tabInternal Transfer Memo Item" i
    JOIN "tabInternal Transfer Memo" itm ON itm.name = i.parent
    WHERE itm.target_project = %s AND i.item_id = %s AND itm.status IN %s GROUP BY itm.name, itm.status ORDER BY itm.name""",
    (P, ITEM, ITM_OK), as_dict=1)
itm_dcs = frappe.db.sql("""SELECT DISTINCT d.name, d.parent_docname itm FROM "tabPO Delivery Documents" d
    JOIN "tabDC Item" di ON di.parent = d.name
    WHERE d.project = %s AND d.parent_doctype = 'Internal Transfer Memo' AND d.type = 'Delivery Challan' AND di.item_id = %s""",
    (P, ITEM), as_dict=1)
itm = next(r.name for r in itms if r.name in {d.itm for d in itm_dcs})
whole = frappe.db.sql("""SELECT SUM(i.transfer_quantity) q, MAX(src.project_name) src FROM "tabInternal Transfer Memo Item" i
    JOIN "tabInternal Transfer Memo" itm ON itm.name = i.parent LEFT JOIN "tabProjects" src ON src.name = itm.source_project
    WHERE itm.name = %s""", itm, as_dict=1)[0]
emit({
    "project": P, "project_name": frappe.db.get_value("Projects", P, "project_name"),
    "item_id": ITEM, "item_name": frappe.db.get_value("Items", ITEM, "item_name"),
    "po_qty": float(sum(r.q for r in po_rows)), "n_pos": len(po_rows),
    "itms": [{"name": r.name, "status": r.status, "qty": float(r.q)} for r in itms],
    "itm_qty": float(sum(r.q for r in itms)),
    "itm_dcs": [dict(d) for d in itm_dcs],
    "itm_count": frappe.db.count("Internal Transfer Memo", {"target_project": P, "status": ["in", ITM_OK]}),
    "itm": itm, "itm_total_qty": float(whole.q), "itm_source": whole.src,
    "admins": candidates("Nirmaan Admin Profile"),
    "leads": candidates("Nirmaan Procurement Lead Profile", [P]),
})
''')
PROJECT, ITEM = facts["project_name"], facts["item_name"]
WANT_ORDERED = facts["po_qty"] + facts["itm_qty"]


def plural(n: int, word: str) -> str:
    return f"{n} {word}{'s' if n > 1 else ''}"


WANT_LABEL = f"{plural(facts['n_pos'], 'PO')} · {plural(len(facts['itms']), 'ITM')}"


def num(s: str) -> float:
    return float(s.replace(",", "").replace("₹", "").strip())


def popper(page):
    return page.locator("[data-radix-popper-content-wrapper]").first


def col(page, name: str) -> int:
    heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
    return next(i for i, h in enumerate(heads) if h.startswith(name))


def open_material_usage(page, role: str, user: str) -> None:
    open_project(page, PROJECT)
    w.step(page, "mu_ordered", "after", role, user, f"{role}: Projects › {PROJECT}. Open its Material Usage tab.",
           click=page.get_by_role("button", name="Material Usage", exact=True))
    settle(page, 2500)


def item_cells(page) -> tuple:
    page.get_by_placeholder(re.compile("Search", re.I)).first.fill(ITEM)
    page.wait_for_timeout(2000)
    row = page.locator("tbody tr").filter(has=page.get_by_role("cell", name=ITEM, exact=True)).first
    return row, [c.strip() for c in row.locator("td").all_inner_texts()]


def mu_admin() -> None:
    role = "Admin"
    user = fw.user(role, facts["admins"])
    with fw.session(user) as page:
        open_material_usage(page, role, user)
        row, cells = item_cells(page)
        i_ord, i_num, i_dcs = col(page, "Ordered Qty"), col(page, "PO / ITM Number"), col(page, "DCs")
        ordered = num(cells[i_ord])
        row.locator("td").nth(i_ord).locator("span.underline").first.hover()
        page.wait_for_timeout(800)
        m = re.search(r"PO Ordered Quantity\s*([\d.,]+)\s*Internal Transfer Memo Qty\s*([\d.,]+)", popper(page).inner_text())
        po_q, itm_q = (num(m.group(1)), num(m.group(2))) if m else (None, None)
        w.check("mu_ordered", role, f"ITM part = DB ITM qty {facts['itm_qty']:g} (ITM status Approved or later)",
                f"tooltip ITM {itm_q}", itm_q is not None and abs(itm_q - facts["itm_qty"]) < 0.01)
        w.check("mu_ordered", role, f"PO part = DB PO qty {facts['po_qty']:g}", f"tooltip PO {po_q}",
                po_q is not None and abs(po_q - facts["po_qty"]) < 0.01)
        w.check("mu_ordered", role, f"Ordered Qty = PO + ITM = {WANT_ORDERED:g}", cells[i_ord],
                abs(ordered - WANT_ORDERED) < 0.01)
        w.step(page, "mu_ordered", "after", role, user,
               f"{ITEM}: Ordered Qty {cells[i_ord]}. Hovering splits it: PO {m.group(1) if m else '?'} + "
               f"ITM {m.group(2) if m else '?'}.", pins=[pin(popper(page), "The PO / ITM split.", "info")])
        page.mouse.move(5, 5)
        page.wait_for_timeout(500)

        trig = row.locator("td").nth(i_num).get_by_role("button").first
        label = trig.inner_text().strip()
        w.check("mu_numbers", role, f"PO / ITM Number(s) reads \"{WANT_LABEL}\" (DB)", label, label == WANT_LABEL)
        trig.hover()
        page.wait_for_timeout(800)
        tip = popper(page).inner_text()
        badge_ok, seen = True, []
        for itm in facts["itms"]:
            mm = re.search(re.escape(itm["name"]) + r".*?·\s*([A-Za-z ]+?)\s*\n\s*(Fully Paid|Unpaid|Partially Paid)",
                           tip, re.S)
            want = "Fully Paid" if itm["status"] == "Delivered" else "Unpaid"
            seen.append(f"{itm['name']} {itm['status']}: {mm.group(2) if mm else 'not listed'}")
            badge_ok &= bool(mm) and mm.group(2) == want
        w.check("mu_numbers", role, "each ITM listed; badge Fully Paid once Delivered, Unpaid before", "; ".join(seen),
                badge_ok)
        w.step(page, "mu_numbers", "after", role, user,
               f"\"{label}\". Hovering lists each PO, and each ITM with its source project and paid badge.",
               pins=[pin(popper(page), "POs and ITMs", "info")])
        page.keyboard.press("Escape")
        page.mouse.move(5, 5)
        popper(page).wait_for(state="detached", timeout=5000)

        dcs = row.locator("td").nth(i_dcs).get_by_role("button")
        w.step(page, "mu_docs", "after", role, user, f"DCs shows {dcs.inner_text().strip()}. Open it.", click=dcs)
        settle(page, 800)
        dlg = page.get_by_role("dialog")
        listed = []
        for doc in facts["itm_dcs"]:
            tr = dlg.locator("tr").filter(has=page.get_by_role("link", name=doc["itm"], exact=True)).first
            listed.append(tr.count() > 0 and "ITM" in tr.inner_text())
        w.check("mu_docs", role, f"every DC filed against an ITM for this item (DB: {len(facts['itm_dcs'])}) is listed, "
                "tagged ITM, linking to its ITM", f"{sum(listed)} of {len(listed)}", all(listed) and listed)
        first = dlg.locator("tr").filter(has=page.get_by_role("link", name=facts["itm_dcs"][0]["itm"], exact=True)).first
        w.step(page, "mu_docs", "after", role, user, "The challan filed against the ITM is listed, tagged ITM, with a "
               "link to the ITM.", pins=[pin(first, "ITM tag and link", "info")])
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        page.get_by_placeholder(re.compile("Search", re.I)).first.fill("")
        w.step(page, "mu_powise", "after", role, user, "Open the PO/ITM Wise view.",
               click=page.get_by_role("button", name="PO/ITM Wise", exact=True))
        settle(page, 2500)
        named = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts() if h.strip()]
        w.check("mu_powise", role, "Type is the column after PO / ITM Number", " | ".join(named[:3]),
                named[:2] == ["PO / ITM Number", "Type"])
        type_hdr = page.get_by_role("columnheader", name=re.compile(r"^Type"))
        w.step(page, "mu_powise", "after", role, user, "Open the Type filter.", click=type_hdr.locator("svg").first)
        settle(page, 600)
        w.step(page, "mu_powise", "after", role, user, "Filter to ITM.", click=page.get_by_role("option", name="ITM"))
        page.keyboard.press("Escape")
        settle(page, 1500)
        i_type, i_ven, i_ord, i_rate = (col(page, n) for n in ("Type", "Vendor", "Ordered Qty", "Rate"))
        rows = [[c.strip() for c in r.locator("td").all_inner_texts()] for r in page.locator("tbody tr").all()]
        itm_rows = [r for r in rows if len(r) > i_type and r[i_type] == "ITM"]
        w.check("mu_powise", role, f"Type = ITM shows every incoming ITM (DB: {facts['itm_count']})",
                f"{len(itm_rows)} ITM rows of {len(rows)}", len(itm_rows) == len(rows) == facts["itm_count"])
        w.step(page, "mu_powise", "after", role, user, f"Type = ITM: {len(itm_rows)} rows, one per incoming ITM.")

        page.get_by_placeholder(re.compile("Search", re.I)).first.fill(facts["itm"])
        settle(page, 1500)
        r = page.locator("tbody tr").filter(has_text=facts["itm"]).first
        c = [x.strip() for x in r.locator("td").all_inner_texts()]
        w.check("mu_powise", role, f"{facts['itm']} shows \"From {facts['itm_source']}\" and \"-\" for Rate",
                f"Vendor \"{c[i_ven]}\", Rate \"{c[i_rate]}\"", c[i_ven] == f"From {facts['itm_source']}" and c[i_rate] == "-")
        w.check("mu_powise", role, f"its Ordered Qty = DB transfer qty {facts['itm_total_qty']:.2f}", c[i_ord],
                abs(num(c[i_ord]) - facts["itm_total_qty"]) < 0.01, kind="nit")
        w.step(page, "mu_powise", "after", role, user, f"{facts['itm']}: Type ITM, \"{c[i_ven]}\", Rate \"{c[i_rate]}\".",
               pins=[pin(r.locator("td").nth(i_ven), "Source project", "info")])


def mu_lead() -> None:
    role = "Procurement Lead"
    user = fw.user(role, facts["leads"])
    with fw.session(user) as page:
        open_material_usage(page, role, user)
        row, cells = item_cells(page)
        i_ord, i_num = col(page, "Ordered Qty"), col(page, "PO / ITM Number")
        w.check("mu_ordered", role, f"Ordered Qty = PO + ITM = {WANT_ORDERED:g}", cells[i_ord],
                abs(num(cells[i_ord]) - WANT_ORDERED) < 0.01)
        w.check("mu_numbers", role, f"PO / ITM Number(s) reads \"{WANT_LABEL}\"", cells[i_num], cells[i_num] == WANT_LABEL)
        w.step(page, "mu_ordered", "after", role, user, f"As {role}: Ordered {cells[i_ord]}, \"{cells[i_num]}\".",
               pins=[pin(row, ITEM, "info")])


fw.run([("mu_ordered", mu_admin), ("mu_ordered", mu_lead)])
fw.finish()
