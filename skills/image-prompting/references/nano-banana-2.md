# Nano Banana 2 (`google/gemini-3.1-flash-image`)

Sources are the Gemini API image-generation guide, Google Cloud's March 2026 prompting
guide, the DeepMind model pages, Vertex docs and the Gemini cookbook. **[OFFICIAL]** means
from those; **[TESTED]** independent hands-on; **[LOCAL]** measured against this server.

## The core philosophy

Google is unusually direct about this [OFFICIAL]:

> When starting with a blank canvas, you are the director. **A simple list of keywords
> won't cut it; you need to describe the scene narratively.**

and

> To elevate your results from good to breathtaking, you need to **stop typing keywords and
> start directing the scene.**

New in the Gemini 3 era: **start the prompt with a strong verb** naming the operation —
Create, Generate, Transform, Edit, Remove, Localize. On Vertex this is more than style
advice: an ambiguous prompt can return *text instead of an image*, and "create an image of"
is the documented fix [OFFICIAL].

The two official formulas:

```
Text-to-image:   [Subject] + [Action] + [Location/context] + [Composition] + [Style]
With references: [Reference images] + [Relationship instruction] + [New scenario]
```

Best practices, verbatim [OFFICIAL]: be hyper-specific ("Instead of 'fantasy armor,'
describe it: 'ornate elven plate armor, etched with silver leaf patterns…'"); provide
context and intent; iterate in small changes; use step-by-step instructions for complex
scenes; use **semantic negative prompts** ("an empty, deserted street" rather than "no
cars"); control the camera with photographic language.

## The seven generation templates

All verbatim [OFFICIAL].

**Photorealistic scenes**
```
A photorealistic [type of shot] of a [subject description] in a [setting description].
[Description of the light]. Shot from a [camera angle] with a [lens type].
```

**Stylized illustrations & stickers**
```
A [style] of a [subject, with details about accessories or actions] doing [activity].
The design features [visual qualities, e.g., bold outlines, cel-shading, etc.] and
[color/background preference].
```

**Accurate text in images**
```
Create a [image type] for [brand/concept] with the text "[text to render]" in a [font
style]. The design should be [style description], with a [color scheme].
```

**Product mockups & commercial photography**
```
A high-resolution, studio-lit product photograph of a [product description] on a
[background surface/description]. The lighting is a [lighting setup, e.g., three-point
softbox setup] to [lighting purpose]. The camera angle is a [angle type] to showcase
[specific feature]. Ultra-realistic, with sharp focus on [key detail]. [Aspect ratio].
```

**Minimalist & negative space design** — for backgrounds that will carry overlaid type
```
A minimalist composition featuring a single [subject] positioned in the [bottom-right/
top-left/etc.] of the frame. The background is a vast, empty [color] canvas, creating
significant negative space. Soft, subtle lighting. [Aspect ratio].
```

**Sequential art**
```
Make a [N] panel comic in a [style]. Put the character in a [type of scene].
```

**Character turnaround**
```
A studio portrait of [person] against [background], [looking forward/in profile looking
right/etc.]
```

## The seven editing templates

All verbatim [OFFICIAL].

**Add / remove / modify** — "the model will match the original image's style, lighting, and
perspective"
```
Using the provided image of [subject], please [add/remove/modify] [element] to/from the
scene. Ensure the change is [description of how the change should integrate].
```

**Inpainting (semantic masking)** — the canonical preservation phrasing
```
Using the provided image, change only the [specific element] to [new element/description].
Keep everything else in the image exactly the same, preserving the original style, lighting,
and composition.
```

**Style transfer, composition preserved**
```
Transform the provided photograph of [subject] into the artistic style of [artist/art
style]. Preserve the original composition but render it with [description of stylistic
elements].
```

**Multi-image fusion**
```
Create a new image by combining the elements from the provided images. Take the [element
from image 1] and place it with/on the [element from image 2]. The final image should be a
[description of the final scene].
```

**High-fidelity detail preservation**
```
Using the provided images, place [element from image 2] onto [element from image 1]. Ensure
that the features of [element from image 1] remain completely unchanged. The added element
should [description of how the element should integrate].
```

**Sketch → finished render**
```
Turn this rough [medium] sketch of a [subject] into a [style description] photo. Keep the
[specific features] from the sketch but add [new details/materials].
```

**Reframe without moving the subject**
```
change aspect ratio to [X:Y] by [expanding/reducing] background. The character, remains
exactly locked in its current position.
```

Note the explicit expanding-vs-reducing control. There is also a documented upscale idiom:
`Zoom in on this image, maintaining a [X:Y] aspect ratio`.

## Consistency clauses that work

Google's own showcase prompts are blunter than its prose guidance, and these are the exact
phrasings it ships [OFFICIAL]:

```
It is strictly important to keep identity consistent of all the [N] characters and items.
Keep the attire and identity consistent of all [N] characters, but their expressions and
  angles should vary throughout all [N] images.
Make sure to only have one of each character in each image.
You must create [N] separate images and not a single composite image.
Focus on the items and ignore their backgrounds.
```

That third line matters more than it looks — the model over-applies instructions and will
happily duplicate a subject. The last one is the documented way to strip context from a
reference image.

For turnarounds: "include previously generated images in subsequent prompts to maintain
consistency" [OFFICIAL]. Through this server that means passing prior handles in
`input_references`.

## Text rendering

Google's four rules [OFFICIAL]:

- **Use quotes** around the desired words.
- **Choose a font** — describe the typography or name it ("a bold, white, sans-serif font",
  "Century Gothic 12px font").
- **Translate and localize** — write the prompt in one language, specify a target for the
  rendered text.
- **Text-first** — "Gemini Image models work best if you first converse with it to generate
  the text concepts, and then ask for an image with that text."

The multi-line styled form, verbatim:

> Next to the product, render three lines of text with the following exact styling: For the
> top line, the word 'GLOW' in a flowing, elegant Brush Script font. For the middle line,
> the text '10% OFF' in a heavy, blocky Impact font. For the bottom line, the text 'Your
> First Order' in a thin, minimalist Century Gothic font.

Localization is a separate turn, not a rewrite: `Update this infographic to be in Spanish.
Do not change any other elements of the image.` Supported languages are EN plus ar-EG,
de-DE, es-MX, fr-FR, hi-IN, id-ID, it-IT, ja-JP, ko-KR, pt-BR, ru-RU, ua-UA, vi-VN, zh-CN.

Practical ceilings [TESTED]: small type at 1K goes soft — use 2K or higher for anything
with fine type; past three to five separate text elements accuracy slips. And **always
inspect infographic output for lorem-ipsum placeholder text**, which is a silent failure
mode.

## Parameters

| Parameter | Values | Notes |
|---|---|---|
| `resolution` | 512 / 1K / 2K / 4K | Every tier is a native generation, not an upscale [OFFICIAL]. Flat pricing: ~$0.045 / $0.067 / $0.101 / $0.151 |
| `aspect_ratio` | 14 values incl. **1:4, 4:1, 1:8, 8:1** | The extreme ratios are NB2-only — Nano Banana Pro has none of them |
| `n` | **1** | Fixed. Call repeatedly for variations |
| `input_references` | up to 14 | High fidelity for 4 characters + 10 objects; extras parse at "minor changes" fidelity [OFFICIAL] |
| `quality` | not supported | Use `resolution` |
| `background` | not supported | No alpha channel |

Token cost is flat across aspect ratios — it depends only on the resolution tier. That
makes an 8:1 banner exactly as cheap as a square at the same tier.

Resolution tiers normalize per-provider rather than being literal pixel counts:
`resolution: "512"` with `aspect_ratio: "8:1"` returned **1456×176** [LOCAL].

**Not reachable through this server:** `thinking_level` (defaults to `minimal`; raising it
is the documented fix for layout-heavy work, and you cannot), Google Search and Image
Search grounding, video-to-image, and multi-turn `previous_interaction_id`. Substitute
`input_references` for the last of these; for the others, compensate by writing a more
explicit prompt.

Suggested tier policy: **512** for ideation and anything you will re-render — never for
text-bearing assets; **1K** default; **2K** the floor for fine type, labels, infographics
or packaging copy; **4K** for finals only.

## Quirks and failure modes

**Aspect ratio defaults to the input image's ratio** when references are present, otherwise
1:1 [OFFICIAL]. This server always sends an explicit ratio, so when editing you must pass
the source's ratio or the edit gets reshaped. Ratio changes are generative reframing, not
crops — the model invents new edge content.

**It over-applies literal instructions** [TESTED]: "use mirrors" produced *mirrors on
mirrors*; a request for one white paw produced two. Specify exact quantities.

**Mode confusion is a documented trap** [TESTED]: editing-style language in a generation
call ("make the same image but with a red car") produces a brand-new image ignoring your
reference. Pass the reference and use the inpainting template.

**It may return text instead of an image** on ambiguous prompts, or render your narration
*into* the picture [OFFICIAL]. Say "create an image of" explicitly.

**Negatives.** Officially discouraged in favour of semantic negatives — but Google's own
showcase prompts use literal negatives freely (`No text.`, `Do not show any UI from design
software.`). Read the rule as: don't rely on negatives to *shape a scene*; do use them as
scoping clauses.

**Other reported issues** [TESTED]: tends oversaturated; genre drift on loosely specified
briefs; poor fidelity to user-supplied reference faces (distinct from its consistency across
its own generations); once reproduced a stock-service watermark, which is a real IP concern
in commercial work. DeepMind's own acknowledged limits: imperfect small faces and spelling,
factual accuracy on data-driven output, localization grammar, artifacts on complex edits.

**All output carries a SynthID watermark**, invisible and embedded in pixel frequency
values, plus C2PA content credentials [OFFICIAL]. Note that OpenAI now embeds SynthID too,
so this is no longer a differentiator.

**Policy** appears more restrictive than OpenAI's on real people, and reportedly operates on
image *inputs* as well as prompt text — uploading a photo of a public figure for editing is
blocked. There is no moderation escape hatch. Sourcing here is weak; verify empirically.

## Sibling models

- `google/gemini-3-pro-image` (Nano Banana Pro) — 1K/2K/4K, 14 refs including **3 style
  reference slots** which NB2 lacks. Roughly 2× the price. Worth knowing that it is not
  simply better: it scores *below* NB2 on both public arenas [TESTED].
- `google/gemini-3.1-flash-lite-image` — 1K only, fastest and cheapest, not optimized for
  multi-reference work.
- `google/gemini-2.5-flash-image` — the original Nano Banana and **this server's current
  default**. Only 3 references, no `resolution` parameter, and no extreme aspect ratios. If
  a call needs any of those, name a model explicitly.
