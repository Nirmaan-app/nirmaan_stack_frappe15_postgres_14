"""Walk branch feat/po-dcmir-item-wise (a DC-wise | Item-wise switch on the PO and ITM pages' "Delivery Challans &
MIRs" card) on its env and on an env of develop, before vs after. The branch has no PR: its claims are its feature
commits and the owner's decisions of 2026-11-26. The owner's last ruling: develop's rules only. The PO card uses
develop's PO DN > DC rule, the ITM card develop's ITM rule (the Transfer Memos report's), with "–" on the ITM card for
an item with nothing received and no DC; both project reports give the same statuses as on develop. The walk also
checks the two nits of the first walk are fixed: a DC with no Ref No. is named by its DC-wise S.No., and the Item-wise
layout fits the card (no sideways scroll at 768 px with the sidebar open).

    python3 .claude/skills/pr-walk/bin/walk_branch_po_dcmir_item_wise.py <out dir> --after <env> --before <env> \
        --admin <email> --pe <email> --pm <email> --pmo <email> [--password <pw>] [function ...]

Run it from the checkout root with both envs served and the four users' passwords set on both. Pick the Procurement
Executive and the Project Manager with the verify skill's `free_users.py`; the walk prefers records on a project
both of them see. Every record is picked by query at the start of the run (FACTS below, saved under db/), never by a
fixed id, and every quantity and status the walk checks on screen is recomputed here from the env's own rows
(PO / ITM items, `PO Delivery Documents`, `DC Item`), not copied from the screen. It writes nothing.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parents[1] / "verify" / "bin"))
sys.path.insert(0, str(HERE))
from drive import session  # noqa: E402
from record import Walk, pin  # noqa: E402

DEVENV = str(ROOT / "scripts/devenv/devenv.sh")
CARD_TITLE = "Delivery Challans & MIRs"
SWITCH = "Delivery Challans & MIRs view"

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("only", nargs="*")
ap.add_argument("--after", required=True, help="the env on the branch")
ap.add_argument("--before", required=True, help="the env on develop at the branch's base")
ap.add_argument("--admin", required=True)
ap.add_argument("--pe", required=True, help="a Procurement Executive")
ap.add_argument("--pm", required=True, help="a Project Manager")
ap.add_argument("--pmo", required=True, help="a PMO Executive")
ap.add_argument("--password", default="WalkPw-DcMir")
ap.add_argument("--data-note", required=True, help="where the envs' data came from, as devenv.sh create printed it")
ap.add_argument("--one-lane", action="store_true",
                help="a machine with one published vite port: walk every \"before\" screen first with only the before "
                     "env served, then stop it and serve the after env for the rest (one switch; the walk serves them)")
a = ap.parse_args()
ENVS = {"after": a.after, "before": a.before}
USERS = {"Admin": a.admin, "Procurement Executive": a.pe, "Project Manager": a.pm, "PMO Executive": a.pmo}
out = Path(a.out)

w = Walk(out, pr={"number": "feat/po-dcmir-item-wise", "title": "Item-wise DC & MIR on the PO and ITM pages",
                  "url": "", "author": "", "head": "30c45081d", "base": "31d29db45"},
         envs=ENVS, data_note=a.data_note)

w.change("po_switch", "1 · PO page: DC-wise | Item-wise switch, opening on DC-wise",
         "Procurement Orders › PO › PO Attachments › \"Delivery Challans & MIRs\": a DC-wise | Item-wise switch on its "
         "own row under the card header; the card opens on DC-wise, and DC-wise is the same table as develop (Type, "
         "Ref No., Date, Items, Uploaded By, View / Edit / Delete).")
w.change("po_item", "2 · PO Item-wise: one row per PO item",
         "Item, Unit, Ordered, Received (DN), DC Qty, MIR Qty, DC Pending (Received − DC; red when short, red \"+N "
         "extra\" when the DCs cover more), Status and the DC/MIR numbers. No status-count row; a funnel filter on the "
         "Status header (one or more, \"Clear filters\"). Click a row: each DC/MIR covering the item with type, ref "
         "no., date, quantity and View. Click a DC/MIR number: DC-wise opens with that document open and highlighted.")
w.change("po_rule", "3 · PO Status = the project DN > DC Quantity Report's rule",
         "The same status as Project › DC & MIR › DN > DC Report (Purchase Orders) for the same PO's items. A "
         "Non-Billable item reads \"Not Billable\" with \"–\" in the DC/MIR columns; an old DC with no items (N/A in "
         "DC-wise) is named in a note under the table and counted in no row. A DC/MIR with no Ref No. is named by its "
         "DC-wise S.No. (\"S.No. 2 (DC, no Ref No.)\"), never by its internal id (first walk's nit).")
w.change("itm_switch", "4 · ITM page: the same switch, Transfer Qty",
         "Internal Transfer Memo › \"Delivery Challans & MIRs\": the same switch, opening on DC-wise; DC-wise as develop "
         "(no Uploaded By, Edit only when Partially Delivered or Delivered, no Delete). Item-wise has Transfer Qty "
         "instead of Ordered.")
w.change("itm_rule", "5 · ITM Status = develop's ITM rule (the Transfer Memos report's)",
         "The ITM card uses develop's ITM rule (utils/itmDnDcStatus.ts; owner 2026-11-26, \"develop rules only\"): "
         "Pending DN when nothing is received but a DC is filed; Matched when the DCs cover what was received; No DC "
         "Update when something is received and no DC; else Mismatch. No Partially Delivered, no tolerance, Transfer "
         "Qty shown but not used. An item with nothing received and no DC reads \"–\" on the card (the report leaves "
         "such items out). The project's DN > DC Report (Transfer Memos) gives every other item the same status.")
w.change("wo", "6 · Work Order page: no switch",
         "An approved Work Order's attachments card renders the same component, and shows no switch, as on develop.")
w.change("sizes", "7 · Screen sizes: the layout fits the card",
         "Item-wise picks the widest layout that fits the card itself, not the screen: the full table; a compact table "
         "(no Unit and no DC/MIR-numbers columns, \"N DCs · N MIRs\" under the item name); or one card per item with a "
         "\"Status\" filter button. At 768 px with the sidebar open nothing runs past the card, so Status and DC "
         "Pending are seen without a sideways scroll (first walk's nit). 390 px: cards, the switch full width.")
w.change("reports", "8 · Both project reports unchanged",
         "Both rules only moved into utils/: the DN > DC Report gives the same statuses before and after, for Purchase "
         "Orders and for Transfer Memos, on the same project.")
w.change("itm_report", "9 · ITM DN > DC Report as develop",
         "The Transfer Memos report keeps develop's screen: 4 summary cards (no Partially Delivered), develop's info "
         "text, develop's default status filter (Mismatch, No DC Update, Pending DN), and develop's rollup (Mismatch > "
         "No DC Update > Pending DN > Matched).")


# ---------------------------------------------------------------- facts from the env DB

FACTS = r'''
import json, sys
from collections import defaultdict
import frappe

a = json.loads(sys.argv[1])
S = lambda q, *p: frappe.db.sql(q, p, as_dict=1)
LABEL = {"no_dc_update": "No DC Update", "mismatch": "Mismatch", "pending_dn": "Pending DN",
         "partially_delivered": "Partially Delivered", "matched": "Matched", "not_billable": "Not Billable",
         "no_activity": "–"}
ORDER = list(LABEL)
DASH = "–"
# The Status filter's option text ("–" alone would say nothing in a list).
OPTION = dict(LABEL, no_activity="– Nothing received yet")


def po_rule(o, dn, dc):
    """Develop's PO rule (utils/dnDcStatus.ts, moved there unchanged), written again here from its spec."""
    t_dn = o * 2.5 / 100 if (o % 1 or dn % 1) else 0
    t_dc = o * 2.5 / 100 if (o % 1 or dc % 1) else 0
    if dn == 0:
        return "pending_dn"
    if dn > 0 and abs(dn - o) > t_dn and dc == dn:
        return "partially_delivered"
    if dn > 0 and dc == 0 and abs(dc - o) > t_dc:
        return "no_dc_update"
    if dn > 0 and abs(dn - o) <= t_dn and dn > dc:
        return "mismatch"
    return "matched"


def itm_rule(dn, dc):
    """Develop's ITM rule (the Transfer Memos report's; utils/itmDnDcStatus.ts, moved there unchanged)."""
    if dn == 0 and dc > 0:
        return "pending_dn"
    if dc >= dn:
        return "matched"
    if dn > 0 and dc == 0:
        return "no_dc_update"
    return "mismatch"


def itm_card_status(dn, dc):
    """The ITM card: develop's ITM rule, except "–" (no_activity) for nothing received and no DC."""
    return "no_activity" if dn == 0 and dc == 0 else itm_rule(dn, dc)


def why_itm(dn, dc):
    """Which line of the ITM rule an item meets, in words (for the step pins)."""
    if dn == 0 and dc == 0:
        return "nothing received and no DC: the card shows \"–\" (the report leaves such items out)"
    if dn == 0:
        return "nothing received but a DC is filed: Pending DN"
    if dc >= dn:
        return "the DCs cover what was received: Matched"
    if dc == 0:
        return "received, and no DC: No DC Update"
    return "the DCs are short of what was received: Mismatch"


def label_of(d, docs):
    """How the card names a DC/MIR (utils/dcMirItemWise.ts docLabel): its Ref No., else its DC-wise S.No. The
    DC-wise list is in `docs` order (creation desc, as get_po_delivery_documents returns it)."""
    if d.reference_number:
        return d.reference_number
    kind = "DC" if d.type == "Delivery Challan" else "MIR"
    return "S.No. %d (%s, no Ref No.)" % (docs.index(d) + 1, kind)


def qty(n):
    s = ("%.2f" % n).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


