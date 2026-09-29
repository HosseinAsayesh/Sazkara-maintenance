# Sazkara Maintenance — installation guide ({{VERSION}})

For: Ubuntu Server 24.04 LTS (22.04 also works). Every command runs on the server as a
user with `sudo`. Persian version: `INSTALL.fa.md`.

**Where things live after installation**

| Path | Contents |
|---|---|
| `/opt/sazkara/app` | The application (replaced on every update) |
| `/opt/sazkara/tools` | migrate / seed / backup / restore scripts |
| `/etc/sazkara/sazkara.env` | Settings and secrets (database password etc.) |
| `/var/lib/sazkara/uploads` | Photos, signatures, imports, PDFs — **back this up** |
| PostgreSQL database `sazkara` | All records — **back this up** |
| `/var/backups/sazkara` | Daily backups |

---

## 1. Server

- Recommended: 4 vCPU, 8 GB RAM, 100 GB SSD. Minimum: 2 vCPU, 4 GB RAM, 60 GB.
  (PDF generation runs a headless browser and needs the memory.)
- A domain name (e.g. `maintenance.example.ir`) with its DNS A record pointing at the
  server, for HTTPS.
- Upload `{{SERVER_TAR}}` to the server's home folder (e.g. with `scp` or WinSCP).

## 2. System packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y postgresql nginx certbot python3-certbot-nginx \
  fonts-vazirmatn fonts-noto-core curl ca-certificates openssl
