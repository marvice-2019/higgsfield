import { sql, type GenerationRow, type OutputFile, type UserRow } from "./db";
import { env } from "./env";
import { getStatus, HfError, submit, type HfStatus } from "./hf";
import { HttpError } from "./http";
import { errMsg, log } from "./log";
import { saveFromUrl } from "./media";
import type { ModelDef } from "./models";

const POLL_GAP_SECONDS = 4;
const SUBMIT_STUCK_MINUTES = 5;
const DOWNLOAD_GIVE_UP_HOURS = 24;

/** Quota check and insert run under a per-user advisory lock so parallel clicks can't exceed limits. */
export async function createGeneration(opts: {
  user: UserRow;
  model: ModelDef;
  input: Record<string, unknown>;
  inputImageUrl: string | null;
}): Promise<GenerationRow> {
  const { user, model, input, inputImageUrl } = opts;
  const e = env();
  const dailyLimit = user.role === "admin" ? e.ADMIN_DAILY_LIMIT : e.DAILY_LIMIT;
  const { prompt, ...params } = input;

  const gen = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
    const [{ today, active }] = await tx<{ today: number; active: number }[]>`
      SELECT
        count(*) FILTER (
          WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
            AND NOT (status = 'failed' AND hf_request_id IS NULL)
        )::int AS today,
        count(*) FILTER (WHERE status IN ('submitting', 'queued', 'in_progress'))::int AS active
      FROM generations WHERE user_id = ${user.id}`;
    if (today >= dailyLimit) throw new HttpError(429, `Daily limit reached (${dailyLimit}). Resets at midnight IST.`);
    if (active >= e.MAX_ACTIVE_PER_USER)
      throw new HttpError(429, `You already have ${active} jobs running. Wait for one to finish.`);
    const [row] = await tx<GenerationRow[]>`
      INSERT INTO generations (user_id, model, kind, prompt, params, input_image_url, status)
      VALUES (${user.id}, ${model.id}, ${model.kind}, ${String(prompt)}, ${tx.json(params as never)}, ${inputImageUrl}, 'submitting')
      RETURNING *`;
    return row;
  });

  try {
    const body = { ...input, ...(inputImageUrl ? { image_url: inputImageUrl } : {}) };
    const res = await submit(model.id, body);
    const status = res.status === "in_progress" ? "in_progress" : "queued";
    const [updated] = await sql()<GenerationRow[]>`
      UPDATE generations SET hf_request_id = ${res.request_id}, status = ${status}, updated_at = now()
      WHERE id = ${gen.id} RETURNING *`;
    log.info("generation submitted", { genId: gen.id, model: model.id, userId: user.id, requestId: res.request_id });
    return updated;
  } catch (err) {
    const msg = errMsg(err);
    const friendly = friendlySubmitError(err);
    await sql()`UPDATE generations SET status = 'failed', error = ${friendly}, updated_at = now() WHERE id = ${gen.id}`;
    log.warn("generation submit failed", { genId: gen.id, model: model.id, error: msg });
    const status = err instanceof HfError && err.status === 429 ? 429 : 502;
    throw new HttpError(status, friendly);
  }
}

function friendlySubmitError(err: unknown): string {
  if (err instanceof HfError) {
    if (err.status === 401 || err.status === 403) return "Higgsfield rejected the API key. Ask an admin to check it.";
    if (err.status === 402) return "Higgsfield account is out of credits. Ask an admin to top up.";
    if (err.status === 429) return "Higgsfield is rate-limiting us. Try again in a minute.";
    if (err.status === 400 || err.status === 422) return `Higgsfield refused the request: ${err.message.replace(/^Higgsfield \d+: /, "")}`;
  }
  return "Could not reach Higgsfield. Try again shortly.";
}

function outputsOf(s: HfStatus): { url: string; type: OutputFile["type"] }[] {
  const out: { url: string; type: OutputFile["type"] }[] = [];
  for (const img of s.images ?? []) out.push({ url: img.url, type: "image" });
  if (s.video?.url) out.push({ url: s.video.url, type: "video" });
  if (s.audio?.url) out.push({ url: s.audio.url, type: "audio" });
  for (const a of s.audios ?? []) if (a.url !== s.audio?.url) out.push({ url: a.url, type: "audio" });
  return out;
}

