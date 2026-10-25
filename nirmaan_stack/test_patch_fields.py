# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Every doctype field a patch in `patches.txt` reads or writes by name is a field of that doctype.

Pure: no bench, no site, no DB. It reads the patch sources and the doctype JSON from disk.

THE BUG THIS EXISTS TO PREVENT
    Spec #1520 took `Cheques.clearance_date` off the doctype while `patches/v3_0/cheque_types_pending_and_dates`
    still selected it. A site that gets Cheques from the final JSON and then runs that patch crashes at migrate on
    a missing column. Only a reviewer caught it. A patch is append-only history, so it keeps naming the fields
    that existed when it was written; a later schema change has to keep them (hidden) or the patch breaks.

WHAT IT READS, PER PATCH MODULE
    * `frappe.get_all` / `get_list` / `frappe.db.get_all` / `get_list`: `fields`, `filters`, `or_filters`,
      `order_by`, `group_by`, `pluck`;
    * `frappe.db.get_value` / `get_values` / `set_value` / `exists` / `count` / `delete`: field names and filter
      keys;
    * raw SQL (any string in the module that names `"tab<Doctype>"` and is a SELECT / UPDATE / INSERT / DELETE /
      CREATE INDEX): qualified columns (`alias.col`, `"tabX".col`) against their table, unqualified ones against
      the union of the statement's tables. `ALTER TABLE` is skipped: renaming or dropping a column names the old
      one on purpose.
    A doctype or field given as a module constant (also one imported from another nirmaan_stack module) is
    resolved; anything built at run time is skipped, not guessed.

WHAT COUNTS AS PRESENT
    A field of the doctype's JSON (Table fields included), Frappe's standard columns (`STANDARD_FIELDS`), and
    any field the patch guards: `frappe.db.has_column(dt, field)` or `meta.has_field(field)` anywhere in the
    module allows that field, and `frappe.db.get_table_columns(dt)` allows every field of `dt` -- the patch
    checks before it reads. A doctype with no JSON here or in frappe (a deleted one) is not checked; Single
    doctypes are not checked either (their values live in `tabSingles`, where a missing key does not crash).

A REAL VIOLATION
    Keep the field on the doctype (hidden), or add a `has_column` guard in a NEW patch -- never edit the old
    patch. Only when neither is right, add an entry to `ALLOWED` saying why.

Run:  devenv.sh unit nirmaan_stack.test_patch_fields
"""

import ast
import importlib.util
import json
import re
import unittest
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent            # the `nirmaan_stack` package
PATCHES_TXT = APP_DIR / "patches.txt"

STANDARD_FIELDS = frozenset({
    "name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
    "parent", "parentfield", "parenttype",
    "_user_tags", "_comments", "_assign", "_liked_by", "_seen",
})
TREE_FIELDS = frozenset({"lft", "rgt", "old_parent"})

# (patch module, doctype, field): why a reference that is not in the doctype JSON is accepted. The first two are
# real, unguarded reads of a column the doctype has since dropped (found when this guard was written): every
# deployed site has run them and a fresh install marks them done without running them, so only a site that has
# not run them AND has no such column would fail. Patches are append-only, so they are listed, not edited.
_V29 = "nirmaan_stack.patches.v2_9.remove_scheduled_status_and_cleanup"
_TDS = "nirmaan_stack.patches.v3_0.restructure_tds_repository_to_tds_items"
ALLOWED: dict = {
    (_V29, "PO Payment Terms", "status"):
        "real, unguarded: the commit that added this patch (284361971) also dropped `status`; it copies the "
        "orphaned column into `term_status`",
    ("nirmaan_stack.patches.v3_0.migrate_project_gst", "Projects", "project_gst_number"):
        "real, unguarded: `project_gst_number` was dropped by 12fb5e50b (2026-06-12), months after this patch "
        "(c5539c1cc, 2026-03-27)",
    ("nirmaan_stack.patches.v3_0.migrate_general_specs_to_child_table", "BOQs", "master_preamble"):
        "guarded by its sibling: dropped in the same change as `general_specs_sheet` (b5381c0cc), which the "
        "patch checks with has_column before this SELECT",
    (_TDS, "TDS Repository", "tds_item_id"): "read in `_read_legacy_rows`, which catches the missing column, "
                                             "rolls back and skips",
    (_TDS, "TDS Repository", "tds_item_name"): "as tds_item_id",
    (_TDS, "TDS Repository", "category"): "as tds_item_id",
}

GET_LIST = {"frappe.get_all", "frappe.get_list", "frappe.db.get_all", "frappe.db.get_list"}
GET_VALUE = {"frappe.db.get_value", "frappe.db.get_values"}
FILTER_ONLY = {"frappe.db.exists", "frappe.db.count", "frappe.db.delete"}
NOT_SQL_CALLS = re.compile(r"(^|\.)(print|log|log_error|msgprint|throw|info|debug|warning|error|logger|append)$")

IDENT = r"[A-Za-z_][A-Za-z0-9_]*"
TABLE_REF = re.compile(r'["`]tab([^"`]+)["`]')
SQL_VERB = re.compile(r"\b(select|update|insert\s+into|delete\s+from|create\s+(unique\s+)?index)\b", re.I)
SQL_KEYWORDS = frozenset("""
    select from where and or not null is in as on join left right inner outer full cross natural group by order asc
    desc limit offset having distinct update set insert into values delete case when then else end exists between
    like ilike similar escape true false union all any some with recursive returning using cast interval for nowait
    skip locked share of only default create index unique if concurrently table column add drop alter primary key
    to except intersect leading trailing both at time zone do nothing conflict excluded nulls first last filter over
    partition rows range preceding following current row unbounded lateral within array
    date numeric decimal text integer int bigint smallint varchar char character varying boolean bool timestamp
    timestamptz double precision real float json jsonb uuid
    current_date current_timestamp current_time localtimestamp year month day hour minute second epoch
