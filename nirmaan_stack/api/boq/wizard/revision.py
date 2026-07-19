"""Revised-BoQ entry backend (S2, ADR-0014 D1/D2).

A revision is a NEW `BOQs` doc (`origin="revision"`, `source_boq` -> the original),
uploaded against an already-committed original in the same project. This module owns
the *entry* surface: which originals are revisable, and the eligibility helper the
upload endpoint shares.

Seeding, sheet-mapping and the whole carry pipeline are LATER slices (S3+). Here we
only decide what the picker may offer and re-validate the pick server-side.

D1 eligibility: **same project AND >= 1 committed sheet.** Committed-ness has no field
to filter on (`BOQs.status` never leaves `Draft` in practice), so it is computed from
the committed GRID tier -- the same `(boq, is_current=1)` shape `commit_gate.get_committed_state`
reads. **Filter, don't grey** -- only eligible BOQs are returned. **Chains are allowed**
(a committed revision is itself revisable): no `origin` exclusion.

S3 (ADR-0014 D3/D4) adds the sheet-mapping surface: `get_revision_mapping_proposal`
(Zone-1 identity + carry counts, Zone-2 N2 pairing proposal) and `confirm_revision_mapping`
(the human-confirmed 1:1 mapping -> seeds the drafts the whole carry pipeline hangs off).
The pairing authority is the pure `services/boq_revision` (N2 + per-side count-guard); this
module is the thin orchestrator that reads the tiers, calls it, validates and seeds.
"""

import os

import frappe

from nirmaan_stack.api.boq.wizard.revision_carry import carry_config_dispositions
from nirmaan_stack.services.boq_revision.sheet_match import propose_pairing


def _boq_has_committed_sheet(boq: str) -> bool:
    """True iff the BoQ has >= 1 CURRENT committed sheet (D1 committed-ness).

    The committed GRID tier (`BoQ Committed Sheet Grid`, is_current=1) is the
    authoritative committed-state source -- it is written for BOTH commit dispositions
    and carries the one-current invariant (mirrors `commit_gate.get_committed_state`).
    A partial commit qualifies (one committed sheet is enough); an uncommitted original
    sheet simply falls through as a NEW sheet in the revision (D4).
    """
    return bool(frappe.db.exists("BoQ Committed Sheet Grid", {"boq": boq, "is_current": 1}))


def assert_revisable_source(source_boq: str, project: str) -> None:
    """Server-side re-validation that `source_boq` is a legitimate revision source (D1).

    The full D1 eligibility rule -- **same project AND >= 1 committed sheet** -- lives here,
    the one owning module (`list_revisable_boqs` is its read-side twin). The upload endpoint
    calls this so a stale picker or a hand-crafted request can never create a revision against
    an ineligible original. Raises `frappe.ValidationError` with a specific message per failure.
    (Chains are allowed, so there is deliberately NO `origin` check.)
    """
    if not frappe.db.exists("BOQs", source_boq):
        frappe.throw(f"Original BoQ '{source_boq}' not found.", title="Not found")
    if frappe.db.get_value("BOQs", source_boq, "project") != project:
        frappe.throw(
            "The selected original belongs to a different project.",
            title="Project mismatch",
        )
    if not _boq_has_committed_sheet(source_boq):
        frappe.throw(
            "The selected BoQ has no committed sheets and cannot be revised.",
            title="Not revisable",
        )


