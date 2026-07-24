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


_SRN_OFFSET_FALLBACK = 2  # default header_row=1 -> data starts at Excel row 2 (all-synthetic sheet)


def derive_source_row_offset(pairs):
    """Stable data-start offset for a sheet's source_row_number ("Excel Row"), template flow.

    A row freshly inserted in the template editor / Review phase gets source_row_number None
    -> coerced to 0 by the Int field, and the shift loop moves row_index but NOT
    source_row_number; a stray 0 corrupts the committed grid (row_number=0, collisions) and
    HARD-CRASHES the from-scratch priced export (openpyxl rejects row 0). The callers fix this
    by stamping source_row_number = row_index + offset across the whole sheet (fix-forward, no
    backfill; self-heals stray 0s on the next edit). This returns that offset.

    pairs: iterable of (row_index:int, source_row_number:int|None).
    offset = min(source_row_number - row_index) over rows with source_row_number > 0,
    else _SRN_OFFSET_FALLBACK when the sheet has no positively-numbered row (a brand-new /
    all-synthetic sheet; header_row=1 -> data starts at Excel row 2).

    MUST be derived from the CONSISTENT pre-operation rows -- i.e. the sheet state BEFORE an
    insert/delete shifts row_index. Each insert/delete leaves the sheet consistent (srn ==
    row_index + offset), so the pre-operation read is always consistent and the offset is
    STABLE across repeated edits. Deriving it from POST-shift rows (row_index moved, srn did
    not) erodes the offset by 1 per interior insert -- re-introducing the srn 0 this prevents.
    A stray srn <= 0 is excluded from the min, so it never drags the offset down and is healed
    by the stamp. A None source_row_number is treated as "no source row"."""
    positives = [(int(ri), int(srn)) for ri, srn in pairs if srn and int(srn) > 0]
    if not positives:
        return _SRN_OFFSET_FALLBACK
    return min(srn - ri for ri, srn in positives)