""".split())


@dataclass(frozen=True)
class Ref:
    """One field a patch names: where, which doctype and field, and through what."""

    patch: str
    line: int
    doctype: str
    field: str
    via: str


@dataclass(frozen=True)
class Doctype:
    fields: frozenset
    single: bool


# ---------------------------------------------------------------- doctype schemas

def _doctype_jsons(root: Path):
    yield from root.glob("*/doctype/*/*.json")


@lru_cache(maxsize=None)
def load_doctypes() -> dict:
    """{doctype name: Doctype} for every doctype JSON of this app and of frappe (when frappe is importable)."""
    roots = [APP_DIR]
    spec = importlib.util.find_spec("frappe")
    if spec and spec.origin:
        roots.append(Path(spec.origin).parent)
    out = {}
    for root in roots:
        for path in _doctype_jsons(root):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            if not isinstance(data, dict) or data.get("doctype") != "DocType" or not data.get("name"):
                continue
            fields = {f["fieldname"] for f in data.get("fields", []) if f.get("fieldname")}
            if data.get("is_tree"):
                fields |= TREE_FIELDS
            out[data["name"]] = Doctype(frozenset(fields), bool(data.get("issingle")))
    # A Workflow adds its state field to the doctype as a custom field; ours ship in fixtures/workflow.json.
    workflows = APP_DIR / "fixtures" / "workflow.json"
    if workflows.exists():
        for w in json.loads(workflows.read_text(encoding="utf-8")):
            d = out.get(w.get("document_type"))
            if d and w.get("workflow_state_field"):
                out[w["document_type"]] = Doctype(d.fields | {w["workflow_state_field"]}, d.single)
    return out


# ---------------------------------------------------------------- patch sources

def patch_modules() -> list:
    """Every dotted patch module listed in patches.txt, in order (comments and `execute:` lines left out)."""
    out = []
    for line in PATCHES_TXT.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line and not line.startswith("[") and not line.startswith("execute:"):
            out.append(line)
    return out


def module_path(dotted: str) -> Path:
    return APP_DIR.parent.joinpath(*dotted.split(".")).with_suffix(".py")


class _Module:
    """One parsed module: its constants (also imported ones) resolved to strings or lists of strings."""

    def __init__(self, dotted: str, depth: int = 0):
        self.dotted = dotted
        self.tree = ast.parse(module_path(dotted).read_text(encoding="utf-8"))
        self.depth = depth
        self.imports = {}     # local name -> (module, name or None for a module)
        self.assigned = {}    # name -> value node, for names assigned exactly once
        counts = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                for a in node.names:
                    self.imports[a.asname or a.name] = (node.module, a.name)
            elif isinstance(node, ast.Import):
                for a in node.names:
                    if a.asname:
                        self.imports[a.asname] = (a.name, None)
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for t in targets:
                    if isinstance(t, ast.Name):
                        counts[t.id] = counts.get(t.id, 0) + 1
                        self.assigned[t.id] = node.value
        self.assigned = {k: v for k, v in self.assigned.items() if counts[k] == 1 and v is not None}

    def resolve(self, node, _seen=()):
        """A str, a list of str, a dict with str keys, or None when the value is built at run time."""
        if node is None:
            return None
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            items = [self.resolve(e, _seen) for e in node.elts]
            return items if all(isinstance(i, (str, list)) for i in items) else None
        if isinstance(node, ast.Dict):
            keys = [self.resolve(k, _seen) if k is not None else None for k in node.keys]
            return {k: v for k, v in zip(keys, node.values) if isinstance(k, str)}
        if isinstance(node, ast.JoinedStr):
            return self.render(node, _seen)
        if isinstance(node, ast.Name):
            if node.id in _seen:
                return None
            if node.id in self.assigned:
                return self.resolve(self.assigned[node.id], _seen + (node.id,))
            if node.id in self.imports:
                mod, name = self.imports[node.id]
                return _imported(mod, name, self.depth)
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in self.imports:
            mod, name = self.imports[node.value.id]
            return _imported(f"{mod}.{name}" if name else mod, node.attr, self.depth)
        return None

    def render(self, node: ast.JoinedStr, _seen=()) -> str:
        """An f-string with every resolvable part filled in and every other part left as `__runtime__`."""
        parts = []
        for v in node.values:
            if isinstance(v, ast.Constant):
                parts.append(str(v.value))
            else:
                value = self.resolve(v.value, _seen)
                parts.append(value if isinstance(value, str) else "__runtime__")
        return "".join(parts)


@lru_cache(maxsize=None)
def _module(dotted: str, depth: int = 0):
    if not dotted.startswith("nirmaan_stack") or depth > 3 or not module_path(dotted).exists():
        return None
    return _Module(dotted, depth)


def _imported(mod: str, name: str, depth: int):
    if name is None:
        return None
    m = _module(mod, depth + 1)
    if m is None:
        return None
    return m.resolve(ast.Name(id=name, ctx=ast.Load()))


# ---------------------------------------------------------------- what one patch names

def _call_name(node: ast.Call) -> str:
    try:
        return ast.unparse(node.func)
    except Exception:
        return ""


def _arg(node: ast.Call, pos: int, kw: str):
    for k in node.keywords:
        if k.arg == kw:
            return k.value
    return node.args[pos] if len(node.args) > pos else None


def _field_of(expr: str):
    """(doctype or None, field) for one fields / order_by entry, or None when it names no plain field."""
    expr = expr.strip()
    expr = re.sub(r"\s+(asc|desc)$", "", expr, flags=re.I)
    expr = re.sub(r"\s+as\s+" + IDENT + "$", "", expr, flags=re.I)
    m = re.fullmatch(r"[`\"]?tab([^`\"]+)[`\"]?\.[`\"]?(" + IDENT + r")[`\"]?", expr)
    if m:
        return m.group(1), m.group(2)
    m = re.fullmatch(IDENT + r"\(\s*(?:distinct\s+)?[`\"]?(" + IDENT + r")[`\"]?\s*\)", expr, flags=re.I)
    if m:
        return None, m.group(1)
    m = re.fullmatch(r"[`\"]?(" + IDENT + r")[`\"]?", expr)
    return (None, m.group(1)) if m else None


def _field_list(value) -> list:
    """Entries of a fields / order_by / group_by / fieldname value (a str may be comma separated)."""
    if isinstance(value, str):
        return [p for p in value.split(",") if p.strip()]
    if isinstance(value, list):
        return [v for v in value if isinstance(v, str)]
    return []


def _filter_fields(mod: _Module, node) -> list:
    """(doctype or None, field) for every key of a dict filter or field of a list filter."""
    value = mod.resolve(node)
    out = []
    if isinstance(value, dict):
        out += [(None, k) for k in value]
    elif isinstance(node, (ast.List, ast.Tuple)):
        for e in node.elts:
            if isinstance(e, (ast.List, ast.Tuple)) and len(e.elts) in (3, 4):
                parts = [mod.resolve(x) for x in e.elts]
                if len(parts) == 4 and isinstance(parts[0], str) and isinstance(parts[1], str):
                    out.append((parts[0], parts[1]))
                elif len(parts) == 3 and isinstance(parts[0], str):
                    out.append((None, parts[0]))
    return [(dt, f) for dt, f in out if "." not in f]


def _sql_strings(mod: _Module):
    """(line, text) for every string in the module that looks like SQL naming a `tab` table."""
    skip = set()
    for node in ast.walk(mod.tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                skip.add(id(first.value))
        if isinstance(node, ast.Call) and NOT_SQL_CALLS.search(_call_name(node)):
            for a in list(node.args) + [k.value for k in node.keywords]:
                for sub in ast.walk(a):
                    skip.add(id(sub))
    for node in ast.walk(mod.tree):
        if id(node) in skip:
            continue
        if isinstance(node, ast.JoinedStr):
            for sub in ast.walk(node):
                skip.add(id(sub))
            text = mod.render(node)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            text = node.value
        else:
            continue
        if TABLE_REF.search(text) and SQL_VERB.search(text) and not re.search(r"\balter\s+table\b", text, re.I):
            yield node.lineno, text


def _strip_sql(text: str) -> str:
    text = re.sub(r"--[^\n]*", " ", text)
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"'(?:[^']|'')*'", " '' ", text)
    text = re.sub(r"%\(\w+\)s|%s", " __param__ ", text)
    text = re.sub(r"\{[^{}]*\}", " __runtime__ ", text)
    text = re.sub(r"::\s*\w+(\s*\(\s*\d+\s*(,\s*\d+\s*)?\))?(\[\])?", " ", text)
    return text


def sql_refs(text: str) -> list:
    """(doctype, column, tables) for every column a SQL statement names. The doctype is None for an unqualified
    column, which may belong to any of `tables`, the doctypes the statement names."""
    text = _strip_sql(text)
    aliases, tables = {}, []
    for m in re.finditer(r'["`]tab([^"`]+)["`](?:\s+(?:as\s+)?(' + IDENT + r"))?", text, flags=re.I):
        tables.append(m.group(1))
        alias = m.group(2)
        if alias and alias.lower() not in SQL_KEYWORDS:
            aliases[alias] = m.group(1)
    out = []
    qualified = re.compile(r'(["`]tab[^"`]+["`]|' + IDENT + r')\.\s*["`]?(' + IDENT + r'|\*)["`]?')
    for m in qualified.finditer(text):
        q = m.group(1)
        dt = q[4:-1] if q[0] in "\"`" else aliases.get(q)
        if dt and m.group(2) != "*":
            out.append((dt, m.group(2)))
    rest = qualified.sub(" ", text)
    rest = TABLE_REF.sub(" ", rest)
    defined = {a.lower() for a in aliases}
    defined |= {m.group(1).lower() for m in re.finditer(r"\bas\s+[\"`]?(" + IDENT + ")", rest, flags=re.I)}
    defined |= {m.group(1).lower() for m in re.finditer(r"\)\s+(" + IDENT + r")\b", rest)}  # derived-table alias
    defined |= {m.group(1).lower() for m in re.finditer(r"\b(" + IDENT + r")\s+as\s*\(", rest, flags=re.I)}  # CTE
    for m in re.finditer(r"\b(?:from|join)\s+(" + IDENT + r")(?:\s+(?:as\s+)?(" + IDENT + r"))?", rest, flags=re.I):
        defined |= {g.lower() for g in m.groups() if g and g.lower() not in SQL_KEYWORDS}  # a CTE read, its alias
    words = re.finditer(r'"(' + IDENT + r')"|`(' + IDENT + r')`|\b(' + IDENT + r')\b(\s*\()?', rest)
    for m in words:
        word = m.group(1) or m.group(2) or m.group(3)
        if m.group(4) or word.lower() in SQL_KEYWORDS or word.lower() in defined or word.startswith("__"):
            continue
        out.append((None, word))
    return [(dt, col, tuple(tables)) for dt, col in out]


def _guards(mod: _Module):
    """({(doctype, field)} a patch checks with has_column, {field} it checks with has_field, {doctype} whose
    columns it reads with get_table_columns)."""
    loops = {}   # loop variable -> the constant list it runs over (`for column in OLD_COLUMNS`)
    for node in ast.walk(mod.tree):
        if isinstance(node, (ast.For, ast.comprehension)) and isinstance(node.target, ast.Name):
            values = mod.resolve(node.iter)
            if isinstance(values, list):
                loops[node.target.id] = [v for v in values if isinstance(v, str)]
    columns, fields, tables = set(), set(), set()
    for node in ast.walk(mod.tree):
        if not isinstance(node, ast.Call):
            continue
        name = _call_name(node)
        # frappe.db.has_column, and a patch's own helper such as `_column_exists("tabX", "col")`.
        if re.search(r"(has_column|column_exists)$", name) and len(node.args) >= 2:
            dt, f = mod.resolve(node.args[0]), mod.resolve(node.args[1])
            if isinstance(node.args[1], ast.Name) and f is None:
                f = loops.get(node.args[1].id)
            if isinstance(dt, str):
                dt = dt[3:] if dt.startswith("tab") else dt
                for one in [f] if isinstance(f, str) else f or []:
                    columns.add((dt, one))
        elif name.endswith("has_field") and node.args:
            f = mod.resolve(node.args[0])
            if isinstance(f, str):
                fields.add(f)
        elif name.endswith("get_table_columns") and node.args:
            dt = mod.resolve(node.args[0])
            if isinstance(dt, str):
                tables.add(dt)
    return columns, fields, tables


def scan_patch(dotted: str) -> list:
    """Every (doctype, field) reference the patch makes, as Ref rows (unqualified SQL columns carry the
    doctypes they may belong to, joined by ` | `)."""
    mod = _Module(dotted)
    refs = []

    def add(line, dt, field, via):
        if isinstance(dt, str) and isinstance(field, str) and field and "__" not in dt and not field.startswith("__"):
            refs.append(Ref(dotted, line, dt, field, via))

    for node in ast.walk(mod.tree):
        if not isinstance(node, ast.Call):
            continue
        name = _call_name(node)
        if name in GET_LIST:
            dt = mod.resolve(_arg(node, 0, "doctype"))
            filters, fields = _arg(node, 99, "filters"), _arg(node, 99, "fields")
            if len(node.args) > 1:
                first = mod.resolve(node.args[1])
                if isinstance(first, dict) or (isinstance(node.args[1], (ast.List, ast.Tuple)) and node.args[1].elts
                                               and isinstance(node.args[1].elts[0], (ast.List, ast.Tuple))):
                    filters = filters or node.args[1]
                else:
                    fields = fields or node.args[1]
            for kw in ("fields", "order_by", "group_by", "pluck"):
                value = mod.resolve(fields if kw == "fields" else _arg(node, 99, kw))
                for entry in _field_list(value):
                    got = _field_of(entry)
                    if got:
                        add(node.lineno, got[0] or dt, got[1], f"{name} {kw}")
            for key in ("filters", "or_filters"):
                f_node = filters if key == "filters" else _arg(node, 99, "or_filters")
                for fdt, f in _filter_fields(mod, f_node):
                    add(node.lineno, fdt or dt, f, f"{name} {key}")
        elif name in GET_VALUE or name in FILTER_ONLY or name == "frappe.db.set_value":
            dt = mod.resolve(_arg(node, 0, "doctype"))
            for fdt, f in _filter_fields(mod, _arg(node, 1, "filters" if name != "frappe.db.set_value" else "dn")):
                add(node.lineno, fdt or dt, f, f"{name} filters")
            if name in GET_VALUE:
                for entry in _field_list(mod.resolve(_arg(node, 2, "fieldname"))):
                    got = _field_of(entry)
                    if got:
                        add(node.lineno, got[0] or dt, got[1], f"{name} fieldname")
            elif name == "frappe.db.set_value":
                value = mod.resolve(_arg(node, 2, "field"))
                for f in (value if isinstance(value, dict) else [value] if isinstance(value, str) else []):
                    add(node.lineno, dt, f, f"{name} field")

    for line, text in _sql_strings(mod):
        for dt, col, tables in sql_refs(text):
            if dt:
                add(line, dt, col, "sql")
            elif tables and not any("__" in t for t in tables):
                add(line, " | ".join(sorted(set(tables))), col, "sql")
    return list(dict.fromkeys(refs))


def violations(dotted: str, doctypes: dict | None = None) -> list:
    """The Refs of one patch that name a field its doctype does not have and the patch does not guard."""
    doctypes = load_doctypes() if doctypes is None else doctypes
    columns, has_field, introspected = _guards(_Module(dotted))
    out = []
    for ref in scan_patch(dotted):
        names = ref.doctype.split(" | ")
        known = [doctypes.get(n) for n in names]
        if any(d is None or d.single for d in known) or ref.field in STANDARD_FIELDS or ref.field in has_field:
            continue
        if any(ref.field in d.fields or (n, ref.field) in columns or n in introspected
               for n, d in zip(names, known)):
            continue
        if (ref.patch, ref.doctype, ref.field) in ALLOWED:
            continue
        out.append(ref)
    return out


def all_violations(doctypes: dict | None = None) -> list:
    return [v for m in patch_modules() for v in violations(m, doctypes)]


def _report(refs: list) -> str:
    return "\n".join(f"  {r.patch}:{r.line} {r.doctype}.{r.field} ({r.via})" for r in refs)


# ---------------------------------------------------------------- tests

class TestPatchesNameOnlyFieldsTheirDoctypesHave(unittest.TestCase):
    def test_no_patch_names_a_missing_field(self):
        found = all_violations()
        self.assertEqual(found, [], "a patch names a field its doctype JSON no longer has "
                                    "(keep the field, or see this module's docstring):\n" + _report(found))

    def test_every_allow_list_entry_is_still_needed(self):
        # An entry whose reference has gone (or whose field came back) only hides the next real one.
        found = {(r.patch, r.doctype, r.field) for r in all_violations_unfiltered()}
        self.assertEqual(sorted(set(ALLOWED) - found), [], "ALLOWED entries that match nothing any more")


def all_violations_unfiltered() -> list:
    saved = dict(ALLOWED)
    ALLOWED.clear()
    try:
        return all_violations()
    finally:
        ALLOWED.update(saved)


class TestTheScanCatchesTheClearanceDateBug(unittest.TestCase):
    """The negative half: put #1520's mistake back (Cheques without `clearance_date`) and the scan must name
    the patch that selects it, and only that one -- the later patch reads it behind `has_column`."""

    def _without(self, doctype: str, field: str) -> dict:
        doctypes = dict(load_doctypes())
        d = doctypes[doctype]
        doctypes[doctype] = Doctype(d.fields - {field}, d.single)
        return doctypes

    def test_dropping_clearance_date_flags_the_cheque_types_patch(self):
        found = all_violations(self._without("Cheques", "clearance_date"))
        hits = {(r.patch, r.doctype, r.field) for r in found}
        self.assertIn(("nirmaan_stack.patches.v3_0.cheque_types_pending_and_dates", "Cheques", "clearance_date"),
                      hits, _report(found))
        self.assertNotIn(("nirmaan_stack.patches.v3_0.cheque_date_from_clearance_date", "Cheques",
                          "clearance_date"), hits, "a has_column-guarded read is allowed")

    def test_dropping_a_raw_sql_column_is_caught(self):
        # The SQL half: cheque_date_from_clearance_date writes `cheque_date` with a raw UPDATE.
        found = all_violations(self._without("Cheques", "cheque_date"))
        self.assertIn(("nirmaan_stack.patches.v3_0.cheque_date_from_clearance_date", "Cheques", "cheque_date"),
                      {(r.patch, r.doctype, r.field) for r in found}, _report(found))


class TestTheScanItself(unittest.TestCase):
    """Guards the scan: a parser that found nothing would make the first test pass vacuously."""

    def test_it_reads_every_listed_patch_and_finds_references(self):
        modules = patch_modules()
        self.assertGreater(len(modules), 150)
        self.assertTrue(all(module_path(m).exists() for m in modules))
        refs = [r for m in modules for r in scan_patch(m)]
        self.assertGreater(len(refs), 1000)
        self.assertGreater(sum(r.via == "sql" for r in refs), 400)

    def test_it_knows_this_apps_doctypes(self):
        doctypes = load_doctypes()
        self.assertIn("clearance_date", doctypes["Cheques"].fields)
        self.assertGreater(len(doctypes), 150)

    def test_sql_columns_resolve_through_aliases_and_skip_literals(self):
        refs = sql_refs("""SELECT p.amount, p.status AS st, coalesce(x, 0) FROM "tabProject Payments" p
                           WHERE p.vendor = %(v)s AND note = 'status is odd' AND created::date > %s""")
        self.assertIn(("Project Payments", "amount", ("Project Payments",)), refs)
        self.assertIn(("Project Payments", "status", ("Project Payments",)), refs)
        unqualified = {col for dt, col, _ in refs if dt is None}
        self.assertEqual(unqualified, {"x", "note", "created"})

    def test_a_field_entry_is_read_from_its_usual_spellings(self):
        self.assertEqual(_field_of("amount"), (None, "amount"))
        self.assertEqual(_field_of("sum(amount) as total"), (None, "amount"))
        self.assertEqual(_field_of("`tabCheque Line`.payment_name"), ("Cheque Line", "payment_name"))
        self.assertEqual(_field_of("creation desc"), (None, "creation"))
        self.assertIsNone(_field_of("count(*) as n"))


if __name__ == "__main__":
    unittest.main()
