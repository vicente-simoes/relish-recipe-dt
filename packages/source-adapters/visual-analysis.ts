import type { Logger } from "@relish/utils/logger"
import {
  describeVideoWithQwen,
  QwenVideoAnalysisError,
  type QwenVideoConfig,
} from "@relish/utils/qwen-video"
import { tryCatch, type Result } from "@relish/utils/try"
import {
  describeVideoFrames,
  extractFramesFromVideo,
  getFramesPerSecond,
  type DescribeVideoFramesResult,
} from "@relish/utils/video"
import { join } from "@std/path"

export type VideoAnalysisBackend = "openai" | "qwen3vl"

/** Describe the visual content of a video with the selected backend. Returns `null` if frame extraction failed */
export const analyzeVideoVisuals = async (params: {
  backend: VideoAnalysisBackend
  videoId: string
  videoPath: string
  videoDir: string
  durationSeconds: number | null
  qwen: QwenVideoConfig
  logger: Logger
}): Promise<Result<DescribeVideoFramesResult> | null> => {
  const { videoId, videoPath, videoDir, durationSeconds, logger } = params

  if (params.backend === "qwen3vl") {
    logger.i(
      `[${videoId}] Describing video with local Qwen3-VL (${params.qwen.model} at ${params.qwen.baseUrl})...`,
    )
    const res = await tryCatch(
      describeVideoWithQwen({ videoPath, durationSeconds, config: params.qwen }),
    )

    const diagnostics = res.ok
      ? res.value.diagnostics
      : res.error instanceof QwenVideoAnalysisError
        ? res.error.diagnostics
        : { backend: "qwen3vl", outcome: "failed", error: { message: String(res.error) } }
    await Deno.writeTextFile(
      join(videoDir, "visual-analysis.json"),
      JSON.stringify(diagnostics, null, 2),
    ).catch((e) => logger.w(`[${videoId}] Failed to save visual analysis diagnostics`, e))

    if (!res.ok) {
      logger.e(
        `[${videoId}] Local Qwen3-VL visual analysis failed. Continuing without visual descriptions (no OpenAI fallback):`,
        res.error.message,
      )
      return res
    }
    const { description, failedBatches, totalBatches } = res.value
    const d = res.value.diagnostics
    logger.i(
      `[${videoId}] Qwen3-VL described the video in ${d.segments} segments (${d.sampling.numFrames ?? "?"} frames, ${(d.elapsedMs / 1000).toFixed(1)}s, ${d.retries} retries)`,
    )
    return { ok: true, value: { description, failedBatches, totalBatches }, error: undefined }
  }

  // OpenAI backend: extract frames and describe them in batches
  const fps = durationSeconds != null ? getFramesPerSecond(durationSeconds) : 1
  logger.i(`[${videoId}] Extracting frames at ${fps} fps...`)
  const framesDir = join(videoDir, "frames")
  const framesRes = await tryCatch(extractFramesFromVideo({ videoPath, outDir: framesDir, fps }))

  if (!framesRes.ok) {
    logger.w(`[${videoId}] Failed to extract video frames:`, framesRes.error.message)
    return null
  }
  logger.i(`[${videoId}] Describing frames...`)
  return await tryCatch(describeVideoFrames({ framesDir }))
}
