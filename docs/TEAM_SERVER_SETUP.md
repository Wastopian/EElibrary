# Team Server Setup

This guide is for the **one person** who runs EE Library for the team. Everyone else needs exactly one sentence:

> Open `http://<server-address>:8080` in your browser and sign in.

No installs, no terminals, no setup for engineers. They create an account on the sign-up page with the team invite code, sign in, and work.

---

## What you need

- A machine that stays on — a small office server, a NAS that runs Docker, or a spare desktop. Windows, macOS, or Linux.
- **Docker** — [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows/macOS, or Docker Engine with the compose plugin on Linux.
- **Node.js 20 or newer** — used only by the helper scripts in this guide.
- A copy of this project on the machine (`git clone`, or an unzipped copy).

Everything EE Library needs (its database included) runs inside Docker. You do not install Postgres or anything else by hand.

## First-time setup

Open a terminal in the project folder and run:

```bash
node scripts/setup-team-server.mjs
```

This writes a `.env.team` file with a generated database password, session secret, and **team invite code**, and creates the data folders. It prints the invite code — save it; engineers type it once when they create their account. (Re-running the script never overwrites an existing `.env.team`.)

Then start everything:

```bash
docker compose -f compose.team.yaml up -d --build
```

The first build takes several minutes. After it settles, create the first admin account (pick your own email and password):

```bash
docker compose -f compose.team.yaml run --rm migrate node scripts/seed-admin.mjs --force --email you@company.com --password "choose-a-strong-password"
```

Now open `http://localhost:8080` on the server itself and sign in. If that works, find the server's network address (`ipconfig` on Windows, `ip addr` on Linux, or use the machine's network name) and check `http://<server-address>:8080` from a second computer.

**Tell the team the address and the invite code. Setup is done.**

Port 8080 is the default. To use a different one, create a file named `.env` in the project folder containing a line like `EE_LIBRARY_TEAM_PORT=80`, then run the `up -d` command again.

## Upgrading to a new version

```bash
git pull
docker compose -f compose.team.yaml up -d --build
```

Database changes apply automatically before the app starts serving again. Take a backup first (next section) — then an upgrade that goes wrong is a ten-minute restore, not a lost library.

## Backups

One command backs up everything — the database (parts, projects, approvals, decisions, evidence records) and every stored file (datasheets, CAD files, export bundles, project files, vendor notes):

```bash
node scripts/team-backup.mjs
```

Each run writes a dated folder under `backups/` and keeps the newest 14 (change with `--retain 30`).

**Schedule it daily.** On Windows, open Task Scheduler → Create Basic Task → Daily → Start a Program:

- Program: `node`
- Arguments: `scripts/team-backup.mjs`
- Start in: the project folder (for example `C:\ee-library`)

On Linux/macOS, add a cron line (`crontab -e`), adjusting the paths:

```cron
0 2 * * * cd /srv/ee-library && /usr/bin/node scripts/team-backup.mjs >> backups/backup.log 2>&1
```

**Copy the `backups/` folder somewhere off this machine** — a second disk, the office NAS, or a cloud drive folder. A backup on the same disk as the data does not protect against the disk failing.

## Restoring from a backup

Practice this once on day one, while there is nothing to lose — a restore you have never rehearsed is not a real safety net.

```bash
node scripts/team-restore.mjs --latest          # shows what it would do, changes nothing
node scripts/team-restore.mjs --latest --yes    # actually restores
```

To restore a specific backup, pass its folder name instead of `--latest`. Restoring **replaces** the current database and stored files with the backup's contents, then restarts everything.

Moving to a new machine is the same procedure: set up the new server through "First-time setup", copy the `backups/` folder over, and restore.

## If something goes wrong

- **See what's running:** `docker compose -f compose.team.yaml ps` — every service should say "running" (and `postgres`/`api` "healthy").
- **Read recent logs:** `docker compose -f compose.team.yaml logs --tail 100 api` (also try `web`, `worker`, `postgres`, `migrate`).
- **Restart everything:** `docker compose -f compose.team.yaml restart`
- **After a server reboot:** nothing to do — the stack starts itself when Docker starts.
- Signed-in engineers can check the **System** page in the app's sidebar; it shows the same health information in plain terms.

## Security boundaries — read once

- **This stack is for your private network.** It serves plain HTTP and must not be exposed to the internet as-is. If you need HTTPS or remote access, put a reverse proxy (for example [Caddy](https://caddyserver.com/)) or your company VPN in front of it.
- **New accounts require the team invite code** from `.env.team` (`EE_LIBRARY_SIGNUP_INVITE_CODE`). To change the code, edit that value and run `docker compose -f compose.team.yaml up -d` again. Clearing the value entirely allows open sign-up — only do that on a network you fully trust.
- Only the web app is reachable on the network. The database and the internal API are private to the Docker stack.
- `.env.team` holds the server's secrets. Don't commit it, don't email it, and keep `backups/` as protected as the server itself — backups contain the whole library.
