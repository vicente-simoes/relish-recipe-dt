import { createOpenAI } from "@ai-sdk/openai"
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai"

// ---
// Configuration
// ---

export type LocalLlmConfig = {
  /** Base URL of the vLLM OpenAI-compatible API */
  baseUrl: string
  /** Model served by vLLM */
  model: string
  temperature: number
}

export const localLlmConfigFromEnv = (env: {
  LOCAL_LLM_BASE_URL: string
  LOCAL_LLM_MODEL: string
  LOCAL_LLM_TEMPERATURE: number
}): LocalLlmConfig => ({
  baseUrl: env.LOCAL_LLM_BASE_URL,
  model: env.LOCAL_LLM_MODEL,
  temperature: env.LOCAL_LLM_TEMPERATURE,
})

// ---
// Model
// ---

/** Language model served locally by vLLM through its Chat Completions API. Structured outputs use guided decoding */
export const createLocalLlm = (config: LocalLlmConfig) =>
  wrapLanguageModel({
    model: createOpenAI({ baseURL: config.baseUrl, apiKey: "local", name: "local" }).chat(
      config.model,
    ),
    middleware: defaultSettingsMiddleware({ settings: { temperature: config.temperature } }),
  })
