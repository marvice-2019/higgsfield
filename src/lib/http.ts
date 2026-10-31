import { NextResponse } from "next/server";
import { env } from "./env";
import { errMsg, log } from "./log";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Block cross-site writes: the Origin (or Referer) must match APP_URL. */
export function assertSameOrigin(req: Request) {
  const expected = new URL(env().APP_URL).origin;
  const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null);
  if (origin !== expected) throw new HttpError(403, "Cross-origin request blocked");
}

/** Wrap a route handler: maps HttpError to a JSON response and logs everything else. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      log.error("unhandled route error", { error: errMsg(e), stack: e instanceof Error ? e.stack : undefined });
      return json({ error: "Something went wrong. Try again." }, 500);
    }
  };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
