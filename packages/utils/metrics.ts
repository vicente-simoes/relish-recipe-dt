import { ensureDir } from "@std/fs"
import { dirname } from "@std/path"
import type { LanguageModelUsage } from "ai"

// ---
// Per-stage run metrics
// ---

/** Reported after each model request */
export type ModelResponse = {
  /** Model id reported by the provider (e.g. a dated snapshot) */
  modelId: string
  usage?: LanguageModelUsage
  finishReason?: string
}

export type OnModelResponse = (response: ModelResponse) => void

export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number }

export type StageMetrics = {
  backend: string
  /** Configured model, if the stage uses one */
  model: string | null
  /** Models reported in the responses */
  responseModels: string[]
  startedAt: string
  elapsedMs: number
  outcome: "success" | "failed"
  error: string | null
  /** Number of model requests that returned a response */
  requests: number
  usage: TokenUsage | null
  finishReasons: string[]
  details: Record<string, unknown>
}

export type StageRecorder = {
  addResponse: OnModelResponse
  set: (details: Record<string, unknown>) => void
  /** Mark the stage as failed when it returns without a usable result */
  fail: (error: string) => void
}

export type RunMetrics = ReturnType<typeof createRunMetrics>

/** Collect timing, usage and outcome of each pipeline stage, saved to `path` after every stage */
export const createRunMetrics = (params: {
  path: string
  info: Record<string, unknown>
  onSaveError?: (error: unknown) => void
}) => {
  const t0 = performance.now()
  const data = {
    ...params.info,
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    stages: {} as Record<string, StageMetrics>,
  }

  const save = async () => {
    data.elapsedMs = Math.round(performance.now() - t0)
    try {
      await ensureDir(dirname(params.path))
      await Deno.writeTextFile(params.path, JSON.stringify(data, null, 2))
    } catch (e) {
      params.onSaveError?.(e)
    }
  }

  /** Time a stage and record its outcome. Errors are recorded and rethrown */
  const stage = async <T>(
    name: string,
    config: { backend: string; model?: string | null },
    fn: (stage: StageRecorder) => PromiseLike<T>,
  ): Promise<T> => {
    const s: StageMetrics = {
      backend: config.backend,
      model: config.model ?? null,
      responseModels: [],
      startedAt: new Date().toISOString(),
      elapsedMs: 0,
      outcome: "success",
      error: null,
      requests: 0,
      usage: null,
      finishReasons: [],
      details: {},
    }
    data.stages[name] = s
    const start = performance.now()

    const recorder: StageRecorder = {
      addResponse: ({ modelId, usage, finishReason }) => {
        s.requests++
        if (!s.responseModels.includes(modelId)) s.responseModels.push(modelId)
        if (finishReason) s.finishReasons.push(finishReason)
        if (usage) {
          const total = s.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
          s.usage = {
            inputTokens: total.inputTokens + (usage.inputTokens ?? 0),
            outputTokens: total.outputTokens + (usage.outputTokens ?? 0),
            totalTokens: total.totalTokens + (usage.totalTokens ?? 0),
          }
        }
      },
      set: (details) => Object.assign(s.details, details),
      fail: (error) => {
        s.outcome = "failed"
        s.error = error
      },
    }

    try {
      return await fn(recorder)
    } catch (e) {
      recorder.fail(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      s.elapsedMs = Math.round(performance.now() - start)
      await save()
    }
  }

  return {
    stage,
    /** Set top-level fields */
    set: async (fields: Record<string, unknown>) => {
      Object.assign(data, fields)
      await save()
    },
    /** Mark an already recorded stage as failed */
    fail: async (name: string, error: string) => {
      const s = data.stages[name]
      if (!s) return
      s.outcome = "failed"
      s.error = error
      await save()
    },
  }
}
