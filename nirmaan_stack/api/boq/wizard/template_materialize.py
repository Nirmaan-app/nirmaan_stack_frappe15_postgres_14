"""
BoQ "Create from Template" -- seed materialize (ADR-0013 Amendment A1, slice A-T2).

The ONE-TIME bootstrap that turns a curated, normally-committed BoQ (a project-less
`is_template_source` authoring BoQ) into the single master `BoQ Template`. This is the
first of the two inversions in the A1 pipeline: the flatten-and-strip work moves EARLIER,
to seed time, so the create-clone (A-T3) becomes a straight structural copy.

What materialize does (A1-D2/D3/D10):
  * Enumerate the seed's COMMITTED sheets (`BoQ Sheet` is_current=1) -- both data and
    general-specs committed tiers.
  * Per sheet: reconstruct a `sheet_config` from the committed sheet's column snapshot,
    COLLAPSE multi-area -> single-area (RE-HOME each per-area qty/rate/amount role to its
    single-area scalar equivalent, keeping exactly one column per scalar target so the sheet
    stays PRICEABLE; area_dimensions=[]), carry the WP grandchildren + (for a general-specs
    sheet) the preamble text.
  * Per sheet: read the seed's SURVIVING `BoQ Review Row`s (is_excluded=0), resolve the
    EFFECTIVE classification/parent via the shared `resolve_effective` (human > AI > parser),
    STRIP qty/rate/amount, and write a structural-only `BoQ Template Row` per row (sentinels
    preserved: parent_index -1 = root; attached_to_index 0 = not attached).
  * Write the master `BoQ Template` + `BoQ Template Sheet` children, UPDATE-IN-PLACE if a
    master already exists (reuse the SAME docname so `source_template` links on prior clones
    stay valid). Stamp provenance. Commit.

Public API (both Admin + Estimates gated -- A1-D10):
  set_as_master_template(seed_boq, template_name=None) -> dict   [POST]
  get_master_template_admin()                          -> dict   [GET-capable]

LOAD-BEARING gotchas honoured here:
  * -1 vs 0 sentinels: parent_index uses -1 (no-parent/root); attached_to_index uses 0
    (not-attached). NEVER conflated -- 0 is a valid row_index.
  * LIST-JSON wall: `attached_notes` (BoQ Template Row) + `work_packages` (BoQ Template
    Sheet) are LIST-valued JSON -> json.dumps BEFORE insert; existing masters are cleared
    via raw frappe.db.delete (NOT delete_doc, which throws "... cannot be a list"). Dict-JSON
    (`sheet_config`) is assigned as a plain dict (Frappe auto-serializes -- never json.dumps).
  * sheet_name matched VERBATIM everywhere (#152) -- trailing/leading spaces are identity.
"""
from __future__ import annotations

import json

import frappe

from nirmaan_stack.api.boq.wizard.review_screen import resolve_effective


# ---------------------------------------------------------------------------
# Authorization -- seed + admin-edit the master = Admin + Estimates (ADR-0013 A1-D10).
# Reads role_profile off Nirmaan Users (this app stores the full "... Profile" string);
# the Administrator user is always allowed. UI gates are not enough -- these endpoints
# can be called directly.
# ---------------------------------------------------------------------------

_SEED_ROLE_PROFILES = frozenset({
    "Nirmaan Admin Profile",
    "Nirmaan Estimates Executive Profile",
})


def _ensure_admin_or_estimates() -> None:
    user = frappe.session.user
    if user == "Administrator":
        return
    role_profile = frappe.db.get_value("Nirmaan Users", user, "role_profile")
    if role_profile not in _SEED_ROLE_PROFILES:
        frappe.throw(
            "You are not permitted to manage the master BoQ template.",
            frappe.PermissionError,
        )


# ---------------------------------------------------------------------------
# Multi-area -> single-area collapse (A1-D3)
# ---------------------------------------------------------------------------

