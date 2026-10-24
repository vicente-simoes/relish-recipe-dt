import { db } from "@relish/storage"
import { join } from "@std/path"

const [instanceId, caseName] = Deno.args
if (!instanceId || !caseName || !/^[0-9]{2}-[A-Za-z0-9-]+$/.test(caseName)) {
  console.error(
    "Usage: deno run -A benchmark/export-recipe.ts <recipe-instance-id> <case-folder>",
  )
  Deno.exit(1)
}

const outputDir = join(import.meta.dirname!, "baseline-v0", caseName)

try {
  if (!(await Deno.stat(outputDir)).isDirectory) {
    throw new Error(`Not a directory: ${outputDir}`)
  }

  const instance = await db.recipeInstance.findUnique({
    where: { id: instanceId },
  })
  if (!instance) throw new Error(`RecipeInstance not found: ${instanceId}`)

  const ingredientIds = [
    ...new Set([
      ...instance.ingredients.map((ref) => ref.ingredientOrDishId),
      ...instance.steps.flatMap((step) =>
        step.ingredients.map((ref) => ref.ingredientOrDishId)
      ),
    ]),
  ]
  const toolRefs = [
    ...instance.tools,
    ...instance.steps.flatMap((step) => step.tools),
  ]
  const toolIds = [
    ...new Set(toolRefs.flatMap((ref) => [ref.tool, ...ref.alternatives])),
  ]

  const [ingredients, dishes, tools, source] = await Promise.all([
    db.ingredient.findMany({
      where: { id: { in: ingredientIds } },
      select: { id: true, name: true },
    }),
    db.dish.findMany({
      where: { id: { in: [...ingredientIds, instance.dishId] } },
      select: { id: true, name: true },
    }),
    db.tool.findMany({
      where: { id: { in: toolIds } },
      select: { id: true, name: true },
    }),
    db.processedUrl.findUnique({
      where: { id: instance.sourceId },
      select: { url: true },
    }),
  ])

  const ingredientNames = new Map(ingredients.map(({ id, name }) => [id, name]))
  const dishNames = new Map(dishes.map(({ id, name }) => [id, name]))
  const toolNames = new Map(tools.map(({ id, name }) => [id, name]))

  const ingredientName = (id: string) =>
    ingredientNames.get(id) ?? dishNames.get(id) ??
      `[unresolved ingredient/dish: ${id}]`
  const toolName = (id: string) =>
    toolNames.get(id) ?? `[unresolved tool: ${id}]`

  const renderIngredient = (ref: {
    ingredientOrDishId: string
    quantity: number | null
    unit: string | null
  }) => {
    const name = ingredientName(ref.ingredientOrDishId)
    if (ref.quantity == null) {
      return `${name} (quantity not recorded${
        ref.unit ? `; unit: ${ref.unit}` : ""
      })`
    }
    return `${ref.quantity}${ref.unit ? ` ${ref.unit}` : ""} ${name}`
  }

  const renderTool = (ref: { tool: string; alternatives: string[] }) =>
    `${toolName(ref.tool)}${
      ref.alternatives.length
        ? ` (alternatives: ${ref.alternatives.map(toolName).join(", ")})`
        : ""
    }`

  const lines = [
    `# Recipe instance — ${
      dishNames.get(instance.dishId) ?? `[unresolved dish: ${instance.dishId}]`
    }`,
    "",
    `Instance ID: ${instance.id}`,
    `Source: ${source?.url ?? `[unresolved source: ${instance.sourceId}]`}`,
    `Model confidence: ${instance.modelConfidence}`,
    `Stored total prep time: ${instance.totalPrepSeconds ?? "not recorded"}${
      instance.totalPrepSeconds == null ? "" : " seconds"
    }`,
    `Language: ${instance.language ?? "not recorded"}`,
    `Location: ${instance.location?.string ?? "not recorded"}`,
    `Plain-text description: ${
      instance.plainTextDescription == null
        ? "not recorded"
        : "see plain-text-description.txt"
    }`,
    "",
    "Names are resolved for display only. Values, order, repetitions, and descriptions are not corrected.",
    "",
    "## Ingredients",
    "",
    ...instance.ingredients.map((ref) => `- ${renderIngredient(ref)}`),
    "",
    "## Tools",
    "",
    ...instance.tools.map((ref) => `- ${renderTool(ref)}`),
    "",
    "## Steps",
    "",
    ...instance.steps.flatMap((step, index) => [
      `${index + 1}. ${step.description}`,
      `   - Ingredients: ${
        step.ingredients.map(renderIngredient).join("; ") || "none recorded"
      }`,
      `   - Tools: ${step.tools.map(renderTool).join("; ") || "none recorded"}`,
      `   - Stored prep time: ${
        step.prepSeconds == null
          ? "not recorded"
          : `${step.prepSeconds} seconds`
      }`,
      "",
    ]),
  ]

  await Deno.writeTextFile(
    join(outputDir, "recipe-instance.json"),
    `${JSON.stringify(instance, null, 2)}\n`,
  )
  await Deno.writeTextFile(
    join(outputDir, "recipe-readable.md"),
    `${lines.join("\n").trimEnd()}\n`,
  )
  await Deno.writeTextFile(
    join(outputDir, "plain-text-description.txt"),
    instance.plainTextDescription ?? "",
  )

  console.log(`Exported ${instance.id} to ${outputDir}`)
} finally {
  await db.$disconnect()
}
