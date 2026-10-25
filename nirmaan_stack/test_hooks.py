# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""`hooks.py` never repeats a key in one dict (#1548).

Python keeps the LAST of two equal keys in a dict literal, silently. Two `"File"` entries in `doc_events`
once dropped the expense invoice-PDF check, and nothing failed. This reads the file's source, so it also
catches a repeat Python itself would never report.

Run: DEVENV unit nirmaan_stack.test_hooks
"""

import ast
import unittest
from pathlib import Path

HOOKS = Path(__file__).with_name("hooks.py")


def repeated_keys(source: str) -> list[str]:
    """Each key a dict literal in `source` repeats, as "<key> (lines a and b)"."""
    repeats = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Dict):
            continue
        seen = {}
        for key in node.keys:
            if not isinstance(key, ast.Constant):
                continue
            if key.value in seen:
                repeats.append(f"{key.value!r} (lines {seen[key.value]} and {key.lineno})")
            seen[key.value] = key.lineno
    return repeats


class TestHooks(unittest.TestCase):
    def test_no_dict_repeats_a_key(self):
        self.assertEqual(
            repeated_keys(HOOKS.read_text()), [],
            "a repeated key replaces the earlier entry: merge them into one, with a list of handlers",
        )

    def test_a_repeated_key_is_found(self):
        self.assertEqual(
            repeated_keys('doc_events = {\n "File": {"a": 1},\n "Item": {},\n "File": {"b": 2},\n}'),
            ["'File' (lines 2 and 4)"],
        )
