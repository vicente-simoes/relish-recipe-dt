import { extractRecipes } from "@relish/recipe-processing"
import type { Logger } from "@relish/utils/logger"
import type { RunMetrics } from "@relish/utils/metrics"
import { describeVideo } from "@relish/utils/video"
import { join } from "@std/path"
import { NoObjectGeneratedError, type LanguageModel } from "ai"

// ---
// Fusion and recipe extraction, shared by the pipeline and stage replay
// ---

export type TextStageModel = {
  backend: "openai" | "local"
  model: Exclude<LanguageModel, string>
}

const cookingPromptAppendix = `
          Cooking video specialization:
          When generating the description, make sure to include all relevant cooking-related information that appears in the video. This includes:
          - Cooking techniques and methods
          - Ingredients and their quantities
          - Timings, durations, and temperatures
          - Tools, utensils, and equipment used
          - Key visual cues related to food preparation, presentation, or changes in the dish
          `

/** Combine captions, transcription and visual description into a plain-text description */
export const runFusion = (params: {
  metrics: RunMetrics
  sources: { captions: string; transcription: string; visual: string }
  fusion: TextStageModel
}) => {
  const { metrics, sources, fusion } = params
  return metrics.stage(
    "fusion",
    { backend: fusion.backend, model: fusion.model.modelId },
    async (stage) => {
      stage.set({
        inputChars: {
          captions: sources.captions.length,
          transcription: sources.transcription.length,
          visual: sources.visual.length,
        },
      })
      const text = await describeVideo({
        captions: sources.captions,
        transcription: sources.transcription,
        description: sources.visual,
        promptAppendix: cookingPromptAppendix,
        model: fusion.model,
        onResponse: stage.addResponse,
      })
      stage.set({ outputChars: text.length })
      return text
    },
  )
}

/** Extract structured recipes from the description. On a schema failure the raw output is saved to `outDir` */
export const runExtraction = (params: {
  metrics: RunMetrics
  description: string
  extraction: TextStageModel
  outDir: string
  logger: Logger
  logPrefix: string
}) => {
  const { metrics, extraction, logger, logPrefix } = params
  return metrics.stage(
    "extraction",
    { backend: extraction.backend, model: extraction.model.modelId },
    async (stage) => {
      const res = await extractRecipes(params.description, {
        model: extraction.model,
        schemaInPrompt: extraction.backend === "local",
        onResponse: stage.addResponse,
      }).catch(async (e) => {
        if (NoObjectGeneratedError.isInstance(e)) {
          if (e.response) {
            stage.addResponse({
              modelId: e.response.modelId,
              usage: e.usage,
              finishReason: e.finishReason,
            })
          }
          // Keep the raw output to see why it was rejected
          if (e.text) {
            await Deno.writeTextFile(join(params.outDir, "extraction-raw.txt"), e.text).catch(
              (err) => logger.w(`${logPrefix} Failed to save raw extraction output`, err),
            )
          }
        }
        throw e
      })
      stage.set({ recipes: res.result.length, confidence: res.confidence })
      return res
    },
  )
}
