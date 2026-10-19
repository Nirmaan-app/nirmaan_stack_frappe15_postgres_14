"""CU-A AC1: the index manifest and ensure_indexes().

The manifest is checked against what the code declares TODAY (every `search_index` field of every
nirmaan doctype, read from live meta, and every add_index / add_unique call in a doctype controller,
read from source), so a new declaration with no manifest entry fails here. ensure_indexes() is
exercised ONLY on a temporary table this test creates and drops: no real doctype is altered.
"""
import ast
import glob
import os

import frappe
from frappe.database.schema import get_definition
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services import index_manifest
from nirmaan_stack.services.index_manifest import INDEXES, PG_NAME_MAX, ensure_indexes, index_name

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE_DOCTYPE = "ZZ CUA Index Probe"
PROBE_TABLE = f"tab{PROBE_DOCTYPE}"
PROBE_COLUMN = "zz_probe_col"
PROBE_NAME = index_name(PROBE_DOCTYPE, (PROBE_COLUMN,))
PROBE_MANIFEST = ((PROBE_DOCTYPE, (PROBE_COLUMN,), PROBE_NAME, False),)


def _search_index_entries() -> set:
    """(doctype, (field,), False) for every search_index field Frappe would index, nirmaan doctypes only."""
    modules = tuple(frappe.get_module_list("nirmaan_stack"))
    doctypes = frappe.get_all(
        "DocType",
        filters={"module": ["in", modules], "issingle": 0, "custom": 0, "is_virtual": 0},
        pluck="name",
    )
    out = set()
    for doctype in doctypes:
        for f in frappe.get_meta(doctype).fields:
            if not f.search_index or f.is_virtual:
                continue
            # Frappe's own rule (schema.py build_for_alter_table): no column, or a text column, no index.
            if get_definition(f.fieldtype, f.precision, f.length) in (None, "text", "longtext"):
                continue
            out.add((doctype, (f.fieldname,), False))
    return out


def _controller_calls() -> dict:
    """{(doctype, columns, unique): explicit name or None} for every add_index / add_unique call in a
    doctype controller, read from the source."""
    out = {}
    for path in glob.glob(os.path.join(APP_DIR, "nirmaan_stack", "doctype", "*", "*.py")):
        if os.path.basename(path).startswith("test_"):
            continue
        with open(path, encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ("add_index", "add_unique")):
                continue
            args = [ast.literal_eval(a) for a in node.args]
            kwargs = {k.arg: ast.literal_eval(k.value) for k in node.keywords}
            fields = [args[1]] if isinstance(args[1], str) else list(args[1])
            name = args[2] if len(args) > 2 else kwargs.get("index_name") or kwargs.get("constraint_name")
            out[(args[0], tuple(fields), node.func.attr == "add_unique")] = name
    return out


def _expected_keys() -> set:
    return _search_index_entries() | set(_controller_calls())


def _manifest_keys(manifest) -> set:
    return {(doctype, tuple(cols), unique) for doctype, cols, _name, unique in manifest}


class TestTheManifestMatchesTheDeclarations(FrappeTestCase):
    """The manifest lists exactly what the code declares -- nothing missing, nothing stale."""

    def test_the_manifest_equals_the_declared_set(self):
        expected = _expected_keys()
        manifest = _manifest_keys(INDEXES)
        self.assertEqual(sorted(expected - manifest), [], "declared but missing from the manifest")
        self.assertEqual(sorted(manifest - expected), [], "in the manifest but declared nowhere")
        self.assertEqual(len(INDEXES), len(manifest), "a key appears twice in the manifest")

    def test_a_new_search_index_field_without_an_entry_is_caught(self):
        # Negative half: drop one search_index entry from a copy of the manifest -- the comparison the
        # test above makes must then report exactly that entry.
        victim = next(e for e in INDEXES if (e[0], e[1], e[3]) in _search_index_entries())
        shortened = tuple(e for e in INDEXES if e is not victim)
        self.assertEqual(_expected_keys() - _manifest_keys(shortened), {(victim[0], victim[1], victim[3])})

    def test_the_controller_scan_finds_the_known_calls(self):
        # Guards the scan itself: a broken AST walk returning nothing would make the equality vacuous.
        calls = _controller_calls()
        self.assertEqual(len(calls), 30)
        self.assertEqual(calls[("Outflow Row Match", ("import_batch",), False)], "ofm_match_batch_idx")
        self.assertIn(("BoQ Committed Sheet Grid Row", ("parent",), False), calls)
        self.assertEqual(len(_search_index_entries()), 92)