```

The two font packages are needed for correct Persian text in PDF reports.

**Node.js** (version 20.9 or newer; 22 LTS recommended):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

If that site is unreachable from the server, install Node.js 22 from the official
Linux x64 archive (nodejs.org or a local mirror) and make sure `/usr/bin/node` exists
(`sudo ln -s /usr/local/bin/node /usr/bin/node` if it was installed under /usr/local).

**Chrome or Chromium** (for PDF reports). Option A is preferred:

- A) Google Chrome: download `google-chrome-stable_current_amd64.deb` (from
  `dl.google.com/linux/direct/`, or on another computer and upload it if Google's
  servers are unreachable), then `sudo apt install -y ./google-chrome-stable_current_amd64.deb`.
  Path: `/usr/bin/google-chrome`
- B) `sudo snap install chromium`. Path: `/snap/bin/chromium`

## 3. User and folders

```bash
sudo useradd --system --home /opt/sazkara --shell /usr/sbin/nologin sazkara
sudo mkdir -p /opt/sazkara /etc/sazkara /var/lib/sazkara/uploads /var/backups/sazkara
sudo tar -xzf ~/{{SERVER_TAR}} -C /opt/sazkara
sudo chmod +x /opt/sazkara/tools/*.sh
sudo chown -R sazkara:sazkara /opt/sazkara/app /var/lib/sazkara
```

## 4. Database

```bash
DB_PASSWORD=$(openssl rand -hex 24)
echo "$DB_PASSWORD"      # copy this; it goes into the settings file in step 5
sudo -u postgres psql -c "CREATE USER sazkara WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE sazkara OWNER sazkara ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0;"
```

PostgreSQL only listens on the server itself by default. Keep it that way.

## 5. Settings

```bash
sudo install -o root -g sazkara -m 640 /opt/sazkara/config/sazkara.env.example /etc/sazkara/sazkara.env
openssl rand -hex 32     # copy this for AUTH_SECRET
sudo nano /etc/sazkara/sazkara.env
```

Replace every `CHANGE_ME`:

- `DATABASE_URL`: put the database password from step 4 in place of `CHANGE_ME_DB_PASSWORD`
- `AUTH_SECRET`: the value from `openssl rand -hex 32`
- `CHROME_PATH`: the path from step 2
- `SEED_MANAGER_PHONE` / `SEED_MANAGER_PASSWORD`: the first manager login
- `SEED_CLIENT_PASSWORD`: optional, creates the JTI supervisor login

## 6. Tables and first data

```bash
sudo /opt/sazkara/tools/migrate.sh
sudo /opt/sazkara/tools/seed.sh
```

The system starts **empty**: no stores, orders, reports or technicians. The standard
30-part catalogue is built in and appears with the tables. `seed.sh` adds only six
starting cities (Tehran, Shiraz, Mashhad, Rasht, Karaj, Kermanshah — more can be added
in Settings), placeholder wage rates (edit them in Settings), one default project, and
the manager account (plus the JTI account if you set its password). Records are then entered in the
app, or imported from Excel under "Jti orders".

## 7. Start the application

```bash
sudo cp /opt/sazkara/config/sazkara.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sazkara
sudo systemctl status sazkara           # should say "active (running)"
curl -I http://127.0.0.1:3000/fa/login  # should answer "HTTP/1.1 200"
```

Logs: `sudo journalctl -u sazkara -f`

## 8. Nginx and HTTPS

```bash
sudo cp /opt/sazkara/config/nginx-sazkara.conf /etc/nginx/sites-available/sazkara
sudo sed -i 's/YOUR_DOMAIN/maintenance.example.ir/' /etc/nginx/sites-available/sazkara   # your domain
sudo ln -s /etc/nginx/sites-available/sazkara /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d maintenance.example.ir                                           # your domain
```

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Only SSH, HTTP and HTTPS are open. The app (port 3000) and PostgreSQL (5432) are not
reachable from outside.

## 10. License

Until a license is installed, the app is **read-only** and shows a red notice. To
install one:

1. The developer sends the license text (a block starting with
   `-----BEGIN SAZKARA LICENSE-----`).
2. Sign in as the manager → **Settings** → **License** at the bottom of the page.
3. Paste the whole block → **Install license**.

Managers see a yellow notice 14 days before a license expires. After expiry the app
becomes read-only again: nothing is deleted, everything stays visible and exportable,
and it returns to normal the moment a new license is installed.

## 11. Backups

**Daily automatic backup** at 02:30 (keeps 14 days):

```bash
echo '30 2 * * * root /opt/sazkara/tools/backup.sh >> /var/log/sazkara-backup.log 2>&1' | sudo tee /etc/cron.d/sazkara-backup
sudo /opt/sazkara/tools/backup.sh      # run one now to check it works
```

Each backup is a folder `/var/backups/sazkara/<date-time>/` with `database.sql` and
`uploads/`. **Copy these off the server regularly** (another server, NAS or external
disk): a backup on the same disk does not survive a disk failure.

**Restore** (replaces the current data with a backup's; takes a safety backup first
and asks for confirmation):

```bash
sudo /opt/sazkara/tools/restore.sh /var/backups/sazkara/20261001-023000
```

## 12. Updating to a new version

Settings, data and uploads live outside `/opt/sazkara`, so an update only swaps the
application:

```bash
sudo /opt/sazkara/tools/backup.sh
sudo systemctl stop sazkara
sudo mv /opt/sazkara /opt/sazkara.previous            # kept for rollback
sudo mkdir /opt/sazkara
sudo tar -xzf ~/sazkara-server-NEW-VERSION.tar.gz -C /opt/sazkara
sudo chmod +x /opt/sazkara/tools/*.sh
sudo chown -R sazkara:sazkara /opt/sazkara/app
sudo /opt/sazkara/tools/migrate.sh
sudo systemctl start sazkara
```

To roll back: stop the service, move `/opt/sazkara.previous` back to `/opt/sazkara`, and
restore the backup taken in the first line (a newer version may have changed tables).

## 13. Troubleshooting

| Symptom | Check |
|---|---|
| Red "read-only" notice | License missing or expired (section 10) |
| Site shows "502 Bad Gateway" | `sudo systemctl status sazkara` and `sudo journalctl -u sazkara -n 100` |
| Service will not start: database error | `DATABASE_URL` in `/etc/sazkara/sazkara.env`; `sudo systemctl status postgresql` |
| PDF reports fail | `CHROME_PATH` points to an existing file; fonts from step 2 installed |
| Persian text in PDFs shows boxes | `sudo apt install fonts-vazirmatn fonts-noto-core`, then `sudo systemctl restart sazkara` |
| Photo uploads fail | `client_max_body_size` in the Nginx site; free disk space (`df -h`) |
| Everyone was signed out | `AUTH_SECRET` changed — expected, just sign in again |
