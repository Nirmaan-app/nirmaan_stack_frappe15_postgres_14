# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""ADR-0051: the Software Developer profile mirrors Admin.

Pure tests (no site, no DB): the shipped fixtures and the shared profile lists.

Run: DEVENV unit nirmaan_stack.services.test_software_developer_profile
"""

import json
import unittest
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
DEVELOPER = "Nirmaan Software Developer Profile"
ADMIN = "Nirmaan Admin Profile"


def _fixture(name: str) -> list[dict]:
    return json.loads((FIXTURES / name).read_text())


def _profile_roles(profile: str) -> set[str]:
    for row in _fixture("role_profile.json"):
        if row["name"] == profile:
            return {r["role"] for r in row["roles"]}
    raise AssertionError(f"no Role Profile {profile} in the fixtures")


class TheFixturesShipTheDeveloperProfile(unittest.TestCase):
    def test_the_developer_profile_carries_exactly_admins_seven_roles(self):
        self.assertEqual(
            _profile_roles(DEVELOPER),
            {
                "Nirmaan Procurement Executive",
                "Nirmaan Project Lead",
                "Nirmaan Project Manager",
                "Nirmaan Design Executive",
                "Nirmaan Estimates Executive",
                "Nirmaan Accountant",
                "System Manager",
            },
        )
        self.assertEqual(_profile_roles(DEVELOPER), _profile_roles(ADMIN))

    def test_the_role_nirmaan_software_developer_ships(self):
        roles = {row["name"]: row for row in _fixture("role.json")}
        self.assertIn("Nirmaan Software Developer", roles)
        self.assertEqual(roles["Nirmaan Software Developer"]["desk_access"], 1)


class TheDeveloperIsNamedNextToAdmin(unittest.TestCase):
    """Decision 3: `ADMIN_PROFILE` means Admin alone, and every check names `DEVELOPER_PROFILE` beside it."""

    def setUp(self):
        from nirmaan_stack.services import role_profiles

        self.rp = role_profiles

    def test_the_two_constants(self):
        self.assertEqual(self.rp.ADMIN_PROFILE, ADMIN)
        self.assertEqual(self.rp.DEVELOPER_PROFILE, DEVELOPER)

    def test_there_is_no_shared_admin_list(self):
        self.assertFalse(hasattr(self.rp, "ADMIN_PROFILES"))
        self.assertFalse(hasattr(self.rp, "SOFTWARE_DEVELOPER_PROFILE"))

    def test_every_profile_tuple_with_admin_also_holds_the_developer(self):
        for name, value in vars(self.rp).items():
            if isinstance(value, tuple) and ADMIN in value:
                with self.subTest(name=name):
                    self.assertIn(DEVELOPER, value)

    def test_is_admin_profile_is_the_admin_profile_alone(self):
        self.assertTrue(self.rp.is_admin_profile(ADMIN))
        for other in (DEVELOPER, "Nirmaan Accountant Profile", "Administrator", None, ""):
            with self.subTest(other=other):
                self.assertFalse(self.rp.is_admin_profile(other))

    def test_is_developer_profile_is_the_developer_profile_alone(self):
        self.assertTrue(self.rp.is_developer_profile(DEVELOPER))
        for other in (ADMIN, "Nirmaan Accountant Profile", "Administrator", None, ""):
            with self.subTest(other=other):
                self.assertFalse(self.rp.is_developer_profile(other))


APP = Path(__file__).resolve().parents[1]

#: Python files that may still hold a profile name as an inline string, each with why. Every check reads
#: `ADMIN_PROFILE` / `DEVELOPER_PROFILE` or their helpers (ADR-0051 Consequences: an inline Admin string silently
#: drops the developer, and an inline developer string hides it from the guard below).
BACKEND_PROFILE_STRING_ALLOWED = {
    "services/role_profiles.py": "defines ADMIN_PROFILE and DEVELOPER_PROFILE, the one place the strings live",
    "install.py": "the Administrator user's own Nirmaan Users row is given the Admin profile",
    "api/tasks/update_task_status.py": "a stored label for a task assignee with no Nirmaan Users row, not a check",
}

#: Uses of Admin that may leave the developer out, by `file::function` (`<module>` for module level), each with why.
#: Everywhere else every use of Admin names the developer beside it (`admin_checks_without_the_developer`).
ADMIN_ONLY_ALLOWED = {
    "services/role_profiles.py::is_admin_profile": "defines the Admin-alone profile test",
    "services/role_profiles.py::is_nirmaan_admin": "defines Administrator-or-the-Admin-profile; callers add the developer",
    "api/reminders/read.py::_profiles_seen_as": "one-way reminders scope: a developer sees Admin's schedules, not back",
    "services/expense_request_routing.py::<module>": (
        "a type with no reviewer of its own routes to the Admin profile; `_reviews_as` lets the developer review it"
    ),
    "api/boq/wizard/template_admin.py::_user_role_profile": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
    "api/commission_report/get_tracker_list.py::_get_user_role_profile": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
    "api/design_tracker/get_tracker_list.py::_get_user_role_profile": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
    "api/expense_requests/access.py::caller_role_profile": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
    "api/po_remarks.py::get_user_role_profile": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
    "api/sr_finalize.py::get_user_role_profile": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
    "api/sr_remarks.py::get_user_role_profile": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
    "api/reminders/read.py::_my_schedule_names": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
    "api/reminders/read.py::get_my_reminder_logs": "the Administrator user is read as the Admin profile; the checks on the result name the developer",
}

PROFILE_STRINGS = (ADMIN, DEVELOPER)


def _app_modules(app: Path):
    """(relative path, AST) of every Python module, leaving out patches (append-only history) and tests."""
    import ast

    for path in sorted(app.rglob("*.py")):
        rel = path.relative_to(app).as_posix()
        if rel.startswith("patches/") or path.name.startswith("test_"):
            continue
        yield rel, ast.parse(path.read_text(), filename=rel)


def backend_profile_strings(app: Path = APP) -> dict[str, list[int]]:
    """{file: [line, ...]} of every Python string constant equal to the Admin or the developer profile name."""
    import ast

    found: dict[str, list[int]] = {}
    for rel, tree in _app_modules(app):
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and node.value in PROFILE_STRINGS:
                found.setdefault(rel, []).append(node.lineno)
    return found


def _names(node) -> set[str]:
    """Every bare name and attribute name inside `node`, called functions included."""
    import ast

    out = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name):
            out.add(sub.id)
        elif isinstance(sub, ast.Attribute):
            out.add(sub.attr)
    return out


#: An Admin helper -> the developer helper that must stand beside it, called on the same argument, in the same `or`.
_PARTNER = {"is_admin_profile": "is_developer_profile", "is_nirmaan_admin": "is_developer"}
_DEVELOPER_NAMES = {"DEVELOPER_PROFILE", "is_developer_profile", "is_developer"}


def _ref(node) -> str | None:
    """The name a bare name or an attribute (`role_profiles.ADMIN_PROFILE`) refers to, else None."""
    import ast

    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def admin_checks_without_the_developer(app: Path = APP) -> dict[str, list[int]]:
    """{"file::function": [line, ...]} of every use of Admin that leaves the developer out.

    Every reference to `ADMIN_PROFILE`, `is_admin_profile` or `is_nirmaan_admin` is judged:
    * `ADMIN_PROFILE` in a tuple, list or set passes when the same one holds `DEVELOPER_PROFILE`; in a comparison,
      when the comparison or a sibling operand of its `or` names the developer. Anywhere else (a dict value, an
      argument, an assignment, a return) it is a use of Admin alone.
    * `is_admin_profile(x)` / `is_nirmaan_admin(x)` pass only as a direct operand of an `or` that also has
      `is_developer_profile(x)` / `is_developer(x)` on the same argument as a direct operand. An alias, a callback or
      `import ... as` hides the check, so it is refused.
    """
    import ast

    found: dict[str, list[int]] = {}
    for rel, tree in _app_modules(app):
        parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}

        def scope(node):
            while node in parents:
                node = parents[node]
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    return node.name
            return "<module>"

        def or_siblings(node):
            """The other direct operands of the widest `or` chain `node` is a direct operand of."""
            top = node
            while isinstance(parents.get(top), ast.BoolOp) and isinstance(parents[top].op, ast.Or):
                top = parents[top]
            if top is node:
                return []

            def operands(n):
                if isinstance(n, ast.BoolOp) and isinstance(n.op, ast.Or):
                    return [o for v in n.values for o in operands(v)]
                return [n]

            return [o for o in operands(top) if o is not node]

        def names_developer(node) -> bool:
            return any(_ref(n) in _DEVELOPER_NAMES for n in ast.walk(node))

        def flag(node):
            found.setdefault(f"{rel}::{scope(node)}", []).append(getattr(node, "lineno", 0))

        for node in ast.walk(tree):
            if isinstance(node, ast.alias) and node.name in _PARTNER and node.asname:
                flag(parents.get(node, node))  # `import is_nirmaan_admin as _x`: the calls to `_x` go unseen
                continue
            name = _ref(node)
            if isinstance(getattr(node, "ctx", None), ast.Store):
                continue
            parent = parents.get(node)
            if name in _PARTNER:
                call = parent
                if not (isinstance(call, ast.Call) and call.func is node and call.args):
                    flag(node)  # an alias or a callback
                    continue
                partner = [
                    o for o in or_siblings(call)
                    if isinstance(o, ast.Call) and _ref(o.func) == _PARTNER[name] and o.args
                    and ast.dump(o.args[0]) == ast.dump(call.args[0])
                ]
                if not partner:
                    flag(call)
            elif name == "ADMIN_PROFILE":
                if isinstance(parent, (ast.Tuple, ast.List, ast.Set)):
                    ok = any(_ref(e) == "DEVELOPER_PROFILE" for e in parent.elts)
                elif isinstance(parent, ast.Compare):
                    ok = names_developer(parent) or any(names_developer(o) for o in or_siblings(parent))
                else:
                    ok = False
                if not ok:
                    flag(node)
    return found


class NoCheckNamesAProfileInline(unittest.TestCase):
    def test_only_the_allowed_files_hold_a_profile_string(self):
        stray = {f: lines for f, lines in backend_profile_strings().items() if f not in BACKEND_PROFILE_STRING_ALLOWED}
        self.assertEqual(stray, {}, "use ADMIN_PROFILE / DEVELOPER_PROFILE or their helpers instead")


class EveryAdminCheckNamesTheDeveloper(unittest.TestCase):
    def test_every_list_and_check_that_names_admin_names_the_developer(self):
        stray = {w: lines for w, lines in admin_checks_without_the_developer().items() if w not in ADMIN_ONLY_ALLOWED}
        self.assertEqual(stray, {}, "name DEVELOPER_PROFILE / is_developer_profile / is_developer beside Admin")

    def test_every_exception_is_still_needed(self):
        """A stale exception would let a new Admin-only check in that function pass unseen."""
        self.assertEqual(sorted(set(ADMIN_ONLY_ALLOWED) - set(admin_checks_without_the_developer())), [])

    def test_the_guard_catches_each_shape(self):
        import tempfile

        bad = (
            "ADMIN_ONLY = (ADMIN_PROFILE, X)\n"
            "def a(p):\n    return is_admin_profile(p)\n"
            "def b(u):\n    return not is_nirmaan_admin(u) or other(u)\n"
            "def c(p):\n    return p == ADMIN_PROFILE\n"
            "_alias = is_nirmaan_admin\n"
            "from x import is_admin_profile as _profile_check\n"
            "def d(p, q):\n    return is_admin_profile(p) or is_developer_profile(q)\n"
            "def e(p):\n    return not is_admin_profile(p) or is_developer_profile(p)\n"
            "def f(u):\n    return has_role_profile(u, rp.ADMIN_PROFILE)\n"
            "def g(p):\n    return rp.is_admin_profile(p)\n"
            "def h():\n    return frappe.get_all('Nirmaan Users', filters={'role_profile': ADMIN_PROFILE})\n"
        )
        good = (
            "BOTH = (ADMIN_PROFILE, DEVELOPER_PROFILE, X)\n"
            "def a(p):\n    return is_admin_profile(p) or is_developer_profile(p)\n"
            "def b(u):\n    return not (is_nirmaan_admin(u) or is_developer(u))\n"
            "def c(p):\n    return p == ADMIN_PROFILE or p == DEVELOPER_PROFILE\n"
            "def g(p):\n    return rp.is_admin_profile(p) or rp.is_developer_profile(p)\n"
            "def h():\n    return frappe.get_all('Nirmaan Users', filters={'role_profile': ['in', [ADMIN_PROFILE, DEVELOPER_PROFILE]]})\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "bad.py").write_text(bad)
            Path(tmp, "good.py").write_text(good)
            found = admin_checks_without_the_developer(Path(tmp))
        self.assertEqual(
            sorted(found),
            ["bad.py::<module>", "bad.py::a", "bad.py::b", "bad.py::c", "bad.py::d", "bad.py::e", "bad.py::f",
             "bad.py::g", "bad.py::h"],
        )
