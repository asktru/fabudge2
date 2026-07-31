# Deploying fabudge

A single Ubuntu 24.04 VPS running nginx, PHP-FPM, SQLite, a queue worker and the
scheduler. Deploys happen by pushing straight to a bare repo on the server, so
nothing outside your laptop and the box is in the deploy path.

## Layout on the server

```
/var/www/fabudge/
├── repo.git/              bare repo; its post-receive hook builds a release
├── releases/              timestamped builds, last 5 kept
├── current -> releases/…  symlink nginx serves from
├── shared/
│   ├── .env               the only place secrets live
│   ├── database/          SQLite file, survives release swaps
│   └── storage/           uploads, logs, caches
├── deploy.sh
└── backup.sh
```

## First run

1. **Create the server.** CX23 (2 vCPU / 4 GB / 40 GB) in Nuremberg or
   Falkenstein is plenty. Add your SSH key during creation.

2. **Provision it.** From the repo root:

   ```bash
   scp -r deploy root@SERVER_IP:/tmp/
   ssh root@SERVER_IP "APP_DOMAIN=budget.example.com bash /tmp/deploy/provision.sh"
   ```

3. **Fill in the environment.** `ssh root@SERVER_IP`, then edit
   `/var/www/fabudge/shared/.env`. At minimum set `APP_KEY` (generate one
   locally with `php artisan key:generate --show`), `APP_URL`, and the mail
   settings.

4. **Point DNS** at the server, then get a certificate:

   ```bash
   certbot --nginx -d budget.example.com
   ```

   This is not optional. Passkey login is bound to a secure origin, so the app
   is unusable over plain HTTP.

5. **Deploy.** From your laptop:

   ```bash
   git remote add production deploy@budget.example.com:/var/www/fabudge/repo.git
   git push production main
   ```

   Every later deploy is just `git push production main`.

## How a deploy works

`post-receive` fires only for `main` and runs `deploy.sh`, which checks the
revision out into a fresh release directory, links `.env`, `storage/` and the
SQLite file from `shared/`, installs dependencies, builds assets, migrates,
caches config, and only then moves the `current` symlink.

The build happens in full before anything is swapped, so a failed build leaves
the running site untouched — you get a red push and an unchanged production.

Two consequences worth knowing:

- **Migrations run before the swap.** For a moment the old code is serving
  against the new schema. At single-household scale that window is
  milliseconds and harmless, but avoid destructive migrations in the same
  deploy as the code that stops using the column — split it across two.
- **`php artisan optimize` caches config.** Any `env()` call outside `config/`
  returns null in production. Read config values, not the environment.

## Rolling back

Releases are kept, so rolling back is a symlink move and an FPM reload:

```bash
ssh deploy@budget.example.com
ls /var/www/fabudge/releases          # pick the previous timestamp
ln -sfn /var/www/fabudge/releases/TIMESTAMP /var/www/fabudge/current
sudo systemctl reload php8.4-fpm
```

This does **not** roll back migrations. If the bad deploy migrated, restore the
database from backup instead.

## Backups

`backup.sh` runs nightly at 03:20 via a systemd timer and pushes an encrypted
restic snapshot to a Hetzner Storage Box.

Set it up once, as root:

```bash
ssh-keygen -t ed25519 -f /root/.ssh/storagebox -N ''
ssh-copy-id -s -p 23 -i /root/.ssh/storagebox.pub uXXXXX@uXXXXX.your-storagebox.de

cat > /etc/fabudge-backup.env <<'ENV'
RESTIC_REPOSITORY=sftp:uXXXXX@uXXXXX.your-storagebox.de:/backups/fabudge
RESTIC_PASSWORD=a-long-random-passphrase-you-store-somewhere-else
ENV
chmod 600 /etc/fabudge-backup.env

restic init
```

It backs up the SQLite file (via `.backup`, which is safe against concurrent
writers — a plain `cp` of a live database can capture a torn write) and the
`.env`. The `.env` matters: without `APP_KEY` the encrypted columns cannot be
read, so a database-only backup is not restorable.

Keep `RESTIC_PASSWORD` somewhere that is not this server. A backup you cannot
decrypt because the only copy of the passphrase burned down with the machine is
not a backup.

**Test a restore before you need one:**

```bash
restic snapshots
restic restore latest --target /tmp/restore-test
sqlite3 /tmp/restore-test/.../database.sqlite "select count(*) from transactions;"
```

## Health checks

```bash
systemctl status fabudge-queue          # queue worker
systemctl list-timers 'fabudge-*'       # scheduler and backup
tail -f /var/www/fabudge/shared/storage/logs/laravel-*.log
sudo -u deploy php /var/www/fabudge/current/artisan about
```
