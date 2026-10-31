import { z } from "zod";

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
  id: string; // Higgsfield path, without leading slash
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

export const MODELS: ModelDef[] = [
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

export function getModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Client-safe view (no zod schema). */
export type PublicModel = Omit<ModelDef, "schema">;
export function publicModels(): PublicModel[] {
  return MODELS.map(({ schema: _schema, ...rest }) => rest);
}
