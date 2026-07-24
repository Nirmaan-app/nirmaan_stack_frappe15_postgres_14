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

from nirmaan_stack.api.boq.wizard.revision_carry import (
    carry_config_dispositions,
    carry_work_packages,
    read_committed_work_packages,
)
from nirmaan_stack.integrations.controllers.boqs import next_boq_version
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


def _assert_entry_still_convertible(boq_doc) -> None:
    """Guard `convert_revision_entry`: the BoQ must still be at the ENTRY stage (A1 / W3).

    Converting rewrites `boq_name` (a revision reuses the original's), `version`, `origin`,
    `source_boq` and the seeded drafts. That is safe while the user is still on the upload
    screen and nothing downstream exists; it is destructive the moment real work has landed.
    So conversion is refused once ANY of these is true -- each with its own message, because
    "you can't do that" without a reason is useless on a screen with one button:

      * a template SOURCE (ADR-0013 A1) -- never a revision, in either direction;
      * anything committed -- the committed tier is keyed by this BoQ and would be orphaned;
      * any sheet parsed or parsing -- review rows exist and are keyed to the draft set;
      * a revision whose sheet mapping is already CONFIRMED -- `source_sheet_name` is
        write-once by design (D3) and the escape hatch is delete + re-upload, not a remap.
    """
    if boq_doc.get("is_template_source"):
        frappe.throw(
            "A template-source BoQ cannot be converted to or from a revision.",
            title="Not convertible",
        )
    if frappe.db.exists("BoQ Committed Sheet Grid", {"boq": boq_doc.name, "is_current": 1}):
        frappe.throw(
            "This BoQ already has committed sheets. Changing its type now would orphan them.",
            title="Already committed",
        )
    for draft in boq_doc.sheet_drafts or []:
        if draft.has_prior_parse or draft.parse_in_progress:
            frappe.throw(
                "This BoQ has already been parsed. Changing its type now would discard the "
                "parsed rows -- delete it and upload again instead.",
                title="Already parsed",
            )
    if boq_doc.origin == "revision" and boq_doc.sheet_drafts:
        frappe.throw(
            "This revision's sheet mapping has already been confirmed and cannot be undone. "
            "Delete it and upload again instead.",
            title="Mapping confirmed",
        )


def _uploaded_file_base_name(boq_doc, file_name: str = None) -> str:
    """The BoQ name a FRESH upload would have derived from this file (strip ext, `_` -> ` ').

    Mirrors `_upload_file_worker` step 4 exactly, so converting Revise -> New restores precisely
    the name the same file would have produced had it been dropped as a New BoQ.

    ⚠️ `file_name` is the CLIENT's original filename and is the only exact source. The stored
    `File` row is NOT reliable for this: Frappe UNIQUIFIES a colliding filename on save (a second
    `my_boq_file.xlsx` becomes `my_boq_filef57551.xlsx`), while the upload worker derived the BoQ
    name from the un-uniquified name it was handed. Reading the File row back would therefore
    reproduce the hash suffix -- observed in test. The upload screen holds the true name in its
    store (`droppedFile.name`) for the whole session, so it passes it.

    Fallbacks, in order, for a direct API call that omits it: the `File` row's name, then the
    URL basename. Both may carry the suffix; the field is user-editable, so a slightly-off name
    beats throwing.
    """
    if not file_name:
        file_name = frappe.db.get_value(
            "File", {"file_url": boq_doc.source_file_url}, "file_name"
        )
    if not file_name:
        file_name = (boq_doc.source_file_url or "").rsplit("/", 1)[-1]
    base = os.path.splitext(file_name or "")[0]
    return base.replace("_", " ") or boq_doc.boq_name


