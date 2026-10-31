import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { requireUser } from "@/lib/auth";
import { handle, HttpError } from "@/lib/http";
import { fileSize, mimeFor, resolveMediaPath } from "@/lib/media";

export const dynamic = "force-dynamic";

/** Serves stored outputs to signed-in users, with Range support so videos can seek. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string; file: string }> }) => {
  await requireUser();
  const { id, file } = await ctx.params;
  const p = resolveMediaPath(id, file);
  const size = p ? await fileSize(p) : null;
  if (!p || size === null) throw new HttpError(404, "Not found");

  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": mimeFor(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400, immutable",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="studio-${id.slice(0, 8)}-${file}"`,
  };

  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const stream = Readable.toWeb(createReadStream(p)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
});