@frappe.whitelist()
def list_revisable_boqs(project: str) -> dict:
    """READ-ONLY. Return the project's revisable BOQs, latest-uploaded first.

    Eligible iff same project AND >= 1 committed sheet (D1). Filter, don't grey: only
    eligible rows are returned, so an empty list is the signal to disable the Revise
    radio. Chains allowed -- no `origin` exclusion; a committed revision lists too.

    Project-less template SEEDS (ADR-0013 A1, `is_template_source=1`) are excluded --
    they carry no project and are never a revision target.

    Returns:
      {"revisable": [
          {"name": str,          # BOQs docname (the picker value + source_boq)
           "boq_name": str,
           "version": int,
           "uploaded_at": str | None},  # as Frappe returns the Datetime; latest first
        ...]}
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")

    # All candidate BOQs in the project. NO origin exclusion (chains allowed); exclude the
    # project-less template seeds defensively. Latest-uploaded first (D1 ordering).
    boqs = frappe.get_all(
        "BOQs",
        filters={"project": project, "is_template_source": 0},
        fields=["name", "boq_name", "version", "uploaded_at"],
        order_by="uploaded_at desc",
    )
    if not boqs:
        return {"revisable": []}

    # Committed-ness in ONE query: which of these BOQs have a current committed grid row.
    names = [b.name for b in boqs]
    committed = frappe.get_all(
        "BoQ Committed Sheet Grid",
        filters={"boq": ["in", names], "is_current": 1},
        fields=["boq"],
        distinct=True,
    )
    committed_names = {r.boq for r in committed}

    revisable = [
        {
            "name": b.name,
            "boq_name": b.boq_name,
            "version": b.version,
            "uploaded_at": b.uploaded_at,
        }
        for b in boqs
        if b.name in committed_names
    ]
    return {"revisable": revisable}


# ---------------------------------------------------------------------------
# S3 -- sheet-mapping proposal + confirm (ADR-0014 D3/D4)
# ---------------------------------------------------------------------------
#
# An unconfirmed revision is exactly `origin=="revision"` AND an empty `sheet_drafts`
# (S2's emergent marker -- no 8th schema field). `upload_file` seeds NOTHING for a
# revision; `confirm_revision_mapping` does the seeding after the human confirms the
# mapping on the always-shown screen. The two `source_sheet_name` fields are DIFFERENT
# concepts sharing a name: `BoQ Sheet Draft.source_sheet_name` (D3, new) is the
# CROSS-DOC pointer at the original's committed sheet; `general_specs_sheets.source_sheet_name`
# (pre-existing) is the sheet's OWN name within this doc. Do not conflate them.


def _load_revision(boq: str):
    """Load a BOQs doc and assert it is a revision (origin=="revision", source_boq set).

    Used by both S3 endpoints. Does NOT check `sheet_drafts` -- the READ (proposal) is
    lenient (a confirmed revision can still be inspected), the WRITE (confirm) adds the
    empty-drafts write-once guard itself.
    """
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not frappe.db.exists("BOQs", boq):
        frappe.throw(f"BoQ '{boq}' not found.", title="Not found")
    boq_doc = frappe.get_doc("BOQs", boq)
    if boq_doc.origin != "revision" or not boq_doc.source_boq:
        frappe.throw(
            "This BoQ is not a revision -- there is no original to map against.",
            title="Not a revision",
        )
    return boq_doc


def _read_revised_tab_names(source_file_url: str) -> list[str]:
    """Return the revised workbook's tab names in tab order (VERBATIM, #152).

    S3 safety rule (root CLAUDE.md, "BoQ File Reading"): read the bytes via the
    NamedTemporaryFile pattern -- NEVER build a local path from `file_url`
    (`frappe_s3_attachment` rewrites it to an API URL after insert). Tab names only,
    so `read_only=True` (no cell scan). Function-level imports keep the module load
    light and sidestep any import cycle with `sheet_preview`.
    """
    import openpyxl  # noqa: PLC0415

    from nirmaan_stack.api.boq.wizard.sheet_preview import (  # noqa: PLC0415
        _fetch_boq_file_to_tempfile,
    )

    if not source_file_url:
        frappe.throw(
            "This revision has no source file to read.", title="Missing source file"
        )
    tmp = _fetch_boq_file_to_tempfile(source_file_url)
    wb = None
    try:
        wb = openpyxl.load_workbook(tmp, read_only=True)
        return list(wb.sheetnames)
    finally:
        if wb is not None:
            wb.close()
        try:
            os.remove(tmp)
        except OSError:
            pass


def _original_committed_sheets(source_boq: str) -> list[dict]:
    """The original's CURRENT committed sheets, from the GRID tier (same source S2 uses).

    Returns [{"sheet_name", "commit_version", "general_specs", "committed_at"}], ordered
    by commit order (committed_at). general_specs = `sheet_disposition == "grid_only"` (the
    commit-time discriminator: grid_only for a general-specs sheet, grid_and_nodes for data).
    The GRID tier keys the sheet by `source_sheet_name` and is written for BOTH dispositions,
    which is why it -- not `BoQ Sheet` -- is the committed-ness authority here (mirrors
    `commit_gate.get_committed_state` and `_boq_has_committed_sheet`).
    """
    rows = frappe.get_all(
        "BoQ Committed Sheet Grid",
        filters={"boq": source_boq, "is_current": 1},
        fields=["source_sheet_name", "commit_version", "sheet_disposition", "committed_at"],
        order_by="committed_at asc",
    )
    return [
        {
            "sheet_name": r.source_sheet_name,  # VERBATIM (#152)
            "commit_version": r.commit_version,
            "general_specs": r.sheet_disposition == "grid_only",
            "committed_at": r.committed_at,
        }
        for r in rows
    ]


def _carry_counts(source_boq: str) -> dict:
    """Cheap COUNTs for the Zone-1 F2 signal -- what will carry. NO parse.

    Rates = current `BoQ Cell Pricing` rows; classifications = current `BOQ Nodes` with a
    non-blank `human_classification`. Both are the honest "how much human work exists on the
    original" numbers that DIFFER between the right and a wrong original (the F2 control).
    """
    rates = frappe.db.count("BoQ Cell Pricing", {"boq": source_boq, "is_current": 1})
    classifications = frappe.db.count(
        "BOQ Nodes",
        {"boq": source_boq, "is_current": 1, "human_classification": ["!=", ""]},
    )
    return {"rates": rates, "classifications": classifications}


@frappe.whitelist()
def get_revision_mapping_proposal(boq: str) -> dict:
    """READ-ONLY. Zone-1 identity + carry counts, Zone-2 N2 pairing proposal (ADR-0014 D3).

    Zone-1 (the F2 control): the picked original's identity + its committed-sheet list +
    the carry counts -- what the user did NOT see at pick time and that differs between the
    right and a wrong original.

    Zone-2 (the F1 control): the revised workbook's tabs in tab order, each pre-filled with a
    confident N2 pairing (`services/boq_revision.sheet_match`) or left blank (unmatched) where
    a key is ambiguous on either side. The pre-fill is name-identical BY CONSTRUCTION, so it
    can never introduce an F1 error; the human confirms on the screen.

    Returns:
      {"source_boq", "boq_name", "source_version", "committed_at",
       "committed_sheets": [{"sheet_name", "commit_version", "general_specs"}, ...],
       "carry_counts": {"rates", "classifications"},
       "revised_sheets": [{"sheet_name", "sheet_order", "proposed_source", "status",
                           "general_specs"}, ...],
       "self_collision": bool}
    """
    boq_doc = _load_revision(boq)
    source_boq = boq_doc.source_boq

    src = frappe.db.get_value("BOQs", source_boq, ["boq_name", "version"], as_dict=True)
    committed = _original_committed_sheets(source_boq)
    committed_by_name = {c["sheet_name"]: c for c in committed}

    tab_names = _read_revised_tab_names(boq_doc.source_file_url)
    proposal = propose_pairing(tab_names, [c["sheet_name"] for c in committed])

    revised_sheets = []
    for idx, p in enumerate(proposal.pairings, start=1):
        src_sheet = committed_by_name.get(p.proposed_source) if p.proposed_source else None
        revised_sheets.append(
            {
                "sheet_name": p.sheet_name,  # VERBATIM (#152)
                "sheet_order": idx,
                "proposed_source": p.proposed_source,
                "status": p.status,
                # A matched sheet inherits the original's general-specs designation as a
                # smart default (re-toggleable on the screen). A New sheet is never
                # auto-general-specs (D4).
                "general_specs": bool(src_sheet and src_sheet["general_specs"]),
            }
        )

    committed_at = max((c["committed_at"] for c in committed if c["committed_at"]), default=None)
    return {
        "project": boq_doc.project,  # the revision's own project (for the screen's back-nav by id)
        "source_boq": source_boq,
        "boq_name": src.boq_name if src else boq_doc.boq_name,
        "source_version": src.version if src else None,
        "committed_at": committed_at,
        "committed_sheets": [
            {
                "sheet_name": c["sheet_name"],
                "commit_version": c["commit_version"],
                "general_specs": c["general_specs"],
            }
            for c in committed
        ],
        "carry_counts": _carry_counts(source_boq),
        "revised_sheets": revised_sheets,
        "self_collision": proposal.self_collision,
    }


@frappe.whitelist()
def get_removed_source_sheets(boq: str) -> dict:
    """READ-ONLY. The original's committed sheets NOT claimed by any of this revision's drafts
    (ADR-0014 D4 -- the hub's "removed-sheet advisory").

    The mapping screen surfaces the unclaimed originals at confirm time (Zone-2's
    `unclaimedOriginals` -> "N of M claimed ... won't carry"); this is the SAME set on the
    hub after seeding -- the second of T4's "two surfaces, two audiences" (#8). A removed
    original carries nothing (no draft points at it via `source_sheet_name`).

    Computed from the seeded drafts, so it is only meaningful AFTER the mapping is confirmed;
    an unconfirmed revision (empty `sheet_drafts`) returns an empty list -- the hub redirects
    such a doc to the mapping screen anyway, and "removed" has no meaning before a mapping.

    Returns {"removed": [{"sheet_name", "general_specs"}, ...], "source_version": <int|None>},
    `removed` ordered by the original's commit order (from `_original_committed_sheets`).
    """
    boq_doc = _load_revision(boq)
    drafts = boq_doc.sheet_drafts or []
    if not drafts:
        return {"removed": [], "source_version": None}
    # A draft's `source_sheet_name` is its write-once pointer to the claimed original (blank on
    # a New sheet). The claimed set is those pointers, matched VERBATIM (#152) against the
    # original's committed sheet_names.
    claimed = {d.source_sheet_name for d in drafts if d.source_sheet_name}
    removed = [
        {"sheet_name": c["sheet_name"], "general_specs": c["general_specs"]}
        for c in _original_committed_sheets(boq_doc.source_boq)
        if c["sheet_name"] not in claimed
    ]
    return {
        "removed": removed,
        "source_version": frappe.db.get_value("BOQs", boq_doc.source_boq, "version"),
    }


@frappe.whitelist(methods=["POST"])
def confirm_revision_mapping(boq: str, mapping) -> dict:
    """Validate the human-confirmed mapping, then SEED the revision's drafts (ADR-0014 D3/D4).

    `mapping` is the screen's confirmed pairing: one entry per revised tab
      [{"sheet_name": <revised verbatim>,
        "source_sheet_name": <original committed sheet_name> | None,  # set = mapped
        "declared_new": bool,    # required-true when source is null (explicit New declaration)
        "general_specs": bool}, ...]
    (accepted as a JSON string or a parsed list).

    Validation (strict, server-authoritative -- the screen is only a staging area):
      * WRITE-ONCE: the revision must be unconfirmed (empty `sheet_drafts`). A second confirm
        is REJECTED -- `source_sheet_name` is never mutated once stamped.
      * The mapping must cover EXACTLY the revised workbook's tabs (a stale screen is refused).
      * EXPLICIT DECISION per tab (the "unmatched = hard stop" rule, server-side): each tab is
        EITHER mapped OR `declared_new` -- a null source with no `declared_new` is UNDECIDED and
        refused, so a stale POST can never silently seed everything as New.
      * STRICT 1:1: no original committed sheet may be claimed by two revised tabs.
      * Every claimed original must be a real current committed sheet of the source.

    Seeding: every tab -> a `BoQ Sheet Draft` at its VERBATIM `sheet_name` + tab-order
    `sheet_order`, `source_sheet_name` stamped write-once on mapped tabs. S4 (D5) then decides
    each mapped DATA sheet's config carry: the draft is seeded with the original's rectified
    `column_role_map` (`sheet_config`), and `wizard_status` is `Config Done` when the revised
    columns are structurally clean vs the original's committed grid, else `Pending` (the human
    confirms once). New sheets (and any sheet with no carryable config) stay `Pending` with no
    config. A mapped tab whose original is general-specs carries the designation into
    `general_specs_sheets` (keyed by the revision's OWN name, blank `preamble_text` -- it
    always re-extracts at parse), unless the human opted out (`general_specs: false`).

    Returns {"status": "saved", "seeded": <int>, "dispositions": [{"sheet_name", "status",
    "reasons", "dangling_roles", "description_set_changed"}, ...]} -- one dispositions entry per
    mapped DATA sheet (D5 diagnostics for surfacing a Pending sheet's dangling roles / config
    warning; the disposition itself rides wizard_status + the seeded sheet_config, no schema).
    """
    boq_doc = _load_revision(boq)
    if boq_doc.sheet_drafts:
        frappe.throw(
            "This revision's sheet mapping has already been confirmed.",
            title="Already confirmed",
        )

    if isinstance(mapping, str):
        mapping = frappe.parse_json(mapping)
    if not isinstance(mapping, list):
        frappe.throw("mapping must be a list of sheet entries.", title="Bad mapping")

    tab_names = _read_revised_tab_names(boq_doc.source_file_url)
    entries_by_name = {}
    for e in mapping:
        name = (e or {}).get("sheet_name")
        if name is None:
            frappe.throw("Each mapping entry needs a sheet_name.", title="Bad mapping")
        entries_by_name[name] = e

    # The mapping must cover EXACTLY the workbook's tabs (VERBATIM). A stale screen that saw a
    # different upload -- or a missing/undeclared tab -- is refused (this is the server side of
    # the "unmatched = hard stop" rule: every tab must have an explicit decision).
    missing = [t for t in tab_names if t not in entries_by_name]
    extra = [n for n in entries_by_name if n not in tab_names]
    if missing or extra:
        frappe.throw(
            "The mapping does not match the workbook's sheets "
            f"(missing: {missing}, unexpected: {extra}). Please reopen the mapping screen.",
            title="Mapping out of date",
        )

    committed = _original_committed_sheets(boq_doc.source_boq)
    valid_originals = {c["sheet_name"] for c in committed}
    gs_originals = {c["sheet_name"] for c in committed if c["general_specs"]}

    # Validate claims: EXPLICIT decision per tab (server-authoritative hard stop -- do NOT
    # trust the client gate alone) + strict 1:1 + every claimed original real. Each tab must be
    # EITHER mapped (`source_sheet_name` set) OR explicitly declared New (`declared_new` true);
    # a null source with no `declared_new` is UNDECIDED and is refused, so a stale/hand-crafted
    # POST can never silently seed everything as New (losing carry). Build the seed plan in
    # workbook tab order (authoritative `sheet_order`).
    claimed: dict[str, str] = {}  # original sheet_name -> the revised tab that claimed it
    for tab in tab_names:
        entry = entries_by_name[tab] or {}
        src = entry.get("source_sheet_name") or None
        if src is None:
            if not entry.get("declared_new"):
                frappe.throw(
                    f"Sheet '{tab}' has no decision -- map it to an original or declare it New.",
                    title="Undecided sheet",
                )
            continue  # explicitly declared New
        if src not in valid_originals:
            frappe.throw(
                f"Sheet '{tab}' is mapped to '{src}', which is not a committed sheet of the "
                "original.",
                title="Invalid mapping",
            )
        if src in claimed:
            frappe.throw(
                f"Two sheets both claim the original '{src}' "
                f"('{claimed[src]}' and '{tab}'). Each original may be mapped once.",
                title="Duplicate mapping",
            )
        claimed[src] = tab

    # S4 (D5): decide config carry + disposition for every mapped DATA sheet. A general-specs
    # source carries its designation (below), not a data config, so it is excluded here. The
    # SEED is the original's rectified role map for both dispositions; only the status differs
    # (clean -> Config Done, unsafe -> Pending). New sheets (src is None) are never in the map.
    source_by_tab = {
        tab: src
        for src, tab in claimed.items()
        if src not in gs_originals
    }
    carry_by_tab = carry_config_dispositions(
        boq_doc.source_boq, boq_doc.source_file_url, source_by_tab
    )

    # Seed. Append drafts + general-specs designations, then one save + commit.
    seeded = 0
    dispositions = []  # per mapped-data-sheet diagnostics (D5) -- returned, not persisted
    for idx, tab in enumerate(tab_names, start=1):
        entry = entries_by_name[tab] or {}
        src = entry.get("source_sheet_name") or None
        carry = carry_by_tab.get(tab)
        status = carry.status if carry else "Pending"
        config_json = carry.config_json if carry else None
        boq_doc.append(
            "sheet_drafts",
            {
                "sheet_name": tab,  # VERBATIM (#152)
                "sheet_order": idx,
                "wizard_status": status,  # Config Done for a clean matched data sheet, else Pending
                "sheet_config": config_json,  # rectified role map (mapped data sheet), else None
                "source_sheet_name": src,  # write-once cross-doc pointer (None for a New sheet)
            },
        )
        seeded += 1
        if carry:
            # Surface the diff diagnostics so the caller can flag a Pending sheet's dangling
            # roles / description-set change (D5's flag + config-time warning). Not persisted:
            # the disposition itself rides wizard_status + the seeded sheet_config (no schema).
            dispositions.append(
                {
                    "sheet_name": tab,
                    "status": status,
                    "reasons": carry.reasons,
                    "dangling_roles": carry.dangling_roles,
                    "description_set_changed": carry.description_set_changed,
                }
            )

        # Carry general-specs designation: only for a mapped tab whose original IS
        # general-specs, and only if the human did not opt out. Guard against a stale/bad
        # payload marking a data sheet general-specs (src must be in gs_originals).
        carry_gs = bool(src and src in gs_originals and entry.get("general_specs", True))
        if carry_gs:
            boq_doc.append(
                "general_specs_sheets",
                {
                    "source_sheet_name": tab,  # this doc's OWN name (#152), NOT the original's
                    "preamble_text": "",  # always re-extracts at parse
                },
            )

    boq_doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"status": "saved", "seeded": seeded, "dispositions": dispositions}
