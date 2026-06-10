"""Restructure the flat TDS Repository into the 3-level TDS Item grouping model.

Background
----------
The old shape was "1 TDS Repository row = 1 Items SKU x 1 Make x 1 datasheet",
carrying item identity inline via ``tds_item_id`` / ``tds_item_name`` /
``category``. The new model (ADR 0001, phase-1-plan T4) introduces a grouping
doctype ``TDS Items`` (with a ``TDS Items Child Table`` child table) and reduces
the repository entry to ``(tds_item, make, tds_attachment, status)``.

The schema change (T2) already REMOVED ``tds_item_id`` / ``tds_item_name`` /
``category`` from the TDS Repository doctype JSON, so after the DocType sync
runs those fields are gone from the Frappe meta (``frappe.get_all`` with them
would raise). The columns may still physically exist in PostgreSQL until a
schema sync drops them, so we read the legacy values via RAW SQL and guard the
read in try/except — if the columns are already gone (e.g. on a re-run after a
column drop), we treat the DB as already migrated and exit cleanly.

Algorithm (idempotent / re-run safe)
------------------------------------
Step 1 — Create TDS Items, deduped by ``(work_package, tds_item_name)``:
  * Standard item (``tds_item_id`` is a real ``tabItems`` row): single-member
    TDS Item. ``tds_item_name`` = legacy name (fallback Items.item_name),
    ``work_package`` from the legacy row (fallback Items.category ->
    Category.work_package), one member row = that item.
  * Custom item (``tds_item_id`` not in ``tabItems`` — e.g. ``CUS-%``, blank, or
    any stray id): member-less TDS Item. NO Items row, no category, no marker.
  * Reuse an existing TDS Item with the same ``(work_package, tds_item_name)``.

Step 2 — Repoint each legacy TDS Repository row to its mapped TDS Item via raw
  SQL UPDATE (keeping make / tds_attachment / status). Dedupe ``(tds_item,
  make)``: when multiple legacy rows collapse onto the same pair, keep the best
  survivor (prefer one with an attachment, then Verified status) and delete the
  duplicates.

Step 3 — Guarantee no surviving row has a NULL ``tds_item``.

This patch is PostgreSQL (not MariaDB). Raw SQL quotes table identifiers with
double quotes, e.g. ``"tabTDS Repository"`` — matching the other v3_0 patches
(see ``backfill_pdd_parent_doctype.py`` / ``backfill_blank_item_id.py``).
"""

import frappe


# Legacy columns we read off the old flat schema. They are NO LONGER in the
# DocType meta (removed in T2), so they must be read with raw SQL.
_LEGACY_SELECT = """
    SELECT name, tds_item_id, tds_item_name, category,
           work_package, make, tds_attachment, status
    FROM "tabTDS Repository"
"""


