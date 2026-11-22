"""Tests guard_react_doctor.py by feeding it hook input on stdin.

Run: python3 -I .claude/hooks/test_guard_react_doctor.py
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent / "guard_react_doctor.py"

# The first four are the forms that ran without the privacy flags in #1698.
DENIED = [
    "npx -y react-doctor@0.9.23 src/App.tsx",
    "node_modules/.bin/react-doctor why src/App.tsx",
    "yarn dlx react-doctor .",
    "cd frontend && npx react-doctor --supply-chain .",
    "react-doctor .",
    "./node_modules/.bin/react-doctor --no-telemetry --no-score --no-supply-chain .",
    "/Users/x/frontend/node_modules/.bin/react-doctor why",
    "npx --yes react-doctor",
    "bunx react-doctor@latest .",
    "pnpx react-doctor .",
    "pnpm dlx react-doctor .",
    "npm exec -- react-doctor .",
    "npm x react-doctor .",
    "yarn exec react-doctor .",
    "yarn react-doctor .",
    "yarn run react-doctor .",
    "yarn --cwd frontend dlx react-doctor .",
    "npx 'react-doctor@0.9.23' .",
    "node node_modules/react-doctor/bin/react-doctor.js .",
    "node --inspect ./node_modules/react-doctor/bin/react-doctor.js why",
    "./node_modules/react-doctor/bin/react-doctor.js .",
    "FOO=1 BAR='a b' npx react-doctor .",
    "env -i PATH=/usr/bin npx react-doctor .",
    "time npx react-doctor .",
    "sudo -u dev npx react-doctor .",
    "timeout 60 npx react-doctor .",
    "git status; npx react-doctor .",
    "false || react-doctor .",
    "ls src | xargs -n 1 npx react-doctor",
    "echo start\nnpx react-doctor .",
    "out=$(npx react-doctor .)",
    'echo "$(npx react-doctor .)"',
    "echo `react-doctor .`",
    "(cd frontend && npx react-doctor .)",
    "if true; then npx react-doctor .; fi",
    "bash -c 'cd frontend && npx react-doctor .'",
    'sh -c "npx react-doctor ."',
    "zsh -lc 'react-doctor why'",
    'eval "npx react-doctor ."',
    "bash <<< 'npx react-doctor .'",
    "bash <<'EOF'\ncd frontend\nnpx react-doctor .\nEOF",
    "cat > f.txt <<'EOF' && npx react-doctor .\nbody\nEOF",
    "docker exec -it -w /workspace/frontend frappe_docker_devcontainer-frappe-1 npx react-doctor .",
    "ssh r7 'cd frontend && npx react-doctor .'",
    "ssh -i ~/.ssh/id_ed25519_r7 r7 npx react-doctor .",
]

ALLOWED = [
    "yarn doctor",
    "cd frontend && yarn doctor --scope changed --base origin/main",
    "yarn doctor --verbose src/App.tsx",
    "node scripts/react_doctor.mjs --verbose src/App.tsx",
    "node frontend/scripts/react_doctor_new.mjs --base abc123",
    "docker exec -w /workspace/frontend frappe_docker_devcontainer-frappe-1 yarn doctor",
    "grep -rn react-doctor frontend/package.json",
    "rg react-doctor",
    "cat package.json",
    "cat node_modules/react-doctor/package.json",
    "ls node_modules/.bin/react-doctor",
    "which react-doctor",
    "git log --oneline -S react-doctor",
    'git commit -m "fix: refuse direct runs\n\nnpx react-doctor . sent data out; react-doctor why too"',
    "git commit -m \"$(cat <<'EOF'\nfix(hooks): block npx react-doctor\n\nreact-doctor why sent data out.\nEOF\n)\"",
    'git merge --no-ff box/react-doctor-1698 -m "Merge #1698: run react-doctor only through yarn doctor"',
    "cat > notes.md <<'EOF'\nnpx react-doctor .\nnode_modules/.bin/react-doctor why\nEOF",
    "echo 'npx react-doctor .' >> notes.txt",
    "python3 -c \"print('npx react-doctor .')\"",
    "yarn why react-doctor",
    "yarn add -D react-doctor@0.9.23",
    "npx vitest run scripts/react_doctor.test.mjs",
]


def run_hook(command, tool="Bash"):
    data = {"tool_name": tool, "tool_input": {"command": command}}
    return subprocess.run([sys.executable, "-I", str(HOOK)], input=json.dumps(data), capture_output=True, text=True)


def decide(command, tool="Bash"):
    out = run_hook(command, tool).stdout
    return json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out.strip() else "allow"


class ReactDoctorGuard(unittest.TestCase):
    def test_each_way_to_run_react_doctor_directly_is_denied(self):
        for command in DENIED:
            with self.subTest(command=command):
                self.assertEqual(decide(command), "deny")

    def test_the_wrapper_and_commands_that_only_name_react_doctor_are_allowed(self):
        for command in ALLOWED:
            with self.subTest(command=command):
                self.assertEqual(decide(command), "allow")

    def test_the_deny_reason_points_at_the_wrapper(self):
        reason = json.loads(run_hook("npx react-doctor .").stdout)["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("yarn doctor", reason)
        self.assertIn("frontend/scripts/react_doctor.mjs", reason)

    def test_other_tools_are_ignored(self):
        self.assertEqual(decide("npx react-doctor .", tool="Read"), "allow")

    def test_bad_input_fails_open(self):
        out = subprocess.run([sys.executable, "-I", str(HOOK)], input="not json", capture_output=True, text=True)
        self.assertEqual((out.returncode, out.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
