"""Start a task's Claude on the box itself, as the Orca Claude account the box's owner gave the person whose SSH key
connected, with that person's git identity. The laptop pipes this file over SSH (python3 - <command> ...) for a box
whose registry entry says box.<name>.launch = box (scripts/devenv/boxes.sh), so the box's own copy of the scripts does
not matter. Linux only (it reads /proc). Progress goes to stderr; stdout carries only results.

  check <task>                      who connected, their account, git identity and the task name's prefix. Prints
                                    @config <dir>: the Claude config dir the agent will use (session logs: <dir>/projects)
  launch <task> <worktree> <prompt, base64>
                                    set the person's git name and email for <worktree> only (git's per-worktree config:
                                    extensions.worktreeConfig, then git config --worktree; the main checkout and other
                                    envs keep theirs); then, under the launch lock: select the person's account in the
                                    box's Orca, start Claude in <worktree>, wait for its process, prove that process
                                    uses the account's config dir (else close its terminal and refuse), put the Orca
                                    selection back, and record requester, account and git identity in
                                    ~/claude-artifacts/dod/box-<task>/LAUNCH. Prints @config <dir>
  alive <worktree>                  exit 0 when a claude process runs in <worktree>
  tail <worktree>                   the last 15 rows of its Orca terminal's screen
  stop <worktree>                   close its Orca terminals
  people <argv as JSON, base64>     the box side of scripts/devenv/people.sh: [<box name>, <box ssh target>, add|check|
                                    remove|list, ...]. The owner's laptop sends it; its header has the verbs

The rules: ~/.config/devbox/people.conf on the box, git config syntax, mode 600, outside the repo, written by
people.sh add (by hand works too). One section per person:
  [person "madhu"]
      key = ssh-ed25519 AAAA... madhu-to-r7     a public key line; one line per key. Also in ~/.ssh/authorized_keys
      account = <id, email or label>            from orca-ide account list on the box, or system (the box's own login)
      email = madhu@example.com                 optional: the email that account must be signed in as
      prefix = madhu-                           optional: each of their task names starts with it
      git-name = Madhu Balan                    required: the author and committer name of their tasks' commits
      git-email = madhu@example.com             required: the email of their tasks' commits
Who connected: with ExposeAuthInfo yes in the box's sshd_config, sshd names the session's key in the file
$SSH_USER_AUTH. Everyone logs in as the same Linux user, so this keeps people's usage, billing and authorship apart,
not their secrets: anyone with a shell there can read and change whatever that user can, this file and people.conf
included.

Exit 1: refused, failed, or (people check) something missing, with the reason on stderr. Exit 2: wrong usage.
"""
import argparse
import base64
import contextlib
import fcntl
import glob
import json
import os
import re
import shlex
import subprocess
import sys
import time
from collections import namedtuple

HOME = os.path.expanduser("~")
PEOPLE = os.path.join(HOME, ".config/devbox/people.conf")
AUTHORIZED = os.path.join(HOME, ".ssh/authorized_keys")
SSHD_CONFIG = os.environ.get("DEVBOX_SSHD_CONFIG", "/etc/ssh/sshd_config")   # set it only in tests
LOCK = os.path.join(HOME, ".local/state/devbox/launch.lock")
DEFAULT_HOME = os.path.join(HOME, ".claude")
PROC = os.environ.get("DEVBOX_PROC", "/proc")   # set it only in tests
LOCK_WAIT, ALIVE_WAIT = 600, 60
# Orca starts Claude in two steps (a short-lived process that seeds the session, then the one that resumes it),
# reading the selected account at each. The selection goes back only once a Claude has run this long unbroken.
SETTLE = float(os.environ.get("DEVBOX_LAUNCH_SETTLE", "10"))

