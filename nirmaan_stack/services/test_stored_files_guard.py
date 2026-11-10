# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""No module of this app calls Frappe's legacy `frappe.utils.file_manager.save_file`.

That helper writes the bytes to disk itself and then inserts a File whose own `before_insert` writes them again
under a suffixed name; only the second copy is the one `file_url` names, so the storage app uploads and removes
only it, and the first stays on the server's disk with no File row (1,301 orphans from one Cashbook import on
2026-11-07). `services/stored_files.store_file` hands the bytes to the File instead, which writes them once.

Pure: it reads source files only. Run: DEVENV unit nirmaan_stack.services.test_stored_files_guard
"""

import ast
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
LEGACY_MODULE = "frappe.utils.file_manager"
LEGACY_NAME = "save_file"


def _dotted(node) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_dotted(node.value)}.{node.attr}"
    return ""


def legacy_uses(source: str) -> list[str]:
    """Every use of the legacy helper in `source`: its import from the Frappe module, or the attribute read off
    that module (`file_manager.save_file`). A docstring or comment naming it is not a use."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom) and node.module == LEGACY_MODULE:
            if any(alias.name == LEGACY_NAME for alias in node.names):
                found.append(f"line {node.lineno}: from {LEGACY_MODULE} import {LEGACY_NAME}")
        elif isinstance(node, ast.Attribute) and node.attr == LEGACY_NAME:
            if _dotted(node.value).endswith("file_manager"):
                found.append(f"line {node.lineno}: {_dotted(node.value)}.{LEGACY_NAME}")
    return found


def callers() -> dict[str, list[str]]:
    """Every non-test module of the app that uses the legacy helper, with where."""
    found = {}
    for path in PACKAGE.rglob("*.py"):
        if path.name.startswith("test_"):
            continue
        uses = legacy_uses(path.read_text(errors="ignore"))
        if uses:
            found[path.relative_to(PACKAGE.parent).as_posix()] = uses
    return found


class TestNoModuleCallsTheLegacyHelper(unittest.TestCase):
    def test_every_file_this_app_stores_goes_through_store_file(self):
        self.assertEqual(
            callers(), {},
            "These call Frappe's legacy file_manager.save_file, which leaves a second copy of every file on the "
            "server's disk. Store the bytes through nirmaan_stack.services.stored_files.store_file instead.",
        )

    def test_the_scan_sees_each_way_of_reaching_the_helper_and_ignores_prose(self):
        self.assertEqual(len(legacy_uses("from frappe.utils.file_manager import save_file\n")), 1)
        self.assertEqual(len(legacy_uses("from frappe.utils.file_manager import get_file, save_file\n")), 1)
        self.assertEqual(len(legacy_uses("from frappe.utils import file_manager\nf = file_manager.save_file\n")), 1)
        self.assertEqual(len(legacy_uses("import frappe.utils.file_manager\nfrappe.utils.file_manager.save_file(x)\n")), 1)
        self.assertEqual(legacy_uses("from frappe.utils.file_manager import get_file\n"), [])
        self.assertEqual(legacy_uses("from nirmaan_stack.services.stored_files import store_file\n"), [])
        self.assertEqual(legacy_uses('"""`save_file` commits inside the storage hook."""\n# save_file leaks\n'), [])
        self.assertEqual(legacy_uses("storage.save_file(fname, content)\n"), [])
