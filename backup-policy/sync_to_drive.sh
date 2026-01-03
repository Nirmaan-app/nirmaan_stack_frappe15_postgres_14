#!/bin/bash
# Script: sync_to_drive.sh
# Purpose: Syncs GCS bucket to Google Drive using Rclone.

set -euo pipefail

# --- CONFIGURATION ---
readonly GCS_BUCKET_NAME="nirmaan-stack-backups" # <--- UPDATE THIS
readonly RCLONE_GCS_REMOTE_NAME="GCS"
readonly RCLONE_DRIVE_REMOTE_NAME="GoogleDrive"
readonly DRIVE_FOLDER_NAME="NirmaanStackBackups"
# ---------------------

log() { echo "DRIVE SYNC: $*"; }

log "Starting sync from GCS to Google Drive..."
rclone sync \
    --update \
    --verbose \
    --transfers 4 \
    --checkers 8 \
    "${RCLONE_GCS_REMOTE_NAME}:${GCS_BUCKET_NAME}" "${RCLONE_DRIVE_REMOTE_NAME}:${DRIVE_FOLDER_NAME}"

log "Sync to Google Drive complete."