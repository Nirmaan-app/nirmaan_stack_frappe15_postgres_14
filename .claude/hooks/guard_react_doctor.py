#!/usr/bin/env python3
"""
PreToolUse guard (matcher Bash): deny any command that runs React Doctor except through `yarn doctor`.

React Doctor run without --no-telemetry --no-score --no-supply-chain sends rule names, counts and file names to Sentry
and Axiom, asks react.doctor for a score, and checks dependencies with Socket.dev; `why` reaches Socket.dev whatever
the flags say. Data once sent cannot be recalled. In #1698 it ran without the flags 5 times (4 by a box agent, 1 by a
laptop reviewer) while frontend/CODING_STANDARDS.md § React Doctor said never to, so the rule is enforced here.

Allowed-list design. A shell segment that names react-doctor is denied unless its command is in READERS (grep, cat,
echo, ls, ...: commands that only read or name their arguments), is a git or gh subcommand in GIT_READS or GH_READS,
or is a package-manager query (yarn add/why, npm install/view, ...). So a way to run it that nobody listed (npx by
path, rtk proxy, /usr/bin/env, npm exec -c, yarn node, a new runner) is denied, not missed. A command that can run
its arguments is not a reader: awk (system()), sed (GNU `e`), less, bat, ag, ack, open. Neither is a listed command
given an option that runs one (RUNS_OPTIONS: find -exec, rg --pre, sort --compress-program; git -c, --config-env,
--exec-path; GIT_RUNS: grep -O, -x, --exec), nor git or gh with a subcommand outside GIT_READS or GH_READS (git
bisect run, rebase -x, an alias; gh alias, a gh extension). A segment starts after ; && || | & ( ) ` or a
newline, and after any PREFIXES (VAR=value, env, time, sudo, rtk, docker exec, ssh, ...), so `rtk grep react-doctor`
is read as grep. A prefix that itself names react-doctor (GIT_PAGER='npx react-doctor .' git log, env -S '...') is
denied.
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

# Commands whose arguments are only read or named, never run (unless RUNS_OPTIONS says so).
READERS = frozenset("""
    grep egrep fgrep zgrep rg cat head tail ls tree find which type whereis command hash file stat wc du diff cmp
    echo printf jq sort uniq cut tr tee cd pushd mkdir touch cp mv ln readlink realpath basename dirname test [ read
""".split())
# Options that make a reader run a command.
RUNS_OPTIONS = {
    "find": re.compile(r"\s-(?:exec|execdir|ok|okdir)\b"),
    "rg": re.compile(r"\s--pre(?:[=\s]|$)"),
    "sort": re.compile(r"\s--compress-program\b"),
}
# git options allowed before the subcommand; any other (-c, --config-env, --exec-path) can run a command.
GIT_GLOBALS = re.compile(r"-C|--git-dir|--work-tree|--namespace")
GIT_GLOBAL_FLAGS = frozenset("-P -p --no-pager --paginate --no-optional-locks --literal-pathspecs --bare".split())
# git subcommands that run nothing named in their arguments (hooks are files: the script-file gap).
GIT_READS = frozenset("""
    log show diff grep status blame shortlog reflog describe rev-parse rev-list ls-files ls-tree cat-file show-ref
    branch tag switch checkout restore add rm mv commit merge stash notes
""".split())
# Options of those subcommands that run a command.
GIT_RUNS = re.compile(r"\s(?:-x|--exec\S*|--extcmd\S*|-O\S*|--open-files-in-pager\S*|--upload-pack\S*"
                      r"|--receive-pack\S*)(?=\s|$)")
# gh subcommands that run nothing locally; gh alias and an extension (gh <name>) can.
GH_READS = frozenset("issue pr search api repo release run workflow label gist browse status".split())
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
    "Doctor). Only reading commands (grep, rg, cat, ls, echo, git log/grep/commit, ...) may name react-doctor; "
    "awk, sed, less and git -c are not reading commands here."
)


def command_word(segment):
    """The segment from its command on, and whether a prefix before it names react-doctor."""
    segment, named = segment.strip(), False
    while match := PREFIXES.match(segment):
        named = named or bool(NAME.search(match.group())) or MARK in match.group()
        segment = segment[match.end():]
    return segment, named


def program(word):
    words = word.split()
    return words[0].rsplit("/", 1)[-1] if words else ""


def git_only_names(words):
    i = 1
    while i < len(words) and words[i].startswith("-"):
        option = words[i].split("=", 1)[0]
        if words[i] in GIT_GLOBAL_FLAGS or (GIT_GLOBALS.fullmatch(option) and "=" in words[i]):
            i += 1
        elif GIT_GLOBALS.fullmatch(option):
            i += 2
        else:
            return False
    return i < len(words) and words[i] in GIT_READS and not GIT_RUNS.search(" " + " ".join(words[i:]))


def only_names(word):
    """True when the segment's command only reads or names its arguments."""
    name = program(word)
    if name in READERS:
        return name not in RUNS_OPTIONS or not RUNS_OPTIONS[name].search(word)
    if name == "git":
        return git_only_names(word.split())
    if name == "gh":
        return next((w for w in word.split()[1:] if not w.startswith("-")), "") in GH_READS
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
        raw, (word, prefix_names) = parts[i], command_word(parts[i])
        if prefix_names or denied_segment(word):
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
