import { getLogger } from "@relish/di"
import { env } from "@relish/env"
import { evaluateRecipeLikelihood } from "@relish/recipe-processing"
import { TMP_DIR } from "@relish/storage"
import { gpt4_1Mini, gpt4oMini, whisper1 } from "@relish/utils/ai"
import { CommandError, executeCommand } from "@relish/utils/command"
import { localAsrConfigFromEnv } from "@relish/utils/local-asr"
import { createLocalLlm, localLlmConfigFromEnv } from "@relish/utils/local-llm"
import { createRunMetrics } from "@relish/utils/metrics"
import { qwenVideoConfigFromEnv } from "@relish/utils/qwen-video"
import { tryCatch } from "@relish/utils/try"
import {
  extractAudioFromVideo,
  getVideoDuration,
  transcribeAudio,
  vttToJson,
} from "@relish/utils/video"
import { ensureDir } from "@std/fs"
import { join, resolve } from "@std/path"
import dayjs from "dayjs"
import {
  ExtractedRecipeWithMetadata,
  SourceAdapter,
  YoutubeSearchParametersSchema,
  type YoutubeSearchParameters,
} from "./mod.ts"
import { runExtraction, runFusion, type TextStageModel } from "./text-stages.ts"
import { analyzeVideoVisuals } from "./visual-analysis.ts"

// https://developers.google.com/youtube/v3/docs/search/list
const BASE_URL = "https://www.googleapis.com/youtube/v3/search"

// Discard videos that score lower than the recipe likelihood (1-5 scale)
const RECIPE_LIKELIHOOD_THRESHOLD = 3

type YoutubeSearchRequestParams = YoutubeSearchParameters & { key: string }

type YoutubeSearchResult = {
  kind: string
  etag: string
  nextPageToken: string
  regionCode: string
  pageInfo: { totalResults: number; resultsPerPage: number }
  items: YoutubeSearchItem[]
}

type YoutubeSearchItem = {
  kind: string
  etag: string
  id: { kind: "youtube#video"; videoId: string }
  snippet: {
    publishedAt: string // e.g.: 1970-01-01T00:00:00Z
    channelId: string
    title: string
    description: string
    thumbnails: { default: any; medium: any; high: any }
    channelTitle: string
  }
}

/**
 * Extract the YouTube video ID from various URL formats, or treat the input
 * as a raw video ID if it doesn't look like a URL.
 *
 * Handles formats such as:
 *  - https://www.youtube.com/watch?v=VIDEO_ID
 *  - https://youtu.be/VIDEO_ID
 *  - https://www.youtube.com/embed/VIDEO_ID
 *  - https://www.youtube.com/v/VIDEO_ID
 *  - https://www.youtube.com/shorts/VIDEO_ID
 *  - https://www.youtube.com/live/VIDEO_ID
 *  - https://m.youtube.com/watch?v=VIDEO_ID
 *  - https://youtube.com/attribution_link?...&u=/watch?v=VIDEO_ID...
 *  - Plain video ID string
 */
const parseVideoUrlOrId = (videoURLOrID: string): { url: string; id: string } => {
  // If it's not a URL, treat it as a raw video ID
  if (!videoURLOrID.startsWith("http")) {
    return { url: `https://www.youtube.com/watch?v=${videoURLOrID}`, id: videoURLOrID }
  }

  const url = new URL(videoURLOrID)

  // Standard watch URL: youtube.com/watch?v=VIDEO_ID
  const vParam = url.searchParams.get("v")
  if (vParam) {
    return { url: `https://www.youtube.com/watch?v=${vParam}`, id: vParam }
  }

  // Short-form and path-based URLs:
  // - youtu.be/VIDEO_ID
  // - youtube.com/embed/VIDEO_ID
  // - youtube.com/v/VIDEO_ID
  // - youtube.com/shorts/VIDEO_ID
  // - youtube.com/live/VIDEO_ID
  const pathMatch = url.pathname.match(/^\/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]{11})/)
  if (pathMatch) {
    return { url: `https://www.youtube.com/watch?v=${pathMatch[1]}`, id: pathMatch[1] }
  }

  // youtu.be/VIDEO_ID (shorter path, no prefix)
  if (url.hostname === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0]
    if (id) {
      return { url: `https://www.youtube.com/watch?v=${id}`, id }
    }
  }

  // attribution_link URLs (e.g. from share dialogs)
  const uParam = url.searchParams.get("u")
  if (uParam) {
    const decodedU = new URL(decodeURIComponent(uParam), url.origin)
    const nestedV = decodedU.searchParams.get("v")
    if (nestedV) {
      return { url: `https://www.youtube.com/watch?v=${nestedV}`, id: nestedV }
    }
  }

  throw new Error(`Unable to extract a YouTube video ID from the given input: "${videoURLOrID}"`)
}