# The per-area ColumnRole tokens (services/boq_parser/config.py) mapped to their SINGLE-AREA
# scalar equivalent. The collapse RE-HOMES each per-area family to its scalar role, keeping
# ONE column per target (keep-first-by-Excel-order, drop the duplicate-area columns) -- it does
# NOT drop rate/amount roles. Dropping them would make a PURELY area-split sheet UNPRICEABLE:
# the pricing editor derives its editable rate cell + amount-formula target from the committed
# column_role_map (PricingGrid.isRateDescriptor / pricing._committed_amount_descriptors), so a
# sheet with no rate role has no editable rate cell at all. Keeping exactly one of each scalar
# also satisfies the SheetConfig singleton validator (config.py:_SINGLETON_ROLES).
_PER_AREA_TO_SCALAR = {
    "qty": "qty_total",
    "rate_supply_by_area": "rate_supply",
    "rate_install_by_area": "rate_install",
    "rate_combined_by_area": "rate_combined",
    "amount_supply_by_area": "amount_supply",
    "amount_install_by_area": "amount_install",
    "amount_total_by_area": "amount_total",
}
_SCALAR_TARGET_ROLES = frozenset(_PER_AREA_TO_SCALAR.values())


def _excel_col_key(col: str):
    """Sort key giving Excel column order (A..Z, AA, AB, ...): fewer letters first, then
    lexicographic. Matches the keep-first tie-break used for every collapsed role family."""
    return (len(col), col)


def _as_dict(val) -> dict:
    """Coerce a JSON-column value (dict already, a raw JSON string, or None) to a plain
    dict -- never raises. frappe.get_all returns JSON columns parsed (dict) in v15; guard
    the legacy string shape too."""
    if isinstance(val, dict):
        return val
    if isinstance(val, str) and val:
        try:
            parsed = json.loads(val)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def _collapse_to_single_area(sheet_config: dict) -> dict:
    """PURE: return a copy of `sheet_config` normalized to a SINGLE area (A1-D3).

    Since qty/rate/amount VALUES are stripped at materialize, this is a pure column-config
    normalization that PRESERVES the priceable surface:
      * Preserve every NON-per-area column role verbatim (sl_no / description / unit /
        make_model / row_notes / any singleton qty_total / rate_* / amount_* /
        append_to_notes / ignore / reference_images).
      * RE-HOME each per-area role family to its single-area scalar equivalent
        (qty->qty_total, rate_*_by_area->rate_*, amount_*_by_area->amount_*), keeping EXACTLY
        ONE column per scalar target (FIRST by Excel order) and dropping the duplicate-area
        columns. If a singleton scalar of that role already exists it WINS -- every per-area
        column of that family is dropped.
      * Set area_dimensions = [].

    Re-homing (not dropping) rate/amount is load-bearing: the pricing editor's editable rate
    cell + amount-formula target are derived from the committed column_role_map, so a purely
    area-split sheet that dropped all rate/amount roles would be UNPRICEABLE. Keeping one of
    each scalar also satisfies the SheetConfig singleton validator.
    """
    cfg = dict(sheet_config or {})
    role_map = cfg.get("column_role_map")
    role_map = role_map if isinstance(role_map, dict) else {}

    new_map: dict = {}
    deferred: dict[str, list[str]] = {}   # scalar_role -> [per-area column letters]
    existing_scalars: set[str] = set()

    for col, entry in role_map.items():
        if not isinstance(entry, dict):
            # Non-conforming entry -- preserve verbatim (defensive; shouldn't occur).
            new_map[col] = entry
            continue
        role = entry.get("role")
        scalar = _PER_AREA_TO_SCALAR.get(role)
        if scalar is not None:
            deferred.setdefault(scalar, []).append(col)
            continue  # per-area -- re-homed below (at most one kept per scalar target)
        new_map[col] = dict(entry)  # preserve non-per-area role verbatim
        if role in _SCALAR_TARGET_ROLES:
            existing_scalars.add(role)

    # Re-home ONE per-area column per scalar target, UNLESS a singleton of that role already
    # exists (then the singleton wins and every per-area col of that family is dropped).
    for scalar, cols in deferred.items():
        if scalar in existing_scalars:
            continue
        keep_col = sorted(cols, key=_excel_col_key)[0]
        new_map[keep_col] = {"role": scalar}  # scalar role, no area -> single-area

    cfg["column_role_map"] = new_map
    cfg["area_dimensions"] = []
    return cfg


def _reconstruct_sheet_config(cs: dict) -> dict:
    """Rebuild a draft-shaped `sheet_config` dict from a committed `BoQ Sheet` row's
    column snapshot, then collapse it to single-area. The committed sheet stores the
    config as SEPARATE columns (header_row / header_row_count / column_role_map /
    column_headers / area_dimensions / treat_as); the created BoQ's draft expects the
    blob shape, so we re-assemble it here."""
    cfg = {
        "header_row": cs.get("header_row"),
        "header_row_count": cs.get("header_row_count") or 1,
        "column_role_map": _as_dict(cs.get("column_role_map")),
        "column_headers": _as_dict(cs.get("column_headers")),
        "area_dimensions": [],  # overwritten by the collapse; committed dims not carried
        "treat_as": cs.get("treat_as") or "data",
    }
    return _collapse_to_single_area(cfg)


