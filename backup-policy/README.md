# Nirmaan Stack Backup Policy

Automated backup system with **7-day retention** across three locations:

- **Server** (Docker container) - Only latest backup
- **Google Cloud Storage** (GCS) - Last 7 days
- **Google Drive** (via Rclone) - Mirrors GCS (last 7 days)

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      BACKUP PIPELINE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [Cron @ 2 AM daily]                                           │
│       │                                                         │
│       ▼                                                         │
│   backup_and_upload.sh                                          │
│       │                                                         │
│       ├──► 1. Clear old backups from container                  │
│       ├──► 2. Create backup (bench --site X backup --with-files)│
│       ├──► 3. Archive & compress (tar.gz)                       │
│       ├──► 4. Upload to GCS bucket                              │
│       │                                                         │
│       ├──► manage_gcs_retention.sh                              │
│       │        └──► DELETE backups older than 7 days from GCS   │
│       │                                                         │
│       └──► sync_to_drive.sh                                     │
│                └──► Mirror GCS to Google Drive                  │
│                     (deletions included - Drive = GCS)          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Retention Policy

| Location           | Retention   | How                                     |
| ------------------ | ----------- | --------------------------------------- |
| Server (Container) | Latest only | Cleared before each backup              |
| GCS Bucket         | 7 days      | `manage_gcs_retention.sh` deletes older |
| Google Drive       | 7 days      | `rclone sync` mirrors GCS exactly       |

## Prerequisites

### 1. Google Cloud SDK (gcloud)

```bash
# Install
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Authenticate
gcloud init
gcloud auth login

# Verify bucket access
gcloud storage ls gs://nirmaan-stack-backups
```

### 2. Rclone

```bash
# Install
curl https://rclone.org/install.sh | sudo bash

# Configure GCS remote
rclone config
# Name: GCS
# Type: Google Cloud Storage

# Configure Google Drive remote
rclone config
# Name: GoogleDrive
# Type: Google Drive

# Verify
rclone listremotes
```

### 3. jq (JSON processor)

```bash
sudo apt install jq
```

### 4. Permissions

```bash
# Docker access
sudo usermod -aG docker $USER

# Log file
sudo touch /var/log/nirmaan_backup.log
sudo chown $USER:$USER /var/log/nirmaan_backup.log
```

## Installation

```bash
# 1. Copy scripts to server
scp -r backup-policy/ user@server:/home/user/backup-scripts/

# 2. Make executable
chmod +x /home/user/backup-scripts/*.sh

# 3. Update configuration in each script
nano /home/user/backup-scripts/backup_and_upload.sh
# Update: DOCKER_PROJECT_NAME, SITE_NAME, GCS_BUCKET_NAME

# 4. Test manually
/home/user/backup-scripts/backup_and_upload.sh
```

## Cron Setup

```bash
# Edit crontab
crontab -e

# Add: Run daily at 2 AM
0 2 * * * /home/user/backup-scripts/backup_and_upload.sh >> /var/log/nirmaan_backup.log 2>&1
```

### Verify Cron

```bash
# List cron jobs
crontab -l

# Watch logs
tail -f /var/log/nirmaan_backup.log
```

## Manual Commands

```bash
# Run full backup
/home/user/backup-scripts/backup_and_upload.sh

# Only run retention (delete old from GCS)
/home/user/backup-scripts/manage_gcs_retention.sh

# Only sync to Drive
/home/user/backup-scripts/sync_to_drive.sh

# List GCS backups
gcloud storage ls -l gs://nirmaan-stack-backups/

# List Drive backups
rclone ls GoogleDrive:NirmaanStackBackups
```

## Troubleshooting

### Docker permission denied

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### GCS auth failed

```bash
gcloud auth login
gcloud auth application-default login
```

### Container name wrong

```bash
docker ps --format "{{.Names}}" | grep backend
# Update BACKEND_CONTAINER_NAME in backup_and_upload.sh
```

## Log Rotation

```bash
sudo nano /etc/logrotate.d/nirmaan-backup

# Add:
/var/log/nirmaan_backup.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
}
```

## Files

```
backup-policy/
├── backup_and_upload.sh      # Main script
├── manage_gcs_retention.sh   # Deletes >7 day old backups from GCS
├── sync_to_drive.sh          # Mirrors GCS to Drive
└── README.md                 # This file
```