docs_by = defaultdict(list)
for d in S("""select name, parent_doctype, parent_docname, type, reference_number, coalesce(is_stub, 0) is_stub
              from "tabPO Delivery Documents" order by creation desc"""):
    d["items"] = []
    docs_by[(d.parent_doctype, d.parent_docname)].append(d)
by_name = {d.name: d for ds in docs_by.values() for d in ds}
for i in S("""select parent, item_id, category, quantity from "tabDC Item" order by parent, idx"""):
    if i.parent in by_name:
        by_name[i.parent]["items"].append(i)


def rows(kind, items, docs):
    by = {}
    for it in items:
        key = (it.category or "", it.item_id)
        if key in by:
            by[key]["o"] += it.q or 0
            by[key]["r"] += it.r or 0
            continue
        by[key] = {"item_id": it.item_id, "name": it.item_name or it.item_id, "category": it.category or "",
                   "unit": it.unit or "", "o": it.q or 0, "r": it.r or 0, "dc": 0, "mir": 0,
                   "billable": kind == "itm" or it.get("billing_status") != "Non-Billable", "docs": []}
    uncounted = []
    for d in [d for d in docs if d.type == "Delivery Challan"] + [d for d in docs if d.type != "Delivery Challan"]:
        if d.is_stub == 1 or not d["items"]:
            uncounted.append(d)
            continue
        per = {}
        for ln in d["items"]:
            k = (ln.category or "", ln.item_id)
            if k in by:
                per[k] = per.get(k, 0) + (ln.quantity or 0)
        for k, v in per.items():
            by[k]["dc" if d.type == "Delivery Challan" else "mir"] += v
            by[k]["docs"].append({"name": d.name, "ref": label_of(d, docs), "dc_wise_ref": d.reference_number or "-",
                                  "type": "DC" if d.type == "Delivery Challan" else "MIR", "qty": qty(v)})
    res = []
    for r in by.values():
        pend = r["r"] - r["dc"]
        if not r["billable"]:
            status = "not_billable"
        elif kind == "itm":
            status = itm_card_status(r["r"], r["dc"])
        else:
            status = po_rule(r["o"], r["r"], r["dc"])
        ndc = sum(x["type"] == "DC" for x in r["docs"])
        nmir = len(r["docs"]) - ndc
        res.append({
            "name": r["name"], "category": r["category"], "unit": r["unit"], "item_id": r["item_id"],
            "ordered": qty(r["o"]), "received": qty(r["r"]),
            "dc": qty(r["dc"]) if r["billable"] else DASH, "mir": qty(r["mir"]) if r["billable"] else DASH,
            "pending": DASH if (not r["billable"] or r["r"] == 0) else (
                "+%s extra" % qty(-pend) if pend < 0 else qty(pend) if pend > 0 else "0"),
            "status": status, "label": LABEL[status],
            "chips": [x["ref"] for x in r["docs"]] if r["billable"] else [],
            "summary": " · ".join(p for p in [
                ("%d DC%s" % (ndc, "" if ndc == 1 else "s")) if ndc else "",
                ("%d MIR%s" % (nmir, "" if nmir == 1 else "s")) if nmir else ""] if p),
            "docs": r["docs"] if r["billable"] else [],
            "why": why_itm(r["r"], r["dc"]) if kind == "itm" else None})
    counts = {}
    for r in res:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    options = ["%s (%d)" % (OPTION[s], counts[s]) for s in ORDER if counts.get(s)]
    return {"rows": res, "uncounted": [label_of(d, docs) for d in uncounted],
            "uncounted_ids": [d.name for d in uncounted if not d.reference_number],
            "stubs": [d.reference_number or "-" for d in uncounted if d.is_stub == 1],
            "options": options, "docs": [{"name": d.name, "ref": d.reference_number or "-", "type": d.type,
                                          "stub": d.is_stub, "n": len(d["items"])} for d in docs]}


def projects_of(u):
    return set(frappe.get_all("User Permission", filters={"user": u, "allow": "Projects"}, pluck="for_value"))


pm_p, pe_p = projects_of(a["pm"]), projects_of(a["pe"])
common = pm_p & pe_p

po_items = defaultdict(list)
for i in S("""select parent, item_id, item_name, category, unit, quantity q, received_quantity r, billing_status
              from "tabPurchase Order Item" order by parent, idx"""):
    po_items[i.parent].append(i)
pos = {}
for po in S("""select name, project, status, billing_status from "tabProcurement Orders"
               where status in ('Delivered', 'Partially Delivered') order by name"""):
    docs = docs_by.get(("Procurement Orders", po.name))
    if docs:
        pos[po.name] = dict(po, **rows("po", po_items[po.name], docs))


def good(p, t):
    return [d for d in p["docs"] if d["type"] == t and not d["stub"] and d["n"]]


def pick(pred, score):
    c = [p for p in pos.values() if pred(p)]
    return max(c, key=score)["name"] if c else None


def statuses(p):
    return len({r["status"] for r in p["rows"]})


multi = pick(lambda p: len(good(p, "Delivery Challan")) >= 2 and good(p, "Material Inspection Report")
             and any(sum(x["type"] == "DC" for x in r["docs"]) >= 2 for r in p["rows"]),
             lambda p: (p["project"] in common, p["project"] in pe_p, statuses(p), min(len(p["rows"]), 8), p["name"]))
report_po = pick(lambda p: p["billing_status"] != "Non-Billable" and 3 <= len(p["rows"]) <= 10
                 and all(r["status"] != "not_billable" for r in p["rows"]) and good(p, "Delivery Challan"),
                 lambda p: (statuses(p), -len(p["rows"]), p["name"]))
nb = pick(lambda p: p["billing_status"] != "Non-Billable" and any(r["status"] == "not_billable" for r in p["rows"])
          and any(r["status"] != "not_billable" and r["dc"] not in ("0", DASH) for r in p["rows"]),
          lambda p: (p["project"] in common, -len(p["rows"]), p["name"]))
stub = pick(lambda p: p["stubs"] and good(p, "Delivery Challan") and p["billing_status"] != "Non-Billable",
            lambda p: (p["project"] in common, -len(p["rows"]), p["name"]))

itm_items = defaultdict(list)
for i in S("""select parent, item_id, item_name, category, unit, transfer_quantity q, received_quantity r
              from "tabInternal Transfer Memo Item" order by parent, idx"""):
    itm_items[i.parent].append(i)
itms = {}
for m in S("""select name, status, target_project from "tabInternal Transfer Memo"
              where status in ('Delivered', 'Partially Delivered') order by name"""):
    docs = docs_by.get(("Internal Transfer Memo", m.name))
    if docs:
        itms[m.name] = dict(m, **rows("itm", itm_items[m.name], docs))


def itm_pick(pred, score):
    c = [m for m in itms.values() if pred(m)]
    return max(c, key=score)["name"] if c else None


has = lambda m, s: any(r["status"] == s for r in m["rows"])
nothing = lambda m: any(r["received"] == "0" and r["dc"] == "0" for r in m["rows"])
itm_full = itm_pick(lambda m: True, lambda m: (nothing(m), has(m, "no_dc_update"),
                                               len({r["status"] for r in m["rows"]}), m["name"]))
itm_pm = itm_pick(lambda m: m["target_project"] in pm_p, lambda m: (len(m["rows"]), m["name"]))

# Every ITM card status the ITM data has ("–" included), and the fewest ITMs that show them all (the ITMs already
# walked first, then ITMs on the same project as itm_full, so one project's Transfer Memos report shows most of them).
cases = {}
for m in itms.values():
    for r in m["rows"]:
        cases.setdefault(r["status"], []).append(m["name"])
cover, left = [], set(cases)
for first in [itm_full, itm_pm]:
    if first and first not in cover:
        cover.append(first)
        left -= {r["status"] for r in itms[first]["rows"]}
while left:
    best = max(itms.values(), key=lambda m: (len(left & {r["status"] for r in m["rows"]}),
                                             m["target_project"] == itms[itm_full]["target_project"], m["name"]))
    cover.append(best["name"])
    left -= {r["status"] for r in best["rows"]}


def report_itm(project, rule):
    """The project's DN > DC Report (Transfer Memos), built as ITMDNDCQuantityReport builds it: Delivered and
    Partially Delivered ITMs into the project, its DC documents' item rows (type Delivery Challan, project = the
    project), items keyed on category + item ID, DC lines on no ITM item counted Matched, items with nothing received
    and no DC left out, an ITM with no item left out. Develop's ITM rule and rollup on both sides ("before" and
    "after" are kept apart only to compare the two envs)."""
    order = ["mismatch", "no_dc_update", "pending_dn"]
    dcs, dc_names = defaultdict(lambda: defaultdict(float)), {}
    for ln in S("""select d.parent_docname p, i.item_id, i.category, i.item_name, i.quantity q
                   from "tabPO Delivery Documents" d join "tabDC Item" i on i.parent = d.name
                   where d.parent_doctype = 'Internal Transfer Memo' and d.type = 'Delivery Challan'
                     and d.project = %s""", project):
        dcs[ln.p][(ln.category or "", ln.item_id)] += ln.q or 0
        dc_names.setdefault((ln.category or "", ln.item_id), ln.item_name)
    res = {}
    for m in S("""select name from "tabInternal Transfer Memo" where target_project = %s
                  and status in ('Delivered', 'Partially Delivered') order by name""", project):
        agg = {}
        for it in itm_items[m.name]:
            k = (it.category or "", it.item_id)
            x = agg.setdefault(k, {"name": it.item_name, "category": it.category or "", "t": 0, "dn": 0})
            x["t"] += it.q or 0
            x["dn"] += it.r or 0
        dcq = dcs[m.name]
        items = []
        for k, x in agg.items():
            dc = dcq.get(k, 0)
            st = itm_rule(x["dn"], dc)
            items.append(dict(x, dc=dc, status=st, label=LABEL[st]))
        for (c, i), q in dcq.items():
            if (c, i) not in agg:
                items.append({"name": dc_names[(c, i)], "category": c, "t": 0, "dn": 0, "dc": q, "status": "matched",
                              "label": "Matched"})
        items = [x for x in items if not (x["dn"] == 0 and x["dc"] == 0)]
        if items:
            roll = next((s for s in order if any(x["status"] == s for x in items)), "matched")
            res[m.name] = {"rollup": roll, "label": LABEL[roll], "items": items}
    tiles = {}
    for v in res.values():
        tiles[v["rollup"]] = tiles.get(v["rollup"], 0) + 1
    return {"itms": res, "tiles": tiles}
