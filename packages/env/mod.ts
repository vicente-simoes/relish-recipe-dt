import { load } from "@std/dotenv"
import { join } from "@std/path"
import { z } from "zod"

// Treat empty values as unset so that defaults apply
const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value)

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  MONGOT_PASSWORD: z.string().min(1),
  REDIS_URL: z.string().min(1),
  YOUTUBE_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  GEONAMES_USERNAME: z.string().min(1),
  VIDEO_ANALYSIS_BACKEND: z.preprocess(
    emptyAsUndefined,
    z.enum(["openai", "qwen3vl"]).default("openai"),
  ),
  QWEN_VL_BASE_URL: z.preprocess(
    emptyAsUndefined,
    z.url({ protocol: /^https?$/ }).default("http://127.0.0.1:8001/v1"),
  ),
  QWEN_VL_MODEL: z.preprocess(
    emptyAsUndefined,
    z.string().min(1).default("Qwen/Qwen3-VL-8B-Instruct"),
  ),
  QWEN_VL_FPS: z.preprocess(emptyAsUndefined, z.coerce.number().positive().optional()),
  QWEN_VL_MAX_FRAMES: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().default(128)),
  QWEN_VL_MAX_TOKENS: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().default(4096)),
  QWEN_VL_TIMEOUT_MS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().positive().default(600_000),
  ),
})

await load({ envPath: join(import.meta.dirname!, "../../", ".env"), export: true })
const parsedEnv = EnvSchema.safeParse(Deno.env.toObject())

if (parsedEnv.success === false) {
  console.error(`Invalid environment variables\n${z.prettifyError(parsedEnv.error)}`)
  Deno.exit(1)
}

export const env = parsedEnv.data
