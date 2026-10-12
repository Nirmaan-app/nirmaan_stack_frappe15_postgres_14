"""Asset departments -- the rules, pure, no database.

Every asset belongs to one department (`Asset Master.department`) and every person has one
(`Nirmaan Users.department`). There is no fixed list in code (owner, 2026-10-12): the departments are
whatever people's records hold, and HR adds a new one by giving it to a person. Assigning an asset to
someone in another department moves the asset there, and the assigner must say why.

The assignment validate and hooks load the records and ask this module what to do; keeping the rules
here gives them one home and makes them testable without a site. The frontend mirrors
`department_move` in `frontend/src/utils/assetDepartment.ts`.
"""

MIN_REASON_LENGTH = 10


def normalize_department(value: str | None) -> str | None:
    """Trim a typed department and collapse repeated spaces; an empty one becomes None."""
    cleaned = " ".join((value or "").split())
    return cleaned or None


def same_department(a: str | None, b: str | None) -> bool:
    """Departments match regardless of capitals and stray spaces ("projects " is "Projects")."""
    a, b = normalize_department(a), normalize_department(b)
    return (a or "").casefold() == (b or "").casefold()


def department_move(asset_department: str | None, person_department: str | None) -> tuple[str | None, str] | None:
    """What an assignment does to the asset's department.

    Returns None when the department stays as it is (same department, or the person has none yet),
    otherwise (from_department, to_department). `from_department` is None when the asset had no
    department -- the first assignment simply gives it one.
    """
    person_department = normalize_department(person_department)
    if not person_department or same_department(asset_department, person_department):
        return None
    return (normalize_department(asset_department), person_department)


def needs_reason(move: tuple[str | None, str] | None) -> bool:
    """A reason is required only to move an asset OUT of a department it already belongs to."""
    return bool(move and move[0])


def reason_refusal(move: tuple[str | None, str] | None, reason: str | None) -> str | None:
    """The message refusing the assignment, or None when the reason (if needed) is good enough."""
    if not move or not move[0]:
        return None
    from_department, to_department = move
    if len((reason or "").strip()) < MIN_REASON_LENGTH:
        return (
            f"This asset belongs to {from_department}. Give a reason (at least {MIN_REASON_LENGTH} "
            f"characters) for moving it to {to_department}."
        )
    return None


def can_edit_asset_department(old_department: str | None, has_been_assigned: bool) -> bool:
    """Edit may set an empty department, or fix one on an asset that was never assigned.

    Once an asset has been assigned, its department moves only through an assignment with a reason,
    so every real move is in its history.
    """
    return not normalize_department(old_department) or not has_been_assigned
