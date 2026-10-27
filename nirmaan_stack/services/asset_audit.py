"""Monthly asset audit -- the rules (owner, 2026-10-14). Pure: no database, no request.

An assigned asset whose category has "Monthly audit required" ticked owes one audit a month: from their profile the
holder answers "Is it working?" (the question lives in the dialog, `frontend/src/utils/assetAuditQuestions.ts`; each
answer arrives with its question text and is checked by `clean_answers`). Owner, 2026-10-21: "Yes" sends optional
remarks and no photo; "No" needs a description of the problem and may carry one image of it. The audit leaves the
asset's condition alone: the answers show any issue, and managers read them (owner, 2026-10-15). The open audit lives on the holder's Asset Management row (`audit_status`, `audit_month`,
`last_audit_on`, `audit_proof`, `audit_overdue_since`, `audit_answers`) and every audit is kept in the asset's
history ("Audit Requested", "Audit Fulfilled", "Audit Missed"). Which assignments owe one is decided in one query,
`services/asset_audit_open.py`; sending one is `api/assets/audits.submit_audit`.
"""

from datetime import date
from typing import Any

AUDIT_PENDING = "Pending"
AUDIT_FULFILLED = "Fulfilled"

# The conditions audits sent before 2026-10-15 started their history text with ("Poor · was Good · for 11/2026").
# Audits no longer set a condition; this is only for reading those rows. Mirrored in `frontend/src/utils/assetAudit.ts`.
AUDIT_CONDITIONS = ("Good", "Fair", "Poor", "Damaged")

# The cycle (owner, 2026-10-14): from the 28th an audit belongs to the next month -- the 28th run opens next
# month's audit for everyone up to date; those still behind get grace until the 7th, when the month is
# recorded Missed. Mirrored in `frontend/src/utils/assetAudit.ts` -- change both.
OPEN_NEXT_MONTH_DAY = 28
GRACE_LAST_DAY = 7

# Why an audit opened outside the scheduled runs, written after the month on its history row.
NOTE_HANDOVER = "handover"
NOTE_CATEGORY_ON = "category audit switched on"
NOTE_RETURN_REJECTED = "return rejected"

# The audit question lives in the dialog only (owner, 2026-10-15; one question since 2026-10-21):
# `frontend/src/utils/assetAuditQuestions.ts`. Each answer arrives with the question and the choice as the holder saw
# them; the server checks their shape (`clean_answers`) and keeps them as sent, so rewording never changes an old
# audit (the 4-question audits sent before 2026-10-21 keep theirs).
MAX_AUDIT_ANSWERS = 10
# The red choice's text, so a "No" sent without its `flag` (a hand-made API call) still counts as an issue and still
# needs its description (owner, 2026-10-22, code review #6). Mirrors the `flag: true` choice in
# `frontend/src/utils/assetAuditQuestions.ts` -- change both; `test_asset_audit` pins them together.
RED_ANSWERS = ("No, it is not working",)
MAX_ANSWER_LABEL_LENGTH = 300  # a question or a choice
MAX_ANSWER_TEXT_LENGTH = 200

# The file types an audit image may be, when one is sent (`api/assets/audits.submit_audit` and the Asset Management
# validate).
AUDIT_PHOTO_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif")


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
    """A regex matching an "Audit Fulfilled" text sent for `month_label`.

    Today's text starts with the month ("for 11/2026 · remarks", `fulfilled_text`); a row sent before
    2026-10-15 starts with a condition ("Poor · was Good · for 11/2026"). Anchored on the month's place in either,
    so remarks that happen to say "for 11/2026" never count. The same pattern works in Python and in PostgreSQL (`~`).
    """
    conditions = "|".join(AUDIT_CONDITIONS)
    return rf"^(({conditions}) · (was [^·]+ · )?)?for {month_label}( · |$)"


def created_text(day: date, note: str | None = None) -> str:
    """The "Audit Requested" history text: "10/2026", or "10/2026 · handover"."""
    label = audit_month_label(day)
    return f"{label} · {note}" if note else label


def submit_refusal(audit_status: str | None) -> str | None:
    """The message refusing a submitted audit, or None when it can be accepted (the answers: `clean_answers`).

    No photo is required (owner, 2026-10-21): "Yes, it is working" sends none, and the image under "No" is optional.
    """
    if audit_status != AUDIT_PENDING:
        if audit_status == AUDIT_FULFILLED:
            return "This audit was already submitted. Reload the page."
        return "This asset has no audit waiting. Reload the page."
    return None


def fulfilled_text(audit_month: str | None, remarks: str | None) -> str:
    """The "Audit Fulfilled" history text: "for 09/2026", or "for 09/2026 · Kept in the site store".

    The month the audit was for -- the Fulfilled list picks rows by the day they were sent, so it shows "For
    09/2026" from here and marks one sent late (owner, 2026-10-14) -- then the remarks. No condition (owner,
    2026-10-15): the answers say what is wrong. Read back by `parseFulfilledText` in
    `frontend/src/utils/assetAudit.ts`, which also reads the older condition-first rows.
    """
    parts = [f"for {audit_month}"] if audit_month else []
    if remarks and remarks.strip():
        parts.append(remarks.strip())
    return " · ".join(parts)


def clean_answers(answers: Any) -> tuple[list[dict] | None, str | None]:
    """Check the answers the dialog sent and shape them for saving.

    The questions live in the dialog, so this checks the shape, not the choices: at least one answer and at most
    `MAX_AUDIT_ANSWERS`, each with an id, the question (`q`) and the choice (`a`) as text, no id twice; a red answer
    (`flag`, or a choice in `RED_ANSWERS` sent without it) MUST carry its description (`text`, trimmed, at most `MAX_ANSWER_TEXT_LENGTH`;
    owner, 2026-10-21), any other answer never keeps one.

    Also run by `AssetManagement.check_fulfilled_audit` on a save that changes the audit -- never on an unrelated save,
    so an older audit whose red answer had no note (allowed before 2026-10-21) still saves.

    Args:
        answers: [{"id", "q", "a", "flag"?, "text"?}] from the Submit audit dialog.

    Returns:
        (saved, None) -- [{"id", "q", "a"} + {"flag": 1, "text"?} on a red answer], in the order sent -- or
        (None, message).
    """
    if not isinstance(answers, list) or not answers or not all(isinstance(a, dict) for a in answers):
        return None, "Answer the questions, then submit. Reload the page if they don't show."
    if len(answers) > MAX_AUDIT_ANSWERS:
        return None, "Too many answers. Reload the page and answer again."
    saved, seen = [], set()
    for answer in answers:
        qid, question, choice = (str(answer.get(key) or "").strip() for key in ("id", "q", "a"))
        if not (qid and question and choice) or max(len(qid), len(question), len(choice)) > MAX_ANSWER_LABEL_LENGTH:
            return None, "An answer is missing. Reload the page and answer again."
        if qid in seen:
            return None, "A question was answered twice. Reload the page and answer again."
        seen.add(qid)
        row = {"id": qid, "q": question, "a": choice}
        if answer.get("flag") or choice in RED_ANSWERS:
            row["flag"] = 1
            text = str(answer.get("text") or "").strip()
            if not text:
                return None, f'Describe the problem under "{choice}", then submit.'
            if len(text) > MAX_ANSWER_TEXT_LENGTH:
                return None, f"Keep the description under {MAX_ANSWER_TEXT_LENGTH} characters."
            row["text"] = text
        saved.append(row)
    return saved, None
