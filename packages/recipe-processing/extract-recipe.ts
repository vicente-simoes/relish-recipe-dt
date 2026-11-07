import { gpt4oMini } from "@relish/utils/ai"
import type { OnModelResponse } from "@relish/utils/metrics"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"

const extractionPrompt = `
You are an expert culinary information extraction model.
You receive informal or noisy text (e.g., posts or video transcriptions from social media). These texts may contain unrelated commentary, anecdotes, or filler language.

Your task is to identify and extract only the structured recipe information contained in the text.

Follow these rules:
- Ignore non-recipe content (introductions, jokes, ads, etc.).
- Always output the recipe in English, even if the input text is in another language. Translate ingredient names and steps to English, but stick to the original language for typical terms.
- Strictly report only what's in the text without making up any additional information.
`

const InitialRecipeSchema = z.object({
  dish: z.string(),
  steps: z.array(
    z.object({
      description: z.string(),
      ingredients: z.array(
        z.object({
          ingredientName: z.string(),
          quantity: z.number().nullish(),
          unit: z
            .string()
            .nullish()
            .describe(
              `Set to "units" if the ingredient has a quantity but not a specific unit (e.g. 4 eggs)`,
            ),
        }),
      ),
      tools: z.array(
        z.object({
          toolName: z.string(),
          alternativeTools: z.array(z.string()),
        }),
      ),
      prepSeconds: z.number().nullish(),
    }),
  ),
})

const ExtractionSchema = z.object({
  result: z.array(InitialRecipeSchema),
  confidence: z.number().min(0).max(1).describe("Confidence level of the end result"),
})

export type ExtractedRecipe = Awaited<ReturnType<typeof extractRecipes>>["result"][number]

export async function extractRecipes(
  text: string,
  options?: {
    model?: LanguageModel
    /** Local models only see the schema through guided decoding, so add it to the prompt */
    schemaInPrompt?: boolean
    onResponse?: OnModelResponse
  },
) {
  const {
    object: initialRecipes,
    usage,
    finishReason,
    response,
  } = await generateObject({
    model: options?.model ?? gpt4oMini,
    system: options?.schemaInPrompt
      ? `${extractionPrompt}\nAnswer with a JSON object that follows this JSON schema:\n${JSON.stringify(z.toJSONSchema(ExtractionSchema))}\n`
      : extractionPrompt,
    schema: ExtractionSchema,
    prompt: text,
  })
  options?.onResponse?.({ modelId: response.modelId, usage, finishReason })
  return initialRecipes
}
