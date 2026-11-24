#!/bin/bash
# Tests people.sh, the owner's onboarding tool for a shared box: add writes a person's record in the box's people.conf
# and each key once in its authorized_keys, converges on a rerun, updates a changed value, and refuses a key someone
# else owns or a record left incomplete; check names each missing piece with its fix and exits 1 while one is missing;
# remove is a dry run without --yes, then takes out exactly that person's keys and record, never the session's own
# key; list shows everyone and the keys no one owns.
# A temp registry, a box home under a fresh folder, stub ssh (it runs the box side locally and hands it
# $SSH_USER_AUTH as sshd's ExposeAuthInfo does) and a stub orca-ide. No network, no real box, nothing outside a fresh
# folder under $TMPDIR, which each run leaves in place.
# Run: /bin/bash scripts/devenv/test_people.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/test_people.XXXXXX")" && pwd -P)"
echo "scratch: $T"
OUT="" RC=0 N=0
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
has() { case "$OUT" in *"$1"*) pass "$2" ;; *) fail "$2 (output lacks: $1)" ;; esac; }
lacks() { case "$OUT" in *"$1"*) fail "$2 (output has: $1)" ;; *) pass "$2" ;; esac; }
same() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; pass "$3"; }

BOXH="$T/boxes/t@r7-test"; PROFILES="$BOXH/.config/orca/claude-profiles"
P="$BOXH/.config/devbox/people.conf"; AK="$BOXH/.ssh/authorized_keys"
mkdir -p "$T/bin" "$T/home" "$BOXH/.ssh" "$(dirname "$P")" "$PROFILES/acct-madhu/home" "$PROFILES/acct-late/home"
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -t|-q) shift ;; *) break ;; esac; done
home="$STUB_BOXES/$1"; shift
unset SSH_USER_AUTH
if [ -n "${STUB_KEY:-}" ]; then
  export SSH_USER_AUTH="$STUB_BOXES/.auth-$$"; printf 'publickey ssh-ed25519 %s\n' "$STUB_KEY" > "$SSH_USER_AUTH"
fi
cd "$home" && HOME="$home" exec bash -c "$*"
EOF
cat > "$T/bin/orca-ide" <<'EOF'
#!/bin/bash
case "$1 $2" in
  "account list") sed "s|@P@|$HOME/.config/orca/claude-profiles|g" "$HOME/.orca-accounts.json" ;;
esac
EOF
chmod +x "$T/bin/ssh" "$T/bin/orca-ide"
export PATH="$T/bin:/usr/bin:/bin" HOME="$T/home" STUB_BOXES="$T/boxes" DEVBOX_SSHD_CONFIG="$T/sshd_config"
export DEVBOX_REGISTRY="$T/boxes.conf" STUB_KEY=AAAAC3NzaOwner
git config -f "$DEVBOX_REGISTRY" box.r7.ssh t@r7-test
git config -f "$DEVBOX_REGISTRY" box.r7.checkout work/x/variants/master
git config -f "$DEVBOX_REGISTRY" box.r7.launch box
echo "ExposeAuthInfo yes" > "$T/sshd_config"

# ---- the box as r7 has it today: two people, no git identities, both keys authorized, one stray key
cat > "$BOXH/.orca-accounts.json" <<'EOF'
{"ok": true, "result": {"claude": {"accounts": [
  {"id": "acct-madhu", "email": "madhu@example.com", "home": "@P@/acct-madhu/home"},
  {"id": "acct-late", "email": "late@example.com", "home": "@P@/acct-late/home"}],
  "activeAccountId": null}}}
EOF
echo '{"oauthAccount": {"emailAddress": "owner@example.com"}}' > "$BOXH/.claude.json"
echo '{"oauthAccount": {"emailAddress": "madhu@example.com"}}' > "$PROFILES/acct-madhu/home/.claude.json"
echo '{}' > "$PROFILES/acct-late/home/.claude.json"
OWNER_KEY="ssh-ed25519 AAAAC3NzaOwner abhishek-mbp-to-r7" MADHU_KEY="ssh-ed25519 AAAAC3NzaMadhu madhu-to-r7"
git config -f "$P" person.abhishek.key "$OWNER_KEY"
git config -f "$P" person.abhishek.account system
git config -f "$P" person.abhishek.email owner@example.com
git config -f "$P" person.madhu.key "$MADHU_KEY"
git config -f "$P" person.madhu.account acct-madhu
git config -f "$P" person.madhu.email madhu@example.com
git config -f "$P" person.madhu.prefix madhu-
chmod 600 "$P"
printf '%s\n%s\n%s\n' "$OWNER_KEY" "$MADHU_KEY" "ssh-ed25519 AAAAC3NzaStray old-laptop" > "$AK"
echo "ssh-ed25519 AAAAC3NzaRavi ravi-to-r7" > "$T/ravi.pub"

