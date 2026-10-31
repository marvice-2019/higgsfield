import { z } from "zod";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { assertSameOrigin, handle, HttpError, json } from "@/lib/http";
import { log } from "@/lib/log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchBody = z
  .object({
    active: z.boolean().optional(),
    role: z.enum(["admin", "member"]).optional(),
    password: z.string().min(10, "Password must be at least 10 characters").max(200).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw new HttpError(404, "Not found");
  const parsed = patchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  const b = parsed.data;

  if (id === admin.id && (b.active === false || b.role === "member")) {
    throw new HttpError(400, "You can't deactivate or demote yourself");
  }

  const db = sql();
  const newHash = b.password ? await hashPassword(b.password) : null;
  const updated = await db.begin(async (tx) => {
    const [row] = await tx`
      UPDATE users SET
        active = COALESCE(${b.active ?? null}::boolean, active),
        role = COALESCE(${b.role ?? null}::text, role),
        password_hash = COALESCE(${newHash}::text, password_hash)
      WHERE id = ${id} RETURNING id`;
    if (!row) return null;
    // Deactivation or password reset signs the user out everywhere.
    if (b.active === false || b.password) await tx`DELETE FROM sessions WHERE user_id = ${id}`;
    return row;
  });
  if (!updated) throw new HttpError(404, "Not found");
  log.info("user updated", { by: admin.id, userId: id, fields: Object.keys(b) });
  return json({ ok: true });
});
