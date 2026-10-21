"""When a Tendering project's BoQs may be merged into a Won project, and when the merge may be undone (ADR-0038).

Pure rules: no `frappe.db`, no request context. The caller reads the facts and acts on the verdict
(`api/projects/tendering_merge.py`). Each function returns the refusal message, or None when allowed.
"""

MERGED = "Merged"
TENDERING = "Tendering"
WON = "Won"
# Execution statuses a merge may not target (Q5: Completed only).
CLOSED_TARGET_STATUSES = ("Completed",)
# The BoQ statuses each move starts from. Merge takes Draft only, so Undo can always restore Draft;
# Undo takes back what a merge made (Selected) or an Admin moved to Draft on the Won project. Any
# other status (set by hand in Desk) is refused by name rather than silently overwritten.
MERGE_FROM_STATUSES = ("Draft",)
UNDO_FROM_STATUSES = ("Selected", "Draft")


def busy_lock_label(
    boq_title: str, sheet_name: str, committed_version, holder_name: str, seconds_ago: int
) -> str:
    """One line naming who is editing which sheet of a BoQ, and where (ADR-0038 D9)."""
    screen = "Configure / Review" if int(committed_version or 0) == 0 else "Pricing"
    ago = "just now" if seconds_ago < 60 else f"{seconds_ago // 60} min ago"
    return f'{boq_title} › sheet "{(sheet_name or "").strip()}" — {holder_name}, in {screen} ({ago})'


def busy_parse_label(boq_title: str) -> str:
    """One line for a BoQ whose parse is still running in the background (ADR-0038 D9)."""
    return f"{boq_title} — parse running"


def _busy_message(busy_boqs, action: str) -> str:
    return (
        f"These BoQs are being edited right now: {'; '.join(busy_boqs)}. "
        f"{action} after they leave the page."
    )


def merge_refusal(
    *,
    is_admin: bool,
    project: str,
    tendering_status: str | None,
    boq_count: int,
    target: str | None,
    target_tendering_status: str | None,
    target_status: str | None,
    boqs_not_draft: tuple[str, ...] | list[str] = (),
    busy_boqs: tuple[str, ...] | list[str] = (),
) -> str | None:
    """Why `project` may not be merged into `target` (D2), or None.

    `target_tendering_status` is None when the target does not exist. `boqs_not_draft` labels each
    of the project's BoQs whose status is not Draft ("NAME (Status)"). `busy_boqs` labels each
    sheet someone is editing right now and each BoQ whose parse is running (D9).
    """
    if not is_admin:
        return "Only an Admin can merge BoQs into a Won project."
    if tendering_status != TENDERING:
        return (
            f"Project '{project}' cannot be merged (its tendering status is "
            f"'{tendering_status or 'blank'}'). Only a Tendering project can be merged."
        )
    if boq_count < 1:
        return f"Project '{project}' has no BoQ to merge."
    if busy_boqs:
        return _busy_message(busy_boqs, "Merge")
    if boqs_not_draft:
        return f"Only Draft BoQs can be merged. Not Draft: {', '.join(boqs_not_draft)}."
    if not target:
        return "Choose the Won project to merge into."
    if target == project:
        return "A project cannot be merged into itself."
    if target_tendering_status is None:
        return f"Project '{target}' does not exist."
    if target_tendering_status != WON:
        return f"Project '{target}' is not a Won project."
    if target_status in CLOSED_TARGET_STATUSES:
        return f"Project '{target}' is {target_status}; choose a project that is still running."
    return None


def undo_refusal(
    *,
    is_admin: bool,
    project: str,
    tendering_status: str | None,
    blocking_revisions: list[str],
    boqs_in_other_status: tuple[str, ...] | list[str] = (),
    busy_boqs: tuple[str, ...] | list[str] = (),
) -> str | None:
    """Why the merge of `project` may not be undone (D3/D4/D9), or None.

    `boqs_in_other_status` labels each merged BoQ that is neither Selected nor Draft
    ("NAME (Status)"). `blocking_revisions` are BoQs whose revision link crosses between the merged
    set and the BoQs that stay in the Won project, in either direction. `busy_boqs` labels each
    merged BoQ sheet someone is editing right now and each merged BoQ whose parse is running.
    """
    if not is_admin:
        return "Only an Admin can undo a merge."
    if tendering_status != MERGED:
        return (
            f"Project '{project}' is not merged (its tendering status is "
            f"'{tendering_status or 'blank'}')."
        )
    if busy_boqs:
        return _busy_message(busy_boqs, "Undo")
    if boqs_in_other_status:
        return (
            "Cannot undo: only Selected or Draft BoQs can go back. "
            f"Other status: {', '.join(boqs_in_other_status)}."
        )
    if blocking_revisions:
        names = ", ".join(blocking_revisions)
        one = len(blocking_revisions) == 1
        return (
            f"Cannot undo: {names} {'is' if one else 'are'} linked as a revision between a merged BoQ "
            f"and a BoQ that stays in the Won project; undoing would split "
            f"{'it' if one else 'them'} across two projects."
        )
    return None