wo = (frappe.get_all("Service Requests", filters={"status": "Approved"}, order_by="modified desc", pluck="name",
                     limit=1) or [None])[0]

picked = {"multi": multi, "report_po": report_po, "nb": nb, "stub": stub}
fact = {"po": {k: pos[v] for k, v in picked.items() if v}, "picked": picked,
        "itm": {k: itms[v] for k, v in {"full": itm_full, "pm": itm_pm}.items() if v},
        "wo": wo, "pm_projects": sorted(pm_p), "pe_projects": sorted(pe_p),
        "itm_cover": {n: itms[n] for n in cover}, "itm_cases": {c: sorted(set(v)) for c, v in cases.items()},
        "labels": LABEL}
fact["report_project"] = itms[itm_full]["target_project"] if itm_full else None
fact["report_itm"] = {side: {p: report_itm(p, side) for p in {itms[n]["target_project"] for n in cover}}
                      for side in ("before", "after")}

# What each walked user sees through the app's permissions (an empty list there would look like a bug).
see = {}
for role, user, doctype, name in [
        ("Procurement Executive", a["pe"], "Procurement Orders", multi),
        ("Project Manager", a["pm"], "Procurement Orders", multi),
        ("Project Manager", a["pm"], "Internal Transfer Memo", itm_pm),
        ("PMO Executive", a["pmo"], "Internal Transfer Memo", itm_full),
        *[("PMO Executive", a["pmo"], "Internal Transfer Memo", n) for n in cover if n != itm_full],
        ("Admin", a["admin"], "Service Requests", wo)]:
    if name:
        frappe.set_user(user)
        see["%s|%s" % (role, name)] = len(frappe.get_list(doctype, filters={"name": name}))
