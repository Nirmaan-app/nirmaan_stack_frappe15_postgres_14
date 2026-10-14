"""Monthly asset audit -- the rules (owner, 2026-10-14). Pure: no database, no request.

An assigned asset whose category has "Monthly audit required" ticked owes one audit a month: the holder
sends its condition and a photo from their profile. The open audit lives on the holder's Asset Management
row (`audit_status`, `audit_month`, `last_audit_on`, `audit_proof`, `audit_overdue_since`) and every audit is
kept in the asset's history ("Audit Requested", "Audit Fulfilled", "Audit Missed"). Which assignments owe one is decided in one query,
`services/asset_audit_open.py`; sending one is `api/assets/audits.submit_audit`.
"""

from datetime import date

AUDIT_PENDING = "Pending"
AUDIT_FULFILLED = "Fulfilled"

# What the holder can say about the asset. Mirrored in `frontend/src/utils/assetAudit.ts` -- change both.
AUDIT_CONDITIONS = ("Good", "Fair", "Poor", "Damaged")
CONDITIONS_NEEDING_REMARKS = ("Poor", "Damaged")
MIN_REMARKS_LENGTH = 10

# The cycle (owner, 2026-10-14): from the 28th an audit belongs to the next month -- the 28th run opens next
# month's audit for everyone up to date; those still behind get grace until the 7th, when the month is
# recorded Missed. Mirrored in `frontend/src/utils/assetAudit.ts` -- change both.
OPEN_NEXT_MONTH_DAY = 28
GRACE_LAST_DAY = 7

# Why an audit opened outside the scheduled runs, written after the month on its history row.
NOTE_HANDOVER = "handover"
NOTE_CATEGORY_ON = "category audit switched on"
NOTE_RETURN_REJECTED = "return rejected"


def audit_month_label(day: date) -> str:
    """The month an audit is for, as `audit_month` stores it: "09/2026", always two digits.

    Text, not a date (owner, 2026-10-14). Every rule only asks "is it this month?", which a text
    compare answers; text does not sort across years ("01/2027" < "12/2026"), so nothing sorts on it
    in the database.
    """
    return day.strftime("%m/%Y")


def month_start(day: date) -> date:
    """The 1st of `day`'s month."""
    return day.replace(day=1)


def cycle_month(day: date) -> date:
    """The 1st of the month an audit opened on `day` is for: this month, or next month from the 28th.

    14 Oct -> 1 Oct; 28 Oct -> 1 Nov; 30 Dec -> 1 Jan.
    """
    start = month_start(day)
    if day.day < OPEN_NEXT_MONTH_DAY:
        return start
    return date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)


def for_month_pattern(month_label: str) -> str:
    """A regex matching an "Audit Fulfilled" text (`fulfilled_text`) sent for `month_label`.

    Anchored on the month's place -- after the condition and any "was <old>" -- so remarks that happen to say
    "for 11/2026" never count. The same pattern works in Python and in PostgreSQL (`~`).
    """
    return rf"^[^·]+( · was [^·]+)? · for {month_label}( · |$)"


def created_text(day: date, note: str | None = None) -> str:
    """The "Audit Requested" history text: "10/2026", or "10/2026 · handover"."""
    label = audit_month_label(day)
    return f"{label} · {note}" if note else label


def submit_refusal(audit_status: str | None, condition: str | None, has_photo: bool, remarks: str | None) -> str | None:
    """The message refusing a submitted audit, or None when it can be accepted."""
    if audit_status != AUDIT_PENDING:
        if audit_status == AUDIT_FULFILLED:
            return "This audit was already submitted. Reload the page."
        return "This asset has no audit waiting. Reload the page."
    if condition not in AUDIT_CONDITIONS:
        return "Choose the asset's condition: Good, Fair, Poor or Damaged."
    if not has_photo:
        return "Add a photo of the asset."
    if condition in CONDITIONS_NEEDING_REMARKS and len((remarks or "").strip()) < MIN_REMARKS_LENGTH:
        return f"Say what is wrong with the asset (at least {MIN_REMARKS_LENGTH} characters) when it is {condition}."
    return None


def fulfilled_text(condition: str, previous_condition: str | None, audit_month: str | None, remarks: str | None) -> str:
    """The "Audit Fulfilled" history text: "Damaged · was Fair · for 09/2026 · screen cracked".

    Starts with the condition (the history can be filtered by condition with a prefix match), then the old
    condition when it changed, then the month the audit was for -- so the Fulfilled list, which picks rows
    by the day they were sent, can show "For 09/2026" and mark one sent late (owner, 2026-10-14). Read
    back by `parseFulfilledText` in `frontend/src/utils/assetAudit.ts`.
    """
    parts = [condition]
    if previous_condition and previous_condition != condition:
        parts.append(f"was {previous_condition}")
    if audit_month:
        parts.append(f"for {audit_month}")
    if remarks and remarks.strip():
        parts.append(remarks.strip())
    return " · ".join(parts)
