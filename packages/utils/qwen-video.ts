import { extname, resolve, toFileUrl } from "@std/path"
import { z } from "zod"
import {
  getFramesPerSecond,
  OutputSchema,
  type DescribeVideoFramesResult,
  type FrameDescription,
} from "./video.ts"

// ---
// Configuration
// ---

export type QwenVideoConfig = {
  /** Base URL of the vLLM OpenAI-compatible API */
  baseUrl: string
  /** Model served by vLLM */
  model: string
  /** Fixed sampling rate, defaults to the same schedule as the OpenAI backend */
  fps?: number
  /** Max number of frames sampled from the video */
  maxFrames: number
  /** Maximum number of generated tokens */
  maxTokens: number
  /** Request timeout in milliseconds */
  timeoutMs: number
}

export const qwenVideoConfigFromEnv = (env: {
  QWEN_VL_BASE_URL: string
  QWEN_VL_MODEL: string
  QWEN_VL_FPS?: number
  QWEN_VL_MAX_FRAMES: number
  QWEN_VL_MAX_TOKENS: number
  QWEN_VL_TIMEOUT_MS: number
}): QwenVideoConfig => ({
  baseUrl: env.QWEN_VL_BASE_URL,
  model: env.QWEN_VL_MODEL,
  fps: env.QWEN_VL_FPS,
  maxFrames: env.QWEN_VL_MAX_FRAMES,
  maxTokens: env.QWEN_VL_MAX_TOKENS,
  timeoutMs: env.QWEN_VL_TIMEOUT_MS,
})

// ---
// Frame sampling
// ---

export type QwenSampling = {
  /** Where the requested fps comes from */
  fpsSource: "override" | "baseline-schedule" | "unknown-duration"
  /** Sampling rate requested to vLLM */
  requestedFps: number
  /** Expected number of frames sampled by vLLM (null if the duration is unknown) */
  numFrames: number | null
  /** Sampling rate after applying the frame cap */
  effectiveFps: number | null
  /** Whether the frame cap was applied */
  capped: boolean
  maxFrames: number
}

// Lower bound applied by vLLM's Qwen3-VL video loader
const MIN_FRAMES = 4

/** Choose the sampling rate, using the same fps schedule as the OpenAI backend by default */
const resolveQwenSampling = (
  durationSeconds: number | null,
  config: Pick<QwenVideoConfig, "fps" | "maxFrames">,
): QwenSampling => {
  const { maxFrames } = config
  if (durationSeconds == null || durationSeconds <= 0) {
    return {
      fpsSource: config.fps !== undefined ? "override" : "unknown-duration",
      // Same fallback as the OpenAI backend
      requestedFps: config.fps ?? 1,
      numFrames: null,
      effectiveFps: null,
      capped: false,
      maxFrames,
    }
  }
  const requestedFps = config.fps ?? getFramesPerSecond(durationSeconds)
  // Mirrors vLLM's Qwen3-VL loader: floor(duration * fps), clamped to [MIN_FRAMES, maxFrames]
  const uncapped = Math.max(MIN_FRAMES, Math.floor(durationSeconds * requestedFps))
  const numFrames = Math.min(uncapped, maxFrames)
  return {
    fpsSource: config.fps !== undefined ? "override" : "baseline-schedule",
    requestedFps,
    numFrames,
    effectiveFps: numFrames / durationSeconds,
    capped: uncapped > maxFrames,
    maxFrames,
  }
}

// ---
// Request
// ---