# One person's record in people.conf. keys: the public key lines as written there.
Person = namedtuple("Person", "name keys account email prefix git_name git_email")
# people.conf variable -> Person field, for the single-valued ones (key is the list).
VARS = {"account": "account", "email": "email", "prefix": "prefix", "git-name": "git_name", "git-email": "git_email"}
Account = namedtuple("Account", "select home email")   # select: what orca-ide account select takes
Proc = namedtuple("Proc", "pid config")


class Refused(Exception):
    pass


def say(msg):
    print(msg, file=sys.stderr, flush=True)


def key_blob(text):
    """The base64 part of a public key line, or the text itself when it is only that."""
    words = text.split()
    return next((w for w in words if w.startswith("AAAA")), words[0] if words else "")


def load_people(path=PEOPLE, missing_ok=False):
    """{name: Person} from people.conf, the one parser of it. A key listed under two people is refused: who connected
    must name one person."""
    if not os.path.isfile(path):
        if missing_ok:
            return {}
        raise Refused(f"no rules at {path} on the box: its owner writes them (scripts/devenv/people.sh add)")
    out = subprocess.run(["git", "config", "-f", path, "--list", "-z"], capture_output=True, text=True)
    if out.returncode != 0:
        raise Refused(f"{path} does not parse as git config: {out.stderr.strip()}")
    fields = {}
    for entry in filter(None, out.stdout.split("\0")):
        key, _, value = entry.partition("\n")
        section, _, var = key.rpartition(".")
        if section.startswith("person."):
            fields.setdefault(section[len("person."):], {}).setdefault(var, []).append(value.strip())
    people, owner = {}, {}
    for name, f in fields.items():
        people[name] = Person(name, tuple(k for k in f.get("key", []) if k.strip()),
                              **{field: (f.get(var) or [""])[-1] for var, field in VARS.items()})
        for blob in map(key_blob, people[name].keys):
            if owner.setdefault(blob, name) != name:
                raise Refused(f"{path} gives one key to both {owner[blob]} and {name}: its owner fixes that")
    return people


def by_key(people):
    return {key_blob(k): p for p in people.values() for k in p.keys}


def connected_keys():
    """The key blobs sshd says this session logged in with ($SSH_USER_AUTH, from ExposeAuthInfo yes)."""
    path = os.environ.get("SSH_USER_AUTH", "")
    if not path:
        raise Refused("the box's sshd does not say which key connected, so the box cannot tell who you are. Its owner "
                      "adds 'ExposeAuthInfo yes' to /etc/ssh/sshd_config and reloads sshd")
    try:
        with open(path) as f:
            return [line.split()[2] for line in f if line.startswith("publickey ") and len(line.split()) >= 3]
    except OSError as e:
        raise Refused(f"cannot read $SSH_USER_AUTH ({path}): {e}")


def who():
    people = by_key(load_people())
    found = {people[k].name: people[k] for k in connected_keys() if k in people}
    if not found:
        raise Refused("your SSH key is not in the box's people.conf: send your public key (~/.ssh/<key>.pub) to the "
                      "box's owner")
    if len(found) > 1:
        raise Refused(f"your session's keys belong to several people ({', '.join(found)})")
    person = next(iter(found.values()))
    if not person.account:
        raise Refused(f"people.conf gives {person.name} no account: the box's owner runs "
                      f"scripts/devenv/people.sh add {person.name} --account <id, email or system>")
    if not (person.git_name and person.git_email):
        raise Refused(f"people.conf gives {person.name} no git identity (the name and email their task commits carry): "
                      f"the box's owner runs scripts/devenv/people.sh add {person.name} --git-name '<name>' "
                      "--git-email <email>")
    return person


def identity(person):
    return f"{person.git_name} <{person.git_email}>"


