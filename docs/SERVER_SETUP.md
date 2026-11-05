# Putting paperwars.io online: the setup guide

This guide takes the multiplayer server from your computer to the internet (v0.0.14). Follow it
once, top to bottom. Each step says what to click or type. It takes about 45 minutes.

When you're done:

- the **game** stays on **Vercel**, as it is today;
- the **game server** and its **database** run on **Railway**;
- a **backup** of the database is made every night and copied to **Cloudflare R2**, and each one
  is test-restored automatically;
- **UptimeRobot** emails you if the server stops answering;
- you and your friend join from your own homes with an invite link.

> Railway, Vercel and Cloudflare rename buttons from time to time. These steps were checked
> against their documentation on 2026-11-05. If a button has a slightly different name, look for
> the nearest match. If something doesn't match at all, tell the agent which step it was.

**What you need:** your GitHub account, your Vercel account (the game is already on it), a card for
Railway (Hobby plan: a small monthly fee that includes some usage; see railway.com/pricing) and a
card for Cloudflare R2 (the free tier covers these backups, but R2 asks for a payment method before
it gives out keys).

You'll collect a few values on the way. Keep them in a password manager or a private note:

| Value | Where it comes from | Secret? |
|---|---|---|
| `TOKEN_PEPPER` | Step 3 | **Yes**: never change it later |
| `ADMIN_KEY` | Step 3 | **Yes** |
| The server address (`…up.railway.app`) | Step 4 | No |
| R2 Access Key ID, Secret Access Key, endpoint | Step 6 | **Yes** (the secret) |
| `DATABASE_PUBLIC_URL` | Step 8 | **Yes** (it contains the database password) |

---

## Step 1: Create the Railway project and the server

1. Go to **railway.com** and sign in **with GitHub**.
2. Click **New Project** → **Deploy from GitHub repo** → choose **HalabiDaniel/project-delta**. If
   Railway asks for access to the repository, allow it.
3. Railway finds the `Dockerfile` in the repository and starts building. The first build may fail
   or the server may stop straight away, because its settings aren't there yet. **That's
   expected.**