/** Configuration recorded in the run metrics */
const runConfig = () => ({
  videoResolutionLimit: env.VIDEO_RESOLUTION_LIMIT,
  captionsFormat: env.CAPTIONS_FORMAT,
  videoAnalysisBackend: env.VIDEO_ANALYSIS_BACKEND,
  qwen: { ...qwenVideoConfigFromEnv(env), fps: env.QWEN_VL_FPS ?? null },
  transcriptionBackend: env.TRANSCRIPTION_BACKEND,
  localAsr: localAsrConfigFromEnv(env),
  fusionBackend: env.FUSION_BACKEND,
  extractionBackend: env.EXTRACTION_BACKEND,
  localLlm: localLlmConfigFromEnv(env),
})

// "short-side" sorts by the smaller dimension, so vertical Shorts get 480x854 instead of 240x426
const downloadFormatArgs = () =>
  env.VIDEO_RESOLUTION_LIMIT === "short-side"
    ? ["-f", "bestvideo+bestaudio/best", "-S", "res:480"]
    : ["-f", "bestvideo[height<=480]+bestaudio/best[height<=480]"]

/** Fusion and extraction models selected by FUSION_BACKEND and EXTRACTION_BACKEND */
const textStageModels = (): { fusion: TextStageModel; extraction: TextStageModel } => {
  const localLlm = createLocalLlm(localLlmConfigFromEnv(env))
  return {
    fusion: {
      backend: env.FUSION_BACKEND,
      model: env.FUSION_BACKEND === "local" ? localLlm : gpt4_1Mini,
    },
    extraction: {
      backend: env.EXTRACTION_BACKEND,
      model: env.EXTRACTION_BACKEND === "local" ? localLlm : gpt4oMini,
    },
  }
}

export type YoutubeSourceAdapter = ReturnType<typeof createYoutubeAdapter>