def set_git_identity(wt, person):
    """The person's name and email for commits in <wt> only. extensions.worktreeConfig lives in the repo's shared
    config and only lets each worktree read its own config.worktree; the user.* values go there, so the main checkout
    and the other envs keep theirs."""
    def git(*args):
        out = subprocess.run(["git", "-C", wt, *args], capture_output=True, text=True)
        if out.returncode != 0:
            raise Refused(f"git {' '.join(args)} in {wt} failed: {out.stderr.strip()}")
        return out.stdout.strip()
    git("config", "extensions.worktreeConfig", "true")
    git("config", "--worktree", "user.name", person.git_name)
    git("config", "--worktree", "user.email", person.git_email)
    got = (git("config", "user.name"), git("config", "user.email"))
    if got != (person.git_name, person.git_email):
        raise Refused(f"{wt} commits as {got[0]} <{got[1]}> after setting {identity(person)}: a config with higher "
                      "precedence overrides it")


def check_name(person, task):
    if not task.startswith(person.prefix):
        raise Refused(f"{person.name}'s task names start with '{person.prefix}' (people.conf): start it as "
                      f"{person.prefix}{task}")


def orca_ide():
    """orca-ide on PATH, else the newest Orca server under ~/.local/opt (/usr/bin/orca on Linux is a screen reader)."""
    for d in os.environ.get("PATH", "").split(os.pathsep):
        if os.access(os.path.join(d, "orca-ide"), os.X_OK):
            return os.path.join(d, "orca-ide")
    found = sorted(glob.glob(os.path.join(HOME, ".local/opt/orca-server-*/bin/orca-ide")))
    if not found:
        raise Refused("no orca-ide on the box (on PATH or under ~/.local/opt/orca-server-*/bin)")
    return found[-1]


def orca(*args, check=True):
    out = subprocess.run([orca_ide(), *args], capture_output=True, text=True)
    if check and out.returncode != 0:
        raise Refused(f"orca-ide {' '.join(args[:2])} failed: {(out.stderr or out.stdout).strip()[:300]}")
    return out.stdout


def claude_accounts():
    return json.loads(orca("account", "list", "--json"))["result"]["claude"]


def config_json(home):
    """Claude Code keeps its login in ~/.claude.json for the default config dir, else in <dir>/.claude.json."""
    if os.path.realpath(home) == os.path.realpath(DEFAULT_HOME):
        return os.path.join(HOME, ".claude.json")
    return os.path.join(home, ".claude.json")


def signed_in_email(home):
    try:
        with open(config_json(home)) as f:
            return ((json.load(f).get("oauthAccount") or {}).get("emailAddress")) or ""
    except (OSError, ValueError):
        return ""


def resolve(person, listing):
    """The person's account as the box's Orca knows it, signed in as the email people.conf expects."""
    want = person.account
    if want == "system":
        acct = Account("system", listing.get("systemDefaultHome") or DEFAULT_HOME, "")
    else:
        hits = [a for a in listing.get("accounts") or [] if want in (a.get("id"), a.get("label"))]
        hits = hits or [a for a in listing.get("accounts") or [] if a.get("email") == want]
        if not hits:
            raise Refused(f"{person.name}'s account '{want}' is not in the box's Orca (orca-ide account list): its "
                          "owner adds it there (orca-ide account add) or fixes people.conf")
        if len(hits) > 1:
            raise Refused(f"'{want}' names {len(hits)} Orca accounts on the box: people.conf must give its id")
        acct = Account(hits[0]["id"], hits[0].get("home") or "", hits[0].get("email") or "")
        if not acct.home:
            raise Refused(f"the box's Orca gives account {want} no home folder")
    email = signed_in_email(acct.home)
    if not email:
        raise Refused(f"{person.name}'s account '{want}' is not signed in on the box (no login in "
                      f"{config_json(acct.home)}: signed out or expired). Its owner signs it in again")
    for expected in filter(None, (person.email, acct.email)):
        if email != expected:
            raise Refused(f"{person.name}'s account '{want}' is signed in as {email}, not {expected}")
    return acct