ppl() { run /bin/bash "$HERE/people.sh" "$@"; }
sums() { cat "$P" "$AK" | shasum | cut -c1-12; }
conf() { git config -f "$P" "$@" || true; }
count() { grep -c -- "$1" "$AK" || true; }

# ---- check: what r7 lacks today
ppl check
rc_is 1 "check exits 1 while something is missing"
has "  ok       sshd names the key each session logged in with" "check sees ExposeAuthInfo"
has "  ok       key madhu-to-r7 in ~/.ssh/authorized_keys" "check sees madhu's key authorized"
has "  ok       Claude account acct-madhu in the box's Orca, signed in as madhu@example.com" "check sees madhu's account signed in"
has "  ok       Claude account system in the box's Orca, signed in as owner@example.com" "check sees the owner's account"
has "  MISSING  no git identity" "check names the missing git identity"
has "fix: scripts/devenv/people.sh add madhu --git-name '<name>' --git-email '<email>' --box r7" "check prints the git identity fix"
has "missing: abhishek (1), madhu (1)" "check counts what each person lacks"
same "$(printf '%s\n' "$OUT" | grep -c 'by hand  Tailscale')" 1 "the Tailscale step is printed for madhu, not for the session's own person"
has "Machines > r7 > Share" "the Tailscale step says where to share"

# ---- add: the migration of the two existing people
before="$(sums)"
ppl add abhishek --git-name "Abhishek Kumar" --git-email abhishek@nirmaan.app
rc_is 0 "add of a git identity exits 0"
has "updated abhishek" "add says it updated the record"
has "git-name: (none) -> Abhishek Kumar" "add names the change"
same "$(conf person.abhishek.git-name)" "Abhishek Kumar" "people.conf holds the git name"
same "$(conf person.abhishek.account)" system "add keeps the values it was not given"
same "$(stat -f %Lp "$P" 2>/dev/null || stat -c %a "$P")" 600 "people.conf stays mode 600"
has "ready: abhishek" "add ends with the person's check"

before="$(sums)"
ppl add abhishek --git-name "Abhishek Kumar" --git-email abhishek@nirmaan.app
rc_is 0 "a rerun exits 0"; has "abhishek is already as given: nothing changed" "a rerun changes nothing"
same "$(sums)" "$before" "a rerun leaves people.conf and authorized_keys as they were"

ppl add madhu --git-name "Madhu B" --git-email madhu@old.example.com
ppl add madhu --git-email madhu@nirmaan.example.com
rc_is 0 "a changed value exits 0"; has "git-email: madhu@old.example.com -> madhu@nirmaan.example.com" "a changed value is updated"
same "$(conf --get-all person.madhu.git-email)" madhu@nirmaan.example.com "the old value is replaced, not kept beside it"

# ---- add: a new person
ppl add ravi --key "$T/ravi.pub" --account acct-ravi --git-name "Ravi K" --git-email ravi@example.com --prefix ravi-
rc_is 0 "a new person exits 0"
has "added ravi" "add says it added the person"
has "authorized_keys  + ravi-to-r7" "add authorizes the key"
same "$(grep -F AAAAC3NzaRavi "$AK")" "ssh-ed25519 AAAAC3NzaRavi ravi-to-r7" "the key goes in with its comment"
same "$(conf person.ravi.key)" "ssh-ed25519 AAAAC3NzaRavi ravi-to-r7" "the key from a .pub file is recorded"
has "MISSING  ravi's account 'acct-ravi' is not in the box's Orca" "the check after add names the missing account"
has "by hand: ssh -t t@r7-test '$T/bin/orca-ide account add --agent claude', open the sign-in link" "the sign-in step names the box's orca-ide"
has "scripts/devenv/people.sh add ravi --account '<new account id or email>' --box r7" "the sign-in step ends with the people.sh command"

ppl add ravi --key "ssh-ed25519 AAAAC3NzaRavi ravi-other-comment"
same "$(count AAAAC3NzaRavi)" 1 "a key already authorized is never added twice"
same "$(conf --get-all person.ravi.key | wc -l | tr -d ' ')" 1 "a key already recorded is never recorded twice"

ppl add sam --key "ssh-ed25519 AAAAC3NzaStray sam-to-r7" --account system --git-name Sam --git-email sam@example.com
rc_is 0 "a person whose key is already in authorized_keys is added"
same "$(count AAAAC3NzaStray)" 1 "that key stays once in authorized_keys"

