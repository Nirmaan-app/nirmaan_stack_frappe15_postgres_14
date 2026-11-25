# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Move to a project learns the remark's phrase (#1758, spec #1753 stories 47-52, "Phrase learning").

The Move write (`porter_rectify.rectify_rows`) takes an optional phrase. For a project destination it is saved as an
active `Outflow Import Project Alias` (phrase -> project), which the next Cashbook upload's plan reads
(`cashbook.project_index`). A move to Non Project learns nothing.

  * `phrase_refusal`: asked before any line moves. A phrase that already names ANOTHER project refuses the whole
    write, in a plain sentence, so the person changes the phrase or unticks the box.
  * `learn_phrase`: after the lines, once at least one moved. The same phrase already naming this project changes
    nothing (a retired one is made active again: the person has just asked for it).

⚠️ ONE PHRASE NEVER NAMES TWO PROJECTS. "Same phrase" is `project_match.alias_haystack`'s reading (case, spaces and
punctuation do not count), the one the import matches by; the table's own unique key sees only the exact text. The
check and the insert run under one advisory lock on the normalised phrase, reading from a snapshot taken under it
(`learn_phrase`); the doctype's own `validate` takes the same lock (`lock_phrase`). So two Moves teaching "VR Mall" and
"vr  mall" to two projects queue, and the second is refused. (A Desk save reads from its request's earlier snapshot,
so a Desk save racing a Move can still miss the Move's row; the import then drops the phrase, and never misplaces a
spend by it.)
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.project_match import alias_haystack

ALIAS_DOCTYPE = "Outflow Import Project Alias"


def normalised(phrase: str | None) -> str:
    """The phrase as the import matches it: lowercase words, single spaces. Blank when nothing is left to match."""
    return alias_haystack(phrase).strip()


def lock_phrase(phrase: str | None) -> None:
    """Hold this transaction's lock on the normalised phrase until it ends (Postgres advisory lock). Taken by the
    alias doctype's `validate`, so a Desk save queues behind a Move learning the same phrase."""
    frappe.db.sql("SELECT pg_advisory_xact_lock(hashtext(%s))", (_lock_key(phrase),))


def holder_of(phrase: str | None):
    """The alias row (`name`, `keyword`, `project`, `active`) that already reads as this phrase, active or not, or
    `None`. The table is small (a curated list plus what Moves teach), so every row is read."""
    wanted = normalised(phrase)
    if not wanted:
        return None
    for row in frappe.get_all(ALIAS_DOCTYPE, fields=["name", "keyword", "project", "active"], order_by="creation asc"):
        if normalised(row.keyword) == wanted:
            return row
    return None


def phrase_refusal(phrase: str | None, project: str | None) -> str | None:
    """Why this phrase cannot be learned for `project`, or `None` (also when nothing would be learned)."""
    if not project or not normalised(phrase):
        return None
    holder = holder_of(phrase)
    if holder and holder.project != project:
        return _taken(holder)
    return None


def learn_phrase(phrase: str | None, project: str | None) -> dict | None:
    """Save `phrase` as an active alias of `project`, and commit. Call it at a transaction boundary: it commits first.

    `None` when nothing is to be learned (no project, or a blank phrase). Else `{"phrase", "saved": bool,
    "reason"?}`: `saved` False with no reason when it already named this project; with a reason when another project
    took it after the write's first check.
    """
    phrase = (phrase or "").strip()
    if not project or not normalised(phrase):
        return None
    # ⚠️ A SESSION LOCK, THEN A FRESH TRANSACTION. Postgres runs Frappe at REPEATABLE READ: a transaction reads from
    # the snapshot its first statement took, so a lock taken inside it would not show an alias committed while it
    # waited. This lock outlives the commit below; the next statement's snapshot is taken under it, and sees every
    # alias a Move (or a Desk save, through `validate`'s lock) committed before.
    frappe.db.sql("SELECT pg_advisory_lock(hashtext(%s))", (_lock_key(phrase),))
    try:
        frappe.db.commit()
        return _learn(phrase, project)
    except Exception:
        frappe.db.rollback()
        raise
    finally:
        frappe.db.sql("SELECT pg_advisory_unlock(hashtext(%s))", (_lock_key(phrase),))


def _learn(phrase: str, project: str) -> dict:
    holder = holder_of(phrase)
    if holder and holder.project != project:
        return {"phrase": phrase, "saved": False, "reason": _taken(holder)}
    if holder:
        if not holder.active:
            alias = frappe.get_doc(ALIAS_DOCTYPE, holder.name)
            alias.active = 1
            alias.save(ignore_permissions=True)
            frappe.db.commit()
        return {"phrase": holder.keyword, "saved": not holder.active}
    # The Move's own gate (undo access) is the permission; the alias doctype's role list is the Desk's.
    frappe.get_doc({"doctype": ALIAS_DOCTYPE, "keyword": phrase, "project": project, "active": 1}).insert(
        ignore_permissions=True
    )
    frappe.db.commit()
    return {"phrase": phrase, "saved": True}


def _lock_key(phrase: str | None) -> str:
    return f"project-alias:{normalised(phrase)}"


def _taken(holder) -> str:
    name = frappe.db.get_value("Projects", holder.project, "project_name") or holder.project
    return (
        f"'{holder.keyword}' already puts spends on {name}, and one phrase cannot name two projects. "
        "Change the phrase, or untick the box."
    )