export const createYoutubeAdapter = () => {
  const logger = getLogger()

  const youtube = {
    findDishSources: async ({ dish }) => {
      const defaultParams = {
        key: env.YOUTUBE_API_KEY,
        q: "food",
        part: "snippet",
        type: "video",
        maxResults: "3",
        order: "relevance",
        publishedAfter: dayjs().startOf("D").subtract(1, "w").toISOString(), // Fetch videos uploaded in the last week
      } satisfies YoutubeSearchRequestParams

      const parsedParams = YoutubeSearchParametersSchema.safeParse(dish.searchMetadata.youtube)
      if (!parsedParams.success) {
        logger.w("Invalid youtube search metadata, falling back to defaults", parsedParams.error)
      }
      const allParams = { ...defaultParams, ...parsedParams.data }

      logger.i("Fetching food data from YouTube with the following parameters: ", allParams)
      const url = `${BASE_URL}?${new URLSearchParams(allParams).toString()}`
      const res = await fetch(url)
      const data = ((await res.json()) as YoutubeSearchResult).items.map((it) => ({
        url: parseVideoUrlOrId(it.id.videoId).url,
        ...it,
      }))

      logger.i("Evaluating recipe likelihood for each video")
      const scores: (number | null)[] = []
      for (const item of data) {
        try {
          const score = await evaluateRecipeLikelihood(JSON.stringify(item, null, 2))
          scores.push(score)
          logger.i(`[${item.id.videoId}] Recipe likelihood: ${score}`)
        } catch (e) {
          scores.push(null)
          logger.e(`[${item.id.videoId}] Failed to compute recipe likelihood`, e)
        }
      }

      let items = data.map((item, i) => ({ score: scores[i], metadata: item }))
      // Generate a unique filename per run to avoid race conditions among multiple workers/replicas calling findDishSources concurrently
      const filename = join(TMP_DIR, `youtube-scored-results-${crypto.randomUUID()}.json`)
      logger.i(`Saving results to ${filename}`)
      await Deno.writeTextFile(filename, JSON.stringify(items, null, 2))

      logger.i(`Discarding videos with likelihood less than ${RECIPE_LIKELIHOOD_THRESHOLD}/5`)
      items = items.filter(
        (item) => item.score !== null && item.score >= RECIPE_LIKELIHOOD_THRESHOLD,
      )

      return data
    },

    processDishFromSource: async ({ source }) => {
      // Parse URL. Hard failure means we can't do anything
      let videoId: string
      try {
        videoId = parseVideoUrlOrId(source.url).id
      } catch (error) {
        logger.e(`[${source.url}] Failed to parse video URL`, error)
        return []
      }

      const videoDir = join(TMP_DIR, videoId)

      // Per-stage timing, usage and outcome
      const metrics = createRunMetrics({
        path: join(videoDir, "run-metrics.json"),
        info: { videoId, source: source.url, config: runConfig() },
        onSaveError: (e) => logger.w(`[${videoId}] Failed to save run metrics`, e),
      })

      // Download video
      const videoPath = await tryCatch(
        metrics.stage("download", { backend: "yt-dlp" }, (stage) => {
          stage.set({ format: downloadFormatArgs().join(" ") })
          return youtube.downloadVideo({ videoUrlOrId: videoId, outDir: videoDir })
        }),
      )
      if (!videoPath.ok)
        logger.w(
          `[${videoId}] Failed to download video, will attempt captions-only processing:`,
          videoPath.error,
        )

      // Download captions
      const captionsPath = await metrics.stage("captions", { backend: "yt-dlp" }, async (stage) => {
        const path = await youtube.downloadVideoCaptions({
          videoUrlOrId: videoId,
          outDir: videoDir,
          onError: stage.fail,
        })
        stage.set({ available: !!path })
        return path
      })

      let framesDescriptionContent = ""
      let transcriptionContent = ""
      let captionsContent = ""

      // Visual branch (requires video)
      if (videoPath.ok) {
        const duration = await tryCatch(getVideoDuration(videoPath.value))
        if (!duration.ok)
          logger.w(`[${videoId}] Failed to get video duration:`, duration.error.message)
        else logger.i(`[${videoId}] Video duration: ${Math.floor(duration.value ?? 0)}s`)
        await metrics.set({ videoDurationSeconds: duration.ok ? duration.value : null })

        // Describe video visuals with the configured backend
        const framesDescription = await metrics.stage(
          "visual",
          {
            backend: env.VIDEO_ANALYSIS_BACKEND,
            model:
              env.VIDEO_ANALYSIS_BACKEND === "qwen3vl" ? env.QWEN_VL_MODEL : gpt4_1Mini.modelId,
          },
          (stage) =>
            analyzeVideoVisuals({
              backend: env.VIDEO_ANALYSIS_BACKEND,
              videoId,
              videoPath: videoPath.value,
              videoDir,
              durationSeconds: duration.ok ? duration.value : null,
              qwen: qwenVideoConfigFromEnv(env),
              logger,
              stage,
            }),
        )

        if (framesDescription && !framesDescription.ok) {
          logger.w(`[${videoId}] Failed to describe video frames:`, framesDescription.error.message)
        } else if (framesDescription) {
          const { description, failedBatches, totalBatches } = framesDescription.value

          // Fail only if half or more of the batches failed
          if (failedBatches.length > 0 && failedBatches.length >= totalBatches / 2) {
            logger.e(
              `[${videoId}] Half or more of the frame description batches failed (${failedBatches.length}/${totalBatches}). Skipping frames description.`,
            )
            await metrics.fail("visual", `${failedBatches.length}/${totalBatches} batches failed`)
          } else {
            if (failedBatches.length > 0) {
              logger.w(
                `[${videoId}] Ignoring ${failedBatches.length} of ${totalBatches} failed frame description batches`,
                failedBatches.map((b) => b.reason),
              )
            }
            framesDescriptionContent = JSON.stringify(description, null, 2)
            await Deno.writeTextFile(
              join(videoDir, "frames-description.json"),
              framesDescriptionContent,
            ).catch((e) => logger.w(`[${videoId}] Failed to save frames description`, e))
          }
        }
      }

      // Audio branch (requires video)
      if (videoPath.ok) {
        logger.i(`[${videoId}] Extracting audio track...`)
        const audioPath = join(videoDir, "audio.mp3")
        const audioRes = await tryCatch(
          metrics.stage("audio", { backend: "ffmpeg" }, () =>
            extractAudioFromVideo({ inputVideoPath: videoPath.value, outputAudioPath: audioPath }),
          ),
        )
        if (!audioRes.ok) {
          logger.w(`[${videoId}] Failed to extract audio:`, audioRes.error.message)
        } else {
          const local =
            env.TRANSCRIPTION_BACKEND === "local" ? localAsrConfigFromEnv(env) : undefined
          logger.i(
            `[${videoId}] Transcribing audio track${local ? ` with local ${local.model} at ${local.baseUrl}` : ""}...`,
          )
          const transcriptionRes = await tryCatch(() =>
            metrics.stage(
              "transcription",
              { backend: env.TRANSCRIPTION_BACKEND, model: local?.model ?? whisper1.modelId },
              async (stage) => {
                const res = await transcribeAudio(audioPath, {
                  onResponse: stage.addResponse,
                  local,
                })
                stage.set({
                  audioSeconds: res.durationInSeconds,
                  language: res.language,
                  segments: res.segments.length,
                })
                return res
              },
            ),
          )
          if (!transcriptionRes.ok) {
            logger.w(`[${videoId}] Failed to transcribe audio:`, transcriptionRes.error.message)
          } else {
            transcriptionContent = JSON.stringify(transcriptionRes.value.segments, null, 2)
            await Deno.writeTextFile(
              join(videoDir, "transcription.json"),
              transcriptionContent,
            ).catch((e) => logger.w(`[${videoId}] Failed to save transcription`, e))
          }
        }
      }

      // Captions branch (independent, no video needed)
      if (captionsPath) {
        const captionsRes = await tryCatch(Deno.readTextFile(captionsPath))
        if (captionsRes.ok) captionsContent = captionsRes.value
        else logger.w(`[${videoId}] Failed to read captions from file:`, captionsRes.error.message)
      } else {
        logger.w(`[${videoId}] Captions not available`)
      }

      // If all data sources are empty, bail out early
      if (!captionsContent && !transcriptionContent && !framesDescriptionContent) {
        logger.w(
          `[${videoId}] No data sources available (no captions, transcription, or frames). Skipping recipe extraction.`,
        )
        return []
      }

      const models = textStageModels()

      // Combine all sources into a video description
      logger.i(`[${videoId}] Putting it all together with ${models.fusion.model.modelId}...`)
      const description = await tryCatch(
        runFusion({
          metrics,
          sources: {
            captions: captionsContent,
            transcription: transcriptionContent,
            visual: framesDescriptionContent,
          },
          fusion: models.fusion,
          captionsFormat: env.CAPTIONS_FORMAT,
        }),
      )

      if (!description.ok) {
        logger.e(`[${videoId}] Failed to generate video description:`, description.error.message)
        return []
      } else if (!description.value) {
        logger.e(`[${videoId}] Video description was empty. Skipping recipe extraction.`)
        await metrics.fail("fusion", "Empty description")
        return []
      }

      await Deno.writeTextFile(join(videoDir, "description.txt"), description.value).catch((e) =>
        logger.w(`[${videoId}] Failed to save description`, e),
      )

      // Extract structured recipe from description
      logger.i(
        `[${videoId}] Extracting formatted recipe with ${models.extraction.model.modelId}...`,
      )
      const recipes = await tryCatch(
        runExtraction({
          metrics,
          description: description.value,
          extraction: models.extraction,
          outDir: videoDir,
          logger,
          logPrefix: `[${videoId}]`,
        }),
      )
      if (!recipes.ok) {
        logger.e(`[${videoId}] Failed to extract recipe:`, recipes.error.message)
        return []
      }

      // Fetch additional metadata
      logger.i(`[${videoId}] Fetching detailed metadata...`)
      const metadata = await metrics.stage("metadata", { backend: "yt-dlp" }, async (stage) => {
        const res = await youtube.fetchDetailedMetadata({ videoUrlOrId: videoId })
        if (!res) stage.fail("No metadata downloaded")
        return res
      })

      // Assemble final results
      const recipesWithMetadata: ExtractedRecipeWithMetadata[] = recipes.value.result.map(
        (r, i) => ({
          ...r,
          source: source.url,
          index: i,
          language: metadata?.language as string | undefined,
          location: metadata?.location as string | undefined,
          modelConfidence: recipes.value.confidence,
          plainTextDescription: description.value,
        }),
      )

      await Deno.writeTextFile(
        join(videoDir, "recipe.json"),
        JSON.stringify(recipesWithMetadata, null, 2),
      ).catch((e) => logger.w(`[${videoId}] Failed to save recipe`, e))

      logger.i(`[${videoId}] Extracted ${recipesWithMetadata.length} recipe(s)`)
      return recipesWithMetadata
    },

    /** Re-run fusion and extraction, or extraction only, on the files saved by a previous run */
    replayStages: async (params: {
      artifactsDir: string
      outDir: string
      from: "fusion" | "extraction"
    }) => {
      const { artifactsDir, outDir, from } = params
      await ensureDir(outDir)
      const metrics = createRunMetrics({
        path: join(outDir, "run-metrics.json"),
        info: { replayOf: resolve(artifactsDir), from, config: runConfig() },
        onSaveError: (e) => logger.w("Failed to save run metrics", e),
      })
      const models = textStageModels()

      let description: string
      if (from === "fusion") {
        // Same inputs as the pipeline: the captions file as is, and the saved JSON files
        const readIfExists = (name: string) =>
          Deno.readTextFile(join(artifactsDir, name)).catch((e) => {
            if (e instanceof Deno.errors.NotFound) return ""
            throw e
          })
        const captionsFile = Array.from(Deno.readDirSync(artifactsDir)).find(
          (f) => f.isFile && /\.(vtt)$/i.test(f.name),
        )
        const sources = {
          captions: captionsFile ? await readIfExists(captionsFile.name) : "",
          transcription: await readIfExists("transcription.json"),
          visual: await readIfExists("frames-description.json"),
        }
        await metrics.set({ captionsFile: captionsFile?.name ?? null })

        logger.i(`Replaying fusion with ${models.fusion.model.modelId}...`)
        description = await runFusion({
          metrics,
          sources,
          fusion: models.fusion,
          captionsFormat: env.CAPTIONS_FORMAT,
        })
        if (!description) {
          await metrics.fail("fusion", "Empty description")
          throw new Error("Video description was empty")
        }
        await Deno.writeTextFile(join(outDir, "description.txt"), description)
      } else {
        description = await Deno.readTextFile(join(artifactsDir, "description.txt"))
      }

      logger.i(`Replaying extraction with ${models.extraction.model.modelId}...`)
      const recipes = await runExtraction({
        metrics,
        description,
        extraction: models.extraction,
        outDir,
        logger,
        logPrefix: "[replay]",
      })
      const result = recipes.result.map((r, i) => ({
        ...r,
        index: i,
        modelConfidence: recipes.confidence,
        plainTextDescription: description,
      }))
      await Deno.writeTextFile(join(outDir, "recipe.json"), JSON.stringify(result, null, 2))
      logger.i(`Extracted ${result.length} recipe(s)`)
      return result
    },

    downloadVideo: async (params: {
      videoUrlOrId: string
      outDir: string
      withCaptions?: boolean
    }) => {
      const { url } = parseVideoUrlOrId(params.videoUrlOrId)
      const videoPathWithGenericExtension = join(params.outDir, "video.%(ext)s")
      // Download video
      await executeCommand(
        "yt-dlp",
        ...downloadFormatArgs(),
        url,
        "-o",
        videoPathWithGenericExtension,
      )
      // Retrieve downloaded file path
      const videoFile = Array.from(Deno.readDirSync(params.outDir)).find(
        (f) => f.isFile && /\.(mp4|mkv|webm|mov|avi)$/i.test(f.name),
      )
      const videoPath = videoFile ? join(params.outDir, videoFile.name) : null
      if (!videoPath) throw new Error("Unable to retrieve the path of the downloaded video")
      return videoPath
    },

    downloadVideoCaptions: async (params: {
      videoUrlOrId: string
      outDir: string
      onError?: (error: string) => void
    }) => {
      const { url } = parseVideoUrlOrId(params.videoUrlOrId)
      try {
        await executeCommand(
          "yt-dlp",
          "--write-auto-sub",
          "--write-sub",
          "--sub-lang",
          "en,original",
          "--skip-download",
          "-P",
          params.outDir,
          url,
        )
      } catch (e) {
        if (e instanceof CommandError) console.error(e, e.stderr)
        else console.error(e)
        // Keep yt-dlp's ERROR lines (e.g. HTTP 429) to tell failures apart from missing captions
        const errorLines =
          e instanceof CommandError
            ? e.stderr?.split("\n").filter((l) => l.startsWith("ERROR"))
            : undefined
        params.onError?.(errorLines?.length ? errorLines.join("\n") : String(e))
        return null
      }
      const captionsFile = Array.from(Deno.readDirSync(params.outDir)).find(
        (f) => f.isFile && /\.(vtt)$/i.test(f.name),
      )
      const captionsPath = captionsFile ? join(params.outDir, captionsFile.name) : null
      if (captionsPath) {
        const captions = await Deno.readTextFile(captionsPath)
        const formattedCaptions = vttToJson(captions)
        await Deno.writeTextFile(
          join(params.outDir, "captions.json"),
          JSON.stringify(formattedCaptions, null, 2),
        )
      }
      return captionsPath
    },

    fetchDetailedMetadata: async (params: { videoUrlOrId: string }) => {
      const { url } = parseVideoUrlOrId(params.videoUrlOrId)
      try {
        const out = await executeCommand("yt-dlp", "-j", url)
        const metadata = JSON.parse(out.stdout)
        return metadata
      } catch (e) {
        if (e instanceof CommandError) console.error(e, e.stderr)
        else console.error(e)
        return null
      }
    },
  } satisfies SourceAdapter
  return youtube
}
