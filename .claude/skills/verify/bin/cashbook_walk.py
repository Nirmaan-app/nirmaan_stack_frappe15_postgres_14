"""What the Cashbook walks share (`walk_cashbook_refunds.py`, `walk_cashbook_credits.py`): the host path of a file the
env wrote, the Import statement dialog, a list's search box, an Expense list's Paid tab, and Unreconcile."""

import re
from pathlib import Path

from drive import sidebar

# The container's /workspace/development is the host's `development` folder, above this checkout or worktree.
DEVELOPMENT = next(p for p in Path(__file__).resolve().parents if p.name == "development")


def host(path: str) -> str:
    return str(DEVELOPMENT / path.removeprefix("/workspace/development/"))



def open_import(page, path: str):
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name="Import statement").click()
    # The dialog opens on the source last used in this page (a second import opens on Cashbook already).
    dialog = page.get_by_role("dialog", name=re.compile(r"^Import a "))
    dialog.wait_for()
    if not dialog.get_by_role("combobox", name="Source").inner_text().startswith("Cashbook"):
        dialog.get_by_role("combobox", name="Source").click()
        page.get_by_role("option", name=re.compile(r"^Cashbook")).click()
    dialog = page.get_by_role("dialog", name="Import a petty cash statement")
    dialog.locator("input[type=file]").set_input_files(host(path))
    dialog.get_by_role("button", name="Read statement").click()
    return dialog


def search(page, text: str) -> None:
    page.get_by_placeholder(re.compile("search", re.I)).first.fill(text)
    page.wait_for_timeout(1500)
    page.wait_for_load_state("networkidle")


def expense_list(page, card: str, text: str):
    """Dashboard -> `card` -> Paid -> the search box; the rows holding `text`."""
    sidebar(page, "Dashboard")
    page.get_by_text(card, exact=True).first.click()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name=re.compile(r"^Paid \d+$")).click()
    page.wait_for_load_state("networkidle")
    search(page, text)
    rows = page.get_by_role("row").filter(has_text=text)
    rows.first.wait_for(timeout=30_000)
    return rows


def unreconcile(page, tab: str, text: str, reason: str):
    """`tab` -> the line holding `text` -> Unreconcile, with `reason` typed; the dialog, its Reverse all not pressed."""
    tab_name = tab.replace("/", r"\/")  # an unescaped `/` in a regex breaks Playwright's selector
    page.get_by_role("button", name=re.compile(rf"^{tab_name} \d+")).click()
    search(page, text)
    row = page.get_by_role("row").filter(has_text=text)
    row.first.wait_for(timeout=30_000)
    row.first.get_by_role("button", name="Unreconcile").click()
    dialog = page.get_by_role("dialog", name="Unreconcile this transfer?")
    dialog.wait_for()
    dialog.get_by_placeholder("Why is this match being undone?").fill(reason)
    page.wait_for_timeout(700)
    return dialog