const qwenVideoPrompt = `
You are an expert video analysis model specialized in cooking videos.
You will receive a cooking video. Describe what visibly happens in it as a chronological list of timestamped segments.

Return a JSON object of the form {"segments": [...]}, where each segment has:
- "startSecond": the time, in seconds from the start of the video, at which the segment starts.
- "endSecond": the time, in seconds from the start of the video, at which the segment ends (greater than or equal to startSecond).
- "text": a concise, factual description of what is visible during that time span.

Please follow these rules carefully:

1. Cover the video from beginning to end in chronological order. Never reorder events: startSecond must not decrease from one segment to the next.
2. Group consecutive moments into a single segment while the same action or scene continues, and start a new segment when the action, ingredient, tool or scene changes.
3. Describe visible actions and objects: cooking techniques (e.g., chopping, whisking, frying), ingredients, tools and equipment, and visible changes in the food (e.g., browning, melting, thickening).
4. Only describe what can be visually confirmed in the video. Do not invent ingredients, quantities, temperatures, durations or actions, and do not infer motivations, emotions, causes or unseen events. If something is ambiguous, describe it as it appears (e.g., "a white powder") instead of guessing.
5. All timestamps are numbers of seconds and must lie within the duration of the video.
6. Output only the JSON object - no Markdown, no code fences, no commentary.
`

// Output shape, enforced through vLLM guided decoding
const QwenOutputSchema = z.object({ segments: OutputSchema })
const { $schema: _, ...qwenOutputJsonSchema } = z.toJSONSchema(QwenOutputSchema)

type ChatMessage = { role: "system" | "user" | "assistant"; content: unknown }

const buildUserMessage = (args: { videoUrl: string; durationSeconds: number | null }) => ({
  role: "user" as const,
  content: [
    { type: "video_url", video_url: { url: args.videoUrl } },
    {
      type: "text",
      text:
        args.durationSeconds != null
          ? `Describe this video. Its duration is ${Math.round(args.durationSeconds * 10) / 10} seconds.`
          : "Describe this video.",
    },
  ],
})

/** The video is sent as a local file and vLLM samples frames uniformly at `fps`, up to `max_frames` */
const buildQwenVideoRequest = (args: {
  messages: ChatMessage[]
  sampling: QwenSampling
  config: QwenVideoConfig
}) => ({
  model: args.config.model,
  messages: args.messages,
  temperature: 0,
  max_tokens: args.config.maxTokens,
  response_format: {
    type: "json_schema",
    json_schema: { name: "video_description", schema: qwenOutputJsonSchema },
  },
  media_io_kwargs: {
    video: { fps: args.sampling.requestedFps, max_frames: args.sampling.maxFrames },
  },
})

// ---
// Output validation
// ---

/** Check that segments are non-negative, ordered and within the video duration. Returns the problems found */
const validateTimeline = (
  segments: FrameDescription[],
  durationSeconds: number | null,
  toleranceSeconds: number,
) => {
  const problems: string[] = []
  if (segments.length === 0) problems.push("the output contains no segments")
  segments.forEach((s, i) => {
    if (!s.text.trim()) problems.push(`segment ${i} has an empty description`)
    if (s.startSecond < 0 || s.endSecond < 0) problems.push(`segment ${i} has a negative timestamp`)
    if (s.startSecond > s.endSecond) problems.push(`segment ${i} starts after it ends`)
    if (i > 0 && s.startSecond < segments[i - 1].startSecond)
      problems.push(`segment ${i} starts before segment ${i - 1}`)
    if (durationSeconds != null && s.endSecond > durationSeconds + toleranceSeconds)
      problems.push(
        `segment ${i} ends at ${s.endSecond}s, beyond the video duration of ${durationSeconds}s`,
      )
  })
  return problems
}

const parseSegments = (
  content: string,
  durationSeconds: number | null,
  toleranceSeconds: number,
): { ok: true; segments: FrameDescription[] } | { ok: false; problem: string } => {
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    return { ok: false, problem: "the output is not valid JSON" }
  }
  const parsed = QwenOutputSchema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      problem: `the output does not match the expected schema: ${z.prettifyError(parsed.error)}`,
    }
  }
  const problems = validateTimeline(parsed.data.segments, durationSeconds, toleranceSeconds)
  if (problems.length > 0) return { ok: false, problem: problems.join("; ") }
  return { ok: true, segments: parsed.data.segments }
}

// ---
// Errors and diagnostics
// ---

export type QwenVideoErrorKind =
  /** Server not reachable */
  | "unreachable"
  /** No response within the timeout */
  | "timeout"
  /** HTTP error or unexpected response body */
  | "http"
  /** Model output failed parsing or validation */
  | "invalid_output"

