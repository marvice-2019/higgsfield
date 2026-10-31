import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "./auth-hash";
import { sql } from "./db";
import { env } from "./env";
import { sweep } from "./jobs";
import { errMsg, log } from "./log";

async function migrate() {
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "db");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const [done] = await db`SELECT 1 FROM schema_migrations WHERE name = ${f}`;
    if (done) continue;
    const text = await readFile(path.join(/*turbopackIgnore: true*/ dir, f), "utf8");
    await db.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(424242)`;
      const [again] = await tx`SELECT 1 FROM schema_migrations WHERE name = ${f}`;
      if (again) return;
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${f})`;
    });
    log.info("migration applied", { file: f });
  }
}

async function seedAdmin() {
  const e = env();
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE role = 'admin'`;
  if (n > 0) return;
  if (!e.ADMIN_EMAIL || !e.ADMIN_PASSWORD) {
    log.warn("no admin exists; set ADMIN_EMAIL and ADMIN_PASSWORD to create one");
    return;
  }
  await sql()`
    INSERT INTO users (email, name, password_hash, role)
    VALUES (${e.ADMIN_EMAIL.toLowerCase()}, 'Admin', ${await hashPassword(e.ADMIN_PASSWORD)}, 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin', active = true`;
  log.info("admin user created", { email: e.ADMIN_EMAIL });
}

/** Postgres may start after the app (e.g. both restarting on Coolify): retry, then exit so Docker restarts us. */
async function waitForDb() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await sql()`SELECT 1`;
      return;
    } catch (e) {
      log.warn("database not reachable yet", { attempt, error: errMsg(e) });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log.error("database unreachable after 60s, exiting");
  process.exit(1);
}

export async function boot() {
  env(); // fail fast on bad config
  await waitForDb();
  await migrate();
  await seedAdmin();
  await sql()`DELETE FROM sessions WHERE expires_at < now()`;

  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweep();
    } catch (e) {
      log.error("sweep failed", { error: errMsg(e) });
    } finally {
      running = false;
    }
  }, 15_000).unref();
  log.info("studio booted");
}
