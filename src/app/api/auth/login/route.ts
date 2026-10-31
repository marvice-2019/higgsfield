import { z } from "zod";
import { createSession, verifyLogin } from "@/lib/auth";
import { assertSameOrigin, clientIp, handle, HttpError, json } from "@/lib/http";
import { log } from "@/lib/log";
import { hit, reset } from "@/lib/ratelimit";

const body = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Enter your email and password");
  const { email, password } = parsed.data;

  const key = `login:${clientIp(req)}:${email.toLowerCase()}`;
  const rl = hit(key, 8, 15 * 60_000);
  if (!rl.ok) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.`);

  const user = await verifyLogin(email, password);
  if (!user) {
    log.warn("login failed", { email: email.toLowerCase(), ip: clientIp(req) });
    throw new HttpError(401, "Wrong email or password");
  }
  reset(key);
  await createSession(user.id);
  log.info("login", { userId: user.id });
  return json({ ok: true });
});
