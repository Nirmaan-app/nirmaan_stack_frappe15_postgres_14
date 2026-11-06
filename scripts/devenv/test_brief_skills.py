"""Tests brief_skills.py against a fake Claude home with one plugin. No box, no network.

Run: python3 -I scripts/devenv/test_brief_skills.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "brief_skills.py"


class UserOnlySkills(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.home = root / "claude"
        plugin = root / "cache" / "tools" / "1.0"
        self.skill(plugin, "engineering/build-all", "disable-model-invocation: true\n", "")
        self.skill(plugin, "engineering/test-first", "", "A body that says disable-model-invocation: true in prose.\n")
        self.skill(root / "cache" / "other" / "2.0", "solo", "disable-model-invocation: true\n", "")
        (self.home / "plugins").mkdir(parents=True)
        (self.home / "settings.json").write_text(json.dumps({"enabledPlugins": {"tools@market": True, "other@market": False}}))
        (self.home / "plugins" / "installed_plugins.json").write_text(json.dumps({"plugins": {
            "tools@market": [{"installPath": str(plugin), "version": "1.0"}],
            "other@market": [{"installPath": str(root / "cache" / "other" / "2.0"), "version": "2.0"}],
        }}))
        self.brief = root / "BRIEF.md"

    def tearDown(self):
        self._tmp.cleanup()

    @staticmethod
    def skill(plugin: Path, rel: str, front: str, body: str):
        d = plugin / "skills" / rel
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(f"---\nname: {d.name}\ndescription: x\n{front}---\n\n{body}")

    def run_on(self, text: str):
        self.brief.write_text(text)
        return subprocess.run([sys.executable, "-I", str(SCRIPT), str(self.brief), str(self.home)],
                              capture_output=True, text=True)

    def test_a_brief_naming_a_user_only_skill_is_refused(self):
        r = self.run_on("Call the Skill tool with `tools:build-all` to run the build.\n")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("tools:build-all", r.stdout)

    def test_a_slash_command_form_is_refused_too(self):
        r = self.run_on("Then run /tools:build-all over the tickets.\n")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)

    def test_a_skill_an_agent_may_call_passes(self):
        r = self.run_on("Call the Skill tool with `tools:test-first` before the first test.\n")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(r.stdout, "")

    def test_a_plugin_that_is_not_enabled_is_not_read(self):
        r = self.run_on("Call `other:solo`.\n")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_a_brief_with_no_skill_names_passes(self):
        r = self.run_on("Build items 1-7. Test with devenv.sh test --affected HEAD~1.\n")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
