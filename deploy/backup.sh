#!/usr/bin/env bash
#
# Nightly encrypted backup to a Hetzner Storage Box via restic over SFTP.
#
# One-time setup on the server (as root):
#   ssh-keygen -t ed25519 -f /root/.ssh/storagebox -N ''
#   ssh-copy-id -s -p 23 -i /root/.ssh/storagebox.pub uXXXXX@uXXXXX.your-storagebox.de
#   restic -r sftp:uXXXXX@uXXXXX.your-storagebox.de:/backups/fabudge init
#
# Credentials live in /etc/fabudge-backup.env (chmod 600), not in this file.

set -euo pipefail

# shellcheck disable=SC1091
source /etc/fabudge-backup.env   # RESTIC_REPOSITORY, RESTIC_PASSWORD

APP_DIR=/var/www/fabudge
# A stable path, not mktemp: restic selects the parent snapshot by path, and a
# new random directory each night makes every backup look like a first backup.
STAGING=/var/backups/fabudge
mkdir -p "$STAGING"
chmod 700 "$STAGING"
trap 'rm -f "$STAGING"/database.sqlite "$STAGING"/.env' EXIT

# Copying a live SQLite file byte-for-byte can capture a torn write. .backup
# uses the online backup API and is safe against concurrent writers.
sqlite3 "$APP_DIR/shared/database/database.sqlite" ".backup '$STAGING/database.sqlite'"

# The .env holds APP_KEY. Without it the encrypted columns and old sessions are
# unrecoverable, so a database-only backup is not a restorable backup.
cp "$APP_DIR/shared/.env" "$STAGING/.env"

restic backup \
    --tag fabudge \
    --host fabudge \
    "$STAGING" \
    "$APP_DIR/shared/storage/app"

restic forget --tag fabudge --prune \
    --keep-daily 14 --keep-weekly 8 --keep-monthly 12

# A backup that has never been read is a hypothesis, not a backup.
restic check --read-data-subset=5%
