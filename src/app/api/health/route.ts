import { sql } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sql()`SELECT 1`;
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
