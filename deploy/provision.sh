#!/usr/bin/env bash
#
# One-shot bootstrap for a fresh Ubuntu 24.04 box. Run once, as root:
#
#   scp -r deploy root@SERVER:/tmp/
#   ssh root@SERVER "APP_DOMAIN=budget.example.com bash /tmp/deploy/provision.sh"
#
# Idempotent: safe to re-run after editing.

set -euo pipefail

APP_NAME=fabudge
APP_DIR=/var/www/$APP_NAME
DEPLOY_USER=deploy
PHP_VERSION=8.4
NODE_MAJOR=22
APP_DOMAIN=${APP_DOMAIN:?set APP_DOMAIN, e.g. APP_DOMAIN=budget.example.com}

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

log "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq software-properties-common curl git unzip ca-certificates \
    ufw fail2ban unattended-upgrades restic sqlite3 \
    certbot python3-certbot-nginx

log "PHP $PHP_VERSION"
# The app uses array_any()/array_all(), which are 8.4 builtins — 8.3 will fatal.
add-apt-repository -y ppa:ondrej/php >/dev/null
apt-get update -qq
apt-get install -y -qq \
    php$PHP_VERSION-fpm php$PHP_VERSION-cli \
    php$PHP_VERSION-sqlite3 php$PHP_VERSION-zip php$PHP_VERSION-intl \
    php$PHP_VERSION-mbstring php$PHP_VERSION-xml php$PHP_VERSION-curl \
    php$PHP_VERSION-bcmath php$PHP_VERSION-gd php$PHP_VERSION-opcache
# php-zip backs the YNAB import (ZipArchive); php-sqlite3 backs the database.

log "Composer"
if ! command -v composer >/dev/null; then
    curl -fsSL https://getcomposer.org/installer -o /tmp/composer-setup.php
    php /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer --quiet
    rm -f /tmp/composer-setup.php
fi

log "Node $NODE_MAJOR (asset build runs on the server)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v$NODE_MAJOR* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_$NODE_MAJOR.x | bash - >/dev/null
    apt-get install -y -qq nodejs
fi

log "nginx"
apt-get install -y -qq nginx

log "Deploy user and directory layout"
id -u $DEPLOY_USER >/dev/null 2>&1 || adduser --disabled-password --gecos "" $DEPLOY_USER
usermod -aG www-data $DEPLOY_USER

# `git push production` authenticates as this user, so it needs the same key you
# gave the server at creation time (Hetzner installs that for root only).
install -d -m 700 -o $DEPLOY_USER -g $DEPLOY_USER /home/$DEPLOY_USER/.ssh
if [[ -f /root/.ssh/authorized_keys ]]; then
    install -m 600 -o $DEPLOY_USER -g $DEPLOY_USER \
        /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
fi

mkdir -p "$APP_DIR"/{releases,shared/storage,repo.git}
mkdir -p "$APP_DIR"/shared/storage/{app/public,framework/{cache/data,sessions,testing,views},logs}
mkdir -p "$APP_DIR"/shared/database

# The SQLite file lives in shared/ so it survives release swaps.
touch "$APP_DIR/shared/database/database.sqlite"

if [[ ! -f "$APP_DIR/shared/.env" ]]; then
    cp /tmp/deploy/env.production.example "$APP_DIR/shared/.env"
    echo "!! Wrote a starter $APP_DIR/shared/.env — fill it in before deploying."
fi

cp /tmp/deploy/deploy.sh "$APP_DIR/deploy.sh"
cp /tmp/deploy/backup.sh "$APP_DIR/backup.sh"
chmod +x "$APP_DIR"/{deploy,backup}.sh

log "Bare repo and post-receive hook"
git init --bare --quiet "$APP_DIR/repo.git"
cp /tmp/deploy/post-receive "$APP_DIR/repo.git/hooks/post-receive"
chmod +x "$APP_DIR/repo.git/hooks/post-receive"

chown -R $DEPLOY_USER:www-data "$APP_DIR"
chmod -R g+w "$APP_DIR/shared/storage" "$APP_DIR/shared/database"
# setgid so logs and caches written by www-data stay group-owned and writable by
# the deploy user, rather than drifting out of reach after the first request.
find "$APP_DIR/shared/storage" "$APP_DIR/shared/database" -type d -exec chmod g+s {} +
chmod 640 "$APP_DIR/shared/.env"

log "systemd units"
for unit in fabudge-queue.service fabudge-scheduler.service fabudge-scheduler.timer \
            fabudge-backup.service fabudge-backup.timer; do
    sed "s/{{PHP_VERSION}}/$PHP_VERSION/g" "/tmp/deploy/systemd/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now fabudge-scheduler.timer fabudge-backup.timer
systemctl enable fabudge-queue.service

log "nginx site"
sed -e "s/{{APP_DOMAIN}}/$APP_DOMAIN/g" \
    -e "s/{{PHP_VERSION}}/$PHP_VERSION/g" \
    -e "s#{{APP_DIR}}#$APP_DIR#g" \
    /tmp/deploy/nginx/fabudge.conf > /etc/nginx/sites-available/$APP_NAME
ln -sfn /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/$APP_NAME
rm -f /etc/nginx/sites-enabled/default

log "Let the deploy user reload php-fpm after a release"
cat > /etc/sudoers.d/$DEPLOY_USER <<SUDO
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reload php$PHP_VERSION-fpm, /usr/bin/systemctl restart $APP_NAME-queue.service
SUDO
chmod 440 /etc/sudoers.d/$DEPLOY_USER

log "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

log "Unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

nginx -t && systemctl reload nginx

cat <<DONE

Provisioned. Remaining steps, in order:

  1. Fill in $APP_DIR/shared/.env  (APP_KEY, APP_URL, mail, ANTHROPIC_API_KEY)
     Generate a key with:  php artisan key:generate --show

  2. Point $APP_DOMAIN's DNS A record at this server, then:
       certbot --nginx -d $APP_DOMAIN
     TLS is required — passkey login will not work over plain HTTP.

  3. From your laptop:
       git remote add production $DEPLOY_USER@$APP_DOMAIN:$APP_DIR/repo.git
       git push production main

DONE