before="$(sums)"
ppl add nina --key "ssh-ed25519 AAAAC3NzaNina nina-to-r7"
rc_is 1 "a new person without account and git identity is refused"
has "nina's record would lack --account, --git-name, --git-email" "the refusal names the missing flags"
same "$(sums)" "$before" "a refused add changes nothing"

ppl add nina --key "$MADHU_KEY" --account system --git-name Nina --git-email nina@example.com
rc_is 1 "a key another person owns is refused"; has "the key madhu-to-r7 is madhu's in people.conf" "the refusal names the owner"
same "$(sums)" "$before" "a refused key changes nothing"

ppl add nina --key "not a key" --account system --git-name Nina --git-email nina@example.com
rc_is 1 "a line that is not a public key is refused"; has "not a public key line" "the refusal says why"
ppl add Nina --key "$T/ravi.pub"
rc_is 1 "a name with capitals is refused"
ppl add nina --account "two words" --key "ssh-ed25519 AAAAC3NzaNina n" --git-name N --git-email n@example.com
rc_is 1 "an account with spaces is refused"
same "$(sums)" "$before" "refused values change nothing"
ppl add nina --bogus
rc_is 2 "an unknown flag is a usage error"
run /bin/bash "$HERE/people.sh"
rc_is 2 "no verb is a usage error"

# ---- check: each missing piece, with its fix
grep -v ravi-to-r7 "$AK" > "$AK.t"; mv "$AK.t" "$AK"
ppl check ravi
rc_is 1 "a check of one person exits 1 while they lack something"
has "MISSING  key ravi-to-r7 is not in ~/.ssh/authorized_keys" "check names a key missing from authorized_keys"
has "fix: scripts/devenv/people.sh add ravi --box r7" "the fix for a missing key is a rerun of add"
lacks "madhu" "a check of one person shows only them"
ppl add ravi --account acct-late
has "authorized_keys  + ravi-to-r7" "a rerun of add puts the missing key back"
has "MISSING  ravi's account 'acct-late' is not signed in on the box" "check names a signed-out account"
has "sign in as the Claude account you give ravi" "the sign-in step says whom to sign in as"

ppl check abhishek
rc_is 0 "check exits 0 for a person with nothing missing"; has "ready: abhishek" "check says ready"

echo "PasswordAuthentication no" > "$T/sshd_config"
ppl check abhishek
rc_is 1 "check exits 1 when sshd does not name the session's key"
has "MISSING  sshd does not name the session's key" "check names ExposeAuthInfo"
has "sudo tee /etc/ssh/sshd_config.d/devbox.conf" "the fix writes the sshd setting"
echo "ExposeAuthInfo yes" > "$T/sshd_config"

ppl check zed
rc_is 1 "check of an unknown name exits 1"; has "no zed in people.conf" "it says the name is unknown"

# ---- list
ppl list
rc_is 0 "list exits 0"
has "abhishek     account=system  email=owner@example.com  prefix=-  git=Abhishek Kumar <abhishek@nirmaan.app>  keys=abhishek-mbp-to-r7" "list shows the owner"
has "ravi         account=acct-late" "list shows a new person"

# ---- remove
git config -f "$P" person.sam.account acct-madhu
before="$(sums)"
ppl remove ravi
rc_is 0 "a dry run exits 0"
has "would remove from r7:" "a dry run says what it would remove"
has "~/.ssh/authorized_keys  ravi-to-r7" "it lists the key line"
has "people.conf             [person \"ravi\"]" "it lists the record"
has "account rm --agent claude --account acct-late" "it prints how to remove the Orca account"
has "dry run: nothing changed" "it says nothing changed"
same "$(sums)" "$before" "a dry run changes nothing"

ppl remove madhu
has "the Orca account acct-madhu: still used by sam" "an account someone else uses is not offered for removal"

ppl remove ravi --yes
rc_is 0 "remove --yes exits 0"; has "removed ravi" "it says it removed the person"
same "$(count AAAAC3NzaRavi)" 0 "ravi's key is gone from authorized_keys"
same "$(conf --get-regexp '^person\.ravi\.')" "" "ravi's record is gone"
same "$(grep -cF -e "$OWNER_KEY" -e "$MADHU_KEY" "$AK")" 2 "the owner's and madhu's keys stay"
same "$(conf person.abhishek.git-name)/$(conf person.madhu.git-name)" "Abhishek Kumar/Madhu B" "the other records stay"

before="$(sums)"
ppl remove abhishek --yes
rc_is 1 "removing the session's own key is refused"; has "would lock you out" "the refusal says why"
same "$(sums)" "$before" "the refused remove changes nothing"
ppl remove zed --yes
rc_is 1 "removing an unknown name is refused"

echo; echo "all $N checks passed"
