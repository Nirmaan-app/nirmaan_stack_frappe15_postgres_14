"""What the feature walks graduated from PR walks share: the env DB read, a role's user, and the ways into a screen.

    python3 -I .claude/skills/verify/bin/walk_<feature>.py <env> <out dir> [function ...]   # from the checkout root

A walk builds a `FeatureWalk`, reads its records and expected numbers with `fw.db(...)` at the start, picks each
role's user with `fw.user(role, candidates)` (or `fw.pick(roles)` for the roles of `PROFILES`), runs its functions
with `fw.run(plan)`, and ends with `fw.finish()`, which stamps its feature file only when every function ran. Each
`db` script and its output are saved under `<out dir>/db/`.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Callable, NoReturn

BIN = Path(__file__).resolve().parent
sys.path.insert(0, str(BIN))
sys.path.insert(0, str(BIN.parents[1] / "pr-walk" / "bin"))
from drive import session, sidebar  # noqa: E402
from record import Walk, pin  # noqa: E402,F401

DEVENV = "scripts/devenv/devenv.sh"
FEATURES = BIN.parent / "features"
PW = "FeatureWalk-1"
LOCKED = "Finish these to continue"
PROFILES = {
    "Admin": "Nirmaan Admin Profile",
    "Accountant": "Nirmaan Accountant Profile",
    "Accountant Lead": "Nirmaan Accountant Lead Profile",
    "Procurement Lead": "Nirmaan Procurement Lead Profile",
    "PMO": "Nirmaan PMO Executive Profile",
}

# Prepended to every `db` script. `candidates` lists a profile's enabled users, those holding no asset first (they
# cannot be locked by an asset task); a project-scoped profile only with a User Permission on one of `projects`.
PRELUDE = '''import json, sys
import frappe

PROJECT_SCOPED = {"Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile",
                  "Nirmaan Procurement Executive Profile", "Nirmaan Procurement Lead Profile",
                  "Nirmaan Material Procurement Executive Profile"}


def candidates(profile, projects=None):
    users = frappe.db.sql("""SELECT nu.name, nu.has_project FROM "tabNirmaan Users" nu JOIN "tabUser" u ON u.name = nu.name
        WHERE u.enabled = 1 AND nu.role_profile = %s ORDER BY nu.name""", profile)
    held = {r[0] for r in frappe.db.sql('SELECT DISTINCT asset_assigned_to FROM "tabAsset Management"')}
    out = []
    for user, has_project in users:
        allowed = set(frappe.get_all("User Permission", filters={"user": user, "allow": "Projects"}, pluck="for_value"))
        if profile in PROJECT_SCOPED and (str(has_project) != "true" or not allowed):
            continue
        if projects and allowed and not allowed & set(projects):
            continue
        out.append(user)
    return sorted(out, key=lambda u: u in held)


def emit(obj):
    print("JSON " + json.dumps(obj, default=str))
'''


class FeatureWalk:
    def __init__(self, title: str, feature_file: str):
        if len(sys.argv) < 3:
            sys.exit(f"usage: python3 -I {sys.argv[0]} <env> <out dir> [function ...]")
        self.env, self.out, self.only = sys.argv[1], Path(sys.argv[2]).expanduser(), set(sys.argv[3:])
        os.environ["VERIFY_OUT"] = str(self.out / "drive")
        self.feature_md = FEATURES / feature_file
        self.w = Walk(self.out, pr={"title": title, "walk": Path(sys.argv[0]).name},
                      envs={"after": self.env}, data_note=f"env {self.env}'s own DB")
        self.users: dict[str, str] = {}

    def db(self, name: str, code: str, *args: str):
        """Run `code` on the env DB (PRELUDE first) and return what it passed to emit(). Saved under db/."""
        # devenv copies the file into the env's tmp/ under its own name: the walk's name keeps two walks apart.
        src = self.out / "db" / f"{Path(sys.argv[0]).stem}.{name}.py"
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_text(PRELUDE + code)
        res = subprocess.run([DEVENV, "script", self.env, str(src), *args], capture_output=True, text=True, timeout=600)
        src.with_suffix(".txt").write_text(res.stdout + res.stderr)
        line = next((ln for ln in res.stdout.splitlines() if ln.startswith("JSON ")), None)
        if line is None:
            sys.exit(f"db script {src} printed no JSON line; see {src.with_suffix('.txt')}")
        return json.loads(line[5:])

    def user(self, role: str, candidates: list[str]) -> str:
        """The first candidate the app does not lock, with the walk's password set on this env's DB only."""
        if role in self.users:
            return self.users[role]
        for email in candidates:
            self.set_password(email)
            with session(self.env, email, PW) as (page, _):
                if is_locked(page):
                    continue
            self.users[role] = email
            (self.out / "users.json").write_text(json.dumps(self.users, indent=1))
            return email
        sys.exit(f"no {role} user on env {self.env} can use the app: every candidate is locked ({candidates})")

    def pick(self, roles: list[str]) -> dict[str, str]:
        """`user` for each role, its candidates read in one `db` call."""
        found = self.db("users", "emit({r: candidates(p) for r, p in json.loads(sys.argv[1]).items()})",
                        json.dumps({r: PROFILES[r] for r in roles}))
        return {r: self.user(r, found[r]) for r in roles}

    def set_password(self, email: str) -> None:
        # Two walks on one env can run `devenv run` at once, and the second may fail while the first holds the bench.
        for attempt in (1, 2, 3):
            res = subprocess.run([DEVENV, "run", self.env, "set-password", email, PW], capture_output=True, text=True,
                                 timeout=300)
            if res.returncode == 0:
                return
            time.sleep(10 * attempt)
        raise RuntimeError(f"set-password {email} failed on {self.env}: {(res.stdout + res.stderr)[-400:]}")

    @contextlib.contextmanager
    def session(self, user: str):
        """A browser logged in as `user` on this env, yielding the page."""
        with session(self.env, user, PW) as (page, _):
            yield page

    def run(self, plan: list[tuple[str, Callable[[], None]]]) -> None:
        """Run each (claim id, function) the command line names (all when it names none). A function that raises is
        retried once with its steps and checks dropped, then fails its claim with the error."""
        for cid, fn in plan:
            if self.only and fn.__name__ not in self.only:
                continue
            for attempt in (1, 2):
                steps, checks = len(self.w.data["steps"]), len(self.w.data["checks"])
                try:
                    fn()
                    break
                except Exception as e:
                    traceback.print_exc()
                    del self.w.data["steps"][steps:], self.w.data["checks"][checks:]
                    if attempt == 2:
                        self.w.status(cid, "failed", f"walk stopped: {type(e).__name__}: {str(e).splitlines()[0][:160]}")

    def finish(self) -> NoReturn:
        self.w.finish(self.feature_md, stamp=not self.only)

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

        sidebar_ready(page)
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
        # Two vendors can share a name, so the row is opened by its link.
        click(f"Find {vendor_name} by name and open it.", page.locator(f'tbody a[href$="/vendors/{vendor_id}"]'))
        page.wait_for_url(re.compile(rf"/vendors/{re.escape(vendor_id)}"), timeout=30_000)
        page.get_by_role("button", name="Overview", exact=True).first.wait_for(timeout=30_000)
        settle(page)


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def num(s: str) -> float:
    return float(s.replace(",", "").replace("₹", "").strip())


def table_total(page) -> int | None:
    """The row total a data table's footer states ("Page 1 of 1 (1-23 of 23)"), or None when it shows none."""
    m = re.search(r"Page \d+ of \d+ \(\d+-\d+ of (\d+)\)", page.locator("body").inner_text())
    return int(m.group(1)) if m else None


