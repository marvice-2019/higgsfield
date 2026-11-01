import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { OutputFile } from "./db";
import { env } from "./env";

const MAX_BYTES = 500 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE = /^[0-9]{1,2}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|mp3|wav)$/;

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export function mimeFor(file: string) {
  return EXT_MIME[file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
}

/** Returns the absolute path, or null if the id/file pair is not a valid stored output. */
export function resolveMediaPath(genId: string, file: string): string | null {
  if (!UUID_RE.test(genId) || !FILE_RE.test(file)) return null;
  return path.join(/*turbopackIgnore: true*/ env().MEDIA_DIR, genId, file);
}

export async function saveFromUrl(genId: string, index: number, url: string, type: OutputFile["type"]): Promise<OutputFile> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for output ${index}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error(`Output ${index} is too large (${declared} bytes)`);

  const ctype = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const urlExt = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  const ext = MIME_EXT[ctype] ?? (EXT_MIME[urlExt] ? urlExt : type === "video" ? "mp4" : type === "audio" ? "mp3" : "jpg");
  const file = `${index}.${ext}`;

  const dir = path.join(/*turbopackIgnore: true*/ env().MEDIA_DIR, genId);
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(/*turbopackIgnore: true*/ dir, file);
  const tmpPath = `${finalPath}.part`;

  let bytes = 0;
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) body.destroy(new Error(`Output ${index} exceeded ${MAX_BYTES} bytes`));
  });
  try {
    await pipeline(body, createWriteStream(tmpPath));
    await rename(tmpPath, finalPath);
  } catch (e) {
    await rm(tmpPath, { force: true });
    throw e;
  }
  return { type, file, mime: EXT_MIME[ext] };
}

export async function saveBuffer(genId: string, index: number, data: Buffer, mime: string, type: OutputFile["type"]): Promise<OutputFile> {
  if (data.length > MAX_BYTES) throw new Error(`Output ${index} is too large (${data.length} bytes)`);
  const ext = MIME_EXT[mime] ?? (type === "video" ? "mp4" : "jpg");
  const file = `${index}.${ext}`;
  const dir = path.join(/*turbopackIgnore: true*/ env().MEDIA_DIR, genId);
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(/*turbopackIgnore: true*/ dir, file);
  await writeFile(`${finalPath}.part`, data);
  await rename(`${finalPath}.part`, finalPath);
  return { type, file, mime: EXT_MIME[ext] };
}

export async function removeGenerationMedia(genId: string) {
  if (!UUID_RE.test(genId)) return;
  await rm(path.join(/*turbopackIgnore: true*/ env().MEDIA_DIR, genId), { recursive: true, force: true });
}

export async function fileSize(p: string): Promise<number | null> {
  try {
    const s = await stat(p);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}
