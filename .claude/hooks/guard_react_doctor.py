#!/usr/bin/env python3
"""
PreToolUse guard (matcher Bash): deny any command that runs React Doctor except through `yarn doctor`.

React Doctor run without --no-telemetry --no-score --no-supply-chain sends rule names, counts and file names to Sentry
and Axiom, asks react.doctor for a score, and checks dependencies with Socket.dev; `why` reaches Socket.dev whatever
the flags say. Data once sent cannot be recalled. In #1698 it ran without the flags 5 times (4 by a box agent, 1 by a
laptop reviewer) while frontend/CODING_STANDARDS.md § React Doctor said never to, so the rule is enforced here.

Allowed-list design. A shell segment that names react-doctor is denied unless its command is in READERS (grep, cat,
git, echo, ls, ...: commands that only read or name their arguments) or is a package-manager query (yarn add/why,
npm install/view, ...). So a way to run it that nobody listed (npx by path, rtk proxy, /usr/bin/env, npm exec -c,
yarn node, a new runner) is denied, not missed. A segment starts after ; && || | & ( ) ` or a newline, and after any
PREFIXES (VAR=value, env, time, sudo, rtk, docker exec, ssh, ...), so `rtk grep react-doctor` is read as grep.
The name counts inside a quoted string and a heredoc body too, so the string given to sh -c, eval, ssh, watch or
npm exec -c, and a heredoc fed to a shell or ssh, are denied. A shell, ssh or xargs fed by a pipe from a command
that names react-doctor is denied. $(...) inside double quotes or an unquoted heredoc is checked as commands.
Allowed: `yarn doctor ...` and node on the wrapper scripts (frontend/scripts/react_doctor.mjs, react_doctor_new.mjs:
an underscore, not the name), and a reader that names React Doctor (grep, cat, git log -S, a commit message, a heredoc
written to a file with cat or tee).
Not seen: a script file the agent writes and then runs; React Doctor started from another language (node -e,
python -c, a python subprocess: a quoted string or heredoc given to INTERPRETERS); a name built at run time
(x=react; npx $x-doctor). The wrapper's refusals are the other guard.
FAIL-OPEN: any parse error -> allow.
"""
import json
import re
import sys

# The name as a whole word: react-doctor, react-doctor@1, .bin/react-doctor, react-doctor/x; not react-doctor-1698.
NAME = re.compile(r"(?<![\w-])react-doctor(?![\w-])")
# Stands in for a quoted string or heredoc body that names react-doctor. Holds neither a separator nor the name.
MARK = "\x00RD\x00"

# Commands whose arguments are only read or named, never run.
READERS = frozenset("""
    grep egrep fgrep zgrep rg ag ack cat bat less more head tail ls tree find which type whereis command hash file
    stat wc du diff cmp echo printf git gh sed awk jq sort uniq cut tr tee cd pushd mkdir touch cp mv ln readlink
    realpath basename dirname test [ open code read
""".split())
FIND_RUNS = re.compile(r"\s-(?:exec|execdir|ok|okdir)\b")
PACKAGE_MANAGERS = frozenset(("yarn", "npm", "pnpm", "bun"))
PACKAGE_QUERIES = frozenset("""
    add remove install i uninstall un why info view show list ls outdated upgrade up update explain audit search
""".split())
# Runs code of another language: a quoted string or heredoc given to one is the known gap; a bare path is not.
INTERPRETERS = re.compile(r"(?:python[\d.]*|node|deno|ruby|perl|php)")

