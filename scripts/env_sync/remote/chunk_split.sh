#!/bin/bash
# Runs inside a frappe container (CKP-2, B2 chunked route): split one backup file into fixed-size parts for a copy that can
# resume part by part over a slow or unstable link. The parts live in frappe-bench/envsync/chunks (local disk; outside any
# Frappe backups folder - a folder inside private/backups breaks every Frappe backup, VRF-6), never a cloud drive.
#
#   chunk_split.sh <file> <out dir> [<part MB, default 50>]
#
# Prints part=<name> size=<bytes> sha256=<hex> per part, then parts=<n>; error=... and exit 1 otherwise.
set -uo pipefail
F=$1 OUT=$2 MB=${3:-50}
test -s "$F" || { echo "error=no file at $F"; exit 1; }
[ -e "$OUT" ] && { echo "error=$OUT already exists"; exit 1; }
mkdir -p "$OUT" || { echo "error=cannot create $OUT"; exit 1; }
split -b "${MB}M" -d -a 3 "$F" "$OUT/part_" || { echo "error=split failed"; exit 1; }
n=0
for p in "$OUT"/part_*; do
  echo "part=$(basename "$p") size=$(stat -c %s "$p") sha256=$(sha256sum "$p" | cut -c1-64)"; n=$((n + 1))
done
echo "parts=$n"