def claude_procs(wt):
    """The claude processes whose folder is <wt>, each with the config dir it runs with."""
    wt, procs = os.path.realpath(wt), []
    try:
        pids = [p for p in os.listdir(PROC) if p.isdigit()]
    except OSError:
        raise Refused(f"no {PROC} on the box: box launches need Linux")
    for pid in pids:
        base = os.path.join(PROC, pid)
        try:
            with open(os.path.join(base, "comm")) as f:
                if not f.read().startswith("claude"):
                    continue
            if os.path.realpath(os.readlink(os.path.join(base, "cwd"))) != wt:
                continue
            with open(os.path.join(base, "environ"), "rb") as f:
                env = dict(v.split(b"=", 1) for v in f.read().split(b"\0") if b"=" in v)
        except OSError:
            continue
        procs.append(Proc(pid, env.get(b"CLAUDE_CONFIG_DIR", b"").decode() or DEFAULT_HOME))
    return procs


def terminals(wt):
    out = orca("terminal", "list", "--worktree", f"path:{wt}", check=False)
    return [line.split()[0] for line in out.splitlines() if line.startswith("term_")]


def stop(wt):
    for t in terminals(wt):
        if subprocess.run([orca_ide(), "terminal", "close", "--terminal", t], capture_output=True).returncode == 0:
            say(f"closed Orca terminal {t}")


def trust(home, wt):
    """Claude asks "trust this folder?" first, and the question swallows the prompt. task.sh marks the folder trusted in
    ~/.claude.json; an Orca account keeps its own .claude.json, so mark it there too."""
    path = config_json(home)
    try:
        with open(path) as f:
            c = json.load(f)
    except (OSError, ValueError):
        c = {}
    c.setdefault("projects", {}).setdefault(wt, {})["hasTrustDialogAccepted"] = True
    with open(path + ".new", "w") as f:
        json.dump(c, f, indent=2)
    os.replace(path + ".new", path)


@contextlib.contextmanager
def launch_lock():
    """Orca's account selection is one setting for the whole box: two launches must not interleave select and spawn."""
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    with open(LOCK, "a") as f:
        deadline, told = time.time() + LOCK_WAIT, False
        while True:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.time() > deadline:
                    raise Refused(f"another launch held {LOCK} for {LOCK_WAIT} s")
                if not told:
                    say("wait  another launch is starting its Claude on the box; this one goes next")
                    told = True
                time.sleep(1)
        yield


