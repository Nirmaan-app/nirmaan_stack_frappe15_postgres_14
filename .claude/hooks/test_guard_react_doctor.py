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
    # Forms the retro review found allowed by the first, deny-list version of the guard.
    "/opt/homebrew/bin/npx react-doctor .",
    "/usr/local/bin/npx react-doctor .",
    "~/.nvm/versions/node/v20/bin/npx react-doctor .",
    "rtk proxy npx react-doctor .",
    "rtk npx react-doctor .",
    "/usr/bin/env npx react-doctor .",
    "command -p npx react-doctor .",
    'echo "npx react-doctor ." | sh',
    "echo 'npx react-doctor .' | /bin/bash -s",
    "npm exec --package=react-doctor -c 'react-doctor .'",
    "npm exec -c 'react-doctor .'",
    "yarn node node_modules/react-doctor/dist/cli.js",
    "node node_modules/.bin/react-doctor .",
    "ssh r7 \"npx react-doctor .\"",
    "ssh r7 <<'EOF'\ncd ~/x/frontend && npx react-doctor .\nEOF",
    "cat <<'EOF' | bash\nnpx react-doctor\nEOF",
    "bash --login -c 'npx react-doctor .'",
    "bash -o pipefail -c 'npx react-doctor .'",
    "echo react-doctor | xargs npx",
    "echo 'npx react-doctor .' | ssh r7",
    "watch -n 60 'npx react-doctor .'",
    "cat <<EOF\n$(npx react-doctor .)\nEOF",
    "find src -name '*.tsx' -exec react-doctor {} +",
    "RD=react-doctor; npx $RD .",
    # Readers that can run their arguments, found allowed by the second review.
    "awk 'BEGIN{system(\"npx react-doctor .\")}'",
    "sed '1e npx react-doctor .' x",
    "git -c alias.rd='!npx react-doctor .' rd",
    'git -c alias.rd="!npx react-doctor ." rd',
    "git -c core.pager='npx react-doctor .' log",
    "git --config-env=core.pager=RD log -S react-doctor",
    "git bisect run npx react-doctor .",
    "git rebase -x 'npx react-doctor .' HEAD~1",
    "git rebase --exec='npx react-doctor .' HEAD~1",
    "git grep --open-files-in-pager='npx react-doctor' x",
    "git grep -O'npx react-doctor' x",
    "rg --pre react-doctor x .",
    "rg --pre=react-doctor x .",
    "gh alias set --shell rd 'npx react-doctor .'",
    "gh react-doctor",
    "less '+!npx react-doctor .' x",
    "GIT_PAGER='npx react-doctor .' git log",
    "LESSOPEN='|npx react-doctor %s' cat x",
    "env -S 'npx react-doctor .'",
    "sort --compress-program=react-doctor x",
    # Shell escapes, brace expansion and ANSI-C quoting the shell removes before the run (third review).
    "npx react\\-doctor .",
    "npx re\\act-doctor .",
    "npx react-doct\\or .",
    "npx react-\\\ndoctor .",
    "yarn dlx react\\-doctor@latest . --verbose",
    "npx react-{doctor,} .",
    "npx {react,x}-doctor .",
    "npx react-{d..d}octor .",
    "npx react-{doctor,{a}} .",
    "npx $'react\\x2ddoctor' .",
    "npx $'react\\055doctor' .",
    "sh -c 'npx react\\-doctor .'",
    "bash -c \"npx react-{doctor,} .\"",
    "printf 'npx react\\x2ddoctor .' | sh",
    "echo \\' ; npx react-doctor . ; echo \\'",
    # command without -v/-V runs its argument; options before a package manager's subcommand hide it.
    "command -- npx react-doctor .",
    "command -p -- npx react-doctor .",
    "command -p -p npx react-doctor .",
    "npm --loglevel info exec -- react-doctor .",
    "pnpm --filter list dlx react-doctor .",
    "yarn --cwd install react-doctor .",
    # Only the wrapper passes: a command after it, or doctor as an option's value, still does not.
    "yarn doctor . > react-doctor.txt; npx react-doctor .",
    "yarn doctor $(npx react-doctor .)",
    "yarn --cwd doctor dlx react-doctor .",
    "npm doctor react-doctor",
    "yarn dlx doctor react-doctor",
    "gh --repo x react-doctor",
    # git takes bundled short options and any unique start of a long one; sort too.
    "git grep -iO'npx react-doctor .' useEffect",
    "git grep --open='npx react-doctor .' useEffect",
    "git grep --open-files='npx react-doctor .' x",
    "git -P grep -nO'npx react-doctor' x",
    "sort --compress=react-doctor x",
    # Readers that assign to a name: 'a[$(cmd)]' runs cmd as a subscript (bash and zsh read, zsh printf -v, test -v).
    "read 'a[$(npx react-doctor .)]' <<< x",
    "printf -v 'a[$(npx react-doctor .)]' %s y",
    "test -v 'a[$(npx react-doctor .)]'",
]

ALLOWED = [
    "yarn doctor",
    "cd frontend && yarn doctor --scope changed --base origin/main",
    "yarn doctor --verbose src/App.tsx",
    # The wrapper with the name in a redirect target or an argument (denied by mistake until the retro review).
    "cd frontend && yarn doctor . > /tmp/react-doctor.txt 2>&1",
    "yarn doctor --verbose docs/react-doctor.md",
    "docker exec -w /workspace/frontend frappe_docker_devcontainer-frappe-1 yarn doctor . > react-doctor.log",
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
    "rtk grep -rn react-doctor frontend",
    "rtk proxy git log -S react-doctor",
    "command -v react-doctor",
    "grep -l react-doctor frontend/package.json | xargs cat",
    "rg react-doctor | sort | uniq -c",
    "tee notes.md <<'EOF'\nnpx react-doctor .\nEOF",
    "git commit -F - <<'EOF'\nfix: npx react-doctor . sent data out\nEOF",
    "find node_modules -maxdepth 1 -name react-doctor",
    "npm view react-doctor version",
    "python3 - <<'EOF'\nprint('npx react-doctor .')\nEOF",
    "bash scripts/devenv/task.sh done react-doctor-1698",
    "git switch box/react-doctor-1698",
    "git -C frontend log -S react-doctor",
    "git --no-pager grep -n react-doctor",
    "git -C /x/y --no-pager show HEAD:frontend/node_modules/react-doctor/package.json",
    "git -c core.pager=cat log",
    'gh issue create --title "x" --body "npx react-doctor . sent data out"',
    "gh pr view 12 --json body | grep react-doctor",
    "rg --pre-glob '*.gz' react-doctor",
    "sort react-doctor.txt",
    "command -pv react-doctor",
    "command -V react-doctor",
    "grep -rn 'react\\-doctor' frontend",
    "grep -rn react\\-doctor frontend",
    "echo it\\'s; grep react-doctor x",
    "git grep -n react-doctor -- '*.json'",
    "git log --oneline --exclude=refs/stash --all -S react-doctor",
    "git log --format=%h -S react-doctor",
    "git log -Gfix --oneline -- docs/react-doctor.md",
    "git log --oneline -Sindex -- react-doctor.md",
    "git log -SOptions react-doctor",
    "printf '%s\\n' react-doctor",
    "test -e node_modules/.bin/react-doctor",
    "sort --reverse react-doctor.txt",
    "grep -c '{react-doctor,x}' notes.md",
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
