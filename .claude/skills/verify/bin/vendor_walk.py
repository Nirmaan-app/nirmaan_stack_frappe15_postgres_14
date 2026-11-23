"""What the vendor feature walks share (walk_vendor_work_orders.py, walk_vendor_msme.py, walk_vendor_payments.py,
walk_vendor_cheques.py): the command line, the env DB, one unlocked user per role, and the way to a vendor's page.

    python3 -I .claude/skills/verify/bin/walk_vendor_<x>.py <env> <out dir> [function ...]

Run from the checkout root, with the env served (`devenv.sh serve <env> --wait`). Naming functions runs only those
and leaves the feature file's `Last walked` stamp alone. Records are picked and expected numbers read from the env's
own DB at the start of each run, so a walk holds on any backup.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "pr-walk" / "bin"))
from drive import session  # noqa: E402
from record import Walk  # noqa: E402

DEVENV = "scripts/devenv/devenv.sh"
PW = "WalkPw-vendors"
FEATURE = HERE.parent / "features" / "vendors.md"
PROFILES = {
    "Admin": "Nirmaan Admin Profile",
    "Accountant": "Nirmaan Accountant Profile",
    "Accountant Lead": "Nirmaan Accountant Lead Profile",
    "Procurement Lead": "Nirmaan Procurement Lead Profile",
    "PMO": "Nirmaan PMO Executive Profile",
}

# Enabled users of each profile, the ones holding no asset first (an asset can lock the app until its declaration is
# signed), then the most user permissions (a project user sees more data). A project profile needs a project.
CANDIDATES_SQL = r'''
profiles = json.loads(sys.argv[1])
need_project = {"Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile",
                "Nirmaan Procurement Lead Profile", "Nirmaan Material Procurement Executive Profile"}
out = {}
for profile in profiles:
    rows = frappe.db.sql("""
        SELECT nu.name FROM "tabNirmaan Users" nu JOIN "tabUser" u ON u.name = nu.name
        WHERE u.enabled = 1 AND nu.role_profile = %(p)s AND (%(np)s = 0 OR nu.has_project = 'true')
        ORDER BY (SELECT COUNT(*) FROM "tabAsset Management" a WHERE a.asset_assigned_to = nu.name),
                 (SELECT COUNT(*) FROM "tabUser Permission" up WHERE up.user = nu.name) DESC, nu.name
        LIMIT 5""", {"p": profile, "np": int(profile in need_project)})
    out[profile] = [r[0] for r in rows]
print("JSON " + json.dumps(out))
'''


def base_of(page) -> str:
    return re.match(r"(https?://[^/]+)", page.url).group(1)


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def num(s: str) -> float:
    return float(s.replace(",", "").replace("₹", "").strip())


def table_total(page) -> int | None:
    """The row total a data table's footer states ("Page 1 of 1 (1-23 of 23)"), or None when it shows none."""
    m = re.search(r"Page \d+ of \d+ \(\d+-\d+ of (\d+)\)", page.locator("body").inner_text())
    return int(m.group(1)) if m else None