def execute():
    legacy_rows = _read_legacy_rows()
    if legacy_rows is None:
        print("[restructure_tds] Legacy columns absent — DB already migrated. Skipping.")
        return

    if not legacy_rows:
        print("[restructure_tds] No TDS Repository rows found. Nothing to migrate.")
        return

    print(f"[restructure_tds] Found {len(legacy_rows)} legacy TDS Repository rows.")

    # ------------------------------------------------------------------
    # Step 1 — build / reuse TDS Items, keyed by legacy tds_item_id.
    # ------------------------------------------------------------------
    # legacy tds_item_id -> TDS Item name
    item_id_to_tds_item = {}
    # (work_package, normalized tds_item_name) -> TDS Item name  (dedupe cache)
    wp_name_to_tds_item = {}

    stats = {
        "tds_items_created": 0,
        "cus_memberless_created": 0,
        "tds_items_reused": 0,
        "entries_repointed": 0,
        "duplicates_removed": 0,
        "skipped_unresolvable": 0,
    }

    # Group legacy rows by their tds_item_id so we create one TDS Item per
    # distinct legacy item. Rows with a blank id are each treated as their own
    # custom item (keyed by a synthetic per-row token) so they are NOT merged
    # together purely because they share an empty id.
    grouped = {}
    for row in legacy_rows:
        raw_id = (row.get("tds_item_id") or "").strip()
        group_key = raw_id if raw_id else f"__blank__:{row['name']}"
        grouped.setdefault(group_key, []).append(row)

    for group_key, rows in grouped.items():
        sample = rows[0]
        raw_id = (sample.get("tds_item_id") or "").strip()

        items_row = _get_items_row(raw_id) if raw_id else None
        is_standard = items_row is not None

        # Resolve label + work package.
        legacy_name = (sample.get("tds_item_name") or "").strip()
        legacy_wp = (sample.get("work_package") or "").strip()

        if is_standard:
            tds_item_name = legacy_name or (items_row.get("item_name") or "").strip()
            work_package = legacy_wp or _wp_from_items_category(items_row.get("category"))
        else:
            tds_item_name = legacy_name
            work_package = legacy_wp

        if not tds_item_name or not work_package:
            # Cannot build a valid TDS Item (both fields are reqd). Leave these
            # legacy rows un-repointed; Step 3 will surface them.
            stats["skipped_unresolvable"] += len(rows)
            print(
                f"[restructure_tds] WARN: cannot resolve TDS Item for legacy id "
                f"'{raw_id or '(blank)'}' (name='{tds_item_name}', wp='{work_package}') "
                f"— {len(rows)} row(s) left unmapped."
            )
            continue

        dedupe_key = (work_package, tds_item_name.strip().lower())

        # Re-run safety + in-run dedupe by (work_package, tds_item_name).
        tds_item_name_doc = wp_name_to_tds_item.get(dedupe_key)
        if not tds_item_name_doc:
            tds_item_name_doc = _find_existing_tds_item(work_package, tds_item_name)

        if tds_item_name_doc:
            wp_name_to_tds_item[dedupe_key] = tds_item_name_doc
            item_id_to_tds_item[group_key] = tds_item_name_doc
            stats["tds_items_reused"] += 1
            # Ensure the standard item has its single member (re-run may have
            # created the TDS Item but failed before adding the member).
            if is_standard:
                _ensure_member(tds_item_name_doc, raw_id)
            continue

        # Create a fresh TDS Item.
        doc = frappe.new_doc("TDS Items")
        doc.tds_item_name = tds_item_name
        doc.work_package = work_package
        if is_standard:
            doc.append("members", {"item": raw_id})
        # Custom -> member-less: no members, no category, no marker.
        doc.insert(ignore_permissions=True)

        wp_name_to_tds_item[dedupe_key] = doc.name
        item_id_to_tds_item[group_key] = doc.name
        stats["tds_items_created"] += 1
        if not is_standard:
            stats["cus_memberless_created"] += 1

    frappe.db.commit()

    # ------------------------------------------------------------------
    # Step 2 — repoint legacy rows + dedupe (tds_item, make).
    # ------------------------------------------------------------------
    # Track the chosen survivor per (tds_item, make) pair across this run.
    survivor_by_pair = {}

    for row in legacy_rows:
        raw_id = (row.get("tds_item_id") or "").strip()
        group_key = raw_id if raw_id else f"__blank__:{row['name']}"
        tds_item = item_id_to_tds_item.get(group_key)
        if not tds_item:
            # Unresolvable group (already warned in Step 1).
            continue

        make = (row.get("make") or "").strip()
        pair = (tds_item, make)
        existing_survivor = survivor_by_pair.get(pair)

        if existing_survivor is None:
            # First row for this pair -> it becomes the survivor.
            survivor_by_pair[pair] = row
            _set_tds_item(row["name"], tds_item)
            stats["entries_repointed"] += 1
        else:
            # Duplicate pair -> keep the better of the two, delete the loser.
            winner, loser = _pick_survivor(existing_survivor, row)
            survivor_by_pair[pair] = winner
            # Winner must be repointed (in case the previously-chosen survivor
            # is being replaced by this row).
            _set_tds_item(winner["name"], tds_item)
            _delete_repo_row(loser["name"])
            stats["duplicates_removed"] += 1

    frappe.db.commit()

    # ------------------------------------------------------------------
    # Step 3 — verify no surviving row has a NULL/empty tds_item.
    # ------------------------------------------------------------------
    orphans = frappe.db.sql(
        """
        SELECT name FROM "tabTDS Repository"
        WHERE tds_item IS NULL OR tds_item = ''
        """,
        as_dict=True,
    )
    if orphans:
        orphan_names = [o["name"] for o in orphans]
        print(
            f"[restructure_tds] WARN: {len(orphan_names)} TDS Repository row(s) "
            f"still have no tds_item: {orphan_names}"
        )
    else:
        print("[restructure_tds] OK: every surviving TDS Repository row has a tds_item.")

    print(
        "[restructure_tds] DONE. "
        f"TDS Items created: {stats['tds_items_created']} "
        f"(of which member-less CUS: {stats['cus_memberless_created']}), "
        f"reused: {stats['tds_items_reused']}, "
        f"entries repointed: {stats['entries_repointed']}, "
        f"duplicates removed: {stats['duplicates_removed']}, "
        f"unresolvable rows skipped: {stats['skipped_unresolvable']}."
    )


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def _read_legacy_rows():
    """Read legacy rows via raw SQL.

    Returns a list of dicts, or ``None`` if the legacy columns are gone (which
    means the schema sync already dropped them => already migrated / re-run).
    """
    try:
        return frappe.db.sql(_LEGACY_SELECT, as_dict=True)
    except Exception as e:
        # On Postgres a missing column raises UndefinedColumn. Roll back the
        # aborted transaction so subsequent statements in this patch run / the
        # migrate session aren't poisoned, then treat as already-migrated.
        frappe.db.rollback()
        print(f"[restructure_tds] Legacy read failed ({e.__class__.__name__}: {e}).")
        return None