/**
 * Sync one generation with Higgsfield. Claims the row with a conditional UPDATE so two
 * pollers (browser + background sweep) never download the same job twice.
 */
export async function refresh(id: string): Promise<void> {
  const [gen] = await sql()<GenerationRow[]>`
    UPDATE generations SET last_polled_at = now()
    WHERE id = ${id}
      AND status IN ('submitting', 'queued', 'in_progress')
      AND (last_polled_at IS NULL OR last_polled_at < now() - make_interval(secs => ${POLL_GAP_SECONDS}))
    RETURNING *`;
  if (!gen) return;

  if (!gen.hf_request_id) {
    if (Date.now() - gen.created_at.getTime() > SUBMIT_STUCK_MINUTES * 60_000) {
      await sql()`UPDATE generations SET status = 'failed', error = 'Submission did not complete', updated_at = now() WHERE id = ${id}`;
    }
    return;
  }

  let s: HfStatus;
  try {
    s = await getStatus(gen.hf_request_id);
  } catch (err) {
    log.warn("status poll failed", { genId: id, error: errMsg(err) });
    if (err instanceof HfError && err.status === 404) {
      await sql()`UPDATE generations SET status = 'failed', error = 'Request not found at Higgsfield', updated_at = now() WHERE id = ${id}`;
    }
    return;
  }

  if (s.status === "queued" || s.status === "in_progress") {
    if (s.status !== gen.status) await sql()`UPDATE generations SET status = ${s.status}, updated_at = now() WHERE id = ${id}`;
    return;
  }

  if (s.status !== "completed") {
    const error =
      s.status === "nsfw" ? "Blocked by Higgsfield content moderation" : s.status === "canceled" ? "Canceled" : (s.error ?? "Generation failed");
    await sql()`UPDATE generations SET status = ${s.status}, error = ${error}, updated_at = now(), completed_at = now() WHERE id = ${id}`;
    log.info("generation finished", { genId: id, status: s.status });
    return;
  }

  // Completed: copy outputs to our volume (Higgsfield URLs expire after ~7 days).
  const items = outputsOf(s);
  if (items.length === 0) {
    await sql()`UPDATE generations SET status = 'failed', error = 'Higgsfield returned no output', updated_at = now(), completed_at = now() WHERE id = ${id}`;
    return;
  }
  try {
    const saved: OutputFile[] = [];
    for (let i = 0; i < items.length; i++) saved.push(await saveFromUrl(id, i, items[i].url, items[i].type));
    await sql()`
      UPDATE generations SET status = 'completed', outputs = ${sql().json(saved as never)}, error = NULL,
        updated_at = now(), completed_at = now()
      WHERE id = ${id}`;
    log.info("generation completed", { genId: id, files: saved.length });
  } catch (err) {
    const msg = errMsg(err);
    log.warn("output download failed, will retry", { genId: id, error: msg });
    if (Date.now() - gen.created_at.getTime() > DOWNLOAD_GIVE_UP_HOURS * 3_600_000) {
      await sql()`UPDATE generations SET status = 'failed', error = ${"Could not download output: " + msg}, updated_at = now(), completed_at = now() WHERE id = ${id}`;
    } else {
      await sql()`UPDATE generations SET status = 'in_progress', error = ${"Saving output… (" + msg + ")"}, updated_at = now() WHERE id = ${id}`;
    }
  }
}

/** Background sweep so jobs finish even when nobody has the page open. */
export async function sweep(): Promise<void> {
  const rows = await sql()<{ id: string }[]>`
    SELECT id FROM generations
    WHERE status IN ('submitting', 'queued', 'in_progress')
      AND (last_polled_at IS NULL OR last_polled_at < now() - interval '10 seconds')
    ORDER BY created_at ASC LIMIT 20`;
  for (const r of rows) {
    try {
      await refresh(r.id);
    } catch (err) {
      log.error("sweep refresh failed", { genId: r.id, error: errMsg(err) });
    }
  }
}
