#!/bin/bash
# Script: backup_and_upload.sh
# Purpose: Create backup, archive ONLY new files, upload, retention, and sync.

set -euo pipefail

# --- CONFIGURATION ---
readonly DOCKER_PROJECT_NAME="nirmaan-stack"
readonly SITE_NAME="stack.nirmaan.app"
readonly GCS_BUCKET_NAME="nirmaan-stack-backups" # <--- UPDATE THIS
# ---------------------

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SOURCE_DIR="/tmp/nirmaan_backups_$(date +%s)"
readonly LOG_FILE="/var/log/nirmaan_backup.log"

readonly BACKEND_CONTAINER_NAME="${DOCKER_PROJECT_NAME}-backend-1"
readonly DOCKER_BACKUP_PATH="/home/frappe/frappe-bench/sites/${SITE_NAME}/private/backups"
readonly TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
readonly ARCHIVE_FILENAME="nirmaan-backup-${TIMESTAMP}.tar.gz"
readonly ARCHIVE_PATH="/tmp/${ARCHIVE_FILENAME}"

log() {
    if [ -w "$LOG_FILE" ] || [ "$EUID" -eq 0 ]; then
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
    else
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | sudo tee -a "$LOG_FILE"
    fi
}

error_exit() { log "ERROR: $1"; exit 1; }

cleanup() {
    log "🧹 Cleaning up temporary files..."
    rm -rf "${SOURCE_DIR}"
    rm -f "${ARCHIVE_PATH}"
}

main() {
    if [ ! -f "$LOG_FILE" ]; then
        sudo touch "$LOG_FILE"
        sudo chown "$(whoami)" "$LOG_FILE"
    fi
    
    trap cleanup EXIT

    log "--- Starting Backup Cycle ---"

    # 1. Clean up old backup inside container using sh -c for wildcard expansion
    log "🔁 Removing previous backup inside container..."
    docker exec "$BACKEND_CONTAINER_NAME" sh -c "rm -rf ${DOCKER_BACKUP_PATH}/*" || error_exit "Failed to clean container backups"

    # 2. Create new backup
    log "📦 Creating new backup via bench..."
    docker exec "$BACKEND_CONTAINER_NAME" bench --site "$SITE_NAME" backup --with-files > /dev/null || error_exit "Bench backup command failed"

    # 3. Prepare source directory and copy files
    log "📁 Preparing source directory: ${SOURCE_DIR}"
    mkdir -p "$SOURCE_DIR"
    
    log "📤 Copying backup files from container..."
    docker cp "${BACKEND_CONTAINER_NAME}:${DOCKER_BACKUP_PATH}/." "$SOURCE_DIR/" || error_exit "Docker cp failed"

    if [ -z "$(ls -A "$SOURCE_DIR")" ]; then
        error_exit "No backup files were copied. Directory is empty."
    fi
    
    # 4. Create compressed archive
    log "🗜 Compressing files into archive: ${ARCHIVE_FILENAME}"
    tar -czvf "${ARCHIVE_PATH}" -C "${SOURCE_DIR}" . || error_exit "Failed to create tar archive"

    # 5. Upload to GCS
    log "☁️ Uploading to GCS..."
    gcloud storage cp "${ARCHIVE_PATH}" "gs://${GCS_BUCKET_NAME}/" || error_exit "GCS upload failed"
    log "✅ GCS upload complete."
    
    # 6. Run downstream tasks
    log "⚖️ Enforcing Retention..."
    bash "${SCRIPT_DIR}/manage_gcs_retention.sh"

    log "🚗 Syncing to Drive..."
    bash "${SCRIPT_DIR}/sync_to_drive.sh"

    log "--- Backup Cycle Finished Successfully ---"
}

main "$@"