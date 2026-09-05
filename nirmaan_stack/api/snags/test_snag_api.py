"""Tests for the Snag List API layer.

SCOPE: this suite tests the API layer ONLY -- orchestration, permissions, duplicate
flagging, per-sheet isolation, the document-layer delete, and the status stamp. The pure
workbook parser (`services/snag_parser/`) is stubbed through the FOUR seams in
`import_wizard` (`_reader` / `_parser` / `_guess` / `_load_grid`), so these tests never open
a real workbook: parser behaviour has
its own unit tests against its own fixture, and duplicating it here would only couple two
suites to one another.

The suite runs against the LIVE localhost site, so every row it creates is deleted in
tearDownClass, including the `Deleted Document` rows the delete test deliberately produces.
"""

import os
import tempfile

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.snags import import_wizard, tracking


#: Column labels the stub reader recomputes for a header row. Keyed by header row, so a
#: test can prove the labels FOLLOW the header row the parse actually used.
_COLUMNS_BY_HEADER_ROW = {
    7: [{"letter": "B", "label": "Area / Location"}, {"letter": "D", "label": "Snag Description"}],
    # A row that HAS columns but is not header-shaped -- the labels are the data cells of a
    # body row. This is the (A) case from Revision 3 R3.1, taken from the owner's real
    # workbook: real columns, `mapping_guess: null`, and the exact state that used to wedge
    # the client into a permanent deadlock.
    8: [
        {"letter": "A", "label": "1"},
        {"letter": "B", "label": "Food Box - General"},
        {"letter": "C", "label": "Fire & Life Safety"},
    ],
    54: [{"letter": "B", "label": "Zone"}, {"letter": "D", "label": "Observation"}],
}

#: The header row the stub reader auto-detects when the caller sends no override -- the
#: stand-in for `reader.find_header_row`.
_STUB_AUTO_HEADER_ROW = 7


class _StubReader:
    """Stands in for `services.snag_parser.reader`."""

    def __init__(self, sheets):
        self._sheets = sheets

    def inspect_workbook(self, path):  # noqa: ARG002 - path unused by the stub
        return self._sheets

    def columns_for_header_row(self, grid, header_row):  # noqa: ARG002 - grid unused by the stub
        """The real one reads that row's cells; the stub keys off the row number alone."""
        return _COLUMNS_BY_HEADER_ROW.get(header_row, [])

    def find_header_row(self, grid):  # noqa: ARG002 - grid unused by the stub
        """The real one scans for the first header-looking row."""
        return _STUB_AUTO_HEADER_ROW


class _StubGuess:
    """Stands in for `services.snag_parser.guess`."""

    #: A label containing one of these makes the stub believe it found a description
    #: column. The REAL `guess_mapping` returns None when it cannot find one, and that
    #: null is half of the R3.1 deadlock -- so the stub has to be able to produce it for
    #: a column list that is otherwise perfectly real.
    _DESCRIPTION_HINTS = ("desc", "observ", "snag")

    def guess_mapping(self, columns):
        # Enough to prove the re-guess ran against the RECOMPUTED columns: the guess is
        # derived from the labels it was handed, so a different header row yields a
        # different guess.
        if not columns:
            return None
        if not any(
            hint in (c.get("label") or "").lower()
            for c in columns
            for hint in self._DESCRIPTION_HINTS
        ):
            # No description column -> no mapping, exactly like the real guess.
            return None
        return {
            "area": columns[0]["letter"],
            "category": None,
            "description": columns[-1]["letter"],
            "remarks": None,
            # Not part of SnagColumnMapping -- a probe so a test can see WHICH labels the
            # re-guess was fed without reaching into the stub.
            "_labels": [c["label"] for c in columns],
        }


class _StubParser:
    """Stands in for `services.snag_parser.parser`.

    A sheet mapped to an Exception instance RAISES -- that is how the per-sheet failure
    isolation test manufactures one bad sheet beside one good one.

    `by_sheet` may map a sheet to a dict of {header_row: parsed} instead of one parsed
    result, which is how the header-row tests prove the argument reaches the parse.
    """

    #: Every (sheet_name, header_row) this stub was asked for, in call order. The
    #: header-row tests assert against it -- otherwise "it was threaded" is unfalsifiable.
    def __init__(self, by_sheet):
        self._by_sheet = by_sheet
        self.calls = []

    def parse_sheet(self, path, sheet_name, mapping, header_row=None):  # noqa: ARG002
        self.calls.append((sheet_name, header_row))
        result = self._by_sheet.get(sheet_name)
        if result is None:
            raise ValueError(f"Sheet '{sheet_name}' is not in the workbook.")
        if isinstance(result, Exception):
            raise result
        if isinstance(result, dict) and "rows" not in result:
            # A per-header-row map. `None` means the caller did not override, so the stub
            # falls back to its lowest key -- standing in for the parser's own guess, which
            # is the topmost header row it finds. An unlisted header row is a region with
            # no snags in it.
            key = header_row if header_row is not None else min(result)
            result = result.get(key, _parsed([], header_row=key))
        # The real parser echoes the sheet it was asked for, and reports the header row it
        # actually used -- the override, or its own guess.
        used = header_row if header_row is not None else result.get("header_row")
        return {**result, "sheet_name": sheet_name, "header_row": used}


def _parsed(rows, header_row=7):
    """One MERGED list, accepted and skipped interleaved in Excel row order."""
    accepted = [r for r in rows if not r.get("skipped_reason")]
    return {
        "sheet_name": None,
        "header_row": header_row,
        "rows": rows,
        "accepted_count": len(accepted),
        "skipped_count": len(rows) - len(accepted),
        "distinct_areas": [],
        "distinct_categories": [],
    }


def _row(
    source_row,
    area,
    description,
    category="Civil",
    remark="",
    skipped_reason=None,
    tickable=None,
    preview_text="",
    serial="",
):
    """A parser row. `tickable` defaults to the parser's rule: False iff no description."""
    return {
        "source_row": source_row,
        "area": area,
        "category": category,
        "description": description,
        "remark": remark,
        #: The sheet's OWN S.No, "" when it did not number this row. The parser never
        #: invents one -- `_serials_for` does, at ingest.
        "serial": serial,
        "skipped_reason": skipped_reason,
        "tickable": bool(description.strip()) if tickable is None else tickable,
        "preview_text": preview_text,
    }


#: `serial` is part of the mapping the API coerces and stores on the batch, so it belongs
#: here even when a test's sheet has no S.No column: `_coerce_mapping` fills every key.
_MAPPING = {"area": "B", "category": "C", "description": "D", "remarks": "G", "serial": "A"}