4. Click the new service (it's named **project-delta**) → **Settings**:
   - **Source**: the branch should be **main**. Every push to `main` now redeploys the server.
     (Until this version's pull request is merged, you can set it to
     `claude/dreamy-pasteur-ghbtbu` to try it out, then set it back to `main`.)
   - **Deploy** → **Healthcheck Path**: type `/health`. Railway then only switches to a new
     version once it answers.
   - **Deploy** → **Restart Policy**: choose **Always**.

## Step 2: Add the database

1. In the project, click **+ Create** (or **New**) → **Database** → **PostgreSQL**.
2. Wait until it shows as running. Keep its name as **Postgres**: the next steps refer to it by
   that name.

## Step 3: Make two secrets

On your computer, in a terminal, run this **twice** and keep both results:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The first result is your **`TOKEN_PEPPER`**, the second your **`ADMIN_KEY`**.

**Never change the pepper later**: every player's saved login is checked against it, so changing
it logs everyone out.

## Step 4: Configure the server

1. Click the **project-delta** service → **Variables** → **New Variable**, and add each of these
   (name, then value). The **Raw Editor** lets you paste them all at once.

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (type it exactly like this, with the `${{ }}`; Railway fills in the database's private address) |
   | `TOKEN_PEPPER` | your first secret |
   | `ADMIN_KEY` | your second secret |
   | `ACCESS` | `invite` |
   | `NODE_ENV` | `production` |

2. Go to **Settings** → **Networking** → **Generate Domain**. If it asks for a port, accept the
   one it suggests (the server listens on the port Railway gives it). Railway shows an address
   like `project-delta-production.up.railway.app`. **Copy it**: that's your **server address**.
3. Back in **Variables**, add one more:

   | Name | Value |
   |---|---|
   | `ALLOWED_ORIGINS` | your game's address with `https://`, for example `https://project-delta.vercel.app` |

   Use the address you open the game at, with nothing after it (no `/` or `?`). Several addresses
   go in one value, separated by commas. To also let Vercel's preview builds in, add one with a
   `*`, for example `https://project-delta.vercel.app,https://project-delta-*.vercel.app`.
4. Railway redeploys. When the service shows **Active** (or **Online**), open
   `https://<server address>/health` in your browser. You should see something like:

   ```
   {"status":"ok","version":"0.0.14","store":"postgres","storeReachable":true,"sessions":0,"players":0,"uptime":12}
   ```

   If you don't, open **Deployments** → the latest one → **Deploy Logs**. The first lines say what
   is missing, for example `[config] TOKEN_PEPPER must be set in production`.

## Step 5: Point the game at the server

1. Go to **vercel.com** → your project → **Settings** → **Environment Variables**.
2. Add **`VITE_SERVER_URL`** = `wss://<server address>` (the address from step 4, starting with
   `wss://` instead of `https://`). Tick **Production** (and **Preview** if you want preview builds
   to use it too). Save.
3. Go to **Deployments** → the latest production deployment → **⋯** → **Redeploy**. (The address
   is built into the game, so it only takes effect after a new build.)
4. Open the game and click **Multiplayer** (on the welcome card or in the menu). The lobby should
   list sessions, or say there are none yet, instead of **No server**.

## Step 6: Set up backups

**6a. The bucket and its keys (Cloudflare)**

1. Go to **dash.cloudflare.com** (create a free account if you need one) → **R2 Object Storage**.
   The first time, Cloudflare asks you to activate R2 and add a payment method.
2. **Create bucket** → name it **`paperwars-backups`** → create.
3. Back on the **R2 Object Storage** overview, find **API Tokens** (under **Account Details**) →
   **Manage** → **Create Account API token**.
   - **Permissions**: **Object Read & Write**.
   - Limit it to the **`paperwars-backups`** bucket.
   - Create it.
4. Cloudflare now shows the **Access Key ID**, the **Secret Access Key** and the **endpoint**
   (`https://<account id>.r2.cloudflarestorage.com`). **Copy all three now**: the secret is shown
   only once.

**6b. The backup job (Railway)**

1. In your Railway project, click **+ Create** → **GitHub Repo** → **HalabiDaniel/project-delta**
   again. This makes a second service from the same code. Click it → **Settings** and rename it
   **backup**.
2. In its **Settings**:
   - **Source** branch: the same as the server's (`main`).
   - **Deploy** → **Custom Start Command**: `node --import tsx server/db/backup.ts backup`
   - **Deploy** → **Healthcheck Path**: leave it **empty** (the job isn't a web server).
   - **Cron Schedule**: `15 3 * * *` (every day at 03:15 UTC). Railway then starts the job on that
     schedule. The job makes the backup and exits.
3. Its **Variables**:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `R2_BUCKET` | `paperwars-backups` |
   | `R2_ENDPOINT` | the endpoint from 6a |
   | `R2_ACCESS_KEY_ID` | the Access Key ID from 6a |
   | `R2_SECRET_ACCESS_KEY` | the Secret Access Key from 6a |

Copies older than **14 days** are deleted by the job itself (set `BACKUP_KEEP_DAYS` to change
that).

**6c. The restore drill (once, then automatic)**

A backup only counts if it can be restored. With a second, empty database, the job restores
**every** backup into it straight after making it, and compares it with the live database.

1. **+ Create** → **Database** → **PostgreSQL** again. Click it → **Settings** → rename it
   **Drill**.
2. In the **backup** service's **Variables**, add `DRILL_DATABASE_URL` = `${{Drill.DATABASE_URL}}`.
3. Run the job once now instead of waiting for the night. If the backup service shows a **Run
   now** button, click it. Otherwise, with the Railway command-line tool, run `railway cron run`
   in the backup service.
4. Open the backup service's latest run → **Logs**. You should see three lines:
   - `backup.done` with the file's name (`paperwars/2026-…Z.dump`) and its size;
   - `drill.done` with `"ok":true`, the number of players, bases and buildings in both databases,
     and one player's paper and buildings as restored;
   - (after 14 days) `backup.pruned`.

   In Cloudflare, the bucket now holds the file.

Write the date and the `drill.done` line into **"Restore drill: result"** at the end of this
guide. From now on the drill runs every night; if a restore ever fails, the run is marked as failed
in Railway.

**Restoring for real (an emergency)**: see **"Restoring a backup"** below.

## Step 7: Know when it's down

Railway only checks `/health` while it deploys. To hear about it when the server stops answering
later:

1. Go to **uptimerobot.com** and create a free account.
2. **New monitor** → **HTTP(s)** → URL `https://<server address>/health`, every **5 minutes**,
   alerts to your email.

`/health` answers `503` when the database can't be reached, so a database problem alerts you too.

## Step 8: Invite your friend (and yourself)

The invite codes are made on your computer, connected straight to the live database.

1. In Railway, click the **Postgres** service → **Variables** (or **Connect**) and copy
   **`DATABASE_PUBLIC_URL`**: the address your computer uses to reach the database.
2. On your computer, in the project folder (after `git pull` and `npm install`):

   ```bash
   DATABASE_URL='<DATABASE_PUBLIC_URL>' TOKEN_PEPPER='<your pepper>' npm run admin -- invite create "for my friend"
   ```

3. It prints a code like `K7Q2M-9XRTA`. Send your friend the link
   `https://<your game address>/?invite=K7Q2M-9XRTA`. Make one for yourself the same way.
4. Each of you opens your link, chooses a username, and you're in. The invite is needed only on
   the first visit: the browser keeps a pass after that. To play on another computer, use
   **Menu → Another computer** to get a one-time code.

## Step 9 (optional): Your own domain

If you own a domain: in Vercel, **Settings** → **Domains** → add `play.yourdomain.com`; in Railway,
the server's **Settings** → **Networking** → **Custom Domain** → add `server.yourdomain.com`. Each
shows a DNS record to add where you bought the domain. Then change `ALLOWED_ORIGINS` (step 4) to
the new game address and `VITE_SERVER_URL` (step 5) to `wss://server.yourdomain.com`, and redeploy
the game.

---

## Running it

### Logs

Railway → **project-delta** → **Deployments** → **Deploy Logs** (or the project's **Observability**
view). Each line is one event, as JSON, with the session and the player where there are any:

```
{"t":"…","level":"info","event":"join","session":"c3plz6qcV","player":"m5hiv6vj","name":"Ann","via":"token"}
```

Search for a session id or a player id to follow one of them. An error that keeps repeating is
written once, then once more a minute later with how many times it happened (`"repeated": 41`).

### The admin tools

From your computer, against the live database (with the two variables from step 8):

```bash
npm run admin -- player list
```

```bash
npm run admin -- invite list
```

Run `npm run admin` without anything after it for every command (invites, players, revoke, reissue
a pass, bases).

What only the running server can do goes through its protected `/admin` endpoint. Set
`SERVER_URL=https://<server address>` and `ADMIN_KEY=<your admin key>` instead of the database:

```bash
SERVER_URL='https://<server address>' ADMIN_KEY='<admin key>' npm run admin -- live sessions
```

| Command | What it does |
|---|---|
| `live sessions` | Every session, who's in it, on which desk, and their ping |
| `live kick <player> [--minutes N] [reason]` | Removes a player now; they can't rejoin for N minutes (default 10) |
| `live end <session> [--seconds N] [reason]` | Ends a session N seconds from now (default 60), telling everyone |
| `live desk <session> <desk>` | Frees a desk stuck in the wrong state (a player who's away, or a desk held after a restart) |

Every admin action is logged (`admin.kick`, `admin.end` and so on).

### The feedback log

Players press **F8** (or **Menu → Feedback**) to send a note: a category, what happened, optional
steps, and an enjoyment rating. The version, session, desk, position and mode, ping, frame rate,
device and browser are attached. To read them:

```bash
DATABASE_URL='<DATABASE_PUBLIC_URL>' npm run admin -- feedback export > feedback.md
```

Add `--format csv` for a spreadsheet, `--days 7` for the last week only.

### Restoring a backup

Everything in the target database is replaced, so the command asks first and names the database.

1. Pick the backup: `npm run db:backup -- --list` shows every copy (newest last). It needs the four
   `R2_*` values from step 6.
2. Restore. `latest` takes the newest; or give a name from the list:

   ```bash
   DATABASE_URL='<DATABASE_PUBLIC_URL>' R2_BUCKET=paperwars-backups R2_ENDPOINT='…' R2_ACCESS_KEY_ID='…' R2_SECRET_ACCESS_KEY='…' npm run db:restore -- latest
   ```

3. Restart the server (Railway → project-delta → **⋯** → **Restart**).

Running it on your computer needs the PostgreSQL tools (`pg_restore`), version 18 or newer (from
postgresql.org). Without them, use the drill instead: the **Drill** database always holds last
night's backup, restored and checked, ready to switch the server to (`DATABASE_URL` =
`${{Drill.DATABASE_URL}}`).

### The load test against the deployment

With an invite code for the bots (they become players, named `Load_…`):

```bash
DATABASE_URL='<DATABASE_PUBLIC_URL>' TOKEN_PEPPER='<pepper>' npm run admin -- invite create loadtest --uses 40 --days 1
```

```bash
SERVER_URL='https://<server address>' ADMIN_KEY='<admin key>' npm run loadtest:remote -- --invite <code> --players 16 --sessions 2 --seconds 300
```

It prints a table for the README: server step time and tick regularity, database writes per second
and their latency, memory, bandwidth per player and reconnection times. For the multi-hour memory
run: `--seconds 10800 --sample 300`. Restart the server from Railway during a run to measure how
long the players take to come back.

---

## When something goes wrong

| What you see | What to check |
|---|---|
| **No server** in the lobby | `VITE_SERVER_URL` in Vercel (step 5) starts with `wss://`, and you redeployed afterwards; `/health` opens |
| `/health` doesn't open | Railway → project-delta → Deployments → Deploy Logs; usually a missing variable |
| `/health` says `"status":"degraded"` | The server can't reach the database: is **Postgres** running, and is `DATABASE_URL` exactly `${{Postgres.DATABASE_URL}}`? |
| "only accepts the game from its own address", or origin errors in the browser console (F12) | `ALLOWED_ORIGINS` holds exactly the address in your browser's address bar, with `https://` and nothing after it |
| "An invite code is needed" | Open the invite link (step 8), or type the code in the lobby's **Code** field |
| Everyone was logged out | `TOKEN_PEPPER` changed: set it back to the original |
| No backup in R2 | Railway → backup → the latest run → Logs; `can't reach the bucket` means `R2_ENDPOINT`, `403` means the keys |
| `drill.done` with `"ok":false` | The backup restored but doesn't match: tell the agent, with that log line |
| Deploys keep failing the health check | Deploy Logs; the server must start within 5 minutes and answer `/health` |

---

## Restore drill: result

_Filled in after step 6c._

| | |
|---|---|
| Date | |
| Backup | |
| `drill.done` | |
| Checked by | |