type TokenUsage = { promptTokens: number; completionTokens: number; totalTokens: number }

export type QwenAttempt = {
  attempt: number
  elapsedMs: number
  outcome: "ok" | QwenVideoErrorKind
  httpStatus?: number
  finishReason?: string | null
  usage?: TokenUsage
  error?: string
  /** Raw model output, only kept when rejected */
  rawOutput?: string
}

export type QwenVisualAnalysisDiagnostics = {
  backend: "qwen3vl"
  model: string
  endpoint: string
  videoPath: string
  videoContainer: string
  videoDurationSeconds: number | null
  sampling: QwenSampling & { method: string; comparedToOpenAI: string }
  generation: { temperature: number; maxTokens: number; guidedJson: boolean; timeoutMs: number }
  startedAt: string
  elapsedMs: number
  attempts: QwenAttempt[]
  retries: number
  usage: TokenUsage | null
  outcome: "success" | "failed"
  segments: number | null
  error: { kind: QwenVideoErrorKind; message: string } | null
}

export class QwenVideoAnalysisError extends Error {
  kind: QwenVideoErrorKind
  diagnostics: QwenVisualAnalysisDiagnostics

  constructor(params: {
    kind: QwenVideoErrorKind
    message: string
    diagnostics: QwenVisualAnalysisDiagnostics
  }) {
    super(`Qwen3-VL visual analysis failed (${params.kind}): ${params.message}`)
    this.kind = params.kind
    this.diagnostics = params.diagnostics
  }
}

export type QwenVideoAnalysis = DescribeVideoFramesResult & {
  diagnostics: QwenVisualAnalysisDiagnostics
}

// ---
// Video description
// ---

// Retry once, only if the model output is invalid, telling the model why it was rejected
const MAX_ATTEMPTS = 2

const RAW_OUTPUT_MAX_CHARS = 4000

const SAMPLING_COMPARED_TO_OPENAI =
  "OpenAI backend: FFmpeg extracts JPEG frames at getFramesPerSecond(duration), resized to at most 1080 px wide, and GPT-4.1 describes them in independent batches of 10 frames. Qwen backend: the whole video is sent in a single request; vLLM decodes it and samples frames uniformly at requestedFps (at most maxFrames), and the Qwen3-VL processor resizes them and encodes their timestamps."

class RequestError extends Error {
  kind: "unreachable" | "timeout"
  constructor(kind: "unreachable" | "timeout", message: string) {
    super(message)
    this.kind = kind
  }
}

