import { requireUser } from "@/lib/auth";
import { PENDING_STATUSES, sql } from "@/lib/db";
import { deleteRequest } from "@/lib/hf";
import { assertSameOrigin, handle, HttpError, json } from "@/lib/http";
import { errMsg, log } from "@/lib/log";
import { removeGenerationMedia } from "@/lib/media";
import { getGeneration } from "@/lib/views";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw new HttpError(404, "Not found");

  const gen = await getGeneration(id);
  if (!gen) throw new HttpError(404, "Not found");
  if (gen.user_id !== user.id && user.role !== "admin") throw new HttpError(403, "You can only delete your own work");
  if ((PENDING_STATUSES as readonly string[]).includes(gen.status)) throw new HttpError(409, "Wait for this job to finish before deleting it");

  await removeGenerationMedia(id);
  await sql()`DELETE FROM generations WHERE id = ${id}`;
  if (gen.hf_request_id) {
    // Best effort: also remove the copy held by Higgsfield.
    deleteRequest(gen.hf_request_id).catch((e) => log.warn("higgsfield delete failed", { genId: id, error: errMsg(e) }));
  }
  log.info("generation deleted", { genId: id, by: user.id });
  return json({ ok: true });
});
