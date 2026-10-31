# Studio · Marvice

Internal image and video generation studio on top of the Higgsfield API.
Runs at `https://higgsfield.marvice.tech`. Built with Next.js 16, Postgres and Docker.

**What it does**

- Team logins with two roles. Admins add people, reset passwords and deactivate accounts. Members generate.
- Models (from Higgsfield's published spec): Soul images; Kling 2.5 Turbo Pro text-to-video and image-to-video; Kling 2.5 Turbo Standard image-to-video; Hailuo 2.3 text-to-video and image-to-video.
- "Animate this" turns any generated still into a video.
- Outputs are copied to the server's own volume. Higgsfield deletes its copies after about 7 days; ours stay.
- Limits keep spend in check: a daily per-person cap (counted in IST), a cap on jobs running at once, and a login rate limit.
- Jobs finish in the background even if nobody has the page open.

## Deploy on Coolify

1. **Push this folder to a private GitHub repo**, for example `marvice/higgsfield-studio`.
2. **Postgres.** In Coolify, go to your project, then *+ New*, *Database*, *PostgreSQL 16*. Name the database `studio`. Under *Backups*, enable a daily scheduled backup. Copy its **internal** connection URL.
3. **App.** Go to *+ New*, *Private repository (GitHub App)*, and pick the repo.
   - Build pack: **Dockerfile**. Port: **3000**.
   - Domain: `https://higgsfield.marvice.tech`.
   - *Storages*: add a volume mounted at **`/data`**. This is where generated files live, so don't skip it.
   - *Health check*: path `/api/health`.
4. **Environment variables.** Set these in the app's *Environment Variables* tab, never in the repo:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the internal Postgres URL from step 2 |
   | `APP_URL` | `https://higgsfield.marvice.tech` |
   | `HF_API_KEY_ID` / `HF_API_KEY_SECRET` | from https://console.higgsfield.ai → API keys |
   | `ADMIN_EMAIL` | `yuvarajgs@marvice.in` |
   | `ADMIN_PASSWORD` | a strong password, at least 10 characters (only used to create the first admin) |
   | `DAILY_LIMIT` | optional, default 25 per member per day |
   | `ADMIN_DAILY_LIMIT` | optional, default 100 |
   | `MAX_ACTIVE_PER_USER` | optional, default 3 |

5. **DNS.** Add an `A` record for `higgsfield` pointing to your VPS IP. Coolify issues the SSL certificate.
6. **Deploy.** On first boot the app creates its tables and the admin account. Sign in, open *Team*, and add people.

After the first login you can delete `ADMIN_PASSWORD` from Coolify. It is only read when no admin exists.

## Check it worked

- `https://higgsfield.marvice.tech/api/health` returns `{"ok":true}`.
- Run one Soul image at 2K. It should appear under *Your reel* within about a minute.
- Coolify logs show JSON lines such as `generation submitted` and `generation completed`.

## Running cost

- **Server:** fits on the existing 16 GB VPS, using about 150–250 MB of RAM. Disk use is roughly 1–3 MB per image and 5–20 MB per video clip, so watch the `/data` volume as usage grows.
- **Generation:** billed by Higgsfield per request, from your Higgsfield credits. Check current rates in the console. The daily caps above are your spend limit.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
```

## Adding a model

Add one entry to `src/lib/models.ts`. Copy the request fields from the model's page on https://docs.higgsfield.ai or from the console. The form and validation update automatically.
