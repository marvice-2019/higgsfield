import { env } from "./env";

/** Minimal client for a RunPod serverless endpoint running worker/ltx. */

export class RunpodError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type RunpodStatus = {
  id: string;
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  output?: { video_b64?: string; mime?: string; error?: string } | null;
  error?: string | null;
};

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const e = env();
  let res: Response;
  try {
    res = await fetch(`${e.RUNPOD_API_BASE}/${e.RUNPOD_LTX_ENDPOINT_ID}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${e.RUNPOD_API_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    throw new RunpodError(`RunPod unreachable: ${err instanceof Error ? err.message : String(err)}`, 0);
  }
  const text = await res.text();
  if (!res.ok) throw new RunpodError(`RunPod ${res.status}: ${text.slice(0, 300)}`, res.status);
  return JSON.parse(text) as T;
}

export function submitJob(input: Record<string, unknown>) {
  return call<{ id: string; status: string }>("/run", { method: "POST", body: JSON.stringify({ input }) });
}

export function jobStatus(id: string) {
  // COMPLETED responses carry the whole mp4 as base64, so allow time for the transfer.
  return call<RunpodStatus>(`/status/${encodeURIComponent(id)}`, { method: "GET" }, 120_000);
}