# ---------------------------------------------------------------------------
# Review-row -> template-row flatten (A1-D2/D3)
# ---------------------------------------------------------------------------

# Fields read off each seed BoQ Review Row: the resolve_effective inputs (human > AI >
# parser) PLUS the structural subset copied onto the template row. NO qty/rate/amount --
# they are stripped. attached_notes comes back parsed (list) in v15.
_SEED_ROW_READ_FIELDS = [
    "name", "row_index", "source_row_number",
    # resolve_effective inputs
    "classification", "human_classification",
    "parent_index", "human_parent", "human_is_root",
    "ai_suggestion_status", "ai_suggested_classification",
    "ai_suggested_parent", "ai_suggested_is_root",
    # structural subset copied verbatim
    "sl_no_value", "description", "unit", "make_model", "is_rate_only",
    "path", "level", "attached_to_index", "attached_notes",
    # per-item note channels -- carried so a template clone keeps notes a direct upload would
    "row_notes", "append_notes_raw",
]


def _build_template_row(rr: dict, sheet_name: str) -> dict:
    """Build a NEW BoQ Template Row field-dict from a seed BoQ Review Row (A1-D2/D3).

    - classification / parent_index come from the EFFECTIVE value (human/AI overlay folded
      in via resolve_effective); parent_index keeps the -1 "no parent / root" sentinel
      (NEVER 0 -- 0 is a valid row_index).
    - attached_to_index keeps the 0 "not attached" sentinel (positive = a real target).
    - source_row_number / row_index / sl_no_value / description / unit / make_model /
      is_rate_only / path / level / attached_notes are copied verbatim.
    - qty/rate/amount and the whole human/AI/gemini/edit_log overlay are NOT copied.
    - `template` is filled by the caller once the master docname is known.
    - attached_notes is a LIST-JSON field -- isinstance-guarded json.dumps before insert.
    """
    eff = resolve_effective(rr)
    epi = eff["effective_parent_index"]
    row = {
        "sheet_name": sheet_name,  # VERBATIM (#152)
        "classification": eff["effective_classification"],
        "parent_index": epi if epi is not None else -1,
        "attached_to_index": rr.get("attached_to_index") or 0,  # 0 sentinel = not attached
        # --- copied structural fields ---
        "source_row_number": rr.get("source_row_number"),
        "row_index": rr.get("row_index"),
        "sl_no_value": rr.get("sl_no_value"),
        "description": rr.get("description"),
        "unit": rr.get("unit"),
        "make_model": rr.get("make_model"),
        "is_rate_only": rr.get("is_rate_only") or 0,
        "path": rr.get("path") or "",
        "level": rr.get("level"),
        "row_notes": rr.get("row_notes"),
        # append_notes_raw is DICT-JSON (not list-JSON) -> assign as-is; Frappe auto-serializes
        # a dict on insert. NEVER json.dumps it (that would double-encode).
        "append_notes_raw": rr.get("append_notes_raw"),
    }
    an = rr.get("attached_notes")
    if isinstance(an, (list, dict)):
        row["attached_notes"] = json.dumps(an)
    elif isinstance(an, str) and an:
        row["attached_notes"] = an  # already a JSON string -- do NOT double-encode
    return row


# ---------------------------------------------------------------------------
# Master lookup / replace helpers
# ---------------------------------------------------------------------------

def _existing_master() -> dict | None:
    """The single master BoQ Template (oldest by creation), or None. MVP is a singleton."""
    rows = frappe.get_all(
        "BoQ Template",
        fields=["name", "is_active"],
        order_by="creation asc",
        limit_page_length=1,
    )
    return rows[0] if rows else None


def _clear_master_contents(master_name: str) -> None:
    """Raw-delete the master's existing BoQ Template Rows AND its BoQ Template Sheet
    children so it can be re-materialized IN PLACE (reusing the docname keeps prior clones'
    source_template links valid).

    Both carry LIST-JSON (attached_notes / work_packages) -> raw frappe.db.delete, never
    delete_doc / doc.save (the list-JSON wall). clear_document_cache after so a subsequent
    get_doc reloads the master with an empty sheets child table (the SQL child-deletes do
    not evict a parent already in Frappe's document cache).
    """
    frappe.db.delete("BoQ Template Row", {"template": master_name})
    frappe.db.delete(
        "BoQ Template Sheet",
        {"parent": master_name, "parenttype": "BoQ Template", "parentfield": "sheets"},
    )
    frappe.clear_document_cache("BoQ Template", master_name)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

