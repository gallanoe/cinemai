# GPT Image 2 (`openai/gpt-image-2`)

Sources are OpenAI's cookbook prompting guide, the image-generation API guide, and the
ChatGPT Images 2.0 system card. **[OFFICIAL]** means from those; **[TESTED]** independent
hands-on; **[LOCAL]** measured against this server.

## What the model expects

The one ordering OpenAI publishes, verbatim [OFFICIAL]:

> Write prompts in a consistent order (background/scene → subject → key details →
> constraints) and include the intended use (ad, UI mock, infographic) to set the "mode"
> and level of polish. For complex requests, use short labeled segments or line breaks
> instead of one long paragraph.

Two things there are load-bearing and widely mis-stated. The order is **scene-first**, not
subject-first — several popular third-party formulas teach the opposite. And **naming the
deliverable is part of the structure**, not a nicety: "ad", "UI mockup", "infographic",
"pitch-deck slide" each pull a different set of genre conventions.

Format is explicitly agnostic [OFFICIAL]: paragraphs, JSON-like structures,
instruction-style and tag-based prompts "can all work well as long as the intent and
constraints are clear," with maintainability as the stated tiebreaker and a deliberate
steer against "clever prompt syntax." OpenAI's own examples show the practical bias: free
text for simple asks, headed sections (`Scene:` / `Mood:` / `Style:` / `Constraints:`) once
you have three or more categories of constraint.

## Fundamentals worth quoting

- **Specificity.** Be concrete about materials, shapes, textures and medium. Add targeted
  quality levers (*film grain*, *textured brushstrokes*, *macro detail*) only when needed.
- **Photorealism.** Include the literal word "photorealistic" to "strongly engage the
  model's photorealistic mode." Camera specs "may be interpreted loosely, so use them
  mainly for high-level look and composition rather than exact physical simulation."
- **Composition.** Specify framing, viewpoint, angle, lighting. "If layout matters, call
  out placement (e.g. 'logo top-right,' 'subject centered with negative space on left')."
- **People.** Describe scale, body framing, gaze and object interactions — "full body
  visible, feet included," "looking down at the open book, not at the camera," "hands
  naturally gripping the handlebars."
- **Constraints.** State exclusions and invariants explicitly. For edits use "change only
  X" + "keep everything else the same," and **repeat the preserve list on each iteration**.
- **Multi-image.** Reference each input **by index and description** — "Image 1: product
  photo… Image 2: style reference" — and describe how they interact.
- **Iterate.** "Start with a clean base prompt and refine with small, single-change
  follow-ups."

These were derived from alpha-testing patterns rather than being aspirational [OFFICIAL].

## Behaviour that changes how you prompt

**No prompt rewriting on this path.** Thinking mode is an orchestration layer in the
*Responses* API, where a mainline model rewrites your prompt first. The Images API — what
this server calls — has no reasoning parameter and returns no `revised_prompt`. What you
write is what gets rendered.

**It does interpret world knowledge.** Naming a real place and date pulls period-correct
detail without enumeration; OpenAI's worked example is "Bethel, New York on August 16,
1969" producing Woodstock [OFFICIAL]. Exploit this: under-specify creative texture on
purpose, over-specify constraints.

**Negation is ordinary instruction here.** There is no negative-prompt field, but exclusions
inline are recommended and appear throughout official examples — `No watermark.`, `No
glamorization, no heavy retouching.`, `Do not add new elements or text.` Nothing in the docs
warns that negation backfires. The pattern in every official example pairs a negative with a
positive: `Do not restyle the product; only remove background and lightly polish.`

**Composition placement is an admitted weakness** [OFFICIAL]: "the model may have difficulty
placing elements precisely in structured or layout-sensitive compositions." Prefer explicit
region language ("left third", "bottom-right corner") over relational prepositions, and
verify.

**It over-elaborates and silently drops clauses.** Independent testing found it expanding a
hero-section brief into a full landing page, and dropping individual requirements from dense
prompts [TESTED]. Two mitigations: add `No additional elements beyond those listed.`, and
check each requirement actually landed. Practitioners put the drop threshold around eight
hard constraints.

## Parameters

| Parameter | Values | Notes |
|---|---|---|
| `quality` | auto / low / medium / high | The main fidelity knob. `low` is genuinely usable on this model [OFFICIAL] and costs ~$0.006 [LOCAL] |
| `size` | explicit pixels | Max edge ≤3840, both edges multiples of 16, **ratio ≤3:1**, total pixels 655,360–8,294,400 |
| `aspect_ratio` | not reported in its descriptor | Accepted anyway, and clamped: a `16:9` request returned **1536×1024** (3:2) [LOCAL] |
| `background` | auto / opaque | **`transparent` is rejected** — a regression from gpt-image-1.5 |
| `output_format` | png / jpeg / webp | |
| `output_compression` | 0–100 | jpeg/webp only, ignored for png |
| `n` | 1–10 | The cheapest way to explore a design space — vary `n`, not the prompt |
| `resolution` | not supported | Use `quality` and `size` instead |

`quality` changes *correctness*, not just polish, for: small or dense text, infographics
with labels, close-up portraits, identity-sensitive edits, high-resolution output, and
multi-font layouts. For simple single-subject scenes it is mostly cost and latency
[OFFICIAL]. OpenAI's own examples run `medium` for 13 of 16, reserving `high` for the two
dense-text pieces.

