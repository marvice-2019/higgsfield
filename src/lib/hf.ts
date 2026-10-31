import { env } from "./env";

/** Thin client for the Higgsfield API. Docs: https://docs.higgsfield.ai */

export class HfError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export type HfStatus = {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
  request_id: string;
  error?: string | null;
  images?: { url: string }[];
  video?: { url: string };
  audio?: { url: string };
  audios?: { url: string }[];
  expires_at?: string | null;
};

function authHeader() {
  const e = env();
  return `Key ${e.HF_API_KEY_ID}:${e.HF_API_KEY_SECRET}`;
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const url = `${env().HF_API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new HfError(`Higgsfield unreachable: ${e instanceof Error ? e.message : String(e)}`, 0, true);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? typeof (body as { detail: unknown }).detail === "string"
          ? (body as { detail: string }).detail
          : JSON.stringify((body as { detail: unknown }).detail)
        : typeof body === "string"
          ? body.slice(0, 300)
          : res.statusText;
    const retryable = res.status === 429 || res.status >= 500;
    throw new HfError(`Higgsfield ${res.status}: ${detail}`, res.status, retryable);
  }
  return body as T;
}

export function submit(modelId: string, input: Record<string, unknown>) {
  return call<{ request_id: string; status: string }>(`/${modelId}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getStatus(requestId: string) {
  return call<HfStatus>(`/requests/${encodeURIComponent(requestId)}/status`, { method: "GET", timeoutMs: 15_000 });
}

export async function deleteRequest(requestId: string) {
  await call(`/requests/${encodeURIComponent(requestId)}`, { method: "DELETE", timeoutMs: 15_000 });
}

const UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Upload an input image to Higgsfield storage and return its public URL. */
export async function uploadImage(data: Buffer, contentType: string): Promise<string> {
  if (!UPLOAD_TYPES.has(contentType)) throw new HfError(`Unsupported image type ${contentType}`, 400, false);
  const slot = await call<{ public_url: string; upload_url: string; upload_headers?: Record<string, string> }>(
    "/files/generate-upload-url",
    { method: "POST", body: JSON.stringify({ content_type: contentType }) },
  );
  // Presigned storage URL: never send Higgsfield credentials here.
  const put = await fetch(slot.upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType, ...(slot.upload_headers ?? {}) },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(60_000),
  });
  if (!put.ok) throw new HfError(`Image upload failed (${put.status})`, put.status, put.status >= 500);
  return slot.public_url;
}

export const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);
