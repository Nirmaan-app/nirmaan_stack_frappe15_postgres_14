"""Walk branch card-invoice/type-tile-filter (Vendor Invoice Recon > Pending Invoices Upload > Credit Card: each Expense
Type box on the summary card filters the table) on its env and on an env of develop, before vs after. The branch has no
PR: its claims are commit 0292b15cb and the owner's asks of 2026-11-26 (a reset button; boxes must look clickable).

    python3 .claude/skills/pr-walk/bin/walk_branch_card_type_filter.py <out dir> --after <env> --before <env> \
        --acc <email> --pe <email> --data-note <text> [--password <pw>] [--one-lane] [function ...]

Run it from the checkout root with the two users' passwords set on both envs. Every figure the walk checks on screen is
recomputed at the start from the env's own queue (`get_card_invoice_queue`, as the Accountant), never copied from the
screen; the types it clicks are picked from that queue by amount. It writes nothing to the DB.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parents[1] / "verify" / "bin"))
sys.path.insert(0, str(HERE))
from drive import session, sidebar  # noqa: E402
from record import Walk, pin  # noqa: E402

DEVENV = str(ROOT / "scripts/devenv/devenv.sh")
STRIP_TEXT = "Card spends waiting for an invoice"

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("only", nargs="*")
ap.add_argument("--after", required=True)
ap.add_argument("--before", required=True)
ap.add_argument("--acc", required=True, help="an Accountant")
ap.add_argument("--pe", required=True, help="a Procurement Executive")
ap.add_argument("--password", default="WalkPw-CardType")
ap.add_argument("--data-note", required=True)
ap.add_argument("--one-lane", action="store_true")
a = ap.parse_args()
ENVS = {"after": a.after, "before": a.before}
out = Path(a.out)

w = Walk(out, pr={"number": "card-invoice/type-tile-filter",
                  "title": "Credit Card pending uploads: click an Expense Type box to filter the table",
                  "url": "", "author": "", "head": "0292b15cb", "base": "31d29db45"},
         envs=ENVS, data_note=a.data_note)

w.change("pick", "1 · Click a box: the table shows only that Expense Type",
         "Vendor Invoice Recon › Pending Invoices Upload › Credit Card: clicking an Expense Type box on \"Card Spends "
         "Pending Invoice\" filters the table to that type. The box is highlighted (teal left bar, tint, ✓). The click "
         "is the table's own Expense Type column filter: the funnel shows it ticked and the \"Filtered\" chip shows.")
w.change("multi", "2 · Several types; a second click removes one",
         "Clicking another box adds its type (several may be picked, as in the column filter); clicking a picked box "
         "again drops it.")
w.change("boxes", "3 · All boxes stay; the top strip is the table",
         "While types are picked every Expense Type box stays, with its full amount and count (counted over every filter "
         "but Expense Type); boxes not picked are dimmed. The top strip (spends | amount) still totals exactly the rows "
         "the table shows. A box's % is of the boxes' own total.")
w.change("zero", "4 · A picked type left with no spends stays at ₹0",
         "When another filter (here the search box) leaves a picked type with no spends, its box stays at ₹0 and "
         "highlighted, so it can still be clicked off.")
w.change("clear", "5 · Clear button (owner's ask)",
         "A \"Clear type\" / \"Clear N types\" button beside the card title, shown only while a type is picked, drops the "
         "Expense Type filter only: search and the other filters stay.")
w.change("url", "6 · Reload keeps the pick", "The pick lives in the URL (the table's filter param): a reload keeps it.")
w.change("export", "7 · Export = the table", "Export downloads exactly the rows the table shows under the pick.")
w.change("cues", "8 · The boxes look clickable (owner's ask)",
         "A hint line above the boxes (\"Click an Expense Type to filter the table\"; \"Showing N of M Expense Types · "
         "click a box to add or remove it\" while picked); a filter icon before each name; a pointer cursor.")
w.change("develop", "9 · Same figures as develop; develop's boxes are not buttons",
         "Unfiltered, the boxes and the top strip show the same figures before and after, and keep develop's layout "
         "(amount at the right edge, the share bar). On develop a box is not clickable.")
w.change("roles", "10 · Procurement Executive gets the same",
         "Every profile that sees the tab (Admin, Accountants, PMO, procurement) gets the clickable boxes; walked as a "
         "Procurement Executive.")
w.change("notype", "11 · \"No expense type\" box filters too",
         "A spend with no Expense Type is grouped and filtered under \"No expense type\".")

# ---------------------------------------------------------------- facts from the env DB

FACTS = r'''
import json, sys
import frappe
from nirmaan_stack.api.expenses import card_invoices as ci

a = json.loads(sys.argv[1])
frappe.set_user(a["acc"])
rows = ci.get_card_invoice_queue()
g = {}
for r in rows:
    t = r["expense_type"] or "No expense type"
    x = g.setdefault(t, {"type": t, "count": 0, "amount": 0.0, "merchants": []})
    x["count"] += 1
    x["amount"] += float(r["amount"] or 0)
    if r["merchant"] and r["merchant"] not in x["merchants"]:
        x["merchants"].append(r["merchant"])
types = sorted(g.values(), key=lambda x: (-x["amount"], x["type"]))
see = {}
for k in ("acc", "pe"):
    frappe.set_user(a[k])
    see[k] = len(ci.get_card_invoice_queue())
frappe.set_user("Administrator")
print("JSON " + json.dumps({"n": len(rows), "total": sum(x["amount"] for x in types), "types": types, "see": see}))
'''


def db_json(task: str, name: str, code: str, *args: str) -> dict:
    src = out / "db" / f"{name}.py"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text(code)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=600)
    (out / "db" / f"{name}.txt").write_text(res.stdout + res.stderr)
    line = next((ln for ln in res.stdout.splitlines() if ln.startswith("JSON ")), None)
    if line is None:
        raise RuntimeError(f"{name} on {task} printed no JSON:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    return json.loads(line[5:])


ARGS = json.dumps({"acc": a.acc, "pe": a.pe})
F = {"after": db_json(a.after, "facts_after", FACTS, ARGS), "before": db_json(a.before, "facts_before", FACTS, ARGS)}
FA = F["after"]
TYPES = FA["types"]
if len(TYPES) < 3:
    sys.exit(f"walk: the queue needs 3 Expense Types, has {[t['type'] for t in TYPES]}")
T1, T2, TZ = TYPES[0], TYPES[1], TYPES[-1]  # largest, second, smallest (the ₹0 case)
# Search for a merchant of the largest type that the smallest type does not have: it leaves TZ with no spends.
TERM = next((m for m in T1["merchants"] if m not in TZ["merchants"] and len(m) >= 5), T1["merchants"][0])


def inr(x: float) -> str:
    """formatToRoundedIndianRupee: Math.round, then en-IN grouping."""
    n = math.floor(x + 0.5)
    s = str(abs(n))
    if len(s) > 3:
        head, parts = s[:-3], []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        s = ",".join(([head] if head else []) + parts) + "," + s[-3:]
    return ("-" if n < 0 else "") + "₹" + s


def pct(part: float, whole: float) -> str:
    return f"{math.floor(part / whole * 100 + 0.5)}%" if whole > 0 else ""


EXPECT_BOXES = [(t["type"], inr(t["amount"]), t["count"], pct(t["amount"], FA["total"])) for t in TYPES]
SEEN: dict = {}

# ---------------------------------------------------------------- helpers


def settle(page, ms: int = 1200) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def open_tab(page, side: str, role: str, user: str, record: bool) -> None:
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoices Upload", exact=True).click()
    settle(page, 800)
    cc = page.get_by_role("button", name="Credit Card", exact=True)
    if record:
        w.step(page, "pick" if side == "after" else "develop", side, role, user,
               "Vendor Invoice Recon › Pending Invoices Upload. Open the Credit Card sub-tab.", click=cc)
    else:
        cc.click()
    settle(page, 2500)


def card(page):
    """The bordered block holding the top strip and the Expense Type boxes."""
    return page.locator("div.rounded-lg.border").filter(has_text=STRIP_TEXT).first


def grid(page):
    return card(page).locator("div.grid").first


def box(page, name: str):
    return grid(page).locator(":scope > *").filter(has_text=name).first


def boxes(page) -> list[dict]:
    res = []
    for el in grid(page).locator(":scope > *").all():
        lines = [x.strip() for x in el.inner_text().split("\n") if x.strip()]
        res.append({"type": lines[0], "amount": lines[1], "count": int(lines[2].lstrip("· ")),
                    "pct": lines[3] if len(lines) > 3 else "", "pressed": el.get_attribute("aria-pressed"),
                    "tag": el.evaluate("e => e.tagName"), "opacity": el.evaluate("e => getComputedStyle(e).opacity")})
    return res


def strip(page) -> tuple[int, str]:
    t = card(page).locator(":scope > div").first.inner_text()
    m = re.search(r"(\d+)\s*spends?\s*\|?\s*(₹[\d,]+)", t.replace("\n", " "))
    return (int(m.group(1)), m.group(2)) if m else (-1, t)


def table_count(page) -> int:
    t = page.get_by_text(re.compile(r"Page \d+ of \d+ \(")).first.inner_text()
    m = re.search(r"of (\d+)\)", t)
    return int(m.group(1)) if m else -1


def table_types(page) -> list[str]:
    heads = [h.strip() for h in page.locator("table thead th").all_inner_texts()]
    i = next((k for k, h in enumerate(heads) if "Expense Type" in h), None)
    if i is None:
        return []
    return [r.locator("td").nth(i).inner_text().strip() for r in page.locator("table tbody tr").all()
            if r.locator("td").count() > i]


def hint(page) -> str:
    h = card(page).get_by_text(re.compile(r"^(Click an Expense Type|Showing \d+ of \d+)"))
    return h.first.inner_text().strip() if h.count() else ""


def clear_btn(page):
    return page.get_by_role("button", name=re.compile(r"^Clear (type|\d+ types)$"))


def filtered_chip(page) -> bool:
    return page.get_by_text("Filtered", exact=True).count() > 0


def layout(page, name: str) -> dict:
    """The box's share-bar track width and the gap between its amount and the box's right edge."""
    b = box(page, name)
    bb = b.bounding_box()
    track = b.locator("div.h-1").first.bounding_box()
    amt = b.get_by_text(re.compile(r"^₹[\d,]+$")).first.bounding_box()
    return {"box_w": round(bb["width"]), "bar_w": round(track["width"]) if track else 0,
            "amount_gap": round(bb["x"] + bb["width"] - (amt["x"] + amt["width"])) if amt else -1}


def check_boxes_full(cid: str, role: str, page, what: str) -> None:
    seen = [(x["type"], x["amount"], x["count"], x["pct"]) for x in boxes(page)]
    w.check(cid, role, f"{what}: every Expense Type box with its full figures: "
            + "; ".join(f"{t} {m} · {c} {p}" for t, m, c, p in EXPECT_BOXES),
            "; ".join(f"{t} {m} · {c} {p}" for t, m, c, p in seen), seen == EXPECT_BOXES)


# ---------------------------------------------------------------- 9 · develop


def develop_before() -> None:
    role, user = "Accountant", a.acc
    with session(a.before, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1440, "height": 900})
        open_tab(page, "before", role, user, record=True)
        bx = boxes(page)
        SEEN["before_boxes"] = [(x["type"], x["amount"], x["count"], x["pct"]) for x in bx]
        SEEN["before_strip"] = strip(page)
        SEEN["before_layout"] = layout(page, T1["type"])
        w.check("develop", role, f"develop: boxes are figures, not buttons", ", ".join(sorted({x['tag'] for x in bx})),
                all(x["tag"] == "DIV" for x in bx), kind="info")
        w.step(page, "develop", "before", role, user,
               f"develop: the same card, {len(bx)} Expense Type boxes as plain figures. Click \"{T1['type']}\".",
               click=box(page, T1["type"]),
               pins=[pin(box(page, T1["type"]).locator("div.h-1").first,
                         f"develop's box: amount at the right edge, share bar {SEEN['before_layout']['bar_w']} px wide.",
                         "info")])
        settle(page, 800)
        n = table_count(page)
        w.check("develop", role, f"develop: a box click does nothing (table stays {FA['n']} rows)", f"{n} rows",
                n == F["before"]["n"], kind="info")


# ---------------------------------------------------------------- 1-8 · the branch, as the Accountant


def acc_after() -> None:
    role, user = "Accountant", a.acc
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1440, "height": 900})
        open_tab(page, "after", role, user, record=True)

        # Unfiltered: figures as develop, the clickable cues, the layout.
        check_boxes_full("develop", role, page, "unfiltered, against the DB")
        if "before_boxes" in SEEN:
            now = [(x["type"], x["amount"], x["count"], x["pct"]) for x in boxes(page)]
            w.check("develop", role, "unfiltered: the same boxes as develop", str(now), now == SEEN["before_boxes"])
            w.check("develop", role, f"unfiltered: the same top strip as develop {SEEN['before_strip']}",
                    str(strip(page)), strip(page) == SEEN["before_strip"])
        w.check("develop", role, f"top strip = the queue: {FA['n']} spends | {inr(FA['total'])}", str(strip(page)),
                strip(page) == (FA["n"], inr(FA["total"])))
        lay = layout(page, T1["type"])
        SEEN["after_layout"] = lay
        bl = SEEN.get("before_layout")
        bar_ok = lay["bar_w"] >= 40 and (not bl or lay["bar_w"] >= bl["bar_w"] * 0.6)
        gap_ok = lay["amount_gap"] <= 60 or (bl is not None and lay["amount_gap"] <= bl["amount_gap"] + 30)
        w.check("develop", role, "box layout as develop: share bar wide "
                + (f"(develop {bl['bar_w']} px)" if bl else "(≥ 40 px)"), f"{lay['bar_w']} px", bar_ok, kind="should")
        w.check("develop", role, "box layout as develop: amount at the box's right edge "
                + (f"(develop gap {bl['amount_gap']} px)" if bl else ""), f"gap {lay['amount_gap']} px of a "
                f"{lay['box_w']} px box", gap_ok, kind="should")
        h0 = hint(page)
        w.check("cues", role, "hint: \"Click an Expense Type to filter the table\"", h0,
                h0 == "Click an Expense Type to filter the table")
        bx = boxes(page)
        w.check("cues", role, "every box is a button (aria-pressed)", ", ".join(sorted({x["tag"] for x in bx})),
                all(x["tag"] == "BUTTON" and x["pressed"] == "false" for x in bx))
        cur = box(page, T1["type"]).evaluate("e => getComputedStyle(e).cursor")
        w.check("cues", role, "pointer cursor on a box", cur, cur == "pointer")
        icons = grid(page).locator(":scope > * svg.lucide-list-filter").count()
        w.check("cues", role, f"a filter icon before each of the {len(bx)} names", f"{icons} icons", icons == len(bx))
        w.check("clear", role, "no Clear button while nothing is picked", f"{clear_btn(page).count()} shown",
                clear_btn(page).count() == 0)
        pins = [pin(card(page).get_by_text(h0).first, "Hint line: the boxes filter the table.", "info")]
        if not (bar_ok and gap_ok):
            pins.append(pin(box(page, T1["type"]),
                            f"Regression vs develop: the box's inner rows shrink to their content inside the <button> "
                            f"-- share bar {lay['bar_w']} px (develop {bl['bar_w'] if bl else '?'}), amount "
                            f"{lay['amount_gap']} px from the right edge (develop {bl['amount_gap'] if bl else '?'}). "
                            "Likely fix: w-full on the two inner rows (or items-stretch on the button).", "should"))
        w.step(page, "pick", "after", role, user,
               f"The boxes are buttons: hint line, filter icon before each name. Click \"{T1['type']}\".",
               click=box(page, T1["type"]), pins=pins)
        settle(page, 800)

        # 1 · one type picked
        n = table_count(page)
        tt = set(table_types(page))
        w.check("pick", role, f"table: only {T1['type']}, {T1['count']} rows", f"{n} rows, types {sorted(tt)}",
                n == T1["count"] and tt == {T1["type"]})
        w.check("pick", role, "the box is pressed", str(box(page, T1["type"]).get_attribute("aria-pressed")),
                box(page, T1["type"]).get_attribute("aria-pressed") == "true")
        w.check("pick", role, "\"Filtered\" chip shows", str(filtered_chip(page)), filtered_chip(page))
        w.check("boxes", role, f"top strip = the table: {T1['count']} spends | {inr(T1['amount'])}", str(strip(page)),
                strip(page) == (T1["count"], inr(T1["amount"])))
        check_boxes_full("boxes", role, page, f"{T1['type']} picked")
        dim = [x for x in boxes(page) if x["pressed"] == "false" and float(x["opacity"]) >= 0.99]
        w.check("boxes", role, "boxes not picked are dimmed", f"{len(dim)} not dimmed", not dim, kind="nit")
        h1 = hint(page)
        want = f"Showing 1 of {len(TYPES)} Expense Types · click a box to add or remove it"
        w.check("cues", role, f"hint: \"{want}\"", h1, h1 == want)
        cb = clear_btn(page)
        w.check("clear", role, "Clear button reads \"Clear type\"", cb.first.inner_text().strip() if cb.count() else "none",
                cb.count() == 1 and cb.first.inner_text().strip() == "Clear type")
        w.step(page, "pick", "after", role, user,
               f"Only {T1['type']}: {T1['count']} rows; its box highlighted, the others dimmed but still there. "
               f"Click \"{T2['type']}\" to add it.", click=box(page, T2["type"]),
               pins=[pin(box(page, T1["type"]), "Picked: teal left bar, tint, ✓.", "info"),
                     pin(cb.first, "Clear button (owner's ask), only while a type is picked.", "info")])
        settle(page, 800)

        # 2 · two types
        n = table_count(page)
        tt = set(table_types(page))
        w.check("multi", role, f"table: {T1['type']} + {T2['type']}, {T1['count'] + T2['count']} rows",
                f"{n} rows, types {sorted(tt)}", n == T1["count"] + T2["count"] and tt == {T1["type"], T2["type"]})
        w.check("boxes", role, f"top strip: {T1['count'] + T2['count']} spends | {inr(T1['amount'] + T2['amount'])}",
                str(strip(page)), strip(page) == (T1["count"] + T2["count"], inr(T1["amount"] + T2["amount"])))
        want = f"Showing 2 of {len(TYPES)} Expense Types · click a box to add or remove it"
        w.check("cues", role, f"hint: \"{want}\"", hint(page), hint(page) == want)
        cb = clear_btn(page)
        w.check("clear", role, "Clear button reads \"Clear 2 types\"",
                cb.first.inner_text().strip() if cb.count() else "none",
                cb.count() == 1 and cb.first.inner_text().strip() == "Clear 2 types")
        # The funnel's wrapper: the icon itself bounces while a filter is on, so it is never "stable" to click.
        funnel = page.locator("table thead th").filter(has_text="Expense Type").locator("div.cursor-pointer").first
        w.step(page, "multi", "after", role, user,
               "Both types in the table. Open the Expense Type column filter.", click=funnel)
        settle(page, 600)
        ticked = [o.inner_text().strip() for o in page.get_by_role("option").all()
                  if o.locator("div.bg-primary").count()]
        want_t = sorted(f"{t['type']} ({t['count']})" for t in (T1, T2))
        w.check("pick", role, "the column filter has the same two ticked: " + ", ".join(want_t), ", ".join(sorted(ticked)),
                sorted(ticked) == want_t)
        w.step(page, "pick", "after", role, user,
               "The box clicks are the column filter itself: both ticked there.",
               pins=[pin(page.get_by_role("option").filter(has_text=T1["type"]).first, "Ticked by the box click.", "info")])
        page.keyboard.press("Escape")
        settle(page, 400)
        w.step(page, "multi", "after", role, user, f"Click \"{T1['type']}\" again to drop it.", click=box(page, T1["type"]))
        settle(page, 800)
        n = table_count(page)
        w.check("multi", role, f"after the second click: only {T2['type']}, {T2['count']} rows", f"{n} rows",
                n == T2["count"] and set(table_types(page)) == {T2["type"]})
        w.check("multi", role, f"{T1['type']} box no longer pressed",
                str(box(page, T1["type"]).get_attribute("aria-pressed")),
                box(page, T1["type"]).get_attribute("aria-pressed") == "false")

        # 6 · reload
        page.reload()
        settle(page, 2500)
        n = table_count(page)
        w.check("url", role, f"after a reload: still only {T2['type']} ({T2['count']} rows), box pressed",
                f"{n} rows, pressed {box(page, T2['type']).get_attribute('aria-pressed')}",
                n == T2["count"] and box(page, T2["type"]).get_attribute("aria-pressed") == "true")

        # 7 · export
        export = page.get_by_role("button", name="Export")
        try:
            with page.expect_download(timeout=30000) as dl:
                w.step(page, "export", "after", role, user,
                       f"After a reload the pick stays ({T2['type']}). Click Export.", click=export)
            p = dl.value.path()
            lines = [ln for ln in Path(p).read_text(encoding="utf-8-sig").splitlines() if ln.strip()]
            body = lines[1:]
            (out / "db" / "export.csv").write_text("\n".join(lines))
            w.check("export", role, f"Export: {T2['count']} rows, all {T2['type']}",
                    f"{len(body)} rows; {dl.value.suggested_filename}",
                    len(body) == T2["count"] and all(T2["type"] in ln for ln in body))
        except Exception as e:  # noqa: BLE001
            w.check("export", role, "Export downloads the table's rows", f"no download: {type(e).__name__}", False)
        settle(page, 800)

        # 4 · zero box via search
        w.step(page, "zero", "after", role, user, f"Add \"{TZ['type']}\" ({TZ['count']} spend).", click=box(page, TZ["type"]))
        settle(page, 600)
        search = page.get_by_placeholder(re.compile("Search merchant"))
        search.fill(TERM)
        settle(page, 1500)
        tt = table_types(page)
        bz = next((x for x in boxes(page) if x["type"] == TZ["type"]), None)
        if TZ["type"] in tt:
            w.check("zero", role, f"search \"{TERM}\" leaves {TZ['type']} with no spends", f"it still has rows", True,
                    kind="info")
            w.status("zero", "not_walked", f"the search \"{TERM}\" still matched a {TZ['type']} spend (fuzzy search)")
        else:
            w.check("zero", role, f"{TZ['type']} box stays, ₹0 · 0, pressed",
                    f"{bz['amount']} · {bz['count']}, pressed {bz['pressed']}" if bz else "box gone",
                    bool(bz) and bz["amount"] == "₹0" and bz["count"] == 0 and bz["pressed"] == "true")
        n_search = table_count(page)
        cb = clear_btn(page)
        w.step(page, "zero", "after", role, user,
               f"Search \"{TERM}\": {TZ['type']} has no spend left; its box stays at ₹0, still picked. "
               "Click Clear.", click=cb.first,
               pins=[pin(box(page, TZ["type"]), "₹0 · 0 and still highlighted: it can be clicked off.", "info")])
        settle(page, 800)

        # 5 · clear keeps search
        kept = search.input_value()
        n = table_count(page)
        pressed = [x["type"] for x in boxes(page) if x["pressed"] == "true"]
        w.check("clear", role, f"Clear drops every picked type; the search \"{TERM}\" stays", f"picked {pressed}, "
                f"search \"{kept}\"", not pressed and kept == TERM)
        w.check("clear", role, f"table: every type that matches \"{TERM}\" ({n} ≥ {n_search} rows)",
                f"{n} rows, types {sorted(set(table_types(page)))}", n >= n_search and n > 0)
        w.check("clear", role, "the Clear button is gone", f"{clear_btn(page).count()} shown", clear_btn(page).count() == 0)
        w.step(page, "clear", "after", role, user,
               f"After Clear: no box picked, the search \"{TERM}\" kept, the hint back to \"Click an Expense Type…\".",
               pins=[pin(search, "Search kept: Clear drops the Expense Type filter only.", "info")])


# ---------------------------------------------------------------- 10 · Procurement Executive


def pe_after() -> None:
    role, user = "Procurement Executive", a.pe
    w.check("roles", role, f"the PE sees the whole queue ({FA['n']})", str(FA["see"]["pe"]), FA["see"]["pe"] == FA["n"],
            kind="info")
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1440, "height": 900})
        open_tab(page, "after", role, user, record=False)
        w.step(page, "roles", "after", role, user, f"As a Procurement Executive. Click \"{T2['type']}\".",
               click=box(page, T2["type"]))
        settle(page, 800)
        n = table_count(page)
        w.check("roles", role, f"table: only {T2['type']}, {T2['count']} rows", f"{n} rows",
                n == T2["count"] and set(table_types(page)) == {T2["type"]})
        w.step(page, "roles", "after", role, user, f"Only {T2['type']}, the box highlighted.",
               pins=[pin(box(page, T2["type"]), "Picked, as for the Accountant.", "info")])


# ---------------------------------------------------------------- 11 · No expense type


def notype_after() -> None:
    """Needs a spend with no Expense Type in the queue: walk3/db/setup_notype.py makes one on the walk envs."""
    nt = next((t for t in TYPES if t["type"] == "No expense type"), None)
    if nt is None:
        return
    role, user = "Accountant", a.acc
    with session(a.after, user, a.password) as (page, _):
        page.set_viewport_size({"width": 1440, "height": 900})
        open_tab(page, "after", role, user, record=False)
        w.step(page, "notype", "after", role, user,
               f"A spend with no Expense Type has its own box, \"No expense type\" ({inr(nt['amount'])} · {nt['count']}). "
               "Click it.", click=box(page, "No expense type"))
        settle(page, 800)
        n = table_count(page)
        tt = set(table_types(page))
        w.check("notype", role, f"table: only \"No expense type\" spends, {nt['count']} row(s)",
                f"{n} rows, types {sorted(tt)}", n == nt["count"] and tt == {"No expense type"})
        w.check("notype", role, "the box is pressed", str(box(page, "No expense type").get_attribute("aria-pressed")),
                box(page, "No expense type").get_attribute("aria-pressed") == "true")
        w.check("notype", role, f"top strip: {nt['count']} spend(s) | {inr(nt['amount'])}", str(strip(page)),
                strip(page) == (nt["count"], inr(nt["amount"])))
        funnel = page.locator("table thead th").filter(has_text="Expense Type").locator("div.cursor-pointer").first
        w.step(page, "notype", "after", role, user,
               "Only the spend with no Expense Type; its box highlighted. Open the Expense Type column filter.",
               click=funnel, pins=[pin(box(page, "No expense type"), "Picked: the \"No expense type\" box.", "info")])
        settle(page, 600)
        ticked = [o.inner_text().strip() for o in page.get_by_role("option").all()
                  if o.locator("div.bg-primary").count()]
        want = f"No expense type ({nt['count']})"
        w.check("notype", role, f"the column filter has \"{want}\" ticked", ", ".join(ticked), ticked == [want])
        w.step(page, "notype", "after", role, user,
               "The column filter offers and ticks the same \"No expense type\" value.",
               pins=[pin(page.get_by_role("option").filter(has_text="No expense type").first,
                         "Same label in the filter as on the box.", "info")])


# ---------------------------------------------------------------- run


def guarded(cid: str, fn, tries: int = 2) -> None:
    for attempt in range(1, tries + 1):
        steps, checks = len(w.data["steps"]), len(w.data["checks"])
        try:
            fn()
            return
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            del w.data["steps"][steps:], w.data["checks"][checks:]
            if attempt == tries:
                w.status(cid, "failed", f"walk stopped in {fn.__name__}: {type(e).__name__}: "
                         f"{str(e).splitlines()[0][:160]}")


w.check("develop", "Accountant", "the same queue on both envs (same data)",
        f"after {FA['n']} / before {F['before']['n']}", FA["types"] == F["before"]["types"], kind="info")
if not any(t["type"] == "No expense type" for t in TYPES):
    w.status("notype", "not_walked", "the env's queue has no spend without an Expense Type; the label and filter value "
             "are pinned by cardInvoicesView.test.ts")

PLAN = [("develop", develop_before), ("pick", acc_after), ("notype", notype_after), ("roles", pe_after)]
SERVED = {"side": None}


def serve_only(side: str) -> None:
    if SERVED["side"] == side:
        return
    other = "after" if side == "before" else "before"
    subprocess.run([DEVENV, "stop", ENVS[other]], capture_output=True, text=True, timeout=300)
    res = subprocess.run([DEVENV, "serve", ENVS[side], "--wait"], capture_output=True, text=True, timeout=900)
    if res.returncode != 0:
        sys.exit(f"walk: could not serve {ENVS[side]}:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    SERVED["side"] = side


for cid, fn in PLAN:
    if not a.only or fn.__name__ in a.only:
        if a.one_lane:
            serve_only("before" if fn.__name__.endswith("_before") else "after")
        guarded(cid, fn)

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
