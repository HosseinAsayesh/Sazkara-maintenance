# Sazkara Maintenance — handover package ({{VERSION}})

Packaged {{DATE}} from commit `{{COMMIT}}`. Persian version: `README.fa.md`.

## What is in this folder

| Item | What it is |
|---|---|
| `INSTALL.md` / `INSTALL.fa.md` | Step-by-step installation, update, backup and restore guide |
| `{{SERVER_TAR}}` | **The one file to upload to the server.** Contains everything below except the guides and escrow |
| `app/` | The compiled application (Node.js server). Runs as is; nothing to build |
| `tools/` | `migrate.sh` (create/update database tables), `seed.sh` (first-time data and accounts), `backup.sh`, `restore.sh` |
| `config/` | Settings template, systemd service, Nginx site |
| `database/` | The database structure: `schema.prisma` (readable description of every table) and the SQL migrations |
| `escrow/` | The source code, in an encrypted archive — see `escrow/ESCROW.md` |
| `VERSION.txt` | Version and build date |

## What the company controls

Everything needed to run, move, back up and restore the system is here, and every
password (server, database, app accounts) is created by the company's IT during
installation — the developer does not need to know them.

- The **data** is entirely in the company's PostgreSQL database and uploads folder, on
  the company's server. It can be backed up, restored or exported at any time; the
  app's own Excel exports also work at all times.
- The app requires a **license** from the developer. Without a current license it
  switches to **read-only**: everything stays visible and exportable, but new entries
  cannot be saved. No data is ever deleted or hidden. Licenses are renewed per the
  agreement and installed in the app under Settings → License.
- The **source code** is held in escrow (`escrow/`) and released per the agreement.

## Requirements (short)

Ubuntu Server 24.04 LTS · 4 vCPU / 8 GB RAM recommended (2 / 4 minimum) · 100 GB SSD ·
a domain name for HTTPS · PostgreSQL 16 · Node.js 20.9+ (22 LTS recommended) ·
Chrome or Chromium (for PDF reports) · Nginx. Details in `INSTALL.md`.
