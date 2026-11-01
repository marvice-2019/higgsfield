import postgres from "postgres";
import { env } from "./env";

const globalForDb = globalThis as unknown as { __studioSql?: postgres.Sql };

export function sql(): postgres.Sql {
  if (!globalForDb.__studioSql) {
    globalForDb.__studioSql = postgres(env().DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return globalForDb.__studioSql;
}

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  active: boolean;
  created_at: Date;
};

export type OutputFile = { type: "image" | "video" | "audio"; file: string; mime: string };

export type GenerationRow = {
  id: string;
  user_id: string;
  model: string;
  kind: "image" | "video";
  prompt: string;
  params: Record<string, unknown>;
  input_image_url: string | null;
  hf_request_id: string | null;
  provider: "higgsfield" | "runpod";
  provider_request_id: string | null;
  status: "submitting" | "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
  error: string | null;
  outputs: OutputFile[];
  last_polled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

export const PENDING_STATUSES = ["submitting", "queued", "in_progress"] as const;
