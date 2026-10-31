import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.url("APP_URL must be a full URL, e.g. https://higgsfield.marvice.tech"),
  HF_API_KEY_ID: z.string().min(1, "HF_API_KEY_ID is required"),
  HF_API_KEY_SECRET: z.string().min(1, "HF_API_KEY_SECRET is required"),
  HF_API_BASE: z.url().default("https://api.higgsfield.ai"),
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_NAME: z.string().trim().min(1).max(80).default("Admin"),
  ADMIN_PASSWORD: z.string().min(10, "ADMIN_PASSWORD must be at least 10 characters").optional(),
  MEDIA_DIR: z.string().default("/data/media"),
  DAILY_LIMIT: z.coerce.number().int().min(0).default(25),
  ADMIN_DAILY_LIMIT: z.coerce.number().int().min(0).default(100),
  MAX_ACTIVE_PER_USER: z.coerce.number().int().min(1).default(3),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Parsed lazily so `next build` works without runtime secrets. Fails loudly on first use. */
export function env(): Env {
  if (cached) return cached;
  const raw = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
