#!/usr/bin/env python3
"""Walk the Customers pages as the two roles that use them, holding each screen to its DB row (#1694, the pilot).

    python3 .claude/skills/verify/bin/walk_customers.py --task <task> --user <accountant> --password <pw> \
        --admin-user <admin> --admin-password <pw>

Two sessions, each screen reached the way that user goes:

A Nirmaan Accountant Profile (Customers in its sidebar; it may read customers but the DocType gives it no create
or write, so it only views):
  01-list         sidebar Customers: the "<n> Customers" count and the ten newest customers' names and IDs.
  02-customer     a customer's name link: heading, Customer ID, contact, phone, email, GST, City/State, address,
                  Total and Active Projects.
  03-edit-form    the pen icon: every field of the edit form holds the customer's row and address.
  03b-empty       a customer saved with no phone or GST (#1703): type into each empty one and clear it again; Update
                  stays off, nothing is sent, and the DB row is unchanged.
A Nirmaan Admin Profile (Admin Options > Customers, Admin-only; it creates and edits):
  04-admin-list   Admin Options > Customers: the same count.
  05-create-form  Add New Customer, filled with a made-up customer (a 6-digit PIN from the Pincodes table fills City
                  and State); 06-created is the list after Submit.
  07-new-customer the made-up customer's page, from its link on the list.
  08-new-edit     its edit form; the contact person is changed and saved (09-edited).
  10-empty        the 03b case again, as the Admin (who may write, so a wrong save would reach the DB).

Every screen is compared with `customers_db.py` read on the env DB, saved as `db-*.json` beside the screenshots.
Prints each check as seen or FAILED, and exits 1 on any miss.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from drive import save, session, sidebar

ROOT = Path(__file__).resolve().parents[4]
DB = ".claude/skills/verify/bin/customers_db.py"
MADE_UP_PREFIX = "Zephyr Walk Builders"  # every customer this walk creates starts with this


def db(task: str, out: Path, label: str, *args: str) -> dict:
    run = subprocess.run([str(ROOT / "scripts/devenv/devenv.sh"), "script", task, DB, *args],
                         cwd=ROOT, capture_output=True, text=True)
    lines = [ln for ln in run.stdout.splitlines() if ln.startswith("{")]
    if run.returncode or not lines:
        sys.exit(f"walk: customers_db.py {' '.join(args)} failed:\n{run.stdout}\n{run.stderr}")
    row = json.loads(lines[-1])
    (out / f"db-{label}.json").write_text(json.dumps(row, indent=1) + "\n")
    return row


misses: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("seen   " if ok else "FAILED ") + what)
    if not ok:
        misses.append(what)


def shown(text: str, value: str | None, what: str) -> None:
    check(bool(value) and value in text, f"{what}: {value!r}")


def text_of(page) -> str:
    return page.locator("body").inner_text()


def wait_customer_page(page) -> None:
    page.get_by_text("Customer ID", exact=True).first.wait_for(timeout=60_000)
    page.get_by_text(re.compile(r"Total Projects", re.I)).first.wait_for()
    page.wait_for_load_state("networkidle")


def check_customer_page(page, rec: dict) -> None:
    c, addr = rec["customer"], rec["address"] or {}
    text = text_of(page)
    heading = page.locator("h2").first.inner_text().strip()
    check(heading == (c["customer_nickname"] or c["company_name"]), f"heading is the nickname: {heading!r}")
    shown(text, c["company_name"], "company name")
    shown(text, c["name"], "Customer ID")
    for field, label in [("company_contact_person", "Contact Person"), ("company_phone", "Contact Number"),
                         ("company_email", "Email Address"), ("company_gst", "GST Number")]:
        want = c[field] or "—"
        got = re.search(rf"{label}\s*\n\s*(.+)", text, re.I)
        check(bool(got) and got.group(1).strip() == want, f"{label} is {want!r} (screen: {got and got.group(1)!r})")
    if addr:
        shown(text, f"{addr['city'] or '—'}, {addr['state'] or '—'}", "City, State")
        full = ", ".join(v for v in (addr[k] for k in ("address_line1", "address_line2", "city", "state", "pincode")) if v)
        shown(text, full, "Full Address")
    for label, n in [("Total Projects", rec["projects"]), ("Active Projects", rec["active_projects"])]:
        check(bool(re.search(rf"{label}\s*\n\s*{n}\b", text, re.I)), f"{label} is {n}")


def open_edit(page):
    page.locator("button:has(svg.lucide-file-pen-line)").first.click()
    sheet = page.get_by_role("dialog")
    sheet.get_by_text("Customer Address Details").wait_for()
    return sheet


def check_edit_form(page, sheet, rec: dict) -> None:
    c, addr = rec["customer"], rec["address"] or {}
    want = [c["company_name"], c["customer_nickname"], c["company_email"], c["company_phone"],
            c["company_contact_person"], c["company_gst"], addr.get("address_line1"), addr.get("address_line2"),
            addr.get("city"), addr.get("state"), addr.get("pincode")]
    want = [w or "" for w in want]
    inputs = sheet.locator("input")
    if want[8]:  # City is filled from the PIN's Pincodes row once that arrives
        page.wait_for_function(
            "el => el.value !== ''", arg=inputs.nth(8).element_handle(), timeout=30_000)
    got = [inputs.nth(i).input_value() for i in range(inputs.count())]
    names = ["Company Name", "Nickname", "Company Email", "Company Phone", "Company Contact Person",
             "Company GST number", "Address Line 1", "Address Line 2", "City", "State", "Pin Code"]
    check(len(got) == len(names), f"the edit form has {len(names)} fields (got {len(got)})")
    for name, w, g in zip(names, want, got):
        check(g == w, f"edit form {name} holds {w!r} (screen: {g!r})")


def check_empty_unchanged(page, task: str, out: Path, step: str, who: str, may_write: bool) -> None:
    """#1703: a customer whose phone or GST is empty (null on the server, "" in the form). Each empty field is typed
    into and cleared, so the form holds "" where the server holds null; Save must count that as no change.
    With ``may_write`` (the Admin's part) a wrongly enabled Update is clicked, so the request and DB checks show what
    it would save; without it (``--part view``) nothing is clicked and the walk writes nothing."""
    rec = db(task, out, f"{step}-before", "empty", MADE_UP_PREFIX)
    c = rec["customer"]
    if c is None:
        print(f"not walked: {step} (no customer saved without a phone or GST)")
        return
    sent: list[str] = []
    page.on("request", lambda r: sent.append(f"{r.method} {r.url}")
            if r.method in ("PUT", "POST") and re.search(r"/api/resource/(Customers|Address)/", r.url) else None)
    page.get_by_placeholder(re.compile(r"^Search by company name")).fill(c["company_name"])
    page.get_by_role("link", name=c["company_name"], exact=True).first.click()
    wait_customer_page(page)
    sheet = open_edit(page)
    check_edit_form(page, sheet, rec)
    inputs = sheet.locator("input")
    emptied = []
    for i, field in ((3, "company_phone"), (5, "company_gst")):
        if not c[field]:
            inputs.nth(i).click()
            inputs.nth(i).press("1")
            inputs.nth(i).press("Backspace")
            inputs.nth(i).blur()
            emptied.append(field)
    page.wait_for_timeout(500)
    save(page, out, step)
    update = sheet.get_by_role("button", name="Update")
    check(not update.is_enabled(), f"{who}: Update is off after typing into and clearing {', '.join(emptied)}")
    if may_write and update.is_enabled():
        update.click()
        page.wait_for_timeout(3000)
    check(sent == [], f"{who}: no update was sent to Customers or Address ({sent})")
    after = db(task, out, f"{step}-after", "customer", c["name"])
    check(after["customer"] == c, f"{who}: the DB row of {c['name']} is unchanged")
    check(str(after["customer"]["modified"]) == str(rec["modified"]), f"{who}: its modified time is unchanged")
    page.keyboard.press("Escape")


def pick_customers(listing: dict) -> tuple[list[dict], dict]:
    """The list rows step 01 checks (those older than the list's 5-minute cache), and the customer steps 02-03
    open: the newest one this walk did not make. Exits 1, saying why, when the env has no such customer."""
    newest = listing["newest"]
    if not newest:
        sys.exit("walk: the env DB has no customer to walk; load data with customers in it")
    listed = [r for r in newest if r["age_sec"] > 300]
    for r in newest:
        if r["age_sec"] <= 300:
            print(f"not walked: list row {r['name']} (made {r['age_sec']} s ago, inside the list's 5-minute cache)")
    if not listed:
        sys.exit("walk: every one of the ten newest customers was made inside the list's 5-minute cache, so the "
                 "list may not show them yet; run the walk again in 5 minutes")
    real = next((r for r in newest if not r["company_name"].startswith(MADE_UP_PREFIX)), None)
    if real is None:
        sys.exit(f"walk: the ten newest customers are all made-up ones ({MADE_UP_PREFIX} ...), so there is no real "
                 "customer to open; load fresh data")
    return listed, real


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--user", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--admin-user")
    ap.add_argument("--admin-password")
    ap.add_argument("--part", choices=["all", "view"], default="all",
                    help="view: the Accountant's read-only steps 01-03b alone (writes nothing)")
    a = ap.parse_args()
    if a.part == "all" and not (a.admin_user and a.admin_password):
        ap.error("--part all needs --admin-user and --admin-password")

    stamp = time.strftime("%m%d%H%M%S")
    letters = "".join("ABCDEFGHJK"[int(d)] for d in stamp[-5:])
    made_up = {
        "company_name": f"{MADE_UP_PREFIX} {stamp}",
        "customer_nickname": f"ZWB{stamp}",
        "company_gst": f"29{letters}{stamp[-4:]}W1Z5",
        "company_contact_person": "Walk Contact Person",
        "phone": "9000012345",
        "email": f"walk1694.{stamp}@example.com",
        "line1": "Made-up Plot 7, Test Layout",
        "line2": "Walk Road",
    }

    with session(a.task, a.user, a.password) as (page, out):
        listing = db(a.task, out, "list", "list")
        pin = db(a.task, out, "pincode", "pincode")

        # 01: the list, as the sidebar opens it
        # The list's API caches a page for 5 minutes (CACHE_EXPIRY, data_table/constants.py), and this env serves no
        # realtime event to clear it, so a customer made in the last 5 minutes may not be listed yet.
        listed, real = pick_customers(listing)
        sidebar(page, "Customers")
        page.get_by_role("link", name=listed[0]["company_name"], exact=True).wait_for(timeout=60_000)
        page.wait_for_load_state("networkidle")
        save(page, out, "01-list")
        text = text_of(page)
        check(bool(re.search(rf"\b{listing['total']}\s+Customers", text)), f"the list counts {listing['total']} Customers")
        for row in listed:
            shown(text, row["company_name"], f"list row {row['name']}")
            shown(text, row["name"][-6:], f"list row {row['name']} ID")

        # 02: a real customer's page (the newest that this walk did not make)
        page.get_by_role("link", name=real["company_name"], exact=True).first.click()
        wait_customer_page(page)
        save(page, out, "02-customer")
        rec = db(a.task, out, "customer", "customer", real["name"])
        check_customer_page(page, rec)

        # 03: its edit form, read only
        sheet = open_edit(page)
        check_edit_form(page, sheet, rec)
        save(page, out, "03-edit-form")
        page.keyboard.press("Escape")

        # 03b: an empty phone or GST, typed into and cleared, saves nothing (#1703)
        sidebar(page, "Customers")
        check_empty_unchanged(page, a.task, out, "03b-empty", "Accountant", may_write=False)
        print(f"evidence (accountant): {out}")
        if misses:
            raise SystemExit(1)

    if a.part == "view":
        print("all checks seen")
        return

    with session(a.task, a.admin_user, a.admin_password) as (page, out):
        # 04: the Admin's way in
        page.locator('[data-sidebar="menu-button"]').get_by_text("Admin Options", exact=True).click()
        page.locator('[data-sidebar="menu-sub-button"]').get_by_text("Customers", exact=True).click()
        page.get_by_role("link", name=listed[0]["company_name"], exact=True).wait_for(timeout=60_000)
        page.wait_for_load_state("networkidle")
        save(page, out, "04-admin-list")
        check(bool(re.search(rf"\b{listing['total']}\s+Customers", text_of(page))),
              f"the Admin's list counts {listing['total']} Customers")

        # 05-06: create a made-up customer
        page.get_by_role("button", name=re.compile(r"Add\s*New Customer")).click()
        page.get_by_placeholder("Company Name").wait_for()
        page.get_by_placeholder("Company Name").fill(made_up["company_name"])
        page.get_by_placeholder(re.compile(r"^Short, memorable name")).fill(made_up["customer_nickname"])
        page.get_by_placeholder("GST Number").fill(made_up["company_gst"])
        page.get_by_placeholder("Contact Person").fill(made_up["company_contact_person"])
        page.get_by_placeholder("Phone Number").fill(made_up["phone"])
        page.get_by_placeholder("Email").fill(made_up["email"])
        page.get_by_placeholder("Address Line 1").fill(made_up["line1"])
        page.get_by_placeholder("Address Line 2").fill(made_up["line2"])
        page.get_by_placeholder("6 digit PIN").fill(pin["pincode"])
        page.get_by_placeholder(pin["city"]).wait_for(timeout=30_000)  # the PIN's city arrived
        check(page.locator('input[name="company_city"]').input_value() == pin["city"], f"PIN fills City {pin['city']!r}")
        check(page.locator('input[name="company_state"]').input_value() == pin["state"], f"PIN fills State {pin['state']!r}")
        save(page, out, "05-create-form")
        page.get_by_role("button", name="Submit").click()
        page.wait_for_url(re.compile(r"/customers(\?|$)"), timeout=30_000)
        # The plain list may still be the cached page (see 01), so find the new customer the way a user would: the
        # search box (search by company name), whose query is not cached yet.
        page.get_by_placeholder(re.compile(r"^Search by company name")).fill(made_up["company_name"])
        page.get_by_role("link", name=made_up["company_name"], exact=True).wait_for(timeout=60_000)
        save(page, out, "06-created")

        created = db(a.task, out, "created", "by-company", made_up["company_name"])["rows"]
        check(len(created) == 1, f"the DB holds the made-up customer once ({len(created)})")
        new = created[0]
        c, addr = new["customer"], new["address"] or {}
        for field, want in [("customer_nickname", made_up["customer_nickname"]), ("company_gst", made_up["company_gst"]),
                            ("company_contact_person", made_up["company_contact_person"]),
                            ("company_phone", made_up["phone"]), ("company_email", made_up["email"])]:
            check(c[field] == want, f"DB {field} is {want!r} ({c[field]!r})")
        for field, want in [("address_line1", made_up["line1"]), ("address_line2", made_up["line2"]),
                            ("city", pin["city"]), ("state", pin["state"]), ("pincode", pin["pincode"])]:
            check(addr.get(field) == want, f"DB address {field} is {want!r} ({addr.get(field)!r})")

        # 07: the made-up customer's page
        page.get_by_role("link", name=made_up["company_name"], exact=True).click()
        wait_customer_page(page)
        save(page, out, "07-new-customer")
        check_customer_page(page, new)

        # 08-09: its edit form, then one change saved
        sheet = open_edit(page)
        check_edit_form(page, sheet, new)
        save(page, out, "08-new-edit")
        edited = "Walk Contact Edited"
        sheet.locator("input").nth(4).fill(edited)
        sheet.get_by_role("button", name="Update").click()
        page.get_by_text("details updated successfully").first.wait_for(timeout=30_000)
        save(page, out, "09-edited")
        after = db(a.task, out, "edited", "customer", c["name"])
        check(after["customer"]["company_contact_person"] == edited,
              f"DB contact person is {edited!r} after Update ({after['customer']['company_contact_person']!r})")

        # 10: the 03b case as the Admin, who may write
        page.locator('[data-sidebar="menu-button"]').get_by_text("Admin Options", exact=True).click()
        page.locator('[data-sidebar="menu-sub-button"]').get_by_text("Customers", exact=True).click()
        check_empty_unchanged(page, a.task, out, "10-empty", "Admin", may_write=True)

        print(f"customer: {real['name']}; made-up customer: {c['name']}")
        print(f"evidence (admin): {out}")
        if misses:
            print(f"{len(misses)} check(s) FAILED")
            raise SystemExit(1)
    print("all checks seen")


if __name__ == "__main__":
    main()
