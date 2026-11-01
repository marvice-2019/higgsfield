import { z } from "zod";
import { enabledProviders, type Provider } from "./env";

/**
 * Models from Higgsfield's published OpenAPI spec (https://docs.higgsfield.ai/docs/openapi.json).
 * Add a model by adding one entry here; the UI and validation read from this list.
 */

export type FieldSpec =
  | { name: string; label: string; type: "select"; options: (string | number)[]; default: string | number }
  | { name: string; label: string; type: "range"; min: number; max: number; step: number; default: number }
  | { name: string; label: string; type: "toggle"; default: boolean }
  | { name: string; label: string; type: "text"; default: string; placeholder?: string };

export type ModelDef = {
  id: string; // Higgsfield path, or "selfhost/..." for RunPod models
  provider?: Provider; // default "higgsfield"
  label: string;
  family: string;
  kind: "image" | "video";
  needsImage: boolean;
  blurb: string;
  fields: FieldSpec[];
  schema: z.ZodType<Record<string, unknown>>;
};

const prompt = z.string().trim().min(3, "Prompt is too short").max(2000, "Prompt is too long (max 2000 characters)");

const klingFields: FieldSpec[] = [
  { name: "duration", label: "Duration (s)", type: "select", options: [5, 10], default: 5 },
  { name: "cfg_scale", label: "Prompt adherence", type: "range", min: 0, max: 1, step: 0.05, default: 0.5 },
  { name: "negative_prompt", label: "Avoid", type: "text", default: "", placeholder: "blur, distortion, text" },
];
const klingSchema = z.object({
  prompt,
  duration: z.coerce.number().pipe(z.union([z.literal(5), z.literal(10)])).default(5),
  cfg_scale: z.coerce.number().min(0).max(1).default(0.5),
  negative_prompt: z.string().max(500).default(""),
});

const hailuoFields: FieldSpec[] = [
  { name: "duration", label: "Duration (s)", type: "select", options: [6, 10], default: 6 },
  { name: "prompt_optimizer", label: "Auto-improve prompt", type: "toggle", default: true },
];
const hailuoSchema = z.object({
  prompt,
  duration: z.coerce.number().pipe(z.union([z.literal(6), z.literal(10)])).default(6),
  prompt_optimizer: z
    .union([z.boolean(), z.enum(["true", "false", "on", "off"])])
    .transform((v) => v === true || v === "true" || v === "on")
    .default(true),
});

// Seedance 2.5 (ByteDance via Higgsfield). Billed per second of output, so the form offers short durations.
// Schema: https://docs.higgsfield.ai/docs/models/seedance-2-5/text-to-video.md
const seedanceCommonFields: FieldSpec[] = [
  { name: "duration", label: "Duration (s)", type: "select", options: [5, 8, 10, 15], default: 5 },
  { name: "resolution", label: "Resolution", type: "select", options: ["480p", "720p", "1080p"], default: "720p" },
  { name: "generate_audio", label: "Generate audio", type: "toggle", default: true },
];
const seedanceBase = {
  prompt,
  duration: z.coerce.number().int().min(4).max(15).default(5),
  resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
  generate_audio: z
    .union([z.boolean(), z.enum(["true", "false", "on", "off"])])
    .transform((v) => v === true || v === "true" || v === "on")
    .default(true),
};

// LTX-2.5 (Lightricks, open weights) self-hosted on RunPod: worker/ltx. Video with audio.
const ltxFields: FieldSpec[] = [
  { name: "aspect_ratio", label: "Aspect ratio", type: "select", options: ["16:9", "9:16", "1:1"], default: "16:9" },
  { name: "duration", label: "Duration (s)", type: "select", options: [3, 5, 8], default: 5 },
];
const ltxSchema = z.object({
  prompt,
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  duration: z.coerce.number().pipe(z.union([z.literal(3), z.literal(5), z.literal(8)])).default(5),
});

