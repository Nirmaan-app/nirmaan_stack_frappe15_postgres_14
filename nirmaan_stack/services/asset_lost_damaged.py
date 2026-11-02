"""Marking an asset Lost/Damaged and bringing it back (Found/Repaired) -- the rules, pure, no database (owner,
2026-10-31).

Lost/Damaged is one state for an asset that can't be handed out: missing, stolen or damaged, whatever the
reason says. Lost and Damaged are deliberately one state; the reason given says which. Only Admin and HR mark
it or bring it back (`role_profiles.ASSET_LOST_DAMAGED_PROFILES`), always with a reason of at least
MIN_REASON_LENGTH characters.

- Marking a held asset unassigns it at once: the holder's assignment ends in the same step (its "Unassigned"
  history row says UNASSIGN_REASON), and the "Asset Lost/Damaged" row names that person. Their open audit ends
  with the assignment, with no result -- it is not recorded as missed.
- While Lost/Damaged the asset can't be assigned (`AssetManagement.check_not_already_assigned`) and owes no
  audit (`asset_audit_open.due_assignments`).
- Found/Repaired returns it to Unassigned. It is never handed back to the last holder: it is assigned again like
  any asset, with a fresh declaration.

The endpoints are `api/assets/lost_damaged.py`. The frontend mirrors the reason rule in
`frontend/src/utils/assetLostDamaged.ts`.
"""

from nirmaan_stack.services.asset_department import MIN_REASON_LENGTH

MARK = "mark"
RECOVER = "recover"

# The reason on the "Unassigned" row written when marking ends the assignment; the "Asset Lost/Damaged" row
# right after it keeps the real reason.
UNASSIGN_REASON = "Lost/Damaged"


def lost_damaged_refusal(action: str, is_lost_damaged, reason: str | None) -> str | None:
    """The message refusing `action` (MARK / RECOVER) on an asset in this state, or None when it may go ahead."""
    if action == MARK and is_lost_damaged:
        return "This asset is already marked Lost/Damaged."
    if action == RECOVER and not is_lost_damaged:
        return "This asset isn't marked Lost/Damaged, so there is nothing to mark Found/Repaired."
    if len((reason or "").strip()) < MIN_REASON_LENGTH:
        return f"Give a reason (at least {MIN_REASON_LENGTH} characters)."
    return None


def reason_text(reason: str) -> str:
    """What the history row keeps: the reason on one line, inner whitespace collapsed."""
    return " ".join((reason or "").split())