class TestSnagApi(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = frappe.new_doc("Projects")
        cls.test_project.project_name = f"TEST_snag_{frappe.generate_hash(length=6)}"
        cls.test_project.project_start_date = frappe.utils.now()[:19]
        cls.test_project.project_end_date = frappe.utils.add_to_date(
            frappe.utils.now()[:19], years=1
        )[:19]
        cls.test_project.project_scopes = {"scopes": []}
        cls.test_project.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.project = cls.test_project.name

        # A real file on disk standing in for the stored workbook. `_fetch_file_to_tempfile`
        # treats a bare absolute path as a local/dev path and copies it, so the fetch is
        # exercised for real even though the stubbed parser never reads the bytes.
        tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        tmp.write(b"not-a-real-workbook")
        tmp.close()
        cls.file_url = tmp.name

    @classmethod
    def tearDownClass(cls):
        try:
            os.unlink(cls.file_url)
        except OSError:
            pass

        snag_names = frappe.get_all(
            "Project Snag", filters={"project": cls.project}, pluck="name", limit_page_length=0
        )
        for name in snag_names:
            frappe.delete_doc("Project Snag", name, force=True, ignore_permissions=True)

        for name in frappe.get_all(
            "Project Snag Batch",
            filters={"project": cls.project},
            pluck="name",
            limit_page_length=0,
        ):
            frappe.delete_doc("Project Snag Batch", name, force=True, ignore_permissions=True)

        # The delete test deliberately produces `Deleted Document` rows; clear the ones we caused.
        for name in frappe.get_all(
            "Deleted Document",
            filters={"deleted_doctype": ("in", ["Project Snag", "Project Snag Batch"])},
            fields=["name", "deleted_name"],
            limit_page_length=0,
        ):
            if name.deleted_name in cls._created_names:
                frappe.delete_doc(
                    "Deleted Document", name.name, force=True, ignore_permissions=True
                )

        frappe.delete_doc("Projects", cls.project, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    #: Every Snag / Batch name this suite mints, so tearDownClass can find the
    #: `Deleted Document` rows it caused without touching anyone else's.
    _created_names = set()

    def setUp(self):
        frappe.set_user("Administrator")

    def tearDown(self):
        frappe.set_user("Administrator")

    # -- helpers ---------------------------------------------------------------

    def _install_parser(self, by_sheet, sheets=None):
        """Point the import wizard's parser seams at stubs for this test only.

        FOUR seams: `_reader`, `_parser`, `_guess` and `_load_grid`. The last one is the
        module's only openpyxl touch -- the fixture on disk is not a real workbook, so a
        live `load_workbook` would raise before any of this suite's assertions ran.
        Returns the stub parser so a test can inspect the arguments it was called with.
        """
        stub_reader = _StubReader(sheets or [])
        stub_parser = _StubParser(by_sheet)
        stub_guess = _StubGuess()
        originals = (
            import_wizard._reader,
            import_wizard._parser,
            import_wizard._guess,
            import_wizard._load_grid,
        )
        import_wizard._reader = lambda: stub_reader
        import_wizard._parser = lambda: stub_parser
        import_wizard._guess = lambda: stub_guess
        import_wizard._load_grid = lambda path, sheet_name: []

        def restore():
            (
                import_wizard._reader,
                import_wizard._parser,
                import_wizard._guess,
                import_wizard._load_grid,
            ) = originals

        self.addCleanup(restore)
        return stub_parser

    def _ingest(self, entries, by_sheet):
        self.stub_parser = self._install_parser(by_sheet)
        result = import_wizard.ingest_batches(
            project=self.project,
            file_url=self.file_url,
            file_name="snags.xlsx",
            batches=entries,
        )
        for entry in result["results"]:
            if entry.get("batch"):
                type(self)._created_names.add(entry["batch"])
        for name in frappe.get_all(
            "Project Snag", filters={"project": self.project}, pluck="name", limit_page_length=0
        ):
            type(self)._created_names.add(name)
        return result

    def _one_sheet(self, sheet="Sheet1", batch_name="Batch A", rows=None):
        rows = rows or [
            _row(8, "Kitchen", "Leaking tap"),
            _row(9, "Lobby", "Cracked tile"),
            _row(10, "Roof", "Missing sealant"),
        ]
        entry = {
            "sheet_name": sheet,
            "batch_name": batch_name,
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [r["source_row"] for r in rows],
        }
        return self._ingest([entry], {sheet: _parsed(rows)})

    # -- ingest ----------------------------------------------------------------

    def test_ingest_creates_one_batch_and_n_snags_all_pending(self):
        result = self._one_sheet()

        self.assertEqual(result["failed_count"], 0)
        self.assertEqual(result["total_imported"], 3)
        self.assertEqual(len(result["results"]), 1)

        entry = result["results"][0]
        self.assertTrue(entry["ok"])
        self.assertEqual(entry["imported"], 3)
        self.assertEqual(entry["batch_name"], "Batch A")
        # Reported on every ok result, 0 included.
        self.assertEqual(entry["refused_no_description"], 0)

        batch = frappe.get_doc("Project Snag Batch", entry["batch"])
        self.assertEqual(batch.snag_count, 3)
        self.assertEqual(batch.source_sheet, "Sheet1")
        self.assertEqual(batch.source_file, self.file_url)
        self.assertEqual(batch.uploaded_by, "Administrator")
        self.assertEqual(frappe.parse_json(batch.column_mapping), _MAPPING)

        rows = frappe.get_all(
            "Project Snag",
            filters={"batch": entry["batch"]},
            fields=["status", "source_row", "description", "remark"],
            limit_page_length=0,
        )
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r.status == "Pending" for r in rows))
        self.assertEqual(sorted(r.source_row for r in rows), [8, 9, 10])
        # `comments` is GONE (ADR-0018) -- the one remark field arrives empty here because
        # the fixture rows carry no source text.
        self.assertTrue(all(not r.remark for r in rows))
        self.assertFalse(frappe.db.has_column("Project Snag", "comments"))

    # -- S.No (`source_serial`) ------------------------------------------------

    def test_the_sheets_own_s_no_is_stored_verbatim(self):
        """A consultant's numbering is kept EXACTLY -- including one that is not a number.

        This is why the field is `Data`: coercing "1.1" or "A-3" to an Int would either
        lose the number or refuse the import, and a snag has to be quotable back to the
        consultant by the label they gave it.
        """
        rows = [
            _row(8, "Kitchen", "Leaking tap", serial="1.1"),
            _row(9, "Lobby", "Cracked tile", serial="A-3"),
            _row(10, "Roof", "Missing sealant", serial="  7  "),
        ]
        result = self._one_sheet(sheet="Serials", batch_name="Serial batch", rows=rows)

        stored = frappe.get_all(
            "Project Snag",
            filters={"batch": result["results"][0]["batch"]},
            fields=["source_row", "source_serial"],
            limit_page_length=0,
        )
        self.assertEqual(
            {r.source_row: r.source_serial for r in stored},
            {8: "1.1", 9: "A-3", 10: "7"},
        )

    def test_a_sheet_with_no_s_no_column_is_numbered_by_position_in_the_batch(self):
        """No S.No anywhere -> every row takes its 1-based position in THIS batch.

        The position is the batch's, not the Excel row's: a sheet whose snags start at
        row 8 must still read 1, 2, 3.
        """
        result = self._one_sheet(sheet="Unnumbered", batch_name="Unnumbered batch")

        stored = frappe.get_all(
            "Project Snag",
            filters={"batch": result["results"][0]["batch"]},
            fields=["source_row", "source_serial"],
            limit_page_length=0,
        )
        self.assertEqual(
            {r.source_row: r.source_serial for r in stored},
            {8: "1", 9: "2", 10: "3"},
        )

    def test_a_blank_cell_takes_its_position_and_never_collides_with_a_real_s_no(self):
        """The counter walks the WHOLE batch, so a filled row and a blank one cannot
        both claim the same number.

        Counting only the unnumbered rows would give row 9 the number "1" while row 8
        already holds "1" -- two snags in one batch quoting the same S.No.
        """
        rows = [
            _row(8, "Kitchen", "Leaking tap", serial="1"),
            _row(9, "Lobby", "Cracked tile", serial="   "),
            _row(10, "Roof", "Missing sealant", serial="3"),
        ]
        result = self._one_sheet(sheet="Gappy", batch_name="Gappy batch", rows=rows)

        stored = frappe.get_all(
            "Project Snag",
            filters={"batch": result["results"][0]["batch"]},
            fields=["source_row", "source_serial"],
            limit_page_length=0,
        )
        by_row = {r.source_row: r.source_serial for r in stored}
        self.assertEqual(by_row, {8: "1", 9: "2", 10: "3"})
        self.assertEqual(len(set(by_row.values())), 3, "S.No collided inside one batch")

    def test_every_imported_snag_gets_an_s_no_even_a_re_ticked_skipped_row(self):
        """A row the parser skipped still imports when ticked (ADR-0019) -- and it is a
        row like any other, so it is numbered like one."""
        rows = [
            _row(8, "Kitchen", "Leaking tap", serial="1"),
            _row(9, "", "", skipped_reason="blank", preview_text="RISK SUMMARY"),
        ]
        entry = {
            "sheet_name": "Reticked",
            "batch_name": "Reticked batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [8, 9],
        }
        result = self._ingest([entry], {"Reticked": _parsed(rows)})

        stored = frappe.get_all(
            "Project Snag",
            filters={"batch": result["results"][0]["batch"]},
            fields=["source_row", "source_serial"],
            limit_page_length=0,
        )
        self.assertEqual({r.source_row: r.source_serial for r in stored}, {8: "1", 9: "2"})
        self.assertTrue(all(r.source_serial for r in stored), "an imported snag with no S.No")

    def test_a_manual_snag_has_no_s_no(self):
        """Nothing invents a number outside an import: `source_serial` is provenance, and
        a hand-added snag has no sheet to have come from."""
        payload = tracking.add_manual_snag(
            project=self.project, area="Kitchen", category="Civil", description="Hand added"
        )
        type(self)._created_names.add(payload["name"])
        self.assertFalse(frappe.db.get_value("Project Snag", payload["name"], "source_serial"))

    def test_ingest_writes_the_source_remark_onto_the_one_remark_field(self):
        rows = [_row(8, "Kitchen", "Leaking tap", remark="Consultant: urgent, re-check 20th")]
        entry = {
            "sheet_name": "Remarks",
            "batch_name": "Remarks batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [8],
        }
        result = self._ingest([entry], {"Remarks": _parsed(rows)})
        snag = frappe.get_all(
            "Project Snag", filters={"batch": result["results"][0]["batch"]}, pluck="name"
        )[0]
        self.assertEqual(
            frappe.db.get_value("Project Snag", snag, "remark"),
            "Consultant: urgent, re-check 20th",
        )

    def test_ingest_imports_only_accepted_rows(self):
        rows = [_row(8, "Kitchen", "A"), _row(9, "Lobby", "B"), _row(10, "Roof", "C")]
        entry = {
            "sheet_name": "Picky",
            "batch_name": "Picky batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [8, 10],
        }
        result = self._ingest([entry], {"Picky": _parsed(rows)})

        self.assertEqual(result["total_imported"], 2)
        got = frappe.get_all(
            "Project Snag",
            filters={"batch": result["results"][0]["batch"]},
            pluck="source_row",
            limit_page_length=0,
        )
        self.assertEqual(sorted(got), [8, 10])

    def test_per_sheet_failure_isolation(self):
        """One bad sheet must not take the good one down with it."""
        entries = [
            {
                "sheet_name": "Bad",
                "batch_name": "Bad batch",
                "mapping": _MAPPING,
                "accepted_rows": [8],
            },
            {
                "sheet_name": "Good",
                "batch_name": "Good batch",
                "mapping": _MAPPING,
                "accepted_rows": [8, 9],
            },
        ]
        by_sheet = {
            "Bad": RuntimeError("workbook is corrupt on this sheet"),
            "Good": _parsed([_row(8, "Kitchen", "Good one"), _row(9, "Lobby", "Good two")]),
        }
        result = self._ingest(entries, by_sheet)

        self.assertEqual(result["failed_count"], 1)
        self.assertEqual(result["total_imported"], 2)

        bad, good = result["results"]
        self.assertFalse(bad["ok"])
        self.assertIn("corrupt", bad["error"])
        self.assertNotIn("batch", bad)
        self.assertTrue(good["ok"])
        self.assertEqual(good["imported"], 2)

        # The failed sheet left nothing behind, and the good sheet is fully durable.
        self.assertFalse(
            frappe.db.exists("Project Snag Batch", {"project": self.project, "batch_name": "Bad batch"})
        )
        self.assertEqual(frappe.db.count("Project Snag", {"batch": good["batch"]}), 2)

    def test_ingest_reports_a_sheet_with_no_accepted_rows_instead_of_creating_an_empty_batch(self):
        entry = {
            "sheet_name": "Empty",
            "batch_name": "Empty batch",
            "mapping": _MAPPING,
            "accepted_rows": [],
        }
        result = self._ingest([entry], {"Empty": _parsed([_row(8, "Kitchen", "Unticked")])})

        self.assertEqual(result["failed_count"], 1)
        self.assertEqual(result["total_imported"], 0)
        self.assertFalse(result["results"][0]["ok"])
        # "You ticked nothing" -- distinct from "none of them exist in the sheet as it
        # parses now", which is the OTHER surviving branch (ADR-0019 removed the third).
        self.assertIn("No rows were ticked", result["results"][0]["error"])
        self.assertFalse(
            frappe.db.exists(
                "Project Snag Batch", {"project": self.project, "batch_name": "Empty batch"}
            )
        )

    # -- the R2.1 bug: a re-ticked SKIPPED row ---------------------------------

    def test_a_re_ticked_skipped_row_lands_in_the_database(self):
        """THE regression test for R2.1 -- the bug that shipped because nothing covered it.

        The preview promises "tick any row the parser got wrong -- it will be imported with
        the rest". The old ingest filtered the ticked rows against the ACCEPTED list only,
        so a re-ticked skipped row vanished: no error, no report, `imported` merely lower
        than the footer promised. Asserting the returned count is NOT enough -- this asserts
        the row is IN THE DATABASE.
        """
        rows = [
            _row(8, "Kitchen", "Leaking tap"),
            # Skipped by the parser, but it HAS a description, so a human can rescue it.
            _row(
                9,
                "Lobby",
                "Cracked tile the parser mistook for a tally line",
                skipped_reason="summary_block",
                preview_text="RISK SUMMARY",
            ),
            _row(10, "Roof", "Missing sealant"),
        ]
        entry = {
            "sheet_name": "Rescue",
            "batch_name": "Rescue batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [8, 9, 10],
        }
        result = self._ingest([entry], {"Rescue": _parsed(rows)})

        sheet_result = result["results"][0]
        self.assertTrue(sheet_result["ok"])
        self.assertEqual(sheet_result["imported"], 3)
        self.assertEqual(result["total_imported"], 3)

        landed = frappe.get_all(
            "Project Snag",
            filters={"batch": sheet_result["batch"]},
            fields=["source_row", "description"],
            limit_page_length=0,
        )
        self.assertEqual(sorted(r.source_row for r in landed), [8, 9, 10])
        rescued = [r for r in landed if r.source_row == 9]
        self.assertEqual(len(rescued), 1)
        self.assertEqual(
            rescued[0].description, "Cracked tile the parser mistook for a tally line"
        )

    def test_a_sheet_of_nothing_but_re_ticked_skipped_rows_still_imports(self):
        """The worst case of R2.1: this used to raise and roll the whole sheet back."""
        rows = [
            _row(8, "Kitchen", "Ticked back in", skipped_reason="repeated_header"),
            _row(9, "Lobby", "Also ticked back in", skipped_reason="blank"),
        ]
        entry = {
            "sheet_name": "AllRescued",
            "batch_name": "All rescued batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [8, 9],
        }
        result = self._ingest([entry], {"AllRescued": _parsed(rows)})

        self.assertEqual(result["failed_count"], 0)
        self.assertEqual(result["total_imported"], 2)
        self.assertEqual(
            frappe.db.count("Project Snag", {"batch": result["results"][0]["batch"]}), 2
        )

    def test_a_ticked_row_with_no_description_IMPORTS_falling_back_to_preview_text(self):
        """ADR-0019: a human tick is authoritative. This used to be a REFUSAL.

        The description falls back to `preview_text` -- the row's first non-empty cell,
        which the preview already showed the user. It is never invented text.
        """
        rows = [
            _row(8, "Kitchen", "Leaking tap"),
            # No MAPPED description. Its first non-empty cell says "RISK SUMMARY", so that
            # is what the snag reads -- the consultant's words, not ours.
            _row(
                9,
                "Lobby",
                "",
                skipped_reason="no_description",
                preview_text="RISK SUMMARY",
            ),
            _row(10, "Roof", "Missing sealant"),
        ]
        entry = {
            "sheet_name": "Fallback",
            "batch_name": "Fallback batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [8, 9, 10],
        }
        result = self._ingest([entry], {"Fallback": _parsed(rows)})

        sheet_result = result["results"][0]
        self.assertTrue(sheet_result["ok"])
        # THREE, not two: nothing is refused any more.
        self.assertEqual(sheet_result["imported"], 3)
        self.assertEqual(
            sorted(
                frappe.get_all(
                    "Project Snag",
                    filters={"batch": sheet_result["batch"]},
                    pluck="source_row",
                    limit_page_length=0,
                )
            ),
            [8, 9, 10],
        )
        self.assertEqual(
            frappe.db.get_value(
                "Project Snag", {"batch": sheet_result["batch"], "source_row": 9}, "description"
            ),
            "RISK SUMMARY",
        )

    def test_refused_no_description_is_retained_on_the_wire_and_always_zero(self):
        """ADR-0019-DEAD, and RETAINED on purpose.

        It is the counter that proved Revision 2's silent-drop bug fixed. A payload that
        can still SAY "nothing was refused" is worth more than one that cannot express the
        question -- so it must be PRESENT, and it must read 0 even on the very import that
        used to make it non-zero.
        """
        rows = [
            _row(8, "Kitchen", "Leaking tap"),
            _row(9, "Lobby", "", skipped_reason="no_description", preview_text="12"),
        ]
        entry = {
            "sheet_name": "DeadCounter",
            "batch_name": "Dead counter batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [8, 9],
        }
        sheet_result = self._ingest([entry], {"DeadCounter": _parsed(rows)})["results"][0]

        self.assertIn("refused_no_description", sheet_result)
        self.assertEqual(sheet_result["refused_no_description"], 0)
        self.assertEqual(sheet_result["imported"], 2)

    def test_a_ticked_row_with_nothing_anywhere_imports_BLANK_not_a_placeholder(self):
        """No mapped description AND no first non-empty cell -> a BLANK description.

        ADR-0019 rejected a placeholder like "(no description)": a reader cannot tell our
        text from the consultant's, and a blank box is honest where a manufactured
        sentence is not. Asserted as EXACTLY "" so any invented string fails this.
        """
        entry = {
            "sheet_name": "NothingAnywhere",
            "batch_name": "Nothing anywhere batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [9],
        }
        result = self._ingest(
            [entry],
            {
                "NothingAnywhere": _parsed(
                    [_row(9, "", "", category="", skipped_reason="blank", preview_text="")]
                )
            },
        )

        sheet_result = result["results"][0]
        # This snag is blank in BOTH duplicate-key fields, so leaving it behind would make
        # every later blank row in this project read as a duplicate -- which is a true
        # statement about a shared live database and a false one about the test that hit
        # it. It is deleted here rather than in tearDownClass for that reason.
        self.addCleanup(tracking.delete_batch, batch=sheet_result["batch"])

        self.assertTrue(sheet_result["ok"], sheet_result.get("error"))
        self.assertEqual(sheet_result["imported"], 1)
        self.assertEqual(
            frappe.db.get_value(
                "Project Snag", {"batch": sheet_result["batch"], "source_row": 9}, "description"
            ),
            "",
        )

    def test_the_all_ticks_have_no_description_failure_branch_is_GONE(self):
        """That message can no longer be true, so it must no longer exist.

        A sheet of nothing but description-less ticks now IMPORTS. Leaving the branch in
        place would leave a message that can never fire -- which the next reader would
        take for a live rule.
        """
        entry = {
            "sheet_name": "AllBlank",
            "batch_name": "All blank batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [9],
        }
        result = self._ingest(
            [entry],
            {
                "AllBlank": _parsed(
                    [_row(9, "Lobby", "", skipped_reason="no_description", preview_text="Note")]
                )
            },
        )

        self.assertEqual(result["failed_count"], 0)
        self.assertEqual(result["total_imported"], 1)
        self.assertTrue(
            frappe.db.exists(
                "Project Snag Batch", {"project": self.project, "batch_name": "All blank batch"}
            )
        )
        # The gating predicate itself is gone, not merely bypassed.
        self.assertFalse(hasattr(import_wizard, "_row_is_importable"))

    # -- header row ------------------------------------------------------------

    def test_an_explicit_header_row_equal_to_the_guess_imports_identically(self):
        """The override must be a no-op when it agrees with the auto-guess."""
        rows = [_row(8, "Kitchen", "A"), _row(9, "Lobby", "B")]

        def run(header_row, batch_name, sheet):
            entry = {
                "sheet_name": sheet,
                "batch_name": batch_name,
                "mapping": _MAPPING,
                "header_row": header_row,
                "accepted_rows": [8, 9],
            }
            # Same parse for either argument -- the stub's guess IS 7.
            return self._ingest([entry], {sheet: {7: _parsed(rows, header_row=7)}})

        auto = run(None, "Auto batch", "AutoHdr")
        explicit = run(7, "Explicit batch", "ExplicitHdr")

        self.assertEqual(auto["total_imported"], 2)
        self.assertEqual(explicit["total_imported"], 2)

        def landed(result):
            return sorted(
                frappe.get_all(
                    "Project Snag",
                    filters={"batch": result["results"][0]["batch"]},
                    fields=["source_row", "area", "category", "description", "remark"],
                    limit_page_length=0,
                ),
                key=lambda r: r.source_row,
            )

        self.assertEqual(
            [dict(r) for r in landed(auto)], [dict(r) for r in landed(explicit)]
        )

    def test_the_header_row_reaches_the_ingest_re_parse_and_changes_the_row_set(self):
        """A different header row must parse a different region -- not the approved one.

        If `header_row` were dropped on the way to the re-parse, both runs would import
        the same rows and this would be silently green.
        """
        block_one = [_row(8, "Kitchen", "Block one snag")]
        block_two = [_row(55, "Basement", "Block two snag"), _row(56, "Plant", "Another")]
        by_sheet = {
            "TwoBlocks": {
                7: _parsed(block_one, header_row=7),
                54: _parsed(block_two, header_row=54),
            }
        }

        first = self._ingest(
            [
                {
                    "sheet_name": "TwoBlocks",
                    "batch_name": "Header 7",
                    "mapping": _MAPPING,
                    "header_row": 7,
                    "accepted_rows": [8, 55, 56],
                }
            ],
            by_sheet,
        )
        self.assertEqual(self.stub_parser.calls, [("TwoBlocks", 7)])
        self.assertEqual(
            frappe.get_all(
                "Project Snag",
                filters={"batch": first["results"][0]["batch"]},
                pluck="source_row",
                limit_page_length=0,
            ),
            [8],
        )

        second = self._ingest(
            [
                {
                    "sheet_name": "TwoBlocks",
                    "batch_name": "Header 54",
                    "mapping": _MAPPING,
                    "header_row": 54,
                    "accepted_rows": [8, 55, 56],
                }
            ],
            by_sheet,
        )
        self.assertEqual(self.stub_parser.calls, [("TwoBlocks", 54)])
        self.assertEqual(
            sorted(
                frappe.get_all(
                    "Project Snag",
                    filters={"batch": second["results"][0]["batch"]},
                    pluck="source_row",
                    limit_page_length=0,
                )
            ),
            [55, 56],
        )

    def test_a_header_row_that_is_not_a_row_number_is_refused(self):
        entry = {
            "sheet_name": "Sheet1",
            "batch_name": "Bad header",
            "mapping": _MAPPING,
            "header_row": 0,
            "accepted_rows": [8],
        }
        result = self._ingest([entry], {"Sheet1": _parsed([_row(8, "Kitchen", "A")])})
        self.assertEqual(result["failed_count"], 1)

    # -- get_sheet_columns: THE R3.1 DEADLOCK ----------------------------------

    def test_get_sheet_columns_needs_NO_mapping(self):
        """THE regression test for the header-row deadlock (Revision 3, R3.1).

        Three things formed a circle: new column labels came only from `parse_preview`;
        `parse_preview` hard-refuses without a mapped Description; and you cannot pick a
        Description until you have the labels. A sheet whose header auto-detection failed
        therefore had empty selects FOREVER.

        This asserts the break at its exact worst point: a header row whose labels are real
        but whose `mapping_guess` comes back NULL -- the state that used to wedge the
        client, because the client's mapping-valid gate then swallowed every keystroke.
        """
        self._install_parser({})

        payload = import_wizard.get_sheet_columns(
            file_url=self.file_url,
            sheet_name="Any",
            header_row=8,
        )

        # Real columns...
        self.assertEqual(
            [c["label"] for c in payload["columns"]],
            ["1", "Food Box - General", "Fire & Life Safety"],
        )
        # ...and NO guessable mapping. Both at once: that pair is the deadlock state, and
        # a client must never read "no guess" as "no columns".
        self.assertIsNone(payload["mapping_guess"])
        self.assertEqual(payload["header_row"], 8)
        # Wire contract: GetSheetColumnsResponse, key for key.
        self.assertEqual(set(payload.keys()), {"header_row", "columns", "mapping_guess"})

        # The proof that this is a DIFFERENT capability, not a convenience wrapper: the
        # same request through `parse_preview` cannot be made at all without a Description.
        self._install_parser({"Any": _parsed([])})
        with self.assertRaises(frappe.ValidationError):
            import_wizard.parse_preview(
                project=self.project,
                file_url=self.file_url,
                sheet_name="Any",
                mapping={"area": None, "category": None, "description": None, "remarks": None},
                header_row=8,
            )

    def test_get_sheet_columns_returns_DIFFERENT_labels_for_a_different_header_row(self):
        """"The column options don't change when the header row is changed" -- the report.

        The labels ARE the named row's cells, so two rows must yield two lists. Asserting
        `header_row` alone would pass on a response that never re-read the sheet.
        """
        self._install_parser({})
        seven = import_wizard.get_sheet_columns(
            file_url=self.file_url, sheet_name="Any", header_row=7
        )

        self._install_parser({})
        eight = import_wizard.get_sheet_columns(
            file_url=self.file_url, sheet_name="Any", header_row=8
        )

        self.assertEqual(
            [c["label"] for c in seven["columns"]], ["Area / Location", "Snag Description"]
        )
        self.assertEqual(
            [c["label"] for c in eight["columns"]],
            ["1", "Food Box - General", "Fire & Life Safety"],
        )
        self.assertNotEqual(seven["columns"], eight["columns"])
        self.assertEqual((seven["header_row"], eight["header_row"]), (7, 8))
        # Header row 7 IS header-shaped, so its guess survives -- proving the null above is
        # a property of row 8, not of the endpoint.
        self.assertEqual(
            seven["mapping_guess"]["_labels"], ["Area / Location", "Snag Description"]
        )

    def test_get_sheet_columns_resolves_a_missing_header_row_and_returns_the_one_used(self):
        """No override -> auto-detect, and the row ACTUALLY used comes back.

        Never a bare echo of the argument: the client shows which row the labels came from
        even when it sent nothing.
        """
        self._install_parser({})
        payload = import_wizard.get_sheet_columns(file_url=self.file_url, sheet_name="Any")

        self.assertEqual(payload["header_row"], _STUB_AUTO_HEADER_ROW)
        self.assertEqual(
            [c["label"] for c in payload["columns"]], ["Area / Location", "Snag Description"]
        )

    def test_get_sheet_columns_refuses_a_header_row_that_is_not_a_row_number(self):
        """The SAME coercion `parse_preview` applies -- refused loudly, never a silent
        fallback to the auto-guess (which would show labels from a row nobody named)."""
        self._install_parser({})
        for bad in ("not-a-row", 0, -3):
            with self.assertRaises(frappe.ValidationError):
                import_wizard.get_sheet_columns(
                    file_url=self.file_url, sheet_name="Any", header_row=bad
                )

    def test_get_sheet_columns_writes_nothing(self):
        before = frappe.db.count("Project Snag", {"project": self.project})
        self._install_parser({})
        import_wizard.get_sheet_columns(
            file_url=self.file_url, sheet_name="Any", header_row=7
        )
        self.assertEqual(frappe.db.count("Project Snag", {"project": self.project}), before)

    def test_get_sheet_columns_is_guarded_at_the_import_tier(self):
        """Read-only, but it reads a project's uploaded workbook -- same tier as the preview."""
        self._install_parser({})
        import nirmaan_stack.api.snags as snag_pkg

        original = snag_pkg._user_role
        snag_pkg._user_role = lambda: "Nirmaan Project Manager Profile"
        frappe.session.user = "snag-pm@example.com"
        try:
            with self.assertRaises(frappe.PermissionError):
                import_wizard.get_sheet_columns(
                    file_url=self.file_url, sheet_name="Any", header_row=7
                )
        finally:
            snag_pkg._user_role = original
            frappe.session.user = "Administrator"

    # -- preview ---------------------------------------------------------------

    def test_parse_preview_flags_duplicates_case_and_whitespace_insensitively(self):
        self._one_sheet(sheet="Dupes", batch_name="Dupe source")

        self._install_parser(
            {
                "Dupes": _parsed(
                    rows=[
                        # Same snag, different case and internal spacing -> duplicate.
                        _row(20, "  kitchen ", "Leaking    TAP"),
                        # Same description, different area -> NOT a duplicate.
                        _row(21, "Basement", "Leaking tap"),
                        _row(22, "Kitchen", "Something entirely new"),
                        # A SKIPPED duplicate: flagged, but NOT counted -- it is not being
                        # imported, so counting it would inflate the warning.
                        _row(
                            23,
                            "Kitchen",
                            "Leaking tap",
                            skipped_reason="summary_block",
                            preview_text="RISK SUMMARY",
                        ),
                        _row(24, "", "", skipped_reason="blank", preview_text=""),
                    ]
                )
            }
        )
        preview = import_wizard.parse_preview(
            project=self.project,
            file_url=self.file_url,
            sheet_name="Dupes",
            mapping=_MAPPING,
        )

        self.assertEqual(preview["sheet_name"], "Dupes")
        self.assertEqual(preview["duplicate_count"], 1)
        self.assertEqual(
            [r["is_duplicate"] for r in preview["rows"]], [True, False, False, True, False]
        )
        # ONE merged list, accepted and skipped interleaved in Excel row order.
        self.assertEqual([r["source_row"] for r in preview["rows"]], [20, 21, 22, 23, 24])
        self.assertEqual(
            [r["skipped_reason"] for r in preview["rows"]],
            [None, None, None, "summary_block", "blank"],
        )
        self.assertEqual(preview["accepted_count"], 3)
        self.assertEqual(preview["skipped_count"], 2)
        # A description-less row can never become a Snag -- the preview says so.
        self.assertEqual([r["tickable"] for r in preview["rows"]][-1], False)
        self.assertNotIn("skipped", preview)
        # Wire contract: ParsedSnagRow, key for key. `serial` is the sheet's own S.No
        # (types.ts `ParsedSnagRow.serial`), "" when the sheet does not number the row.
        self.assertEqual(
            set(preview["rows"][0].keys()),
            {
                "source_row",
                "serial",
                "area",
                "category",
                "description",
                "remark",
                "is_duplicate",
                "skipped_reason",
                "tickable",
                "preview_text",
            },
        )

    def test_parse_preview_returns_columns_and_a_re_guess_for_the_header_row_used(self):
        """No second 're-inspect' endpoint: the recomputed labels ride THIS response.

        The labels ARE the header row's cells, so an override moves them -- and the
        mapping selects have to re-render from this list, not from the one
        `inspect_workbook` returned before the user touched anything.
        """
        by_sheet = {
            "Hdr": {
                7: _parsed([_row(8, "Kitchen", "A")], header_row=7),
                54: _parsed([_row(55, "Basement", "B")], header_row=54),
            }
        }

        self._install_parser(by_sheet)
        guessed = import_wizard.parse_preview(
            project=self.project,
            file_url=self.file_url,
            sheet_name="Hdr",
            mapping=_MAPPING,
        )
        # No override -> the header row the PARSER settled on, never a bare echo of None.
        self.assertEqual(guessed["header_row"], 7)
        self.assertEqual([c["label"] for c in guessed["columns"]], ["Area / Location", "Snag Description"])
        self.assertEqual(guessed["mapping_guess"]["_labels"], ["Area / Location", "Snag Description"])

        self._install_parser(by_sheet)
        overridden = import_wizard.parse_preview(
            project=self.project,
            file_url=self.file_url,
            sheet_name="Hdr",
            mapping=_MAPPING,
            header_row=54,
        )
        self.assertEqual(overridden["header_row"], 54)
        self.assertEqual([c["label"] for c in overridden["columns"]], ["Zone", "Observation"])
        # The re-guess ran against the RECOMPUTED columns, not the original ones.
        self.assertEqual(overridden["mapping_guess"]["_labels"], ["Zone", "Observation"])
        self.assertEqual([r["source_row"] for r in overridden["rows"]], [55])

    def test_parse_preview_refuses_a_header_row_that_is_not_a_row_number(self):
        self._install_parser({"Sheet1": _parsed([])})
        with self.assertRaises(frappe.ValidationError):
            import_wizard.parse_preview(
                project=self.project,
                file_url=self.file_url,
                sheet_name="Sheet1",
                mapping=_MAPPING,
                header_row="not-a-row",
            )

    def test_parse_preview_writes_nothing(self):
        before = frappe.db.count("Project Snag", {"project": self.project})
        self._install_parser({"Sheet1": _parsed([_row(8, "Kitchen", "Preview only")])})
        import_wizard.parse_preview(
            project=self.project,
            file_url=self.file_url,
            sheet_name="Sheet1",
            mapping=_MAPPING,
        )
        self.assertEqual(frappe.db.count("Project Snag", {"project": self.project}), before)

    def test_parse_preview_requires_a_description_mapping(self):
        self._install_parser({"Sheet1": _parsed([])})
        with self.assertRaises(frappe.ValidationError):
            import_wizard.parse_preview(
                project=self.project,
                file_url=self.file_url,
                sheet_name="Sheet1",
                mapping={"area": "B", "category": "C", "description": None, "remarks": None},
            )

    # -- status + stamp --------------------------------------------------------

    def test_update_snag_status_stamps_attribution_and_a_later_save_does_not_move_it(self):
        result = self._one_sheet(sheet="Stamp", batch_name="Stamp batch")
        snag = frappe.get_all(
            "Project Snag", filters={"batch": result["results"][0]["batch"]}, pluck="name"
        )[0]

        payload = tracking.update_snag_status(snag=snag, status="WIP")
        self.assertEqual(payload["status"], "WIP")
        self.assertEqual(payload["status_changed_by"], frappe.session.user)
        self.assertIsNotNone(payload["status_changed_on"])

        stamped_by = payload["status_changed_by"]
        stamped_on = payload["status_changed_on"]

        # A save that does NOT change status must leave the stamp exactly where it was --
        # the controller's `previous.status == doc.status` early return.
        #
        # THE PROBE IS A BARE `doc.save()`, NOT AN ENDPOINT. The old probe was
        # `update_snag_comments`, which is deleted; and every remaining endpoint that can
        # write a remark ALSO moves the status (ADR-0018), so routing this through one
        # would leave the branch with nothing exercising it while the test stayed green.
        # A direct save with only a `remark` change is the one shape that still reaches it
        # -- and it is a real path: a Desk edit and a Data Import look exactly like this.
        doc = frappe.get_doc("Project Snag", snag)
        doc.remark = "Chased the plumber"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        doc = frappe.get_doc("Project Snag", snag)
        self.assertEqual(doc.remark, "Chased the plumber")
        self.assertEqual(doc.status, "WIP")
        self.assertEqual(doc.status_changed_by, stamped_by)
        self.assertEqual(str(doc.status_changed_on), str(stamped_on))

    # -- the remark rides the status change (ADR-0018) --------------------------

    def _one_snag(self, sheet, batch_name, remark=""):
        result = self._ingest(
            [
                {
                    "sheet_name": sheet,
                    "batch_name": batch_name,
                    "mapping": _MAPPING,
                    "header_row": None,
                    "accepted_rows": [8],
                }
            ],
            {sheet: _parsed([_row(8, "Kitchen", "Leaking tap", remark=remark)])},
        )
        return frappe.get_all(
            "Project Snag", filters={"batch": result["results"][0]["batch"]}, pluck="name"
        )[0]

    def test_update_snag_status_writes_the_remark_leaves_it_on_none_and_clears_on_empty(self):
        """Three states, and `None` is NOT `""`. Collapsing them wipes imported text."""
        snag = self._one_snag("RemarkStates", "Remark states batch", remark="Consultant: urgent")

        # text -> OVERWRITE, in the same save as the status.
        payload = tracking.update_snag_status(snag=snag, status="WIP", remark="Plumber booked")
        self.assertEqual(payload["status"], "WIP")
        self.assertEqual(payload["remark"], "Plumber booked")
        self.assertEqual(frappe.db.get_value("Project Snag", snag, "remark"), "Plumber booked")

        # None -> NOT SUPPLIED. The remark must survive untouched.
        payload = tracking.update_snag_status(snag=snag, status="Completed")
        self.assertEqual(payload["status"], "Completed")
        self.assertEqual(payload["remark"], "Plumber booked")
        self.assertEqual(frappe.db.get_value("Project Snag", snag, "remark"), "Plumber booked")

        # "" -> an explicit CLEAR.
        payload = tracking.update_snag_status(snag=snag, status="Pending", remark="")
        self.assertFalse(payload["remark"])
        self.assertFalse(frappe.db.get_value("Project Snag", snag, "remark"))

    def test_not_applicable_takes_no_remark(self):
        """Server-side, because client-only enforcement lets an API caller straight past."""
        snag = self._one_snag("NotApplicable", "NA batch", remark="Consultant: urgent")

        with self.assertRaises(frappe.ValidationError):
            tracking.update_snag_status(snag=snag, status="Not Applicable", remark="x")
        # Refused BEFORE the save: neither field moved.
        self.assertEqual(frappe.db.get_value("Project Snag", snag, "status"), "Pending")
        self.assertEqual(
            frappe.db.get_value("Project Snag", snag, "remark"), "Consultant: urgent"
        )

        # An explicit "" is refused too -- a CLEAR is still a remark write, and accepting
        # it would let a client that always sends the field destroy the imported text.
        with self.assertRaises(frappe.ValidationError):
            tracking.update_snag_status(snag=snag, status="Not Applicable", remark="")

        # The status on its own is fine, and the existing remark is left alone.
        payload = tracking.update_snag_status(snag=snag, status="Not Applicable")
        self.assertEqual(payload["status"], "Not Applicable")
        self.assertEqual(payload["remark"], "Consultant: urgent")

    def test_bulk_update_takes_no_remark_parameter_at_all(self):
        """Q12a is enforced by the SIGNATURE -- one sentence must not overwrite N remarks."""
        import inspect

        self.assertNotIn(
            "remark", inspect.signature(tracking.bulk_update_snag_status).parameters
        )

    def test_update_snag_status_rejects_an_unknown_status(self):
        result = self._one_sheet(sheet="BadStatus", batch_name="Bad status batch")
        snag = frappe.get_all(
            "Project Snag", filters={"batch": result["results"][0]["batch"]}, pluck="name"
        )[0]
        with self.assertRaises(frappe.ValidationError):
            tracking.update_snag_status(snag=snag, status="Open")

    def test_bulk_update_is_refused_for_a_non_admin(self):
        result = self._one_sheet(sheet="Bulk", batch_name="Bulk batch")
        names = frappe.get_all(
            "Project Snag", filters={"batch": result["results"][0]["batch"]}, pluck="name"
        )

        # A user with no role profile at all: the tier helpers must refuse.
        frappe.set_user("Administrator")
        frappe.session.user = "snag-nobody@example.com"
        try:
            with self.assertRaises(frappe.PermissionError):
                tracking.bulk_update_snag_status(snags=names, status="Completed")
        finally:
            frappe.session.user = "Administrator"

        self.assertEqual(
            frappe.db.count("Project Snag", {"batch": result["results"][0]["batch"], "status": "Pending"}),
            len(names),
        )

        # Admin is allowed, and every row moves.
        payload = tracking.bulk_update_snag_status(snags=names, status="Completed")
        self.assertEqual(payload["updated"], len(names))
        self.assertEqual(
            frappe.db.count(
                "Project Snag", {"batch": result["results"][0]["batch"], "status": "Completed"}
            ),
            len(names),
        )

    def test_a_project_manager_may_change_one_status_but_not_bulk(self):
        result = self._one_sheet(sheet="PM", batch_name="PM batch")
        names = frappe.get_all(
            "Project Snag", filters={"batch": result["results"][0]["batch"]}, pluck="name"
        )

        import nirmaan_stack.api.snags as snag_pkg

        original = snag_pkg._user_role
        snag_pkg._user_role = lambda: "Nirmaan Project Manager Profile"
        frappe.session.user = "snag-pm@example.com"
        try:
            tracking.update_snag_status(snag=names[0], status="WIP")
            with self.assertRaises(frappe.PermissionError):
                tracking.bulk_update_snag_status(snags=names, status="Completed")
            with self.assertRaises(frappe.PermissionError):
                tracking.add_manual_snag(
                    project=self.project, area="A", category="C", description="Nope"
                )
        finally:
            snag_pkg._user_role = original
            frappe.session.user = "Administrator"

        self.assertEqual(frappe.db.get_value("Project Snag", names[0], "status"), "WIP")

    def test_the_comments_endpoint_is_gone(self):
        """`update_snag_comments` was deleted with the field (ADR-0018).

        Pinned so it cannot come back by copy-paste: it was the only write path on this
        doctype that did not touch `status`, and re-adding one silently un-couples the
        status stamp from the last edit.
        """
        self.assertFalse(hasattr(tracking, "update_snag_comments"))

    # -- manual entry ----------------------------------------------------------

    def test_add_manual_snag_has_no_batch_and_starts_pending(self):
        payload = tracking.add_manual_snag(
            project=self.project,
            area="Terrace",
            category="Waterproofing",
            description="Ponding near the drain",
        )
        type(self)._created_names.add(payload["name"])

        doc = frappe.get_doc("Project Snag", payload["name"])
        self.assertIsNone(doc.batch)
        self.assertEqual(doc.status, "Pending")
        self.assertEqual(doc.area, "Terrace")
        # `source_row` is an Int, so an unset one reads back as 0, not None -- a manual
        # snag came from no Excel row. types.ts types it `number | null`; the frontend
        # must treat 0 as "no source row" (falsy either way).
        self.assertFalse(doc.source_row)

    # -- detail edit -----------------------------------------------------------

    def _a_snag(self, sheet, batch_name):
        result = self._one_sheet(sheet=sheet, batch_name=batch_name)
        return frappe.get_all(
            "Project Snag", filters={"batch": result["results"][0]["batch"]}, pluck="name"
        )[0]

    def test_update_snag_details_rewrites_the_three_data_fields(self):
        """The FIRST post-create write path for area / category / description."""
        snag = self._a_snag("Edit", "Edit batch")

        payload = tracking.update_snag_details(
            snag=snag,
            # Normalisation is SHARED with `add_manual_snag` -- the whitespace proves it
            # ran, and it has to: `get_snag_field_values` groups on the STORED text.
            area="  Terrace  ",
            category=" Waterproofing ",
            description="  Ponding near the drain  ",
        )

        doc = frappe.get_doc("Project Snag", snag)
        self.assertEqual(doc.area, "Terrace")
        self.assertEqual(doc.category, "Waterproofing")
        self.assertEqual(doc.description, "Ponding near the drain")
        self.assertEqual(payload["area"], "Terrace")
        self.assertEqual(payload["description"], "Ponding near the drain")

    def test_update_snag_details_does_NOT_move_the_status_stamp(self):
        """`status` is unchanged, so the attribution must not move (ADR-0018).

        `status_changed_by` / `status_changed_on` mean "the last STATUS change", not "the
        last edit". This is also the assertion that would break the instant someone
        reached for `frappe.db.set_value` here: the stamp lives in `before_save`, so a
        raw write would skip the controller entirely -- and skip `track_changes` with it.
        """
        snag = self._a_snag("EditStamp", "Edit stamp batch")
        tracking.update_snag_status(snag=snag, status="WIP", remark="Started")
        before = frappe.db.get_value(
            "Project Snag", snag, ["status", "status_changed_by", "status_changed_on"], as_dict=True
        )

        tracking.update_snag_details(
            snag=snag, area="Moved", category="Moved", description="Reworded by hand"
        )

        after = frappe.db.get_value(
            "Project Snag",
            snag,
            ["status", "remark", "status_changed_by", "status_changed_on"],
            as_dict=True,
        )
        self.assertEqual(after.status_changed_by, before.status_changed_by)
        self.assertEqual(after.status_changed_on, before.status_changed_on)
        # And the two fields it must never touch are untouched.
        self.assertEqual(after.status, "WIP")
        self.assertEqual(after.remark, "Started")

    def test_update_snag_details_edits_the_s_no_in_three_states(self):
        """`source_serial` behaves exactly like `remark`: omit / clear / overwrite.

        Omitting it MUST leave the stored number alone -- otherwise every ordinary area
        typo fix from a client that does not send the field would blank the S.No the
        import or the consultant put there.
        """
        snag = self._a_snag("EditSerial", "Edit serial batch")
        frappe.db.set_value("Project Snag", snag, "source_serial", "12", update_modified=False)

        # 1. omitted -> untouched
        tracking.update_snag_details(snag=snag, area="A", category="C", description="D")
        self.assertEqual(frappe.db.get_value("Project Snag", snag, "source_serial"), "12")

        # 2. text -> overwrite, stripped (the import strips too)
        out = tracking.update_snag_details(
            snag=snag, area="A", category="C", description="D", source_serial="  A-3  "
        )
        self.assertEqual(out["source_serial"], "A-3")
        self.assertEqual(frappe.db.get_value("Project Snag", snag, "source_serial"), "A-3")

        # 3. "" -> an explicit clear
        tracking.update_snag_details(
            snag=snag, area="A", category="C", description="D", source_serial=""
        )
        self.assertFalse(frappe.db.get_value("Project Snag", snag, "source_serial"))

    def test_the_s_no_is_editable_despite_being_read_only_on_the_doctype(self):
        """`read_only` is a DESK form flag, not a write guard.

        Pinned because the field IS read_only in the doctype JSON -- provenance is not
        hand-edited in Desk -- and this endpoint is deliberately its one editor. If a
        Frappe upgrade ever made `read_only` refuse a document-layer write, this fails
        here rather than silently dropping the edit in production.
        """
        self.assertTrue(
            frappe.get_meta("Project Snag").get_field("source_serial").read_only,
            "source_serial is expected to stay read_only on the doctype",
        )
        snag = self._a_snag("EditSerialRO", "Edit serial read-only batch")
        tracking.update_snag_details(
            snag=snag, area="A", category="C", description="D", source_serial="7"
        )
        self.assertEqual(frappe.db.get_value("Project Snag", snag, "source_serial"), "7")

    def test_update_snag_details_leaves_provenance_alone(self):
        """`batch` / `source_row` / `project` answer 'where did this come from'."""
        snag = self._a_snag("EditProv", "Edit provenance batch")
        before = frappe.db.get_value(
            "Project Snag", snag, ["batch", "source_row", "project"], as_dict=True
        )

        tracking.update_snag_details(snag=snag, area="A", category="C", description="D")

        after = frappe.db.get_value(
            "Project Snag", snag, ["batch", "source_row", "project"], as_dict=True
        )
        self.assertEqual((after.batch, after.source_row, after.project),
                         (before.batch, before.source_row, before.project))

    def test_update_snag_details_accepts_a_BLANK_description(self):
        """ADR-0019 dropped `reqd` -- an imported blank must stay correctable to blank."""
        snag = self._a_snag("EditBlank", "Edit blank batch")

        tracking.update_snag_details(snag=snag, area="Roof", category="", description="")

        self.assertEqual(frappe.db.get_value("Project Snag", snag, "description"), "")

    def test_a_project_manager_may_change_a_status_but_NOT_edit_the_details(self):
        """Owner decision Q8a: editing a description rewrites what the consultant reported.

        The two tiers agree on their role SET today and are asserted SEPARATELY on purpose
        -- they answer different questions and are free to diverge.
        """
        snag = self._a_snag("EditPM", "Edit PM batch")

        import nirmaan_stack.api.snags as snag_pkg

        original = snag_pkg._user_role
        snag_pkg._user_role = lambda: "Nirmaan Project Manager Profile"
        frappe.session.user = "snag-pm@example.com"
        try:
            with self.assertRaises(frappe.PermissionError):
                tracking.update_snag_details(
                    snag=snag, area="Nope", category="Nope", description="Nope"
                )
            # ...while the status endpoint still admits them, unchanged.
            tracking.update_snag_status(snag=snag, status="WIP")
        finally:
            snag_pkg._user_role = original
            frappe.session.user = "Administrator"

        doc = frappe.get_doc("Project Snag", snag)
        self.assertEqual(doc.status, "WIP")
        self.assertNotEqual(doc.area, "Nope")

    def test_update_snag_details_refuses_an_unknown_snag(self):
        with self.assertRaises(frappe.ValidationError):
            tracking.update_snag_details(
                snag="NOT-A-SNAG", area="A", category="C", description="D"
            )

    # -- field-value suggestions -----------------------------------------------

    def test_get_snag_field_values_excludes_the_empty_string(self):
        """⚠️ The importer and `add_manual_snag` write "", never NULL.

        A naive DISTINCT therefore yields an empty-string option -- a blank, unpickable
        line in the suggestions list. Most-used-first ordering is asserted in the same
        pass, since both come out of the one GROUP BY.
        """
        rows = [
            _row(8, "Kitchen", "One"),
            _row(9, "Kitchen", "Two"),
            _row(10, "", "Three", category=""),
        ]
        entry = {
            "sheet_name": "Values",
            "batch_name": "Values batch",
            "mapping": _MAPPING,
            "header_row": None,
            "accepted_rows": [8, 9, 10],
        }
        self._ingest([entry], {"Values": _parsed(rows)})
        tracking.add_manual_snag(
            project=self.project, area="Terrace", category="Civil", description="Manual"
        )
        for name in frappe.get_all(
            "Project Snag", filters={"project": self.project}, pluck="name", limit_page_length=0
        ):
            type(self)._created_names.add(name)

        payload = tracking.get_snag_field_values(project=self.project)

        self.assertEqual(set(payload.keys()), {"areas", "categories"})
        self.assertNotIn("", payload["areas"])
        self.assertNotIn("", payload["categories"])
        self.assertIn("Kitchen", payload["areas"])
        self.assertIn("Terrace", payload["areas"])
        # Most-used first: Kitchen (2) outranks Terrace (1).
        self.assertLess(payload["areas"].index("Kitchen"), payload["areas"].index("Terrace"))

    def test_get_snag_field_values_is_read_guarded(self):
        """Same deny-list tier as `get_snag_stats` -- NOT the doctype permission table."""
        frappe.session.user = "snag-nobody@example.com"
        try:
            with self.assertRaises(frappe.PermissionError):
                tracking.get_snag_field_values(project=self.project)
        finally:
            frappe.session.user = "Administrator"

    # -- delete ----------------------------------------------------------------

    def test_delete_batch_goes_through_the_document_layer_and_writes_deleted_documents(self):
        result = self._one_sheet(sheet="Doomed", batch_name="Doomed batch")
        batch = result["results"][0]["batch"]

        tracking.update_snag_status(
            snag=frappe.get_all("Project Snag", filters={"batch": batch}, pluck="name")[0],
            status="Completed",
        )

        preview = tracking.get_batch_delete_preview(batch=batch)
        self.assertEqual(preview["batch"], batch)
        self.assertEqual(preview["batch_name"], "Doomed batch")
        self.assertEqual(preview["snag_count"], 3)
        # Worked = anything no longer Pending. Shown, never enforced (ADR-0017).
        self.assertEqual(preview["worked_count"], 1)

        before = frappe.db.count("Deleted Document", {"deleted_doctype": "Project Snag"})
        deleted = tracking.delete_batch(batch=batch)
        after = frappe.db.count("Deleted Document", {"deleted_doctype": "Project Snag"})

        self.assertEqual(deleted["deleted_snags"], 3)
        # `Deleted Document` is the ONLY recovery path for a deleted snag (ADR-0017);
        # a raw SQL delete would leave this count flat.
        self.assertEqual(after - before, 3)
        self.assertFalse(frappe.db.exists("Project Snag Batch", batch))
        self.assertEqual(frappe.db.count("Project Snag", {"batch": batch}), 0)

    # -- stats -----------------------------------------------------------------

    def test_get_snag_stats_counts_every_status_including_zeroes(self):
        stats_project = frappe.new_doc("Projects")
        stats_project.project_name = f"TEST_snagstats_{frappe.generate_hash(length=6)}"
        stats_project.project_start_date = frappe.utils.now()[:19]
        stats_project.project_end_date = frappe.utils.add_to_date(
            frappe.utils.now()[:19], years=1
        )[:19]
        stats_project.project_scopes = {"scopes": []}
        stats_project.insert(ignore_permissions=True)
        frappe.db.commit()

        def cleanup():
            for name in frappe.get_all(
                "Project Snag",
                filters={"project": stats_project.name},
                pluck="name",
                limit_page_length=0,
            ):
                frappe.delete_doc("Project Snag", name, force=True, ignore_permissions=True)
            frappe.delete_doc(
                "Projects", stats_project.name, force=True, ignore_permissions=True
            )
            frappe.db.commit()

        self.addCleanup(cleanup)

        for status in ("Pending", "Pending", "WIP", "Completed"):
            doc = frappe.get_doc(
                {
                    "doctype": "Project Snag",
                    "project": stats_project.name,
                    "area": "A",
                    "category": "C",
                    "description": f"Snag {status}",
                    "status": status,
                }
            )
            doc.insert(ignore_permissions=True)
        frappe.db.commit()

        stats = tracking.get_snag_stats(project=stats_project.name)
        self.assertEqual(stats["total"], 4)
        self.assertEqual(
            stats["by_status"],
            {"Pending": 2, "WIP": 1, "Completed": 1, "Not Applicable": 0},
        )

    def test_get_snag_stats_refuses_a_user_with_no_access(self):
        """It shipped with NO guard: any logged-in session could read a project's counts."""
        import nirmaan_stack.api.snags as snag_pkg

        original = snag_pkg._user_role

        # A user with no role profile at all -- "no profile" is not project access.
        snag_pkg._user_role = lambda: None
        frappe.session.user = "snag-nobody@example.com"
        try:
            with self.assertRaises(frappe.PermissionError):
                tracking.get_snag_stats(project=self.project)

            # Accountant is the ONE role the tab is hidden from (plan section 6).
            snag_pkg._user_role = lambda: "Nirmaan Accountant Profile"
            with self.assertRaises(frappe.PermissionError):
                tracking.get_snag_stats(project=self.project)

            snag_pkg._user_role = lambda: "Nirmaan Accountant Lead Profile"
            with self.assertRaises(frappe.PermissionError):
                tracking.get_snag_stats(project=self.project)

            # READ IS WIDER THAN WRITE: a role that may not import can still read.
            snag_pkg._user_role = lambda: "Nirmaan Procurement Executive Profile"
            stats = tracking.get_snag_stats(project=self.project)
            self.assertIn("by_status", stats)
            with self.assertRaises(frappe.PermissionError):
                tracking.add_manual_snag(
                    project=self.project, area="A", category="C", description="Nope"
                )
        finally:
            snag_pkg._user_role = original
            frappe.session.user = "Administrator"