def sidebar_ready(page) -> None:
    """Wait until the sidebar holds the role's entries: it shows Dashboard alone until the role profile is read."""
    menu = page.locator('[data-sidebar="menu-button"]')
    menu.get_by_text("Dashboard", exact=True).wait_for(timeout=30_000)
    last = -1
    for _ in range(40):
        n = menu.count()
        if n == last and n > 3:
            return
        last = n
        page.wait_for_timeout(750)


def is_locked(page) -> bool:
    """True when the app access gate shows its card instead of the role's sidebar."""
    menu = page.locator('[data-sidebar="menu-button"]')
    for _ in range(60):
        if page.get_by_text(LOCKED).count():
            return True
        if menu.count() > 3:
            return False
        page.wait_for_timeout(500)
    raise RuntimeError("after 30 s the sidebar shows neither the role's entries nor the access gate's card")


def has_sidebar(page, label: str) -> bool:
    sidebar_ready(page)
    return page.locator('[data-sidebar="menu-button"]').get_by_text(label, exact=True).count() > 0


def search_by(page, field: str, text: str) -> None:
    """Type into a server table's search box, first switching its "search by" select to `field` when it offers one."""
    select = page.locator("main").get_by_role("combobox").first
    if select.count() and select.inner_text().strip() != field:
        select.click()
        page.get_by_role("option", name=field, exact=True).click()
    page.locator("main input[placeholder^='Search']").first.fill(text)
    settle(page, 2000)


def open_project(page, project_name: str) -> None:
    """Projects from the sidebar (an Admin's sits under Admin Options), then the project's row."""
    if has_sidebar(page, "Projects"):
        sidebar(page, "Projects")
    else:
        sidebar(page, "Admin Options")
        page.locator('[data-sidebar="menu-sub-button"]').get_by_text("Projects", exact=True).click()
    settle(page)
    page.get_by_placeholder("Search by Project Name...").fill(project_name)
    settle(page, 2000)
    page.locator("tbody").get_by_role("link", name=project_name, exact=True).first.click()
    settle(page, 2500)


def open_po(page, po: str, project_name: str) -> None:
    """A PO's page the way the role gets there: Purchase Orders › All POs, else its project's PO Summary tab."""
    while page.get_by_role("dialog").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    if has_sidebar(page, "Purchase Orders"):
        sidebar(page, "Purchase Orders")
        page.get_by_role("button", name=re.compile(r"^All POs")).first.click()
    else:
        open_project(page, project_name)
        page.get_by_role("button", name="PO Summary", exact=True).first.click()
    settle(page)
    search_by(page, "PO ID", po)
    page.locator("tbody").get_by_role("link", name=po, exact=True).first.click()
    page.get_by_text("Loading data...").first.wait_for(state="hidden", timeout=60_000)
    settle(page, 2000)


def show_pdf(page, pdf: Path, find: str | None = None):
    """Open page 1 of a downloaded PDF as an image in a new tab of the same browser, so a step can shoot it.
    Returns (that page, the box of `find` on it or None, the PDF's text, its page count)."""
    import base64

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
            left, bottom = min(x[0] for x in boxes), min(x[1] for x in boxes)
            right, top = max(x[2] for x in boxes), max(x[3] for x in boxes)
            box = {"x": round(left * scale) - 4, "y": round((first.get_height() - top) * scale) - 4,
                   "w": round((right - left) * scale) + 8, "h": round((top - bottom) * scale) + 8}
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    view = page.context.new_page()
    view.set_viewport_size(page.viewport_size)
    data = base64.b64encode(img.read_bytes()).decode()
    view.set_content(f'<body style="margin:0;background:#e5e7eb"><img style="display:block" '
                     f'src="data:image/jpeg;base64,{data}"></body>')
    return view, box, text, len(doc)