frappe.set_user("Administrator")
fact["see"] = see
print("JSON " + json.dumps(fact, default=str))
'''


def db_json(task: str, name: str, code: str, *args: str) -> dict:
    """Run a Python snippet on the env DB (devenv script) and keep it and its output beside the screenshots."""
    src = out / "db" / f"{name}.py"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text(code)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=600)
    (out / "db" / f"{name}.txt").write_text(res.stdout + res.stderr)
    line = next((ln for ln in res.stdout.splitlines() if ln.startswith("JSON ")), None)
    if line is None:
        raise RuntimeError(f"{name} on {task} printed no JSON:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    return json.loads(line[5:])


ARGS = json.dumps({"pm": a.pm, "pe": a.pe, "pmo": a.pmo, "admin": a.admin})
F = {"after": db_json(a.after, "facts_after", FACTS, ARGS)}
F["before"] = db_json(a.before, "facts_before", FACTS, ARGS)
FA = F["after"]
PO, ITM = FA["po"], FA["itm"]
if "multi" not in PO or "full" not in ITM:
    sys.exit("walk: the data has no PO with 2 DCs and a MIR on one item, or no ITM with DCs; picks: "
             f"{FA['picked']}, ITMs: {sorted(ITM)}")


# ---------------------------------------------------------------- helpers

def base_of(page) -> str:
    return re.match(r"(https?://[^/]+)", page.url).group(1)


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def card(page):
    """The "Delivery Challans & MIRs" card: the innermost bordered card holding its title. Not "the block holding a
    table": Item-wise as cards (a narrow card) has no table."""
    return page.locator("div.rounded-md.border").filter(has=page.get_by_text(CARD_TITLE, exact=True)).last


ITEM_CARDS = "div.space-y-2.border-b.p-3"  # one Item-wise card per item (the narrow layout)


def item_layout(c) -> str:
    """Which Item-wise layout the card shows: "cards", "full" (it has a Unit column) or "compact"."""
    if c.locator(ITEM_CARDS).count():
        return "cards"
    return "full" if "Unit" in headers(c) else "compact"


def switch(page):
    return page.get_by_role("group", name=SWITCH)


def view_btn(page, label: str):
    return switch(page).get_by_role("button", name=label, exact=True)


def open_po(page, po: str) -> None:
    """Setup: the PO's own URL (typed, not walked). The caller opens PO Attachments as the user does."""
    page.goto(f"{base_of(page)}/purchase-orders/{po.replace('/', '&=')}")
    settle(page, 2500)


def attachments_trigger(page):
    return page.get_by_role("button", name=re.compile(r"^PO Attachments"))


def open_itm(page, itm: str) -> None:
    page.goto(f"{base_of(page)}/internal-transfer-memos/{itm}")
    settle(page, 3000)


def headers(c) -> list[str]:
    return [t.strip() for t in c.locator("table").first.locator("thead th").all_inner_texts() if t.strip()]


def body_rows(c) -> list[list[str]]:
    """The visible main rows of the card's table: one list of cell texts per row (expanded detail rows left out)."""
    return c.locator("table").first.evaluate(
        "t => [...t.tBodies[0].rows].filter(r => r.cells.length >= 8)"
        ".map(r => [...r.cells].map(c => c.innerText.trim()))")


def norm(t: str) -> str:
    return " ".join(t.split())


def row_of(shown: list[list[str]], exp: dict) -> list[str] | None:
    """The shown row of one expected item: its Item cell starts with the item's name and category."""
    key = norm(exp["name"] + " " + exp["category"])
    return next((r for r in shown if norm(r[1]).startswith(key)), None)


def statuses_shown(shown: list[list[str]], fact: dict) -> dict[str, str]:
    return {e["name"]: r[8] for e in fact["rows"] if (r := row_of(shown, e))}


def in_report(rep: dict[str, str], exp: dict) -> str | None:
    """The report row text that names this item (name and category), whitespace-normalised."""
    return next((k for k in rep if norm(exp["name"]) in norm(k) and exp["category"] in k), None)


def item_row(c, name: str):
    return c.locator("table").first.locator("tbody > tr").filter(has=c.page.get_by_text(name, exact=True)).first


def compare_rows(cid: str, role: str, kind: str, shown: list[list[str]], fact: dict, tablet: bool = False) -> None:
    """One check per item: the row the screen shows against the row recomputed from the env DB."""
    rows = fact["rows"]
    w.check(cid, role, f"{len(rows)} item rows (one per {kind.upper()} item, duplicates merged)",
            f"{len(shown)} rows", len(shown) == len(rows))
    for exp in rows:
        got = row_of(shown, exp)
        want = [exp["ordered"], exp["received"], exp["dc"], exp["mir"], exp["pending"], exp["label"]]
        if got is None:
            w.check(cid, role, f"{exp['name']}: {' / '.join(want)}", "row not found", False)
            continue
        seen = [got[3], got[4], got[5], got[6], got[7], got[8]]
        chips = got[9].split() if not tablet and len(got) > 9 else None
        ok = seen == want
        exp_chips = exp["chips"] or (["–"] if exp["dc"] == "–" else ["None", "yet"])
        if chips is not None:
            ok = ok and chips == [t for ref in exp_chips for t in ref.split()]
        w.check(cid, role,
                f"{exp['name']}: ordered / received / DC / MIR / pending / status = {' / '.join(want)}"
                + ("" if chips is None else f"; numbers {' '.join(exp_chips)}"),
                " / ".join(seen) + ("" if chips is None else f"; numbers {' '.join(chips)}"), ok)


def no_count_row(cid: str, role: str, c) -> None:
    """No status-count row: no status label anywhere in the card outside the table."""
    rest = c.inner_text().replace(c.locator("table").first.inner_text(), "")
    found = [s for s in ("Matched", "Mismatch", "No DC Update", "Pending DN", "Partially Delivered") if s in rest]
    w.check(cid, role, "no status-count row above the table", f"status words outside the table: {found or 'none'}",
            not found)


SEEN = {}  # screen facts kept across functions (card statuses, DC-wise headers, report tiles)


# ---------------------------------------------------------------- 1, 2 · PO page as Admin

def po_admin_after() -> None:
    role, user, p = "Admin", USERS["Admin"], PO["multi"]
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 900})
        open_po(page, p["name"])
        w.step(page, "po_switch", "after", role, user,
               f"{p['name']} ({p['status']}, {len(good_docs(p, 'DC'))} DCs and {len(good_docs(p, 'MIR'))} MIR). "
               "Open PO Attachments.", click=attachments_trigger(page))
        settle(page)
        c = card(page)
        sw = switch(page)
        dc_on = view_btn(page, "DC-wise").get_attribute("aria-pressed") == "true"
        w.check("po_switch", role, "the card opens on DC-wise", "DC-wise pressed" if dc_on else "Item-wise pressed", dc_on)
        tb, sb = c.get_by_text(CARD_TITLE, exact=True).bounding_box(), sw.bounding_box()
        below = bool(tb and sb and sb["y"] >= tb["y"] + tb["height"])
        w.check("po_switch", role, "the switch sits on its own row under the card header",
                f"title bottom {round(tb['y'] + tb['height'])} px, switch top {round(sb['y'])} px" if tb and sb
                else "not measured", below)
        SEEN["po_dc_headers_after"] = headers(c)
        SEEN["po_dc_controls_after"] = controls(c)
        w.step(page, "po_switch", "after", role, user,
               "The card opens on DC-wise: the same document table as before, with the switch on its own row.",
               click=view_btn(page, "Item-wise"),
               pins=[pin(sw, "DC-wise | Item-wise, on its own row under the header; DC-wise is on.", "info"),
                     pin(c.locator("thead").first, "DC-wise columns: " + ", ".join(SEEN["po_dc_headers_after"]),
                         "info")])
        settle(page, 800)
        hd = headers(c)
        want_hd = ["Item", "Unit", "Ordered", "Received (DN)", "DC Qty", "MIR Qty", "DC Pending", "Status",
                   "DCs / MIRs"]
        w.check("po_item", role, "1600 px: the full table, columns " + ", ".join(want_hd), ", ".join(hd),
                hd == want_hd)
        shown = body_rows(c)
        compare_rows("po_item", role, "po", shown, p)
        no_count_row("po_item", role, c)
        funnel = c.locator("thead th").filter(has_text="Status").locator("div.cursor-pointer").first
        extra = next((r for r in p["rows"] if r["pending"].startswith("+")), None)
        short = next((r for r in p["rows"] if r["pending"] not in ("0", "–") and not r["pending"].startswith("+")),
                     None)
        pins = []
        for r, text in ((extra, "DCs cover more than was received: red \"+N extra\"."),
                        (short, "DCs short of what was received: the pending quantity in red.")):
            if r:
                pins.append(pin(item_row(c, r["name"]).locator("td").nth(7), text, "info"))
        w.step(page, "po_item", "after", role, user,
               "Item-wise: one row per PO item, every figure as the DB gives it. No status-count row. Open the "
               "funnel on the Status header.", click=funnel, pins=pins)
        settle(page, 600)
        opts = [t.strip() for t in page.get_by_role("option").all_inner_texts()]
        w.check("po_item", role, "Status filter options (with counts): " + ", ".join(p["options"]), ", ".join(opts),
                opts == p["options"])
        first = page.get_by_role("option").first
        status0 = p["options"][0].rsplit(" (", 1)[0]
        w.step(page, "po_item", "after", role, user, f"The Status filter lists each status with its count. Pick "
               f"\"{status0}\".", click=first)
        settle(page, 600)
        page.keyboard.press("Escape")
        shown = body_rows(c)
        n = sum(r["label"] == status0 for r in p["rows"])
        w.check("po_item", role, f"filtered to {status0}: {n} rows, all {status0}",
                f"{len(shown)} rows: {sorted({r[8] for r in shown})}",
                len(shown) == n and all(r[8] == status0 for r in shown))
        w.step(page, "po_item", "after", role, user, f"Only {status0} rows remain. Open the funnel again.",
               click=funnel)
        settle(page, 600)
        w.step(page, "po_item", "after", role, user, "\"Clear filters\" sits under the options.",
               click=page.get_by_role("option", name="Clear filters"))
        settle(page, 600)
        page.keyboard.press("Escape")
        back = len(body_rows(c))
        w.check("po_item", role, f"Clear filters: all {len(p['rows'])} rows back", f"{back} rows",
                back == len(p["rows"]))
        target = next(r for r in p["rows"] if sum(x["type"] == "DC" for x in r["docs"]) >= 2)
        row = item_row(c, target["name"])
        w.step(page, "po_item", "after", role, user,
               f"All rows are back. Click the row of {target['name']}, which {len(target['docs'])} documents cover.",
               click=row.locator("td").nth(1))
        settle(page, 600)
        detail = c.locator("table table").first
        got = detail.evaluate("t => [...t.tBodies[0].rows].map(r => [...r.cells].map(c => c.innerText.trim()))")
        want = [[d["type"], d["ref"], d["qty"]] for d in target["docs"]]
        seen = [[g[0], g[1], g[3]] for g in got]
        w.check("po_item", role, "the row opens each DC/MIR with type, ref no. and quantity: "
                + "; ".join(" ".join(x) for x in want), "; ".join(" ".join(x) for x in seen), seen == want)
        dates_ok = all(re.match(r"\d{2}-[A-Z][a-z]{2}-\d{4}$", g[2]) for g in got)
        w.check("po_item", role, "each document has a date", ", ".join(g[2] for g in got), dates_ok, kind="nit")
        views = detail.get_by_role("link", name=re.compile(r"^View .* file$")).count()
        w.check("po_item", role, "a View link per document with a file", f"{views} View links of {len(got)}",
                views == len(got), kind="should")
        dcs = [d for d in target["docs"] if d["type"] == "DC"]
        dc_doc = next((d for d in dcs if d["dc_wise_ref"] != "-"), dcs[0])
        chip = row.get_by_role("button", name=dc_doc["ref"], exact=True)
        w.step(page, "po_item", "after", role, user,
               f"Each document that covers the item, with its quantity. Click DC number {dc_doc['ref']}.",
               click=chip, pins=[pin(detail, "Type, Ref No., Date, Qty and View per document.", "info")])
        settle(page, 1200)
        dc_on = view_btn(page, "DC-wise").get_attribute("aria-pressed") == "true"
        hl = c.locator("tbody > tr.bg-blue-50")
        hl_text = hl.first.inner_text() if hl.count() else ""
        ok = dc_on and hl.count() == 1 and (dc_doc["dc_wise_ref"] in hl_text)
        w.check("po_item", role, f"the card switches to DC-wise with {dc_doc['ref']} highlighted",
                f"DC-wise pressed: {dc_on}; highlighted rows: {hl.count()} ({hl_text[:60]!r})", ok)
        opened = c.locator("tbody > tr.bg-blue-50 + tr").first
        open_text = opened.inner_text() if opened.count() else ""
        w.check("po_item", role, f"{dc_doc['ref']} opens with its items, {target['name']} among them",
                norm(open_text)[:120] or "nothing open", norm(target["name"]) in norm(open_text))
        w.step(page, "po_item", "after", role, user,
               f"DC-wise again, with {dc_doc['ref']} highlighted and its items open.",
               pins=[pin(hl, f"{dc_doc['ref']}: highlighted.", "info")] if hl.count() else [])


def controls(c) -> dict[str, int]:
    """How many View, Edit (or Update) and Delete controls the DC-wise table shows."""
    t = c.locator("table").first
    return {"View": t.get_by_role("link", name=re.compile(r"^View ")).count(),
            "Edit": t.get_by_role("button", name=re.compile(r"^(Edit|Update) ")).count(),
            "Delete": t.get_by_role("button", name=re.compile(r"^Delete ")).count()}


def good_docs(p: dict, t: str) -> list:
    full = "Delivery Challan" if t == "DC" else "Material Inspection Report"
    return [d for d in p["docs"] if d["type"] == full and not d["stub"] and d["n"]]


def po_admin_before() -> None:
    role, user, p = "Admin", USERS["Admin"], PO["multi"]
    with session(a.before, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 900})
        open_po(page, p["name"])
        attachments_trigger(page).click()
        settle(page)
        c = card(page)
        n = switch(page).count() + page.get_by_role("button", name="Item-wise").count()
        w.check("po_switch", role, "before (develop): no switch on the PO card", f"{n} switch controls", n == 0,
                kind="info")
        SEEN["po_dc_headers_before"] = headers(c)
        SEEN["po_dc_controls_before"] = controls(c)
        w.step(page, "po_switch", "before", role, user, f"Develop: {p['name']}'s card has only the document table.",
               pins=[pin(c.locator("thead").first, "Columns: " + ", ".join(SEEN["po_dc_headers_before"]), "info")])


def po_dc_same() -> None:
    after, before = SEEN.get("po_dc_headers_after"), SEEN.get("po_dc_headers_before")
    if after and before:
        w.check("po_switch", "Admin", "DC-wise columns as develop: " + ", ".join(before), ", ".join(after),
                after == before)
    after, before = SEEN.get("po_dc_controls_after"), SEEN.get("po_dc_controls_before")
    if after and before:
        w.check("po_switch", "Admin", f"DC-wise View / Edit / Delete as develop: {before}", str(after),
                after == before and all(before.values()))


# ---------------------------------------------------------------- 1, 2 · PO page as PE and PM

def po_role(role: str, side: str) -> None:
    user, p = USERS[role], PO["multi"]
    sees = FA["see"].get(f"{role}|{p['name']}", 0)
    w.check("po_switch", role, f"{role} can open {p['name']} (frappe.get_list as the user)", f"{sees} found",
            sees == 1)
    if not sees:
        return
    with session(ENVS[side], user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 900})
        open_po(page, p["name"])
        attachments_trigger(page).click()
        settle(page)
        c = card(page)
        inv = page.get_by_text("Invoices", exact=True).count()
        if role == "Project Manager":
            w.check("po_switch", role, f"{side}: the PM sees the DC & MIR card", f"{c.count()} cards", c.count() == 1,
                    kind="must" if side == "after" else "info")
            w.check("po_switch", role, f"{side}: the PM sees no Invoices card (as develop)", f"Invoices titles: {inv}",
                    inv == 0, kind="info")
        if side == "before":
            n = switch(page).count()
            w.check("po_switch", role, "before (develop): no switch", f"{n} switches", n == 0, kind="info")
            w.step(page, "po_switch", side, role, user, f"Develop, as {role}: the card has no switch.",
                   pins=[pin(c.get_by_text(CARD_TITLE, exact=True), "No DC-wise | Item-wise switch.", "info")])
            return
        dc_on = view_btn(page, "DC-wise").get_attribute("aria-pressed") == "true"
        w.check("po_switch", role, "the switch shows and opens on DC-wise", f"DC-wise pressed: {dc_on}", dc_on)
        w.step(page, "po_switch", side, role, user, f"As {role}: the switch shows, on DC-wise. Switch to Item-wise.",
               click=view_btn(page, "Item-wise"))
        settle(page, 800)
        compare_rows("po_item", role, "po", body_rows(c), p)
        w.step(page, "po_item", side, role, user, f"As {role}: Item-wise reads the same rows as for the Admin.",
               pins=[pin(c.locator("table").first.locator("tbody"), "Same figures and statuses.", "info")])


def po_pe_after() -> None:
    po_role("Procurement Executive", "after")


def po_pm_after() -> None:
    po_role("Project Manager", "after")


def po_pm_before() -> None:
    po_role("Project Manager", "before")


# ---------------------------------------------------------------- 3 · PO rule = the project report

def report_items(page, needle: str) -> dict[str, str]:
    """Search the project's DN > DC report for one PO or ITM, open its row, and read item name -> status."""
    page.get_by_role("row").filter(has_text=needle).first.locator("td").first.click()
    settle(page, 1200)
    cells = page.evaluate(
        "() => [...document.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText.trim()))")
    return {"\n".join(r): r[-1] for r in cells if len(r) > 4}


def open_project(page, project: str) -> None:
    """Setup: the project's own URL (typed). The caller opens its DC & MIR tab as the user does."""
    page.goto(f"{base_of(page)}/projects/{project}")
    settle(page, 2500)


def po_rule_after() -> None:
    role, user, p = "Admin", USERS["Admin"], PO["report_po"]
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 1000})
        open_project(page, p["project"])
        w.step(page, "po_rule", "after", role, user, f"Project {p['project']}: open the DC & MIR tab.",
               click=page.get_by_role("button", name="DC & MIR", exact=True).first)
        settle(page, 3000)
        page.get_by_placeholder("Search PO number or vendor...").fill(p["name"])
        settle(page, 800)
        rep = report_items(page, p["name"])
        status_of = {}
        for r in p["rows"]:
            k = in_report(rep, r)
            status_of[r["name"]] = rep.get(k) if k else None
        SEEN["report_po"] = status_of
        for r in p["rows"]:
            w.check("po_rule", role, f"report: {r['name']} = {r['label']} (the rule on the DB rows)",
                    str(status_of[r["name"]]), status_of[r["name"]] == r["label"])
        prow = page.get_by_role("row").filter(has_text=p["name"]).first
        w.step(page, "po_rule", "after", role, user,
               f"DN > DC Report (Purchase Orders), {p['name']} opened: each item's status.",
               pins=[pin(prow, f"{len(p['rows'])} items; statuses read below.", "info")])
        page.set_viewport_size({"width": 1600, "height": 900})
        open_po(page, p["name"])
        attachments_trigger(page).click()
        settle(page)
        c = card(page)
        view_btn(page, "Item-wise").click()
        settle(page, 800)
        shown = body_rows(c)
        compare_rows("po_rule", role, "po", shown, p)
        card_st = statuses_shown(shown, p)
        agree = [n for n in status_of if status_of[n] and card_st.get(n) == status_of[n]]
        w.check("po_rule", role, f"the PO card and the report give each item the same status ({len(p['rows'])} "
                "items, at least 3)", f"{len(agree)} agree: " + "; ".join(f"{n} = {card_st.get(n)}" for n in agree),
                len(agree) == len(p["rows"]) and len(agree) >= 3)
        for r in p["rows"]:
            if r["pending"] not in ("0", "\u2013"):
                cell = item_row(c, r["name"]).locator("td").nth(7).locator("span").first
                color = cell.evaluate("e => getComputedStyle(e).color")
                w.check("po_item", role, f"DC Pending {r['pending']} for {r['name'][:40]} is red",
                        color, color == "rgb(220, 38, 38)")
        over = next((r for r in p["rows"] if r["pending"].startswith("+") and r["status"] == "matched"), None)
        pins = [pin(c.locator("thead th").filter(has_text="Status").first,
                    "Status per item = the report's, item by item.", "info")]
        if over:
            pins.append(pin(item_row(c, over["name"]).locator("td").nth(7),
                            f"DCs cover {over['pending']} beyond what was received, and the row still reads Matched: "
                            "the owner's rule (over-challaned rows fall through to Matched), and the report says the "
                            "same. A reader may take Matched as clean.", "info"))
        w.step(page, "po_rule", "after", role, user, f"{p['name']} Item-wise: the same statuses as the report.",
               pins=pins)


def po_nb_after() -> None:
    role, user, p = "Admin", USERS["Admin"], PO.get("nb")
    if not p:
        w.check("po_rule", role, "a Billable PO with a Non-Billable item and DCs on its other items",
                "none in this data", False, kind="info")
        return
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 900})
        open_po(page, p["name"])
        attachments_trigger(page).click()
        settle(page)
        c = card(page)
        view_btn(page, "Item-wise").click()
        settle(page, 800)
        compare_rows("po_rule", role, "po", body_rows(c), p)
        nbr = next(r for r in p["rows"] if r["status"] == "not_billable")
        w.step(page, "po_rule", "after", role, user,
               f"{p['name']}: {nbr['name']} is a Non-Billable item.",
               pins=[pin(item_row(c, nbr["name"]), "Not Billable, with – in DC Qty, MIR Qty, DC Pending and the "
                         "numbers.", "info")])


def po_stub_after() -> None:
    role, user, p = "Admin", USERS["Admin"], PO.get("stub")
    if not p:
        w.check("po_rule", role, "a PO with an old (stub) DC", "none in this data", False, kind="info")
        return
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 900})
        open_po(page, p["name"])
        attachments_trigger(page).click()
        settle(page)
        c = card(page)
        na = c.locator("tbody tr").filter(has_text="N/A").first
        w.check("po_rule", role, f"DC-wise shows {len(p['stubs'])} old record(s) with N/A in Items",
                f"{c.locator('tbody tr').filter(has_text='N/A').count()} N/A rows",
                c.locator("tbody tr").filter(has_text="N/A").count() == len(p["stubs"]))
        w.step(page, "po_rule", "after", role, user,
               f"{p['name']} DC-wise: {len(p['stubs'])} old record(s) with no items (N/A).",
               click=view_btn(page, "Item-wise"), pins=[pin(na, "N/A: an old DC saved with no items.", "info")])
        settle(page, 800)
        compare_rows("po_rule", role, "po", body_rows(c), p)
        note = c.locator("p").filter(has_text="not counted above").first
        text = note.inner_text() if note.count() else ""
        ok = bool(text) and all(ref in text for ref in p["uncounted"])
        w.check("po_rule", role, "a note under the table names " + ", ".join(p["uncounted"]) + " as not counted",
                text or "no note", ok)
        ids = [i for i in p["uncounted_ids"] if i in text]
        w.check("po_rule", role, "a document with no Ref No. is named by its DC-wise S.No., never by its internal id "
                "(first walk's nit)", f"ids in the note: {ids or 'none'}", not ids)
        pins = [pin(note, "Names the uncounted documents.", "info")] if text else []
        if text and p["uncounted_ids"]:
            pins.append(pin(note.locator("span.font-medium").first,
                            "No Ref No., so it is named by its DC-wise row (S.No.), the way the DC-wise list shows it; "
                            "the internal id is not shown (first walk's nit, fixed).", "info"))
        w.step(page, "po_rule", "after", role, user,
               "Item-wise: the old DC is counted in no row, and the note under the table names it.", pins=pins)


# ---------------------------------------------------------------- 4, 5 · ITM page

def itm_pmo(side: str) -> None:
    role, user, m = "PMO Executive", USERS["PMO Executive"], ITM["full"]
    sees = FA["see"].get(f"{role}|{m['name']}", 0)
    w.check("itm_switch", role, f"the PMO can open {m['name']}", f"{sees} found", sees == 1)
    if not sees:
        return
    with session(ENVS[side], user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 1500})
        open_itm(page, m["name"])
        c = card(page)
        c.scroll_into_view_if_needed()
        hd = headers(c)
        SEEN[f"itm_dc_headers_{side}"] = hd
        edits = c.get_by_role("button", name=re.compile(r"^(Edit|Update) ")).count()
        dels = c.get_by_role("button", name=re.compile(r"^Delete ")).count()
        ndocs = len(m["docs"])
        w.check("itm_switch", role, f"{side}: DC-wise has no Uploaded By column, an Edit per document "
                f"({m['status']}), no Delete", f"columns {', '.join(hd)}; Edit {edits}; Delete {dels}",
                "Uploaded By" not in hd and edits == ndocs and dels == 0,
                kind="must" if side == "after" else "info")
        if side == "before":
            n = switch(page).count()
            w.check("itm_switch", role, "before (develop): no switch", f"{n} switches", n == 0, kind="info")
            w.step(page, "itm_switch", side, role, user, f"Develop: {m['name']}'s card, document table only.",
                   pins=[pin(c.locator("thead").first, "Columns: " + ", ".join(hd), "info")])
            return
        dc_on = view_btn(page, "DC-wise").get_attribute("aria-pressed") == "true"
        w.check("itm_switch", role, "the ITM card opens on DC-wise", f"DC-wise pressed: {dc_on}", dc_on)
        w.step(page, "itm_switch", side, role, user,
               f"{m['name']} ({m['status']}): the same switch, on DC-wise; Edit, no Delete, no Uploaded By.",
               click=view_btn(page, "Item-wise"),
               pins=[pin(switch(page), "Same switch as the PO card.", "info")])
        settle(page, 800)
        hd = headers(c)
        w.check("itm_switch", role, "Item-wise has Transfer Qty, not Ordered", ", ".join(hd),
                "Transfer Qty" in hd and "Ordered" not in hd)
        shown = body_rows(c)
        compare_rows("itm_rule", role, "itm", shown, m)
        SEEN.setdefault("itm_card", {})[m["name"]] = statuses_shown(shown, m)
        no_count_row("itm_rule", role, c)
        dash_want = sorted(r["name"] for r in m["rows"] if r["status"] == "no_activity")
        dash_seen = sorted(e["name"] for e in m["rows"] if (r := row_of(shown, e)) and r[8] == "–")
        w.check("itm_rule", role, f"\"–\" exactly on the items with nothing received and no DC ({len(dash_want)})",
                f"{len(dash_seen)} rows read \"–\"", dash_seen == dash_want)
        partial = [r for r in shown if r[8] == "Partially Delivered"]
        w.check("itm_rule", role, "no Partially Delivered on the ITM card (develop's ITM rule has none)",
                f"{len(partial)} rows", not partial)
        case_steps(page, "itm_rule", side, role, user, c, m)
        funnel = c.locator("thead th").filter(has_text="Status").locator("div.cursor-pointer").first
        w.step(page, "itm_rule", side, role, user, "Item-wise with Transfer Qty and develop's ITM rule. Open the Status "
               "funnel.", click=funnel)
        settle(page, 600)
        opts = [t.strip() for t in page.get_by_role("option").all_inner_texts()]
        w.check("itm_rule", role, "Status filter options: " + ", ".join(m["options"]), ", ".join(opts),
                opts == m["options"])
        w.step(page, "itm_rule", side, role, user, "The filter lists the ITM card's statuses"
               + (", \"– Nothing received yet\" among them." if dash_want else "."),
               pins=[pin(page.get_by_role("listbox").first, "Options: " + ", ".join(opts), "info")])
        page.keyboard.press("Escape")


CASE_SHOWN = set()  # the ITM card statuses already pinned on an ITM card


def case_steps(page, cid: str, side: str, role: str, user: str, c, m: dict) -> None:
    """One step per ITM card status this ITM shows that no earlier ITM card showed: the item's quantities and the
    line of develop's ITM rule that gives its status. Transfer Qty is shown but takes no part."""
    for r in m["rows"]:
        if r["status"] in CASE_SHOWN:
            continue
        q = f"Transfer {r['ordered']}, received {r['received']}, DC {r['dc']}"
        text = f"{q}: {r['why']}."
        w.step(page, cid, side, role, user, f"{m['name']}, {r['name'][:50]}: {r['label']}.",
               pins=[pin(item_row(c, r["name"]).locator("td").nth(8), text, "info")])
        CASE_SHOWN.add(r["status"])


FA_LABEL = FA["labels"]


def itm_cases_after() -> None:
    """Every ITM card status the ITM data has, on the ITM card: each ITM of the covering set not walked above."""
    role, user = "PMO Executive", USERS["PMO Executive"]
    walked = {ITM["full"]["name"], (ITM.get("pm") or {}).get("name")}
    todo = [m for n, m in FA["itm_cover"].items() if n not in walked]
    have = sorted(FA["itm_cases"])
    w.check("itm_rule", role, "the ITM card statuses in this data (all ITMs), each walked on an ITM card below",
            "; ".join(FA_LABEL[s] for s in have), bool(have), kind="info")
    missing = [FA_LABEL[s] for s in ("pending_dn", "matched", "no_dc_update", "mismatch", "no_activity")
               if s not in FA["itm_cases"]]
    if missing:
        w.check("itm_rule", role, "ITM card statuses with no ITM item in this data: not walked, pinned by "
                "frontend/src/utils/itmDnDcStatus.test.ts and dcMirItemWise.test.ts", "; ".join(missing), False,
                kind="info")
    for m in todo:
        sees = FA["see"].get(f"{role}|{m['name']}", 0)
        w.check("itm_rule", role, f"the PMO can open {m['name']}", f"{sees} found", sees == 1)
        if not sees:
            continue
        with session(a.after, user, a.password) as (page, _):
            page.set_viewport_size({"width": 1600, "height": 900})
            open_itm(page, m["name"])
            c = card(page)
            c.scroll_into_view_if_needed()
            w.step(page, "itm_rule", "after", role, user, f"{m['name']} ({m['status']}): its card, on DC-wise. "
                   "Item-wise.", click=view_btn(page, "Item-wise"))
            settle(page, 800)
            shown = body_rows(c)
            compare_rows("itm_rule", role, "itm", shown, m)
            SEEN.setdefault("itm_card", {})[m["name"]] = statuses_shown(shown, m)
            case_steps(page, "itm_rule", "after", role, user, c, m)


def itm_pmo_after() -> None:
    itm_pmo("after")


def itm_pmo_before() -> None:
    itm_pmo("before")


def itm_dc_same() -> None:
    after, before = SEEN.get("itm_dc_headers_after"), SEEN.get("itm_dc_headers_before")
    if after and before:
        w.check("itm_switch", "PMO Executive", "ITM DC-wise columns as develop: " + ", ".join(before),
                ", ".join(after), after == before)


def itm_pm_after() -> None:
    role, user, m = "Project Manager", USERS["Project Manager"], ITM.get("pm")
    if not m:
        w.check("itm_switch", role, "an ITM on the PM's projects with DCs", "none in this data", False, kind="info")
        return
    sees = FA["see"].get(f"{role}|{m['name']}", 0)
    w.check("itm_switch", role, f"the PM can open {m['name']}", f"{sees} found", sees == 1)
    if not sees:
        return
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 900})
        open_itm(page, m["name"])
        c = card(page)
        w.step(page, "itm_switch", "after", role, user, f"As the PM: {m['name']}'s card has the switch. Item-wise.",
               click=view_btn(page, "Item-wise"))
        settle(page, 800)
        shown = body_rows(c)
        compare_rows("itm_rule", role, "itm", shown, m)
        SEEN.setdefault("itm_card", {})[m["name"]] = statuses_shown(shown, m)
        w.step(page, "itm_switch", "after", role, user, "As the PM: Item-wise, Transfer Qty, develop's ITM rule.",
               pins=[pin(c.locator("thead").first, "Transfer Qty column.", "info")])
        case_steps(page, "itm_rule", "after", role, user, c, m)


def tm_report(page, project: str):
    """Setup: the project's DN > DC report, source Transfer Memos. Returns the Transfer Memos button (clicked)."""
    open_project(page, project)
    page.get_by_role("button", name="DC & MIR", exact=True).first.click()
    settle(page, 3000)
    return page.get_by_text("Source", exact=True).locator("..").get_by_role("button", name="Transfer Memos")


def tm_funnel(page):
    return page.locator("thead th").filter(has_text="Status").locator("div.cursor-pointer").first


def options_ticked(page) -> list[list]:
    """The open Status filter's options as [label, ticked]."""
    return page.get_by_role("option").evaluate_all(
        "os => os.map(o => [o.innerText.trim(), !!o.querySelector('div.bg-primary')])")


def itm_report_after() -> None:
    """Each walked ITM in its project's Transfer Memos report: every item the same status as on the ITM card."""
    role, user = "Admin", USERS["Admin"]
    cards = SEEN.get("itm_card", {})
    every = {**FA["itm_cover"], **{m["name"]: m for m in ITM.values()}}
    by_proj: dict[str, list[str]] = {}
    for n in cards:
        by_proj.setdefault(every[n]["target_project"], []).append(n)
    for proj, names in sorted(by_proj.items()):
        with session(a.after, user, a.password) as (page, _):
            page.set_viewport_size({"width": 1600, "height": 1000})
            tm = tm_report(page, proj)
            w.step(page, "itm_rule", "after", role, user, f"Project {proj} › DC & MIR › DN > DC Report: switch the "
                   "source to Transfer Memos.", click=tm)
            settle(page, 3000)
            tm_funnel(page).click()
            settle(page, 500)
            page.get_by_role("option", name="Clear filters").click()
            settle(page, 500)
            page.keyboard.press("Escape")
            for n in names:
                m = every[n]
                page.get_by_placeholder("Search ITM, source project, item, or category...").fill(n)
                settle(page, 800)
                rep = report_items(page, n)
                agree, hidden = [], []
                for r in m["rows"]:
                    k = in_report(rep, r)
                    if r["received"] == "0" and r["dc"] == "0":
                        hidden.append((r["name"], k is None))
                        continue
                    got = rep.get(k) if k else None
                    on_card = cards[n].get(r["name"])
                    w.check("itm_rule", role, f"{n} {r['name'][:40]}: the report gives the card's status, {on_card}"
                            f" (develop's ITM rule on the DB rows: {r['label']})", str(got),
                            got == r["label"] and got == on_card)
                    if got == on_card:
                        agree.append(r["name"])
                if hidden:
                    w.check("itm_rule", role, f"{n}: the report leaves out the items with nothing received and no "
                            "DC (its activity filter, as develop); the card shows them as \"–\"",
                            "; ".join(f"{x}: {'left out' if h else 'shown'}" for x, h in hidden),
                            all(h for _, h in hidden), kind="info")
                prow = page.get_by_role("row").filter(has_text=n).first
                w.step(page, "itm_rule", "after", role, user,
                       f"DN > DC Report (Transfer Memos), {n} opened (status filter cleared, so Matched ITMs show).",
                       pins=[pin(prow, f"{len(agree)} items: the same status as on the ITM card.", "info")])
                prow.locator("td").first.click()
                settle(page, 400)


# ---------------------------------------------------------------- 6 · Work Order page

def wo(side: str) -> None:
    role, user, sr = "Admin", USERS["Admin"], FA["wo"]
    if not sr:
        w.status("wo", "not_walked", "no approved Work Order in this data")
        return
    with session(ENVS[side], user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 900})
        page.goto(f"{base_of(page)}/service-requests-list/{sr}")
        settle(page, 3000)
        title = page.get_by_text(CARD_TITLE, exact=True).first
        n = switch(page).count() + page.get_by_role("button", name="Item-wise").count()
        dccard = page.get_by_text(CARD_TITLE, exact=True).count()
        w.check("wo", role, f"{side}: the Work Order page shows its attachments and no switch",
                f"{n} switch controls; DC & MIR cards: {dccard}", n == 0 and dccard >= 1,
                kind="must" if side == "after" else "info")
        w.step(page, "wo", side, role, user, f"{'Develop' if side == 'before' else 'Branch'}: approved Work Order "
               f"{sr}, its attachments (the same component as the PO's). No switch.",
               pins=[pin(title, "The Work Order's Delivery Challans & MIRs card: no DC-wise | Item-wise.", "info")]
               if title.count() else [])


def wo_after() -> None:
    wo("after")


def wo_before() -> None:
    wo("before")


# ---------------------------------------------------------------- 7 · Screen sizes

def overflow(c) -> int:
    """How many px of the card's table are hidden past its scroll box (0 when it fits)."""
    return c.locator("div.overflow-x-auto").first.evaluate("d => d.scrollWidth - d.clientWidth")


def sizes_before() -> None:
    role, user, p = "Admin", USERS["Admin"], PO["multi"]
    with session(a.before, user, a.password) as (page, _):
        page.set_viewport_size({"width": 768, "height": 1000})
        open_po(page, p["name"])
        attachments_trigger(page).click()
        settle(page)
        c = card(page)
        hidden = overflow(c)
        SEEN["overflow_768_before"] = hidden
        w.step(page, "sizes", "before", role, user,
               f"Develop at 768 px: the DC-wise table ({hidden} px past the card's edge).",
               pins=[pin(c.locator("div.overflow-x-auto").first,
                         f"Develop's table at 768 px: {hidden} px hidden past the right edge.", "info")])


def sizes_after() -> None:
    role, user, p, m = "Admin", USERS["Admin"], PO["multi"], ITM["full"]
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 768, "height": 1000})
        open_po(page, p["name"])
        attachments_trigger(page).click()
        settle(page)
        c = card(page)
        view_btn(page, "Item-wise").click()
        settle(page, 800)
        lay = item_layout(c)
        if lay == "cards":
            hidden = 0
            cards = c.locator(ITEM_CARDS).count()
            w.check("sizes", role, f"768 px, sidebar open: the card is too narrow for a table, so one card per item "
                    f"({len(p['rows'])})", f"{cards} cards", cards == len(p["rows"]))
        else:
            hidden = overflow(c)
            vis = headers(c)
            w.check("sizes", role, f"768 px, sidebar open: the {lay} table fits the card (0 px past its edge)",
                    f"{hidden} px past the edge; columns {', '.join(vis)}", hidden <= 1)
            shown = body_rows(c)
            compare_rows("sizes", role, "po", shown, p, tablet=lay == "compact")
            if lay == "compact":
                for r in p["rows"]:
                    if r["summary"]:
                        got = (row_of(shown, r) or ["", ""])[1]
                        w.check("sizes", role, f"compact: under {r['name']}: \"{r['summary']}\"",
                                got.replace("\n", " | "), r["summary"] in got)
        was = SEEN.get("overflow_768_before")
        w.check("sizes", role, "768 px, sidebar open: Status and DC Pending are seen without a sideways scroll "
                "(first walk's nit: the table ran 173 px past the card)",
                f"layout {lay}, {hidden} px past the edge (develop's DC-wise table: {was if was is not None else '?'} px)",
                hidden <= 1, kind="must")
        target = c.locator(ITEM_CARDS).first if lay == "cards" else c.locator("div.overflow-x-auto").first
        w.step(page, "sizes", "after", role, user,
               f"768 px with the sidebar open: Item-wise picks the layout that fits the card ({lay}).",
               pins=[pin(target, f"Layout: {lay}; nothing runs past the card, so Status shows without a sideways "
                     "scroll.", "info")])
        page.set_viewport_size({"width": 390, "height": 844})
        settle(page, 1000)
        lay = item_layout(c)
        cards = c.locator(ITEM_CARDS).count()
        sb, cb = switch(page).bounding_box(), c.bounding_box()
        full = bool(sb and cb and sb["width"] >= cb["width"] - 48)
        w.check("sizes", role, f"390 px: one card per item ({len(p['rows'])})", f"layout {lay}, {cards} cards",
                lay == "cards" and cards == len(p["rows"]))
        w.check("sizes", role, "390 px: the switch runs full width",
                f"switch {round(sb['width'])} px in a {round(cb['width'])} px card" if sb and cb else "not measured",
                full)
        status_btn = c.get_by_role("button", name="Status")
        w.step(page, "sizes", "after", role, user, "390 px: one card per item, a Status filter button above, the "
               "switch full width. Open Status.", click=status_btn,
               pins=[pin(switch(page), "Full width.", "info")])
        settle(page, 600)
        opts = [t.strip() for t in page.get_by_role("option").all_inner_texts()]
        w.check("sizes", role, "390 px: the Status button opens the same options", ", ".join(opts),
                opts == p["options"])
        w.step(page, "sizes", "after", role, user, "390 px: the same Status options.")
        page.keyboard.press("Escape")
        open_itm(page, m["name"])
        c = card(page)
        view_btn(page, "Item-wise").click()
        settle(page, 800)
        cards = c.locator(ITEM_CARDS).count()
        w.check("sizes", role, f"390 px ITM: one card per item ({len(m['rows'])})", f"{cards} cards",
                cards == len(m["rows"]))
        w.step(page, "sizes", "after", role, user, f"390 px: {m['name']} Item-wise as cards (\"Transfer\" in place "
               "of Ordered).", pins=[pin(c.locator(ITEM_CARDS).first, "One card per ITM item.", "info")])


# ---------------------------------------------------------------- 8 · Reports unchanged

def tiles_and_rows(page) -> dict:
    """The report's summary tiles (count + name) and the status cell of every rendered row."""
    tiles = page.evaluate(
        "() => [...document.querySelectorAll('div')].filter(d => d.children.length === 2 && "
        "/^\\d+$/.test(d.children[0].textContent.trim()) && d.children[1].children.length === 0)"
        ".map(d => d.children[1].textContent.trim() + ' ' + d.children[0].textContent.trim())")
    rows = page.evaluate(
        "() => [...document.querySelectorAll('tbody tr')].filter(r => r.cells.length > 6)"
        ".map(r => r.cells[1].innerText.trim() + ' ' + r.cells[r.cells.length - 1].innerText.trim())")
    return {"tiles": tiles, "rows": rows}


TILE = {"Fully Matched": "matched", "Quantity Mismatch": "mismatch", "No DC Update": "no_dc_update",
        "Pending DN": "pending_dn", "Partially Delivered": "partially_delivered"}


def tm_tiles(page) -> dict[str, int]:
    """The Transfer Memos report's summary cards, label -> count (only the visible ones)."""
    pairs = page.evaluate(
        "() => [...document.querySelectorAll('div')].filter(d => d.offsetParent !== null && d.children.length === 2 "
        "&& /^\\d+$/.test(d.children[0].textContent.trim()) && d.children[1].children.length === 0)"
        ".map(d => [d.children[1].textContent.trim(), +d.children[0].textContent.trim()])")
    return {k: v for k, v in pairs if k in TILE}


def tm_rows(page) -> dict[str, dict]:
    """Every rendered row of the Transfer Memos table: ITM -> {label, items: [[category, name cell, label]]}."""
    cells = page.evaluate(
        "() => [...document.querySelectorAll('tbody tr')].filter(r => r.cells.length === 10)"
        ".map(r => [...r.cells].map(c => c.innerText.trim()))")
    res, cur = {}, None
    for r in cells:
        if r[1]:
            cur = res.setdefault(r[1], {"label": r[-1], "items": []})
        elif cur is not None:
            cur["items"].append([r[3], r[4], r[-1]])
    return res


def tm_item(got: dict, itm: str, x: dict) -> str | None:
    """The shown status of one oracle item in tm_rows' result (matched on name and category)."""
    cat = x["category"] or "—"
    return next((st for c, nm, st in got.get(itm, {}).get("items", [])
                 if c == cat and squash(nm).startswith(squash((x["name"] or "N/A") + "("))), None)


def squash(t: str) -> str:
    """Text without whitespace: the report puts its "(unit)" right after the name, with only a margin between."""
    return "".join(t.split())


def reports(side: str) -> None:
    role, user, proj = "Admin", USERS["Admin"], FA["report_project"]
    oracle = F[side]["report_itm"][side][proj]
    with session(ENVS[side], user, a.password) as (page, _):
        page.set_viewport_size({"width": 1600, "height": 1000})
        open_project(page, proj)
        page.get_by_role("button", name="DC & MIR", exact=True).first.click()
        settle(page, 4000)
        po = tiles_and_rows(page)
        src = page.get_by_text("Source", exact=True).locator("..")
        tiles = page.get_by_text("Fully Matched", exact=True).locator("../..").locator("..")
        dev = "Develop" if side == "before" else "Branch"
        w.step(page, "reports", side, role, user, f"{dev}: {proj} › DN > DC Report (Purchase Orders). Then Transfer "
               "Memos.", click=src.get_by_role("button", name="Transfer Memos"),
               pins=[pin(tiles, "Tiles: " + "; ".join(po["tiles"]), "info")])
        settle(page, 4000)
        kind = "must" if side == "after" else "info"

        # 9 · the summary cards and the info text, as develop
        shown_tiles = tm_tiles(page)
        want = {lab: oracle["tiles"].get(st, 0) for lab, st in TILE.items() if st != "partially_delivered"}
        w.check("itm_report", role, f"{side}: develop's {len(want)} summary cards, each ITM counted by its rollup: "
                + "; ".join(f"{k} {v}" for k, v in want.items()),
                "; ".join(f"{k} {v}" for k, v in shown_tiles.items()), shown_tiles == want, kind=kind)
        w.check("itm_report", role, f"{side}: no Partially Delivered card", f"cards: {', '.join(shown_tiles)}",
                "Partially Delivered" not in shown_tiles, kind=kind)
        grid = page.locator("div.grid").filter(has=page.get_by_text("Fully Matched", exact=True)).last
        info = page.get_by_text(re.compile(r"Compares Delivery Note \(DN\) vs Delivery Challan")).first
        info_text = norm(info.inner_text()) if info.count() else ""
        SEEN[f"tm_info_{side}"] = info_text
        if side == "after" and "tm_info_before" in SEEN:
            w.check("itm_report", role, "the info text is develop's", info_text, info_text == SEEN["tm_info_before"])
        pins = [pin(grid, f"{len(shown_tiles)} cards: " + "; ".join(f"{k} {v}" for k, v in shown_tiles.items()),
                    "info"), pin(info, info_text[:240], "info")]
        w.step(page, "itm_report", side, role, user, f"{dev}: {proj} › DN > DC Report (Transfer Memos): the summary "
               "cards and the info text.", pins=pins)

        # 9 · the default status filter, as develop
        w.step(page, "itm_report", side, role, user, f"{dev}: open the Status filter to see what it ticks by default.",
               click=tm_funnel(page))
        settle(page, 600)
        opts = options_ticked(page)
        ticked = [o for o, t in opts if t]
        SEEN[f"tm_ticked_{side}"] = ticked
        if side == "after" and "tm_ticked_before" in SEEN:
            w.check("itm_report", role, "the default status filter ticks what develop ticks: "
                    + ", ".join(SEEN["tm_ticked_before"]), ", ".join(ticked), ticked == SEEN["tm_ticked_before"])
        w.step(page, "itm_report", side, role, user, f"{dev}: ticked by default: {', '.join(ticked) or 'none'}. "
               "\"Clear filters\" to see every ITM, Matched ones too.",
               click=page.get_by_role("option", name="Clear filters"),
               pins=[pin(page.get_by_role("listbox").first, "Ticked: " + ", ".join(ticked), "info")])
        settle(page, 600)
        page.keyboard.press("Escape")
        parents = page.locator("tbody tr").filter(has=page.locator('a[href*="/internal-transfer-memos/"]'))
        for i in range(parents.count()):
            parents.nth(i).locator("td").first.click()
            page.wait_for_timeout(250)
        settle(page, 800)
        got = tm_rows(page)
        SEEN[f"tm_{side}"] = got

        # 9 · rollups and item statuses against the oracle (develop's ITM rule and rollup)
        for n, exp in oracle["itms"].items():
            g = got.get(n, {})
            statuses = sorted({x["label"] for x in exp["items"]})
            w.check("itm_report", role, f"{side}: {n} rolls up to {exp['label']} from {', '.join(statuses)} "
                    "(develop's order)", g.get("label", "not shown"), g.get("label") == exp["label"], kind=kind)
            bad = [(x["name"], x["label"], tm_item(got, n, x)) for x in exp["items"] if tm_item(got, n, x) != x["label"]]
            w.check("itm_report", role, f"{side}: {n}'s {len(exp['items'])} item rows read develop's ITM rule",
                    f"{len(bad)} differ" + (f": {bad[:3]}" if bad else ""), not bad, kind=kind)
        extra = sorted(set(got) - set(oracle["itms"]))
        w.check("itm_report", role, f"{side}: the report lists exactly the {len(oracle['itms'])} ITMs the oracle builds",
                f"{len(got)} listed" + (f"; not in the oracle: {extra}" if extra else ""),
                set(got) == set(oracle["itms"]), kind=kind)
        w.step(page, "itm_report", side, role, user, f"{dev}: every ITM expanded, {len(got)} ITMs.",
               pins=[pin(page.locator("tbody").first, f"{len(got)} ITMs, item statuses read row by row.", "info")])

        # 8 · no Transfer Memos item status differs before vs after
        if side == "after" and "tm_before" in SEEN:
            before = SEEN["tm_before"]
            diffs = [(n, x, tm_item(before, n, x), tm_item(got, n, x)) for n, e in oracle["itms"].items()
                     for x in e["items"] if tm_item(before, n, x) != tm_item(got, n, x)]
            n_items = sum(len(e["items"]) for e in oracle["itms"].values())
            w.check("reports", role, f"Transfer Memos: the same status per item before and after ({n_items} items)",
                    f"{len(diffs)} differ" + (": " + "; ".join(f"{n} {x['name'][:30]}: {was} -> {now}"
                                                               for n, x, was, now in diffs[:5]) if diffs else ""),
                    not diffs)
            w.check("reports", role, "Transfer Memos: the same rollup per ITM before and after",
                    "; ".join(f"{n}: {before.get(n, {}).get('label')} -> {got[n]['label']}" for n in got
                              if before.get(n, {}).get("label") != got[n]["label"]) or "all the same",
                    all(before.get(n, {}).get("label") == got[n]["label"] for n in got))
        (out / "db").mkdir(exist_ok=True)
        (out / "db" / f"report_screen_{side}.json").write_text(json.dumps({"po": po, "tm": got}, indent=1))
        SEEN[f"reports_{side}"] = {"po": po}


def reports_after() -> None:
    reports("after")


def reports_before() -> None:
    reports("before")


def reports_same() -> None:
    af, bf = SEEN.get("reports_after"), SEEN.get("reports_before")
    if not (af and bf):
        return
    w.check("reports", "Admin", "Purchase Orders: the same tiles before and after: " + "; ".join(bf["po"]["tiles"]),
            "; ".join(af["po"]["tiles"]), af["po"]["tiles"] == bf["po"]["tiles"] and bool(af["po"]["tiles"]))
    diff = [x for x in zip(bf["po"]["rows"], af["po"]["rows"]) if x[0] != x[1]]
    w.check("reports", "Admin", f"Purchase Orders: the same status per row before and after "
            f"({len(bf['po']['rows'])} rows)", f"{len(af['po']['rows'])} rows, {len(diff)} differ"
            + (f": {diff[:3]}" if diff else ""),
            not diff and len(af["po"]["rows"]) == len(bf["po"]["rows"]) and bool(af["po"]["rows"]))


# ---------------------------------------------------------------- run

def guarded(cid: str, fn, tries: int = 2) -> None:
    for attempt in range(1, tries + 1):
        steps, checks, shown = len(w.data["steps"]), len(w.data["checks"]), set(CASE_SHOWN)
        try:
            fn()
            return
        except Exception as e:
            traceback.print_exc()
            del w.data["steps"][steps:], w.data["checks"][checks:]
            CASE_SHOWN.clear()
            CASE_SHOWN.update(shown)
            if attempt == tries:
                w.status(cid, "failed", f"walk stopped in {fn.__name__}: {type(e).__name__}: "
                         f"{str(e).splitlines()[0][:160]}")


w.check("po_switch", "Admin", "the walk's records exist on both envs (same data)",
        f"after {sorted(F['after']['picked'].items())}; before {sorted(F['before']['picked'].items())}",
        F["after"]["picked"] == F["before"]["picked"], kind="info")

PLAN = [("po_switch", po_admin_before), ("po_switch", po_admin_after), ("po_switch", po_dc_same),
        ("po_switch", po_pe_after), ("po_switch", po_pm_before), ("po_switch", po_pm_after),
        ("po_rule", po_rule_after), ("po_rule", po_nb_after), ("po_rule", po_stub_after),
        ("itm_switch", itm_pmo_before), ("itm_switch", itm_pmo_after), ("itm_switch", itm_dc_same),
        ("itm_switch", itm_pm_after), ("itm_rule", itm_cases_after), ("itm_rule", itm_report_after),
        ("wo", wo_before), ("wo", wo_after),
        ("sizes", sizes_before), ("sizes", sizes_after),
        ("reports", reports_before), ("reports", reports_after), ("reports", reports_same)]


def side_of(fn) -> str:
    """The env a step function drives: *_before walks develop; every other one walks (or compares with) the branch."""
    return "before" if fn.__name__.endswith("_before") else "after"


SERVED = {"side": None}


def serve_only(side: str) -> None:
    """--one-lane: stop the other env and serve this one (one published vite port on this machine)."""
    if SERVED["side"] == side:
        return
    other = "after" if side == "before" else "before"
    subprocess.run([DEVENV, "stop", ENVS[other]], capture_output=True, text=True, timeout=300)
    res = subprocess.run([DEVENV, "serve", ENVS[side], "--wait"], capture_output=True, text=True, timeout=900)
    if res.returncode != 0:
        sys.exit(f"walk: could not serve {ENVS[side]}:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    SERVED["side"] = side


if a.one_lane:
    # Every "before" step first, then the branch: the after steps that compare with develop (po_dc_same,
    # itm_dc_same, sizes_after, reports_after, reports_same) read what the before steps kept in SEEN.
    PLAN = [x for x in PLAN if side_of(x[1]) == "before"] + [x for x in PLAN if side_of(x[1]) == "after"]
for cid, fn in PLAN:
    if not a.only or fn.__name__ in a.only:
        if a.one_lane:
            serve_only(side_of(fn))
        guarded(cid, fn)
if a.one_lane and SERVED["side"]:
    subprocess.run([DEVENV, "stop", ENVS[SERVED["side"]]], capture_output=True, text=True, timeout=300)

for c in w.data["changes"]:
    if c["status"] in ("failed", "not_walked") and c["reason"]:
        continue
    if not any(x["change"] == c["id"] for x in w.data["steps"] + w.data["checks"]):
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [p for s in w.data["steps"] if s["change"] == c["id"] for p in s["pins"] if p["kind"] == "must"]
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad))
print(w.save())