def record(task, person, acct):
    d = os.path.join(HOME, "claude-artifacts/dod", f"box-{task}")
    os.makedirs(d, mode=0o700, exist_ok=True)
    lines = [f"requester={person.name}", f"account={person.account}", f"account-id={acct.select}",
             f"email={signed_in_email(acct.home)}", f"config={acct.home}",
             f"git-name={person.git_name}", f"git-email={person.git_email}",
             "launched=" + time.strftime("%Y-%m-%dT%H:%M:%S%z")]
    with open(os.path.join(d, "LAUNCH"), "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(os.path.join(d, "LAUNCH"), 0o600)


def cmd_check(task):
    person = who()
    check_name(person, task)
    acct = resolve(person, claude_accounts())
    say(f"ok    you are {person.name} (people.conf); Claude runs as {person.account}, signed in as "
        f"{signed_in_email(acct.home)}; commits as {identity(person)}")
    print("@config", acct.home)


def cmd_launch(task, wt, prompt):
    person = who()
    check_name(person, task)
    already = claude_procs(wt)
    if already:
        raise Refused(f"a Claude already runs in {wt} (pid {already[0].pid}): close its terminal first")
    set_git_identity(wt, person)
    with launch_lock():
        listing = claude_accounts()
        acct = resolve(person, listing)
        trust(acct.home, wt)
        before = listing.get("activeAccountId") or "system"
        orca("account", "select", "--agent", "claude", "--account", acct.select, "--json")
        try:
            # The launch reply may say it could not confirm although the agent started: the proof is the process.
            orca("agent", "launch", "--agent", "claude", "--surface", "terminal", "--focus", "--worktree", f"path:{wt}",
                 "--prompt", prompt, "--json", check=False)
            deadline, since = time.time() + ALIVE_WAIT, None
            while time.time() < deadline:
                if not claude_procs(wt):
                    since = None
                elif since is None:
                    since = time.time()
                if since is not None and time.time() - since >= SETTLE:
                    break
                time.sleep(0.5)
        finally:
            if before != acct.select:
                orca("account", "select", "--agent", "claude", "--account", before, "--json", check=False)
    procs = claude_procs(wt)
    if not procs:
        raise Refused(f"no Claude process in {wt} after {ALIVE_WAIT} s")
    wrong = [p for p in procs if os.path.realpath(p.config) != os.path.realpath(acct.home)]
    if wrong:
        stop(wt)
        raise Refused(f"the Claude started in {wt} uses {wrong[0].config}, not {person.name}'s account "
                      f"{person.account} ({acct.home}); it was stopped")
    record(task, person, acct)
    say(f"ok    Claude started for {person.name} as {person.account} ({signed_in_email(acct.home)}), committing as "
        f"{identity(person)}, recorded in ~/claude-artifacts/dod/box-{task}/LAUNCH")
    print("@config", acct.home)


def cmd_tail(wt):
    ts = terminals(wt)
    if ts:
        print("\n".join(orca("terminal", "read", "--terminal", ts[0], "--screen", "--limit", "15",
                             check=False).splitlines()[-15:]))


# ---------- people.sh, the box side: the owner's laptop sends it over SSH ----------

NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,30}$")
KEY_RE = re.compile(r"^(ssh-[a-z0-9-]+|ecdsa-sha2-[a-z0-9-]+|sk-[a-z0-9@.-]+) AAAA[A-Za-z0-9+/]+=*( \S.*)?$")
REQUIRED = (("--key", "keys"), ("--account", "account"), ("--git-name", "git_name"), ("--git-email", "git_email"))
Box = namedtuple("Box", "name ssh")   # the registry's name for the box and its SSH target, for the commands printed


def key_label(line):
    """A key as a person reads it: its comment, else the end of its blob."""
    words = line.split()
    return " ".join(words[2:]) if len(words) > 2 and words[1].startswith("AAAA") else "..." + key_blob(line)[-12:]


def authorized_lines():
    try:
        with open(AUTHORIZED) as f:
            return f.read().splitlines()
    except FileNotFoundError:
        return []


def is_key_line(line):
    return bool(line.strip()) and not line.lstrip().startswith("#")


def write_authorized(lines):
    os.makedirs(os.path.dirname(AUTHORIZED), mode=0o700, exist_ok=True)
    with open(AUTHORIZED + ".devbox-new", "w") as f:
        f.write("".join(line + "\n" for line in lines))
    os.chmod(AUTHORIZED + ".devbox-new", 0o600)
    os.replace(AUTHORIZED + ".devbox-new", AUTHORIZED)


def people_conf(*args):
    out = subprocess.run(["git", "config", "-f", PEOPLE, *args], capture_output=True, text=True)
    if out.returncode != 0:
        raise Refused(f"git config -f {PEOPLE} {' '.join(args[:2])} failed: {out.stderr.strip()}")


def session_keys():
    return set(connected_keys()) if os.environ.get("SSH_USER_AUTH") else set()


def sshd_exposes_auth():
    paths = [SSHD_CONFIG] + sorted(glob.glob(os.path.join(os.path.dirname(SSHD_CONFIG), "sshd_config.d", "*.conf")))
    for path in paths:
        try:
            with open(path) as f:
                if re.search(r"^\s*ExposeAuthInfo\s+yes\b", f.read(), re.M | re.I):
                    return True
        except OSError:
            continue
    return False


def parse_key(text, name, box):
    """A public key line as people.conf and authorized_keys keep it: one space between words, a comment always."""
    line = " ".join(text.split())
    if not KEY_RE.match(line):
        raise Refused(f"--key: not a public key line (<type> AAAA... <comment>): {text[:60]}")
    return line if len(line.split()) > 2 else f"{line} {name}-to-{box.name}"


