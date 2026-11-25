# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Move to a project learns the remark's phrase (#1758, spec #1753 stories 47-52, "Phrase learning").

The Move write (`porter_rectify.rectify_rows`) takes an optional phrase. For a project destination it is saved as an
active `Outflow Import Project Alias` (phrase -> project), which the next Cashbook upload's plan reads
(`cashbook.project_index`). A move to Non Project learns nothing.

  * `phrase_refusal`: asked before any line moves. A phrase that already names ANOTHER project refuses the whole
    write, in a plain sentence, so the person changes the phrase or unticks the box.
  * `learn_phrase`: after the lines, once at least one moved. The same phrase already naming this project changes
    nothing (a retired one is made active again: the person has just asked for it). A save refused now, with the
    lines already committed, comes back as the answer's reason, never as an error.

⚠️ ONE PHRASE NEVER NAMES TWO PROJECTS THROUGH A MOVE. "Same phrase" is `services/outflow_import/project_alias`'s;
the table's own unique key sees only the exact text. The check and the insert run under one advisory lock on the
normalised phrase, reading from a transaction begun under it (`learn_phrase`); the doctype's own `validate` takes the
same lock. So two Moves teaching "VR Mall" and "vr  mall" to two projects queue, and the second is refused. (A Desk
save reads from its request's earlier snapshot, so a Desk save racing a Move can still miss the Move's row; the
import then drops the phrase, and never misplaces a spend by it.)
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.project_alias import ALIAS_DOCTYPE, holder_of, lock_key, normalised


def phrase_refusal(phrase: str | None, project: str | None, learns_phrases: bool) -> str | None:
    """Why this phrase cannot be learned for `project`, or `None` (also when nothing would be learned).

    `learns_phrases`: the lines' source's (`RectifySource.learns_phrases`). Only a Cashbook line's remark teaches a
    phrase (the owner, 2026-11-26), so any other source's Move sent with one is refused outright.
    """
    if not project or not normalised(phrase):
        return None
    if not learns_phrases:
        return "Only a Move of Cashbook lines can learn a phrase. Send it without one."
    holder = holder_of(phrase)
    if holder and holder.project != project:
        return _taken(holder)
    return None


def learn_phrase(phrase: str | None, project: str | None) -> dict | None:
    """Save `phrase` as an active alias of `project`, and commit. Call it at a transaction boundary: it commits first.

    `None` when nothing is to be learned (no project, or a blank phrase). Else `{"phrase", "saved": bool,
    "reason"?}`: `saved` False with no reason when it already named this project; with a reason when the save was
    refused (another project took the phrase after the write's first check, or the alias's own validation).
    """
    phrase = (phrase or "").strip()
    if not project or not normalised(phrase):
        return None
    # ⚠️ A SESSION LOCK, THEN A FRESH TRANSACTION. Postgres runs a connection's first Frappe transaction at REPEATABLE
    # READ: it reads from the snapshot its first statement took, so a lock taken inside it would not show an alias
    # committed while it waited. This lock outlives the commit below; the next transaction starts under it, and sees
    # every alias a Move (or a Desk save, through `validate`'s lock) committed before.
    frappe.db.sql("SELECT pg_advisory_lock(hashtext(%s))", (lock_key(phrase),))
    try:
        frappe.db.commit()
        return _learn(phrase, project)
    except frappe.ValidationError as exc:
        # The lines have committed: the screen must hear that they moved and why the phrase did not stick.
        frappe.db.rollback()
        return {"phrase": phrase, "saved": False, "reason": frappe.utils.strip_html(str(exc)).strip()}
    except Exception:
        frappe.db.rollback()
        raise
    finally:
        frappe.db.sql("SELECT pg_advisory_unlock(hashtext(%s))", (lock_key(phrase),))
        frappe.db.commit()


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


def _taken(holder) -> str:
    name = frappe.db.get_value("Projects", holder.project, "project_name") or holder.project
    return (
        f"'{holder.keyword}' already puts spends on {name}, and one phrase cannot name two projects. "
        "Change the phrase, or untick the box."
    )