class TestTheNames(FrappeTestCase):
    """Every name is unique, fits PostgreSQL, and can never be hit by a bare-name drop."""

    def test_names_are_unique_and_fit(self):
        names = [e[2] for e in INDEXES]
        self.assertEqual(len(names), len(set(names)))
        too_long = [n for n in names if len(n) > PG_NAME_MAX]
        self.assertEqual(too_long, [])

    def test_a_derived_name_uses_the_table_rule(self):
        calls = _controller_calls()
        for doctype, cols, name, unique in INDEXES:
            explicit = calls.get((doctype, tuple(cols), unique))
            if explicit:
                self.assertEqual(name, explicit, "an explicit add_index name is reused, never twinned")
            else:
                self.assertEqual(name, index_name(doctype, cols))

    def test_a_long_name_is_truncated_with_a_stable_hash(self):
        cols = ("boq", "sheet_name", "committed_version", "is_current", "excel_row")
        name = index_name("BoQ Row BCS Rate", cols)
        self.assertLessEqual(len(name), PG_NAME_MAX)
        self.assertEqual(name, index_name("BoQ Row BCS Rate", cols))
        self.assertNotEqual(name, index_name("BoQ Row BCS Rate", cols[:-1] + ("excel_row_x",)))
        self.assertEqual(index_name("Items", ("linked_tds_item",)), "Items_linked_tds_item_idx")

    def test_no_name_is_a_bare_drop_target(self):
        # Frappe's alter drops `"<fieldname>"` and `"unique_<fieldname>"`. No manifest name may be either.
        columns = {r[0] for r in frappe.db.sql(
            "select distinct column_name from information_schema.columns where table_schema = current_schema()"
        )}
        targets = columns | {f"unique_{c}" for c in columns}
        self.assertEqual([e[2] for e in INDEXES if e[2] in targets], [])

    def test_no_name_adds_a_pending_drop(self):
        # Frappe reads a column as indexed when its name appears ANYWHERE in an index definition
        # (case-sensitive LIKE), and then drops `"<field>"` for a field without search_index. The
        # definition already holds the table name and the columns; a name this manifest DERIVES must add
        # no field without search_index. (An explicit controller name predates the manifest and is kept.)
        explicit = set(_controller_calls().values())
        bad = []
        for doctype, cols, name, _unique in INDEXES:
            if name in explicit:
                continue
            already = f'public."tab{doctype}" ({", ".join(cols)})'
            for f in frappe.get_meta(doctype).fields:
                if not f.search_index and f.fieldname in name and f.fieldname not in already:
                    bad.append((name, f.fieldname))
        self.assertEqual(bad, [])

    def test_a_lowercased_slug_would_add_one(self):
        # Negative half: the rule the test above enforces does catch the lowercase form.
        name = "boq_cell_color_boq_idx"
        fields = {f.fieldname for f in frappe.get_meta("BoQ Cell Color").fields}
        self.assertIn("color", fields)
        self.assertIn("color", name)
        self.assertNotIn("color", 'public."tabBoQ Cell Color" (boq)')
        self.assertEqual(index_name("BoQ Cell Color", ("boq",)), "BoQ_Cell_Color_boq_idx")

    def test_no_name_is_owned_by_another_table(self):
        owners = dict(frappe.db.sql(
            "select indexname, tablename from pg_indexes where schemaname = current_schema()"
        ))
        wrong = [(e[2], owners[e[2]]) for e in INDEXES if e[2] in owners and owners[e[2]] != f"tab{e[0]}"]
        self.assertEqual(wrong, [])