@frappe.whitelist(methods=["POST"])
def convert_revision_entry(
    boq: str, mode: str, source_boq: str = None, file_name: str = None
) -> dict:
    """Flip a just-uploaded BoQ between New and Revision, in BOTH directions (ADR-0014 A1 / W3).

    Why this exists: `origin` / `source_boq` are baked at insert, so the New|Revise radio used to
    freeze the moment the file dropped -- and the lock was pure frontend (`BoqMasterPanel`'s
    `entryLocked`); the server never enforced it. A user who picked wrong had to delete and start
    over. The upload cannot simply be deferred until Continue, either: `fillFromParse` populates
    BoQ Name / Version / GST from the PARSED doc and `confirmedFields` on those three gate
    Continue, so the parse must precede Continue by construction.

    `mode`:
      * `"revise"` -- requires `source_boq`; re-validates it through `assert_revisable_source`,
        adopts the original's `boq_name`, and DROPS the seeded drafts (an unconfirmed revision is
        marked by exactly `origin=="revision"` AND empty `sheet_drafts` -- S2's emergent marker,
        which `confirm_revision_mapping` then seeds against).
      * `"new"` -- clears `source_boq`, restores the filename-derived `boq_name`, and RE-SEEDS the
        drafts from the workbook via the same `append_sheet_drafts` / `prefill_sheet_configs` the
        upload worker uses (one implementation, so the two paths cannot drift). `file_name` is the
        client's ORIGINAL filename (the upload screen keeps it in its store) and is the only exact
        source for that name -- see `_uploaded_file_base_name` for why the stored File row is not.

    ⚠️ The version is RECOMPUTED through the shared `controllers.boqs.next_boq_version`, because
    `before_insert` already ran against the OLD `boq_name` and the scope has changed underneath
    it. It passes `exclude=boq` -- this doc already exists and already holds a version, so
    counting itself would bump the number on every conversion, forever.

    Idempotent: converting to the mode it is already in re-validates and returns without writing.

    Returns {"status": "saved", "origin", "source_boq", "boq_name", "version", "seeded"}.
    """
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if mode not in ("new", "revise"):
        frappe.throw("mode must be 'new' or 'revise'.", title="Bad mode")
    if not frappe.db.exists("BOQs", boq):
        frappe.throw(f"BoQ '{boq}' not found.", title="Not found")

    boq_doc = frappe.get_doc("BOQs", boq)
    _assert_entry_still_convertible(boq_doc)

    already_revision = boq_doc.origin == "revision"
    if mode == "revise":
        if not source_boq:
            frappe.throw(
                "Pick the BoQ to revise.", title="Missing field: source_boq"
            )
        # Server-authoritative re-validation -- a stale picker or a hand-crafted request can
        # never create a revision against an ineligible original (the D1 rule, one owner).
        assert_revisable_source(source_boq, boq_doc.project)
        if already_revision and boq_doc.source_boq == source_boq:
            return _entry_state(boq_doc, seeded=len(boq_doc.sheet_drafts or []))
        boq_doc.origin = "revision"
        boq_doc.source_boq = source_boq
        boq_doc.boq_name = frappe.db.get_value("BOQs", source_boq, "boq_name")
    else:
        if not already_revision:
            return _entry_state(boq_doc, seeded=len(boq_doc.sheet_drafts or []))
        boq_doc.origin = "upload"
        boq_doc.source_boq = None
        boq_doc.boq_name = _uploaded_file_base_name(boq_doc, file_name)

    boq_doc.version = next_boq_version(
        boq_doc.project, boq_doc.boq_name, is_template_source=False, exclude=boq
    )

    # Re-seed the drafts to match the new mode. Grandchild work-package rows do NOT cascade off
    # a parent save, so drop them explicitly before clearing their parents (CLAUDE.md's
    # grandchild-serialization rule cuts both ways: they are invisible to the ORM here too).
    for draft in boq_doc.sheet_drafts or []:
        frappe.db.delete(
            "BoQ Sheet Work Package", {"parent": draft.name, "parenttype": "BoQ Sheet Draft"}
        )
    boq_doc.set("sheet_drafts", [])
    boq_doc.set("general_specs_sheets", [])

    reader = None
    worker_tmp = None
    if mode == "new":
        # Re-read the workbook to seed exactly what a fresh upload would have. S3 safety: bytes
        # via the tempfile pattern, NEVER a local path built from `file_url`.
        # Function-level imports: `upload_file` imports THIS module (`assert_revisable_source`),
        # so a module-level import back would be a cycle -- same reason `_read_revised_tab_names`
        # imports `sheet_preview` locally.
        from nirmaan_stack.api.boq.wizard.sheet_preview import (  # noqa: PLC0415
            _fetch_boq_file_to_tempfile,
        )
        from nirmaan_stack.api.boq.wizard.upload_file import (  # noqa: PLC0415
            append_sheet_drafts,
            prefill_sheet_configs,
        )
        from nirmaan_stack.services.boq_parser.reader import BoqReader  # noqa: PLC0415

        worker_tmp = _fetch_boq_file_to_tempfile(boq_doc.source_file_url)
        try:
            reader = BoqReader(worker_tmp)
            sheets = reader.list_sheets()
            append_sheet_drafts(boq_doc, reader, sheets)
            boq_doc.save(ignore_permissions=True)
            prefill_sheet_configs(boq_doc, reader)
        finally:
            try:
                os.remove(worker_tmp)
            except OSError:
                pass
    else:
        boq_doc.save(ignore_permissions=True)

    frappe.db.commit()
    return _entry_state(boq_doc, seeded=len(boq_doc.sheet_drafts or []))


