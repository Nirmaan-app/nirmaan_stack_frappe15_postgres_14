"""Asset departments -- the rules, pure, no database.

Every asset belongs to one department (`Asset Master.department`) and every person has one
(`Nirmaan Users.department`). Both are Links to `Nirmaan Department`, the list Admin and HR keep in
Assets -> Departments (add, rename, switch off). Assigning an asset to someone in another department
moves the asset there, and the assigner must say why.

Because the values are record names, they are compared exactly: "Projects" and "projects" would be two
different records (the Departments tab refuses such near-duplicates when they are typed).

The assignment validate and hooks load the records and ask this module what to do; keeping the rules
here gives them one home and makes them testable without a site. The frontend mirrors
`department_move` in `frontend/src/utils/assetDepartment.ts`.
"""

MIN_REASON_LENGTH = 10


def normalize_department(value: str | None) -> str | None:
    """Tidy a typed department name (a new Nirmaan Department): trim it and collapse repeated spaces.

    An empty one becomes None.
    """
    cleaned = " ".join((value or "").split())
    return cleaned or None


def department_move(asset_department: str | None, person_department: str | None) -> tuple[str | None, str] | None:
    """What an assignment does to the asset's department.

    Returns None when the department stays as it is (same department, or the person has none yet),
    otherwise (from_department, to_department). `from_department` is None when the asset had no
    department -- the first assignment simply gives it one.
    """
    if not person_department or person_department == asset_department:
        return None
    return (asset_department or None, person_department)


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
    return not (old_department or "").strip() or not has_been_assigned