class TestEnsureIndexesOnATemporaryTable(FrappeTestCase):
    """ensure_indexes() on a TEMPORARY table, created and dropped here. No real doctype is touched."""

    def setUp(self):
        frappe.db.rollback()
        frappe.db.sql(f'drop table if exists "{PROBE_TABLE}"')
        frappe.db.sql(
            f'create temporary table "{PROBE_TABLE}" (name varchar(140) primary key, "{PROBE_COLUMN}" varchar(140), other varchar(140))'
        )
        frappe.db.commit()
        self.addCleanup(self._drop_probe)

    def _drop_probe(self):
        frappe.db.rollback()
        frappe.db.sql(f'drop table if exists "{PROBE_TABLE}"')
        frappe.db.commit()

    def _probe_indexes(self) -> set:
        return {r[0] for r in frappe.db.sql(
            """select ic.relname from pg_index x join pg_class ic on ic.oid = x.indexrelid
               where x.indrelid = to_regclass(%s)""", (f'"{PROBE_TABLE}"',))}

    def test_a_missing_index_is_created_and_a_second_run_is_a_no_op(self):
        created = ensure_indexes(PROBE_MANIFEST)
        self.assertEqual([c["name"] for c in created], [PROBE_NAME])
        self.assertIn(PROBE_NAME, self._probe_indexes())
        self.assertEqual(ensure_indexes(PROBE_MANIFEST), [], "all present: nothing is created")

    def test_the_created_line_reaches_the_log_file(self):
        path = os.path.join(frappe.utils.get_bench_path(), "logs", "nirmaan_indexes.log")
        start = os.path.getsize(path) if os.path.exists(path) else 0
        ensure_indexes(PROBE_MANIFEST)
        with open(path, encoding="utf-8") as fh:
            fh.seek(start)
            self.assertIn(f"created {PROBE_NAME}", fh.read())

    def test_a_deleted_named_index_is_recreated(self):
        ensure_indexes(PROBE_MANIFEST)
        frappe.db.sql_ddl(f'drop index "{PROBE_NAME}"')
        self.assertNotIn(PROBE_NAME, self._probe_indexes())
        created = ensure_indexes(PROBE_MANIFEST)
        self.assertEqual([c["name"] for c in created], [PROBE_NAME])
        self.assertIn(PROBE_NAME, self._probe_indexes())

    def test_the_bare_name_drop_leaves_the_named_twin(self):
        # Frappe's alter: `CREATE INDEX IF NOT EXISTS "<field>"` ... later `DROP INDEX IF EXISTS "<field>"`.
        frappe.db.sql_ddl(f'create index if not exists "{PROBE_COLUMN}" on "{PROBE_TABLE}" ("{PROBE_COLUMN}")')
        ensure_indexes(PROBE_MANIFEST)
        self.assertEqual(self._probe_indexes() >= {PROBE_COLUMN, PROBE_NAME}, True)
        frappe.db.sql_ddl(f'drop index if exists "{PROBE_COLUMN}"')
        indexes = self._probe_indexes()
        self.assertNotIn(PROBE_COLUMN, indexes, "the bare-name drop did run")
        self.assertIn(PROBE_NAME, indexes, "the named twin survived it")

    def test_ensure_never_drops_an_index_it_does_not_list(self):
        frappe.db.sql_ddl(f'create index "zz_cua_probe_other" on "{PROBE_TABLE}" (other)')
        ensure_indexes(PROBE_MANIFEST)
        self.assertIn("zz_cua_probe_other", self._probe_indexes())

    def test_a_name_owned_by_another_table_is_refused_not_created(self):
        # Negative: the name exists on a different table -> nothing is built, nothing is dropped.
        owner = frappe.db.sql(
            "select indexname, tablename from pg_indexes where schemaname = current_schema() limit 1"
        )[0]
        clash = ((PROBE_DOCTYPE, (PROBE_COLUMN,), owner[0], False),)
        self.assertEqual(ensure_indexes(clash), [])
        self.assertNotIn(owner[0], self._probe_indexes())
        self.assertEqual(
            frappe.db.sql("select tablename from pg_indexes where indexname = %s", (owner[0],))[0][0], owner[1]
        )

    def test_a_missing_column_is_skipped(self):
        absent = ((PROBE_DOCTYPE, ("zz_no_such_col",), "zz_cua_probe_absent_idx", False),)
        self.assertEqual(ensure_indexes(absent), [])
        self.assertNotIn("zz_cua_probe_absent_idx", self._probe_indexes())

    def test_the_hook_is_wired(self):
        self.assertIn(
            "nirmaan_stack.services.index_manifest.ensure_indexes", frappe.get_hooks("after_migrate")
        )
        self.assertIs(index_manifest.ensure_indexes, ensure_indexes)