def field_error(var, value):
    if "\n" in value or value != value.strip():
        return "one line, without leading or trailing spaces"
    if var == "account" and re.search(r"\s", value):
        return "an Orca account id, email or label, or system: no spaces"
    if var == "prefix" and value and not re.fullmatch(r"[a-z0-9-]+", value):
        return "lowercase letters, digits and dashes"
    if var in ("email", "git-email") and value and not re.fullmatch(r"[^\s<>@]+@[^\s<>@]+", value):
        return "an email address"
    if var == "git-name" and re.search(r"[<>]", value):
        return "no < or >"
    return ""


def people_sh(box, *words):
    return " ".join(["scripts/devenv/people.sh", *map(shlex.quote, words), "--box", shlex.quote(box.name)])


def sign_in(box, person):
    if person.account == "system":
        return (f"sign the box's own Claude in: ssh -t {box.ssh} claude, then /login in it"
                + (f", as {person.email}" if person.email else ""))
    return (f"ssh -t {box.ssh} {shlex.quote(orca_ide_path() + ' account add --agent claude')}, open the sign-in link it "
            f"prints in a private browser window and sign in as {person.email or 'the Claude account you give ' + person.name}; "
            "then " + people_sh(box, "add", person.name, "--account", "<new account id or email>"))


def people_add(box, a):
    if not NAME_RE.match(a.name):
        raise Refused(f"'{a.name}': a name is lowercase letters, digits and dashes, starting with a letter")
    people = load_people(missing_ok=True)
    old = people.get(a.name) or Person(a.name, (), "", "", "", "", "")
    owner = {key_blob(k): p.name for p in people.values() for k in p.keys}
    keys = list(old.keys)
    for line in (parse_key(k, a.name, box) for k in a.key):
        if owner.get(key_blob(line), a.name) != a.name:
            raise Refused(f"the key {key_label(line)} is {owner[key_blob(line)]}'s in people.conf: one key belongs to one "
                          "person (each developer sends their own, from join.sh)")
        if key_blob(line) not in map(key_blob, keys):
            keys.append(line)
    given = {var: getattr(a, field) for var, field in VARS.items() if getattr(a, field) is not None}
    for var, value in given.items():
        if field_error(var, value):
            raise Refused(f"--{var} {value!r}: {field_error(var, value)}")
    new = old._replace(keys=tuple(keys), **{VARS[var]: value for var, value in given.items()})
    lacking = [flag for flag, field in REQUIRED if not getattr(new, field)]
    if lacking:
        raise Refused(f"{a.name}'s record would lack {', '.join(lacking)}: run "
                      + people_sh(box, "add", a.name, *[w for f in lacking for w in (f, f"<{f[2:]}>")]))
    os.makedirs(os.path.dirname(PEOPLE), mode=0o700, exist_ok=True)
    changes = []
    for var, field in VARS.items():
        before, after = getattr(old, field), getattr(new, field)
        if before == after:
            continue
        if after:
            people_conf("--replace-all", f"person.{a.name}.{var}", after)
        else:
            people_conf("--unset-all", f"person.{a.name}.{var}")
        changes.append(f"people.conf      {var}: {before or '(none)'} -> {after or '(none)'}")
    for line in new.keys[len(old.keys):]:
        people_conf("--add", f"person.{a.name}.key", line)
        changes.append(f"people.conf      key: + {key_label(line)}")
    os.chmod(PEOPLE, 0o600)
    lines = authorized_lines()
    have = {key_blob(line) for line in lines if is_key_line(line)}
    more = [k for k in new.keys if key_blob(k) not in have and KEY_RE.match(k)]
    if more:
        write_authorized(lines + more)
        changes += [f"authorized_keys  + {key_label(k)}" for k in more]
    print(f"{'added' if a.name not in people else 'updated'} {a.name}" if changes
          else f"{a.name} is already as given: nothing changed")
    for c in changes:
        print("  " + c)
    print()
    people_check(box, a.name)
    return 0