# Words that run the command after them; each row ends where that command begins.
PREFIXES = re.compile("|".join((
    r"\w+=\S*\s+",
    r"(?:then|do|else|elif|if|while|until|!|\{)\s+",
    r"(?:\S*/)?(?:exec|nohup)\s+",
    r"(?:\S*/)?command(?:\s+-p)?\s+(?!-)",
    r"(?:\S*/)?rtk(?:\s+proxy)?\s+",
    r"(?:\S*/)?time(?:\s+-p)?\s+",
    r"(?:\S*/)?env(?:\s+-[uSC]\s+\S+|\s+-\S+|\s+\w+=\S*)*\s+",
    r"(?:\S*/)?sudo(?:\s+-[ugCDhprtTU]\s+\S+|\s+-\S+)*\s+",
    r"(?:\S*/)?timeout(?:\s+-\S+)*\s+\S+\s+",
    r"(?:\S*/)?nice(?:\s+-n\s+\S+|\s+-\S+)*\s+",
    r"(?:\S*/)?xargs(?:\s+-[IdLnPs]\s*\S+|\s+-\S+)*\s+",
    r"docker(?:\s+compose)?\s+exec(?:\s+(?:-[ewu]|--(?:env|workdir|user|env-file|detach-keys))[\s=]\S+"
    r"|\s+-\S+)*\s+[^-\s]\S*\s+",
    r"(?:\S*/)?ssh(?:\s+-[bcDEeFIiJLlmOopQRSWw]\s+\S+|\s+-\S+)*\s+[^-\s]\S*(?:\s+|$)",
)))

SEPARATORS = re.compile(r"(&&|\|\||[;|&\n()`])")
QUOTED = re.compile(r"'([^']*)'|\"((?:\\.|[^\"\\])*)\"", re.S)
HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)(\w+)\1([^\n]*)\n(.*?)^[ \t]*\2[ \t]*$", re.S | re.M)
SHELL = re.compile(r"(?:\S*/)?(?:ba|z|da|k)?sh(?:\s+-\S+)*\s*")
XARGS = re.compile(r"(?:^|\s)(?:\S*/)?xargs(?:\s|$)")
SUBSTITUTION = re.compile(r"\$\((.*)\)|`([^`]*)`", re.S)
WORD = re.compile(r"[\w@%+=:,./${}~-]*")

REASON = (
    "React Doctor runs only through its privacy wrapper: from frontend/, run `yarn doctor <args>` "
    "(frontend/scripts/react_doctor.mjs). It puts --no-telemetry --no-score --no-supply-chain first and refuses "
    "install, why and --supply-chain before React Doctor starts; its tests (frontend/scripts/react_doctor.test.mjs) "
    "prove both, and a scan through it made 0 network attempts (measured, commit 945bc0893). Run directly, React "
    "Doctor sends data to Axiom, Sentry, react.doctor and Socket.dev (#1698, frontend/CODING_STANDARDS.md § React "
    "Doctor). Only reading commands (grep, cat, git, ls, echo, ...) may name react-doctor."
)


def command_word(segment):
    segment = segment.strip()
    while match := PREFIXES.match(segment):
        segment = segment[match.end():]
    return segment


def program(word):
    words = word.split()
    return words[0].rsplit("/", 1)[-1] if words else ""


def only_names(word):
    """True when the segment's command only reads or names its arguments."""
    name = program(word)
    if name in READERS:
        return name != "find" or not FIND_RUNS.search(word)
    if name in PACKAGE_MANAGERS:
        return next((w for w in word.split()[1:] if not w.startswith("-")), "") in PACKAGE_QUERIES
    return False


def denied_segment(word):
    bare, quoted = bool(NAME.search(word)), MARK in word
    if not (bare or quoted) or only_names(word):
        return False
    return bare or not INTERPRETERS.fullmatch(program(word))


def runs_react_doctor(code):
    inner_code = []

    def heredoc(match):
        body = match.group(4)
        if not match.group(1):
            inner_code.extend(a or b for a, b in SUBSTITUTION.findall(body))
        return " " + (MARK if NAME.search(body) or MARK in body else "") + " " + match.group(3)

    def quoted(match):
        single, double = match.group(1), match.group(2)
        inner = single if single is not None else double
        if double is not None:
            inner_code.extend(a or b for a, b in SUBSTITUTION.findall(double))
        if WORD.fullmatch(inner):
            return inner
        return MARK if NAME.search(inner) or MARK in inner else "''"

    parts = SEPARATORS.split(QUOTED.sub(quoted, HEREDOC.sub(heredoc, code)))
    for i in range(0, len(parts), 2):
        raw, word = parts[i], command_word(parts[i])
        if denied_segment(word):
            return True
        fed_code = i and parts[i - 1] == "|" and NAME.search(code)
        if fed_code and (SHELL.fullmatch(word) or (raw.strip() and not word)
                         or (XARGS.search(raw) and not only_names(word))):
            return True
    return any(runs_react_doctor(inner) for inner in inner_code)


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
