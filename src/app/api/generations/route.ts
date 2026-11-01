import { readFile } from "node:fs/promises";
import { requireUser } from "@/lib/auth";
import { PENDING_STATUSES } from "@/lib/db";
import { uploadImage } from "@/lib/hf";
import { assertSameOrigin, handle, HttpError, json } from "@/lib/http";
import { createGeneration, refresh } from "@/lib/jobs";
import { errMsg, log } from "@/lib/log";
import { fileSize, mimeFor, resolveMediaPath } from "@/lib/media";
import { getModel, providerOf } from "@/lib/models";
import { getGeneration, listGenerations, toView } from "@/lib/views";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UPLOAD = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);

  const idsParam = url.searchParams.get("ids");
  if (idsParam) {
    const ids = idsParam.split(",").filter((s) => UUID_RE.test(s)).slice(0, 20);
    if (ids.length === 0) return json({ items: [] });
    const current = await listGenerations({ ids, limit: ids.length });
    const pending = current.filter((g) => (PENDING_STATUSES as readonly string[]).includes(g.status));
    await Promise.all(pending.map((g) => refresh(g.id).catch((e) => log.warn("refresh failed", { genId: g.id, error: errMsg(e) }))));
    return json({ items: pending.length ? await listGenerations({ ids, limit: ids.length }) : current });
  }

  const scope = url.searchParams.get("scope") === "team" ? "team" : "mine";
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : undefined;
  const items = await listGenerations({ userId: scope === "mine" ? user.id : undefined, before, limit: 24 });
  return json({ items });
});

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Invalid form data");
  });

  const model = getModel(String(form.get("model") ?? ""));
  if (!model) throw new HttpError(400, "Pick a model");

  const raw: Record<string, unknown> = { prompt: form.get("prompt") ?? "" };
  for (const f of model.fields) {
    const v = form.get(f.name);
    if (v !== null && typeof v === "string") raw[f.name] = v;
  }
  const parsed = model.schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid settings");

  let inputImageUrl: string | null = null;
  let inputImage: { data: Buffer; type: string } | null = null;
  if (model.needsImage && providerOf(model) === "runpod") {
    inputImage = await readInputImage(form);
    if (inputImage.data.length > 7 * 1024 * 1024) throw new HttpError(400, "Image must be under 7 MB for self-hosted models");
  } else if (model.needsImage) {
    const { data, type } = await readInputImage(form);
    try {
      inputImageUrl = await uploadImage(data, type);
    } catch (e) {
      log.warn("input upload failed", { userId: user.id, error: errMsg(e) });
      throw new HttpError(502, "Could not upload the image to Higgsfield. Try again.");
    }
  }

  const gen = await createGeneration({ user, model, input: parsed.data, inputImageUrl, inputImage });
  const row = await getGeneration(gen.id);
  return json({ item: row ? toView(row) : null }, 201);
});

/** Image comes from an upload, or from an existing output (`source` = "<genId>/<file>"). */
async function readInputImage(form: FormData): Promise<{ data: Buffer; type: string }> {
  const file = form.get("image");
  if (file && typeof file !== "string" && file.size > 0) {
    if (!IMAGE_TYPES.has(file.type)) throw new HttpError(400, "Image must be JPG, PNG or WebP");
    if (file.size > MAX_UPLOAD) throw new HttpError(400, "Image must be under 10 MB");
    return { data: Buffer.from(await file.arrayBuffer()), type: file.type };
  }
  const source = form.get("source");
  if (typeof source === "string" && source.includes("/")) {
    const [genId, name] = source.split("/");
    const p = resolveMediaPath(genId, name);
    const gen = p ? await getGeneration(genId) : null;
    // Team outputs are visible to everyone, so any signed-in user may reuse them.
    if (!p || !gen || !gen.outputs.some((o) => o.file === name && o.type === "image")) {
      throw new HttpError(400, "That source image is no longer available");
    }
    const size = await fileSize(p);
    if (!size || size > MAX_UPLOAD) throw new HttpError(400, "Source image is missing or larger than 10 MB");
    const type = mimeFor(name);
    if (!IMAGE_TYPES.has(type)) throw new HttpError(400, "Source must be JPG, PNG or WebP");
    return { data: await readFile(p), type };
  }
  throw new HttpError(400, "This model needs a starting image");
}
