# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""
Pure renumber-on-insert / reverse-renumber pointer math (ADR-0013 D6, task A-T5).

Extracted VERBATIM from ``template_rows.py`` so BOTH the create-flow review-row path
(``template_rows.create_review_row`` / ``delete_review_row`` on ``BoQ Review Row``) and
the template-editor path (``template_edit.*`` on ``BoQ Template Row``) share ONE parametric
core (ADR-0010 F3-lite: one core, two thin callers). These functions are frappe-free and
byte-behaviourally identical to the originals -- do NOT change their behaviour without
updating BOTH callers + their tests (``test_template_rows.py`` + ``test_template_edit.py``).

The two sentinel conventions these helpers encode (violating them silently corrupts the
row tree):
  - parent_index / human_parent use **-1** = no-parent / root. 0 is a VALID row_index, so a
    pointer of 0 means "child of row 0", never "no parent".
  - attached_to_index uses **0** = not-attached; a POSITIVE value is a real target row_index.
    NEVER conflate the two sentinel spaces.
"""
from __future__ import annotations


def _insert_shift(pointer, insertion_index: int) -> int:
    """Remap ONE parent pointer through an INSERT at insertion_index.

    A pointer is a row_index reference using the -1 sentinel (-1 = no parent / root;
    >= 0 = a real parent row). On insert, every row at row_index >= insertion_index moves
    +1, so any pointer that referenced such a row must also move +1. A -1 (or a pointer
    below the insertion point) is untouched. None (never expected for these Int columns)
    normalizes to the -1 sentinel."""
    if pointer is None:
        return -1
    if pointer < 0:
        return pointer  # -1 sentinel: no parent
    return pointer + 1 if pointer >= insertion_index else pointer


def _delete_remap(pointer, deleted_index: int, grandparent: int) -> int:
    """Remap ONE parent pointer through a DELETE of the row at deleted_index.

    Two effects combined so a child of the deleted row is never left dangling:
      1. RE-POINT: a pointer that referenced the deleted row (== deleted_index) is
         re-pointed to the deleted row's own (effective) parent -- `grandparent` -- so
         the subtree stays connected to the tree (ADR-0013 D6 "tree continuity"). If the
         deleted row was itself a root, grandparent is -1 and the child becomes a root.
      2. SHIFT: every row at row_index > deleted_index moves -1, so any pointer that
         (after re-pointing) references such a row moves -1 too.
    A -1 (no parent) pointer is untouched. grandparent is a PRE-delete row_index; the
    shift step corrects it if it sat above the deleted row."""
    if pointer is None:
        return -1
    if pointer < 0:
        return pointer  # -1 sentinel: no parent
    if pointer == deleted_index:
        pointer = grandparent  # re-point orphaned child to the deleted row's parent
        if pointer is None or pointer < 0:
            return -1
    # Rows after the deleted one shifted down by one; correct any pointer into that range.
    return pointer - 1 if pointer > deleted_index else pointer


def _insert_shift_attached(pointer, insertion_index: int) -> int:
    """Remap attached_to_index (a NOTE row's back-pointer to its preamble) through an INSERT.

    UNLIKE parent_index/human_parent, attached_to_index uses **0** (not -1) as the
    'not attached' sentinel -- verified against live data (all non-note rows store 0; only
    note rows carry a positive target). So ONLY a POSITIVE value is a real row_index
    reference to shift; 0 / None stays 0 / None (not attached). Missing this remap would
    leave a note visually attached to the wrong preamble after a renumber."""
    if not pointer or pointer <= 0:
        return pointer  # 0 / None = not attached
    return pointer + 1 if pointer >= insertion_index else pointer


def _delete_remap_attached(pointer, deleted_index: int) -> int:
    """Remap attached_to_index through a DELETE. 0 sentinel (see _insert_shift_attached):
    a note whose attached preamble was the deleted row DETACHES (-> 0); positive pointers
    above the deleted row shift -1; 0 / None untouched."""
    if not pointer or pointer <= 0:
        return pointer  # not attached
    if pointer == deleted_index:
        return 0  # attached row deleted -> detach
    return pointer - 1 if pointer > deleted_index else pointer