# Fixed key for the transaction-scoped PG advisory lock that serializes the seed's
# check-then-create-or-update window, so two concurrent FIRST-seeds cannot each insert a
# master and break the one-master invariant (BoQ Template has no natural unique key). The
# lock releases automatically at commit/rollback.
_MASTER_SEED_LOCK = 0x60071E4  # arbitrary stable constant ("BoQ TEmplate" -> hex-ish)


@frappe.whitelist(methods=["POST"])
def set_as_master_template(seed_boq=None, template_name=None):
    """Materialize a committed `is_template_source` seed BoQ into the master `BoQ Template`.

    The one-time bootstrap (ADR-0013 A1-D10) -- Admin + Estimates gated. Validates the seed
    exists, is a template source (`is_template_source=1`), and is committed (>= 1 current
    `BoQ Sheet`). REPLACES any existing master IN PLACE (same docname) so prior clones'
    `source_template` links stay valid.

    Returns {"status": "materialized", "template": <docname>, "sheets": N, "rows": M}.
    """
    _ensure_admin_or_estimates()

    # Serialize the whole check-then-create-or-update critical section so two concurrent
    # first-seeds cannot both see "no master" and each insert one (the one-master invariant).
    frappe.db.sql("SELECT pg_advisory_xact_lock(%s)", (_MASTER_SEED_LOCK,))

    if not seed_boq:
        frappe.throw("seed_boq is required.", title="Missing field: seed_boq")
    if not frappe.db.exists("BOQs", seed_boq):
        frappe.throw(f"BOQs '{seed_boq}' not found.", title="Not found")

    is_template_source = frappe.db.get_value("BOQs", seed_boq, "is_template_source")
    if not is_template_source:
        frappe.throw(
            f"BOQs '{seed_boq}' is not a template source. Only an "
            "'is_template_source' authoring BoQ can seed the master template.",
            title="Not a template source",
        )

    # --- Enumerate the seed's COMMITTED sheets (is_current=1). Both data + general-specs
    #     committed tiers are returned; disposition is derived from general_specs membership.
    committed_sheets = frappe.get_all(
        "BoQ Sheet",
        filters={"boq": seed_boq, "is_current": 1},
        fields=[
            "name", "sheet_name", "sheet_order", "sheet_label", "treat_as",
            "header_row", "header_row_count",
            "column_role_map", "column_headers", "area_dimensions",
        ],
        order_by="sheet_order asc",
    )
    if not committed_sheets:
        frappe.throw(
            f"BOQs '{seed_boq}' has no committed sheets (no current BoQ Sheet). "
            "Commit the seed BoQ before setting it as the master template.",
            title="Seed not committed",
        )

    # general-specs membership {source_sheet_name: preamble_text} from the seed BOQs.
    seed_doc = frappe.get_doc("BOQs", seed_boq)
    gs_preamble_by_sheet = {
        gs.source_sheet_name: (gs.preamble_text or "")
        for gs in (seed_doc.general_specs_sheets or [])
        if gs.source_sheet_name
    }

    # --- Build the per-sheet payloads + accumulate the structural template rows. ---
    sheet_payloads: list[dict] = []
    all_rows: list[dict] = []
    for cs in committed_sheets:
        sheet_name = cs.get("sheet_name")  # VERBATIM (#152)
        disposition = "general_specs" if sheet_name in gs_preamble_by_sheet else "data"
        preamble = gs_preamble_by_sheet.get(sheet_name, "") if disposition == "general_specs" else ""

        sheet_config = _reconstruct_sheet_config(cs)
        work_packages = _read_committed_sheet_wps(cs.get("name"))

        sheet_payloads.append({
            "sheet_name": sheet_name,
            "sheet_order": cs.get("sheet_order") or 0,
            "sheet_label": cs.get("sheet_label"),
            "disposition": disposition,
            "sheet_config": sheet_config,               # dict-JSON -> plain dict
            "work_packages": json.dumps(work_packages),  # LIST-JSON -> json.dumps
            "preamble_text": preamble,
        })

        review_rows = frappe.get_all(
            "BoQ Review Row",
            filters={"boq": seed_boq, "sheet_name": sheet_name, "is_excluded": 0},
            fields=_SEED_ROW_READ_FIELDS,
            order_by="row_index asc",  # never order_by `order` (PG reserved)
        )
        for rr in review_rows:
            all_rows.append(_build_template_row(rr, sheet_name))

    # --- Write the master IN PLACE (reuse the existing docname) or create it fresh. ---
    template_name = template_name or seed_doc.boq_name or "Master Template"
    now = frappe.utils.now()

    existing = _existing_master()
    if existing:
        _clear_master_contents(existing["name"])
        master = frappe.get_doc("BoQ Template", existing["name"])
        master.set("sheets", [])  # defensive: cache cleared, already empty
        master.template_name = template_name
        # preserve existing is_active on update (an admin may have toggled it)
        master.is_active = existing.get("is_active") or 0
    else:
        master = frappe.new_doc("BoQ Template")
        master.template_name = template_name
        master.is_active = 0  # first create lands inactive (admin activates deliberately)

    master.seeded_from_boq = seed_boq
    master.seeded_at = now
    master.last_updated_by = frappe.session.user
    master.last_updated_on = now

    for sp in sheet_payloads:
        master.append("sheets", sp)

    if existing:
        master.save(ignore_permissions=True)
    else:
        master.insert(ignore_permissions=True)

    # --- Bulk-insert the structural BoQ Template Rows (one per surviving review row). ---
    for row in all_rows:
        row["template"] = master.name
        doc = frappe.new_doc("BoQ Template Row")
        doc.update(row)
        doc.insert(ignore_permissions=True)

    frappe.db.commit()

    return {
        "status": "materialized",
        "template": master.name,
        "sheets": len(sheet_payloads),
        "rows": len(all_rows),
    }


