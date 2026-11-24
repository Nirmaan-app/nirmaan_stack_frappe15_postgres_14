"""Start a task's Claude on the box itself, as the Orca Claude account the box's owner gave the person whose SSH key
connected. The laptop pipes this file over SSH (python3 - <command> ...) for a box whose registry entry says
box.<name>.launch = box (scripts/devenv/boxes.sh), so the box's own copy of the scripts does not matter. Linux only
(it reads /proc). Progress goes to stderr; stdout carries only results.

  check <task>                      who connected, their account, and the task name's prefix. Prints @config <dir>:
                                    the Claude config dir the agent will use (its session logs are under <dir>/projects)
  launch <task> <worktree> <prompt, base64>
                                    under the launch lock: select the person's account in the box's Orca, start Claude
                                    in <worktree>, wait for its process, prove that process uses the account's config
                                    dir (else close its terminal and refuse), put the Orca selection back, and record
                                    requester and account in ~/claude-artifacts/dod/box-<task>/LAUNCH.
                                    Prints @config <dir>
  alive <worktree>                  exit 0 when a claude process runs in <worktree>
  tail <worktree>                   the last 15 rows of its Orca terminal's screen
  stop <worktree>                   close its Orca terminals

The rules: ~/.config/devbox/people.conf on the box, git config syntax, written by the box's owner, mode 600, outside
the repo. One section per person:
  [person "madhu"]
      key = ssh-ed25519 AAAA... madhu-laptop    a public key line or its base64 blob; one line per key
      account = <id, email or label>            from orca-ide account list on the box, or system (the box's own login)
      email = madhu@example.com                 optional: the email that account must be signed in as
      prefix = madhu-                           optional: each of their task names starts with it
Who connected: with ExposeAuthInfo yes in the box's sshd_config, sshd names the session's key in the file
$SSH_USER_AUTH. Everyone logs in as the same Linux user, so this keeps people's usage and billing apart, not their
secrets: anyone with a shell there can read and change whatever that user can, this file and people.conf included.

Exit 1: refused or failed, with the reason on stderr. Exit 2: wrong usage.
"""
import base64
import contextlib
import fcntl
import glob
import json
import os
import subprocess
import sys
import time
from collections import namedtuple

HOME = os.path.expanduser("~")
PEOPLE = os.path.join(HOME, ".config/devbox/people.conf")
LOCK = os.path.join(HOME, ".local/state/devbox/launch.lock")
DEFAULT_HOME = os.path.join(HOME, ".claude")
PROC = os.environ.get("DEVBOX_PROC", "/proc")   # set it only in tests
LOCK_WAIT, ALIVE_WAIT = 600, 60
# Orca starts Claude in two steps (a short-lived process that seeds the session, then the one that resumes it),
# reading the selected account at each. The selection goes back only once a Claude has run this long unbroken.
SETTLE = float(os.environ.get("DEVBOX_LAUNCH_SETTLE", "10"))

Person = namedtuple("Person", "name keys account email prefix")
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


def read_people(path=PEOPLE):
    """{key blob: Person} from people.conf. A key listed under two people is refused: the lookup must be one-to-one."""
    if not os.path.isfile(path):
        raise Refused(f"no rules at {path} on the box: its owner writes them (scripts/devenv/box_launch.py's header)")
    out = subprocess.run(["git", "config", "-f", path, "--list", "-z"], capture_output=True, text=True)
    if out.returncode != 0:
        raise Refused(f"{path} does not parse as git config: {out.stderr.strip()}")
    fields = {}
    for entry in filter(None, out.stdout.split("\0")):
        key, _, value = entry.partition("\n")
        section, _, var = key.rpartition(".")
        if section.startswith("person."):
            fields.setdefault(section[len("person."):], {}).setdefault(var, []).append(value.strip())
    by_key = {}
    for name, f in fields.items():
        person = Person(name, tuple(key_blob(k) for k in f.get("key", []) if k.strip()),
                        (f.get("account") or [""])[-1], (f.get("email") or [""])[-1], (f.get("prefix") or [""])[-1])
        for blob in person.keys:
            if blob in by_key and by_key[blob].name != name:
                raise Refused(f"{path} gives one key to both {by_key[blob].name} and {name}: its owner fixes that")
            by_key[blob] = person
    return by_key


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
    people = read_people()
    found = {people[k].name: people[k] for k in connected_keys() if k in people}
    if not found:
        raise Refused("your SSH key is not in the box's people.conf: send your public key (~/.ssh/<key>.pub) to the "
                      "box's owner")
    if len(found) > 1:
        raise Refused(f"your session's keys belong to several people ({', '.join(found)})")
    person = next(iter(found.values()))
    if not person.account:
        raise Refused(f"people.conf gives {person.name} no account: the box's owner sets person.{person.name}.account")
    return person


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
             "launched=" + time.strftime("%Y-%m-%dT%H:%M:%S%z")]
    with open(os.path.join(d, "LAUNCH"), "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(os.path.join(d, "LAUNCH"), 0o600)


def cmd_check(task):
    person = who()
    check_name(person, task)
    acct = resolve(person, claude_accounts())
    say(f"ok    you are {person.name} (people.conf); Claude runs as {person.account}, signed in as "
        f"{signed_in_email(acct.home)}")
    print("@config", acct.home)


def cmd_launch(task, wt, prompt):
    person = who()
    check_name(person, task)
    already = claude_procs(wt)
    if already:
        raise Refused(f"a Claude already runs in {wt} (pid {already[0].pid}): close its terminal first")
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
    say(f"ok    Claude started for {person.name} as {person.account} ({signed_in_email(acct.home)}), "
        f"recorded in ~/claude-artifacts/dod/box-{task}/LAUNCH")
    print("@config", acct.home)


def cmd_tail(wt):
    ts = terminals(wt)
    if ts:
        print("\n".join(orca("terminal", "read", "--terminal", ts[0], "--screen", "--limit", "15",
                             check=False).splitlines()[-15:]))


COMMANDS = {
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