const postWithTimeout = async (url: string, body: unknown, timeoutMs: number) => {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return { ok: res.ok, status: res.status, text: await res.text() }
  } catch (error) {
    if (timedOut) throw new RequestError("timeout", `No response within ${timeoutMs} ms`)
    throw new RequestError(
      "unreachable",
      `Unable to reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

const ChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number() })
    .nullish(),
})

/** Describe a video with a local Qwen3-VL model using native video input. Throws a `QwenVideoAnalysisError` on failure */
export const describeVideoWithQwen = async (params: {
  videoPath: string
  durationSeconds: number | null
  config: QwenVideoConfig
}): Promise<QwenVideoAnalysis> => {
  const { config, durationSeconds } = params
  const startedAt = new Date()
  const t0 = performance.now()

  const sampling = resolveQwenSampling(durationSeconds, config)
  // Tolerance for frame spacing and rounding
  const toleranceSeconds = Math.max(2, sampling.effectiveFps ? 1 / sampling.effectiveFps : 0)
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`
  const videoUrl = toFileUrl(resolve(params.videoPath)).href

  const diagnostics: QwenVisualAnalysisDiagnostics = {
    backend: "qwen3vl",
    model: config.model,
    endpoint,
    videoPath: params.videoPath,
    videoContainer: extname(params.videoPath).replace(".", ""),
    videoDurationSeconds: durationSeconds,
    sampling: {
      ...sampling,
      method: "vllm-qwen3vl-fps",
      comparedToOpenAI: SAMPLING_COMPARED_TO_OPENAI,
    },
    generation: {
      temperature: 0,
      maxTokens: config.maxTokens,
      guidedJson: true,
      timeoutMs: config.timeoutMs,
    },
    startedAt: startedAt.toISOString(),
    elapsedMs: 0,
    attempts: [],
    retries: 0,
    usage: null,
    outcome: "failed",
    segments: null,
    error: null,
  }

  const fail = (kind: QwenVideoErrorKind, message: string) => {
    diagnostics.elapsedMs = Math.round(performance.now() - t0)
    diagnostics.retries = Math.max(0, diagnostics.attempts.length - 1)
    diagnostics.error = { kind, message }
    return new QwenVideoAnalysisError({ kind, message, diagnostics })
  }

  const addUsage = (usage: TokenUsage) => {
    const total = diagnostics.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    diagnostics.usage = {
      promptTokens: total.promptTokens + usage.promptTokens,
      completionTokens: total.completionTokens + usage.completionTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: qwenVideoPrompt },
    buildUserMessage({ videoUrl, durationSeconds }),
  ]

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = performance.now()
    const elapsed = () => Math.round(performance.now() - attemptStart)
    const body = buildQwenVideoRequest({ messages, sampling, config })

    let res: Awaited<ReturnType<typeof postWithTimeout>>
    try {
      res = await postWithTimeout(endpoint, body, config.timeoutMs)
    } catch (error) {
      const kind = error instanceof RequestError ? error.kind : "unreachable"
      const message = error instanceof Error ? error.message : String(error)
      diagnostics.attempts.push({ attempt, elapsedMs: elapsed(), outcome: kind, error: message })
      throw fail(kind, message)
    }

    if (!res.ok) {
      const message = `HTTP ${res.status}: ${res.text.slice(0, 1000)}`
      diagnostics.attempts.push({
        attempt,
        elapsedMs: elapsed(),
        outcome: "http",
        httpStatus: res.status,
        error: message,
      })
      throw fail("http", message)
    }

    let completion: z.infer<typeof ChatCompletionSchema>
    try {
      completion = ChatCompletionSchema.parse(JSON.parse(res.text))
    } catch {
      const message = `Unexpected response body: ${res.text.slice(0, 1000)}`
      diagnostics.attempts.push({
        attempt,
        elapsedMs: elapsed(),
        outcome: "http",
        httpStatus: res.status,
        error: message,
      })
      throw fail("http", message)
    }

    const choice = completion.choices[0]
    const content = choice.message.content ?? ""
    const usage = completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined
    if (usage) addUsage(usage)

    const parsed =
      choice.finish_reason === "length"
        ? ({
            ok: false,
            problem: `the output was cut off at the limit of ${config.maxTokens} tokens; it must be shorter`,
          } as const)
        : parseSegments(content, durationSeconds, toleranceSeconds)

    if (parsed.ok) {
      diagnostics.attempts.push({
        attempt,
        elapsedMs: elapsed(),
        outcome: "ok",
        httpStatus: res.status,
        finishReason: choice.finish_reason,
        usage,
      })
      diagnostics.elapsedMs = Math.round(performance.now() - t0)
      diagnostics.retries = attempt - 1
      diagnostics.outcome = "success"
      diagnostics.segments = parsed.segments.length
      return { description: parsed.segments, failedBatches: [], totalBatches: 1, diagnostics }
    }

    diagnostics.attempts.push({
      attempt,
      elapsedMs: elapsed(),
      outcome: "invalid_output",
      httpStatus: res.status,
      finishReason: choice.finish_reason,
      usage,
      error: parsed.problem,
      rawOutput: content.slice(0, RAW_OUTPUT_MAX_CHARS),
    })
    if (attempt === MAX_ATTEMPTS) throw fail("invalid_output", parsed.problem)

    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content: `Your previous answer was rejected because ${parsed.problem}. Describe the video again and return the complete, corrected JSON object only.`,
      },
    )
  }

  // Unreachable: the loop either returns or throws
  throw fail("invalid_output", "No attempts were made")
}
