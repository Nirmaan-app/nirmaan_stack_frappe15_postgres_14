"""Why an asset is unassigned -- the rule, pure, no database.

Every unassign gives a reason (owner, 2026-10-13): one of a fixed list, with optional details, or
"Other" with details of at least MIN_REASON_LENGTH characters, so a typed "aaaaaaaaaa" can't stand in
for a reason. The reason is kept on the asset's "Unassigned" history row (`Asset History.reason`),
never on the assignment, which the unassign deletes.

The frontend mirrors the list and the rule in `frontend/src/utils/assetUnassign.ts`.
"""

from nirmaan_stack.services.asset_department import MIN_REASON_LENGTH

OTHER = "Other"

UNASSIGN_REASONS = (
    "Employee left / exit",
    "Returned – no longer needed",
    "Handing over to another person",
    "Project finished – returned to store",
    "Damaged – sent for repair",
    "Lost or stolen",
    OTHER,
)


def unassign_reason_refusal(reason: str | None, details: str | None) -> str | None:
    """The message refusing the unassign, or None when the reason is valid."""
    reason = (reason or "").strip()
    if reason not in UNASSIGN_REASONS:
        return "Choose why the asset is being unassigned."
    if reason == OTHER and len((details or "").strip()) < MIN_REASON_LENGTH:
        return f"Explain the reason (at least {MIN_REASON_LENGTH} characters) when you choose Other."
    return None


def unassign_reason_text(reason: str, details: str | None) -> str:
    """What the history row keeps: the reason, then the details after a dash when there are any."""
    details = " ".join((details or "").split())
    return f"{reason.strip()} — {details}" if details else reason.strip()
