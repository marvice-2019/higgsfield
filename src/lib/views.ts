import { sql, type GenerationRow } from "./db";

export type GenerationView = {
  id: string;
  model: string;
  kind: "image" | "video";
  prompt: string;
  params: Record<string, unknown>;
  status: GenerationRow["status"];
  error: string | null;
  outputs: { type: string; url: string; mime: string }[];
  createdAt: string;
  completedAt: string | null;
  owner: { id: string; name: string };
  hasInputImage: boolean;
};

type Joined = GenerationRow & { owner_name: string };

export function toView(r: Joined): GenerationView {
  return {
    id: r.id,
    model: r.model,
    kind: r.kind,
    prompt: r.prompt,
    params: r.params,
    status: r.status,
    error: r.status === "failed" || r.status === "nsfw" || r.status === "canceled" ? r.error : null,
    outputs: r.outputs.map((o) => ({ type: o.type, mime: o.mime, url: `/api/media/${r.id}/${o.file}` })),
    createdAt: r.created_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
    owner: { id: r.user_id, name: r.owner_name },
    hasInputImage: Boolean(r.input_image_url),
  };
}

export async function listGenerations(opts: { userId?: string; before?: Date; ids?: string[]; limit?: number }) {
  const limit = Math.min(opts.limit ?? 30, 60);
  const db = sql();
  const rows = await db<Joined[]>`
    SELECT g.*, u.name AS owner_name FROM generations g JOIN users u ON u.id = g.user_id
    WHERE true
      ${opts.userId ? db`AND g.user_id = ${opts.userId}` : db``}
      ${opts.before ? db`AND g.created_at < ${opts.before}` : db``}
      ${opts.ids ? db`AND g.id = ANY(${opts.ids}::uuid[])` : db``}
    ORDER BY g.created_at DESC LIMIT ${limit}`;
  return rows.map(toView);
}

export async function getGeneration(id: string) {
  const [row] = await sql()<Joined[]>`
    SELECT g.*, u.name AS owner_name FROM generations g JOIN users u ON u.id = g.user_id WHERE g.id = ${id}`;
  return row ?? null;
}

export async function usageToday(userId: string) {
  const [r] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM generations
    WHERE user_id = ${userId}
      AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
      AND NOT (status = 'failed' AND hf_request_id IS NULL)`;
  return r.n;
}
