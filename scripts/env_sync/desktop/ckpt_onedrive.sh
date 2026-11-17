#!/usr/bin/env bash
# B4 (CKP-1): a CODE CHECKPOINT written by a desktop session into the desktop's OneDrive slice folder, so the laptop
# receives it when it reconnects even if the desktop has died meanwhile. Code and notes only - NEVER a database copy.
# Run by the desktop session itself, in Git Bash on the desktop host, at every milestone:
#
#   bash scripts/env_sync/desktop/ckpt_onedrive.sh <slice> [<session name>]
#
# Writes <OneDrive>\Desktop\BoQ main lane\<slice>\checkpoints\<stamp>\ (ckpt_code.sh's files + resume.md + ckpt.txt
# kind=B4) and keeps the newest 8. The bundle starts at the laptop's head as of the laptop's last checkpoint
# (envsync/last_laptop_head.txt, written by env_sync.sh checkpoint-code), so commits made after it travel too.
# Prints CHECKPOINT B4 <dir> on success, error=... and exit 1 otherwise. It never changes the checkout.
set -uo pipefail
SLICE=${1:-} NAME=${2:-}
[[ "$SLICE" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,40}$ ]] || { echo "error=usage: ckpt_onedrive.sh <slice> [<session name>]"; exit 1; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
BENCH=$(cd "$REPO/../.." && pwd)
ROOT="${ENV_SYNC_ONEDRIVE_SLICES:-$(cygpath -u "$USERPROFILE")/OneDrive/Desktop/BoQ main lane}"
[ -d "$(dirname "$ROOT")" ] || { echo "error=no OneDrive Desktop folder at $(dirname "$ROOT") - is OneDrive signed in on this machine?"; exit 1; }
DEST="$ROOT/$SLICE/checkpoints"
STAMP=$(date +%Y%m%d_%H%M%S)
BASE=$(tr -d '\r\n ' < "$BENCH/envsync/last_laptop_head.txt" 2>/dev/null)
mkdir -p "$DEST" || { echo "error=cannot create $DEST"; exit 1; }
# Build beside the destination, then rename: OneDrive never uploads a half-written checkpoint folder.
out=$(bash "$REPO/scripts/env_sync/remote/ckpt_code.sh" "$REPO" "$DEST/.partial_$STAMP" "$BASE") || { echo "$out"; exit 1; }
SD="$BENCH/envsync/sessions"
{ echo "# RESUME NOTE - $SLICE - B4 checkpoint $(date '+%F %T') (written on the desktop)"; echo
  echo "- desktop: $(git -C "$REPO" rev-parse --abbrev-ref HEAD) @ $(git -C "$REPO" rev-parse --short=9 HEAD); session: ${NAME:-none named}"
  echo; echo "## The session's own resume note (${NAME:-?}.resume.md)"; echo
  if [ -n "$NAME" ] && [ -f "$SD/$NAME.resume.md" ]; then cat "$SD/$NAME.resume.md"; else echo "(none written)"; fi
  echo; echo "## The session's status file, newest line first (first 40 lines)"; echo
  if [ -n "$NAME" ] && [ -f "$SD/$NAME.status.md" ]; then head -40 "$SD/$NAME.status.md" | sed 's/^/    /'; else echo "(none)"; fi
} > "$DEST/.partial_$STAMP/resume.md"
{ echo "kind=B4"; echo "slice=$SLICE"; echo "session=$NAME"; echo "made=$(date '+%F %T')"
  echo "desktop_head=$(git -C "$REPO" rev-parse HEAD)"; echo "laptop_head=${BASE:-unknown}"
  echo "tree=$(sed -n 's/^tree=//p' <<< "$out")"; echo "size=$(sed -n 's/^size=//p' <<< "$out")"; } > "$DEST/.partial_$STAMP/ckpt.txt"
mv "$DEST/.partial_$STAMP" "$DEST/$STAMP" || { echo "error=cannot finish $DEST/$STAMP"; exit 1; }
ls -1d "$DEST"/[0-9]*_[0-9]* 2>/dev/null | sort | head -n -8 | while read -r old; do rm -rf -- "$old"; done
echo "CHECKPOINT B4 $DEST/$STAMP ($(sed -n 's/^size=//p' <<< "$out") bytes, tree $(sed -n 's/^tree=//p' <<< "$out" | cut -c1-12))"