class VendorWalk:
    def __init__(self, title: str):
        if len(sys.argv) < 3:
            sys.exit(f"usage: python3 -I {sys.argv[0]} <env> <out dir> [function ...]")
        self.env, self.out, self.only = sys.argv[1], Path(sys.argv[2]), set(sys.argv[3:])
        os.environ["VERIFY_OUT"] = str(self.out)
        self.w = Walk(self.out, pr={"title": title}, envs={"after": self.env},
                      data_note=f"the env {self.env}'s own copy of the production data")
        self.users: dict[str, str] = {}

    def db(self, name: str, code: str, *args: str) -> str:
        """Run a Python snippet on the env DB (devenv script); keep it and its output under <out>/db/."""
        src = self.out / "db" / f"{name}.py"
        src.parent.mkdir(exist_ok=True)
        src.write_text("import json, sys\nimport frappe\n" + code)
        res = subprocess.run([DEVENV, "script", self.env, str(src), *args], capture_output=True, text=True,
                             timeout=300)
        (self.out / "db" / f"{name}.txt").write_text(res.stdout + res.stderr)
        return res.stdout

    def db_json(self, name: str, code: str, *args: str):
        line = next((l for l in self.db(name, code, *args).splitlines() if l.startswith("JSON ")), None)
        if line is None:
            sys.exit(f"{name}: the env DB read printed no JSON; see {self.out / 'db' / (name + '.txt')}")
        return json.loads(line[5:])

    def pick_users(self, roles: list[str]) -> dict[str, str]:
        """One user per role that the app's access gate leaves open, proven by logging in. Each gets the walk's
        password on the env DB only. Saved to <out>/users.json."""
        found = self.db_json("users", CANDIDATES_SQL, json.dumps([PROFILES[r] for r in roles]))
        for role in roles:
            for user in found[PROFILES[role]]:
                subprocess.run([DEVENV, "run", self.env, "set-password", user, PW], capture_output=True, check=True,
                               timeout=120)
                with session(self.env, user, PW) as (page, _):
                    settle(page, 2500)
                    locked = page.get_by_text("Finish these to continue").count() > 0
                if not locked:
                    self.users[role] = user
                    break
            else:
                sys.exit(f"no {role} user the app leaves open on {self.env}: tried {found[PROFILES[role]]}")
        (self.out / "users.json").write_text(json.dumps(self.users, indent=1))
        return self.users

    def run(self, plan: list[tuple[str, object]], tries: int = 2) -> None:
        """Run each (claim id, function) of the plan, or only the named functions. A function that raises is run once
        more from a clean slate; if it raises again its claim fails with the error."""
        for cid, fn in plan:
            if self.only and fn.__name__ not in self.only:
                continue
            for attempt in range(1, tries + 1):
                steps, checks = len(self.w.data["steps"]), len(self.w.data["checks"])
                try:
                    fn()
                    break
                except Exception as e:
                    traceback.print_exc()
                    del self.w.data["steps"][steps:], self.w.data["checks"][checks:]
                    if attempt == tries:
                        self.w.status(cid, "failed",
                                      f"walk stopped: {type(e).__name__}: {str(e).splitlines()[0][:160]}")

    def finish(self):
        self.w.finish(FEATURE, stamp=not self.only)

    def open_vendor(self, page, cid: str, role: str, vendor_id: str, vendor_name: str, record: bool = True) -> None:
        """Sidebar Vendors (Admin and PMO: under Admin Options), search the vendor by name, open its row's link.
        record=False walks the same way without a screenshot per click (the role loops)."""
        user = self.users[role]

        def click(caption: str, target) -> None:
            if record:
                self.w.step(page, cid, "after", role, user, caption, click=target)
            else:
                target.first.click()
                page.wait_for_load_state("networkidle")

        settle(page, 1000)
        menu = page.locator('[data-sidebar="menu-button"]')
        top = menu.get_by_text("Vendors", exact=True)
        sub = page.locator('[data-sidebar="menu-sub-button"]').get_by_text("Vendors", exact=True)
        if top.count():
            click("Open Vendors from the sidebar.", top)
        else:
            if not sub.first.is_visible():
                click("Open Admin Options in the sidebar.", menu.get_by_text("Admin Options", exact=True))
                settle(page, 600)
            click("Open Vendors under Admin Options in the sidebar.", sub)
        settle(page)
        page.get_by_placeholder("Search by name...").first.fill(vendor_name)
        settle(page, 2000)
        click(f"Find {vendor_name} by name and open it.", page.locator(f'tbody a[href$="/vendors/{vendor_id}"]'))
        page.wait_for_url(re.compile(rf"/vendors/{re.escape(vendor_id)}"), timeout=30_000)
        page.get_by_role("button", name="Overview", exact=True).first.wait_for(timeout=30_000)
        settle(page)


def show_pdf(page, pdf: Path, find: str | None = None):
    """Open page 1 of a downloaded PDF as an image in a new tab of the same browser; box `find` on it if given.
    Returns (that tab, the box or None, the text of every page, the page count)."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    first, scale = doc[0], 1.5
    img = pdf.with_suffix(".p1.jpg")
    first.render(scale=scale).to_pil().convert("RGB").save(img, quality=80)
    box = None
    if find:
        tp = first.get_textpage()
        hit = tp.search(find).get_next()
        if hit:
            boxes = [tp.get_charbox(i) for i in range(hit[0], hit[0] + hit[1])]
            l, b, r, t = (min(x[0] for x in boxes), min(x[1] for x in boxes), max(x[2] for x in boxes),
                          max(x[3] for x in boxes))
            h = first.get_height()
            box = {"x": round(l * scale) - 4, "y": round((h - t) * scale) - 4,
                   "w": round((r - l) * scale) + 8, "h": round((t - b) * scale) + 8}
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    view = page.context.new_page()
    view.set_viewport_size(page.viewport_size)
    data = base64.b64encode(img.read_bytes()).decode()
    view.set_content(f'<body style="margin:0;background:#e5e7eb"><img style="display:block" '
                     f'src="data:image/jpeg;base64,{data}"></body>')
    return view, box, text, len(doc)
