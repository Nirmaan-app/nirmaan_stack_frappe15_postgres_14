#!/bin/bash
# Script: manage_gcs_retention.sh (Version 7 - Single API Call via JSON/JQ)
# Purpose: Enforces retention (7 days daily, then alternate days).

set -euo pipefail

# --- CONFIGURATION ---
readonly GCS_BUCKET_NAME="nirmaan-stack-backups" # <--- ENSURE THIS IS CORRECT
# ---------------------

readonly BUCKET_URI="gs://${GCS_BUCKET_NAME}"
log() { 
    echo "[RETENTION] $*" | tee -a "/var/log/nirmaan_backup.log" 2>/dev/null || echo "[RETENTION] $*"
}

readonly NOW_SECONDS=$(date +%s)
readonly SEVEN_DAYS_AGO_SECONDS=$((NOW_SECONDS - 7 * 86400))
readonly FOURTEEN_DAYS_AGO_SECONDS=$((NOW_SECONDS - 14 * 86400))

log "Listing objects in ${BUCKET_URI}..."

# FIX: Get name AND time in one call using JSON output.
# This prevents the "Invalid Azure URL" error and is much faster.
gcloud storage objects list "${BUCKET_URI}" --format="json" | jq -r '.[] | "\(.name)\t\(.timeCreated)"' | while IFS=$'\t' read -r object_name creation_time_str; do
    
    # 1. Skip objects with invalid/missing time (like folders)
    if [[ "$creation_time_str" == "null" ]] || [[ -z "$creation_time_str" ]]; then
        log "SKIP: Object has no creation time: ${object_name}"
        continue
    fi

    # 2. Construct the full GS URI for deletion later
    object_uri="gs://${GCS_BUCKET_NAME}/${object_name}"

    # 3. Parse time
    creation_time_seconds=$(date -d "$creation_time_str" +%s)
    backup_day=$(date -d "$creation_time_str" +'%d')
    backup_day_no_zero=$((10#$backup_day))

    # Rule 1: Keep recent backups (last 7 days)
    if (( creation_time_seconds > SEVEN_DAYS_AGO_SECONDS )); then
        log "KEEP (recent): ${object_name}"
        continue
    fi

    # Rule 2: Alternate days for older backups (8-14 days)
    if (( creation_time_seconds > FOURTEEN_DAYS_AGO_SECONDS )); then
        if (( backup_day_no_zero % 2 == 0 )); then
            log "KEEP (alternate day): ${object_name}"
        else
            log "DELETE (alternate day rule): ${object_name}"
            gcloud storage rm "${object_uri}" --quiet
        fi
        continue
    fi
    
    # Rule 3: Delete old backups (>14 days)
    log "DELETE (too old): ${object_name}"
    gcloud storage rm "${object_uri}" --quiet
done

log "Retention policy enforcement complete."