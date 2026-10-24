# Evaluation — Chocolate Chip Cookies / jWZ-NQOu6gQ

## Processing

Status: SUCCESS

The pipeline successfully processed the video and stored a RecipeInstance.

RecipeInstance ID: 6aa406ee6d0b3ce1040d06d4

## Ingredients — 2/2

Notes:

The final recipe captures all of the base ingredients communicated by the video:

- Unsalted butter
- Light brown sugar
- Granulated sugar
- Egg
- Vanilla
- Plain flour
- Bicarbonate of soda
- Salt
- Chocolate chips

However, Cookie Dough is also represented as a top-level ingredient even though it is an intermediate food state produced from the preceding ingredients rather than a new ingredient.

This is a representation problem, but the actual base-ingredient coverage is otherwise complete.

## Quantities — 1/2

Notes:

Several explicit quantities are captured correctly:

- Unsalted butter: 110 g
- Light brown sugar: 150 g
- Granulated sugar: 115 g
- Egg: 1
- Vanilla: 1 tsp

The structured step also preserves the instruction to scoop approximately one tablespoon of dough.

However, several quantities explicitly communicated by the video are missing:

- Plain flour: 200 g
- Bicarbonate of soda: 1/2 tsp
- Salt: 1/2 tsp
- Chocolate chips: 200 g
- Dough portion: 15 g is not preserved, although the approximate one-tablespoon equivalent is retained

Plain flour is explicitly quantified as 200 g in the reference, but its quantity is missing from the extracted steps and incorrectly stored as 0 in the top-level ingredient list.

A further problem occurs during post-processing: ingredients whose step-level quantities are null become top-level quantities of 0. As a result, plain flour, bicarbonate of soda, salt, and chocolate chips appear as 0 in the stored ingredient list rather than as quantities not recorded.

The quantity extraction is therefore partially successful but incomplete and misleading in the final stored representation.

## Steps / actions — 2/2

Notes:

The recipe captures nearly all of the major preparation actions:

- Combine melted butter with the two sugars and whisk.
- Add the egg and vanilla and whisk again.
- Add the dry ingredients and fold them into the wet ingredients.
- Fold in the chocolate chips.
- Scoop and shape portions of dough.
- Place the dough balls onto a cookie sheet.
- Bake at the stated temperature and time.

The final instruction to let the cookies cool slightly before serving is omitted. The first structured step also says to melt the butter rather than simply add already-melted butter. These are minor differences that do not materially alter the recipe.

The main preparation actions are covered, so the full steps/actions score remains appropriate.

## Ordering — 2/2

Notes:

The major actions appear in the correct sequence:

1. Wet ingredients are combined.

2. Egg and vanilla are added.

3. Dry ingredients are incorporated.

4. Chocolate chips are folded in.

5. The dough is portioned and shaped.

6. The dough balls are placed on the tray.

7. The cookies are baked.

No major ordering errors are present.

## Tools / techniques / timings — 1/2

Notes:

Several tools are represented correctly:

- Mixing bowl
- Whisk
- Spatula
- Cookie sheet

The baking temperature and time are also captured accurately:

- 190°C / 170°C fan
- 5–6 minutes

However, the tool representation contains several inaccuracies:

- A cookie sheet is associated with the first wet-ingredient mixing step even though it is not used there.
- The recipe assigns a whisk to the dry-ingredient folding step, while the video visibly switches to a rubber spatula for folding.
- A wooden spoon is assigned to the dough-portioning step even though it is not supported by the reference.
- The video advertises "10 minute" cookies, but `totalPrepSeconds` is not recorded. The explicitly communicated 5–6 minute bake is nevertheless preserved in the instructions.

The main baking temperature and duration are correct. The deduction primarily reflects inaccurate tool-to-action associations, especially using a whisk where the video demonstrates a spatula.

## Unsupported information — 1/2

Notes:

The recipe contains some unsupported or incorrect information, although substantially less than the Carbonara case.

Examples include:

- The instructions say to melt the butter, although the video starts with already-melted butter; this is a minor, functionally harmless addition.
- The dry ingredients are said to be combined "in a separate bowl", which the reference does not establish.
- A wooden spoon is assigned to dough portioning, and the cookie sheet is incorrectly assigned to initial mixing.
- Cookie dough is recorded as a top-level ingredient despite being an intermediate state.
- Unknown quantities are materialized as top-level `0` values, which misleadingly suggests zero flour, bicarbonate of soda, salt, and chocolate chips. This is a storage/representation error, not evidence that the extraction model explicitly invented a zero quantity.

Most procedural instructions are supported, so these problems warrant a partial rather than total deduction for unsupported or incorrect information.

## Overall

Score: 9/12

Usability: PARTIALLY

The recipe captures the overall procedure, ingredient set, ordering, and baking instructions well.

However, four explicitly communicated ingredient quantities are missing: 200 g plain flour, 1/2 tsp bicarbonate of soda, 1/2 tsp salt, and 200 g chocolate chips. The top-level ingredient list also converts missing quantities to misleading `0` values and treats cookie dough as a separate ingredient.

