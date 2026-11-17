"""Tests for generate_doctype_types.py: the field mapping, child tables, Select options, idempotence and --check.

Stdlib only, like the script:  python3 -m unittest scripts.test_generate_doctype_types
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_doctype_types import main, render_interface  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "generate_doctype_types.py"


def doctype(name, fields, **meta):
    return {"doctype": "DocType", "name": name, "fields": fields, **meta}


def field(fieldname, fieldtype, **extra):
    return {"fieldname": fieldname, "fieldtype": fieldtype, "label": fieldname.title(), **extra}


class StandardFields(unittest.TestCase):
    def test_a_doctype_gets_the_standard_frappe_fields(self):
        ts = render_interface(doctype("Sample Order", []))
        self.assertIn("export interface SampleOrderDocType {", ts)
        for line in ("name: string", "owner: string", "creation: string", "modified: string",
                     "modified_by: string", "docstatus?: 0 | 1 | 2", "idx?: number"):
            self.assertIn(f"\t{line}\n", ts)
        self.assertNotIn("parenttype", ts)

    def test_a_child_table_doctype_also_gets_its_parent_fields(self):
        ts = render_interface(doctype("Sample Order Item", [], istable=1))
        for line in ("parent: string", "parentfield: string", "parenttype: string"):
            self.assertIn(f"\t{line}\n", ts)


class FieldTypes(unittest.TestCase):
    def ts_type(self, fieldtype, **extra):
        ts = render_interface(doctype("Sample", [field("f", fieldtype, reqd=1, **extra)]))
        found = [ln.strip() for ln in ts.splitlines() if ln.strip().startswith("f:")]
        self.assertEqual(len(found), 1, ts)
        return found[0].removeprefix("f: ")

    def test_text_link_date_and_attach_fields_are_strings(self):
        for ft in ("Data", "Small Text", "Text", "Long Text", "Text Editor", "Link", "Dynamic Link", "Date",
                   "Datetime", "Time", "Attach", "Attach Image", "Password", "Read Only", "Phone", "Code"):
            with self.subTest(ft):
                self.assertEqual(self.ts_type(ft), "string")

    def test_numeric_fields_are_numbers(self):
        for ft in ("Int", "Float", "Currency", "Percent", "Rating", "Duration"):
            with self.subTest(ft):
                self.assertEqual(self.ts_type(ft), "number")

    def test_a_check_is_zero_or_one_not_boolean(self):
        self.assertEqual(self.ts_type("Check"), "0 | 1")

    def test_json_is_unknown(self):
        self.assertEqual(self.ts_type("JSON"), "unknown")

    def test_layout_only_fields_are_skipped(self):
        fields = [field(f"f{i}", ft) for i, ft in enumerate(
            ("Section Break", "Column Break", "Tab Break", "HTML", "Button", "Image", "Heading", "Fold"))]
        self.assertEqual(render_interface(doctype("Sample", fields)), render_interface(doctype("Sample", [])))

    def test_an_unmapped_fieldtype_is_refused_not_guessed(self):
        with self.assertRaisesRegex(ValueError, "Hologram"):
            render_interface(doctype("Sample", [field("f", "Hologram")]))

    def test_a_select_is_the_union_of_its_options(self):
        self.assertEqual(self.ts_type("Select", options="Pending\nApproved\nSay \"No\""),
                         '"Pending" | "Approved" | "Say \\"No\\""')

    def test_a_select_with_a_blank_option_also_allows_the_empty_string(self):
        self.assertEqual(self.ts_type("Select", options="\nOpen\nClosed"), '"" | "Open" | "Closed"')

    def test_a_select_without_options_is_a_string(self):
        self.assertEqual(self.ts_type("Select"), "string")

    def test_a_child_table_is_an_array_of_the_child_interface(self):
        self.assertEqual(self.ts_type("Table", options="Sample Order Item"), "SampleOrderItemDocType[]")
        self.assertEqual(self.ts_type("Table MultiSelect", options="Sample Tag"), "SampleTagDocType[]")

    def test_the_child_interface_is_imported(self):
        ts = render_interface(doctype("Sample Order", [
            field("items", "Table", options="Sample Order Item"),
            field("more_items", "Table", options="Sample Order Item"),
            field("tags", "Table MultiSelect", options="Sample Tag"),
        ]))
        self.assertTrue(ts.startswith(
            'import type { SampleOrderItemDocType } from "./SampleOrderItem";\n'
            'import type { SampleTagDocType } from "./SampleTag";\n\n'), ts)

    def test_a_field_not_required_is_optional_and_may_be_null(self):
        # Frappe sends null for an empty field, so the type says so (owner, 2026-11-17, #1703).
        ts = render_interface(doctype("Sample", [field("a", "Data", reqd=1), field("b", "Data")]))
        self.assertIn("\ta: string\n", ts)
        self.assertIn("\tb?: string | null\n", ts)

    def test_a_column_frappe_stores_not_null_is_never_null(self):
        # Frappe's schema makes Check, Int, Float, Currency and Percent `not null default 0`, and sends a child table
        # as a list, empty or not.
        fields = [field(ft.lower(), ft) for ft in ("Check", "Int", "Float", "Currency", "Percent")]
        ts = render_interface(doctype("Sample", fields + [field("items", "Table", options="Sample Item")]))
        for name, ts_type in (("check", "0 | 1"), ("int", "number"), ("float", "number"), ("currency", "number"),
                              ("percent", "number"), ("items", "SampleItemDocType[]")):
            self.assertIn(f"\t{name}?: {ts_type}\n", ts)
        self.assertNotIn("null", ts)

    def test_a_number_frappe_may_leave_empty_may_be_null(self):
        ts = render_interface(doctype("Sample", [field("stars", "Rating"), field("took", "Duration")]))
        self.assertIn("\tstars?: number | null\n", ts)
        self.assertIn("\ttook?: number | null\n", ts)

    def test_each_field_carries_its_label_and_fieldtype(self):
        ts = render_interface(doctype("Sample", [field("vendor", "Link", label="Vendor */ Name", options="Vendors")]))
        self.assertIn("\t/** Vendor * / Name : Link - Vendors */\n\tvendor?: string | null\n", ts)


class Folder(unittest.TestCase):
    """main() over a made-up doctype folder and a made-up output folder."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.src, self.out = Path(tmp.name, "app", "doctype"), Path(tmp.name, "doctypes")
        self.write_doctype(doctype("Sample Order", [field("items", "Table", options="Sample Order Item")]))
        self.write_doctype(doctype("Sample Order Item", [field("qty", "Float")], istable=1))

    def write_doctype(self, dt):
        folder = self.src / dt["name"].lower().replace(" ", "_")
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{folder.name}.json").write_text(json.dumps(dt))
        (folder / "other.json").write_text("{}")  # a doctype folder's other JSON (a report, a fixture) is not one

    def run_main(self, *flags):
        return main(["--doctypes", str(self.src.parent), "--out", str(self.out), *flags])

    def snapshot(self):
        return {p.name: p.read_text() for p in sorted(self.out.iterdir())}

    def test_one_generated_file_per_doctype_with_a_do_not_edit_header(self):
        self.assertEqual(self.run_main(), 0)
        files = self.snapshot()
        self.assertEqual(sorted(files), ["SampleOrder.ts", "SampleOrderItem.ts"])
        for text in files.values():
            self.assertTrue(text.startswith("// Generated by scripts/generate_doctype_types.py"), text)
            self.assertIn("Do not edit", text.splitlines()[0])
        self.assertIn("items?: SampleOrderItemDocType[]", files["SampleOrder.ts"])

    def test_running_twice_changes_nothing(self):
        self.run_main()
        first = {p.name: p.stat().st_mtime_ns for p in self.out.iterdir()}, self.snapshot()
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(({p.name: p.stat().st_mtime_ns for p in self.out.iterdir()}, self.snapshot()), first)

    def test_check_passes_when_the_folder_is_current(self):
        self.run_main()
        self.assertEqual(self.run_main("--check"), 0)

    def test_check_fails_on_a_doctype_changed_without_regenerating_and_writes_nothing(self):
        self.run_main()
        before = self.snapshot()
        self.write_doctype(doctype("Sample Order Item", [field("qty", "Float"), field("rate", "Currency")], istable=1))
        self.assertEqual(self.run_main("--check"), 1)
        self.assertEqual(self.snapshot(), before)

    def test_check_fails_on_a_hand_edited_file(self):
        self.run_main()
        path = self.out / "SampleOrder.ts"
        path.write_text(path.read_text().replace("SampleOrderItemDocType[]", "any[]"))
        self.assertEqual(self.run_main("--check"), 1)

    def test_a_removed_doctype_loses_its_file_and_check_sees_the_leftover(self):
        self.run_main()
        (self.src / "sample_order" / "sample_order.json").unlink()
        self.assertEqual(self.run_main("--check"), 1)
        self.run_main()
        self.assertEqual(sorted(self.snapshot()), ["SampleOrderItem.ts"])

    @unittest.skipIf(sys.version_info < (3, 10), "EncodingWarning arrived in Python 3.10")
    def test_a_non_ascii_option_round_trips_whatever_the_platform_encoding(self):
        # Windows reads and writes in cp1252 unless told otherwise: -X warn_default_encoding turns every
        # read or write that leaves the encoding to the platform into an error, here on any OS.
        self.write_doctype(doctype("Sample Order", [field("site", "Select", options="Bengaluru\nPune \u2013 Hinjewadi")]))
        cmd = [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", str(SCRIPT),
               "--doctypes", str(self.src.parent), "--out", str(self.out)]
        for flags in ([], ["--check"]):
            run = subprocess.run(cmd + flags, capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(run.returncode, 0, run.stderr)
        raw = (self.out / "SampleOrder.ts").read_bytes()
        self.assertIn('"Pune \u2013 Hinjewadi"'.encode("utf-8"), raw)
        self.assertNotIn(b"\r\n", raw)


class RealDocTypes(unittest.TestCase):
    def test_the_committed_folder_matches_this_repos_doctype_json(self):
        self.assertEqual(main(["--check"]), 0, "run python3 scripts/generate_doctype_types.py and commit the output")


if __name__ == "__main__":
    unittest.main()