def _get_items_row(item_id):
    """Return the Items-master row dict for ``item_id`` or None."""
    if not item_id:
        return None
    rows = frappe.db.sql(
        """
        SELECT name, item_name, category
        FROM "tabItems"
        WHERE name = %s
        """,
        (item_id,),
        as_dict=True,
    )
    return rows[0] if rows else None


def _wp_from_items_category(category):
    """Derive a work package from an Items category via Category.work_package."""
    if not category:
        return ""
    wp = frappe.db.get_value("Category", category, "work_package")
    return (wp or "").strip()


def _find_existing_tds_item(work_package, tds_item_name):
    """Find a TDS Item with the same (work_package, tds_item_name). Re-run safe.

    Name comparison is case-insensitive + trimmed to match the dedupe key.
    """
    rows = frappe.db.sql(
        """
        SELECT name FROM "tabTDS Items"
        WHERE work_package = %s
          AND LOWER(TRIM(tds_item_name)) = %s
        LIMIT 1
        """,
        (work_package, tds_item_name.strip().lower()),
        as_dict=True,
    )
    return rows[0]["name"] if rows else None


def _ensure_member(tds_item_name_doc, item_id):
    """Ensure a standard TDS Item carries its single member row (re-run safe)."""
    if not item_id:
        return
    exists = frappe.db.exists(
        "TDS Items Child Table", {"parent": tds_item_name_doc, "item": item_id}
    )
    if exists:
        return
    doc = frappe.get_doc("TDS Items", tds_item_name_doc)
    doc.append("members", {"item": item_id})
    doc.save(ignore_permissions=True)


def _set_tds_item(repo_name, tds_item):
    """Repoint a TDS Repository row to its TDS Item via raw UPDATE.

    Avoids doc.save() so the (tds_item, make) uniqueness validate does not throw
    mid-migration while duplicates are still being resolved.
    """
    frappe.db.sql(
        """
        UPDATE "tabTDS Repository"
        SET tds_item = %s
        WHERE name = %s
        """,
        (tds_item, repo_name),
    )


def _delete_repo_row(repo_name):
    """Hard-delete a duplicate TDS Repository row via raw SQL."""
    frappe.db.sql(
        """
        DELETE FROM "tabTDS Repository"
        WHERE name = %s
        """,
        (repo_name,),
    )


def _pick_survivor(a, b):
    """Choose which of two duplicate legacy rows to keep.

    Preference order:
      1. Has a tds_attachment.
      2. Verified status.
    Returns (winner, loser).
    """

    def score(r):
        has_attach = 1 if (r.get("tds_attachment") or "").strip() else 0
        verified = 1 if (r.get("status") or "").strip() == "Verified" else 0
        return (has_attach, verified)

    if score(b) > score(a):
        return b, a
    return a, b
