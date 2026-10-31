import { z } from "zod";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { assertSameOrigin, handle, HttpError, json } from "@/lib/http";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  const users = await sql()`
    SELECT u.id, u.email, u.name, u.role, u.active, u.created_at,
      count(g.id) FILTER (
        WHERE g.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
          AND NOT (g.status = 'failed' AND g.hf_request_id IS NULL)
      )::int AS today,
      count(g.id) FILTER (WHERE g.created_at >= now() - interval '30 days' AND g.status = 'completed')::int AS last30,
      count(g.id) FILTER (WHERE g.status = 'completed')::int AS total
    FROM users u LEFT JOIN generations g ON g.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at ASC`;
  return json({ users });
});

const createBody = z.object({
  email: z.email("Enter a valid email"),
  name: z.string().trim().min(1, "Enter a name").max(80),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  role: z.enum(["admin", "member"]).default("member"),
});

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  const parsed = createBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  const { email, name, password, role } = parsed.data;
  const [row] = await sql()`
    INSERT INTO users (email, name, password_hash, role)
    VALUES (${email.toLowerCase()}, ${name}, ${await hashPassword(password)}, ${role})
    ON CONFLICT (email) DO NOTHING RETURNING id`;
  if (!row) throw new HttpError(409, "A user with that email already exists");
  log.info("user created", { by: admin.id, userId: row.id, role });
  return json({ ok: true, id: row.id }, 201);
});