def people_check(box, only=None):
    """Per person, what is ready and what is missing, each missing step with the command that fixes it. 1 while
    anything is missing."""
    people = load_people()
    if only and only not in people:
        raise Refused(f"no {only} in people.conf (people.sh list)")
    try:
        listing, orca_problem = claude_accounts(), ""
    except (Refused, ValueError, KeyError) as e:
        listing, orca_problem = {}, f"the box's Orca does not list its accounts: {e}"
    auth = {key_blob(line) for line in authorized_lines() if is_key_line(line)}
    session = session_keys()
    missing = {}
    out = []

    def ok(msg):
        out.append(f"  ok       {msg}")

    def miss(who, msg, fix=None, by_hand=None):
        missing[who] = missing.get(who, 0) + 1
        out.append(f"  MISSING  {msg}")
        out.extend([f"           fix: {fix}"] if fix else [])
        out.extend([f"           by hand: {by_hand}"] if by_hand else [])

    out.append(f"box {box.name}")
    if sshd_exposes_auth():
        ok("sshd names the key each session logged in with (ExposeAuthInfo yes)")
    else:
        miss(box.name, f"sshd does not name the session's key (no ExposeAuthInfo yes in {SSHD_CONFIG}), so launches "
             "cannot tell people apart", fix=f"ssh -t {box.ssh} \"echo 'ExposeAuthInfo yes' | sudo tee "
             "/etc/ssh/sshd_config.d/devbox.conf && sudo systemctl reload ssh\"")
    for p in sorted(people.values()):
        if only and p.name != only:
            continue
        out.append(p.name)
        if not p.keys:
            miss(p.name, "no SSH key", fix=people_sh(box, "add", p.name, "--key", "<their public key line>"))
        for k in p.keys:
            if key_blob(k) in auth:
                ok(f"key {key_label(k)} in ~/.ssh/authorized_keys")
            elif KEY_RE.match(k):
                miss(p.name, f"key {key_label(k)} is not in ~/.ssh/authorized_keys", fix=people_sh(box, "add", p.name))
            else:
                miss(p.name, f"key {key_label(k)} in people.conf is not a whole public key line, so it cannot go in "
                     "~/.ssh/authorized_keys", by_hand="replace it in people.conf with the line from their .pub file")
        if not p.account:
            miss(p.name, "no Claude account",
                 fix=people_sh(box, "add", p.name, "--account", "<Orca account id or email, or system>"))
        elif orca_problem:
            miss(p.name, orca_problem)
        else:
            try:
                acct = resolve(p, listing)
                ok(f"Claude account {p.account} in the box's Orca, signed in as {signed_in_email(acct.home)}")
            except Refused as e:
                miss(p.name, str(e), by_hand=sign_in(box, p))
        if p.git_name and p.git_email:
            ok(f"git identity {identity(p)}")
        else:
            miss(p.name, "no git identity (the name and email their task commits carry): launches refuse them",
                 fix=people_sh(box, "add", p.name, "--git-name", "<name>", "--git-email", "<email>"))
        if not session & set(map(key_blob, p.keys)):
            out.append(f"  by hand  Tailscale: share {box.name} with them (admin console: Machines > {box.name} > Share) "
                       "and they accept the invite. No script can see this; join.sh on their Mac checks it")
    named = [p for p in sorted(people) if not only or p == only]
    ready = [n for n in named if n not in missing]
    out.append("")
    out.append(f"ready: {', '.join(ready) or '(no one)'}" + ("; missing: " + ", ".join(
        f"{n} ({c})" for n, c in missing.items()) if missing else ""))
    print("\n".join(out))
    return 1 if missing else 0


