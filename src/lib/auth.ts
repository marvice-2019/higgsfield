import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { sql, type UserRow } from "./db";
import { env } from "./env";
import { HttpError } from "./http";

export const SESSION_COOKIE = "studio_session";

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export { hashPassword } from "./auth-hash";

// Used when the email is unknown so login timing doesn't reveal which accounts exist.
let dummyHash: Promise<string> | null = null;

export async function verifyLogin(email: string, password: string): Promise<UserRow | null> {
  const [row] = await sql()<(UserRow & { password_hash: string })[]>`
    SELECT id, email, name, role, active, created_at, password_hash
    FROM users WHERE email = ${email.toLowerCase().trim()}`;
  dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), 12);
  const ok = await bcrypt.compare(password, row?.password_hash ?? (await dummyHash));
  if (!row || !ok || !row.active) return null;
  const { password_hash: _ph, ...user } = row;
  return user;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const days = env().SESSION_DAYS;
  const expires = new Date(Date.now() + days * 86_400_000);
  await sql()`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${hashToken(token)}, ${userId}, ${expires})`;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await sql()`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<UserRow | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await sql()<UserRow[]>`
    SELECT u.id, u.email, u.name, u.role, u.active, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now() AND u.active`;
  return row ?? null;
}

export async function requireUser(): Promise<UserRow> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Please sign in");
  return u;
}

export async function requireAdmin(): Promise<UserRow> {
  const u = await requireUser();
  if (u.role !== "admin") throw new HttpError(403, "Admins only");
  return u;
}
