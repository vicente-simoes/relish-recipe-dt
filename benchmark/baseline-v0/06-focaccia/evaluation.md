# Evaluation — Focaccia / -DmVedGWAnU

Compare the stored recipe instance with this video's `reference.md`. Score each area 0 = missing/wrong, 1 = partly correct, 2 = correct. Cite concrete examples in Notes. Use N/A for Quantities only when the reference has no explicit ingredient amounts; score invented amounts under Unsupported information.

## Processing

Status: FAILED (no recipe stored)

The video was downloaded and processed through frame extraction and audio transcription. Visual analysis partially succeeded, with 2 of 12 frame-description batches failing.

The pipeline then failed during multimodal fusion ("Putting it all together"). The GPT-4.1 request exceeded the available tokens-per-minute limit: 30,000 TPM available, 44,511 tokens requested.

As a result, no final plain-text video description was generated, recipe extraction was not reached, and no RecipeInstance was stored.

## Ingredients — N/A

Notes: 

No RecipeInstance was produced, so ingredient accuracy cannot be evaluated against the reference.

## Quantities — N/A

Notes:

No RecipeInstance was produced, so quantity accuracy cannot be evaluated.

## Steps / actions — N/A

Notes:

No structured recipe was produced.

## Ordering — N/A

Notes:

No structured recipe was produced.

## Tools / techniques / timings — N/A

Notes:

No structured recipe was produced.

## Unsupported information — N/A

Notes: 

There is no final recipe output to assess for unsupported or invented information.

## Overall

Score: N/A

Usability: NO

No usable recipe was returned by the pipeline.

## Main strengths

- Media acquisition and preprocessing succeeded.
- The full 521-second video duration was detected and frames were extracted.
- Most visual-analysis batches succeeded (10/12).
- Audio extraction and transcription completed before the terminal failure.

## Main problems

- The pipeline could not handle the amount of accumulated evidence from the longer video in the final fusion step.
- The final GPT-4.1 multimodal-fusion request was too large for the available TPM limit, so no plain-text description or structured recipe was produced.
- Two visual-description batches also failed earlier because of API rate limiting.

## Likely error origin

- [ ] Visual perception
- [ ] Speech transcription
- [ ] Captions / on-screen text
- [x] Multimodal fusion
- [ ] Recipe extraction
- [ ] Entity resolution
- [ ] Post-processing / storage
- [ ] Unknown

## Comparison with plain-text description

N/A — no final plain-text description was generated because the multimodal fusion step failed before recipe extraction.

## Other observations

- Video duration: 521 seconds (~8 min 41 sec).
- Frames were sampled at approximately 0.317 fps.
- 2 of 12 visual-description batches failed, but the pipeline continued.
- The terminal error occurred during "Putting it all together".
- This case demonstrates a baseline scalability/robustness limitation for longer videos: accumulated transcript and visual evidence can exceed the capacity available to a single fusion request.