def people_list(box):
    people = load_people(missing_ok=True)
    for p in sorted(people.values()):
        print(f"{p.name:<12} account={p.account or '-'}  email={p.email or '-'}  prefix={p.prefix or '-'}  "
              f"git={identity(p) if p.git_name and p.git_email else '-'}  keys={', '.join(map(key_label, p.keys)) or '-'}")
    if not people:
        print(f"no one in {PEOPLE} on {box.name}")
    owned = set(by_key(people))
    for line in authorized_lines():
        if is_key_line(line) and key_blob(line) not in owned:
            print(f"{'(no one)':<12} authorized_keys: {key_label(line)} logs in, but people.conf names no one for it, "
                  "so it cannot launch")
    return 0


def people_remove(box, a):
    people = load_people()
    p = people.get(a.name)
    if not p:
        raise Refused(f"no {a.name} in people.conf (people.sh list)")
    blobs = set(map(key_blob, p.keys))
    if blobs & session_keys():
        raise Refused(f"{a.name}'s key is the one this session logged in with: removing it would lock you out")
    lines = authorized_lines()
    gone = [line for line in lines if is_key_line(line) and key_blob(line) in blobs]
    print(f"{'remove' if a.yes else 'would remove'} from {box.name}:")
    for line in gone:
        print(f"  ~/.ssh/authorized_keys  {key_label(line)}")
    print(f"  people.conf             [person \"{a.name}\"] ("
          + ", ".join(f"{var} = {getattr(p, field)}" for var, field in VARS.items() if getattr(p, field)) + ")")
    print("keeps (by hand if you want them gone):")
    users = [o.name for o in people.values() if o.name != p.name and o.account == p.account]
    if p.account and p.account != "system":
        print(f"  the Orca account {p.account}: " + (f"still used by {', '.join(users)}" if users else
              f"ssh -t {box.ssh} '{orca_ide_path()} account rm --agent claude --account {p.account}'"))
    print(f"  the Tailscale share: admin console, Machines > {box.name} > Share")
    if not a.yes:
        print("dry run: nothing changed. Run it again with --yes to remove the lines above")
        return 0
    write_authorized([line for line in lines if not (is_key_line(line) and key_blob(line) in blobs)])
    people_conf("--remove-section", f"person.{a.name}")
    print(f"removed {a.name}")
    return 0


def orca_ide_path():
    try:
        return orca_ide()
    except Refused:
        return "orca-ide"


def cmd_people(b64):
    box_name, ssh, *argv = json.loads(base64.b64decode(b64).decode())
    box = Box(box_name, ssh)
    parser = argparse.ArgumentParser(prog="people.sh", description="scripts/devenv/people.sh's header says more")
    verbs = parser.add_subparsers(dest="verb", required=True)
    add = verbs.add_parser("add")
    add.add_argument("name")
    add.add_argument("--key", action="append", default=[])
    for var in VARS:
        add.add_argument(f"--{var}")
    verbs.add_parser("check").add_argument("name", nargs="?")
    remove = verbs.add_parser("remove")
    remove.add_argument("name")
    remove.add_argument("--yes", action="store_true")
    verbs.add_parser("list")
    a = parser.parse_args(argv)
    sys.exit({"add": lambda: people_add(box, a), "check": lambda: people_check(box, a.name),
              "remove": lambda: people_remove(box, a), "list": lambda: people_list(box)}[a.verb]())


COMMANDS = {
    "people": (1, cmd_people),
    "check": (1, cmd_check),
    "launch": (3, lambda task, wt, b64: cmd_launch(task, wt, base64.b64decode(b64).decode())),
    "alive": (1, lambda wt: sys.exit(0 if claude_procs(wt) else 1)),
    "tail": (1, cmd_tail),
    "stop": (1, stop),
}

if __name__ == "__main__":
    name, args = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    if name not in COMMANDS or len(args) != COMMANDS[name][0]:
        say(__doc__)
        sys.exit(2)
    try:
        COMMANDS[name][1](*args)
    except Refused as e:
        say(f"STOP  {e}")
        sys.exit(1)