def _read_committed_sheet_wps(boq_sheet_name: str) -> list[str]:
    """Work-header names assigned to a committed BoQ Sheet, read from the grandchild
    `BoQ Sheet Work Package` table (get_doc does NOT hydrate grandchildren -- #5).
    Returns [] when none are assigned."""
    if not boq_sheet_name:
        return []
    rows = frappe.db.get_all(
        "BoQ Sheet Work Package",
        filters={
            "parent": boq_sheet_name,
            "parenttype": "BoQ Sheet",
            "parentfield": "work_packages",
        },
        fields=["work_header"],
        order_by="idx asc",
    )
    return [r.work_header for r in rows if r.get("work_header")]


@frappe.whitelist()
def get_master_template_admin():
    """Return the master BoQ Template (fields + provenance) + its sheets + per-sheet
    BoQ Template Row counts, for the admin template-editor screen. Admin + Estimates gated.

    @frappe.whitelist() bare -- GET-capable. Returns {} when no master exists.

    Shape:
      {
        "name", "template_name", "is_active",
        "seeded_from_boq", "seeded_at", "last_updated_by", "last_updated_on",
        "sheets": [
          {"sheet_name", "sheet_order", "sheet_label", "disposition",
           "sheet_config" (dict), "work_packages" (list), "preamble_text",
           "row_count" (int)},
          ...
        ],
      }
    """
    _ensure_admin_or_estimates()

    existing = _existing_master()
    if not existing:
        return {}

    master = frappe.get_doc("BoQ Template", existing["name"])

    # Per-sheet row counts in ONE GROUP BY (a count over rows -> the database, ADR-0010).
    count_rows = frappe.db.get_all(
        "BoQ Template Row",
        filters={"template": master.name},
        fields=["sheet_name", "count(name) as cnt"],
        group_by="sheet_name",
    )
    counts = {c.sheet_name: c.cnt for c in count_rows}

    sheets = []
    for s in (master.sheets or []):
        wp = s.work_packages
        if isinstance(wp, str) and wp:
            try:
                wp = json.loads(wp)
            except (ValueError, TypeError):
                wp = []
        if not isinstance(wp, list):
            wp = []
        cfg = _as_dict(s.sheet_config)
        sheets.append({
            "sheet_name": s.sheet_name,  # VERBATIM (#152)
            "sheet_order": s.sheet_order,
            "sheet_label": s.sheet_label,
            "disposition": s.disposition,
            "sheet_config": cfg,
            "work_packages": wp,
            "preamble_text": s.preamble_text,
            "row_count": counts.get(s.sheet_name, 0),
        })

    return {
        "name": master.name,
        "template_name": master.template_name,
        "is_active": master.is_active,
        "seeded_from_boq": master.seeded_from_boq,
        "seeded_at": master.seeded_at,
        "last_updated_by": master.last_updated_by,
        "last_updated_on": master.last_updated_on,
        "sheets": sheets,
    }
