#!/usr/bin/env python3
"""
PreToolUse guard (matcher Bash): deny any command that runs React Doctor except through `yarn doctor`.

React Doctor run without --no-telemetry --no-score --no-supply-chain sends rule names, counts and file names to Sentry
and Axiom, asks react.doctor for a score, and checks dependencies with Socket.dev; `why` reaches Socket.dev whatever
the flags say. Data once sent cannot be recalled. In #1698 it ran without the flags 5 times (4 by a box agent, 1 by a
laptop reviewer) while frontend/CODING_STANDARDS.md § React Doctor said never to, so the rule is enforced here.

Denied: a shell segment whose command is one of RUN_FORMS: the react-doctor binary by name or path, a package runner
(npx, bunx, pnpx, yarn/pnpm/npm/bun dlx|exec|x, yarn react-doctor), or node on a file under node_modules/react-doctor/.
A segment starts after ; && || | & ( ) ` or a newline, and after any PREFIXES (VAR=value, env, time, sudo, docker exec,
ssh, ...). Strings run as code are checked too: the argument of sh -c, eval or ssh, a shell's <<< string or heredoc,
and $(...) inside double quotes.
Allowed: `yarn doctor ...` (frontend/scripts/react_doctor.mjs), node on the wrapper scripts, and any command that only
names React Doctor (grep, cat, git log -S, a commit message, a heredoc written to a file).
Not seen: a script file the agent writes and then runs, or React Doctor started from another language
(node -e, python subprocess). The wrapper's refusals are the other guard.
FAIL-OPEN: any parse error -> allow.
"""
import json
import re
import sys

FLAGS = r"(?:\s+-\S+(?:\s+[^-\s]\S*)?)*?"
PACKAGE = r"react-doctor(?:@\S*)?(?=\s|$)"

# One row per way a shell segment executes React Doctor, matched at the segment's command word.
RUN_FORMS = [re.compile(form) for form in (
    r"\S*node_modules/react-doctor/",
    r"(?:\S*/)?" + PACKAGE,
    r"(?:npx|bunx|pnpx)" + FLAGS + r"\s+" + PACKAGE,
    r"(?:yarn|pnpm|npm|bun)" + FLAGS + r"\s+(?:dlx|exec|x)" + FLAGS + r"\s+" + PACKAGE,
    r"(?:yarn|pnpm|bun)" + FLAGS + r"(?:\s+run)?\s+" + PACKAGE,
    r"node" + FLAGS + r"\s+\S*node_modules/react-doctor/",
)]

# Words that run the command after them; each row ends where that command begins.
PREFIXES = re.compile("|".join((
    r"\w+=\S*\s+",
    r"(?:then|do|else|elif|if|while|until|!|\{)\s+",
    r"(?:command|exec|nohup)\s+",
    r"time(?:\s+-p)?\s+",
    r"env(?:\s+-[uSC]\s+\S+|\s+-\S+|\s+\w+=\S*)*\s+",
    r"sudo(?:\s+-[ugCDhprtTU]\s+\S+|\s+-\S+)*\s+",
    r"timeout(?:\s+-\S+)*\s+\S+\s+",
    r"nice(?:\s+-n\s+\S+|\s+-\S+)*\s+",
    r"xargs(?:\s+-[IdLnPs]\s*\S+|\s+-\S+)*\s+",
    r"docker(?:\s+compose)?\s+exec(?:\s+(?:-[ewu]|--(?:env|workdir|user|env-file|detach-keys))[\s=]\S+"
    r"|\s+-\S+)*\s+[^-\s]\S*\s+",
    r"ssh(?:\s+-[bcDEeFIiJLlmOopQRSWw]\s+\S+|\s+-\S+)*\s+[^-\s]\S*\s+",
)))

SEPARATORS = re.compile(r"&&|\|\||[;|&\n()`]")
QUOTED = re.compile(r"'([^']*)'|\"((?:\\.|[^\"\\])*)\"", re.S)
HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)(\w+)\1([^\n]*)\n(.*?)^[ \t]*\2[ \t]*$", re.S | re.M)
SH = r"(?:ba|z|da|k)?sh"
# The text before a quoted string whose content a shell runs.
RUNS_STRING = re.compile(rf"(?:\b{SH}(?:\s+-\w+)*?\s+-\w*c\w*|\beval|\bssh\b[^;&|\n]*|\b{SH}\s*<<<)\s*$")
SHELL = re.compile(rf"(?:\S*/)?{SH}(?:\s+-\S+)*\s*")
SUBSTITUTION = re.compile(r"\$\((.*)\)|`([^`]*)`", re.S)
WORD = re.compile(r"[\w@%+=:,./${}~-]*")

REASON = (
    "React Doctor runs only through its privacy wrapper: from frontend/, run `yarn doctor <args>` "
    "(frontend/scripts/react_doctor.mjs). It puts --no-telemetry --no-score --no-supply-chain first and refuses "
    "install, why and --supply-chain before React Doctor starts; its tests (frontend/scripts/react_doctor.test.mjs) "
    "prove both, and a scan through it made 0 network attempts (measured, commit 945bc0893). Run directly, React "
    "Doctor sends data to Axiom, Sentry, react.doctor and Socket.dev (#1698, frontend/CODING_STANDARDS.md § React "
    "Doctor)."
)


def command_word(segment):
    segment = segment.strip()
    while match := PREFIXES.match(segment):
        segment = segment[match.end():]
    return segment


def segments(code):
    """Yield every shell segment of `code` that runs, including those inside strings a shell runs."""
    def heredoc(match):
        feeding = SEPARATORS.split(code[:match.start()])[-1]
        if SHELL.fullmatch(command_word(feeding)):
            inner_code.append(match.group(4))
        return " " + match.group(3)

    def quoted(match):
        single, double = match.group(1), match.group(2)
        inner = single if single is not None else double
        if RUNS_STRING.search(stripped[:match.start()]):
            inner_code.append(inner)
        if double is not None:
            inner_code.extend(a or b for a, b in SUBSTITUTION.findall(double))
        return inner if WORD.fullmatch(inner) else "''"

    inner_code = []
    stripped = HEREDOC.sub(heredoc, code)
    for segment in SEPARATORS.split(QUOTED.sub(quoted, stripped)):
        yield command_word(segment)
    for inner in inner_code:
        yield from segments(inner)


def runs_react_doctor(command):
    return any(form.match(segment) for segment in segments(command) for form in RUN_FORMS)


def main():
    try:
        data = json.load(sys.stdin)
        if data.get("tool_name") != "Bash":
            return
        if runs_react_doctor((data.get("tool_input") or {}).get("command") or ""):
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": REASON,
                }
            }))
    except Exception:
        return


if __name__ == "__main__":
    main()
