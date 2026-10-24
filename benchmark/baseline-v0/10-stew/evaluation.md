# Evaluation — Pot Beef Stew / NLXYJZBR_HU

## Processing

Status: FAILED (no recipe stored)

The video was successfully downloaded and processed through frame extraction, partial visual description, audio extraction, and speech transcription.

During visual analysis, 3 of 13 frame-description batches failed because of OpenAI API token-per-minute rate limiting. The pipeline ignored those failed batches and continued with the remaining visual evidence.

Audio transcription completed successfully.

The terminal failure occurred during multimodal fusion ("Putting it all together"). The GPT-4.1 request exceeded the available tokens-per-minute limit:

Limit: 30,000 TPM
Requested: 67,926 tokens

After three attempts, the pipeline failed to generate the final video description.

As a result, structured recipe extraction was never reached and no RecipeInstance was stored.

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

There is no final stored recipe to assess for unsupported or invented information.

## Overall

Score: N/A

Usability: NO

## Main strengths

- The 671-second source video was successfully acquired and processed.
- Frame extraction completed.
- Most visual-analysis batches succeeded (10/13).
- The pipeline tolerated three failed visual batches and continued.
- Audio extraction and speech transcription completed successfully.
- Processing reached the multimodal fusion stage.

## Main problems

- 3 of 13 visual-description batches failed because of OpenAI API token-per-minute rate limiting, resulting in some visual evidence being lost.
- The accumulated transcript and visual evidence produced a fusion request that was far larger than the available GPT-4.1 TPM allowance.
- The final fusion request required 67,926 tokens against a 30,000 TPM limit.
- Because multimodal fusion failed, no final plain-text description was generated.
- Structured recipe extraction was never reached.
- No RecipeInstance was stored.

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

N/A — no final plain-text description was generated because the multimodal
fusion step failed before recipe extraction.

## Other observations

- Video duration: 671 seconds (~11 min 11 sec).
- Frames were sampled at approximately 0.253 fps.
- 3 of 13 frame-description batches failed because of API rate limiting.
- Audio transcription completed successfully.
- The terminal error occurred during "Putting it all together".
- GPT-4.1 TPM limit: 30,000.
- Requested tokens for the final fusion request: 67,926.
- The request failed after three attempts.
- This case demonstrates a clear scalability limitation in the baseline pipeline:
  evidence from a long video is accumulated into a single fusion request rather
  than being processed in bounded temporal chunks.