def _entry_state(boq_doc, seeded: int) -> dict:
    """The convert endpoint's return envelope -- the entry fields the upload screen re-reads."""
    return {
        "status": "saved",
        "origin": boq_doc.origin,
        "source_boq": boq_doc.source_boq,
        "boq_name": boq_doc.boq_name,
        "version": boq_doc.version,
        "seeded": seeded,
    }


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
           "uploaded_at": str | None,   # as Frappe returns the Datetime; latest first
           "origin": str | None},       # raw BOQs.origin -- drives the picker's Type badge
        ...]}

    `origin` is returned RAW (never normalised here): because chains are allowed this list
    mixes originals, revisions and template-born BoQs, and the frontend maps the value to the
    same Type badge the BoQ list shows. A blank means a row predating the field.
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
        fields=["name", "boq_name", "version", "uploaded_at", "origin"],
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
            "origin": b.origin,
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


def _carry_counts(source_boq: str, source_sheet_names) -> dict:
    """COUNTs for the Zone-1 F2 signal -- what will ACTUALLY carry. NO parse.

    Amendment B W6 rewrote this on BOTH axes; it previously over-reported rates and measured the
    wrong field for classifications, so the screen promised work that landed nowhere.

    * SCOPE. `source_sheet_names` is the set of ORIGINAL sheets a revised tab actually claims
      (the mapping screen's proposed pairing; general-specs sources excluded by the caller). An
      unclaimed original carries NOTHING, so counting it is a lie. General-specs sources drop out
      structurally too -- they have a committed grid row but no `BoQ Sheet` / `BOQ Nodes`.
    * RATES. Read through the SAME version-pinned `get_sheet_pricing` the carry itself uses (each
      claimed source sheet at its CURRENT committed version), so the number and the behaviour
      cannot drift, and count only `is_filled` cells -- an unfilled current row is a cleared price
      and copies nothing. (The old count was version-blind AND sheet-blind AND counted cleared
      cells.)
      ⚠️ AMENDMENT C (2026-07-23) pinned this read alongside the carry's, REVERSING W6's
      cross-version reader. The count==carry invariant W6 established is preserved -- both sides
      simply moved to the pinned side together. Never pin one without the other: that divergence
      IS the defect W6 was written for (the screen promising rates the carry cannot land).
    * CLASSIFICATIONS. `row_class`, the committed EFFECTIVE value the carry copies (see
      `review_carry._NODE_FIELDS`). `human_classification` holds only the manually-typed layer
      and misses every AI-accepted decision, so it was never what carries.

    Both remain the honest "how much human work exists on the original" numbers that DIFFER
    between the right and a wrong original -- the F2 control.
    """
    from nirmaan_stack.api.boq.wizard import pricing  # noqa: PLC0415 (avoid an import cycle)

    sheet_names = list(source_sheet_names or [])
    if not sheet_names:
        return {"rates": 0, "classifications": 0}

    # The claimed sheets' CURRENT committed BoQ Sheet rows -- ONE query serving BOTH counts, so the
    # rate count and the classification count are anchored to the same committed version the carry
    # itself reads. A sheet with no current committed row (never committed, or a general-specs
    # source with no BoQ Sheet at all) is absent here and contributes 0 to both.
    current_sheets = frappe.get_all(
        "BoQ Sheet",
        filters={"boq": source_boq, "sheet_name": ["in", sheet_names], "is_current": 1},
        fields=["name", "sheet_name", "commit_version"],
    )

    rates = 0
    for s in current_sheets:  # sheet_name VERBATIM (#152)
        rates += sum(
            1
            for p in pricing.get_sheet_pricing(
                boq_name=source_boq,
                sheet_name=s.sheet_name,
                committed_version=s.commit_version,
            )["pricing"]
            if p.get("is_filled")
        )

    # BOQ Nodes.sheet is a Link to BoQ Sheet, so scope by the claimed sheets' CURRENT committed
    # BoQ Sheet docnames. A general-specs source has no BoQ Sheet row at all -> naturally absent.
    sheet_docnames = [s.name for s in current_sheets]
    classifications = (
        frappe.db.count(
            "BOQ Nodes",
            {
                "boq": source_boq,
                "sheet": ["in", sheet_docnames],
                "is_current": 1,
                "row_class": ["!=", ""],
            },
        )
        if sheet_docnames
        else 0
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

    # W6: scope the carry counts to the originals a revised tab actually CLAIMS, minus the
    # general-specs sources (which carry a designation, never rates or classifications). The
    # drafts do not exist yet on this screen (an unconfirmed revision has empty `sheet_drafts`),
    # so the PROPOSED pairing is the scope -- the same set `confirm_revision_mapping` will stamp
    # unless the human re-points a row.
    gs_originals = {c["sheet_name"] for c in committed if c["general_specs"]}
    claimed_data_sources = {
        p.proposed_source
        for p in proposal.pairings
        if p.proposed_source and p.proposed_source not in gs_originals
    }

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
        "carry_counts": _carry_counts(source_boq, claimed_data_sources),
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


def _prefill_new_sheet_configs(boq_doc, new_tabs) -> None:
    """Auto-guess `sheet_config` for the revision's declared-New tabs. Call AFTER the save.

    WHY THIS EXISTS. A MAPPED tab is seeded from the original's rectified role map (S4/D5) --
    a better seed than any guess. A NEW tab has no original, and before this it got nothing at
    all: the fresh-upload auto-guess runs inside `_upload_file_worker`, which deliberately seeds
    NO drafts for a revision (empty `sheet_drafts` IS the unconfirmed-revision marker), so the
    `prefill_sheet_configs` call there iterates an empty list, and the open workbook `reader`
    dies with the worker. Drafts are then born HERE, in a later request with no reader -- so a
    New sheet opened its config screen blank while a fresh upload of the same workbook
    auto-detected everything. The guess runs here instead, through the SAME shared
    `prefill_sheet_configs` the upload worker uses (one implementation, so the paths cannot
    drift).

    ⚠️ SCOPED to `new_tabs`, and the scoping is load-bearing: under A2 every revised draft is
    `Pending`, so an unfiltered call would overwrite every MAPPED sheet's carried role map.

    Work packages are deliberately NOT carried onto a New tab (owner call, 2026-07-22): there is
    no original to carry from, so it stays a manual pick on the config screen.

    Best-effort. The drafts are already saved and the caller is about to commit, so a workbook
    fetch/read failure degrades to the old behaviour (New tab configured by hand) rather than
    rolling back the whole confirm. Per-sheet failure is already isolated inside
    `prefill_sheet_configs`.
    """
    if not new_tabs:
        return
    # Function-level imports: `upload_file` imports THIS module (`assert_revisable_source`), so a
    # module-level import back would be a cycle -- same reason `_read_revised_tab_names` and
    # `convert_revision_entry` import locally.
    from nirmaan_stack.api.boq.wizard.sheet_preview import (  # noqa: PLC0415
        _fetch_boq_file_to_tempfile,
    )
    from nirmaan_stack.api.boq.wizard.upload_file import (  # noqa: PLC0415
        prefill_sheet_configs,
    )
    from nirmaan_stack.services.boq_parser.reader import BoqReader  # noqa: PLC0415

    worker_tmp = None
    try:
        # S3 safety: bytes via the tempfile pattern, NEVER a local path built from `file_url`.
        worker_tmp = _fetch_boq_file_to_tempfile(boq_doc.source_file_url)
        prefill_sheet_configs(boq_doc, BoqReader(worker_tmp), only_sheet_names=new_tabs)
    except Exception:
        frappe.logger("boq_revision").warning(
            f"revised-BoQ {boq_doc.name}: could not auto-guess config for new sheets "
            f"{sorted(new_tabs)}; they stay blank for manual config",
            exc_info=True,
        )
    finally:
        if worker_tmp:
            try:
                os.remove(worker_tmp)
            except OSError:
                pass


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
    `sheet_order`, `source_sheet_name` stamped write-once on mapped tabs. S4 (D5) seeds each
    mapped DATA sheet with the original's rectified `column_role_map` (`sheet_config`); a
    declared-NEW tab has no original to seed from, so it gets the fresh-upload AUTO-GUESS
    instead (`_prefill_new_sheet_configs` -- see there for why the upload worker's own call
    cannot cover it). Work packages are carried onto MAPPED tabs only.

    ⚠️ `wizard_status` is **always `Pending`** (Amendment B W4 / A2). It used to be `Config Done`
    for a structurally clean sheet, which meant a revision could reach parse with nobody having
    looked at its config. A clean column diff is now reported as a DIAGNOSIS in `dispositions[]`
    and nothing more -- the human attests every revised sheet exactly once. The original's
    `work_packages` are carried onto each mapped draft alongside, because the attestation
    checkbox is disabled without one.

    A mapped tab whose original is general-specs carries the designation into
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
    # SEED is the original's rectified role map either way; the diff only decides the DIAGNOSIS
    # reported in `dispositions[]` (W4: the persisted status is always Pending). New sheets
    # (src is None) are never in the map.
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
        # TWO different values, deliberately split (W4 / A2). `disposition_status` is the honest
        # column-diff DIAGNOSIS ("Config Done" = structurally clean vs the original) and is what
        # the returned `dispositions[]` reports. The PERSISTED `wizard_status` is ALWAYS "Pending":
        # the owner's call is that a revision's config is confirmed by a human ONCE, per sheet, even
        # when the diff is clean -- a clean diff is evidence, not consent. Do NOT re-collapse these
        # into one variable; `test_dispositions_clean_sheet_no_flags` is the control that proves the
        # diagnosis survives the forced status.
        disposition_status = carry.status if carry else "Pending"
        config_json = carry.config_json if carry else None
        boq_doc.append(
            "sheet_drafts",
            {
                "sheet_name": tab,  # VERBATIM (#152)
                "sheet_order": idx,
                "wizard_status": "Pending",  # ALWAYS -- the human attests every revised sheet (A2)
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
                    "status": disposition_status,
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

    # W4 (A2): carry the original's work packages onto the seeded drafts. This runs AFTER the save
    # because the target is a GRANDCHILD table (`BoQ Sheet Draft.work_packages`) whose parent row
    # only gets a real docname on save -- it cannot ride the `append` above.
    #
    # Not optional, and not cosmetic: every sheet now lands `Pending`, and the Config-Done
    # attestation checkbox is disabled until the sheet has >= 1 work package. Without this carry
    # a revision could never be attested, parsed (`canParse` needs >= 1 marked sheet) or committed.
    # A mapped general-specs source has no `BoQ Sheet` row, so it contributes nothing here.
    wp_by_source = read_committed_work_packages(boq_doc.source_boq, set(claimed))
    if wp_by_source:
        source_by_draft_tab = {tab: src for src, tab in claimed.items()}
        for draft in boq_doc.sheet_drafts:
            src_sheet = source_by_draft_tab.get(draft.sheet_name)  # VERBATIM (#152)
            if src_sheet:
                carry_work_packages(draft.name, wp_by_source.get(src_sheet))

    # A declared-New tab has no original to seed from, so it gets the fresh-upload AUTO-GUESS
    # instead -- the upload worker's own call is a no-op for a revision (it seeds no drafts), and
    # nothing else ever ran it. Derived from the VALIDATED state (`claimed`), not re-read from the
    # payload: every tab is by now provably either mapped or explicitly declared New.
    _prefill_new_sheet_configs(boq_doc, set(tab_names) - set(claimed.values()))

    frappe.db.commit()
    return {"status": "saved", "seeded": seeded, "dispositions": dispositions}
