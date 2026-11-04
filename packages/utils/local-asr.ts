import { basename } from "@std/path"
import { z } from "zod"

// ---
// Configuration
// ---

export type LocalAsrConfig = {
  /** Base URL of the vLLM OpenAI-compatible API */
  baseUrl: string
  /** Model served by vLLM */
  model: string
  /** Request timeout in milliseconds */
  timeoutMs: number
}

export const localAsrConfigFromEnv = (env: {
  LOCAL_ASR_BASE_URL: string
  LOCAL_ASR_MODEL: string
  LOCAL_ASR_TIMEOUT_MS: number
}): LocalAsrConfig => ({
  baseUrl: env.LOCAL_ASR_BASE_URL,
  model: env.LOCAL_ASR_MODEL,
  timeoutMs: env.LOCAL_ASR_TIMEOUT_MS,
})

// ---
// Transcription
// ---

// vLLM leaves some OpenAI segment fields (e.g. no_speech_prob) empty, so only the fields we use are parsed
const VerboseTranscriptionSchema = z.object({
  text: z.string(),
  language: z.string().nullish(),
  duration: z.number().nullish(),
  segments: z
    .array(z.object({ start: z.number(), end: z.number(), text: z.string() }))
    .nullish(),
})

/** Transcribe an audio file with a local Whisper model served by vLLM, with segment timestamps */
export const transcribeWithLocalAsr = async (params: {
  audioPath: string
  config: LocalAsrConfig
}) => {
  const { config } = params
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`

  const audio = await Deno.readFile(params.audioPath)
  const form = new FormData()
  form.append("file", new Blob([audio]), basename(params.audioPath))
  form.append("model", config.model)
  form.append("response_format", "verbose_json")
  form.append("timestamp_granularities[]", "segment")
  form.append("temperature", "0")

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Local ASR request to ${endpoint} failed: ${message}`)
  }
  const body = await res.text()
  if (!res.ok) throw new Error(`Local ASR returned HTTP ${res.status}: ${body.slice(0, 1000)}`)

  const parsed = VerboseTranscriptionSchema.safeParse(JSON.parse(body))
  if (!parsed.success) {
    throw new Error(`Unexpected local ASR response: ${z.prettifyError(parsed.error)}`)
  }
  const { text, language, duration, segments } = parsed.data
  return {
    text,
    segments: (segments ?? []).map((s) => ({
      text: s.text,
      startSecond: s.start,
      endSecond: s.end,
    })),
    language: language ?? undefined,
    durationInSeconds: duration ?? undefined,
  }
}