Above 2560×1440 is officially "experimental" — results get more variable. `input_fidelity`
is not settable; every image input is processed at high fidelity automatically, which also
raises input token cost on reference-heavy edits [OFFICIAL].

## Verbatim official templates

**Photorealism** — note the anti-polish clause doing the real work:

```
Create a photorealistic candid photograph of an elderly sailor standing on a small fishing
boat. He has weathered skin with visible wrinkles, pores, and sun texture, and a few faded
traditional sailor tattoos on his arms. He is calmly adjusting a net while his dog sits
nearby on the deck. Shot like a 35mm film photograph, medium close-up at eye level, using a
50mm lens. Soft coastal daylight, shallow depth of field, subtle film grain, natural color
balance. The image should feel honest and unposed, with real skin texture, worn materials,
and everyday detail. No glamorization, no heavy retouching.
```

Reusable skeleton:

```
Create a photorealistic candid photograph of [SUBJECT] [ACTION] in [SETTING].
[Physical texture details: skin, wear, materials, imperfections].
Shot like a [35mm film / iPhone] photograph, [framing] at [eye-level/low-angle], using a
[50mm] lens. [Light source and quality], shallow depth of field, subtle film grain,
natural color balance.
The image should feel honest and unposed, with real texture and everyday detail.
No glamorization, no heavy retouching.
```

**Identity-preserving edit** — the canonical identity lock:

```
Edit the image to dress the woman using the provided clothing images. Do not change her
face, facial features, skin tone, body shape, pose, or identity in any way. Preserve her
exact likeness, expression, hairstyle, and proportions. Replace only the clothing, fitting
the garments naturally to her existing pose and body geometry with realistic fabric
behavior. Match lighting, shadows, and color temperature to the original photo so the
outfit integrates photorealistically, without looking pasted on. Do not change the
background, camera angle, framing, or image quality, and do not add accessories, text,
logos, or watermarks.
```

Its anatomy, reusable as a checklist: the change stated first; an **enumerated** identity
lock (enumeration matters more than the word "identity"); a scope restriction; physical
plausibility; light and colour integration; a frame lock; additive suppression.

**Text lock:**

```
Billboard text (EXACT, verbatim, no extra characters):
"Fresh and clean"
Typography: bold sans-serif, high contrast, centered, clean kerning.
Ensure text appears once and is perfectly legible.
No watermarks, no logos.
```

**Style transfer** — remarkably terse, because the reference image is doing the work:

```
Use the same style from the input image and generate a man riding a motorcycle on a white
background.
```

**Product extraction** (the transparency workaround):

```
Extract the product from the input image and place it on a plain white opaque background.
Output: centered product, crisp silhouette, no halos/fringing.
Preserve product geometry and label legibility exactly.
Add only light polishing and a subtle realistic contact shadow.
Do not restyle the product; only remove background and lightly polish.
```

**Logo** — note the opening policy phrasing:

```
Create an original, non-infringing logo for a company called Field & Flour, a local bakery.
The logo should feel warm, simple, and timeless. Use clean, vector-like shapes, a strong
silhouette, and balanced negative space. Favor simplicity over detail so it reads clearly at
small and large sizes. Flat design, minimal strokes, no gradients unless essential. Plain
background. Deliver a single centered logo with generous padding. No watermark.
```

**Labelled diagram** (`quality: "high"`):

```
Create a simple biology diagram titled "Cellular Respiration at a Glance" for high school
students. Show how glucose turns into energy inside a cell. Include glycolysis, the Krebs
cycle, and the electron transport chain. Use arrows to connect the steps, and label the main
molecules: glucose, pyruvate, ATP, NADH, FADH2, CO2, O2, and H2O. Make it look like a clean
classroom handout or slide, with a white background, simple icons, clear labels, and
easy-to-read text.

Avoid tiny text, extra decoration, or anything that makes the diagram hard to understand.
```

**Sketch → render:**

```
Turn this drawing into a photorealistic image.
Preserve the exact layout, proportions, and perspective.
Choose realistic materials and lighting consistent with the sketch intent.
Do not add new elements or text.
```

**Headed-section scaffold for complex asks:**

```
Create a [DELIVERABLE].

Scene:
[what is depicted]

Mood:
[emotional register]

Style:
[medium], [lighting], [texture], [depth of field], [finish quality]

Constraints:
- Original artwork only
- No trademarks
- No watermarks
- No logos

Include ONLY this text (verbatim):
"[EXACT COPY]"
```

## Policy

Filtering runs on prompts **and** on generated images, and on reference images you supply
for editing — all three are screened independently [OFFICIAL]. Because output filtering is
applied to what the model happened to render, **refusals are nondeterministic and worth one
retry** before rewriting.

OpenAI's own legitimate phrasing, from shipped examples: `Create an original, non-infringing
logo…`, and constraint blocks reading `Original artwork only / No trademarks / No watermarks
/ No logos / Original character (no copyrighted characters)`. Describe people by attributes
— age, build, hair, clothing, expression — never by name. Decompose a style into visual
facts rather than naming its author.

The `moderation` parameter (`auto` / `low`) exists on OpenAI's API but is **not exposed
through this server**.

## Known open questions

- Text-accuracy percentages circulating as "~95%" are third-party marketing; no official
  figure exists.
- The yellow/sepia cast of earlier models is reported fixed by community consensus, not by
  an official claim.
- OpenAI's docs disagree on max edge (`<3840` vs `≤3840`). Use `3824x2144` as a safe 4K-ish
  fallback if `3840x2160` errors.