export const MODELS: ModelDef[] = [
  {
    id: "selfhost/ltx-2.5/text-to-video",
    provider: "runpod",
    label: "LTX-2.5 (self-hosted)",
    family: "Lightricks",
    kind: "video",
    needsImage: false,
    blurb: "Open model on our own GPU, with sound. No API credits. First run after idle takes a few minutes.",
    fields: ltxFields,
    schema: ltxSchema,
  },
  {
    id: "selfhost/ltx-2.5/image-to-video",
    provider: "runpod",
    label: "LTX-2.5 · Animate (self-hosted)",
    family: "Lightricks",
    kind: "video",
    needsImage: true,
    blurb: "Animate a still on our own GPU, with sound. Image under 7 MB.",
    fields: ltxFields,
    schema: ltxSchema,
  },
  {
    id: "bytedance/seedance-2.5/text-to-video",
    label: "Seedance 2.5",
    family: "ByteDance",
    kind: "video",
    needsImage: false,
    blurb: "Most realistic text to video, with sound. Billed per second.",
    fields: [
      {
        name: "aspect_ratio",
        label: "Aspect ratio",
        type: "select",
        options: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        default: "16:9",
      },
      ...seedanceCommonFields,
    ],
    schema: z.object({
      ...seedanceBase,
      aspect_ratio: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]).default("16:9"),
    }),
  },
  {
    id: "bytedance/seedance-2.5/image-to-video",
    label: "Seedance 2.5 · Animate",
    family: "ByteDance",
    kind: "video",
    needsImage: true,
    blurb: "Animate a still with realistic motion and sound. Billed per second.",
    fields: seedanceCommonFields,
    schema: z.object(seedanceBase),
  },
  {
    id: "higgsfield-ai/soul/standard",
    label: "Soul",
    family: "Higgsfield",
    kind: "image",
    needsImage: false,
    blurb: "Photoreal stills, fashion and editorial look. Up to 4 images per run.",
    fields: [
      {
        name: "aspect_ratio",
        label: "Aspect ratio",
        type: "select",
        options: ["1:1", "4:5", "3:4", "2:3", "9:16", "4:3", "3:2", "5:4", "16:9", "21:9"],
        default: "4:5",
      },
      { name: "resolution", label: "Resolution", type: "select", options: ["2K", "4K"], default: "2K" },
      { name: "num_images", label: "Images", type: "select", options: [1, 2, 3, 4], default: 1 },
    ],
    schema: z.object({
      prompt,
      aspect_ratio: z.enum(["1:1", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9"]).default("4:5"),
      resolution: z.enum(["2K", "4K"]).default("2K"),
      num_images: z.coerce.number().int().min(1).max(4).default(1),
    }),
  },
  {
    id: "kling-video/v2.5-turbo/pro/text-to-video",
    label: "Kling 2.5 Turbo Pro",
    family: "Kling",
    kind: "video",
    needsImage: false,
    blurb: "Text to video. Strong motion and camera moves.",
    fields: klingFields,
    schema: klingSchema,
  },
  {
    id: "kling-video/v2.5-turbo/pro/image-to-video",
    label: "Kling 2.5 Turbo Pro · Animate",
    family: "Kling",
    kind: "video",
    needsImage: true,
    blurb: "Animate a still. Best quality Kling tier.",
    fields: klingFields,
    schema: klingSchema,
  },
  {
    id: "kling-video/v2.5-turbo/standard/image-to-video",
    label: "Kling 2.5 Turbo Standard · Animate",
    family: "Kling",
    kind: "video",
    needsImage: true,
    blurb: "Animate a still. Cheaper tier for drafts.",
    fields: klingFields,
    schema: klingSchema,
  },
  {
    id: "minimax/hailuo-2.3/standard/text-to-video",
    label: "Hailuo 2.3",
    family: "MiniMax",
    kind: "video",
    needsImage: false,
    blurb: "Text to video. Good with people and expressions.",
    fields: hailuoFields,
    schema: hailuoSchema,
  },
  {
    id: "minimax/hailuo-2.3/standard/image-to-video",
    label: "Hailuo 2.3 · Animate",
    family: "MiniMax",
    kind: "video",
    needsImage: true,
    blurb: "Animate a still with natural motion.",
    fields: hailuoFields,
    schema: hailuoSchema,
  },
];

export const providerOf = (m: Pick<ModelDef, "provider">): Provider => m.provider ?? "higgsfield";

/** A model is usable only when its provider is configured. */
export function getModel(id: string): ModelDef | undefined {
  const on = enabledProviders();
  return MODELS.find((m) => m.id === id && on.has(providerOf(m)));
}

/** Client-safe view (no zod schema). */
export type PublicModel = Omit<ModelDef, "schema">;
export function publicModels(): PublicModel[] {
  const on = enabledProviders();
  return MODELS.filter((m) => on.has(providerOf(m))).map(({ schema: _schema, ...rest }) => rest);
}