The recipe is useful for understanding the preparation process, but its ingredient quantities should not be treated as fully reliable.

## Main strengths

- All base ingredients communicated by the video are identified.
- The five quantities for butter, sugars, egg, and vanilla are captured accurately.
- The main sequence of preparation is reproduced correctly.
- The baking temperature and 5–6 minute baking time are preserved accurately.
- The one-tablespoon dough portion is retained in the structured step description.
- The recipe correctly captures important techniques such as whisking the wet ingredients and folding the chocolate chips into the dough.
- The final recipe remains substantially faithful to the source compared with several other baseline cases.

## Main problems

- Explicit quantities for plain flour (200 g), bicarbonate of soda (1/2 tsp), salt (1/2 tsp), and chocolate chips (200 g) are lost.
- The 15 g dough-portion quantity is lost, although the approximate one-tablespoon instruction survives.
- Missing step-level quantities become misleading top-level 0 values.
- Cookie Dough is represented as a separate ingredient rather than an intermediate food state.
- The first step says to melt the butter rather than simply use it already melted (minor procedural difference).
- The recipe describes the dry ingredients as being combined in a separate bowl without clear source support.
- Tool assignments are inaccurate in several steps.
- The visually important switch from whisk to rubber spatula is not preserved correctly.
- The final cooling instruction is omitted (minor).

## Likely error origin

- [x] Visual perception
- [ ] Speech transcription
- [ ] Captions / on-screen text
- [x] Multimodal fusion
- [x] Recipe extraction
- [ ] Entity resolution
- [x] Post-processing / storage
- [ ] Unknown

The reference shows that the video relies heavily on on-screen text for quantities. Four quantities explicitly communicated by the source — 200 g plain flour, 1/2 tsp bicarbonate of soda, 1/2 tsp salt, and 200 g chocolate chips — are absent from the plain-text description. The description even suggests that the flour and bicarbonate-of-soda measurements are not available.

Without the intermediate frame-description outputs, it is not possible to determine precisely whether those quantities were missed during visual analysis or were detected and then discarded during multimodal fusion. The loss therefore appears to originate somewhere in the visual-perception/fusion portion of the pipeline.

The recipe extraction stage introduces additional issues: it treats Cookie Dough as a base ingredient, changes already-melted butter into a melting instruction, adds an unverified separate-bowl instruction, and assigns some tools incorrectly. The butter and bowl details are minor; the ingredient-state representation and tool associations are more relevant structurally.

The post-processing/storage stage then converts null ingredient quantities into top-level values of 0, producing misleading entries for plain flour, bicarbonate of soda, salt, and chocolate chips.

## Comparison with plain-text description

The plain-text description captures the overall cookie-making process very well.

It correctly preserves:

- 110 g melted unsalted butter
- 150 g light brown sugar
- 115 g granulated sugar
- 1 large egg
- 1 tsp vanilla
- The overall wet-ingredient mixing process
- The addition of flour, bicarbonate of soda, and salt
- Folding in the chocolate chips
- Approximately one tablespoon of dough per cookie
- Baking at 190°C / 170°C fan
- Baking for 5–6 minutes

However, the plain-text description has already lost several quantities explicitly communicated in the video.

In particular, the description claims that bicarbonate of soda is "not measured on-screen" and suggests that the flour and baking-soda quantities are missing. According to the revised reference, the video explicitly communicates 200 g plain flour and 1/2 tsp bicarbonate of soda. The description also fails to preserve 1/2 tsp salt and 200 g chocolate chips.

This means these quantity errors occurred before structured recipe extraction.

The structured RecipeInstance preserves the quantities that survived into the plain-text description, but introduces several new problems:

- Unknown step-level quantities become top-level `0` values during materialization.
- Cookie dough becomes an ingredient.
- Already-melted butter becomes an instruction to melt butter (minor practical consequence).
- Tool assignments become less faithful to the video.

The comparison therefore shows two different failure stages: some on-screen information is lost during video understanding/fusion, while additional structural problems are introduced during recipe extraction and materialization.

## Other observations

- Model confidence was stored as 0.95 despite missing several explicit on-screen quantities and containing structural inaccuracies.
- The 0 quantities clearly demonstrate the current aggregation/materialization behavior for ingredients whose extracted quantity is null.
- Cookie Dough is a particularly clear example of an intermediate food state being represented as a base ingredient.
- Step 1 contains plain flour, bicarbonate of soda, salt, and chocolate chips in its ingredient list even though its description only concerns the wet ingredients. This suggests weak alignment between ingredients and the individual actions in the current structured representation.
- The plain-text description is generally strong procedurally but misses four on-screen quantities, including the 200 g flour measurement; it also incorrectly characterizes some measurements as unavailable.
- This case demonstrates why retaining provenance is useful: if the original on-screen text evidence had remained available, the later pipeline could potentially recover the missing quantities rather than depending entirely on the prose summary.
