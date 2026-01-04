#!/bin/bash
# Script: sync_to_drive.sh
# Purpose: Mirror GCS bucket to Google Drive using Rclone
# Note: rclone sync DELETES files from Drive that don't exist in GCS

set -euo pipefail

# --- CONFIGURATION ---
readonly GCS_BUCKET_NAME="nirmaan-stack-backups"
readonly RCLONE_GCS_REMOTE_NAME="GCS"
readonly RCLONE_DRIVE_REMOTE_NAME="GoogleDrive"
readonly DRIVE_FOLDER_NAME="NirmaanStackBackups"
# ---------------------

readonly LOG_FILE="/var/log/nirmaan_backup.log"

log() {
    echo "[DRIVE SYNC] $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[DRIVE SYNC] $*"
}

log "=== Syncing GCS to Google Drive ==="
log "Source: ${RCLONE_GCS_REMOTE_NAME}:${GCS_BUCKET_NAME}"
log "Destination: ${RCLONE_DRIVE_REMOTE_NAME}:${DRIVE_FOLDER_NAME}"

# rclone sync mirrors source to destination:
# - Copies new/updated files from GCS to Drive
# - DELETES files from Drive that no longer exist in GCS
# This ensures Drive has the same 7-day retention as GCS
rclone sync \
    --verbose \
    --transfers 4 \
    --checkers 8 \
    "${RCLONE_GCS_REMOTE_NAME}:${GCS_BUCKET_NAME}" \
    "${RCLONE_DRIVE_REMOTE_NAME}:${DRIVE_FOLDER_NAME}" \
    2>&1 | while read -r line; do log "$line"; done

log "=== Drive Sync Complete ==="
