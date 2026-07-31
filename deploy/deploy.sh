#!/usr/bin/env bash
#
# Build and activate a release. Invoked by repo.git/hooks/post-receive with the
# pushed revision; can also be run by hand to redeploy or roll forward:
#
#   /var/www/fabudge/deploy.sh <git-sha>
#
# Releases are built in full before anything is swapped, so a failed build
# leaves the running site untouched.

set -Eeuo pipefail

APP_DIR=/var/www/fabudge
PHP_VERSION=8.4
KEEP_RELEASES=5
REVISION=${1:?usage: deploy.sh <git-revision>}

RELEASE="$APP_DIR/releases/$(date -u +%Y%m%d%H%M%S)"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$1" >&2; rm -rf "$RELEASE"; exit 1; }

trap 'fail "deploy failed; the running release was left untouched"' ERR

log "Checking out $REVISION"
mkdir -p "$RELEASE"
git --git-dir="$APP_DIR/repo.git" --work-tree="$RELEASE" checkout -f "$REVISION"
echo "$REVISION" > "$RELEASE/REVISION"

log "Linking shared state"
ln -sfn "$APP_DIR/shared/.env" "$RELEASE/.env"
rm -rf "$RELEASE/storage"
ln -sfn "$APP_DIR/shared/storage" "$RELEASE/storage"
ln -sfn "$APP_DIR/shared/database/database.sqlite" "$RELEASE/database/database.sqlite"

cd "$RELEASE"

log "PHP dependencies"
composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist --quiet

log "Front-end build"
npm ci --no-audit --no-fund --silent
npm run build
# node_modules is ~500MB and useless once the bundle exists; a 40GB disk holding
# KEEP_RELEASES of it would not be.
rm -rf node_modules

log "Migrations"
php artisan migrate --force --no-interaction

log "Caching config, routes, views and events"
php artisan optimize

log "Activating release"
ln -sfn "$RELEASE" "$APP_DIR/current"

# opcache holds the old paths until php-fpm is reloaded.
sudo systemctl reload php$PHP_VERSION-fpm

# Tells the running worker to finish its job and exit; systemd restarts it on
# the new code. Gentler than killing it mid-job.
php artisan queue:restart

log "Pruning old releases (keeping $KEEP_RELEASES)"
cd "$APP_DIR/releases"
ls -1dt */ | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf

trap - ERR
log "Deployed $REVISION"
