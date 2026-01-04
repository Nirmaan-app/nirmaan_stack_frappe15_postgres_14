#!/bin/bash
# Script: manage_gcs_retention.sh
# Purpose: DELETE all backups older than 7 days from GCS bucket

set -euo pipefail

# --- CONFIGURATION ---
readonly GCS_BUCKET_NAME="nirmaan-stack-backups"
readonly RETENTION_DAYS=7
# ---------------------

readonly BUCKET_URI="gs://${GCS_BUCKET_NAME}"
readonly LOG_FILE="/var/log/nirmaan_backup.log"

log() {
    echo "[RETENTION] $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[RETENTION] $*"
}

readonly NOW_SECONDS=$(date +%s)
readonly CUTOFF_SECONDS=$((NOW_SECONDS - RETENTION_DAYS * 86400))
readonly CUTOFF_DATE=$(date -d "@${CUTOFF_SECONDS}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "${CUTOFF_SECONDS}" '+%Y-%m-%d %H:%M:%S')

log "=== GCS Retention: Keep last ${RETENTION_DAYS} days ==="
log "Cutoff: ${CUTOFF_DATE} (deleting older backups)"
log "Listing objects in ${BUCKET_URI}..."

# Get all objects with metadata using long listing format
# This gives us: size, creation_time, storage_uri
kept_count=0
deleted_count=0

while IFS= read -r line; do
    # Skip empty lines and header lines
    [[ -z "$line" ]] && continue
    [[ "$line" == *"TOTAL:"* ]] && continue

    # Parse the line - format is: SIZE  CREATION_TIME  gs://bucket/object
    # Example: 60554321  2026-01-03T14:26:30Z  gs://nirmaan-stack-backups/nirmaan-backup-2026-01-03_14-26-30.tar.gz

    # Extract object URI (last field)
    object_uri=$(echo "$line" | awk '{print $NF}')

    # Skip if not a valid gs:// URI
    [[ "$object_uri" != gs://* ]] && continue

    # Extract object name from URI
    object_name="${object_uri#gs://${GCS_BUCKET_NAME}/}"

    # Extract creation time (second field, ISO format)
    creation_time_str=$(echo "$line" | awk '{print $2}')

    # Skip if no valid timestamp
    if [[ -z "$creation_time_str" ]] || [[ "$creation_time_str" == "gs://"* ]]; then
        log "SKIP (no timestamp): ${object_name}"
        continue
    fi

    # Parse creation time to epoch seconds
    creation_time_seconds=$(date -d "$creation_time_str" +%s 2>/dev/null || echo "0")

    if [[ "$creation_time_seconds" == "0" ]]; then
        log "SKIP (cannot parse date '$creation_time_str'): ${object_name}"
        continue
    fi

    # Simple rule: Keep if within 7 days, delete if older
    if (( creation_time_seconds > CUTOFF_SECONDS )); then
        log "KEEP: ${object_name}"
        ((kept_count++))
    else
        log "DELETE (older than ${RETENTION_DAYS} days): ${object_name}"
        if gcloud storage rm "${object_uri}" --quiet 2>/dev/null; then
            ((deleted_count++))
        else
            log "ERROR: Failed to delete ${object_name}"
        fi
    fi

done < <(gcloud storage ls -l "${BUCKET_URI}")

log "=== Retention Complete: Kept ${kept_count}, Deleted ${deleted_count} ==="
