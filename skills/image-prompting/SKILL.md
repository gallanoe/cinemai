---
name: image-prompting
description: Write prompts and pick parameters for CinemAI's generate_image tool, covering GPT Image 2 and Nano Banana 2. Use this whenever you are about to call generate_image — for a new image, an edit of an existing one, a variation, a style transfer, in-image text or an infographic — and whenever a generated image came back wrong and needs diagnosing. The two models want prompts written in genuinely different shapes, and several defaults on this server actively work against common edits, so consult this before writing the call rather than after the result disappoints.
---

# Image prompting for CinemAI

You are about to call `generate_image` on a server that posts to OpenRouter's raw image
endpoint. The quality of what comes back is almost entirely determined by two things: the
shape of the prompt, and a handful of parameters that behave differently per model. This
skill covers both.

## Read this first: nothing will improve your prompt for you

On ChatGPT and the Gemini app, a language model silently expands your prompt before the
image model ever sees it. Vague input gets elaborated into a real brief. **That layer does
not exist here.**

- GPT Image 2's "thinking mode" lives in OpenAI's *Responses* API. The Images API — what
  this server calls — has no reasoning parameter and returns no `revised_prompt`.
- Nano Banana 2's `thinking_level` is a Gemini API parameter that OpenRouter does not
  forward, so you always get its default (`minimal`).

Everything the chat surface would have added — lighting, lens, composition, materials,
framing — you have to write yourself. This is the single most common reason a prompt that
worked in ChatGPT produces a mediocre image here.

## Where to go next

| You are... | Do this |
|---|---|
| Generating a new image | Write the prompt in the model's dialect (below), then check the sizing knob |
| Editing an existing image | **Read the aspect-ratio trap below first** — the default will reshape the user's image |
| Iterating, varying, style-transferring, doing text or character work | `references/tasks.md` |
| Diagnosing a bad result | `references/troubleshooting.md` |
| Reaching for vocabulary — lens, lighting, colour, medium | `references/prompt-craft.md` |
| Working deeply with one model | `references/gpt-image-2.md` or `references/nano-banana-2.md` |

## The parameter surface

```
prompt  model  n  size  aspect_ratio  resolution  quality
background  output_format  output_compression  seed  input_references
```

Published guidance for these models routinely assumes capabilities this endpoint does not
carry. **Not available here:** mask/inpainting endpoints, `thinking_level`, Google Search
grounding, OpenAI's `moderation` knob, `input_fidelity`, and conversational multi-turn
editing. Substitutes are given where it matters.

Editing and iteration therefore work exactly one way: **pass the previous output back as
`input_references`.** Any prior handle works — `input_references: ["image://gen/<id>"]` —
as does an absolute local path or an `https://` URL.

`resolution` and `quality` are near-disjoint. Nano Banana 2 reports `resolution` and no
`quality`; GPT Image 2 reports `quality` and no `resolution`. Send the one its model
reports — unreported parameters skip validation and reach the provider, which may ignore or
reject them.

## Choosing a model

The server's default is `google/gemini-2.5-flash-image` — the *original* Nano Banana, which
accepts only 3 reference images and has no `resolution` parameter. If a call needs more
references, a resolution tier, or an extreme aspect ratio, name a model explicitly.

Evidence labels used throughout: **[OFFICIAL]** vendor docs, **[TESTED]** independent
hands-on, **[LOCAL]** measured against this server.

|  | `openai/gpt-image-2` | `google/gemini-3.1-flash-image` (Nano Banana 2) |
|---|---|---|
| Prompt dialect | Labeled blocks + constraints section | One narrative paragraph, positive framing |
| `n` | up to 10 | **1** — call repeatedly for variations |
| References | up to 16, all high-fidelity | up to 14 (4 characters + 10 objects at full fidelity) |
| Aspect | **3:1 ceiling** [OFFICIAL] | to 8:1 and 1:8 |
| Sizing knob | `quality` low/medium/high | `resolution` 512/1K/2K/4K |
| Cost | ~$0.006 low, ~$0.05 med, ~$0.21 high [LOCAL: $0.006 at low] | flat ~$0.045/1K, $0.067/2K, $0.101/4K [LOCAL: $0.0448 at 1K] |
| Transparency | none | none |

Two capability walls settle some briefs on their own: **nothing wider than 3:1 can come from
GPT Image 2**, and **`n > 1` cannot come from Nano Banana 2**.

Resist the widely repeated "GPT Image 2 for text, Nano Banana 2 for photorealism." The text
half holds; the realism half is contradicted by essentially every hands-on comparison, which
found Nano Banana 2 makes more *attractive* images and GPT Image 2 more *physically
plausible* ones [TESTED]. Choose on the hard constraints and on the brief, not the slogan.

**Neither model emits an alpha channel.** For a real cutout, `recraft/recraft-v4.1-vector`
does transparency and SVG natively; otherwise generate on a flat backdrop and key it out
downstream, which is OpenAI's own documented workaround [OFFICIAL].

## The two dialects

Both vendors document what they want, and they want different things. Writing in the wrong
dialect is not fatal but it measurably wastes the model's attention.

**GPT Image 2** — documented order is `scene → subject → details → constraints`, and naming
the *intended use* is part of the recommended structure, because it sets the genre and level
of polish [OFFICIAL]. Labeled segments are explicitly endorsed once constraints get dense.

```
Scene: Warm sunlit bathroom counter, honed travertine, soft morning light from camera-left.
Subject: A 50ml frosted-glass serum bottle with a matte brushed-brass cap, slightly left of centre.
Details: Three-quarter angle, eye level, 85mm lens, shallow depth of field, visible glass texture.
Use case: Hero image for a DTC skincare landing page.
Text: Render exactly once, upper-right third: "QUIET SKIN" in a thin, widely-letterspaced
      serif, warm charcoal. No other text.
Constraints: No extra text. No watermarks. No duplicate bottles.
      No additional elements beyond those listed.
```

**Nano Banana 2** — narrative prose opening with a strong verb that names the operation.
Google is explicit that *"a simple list of keywords won't cut it; you need to describe the
scene narratively"* [OFFICIAL].

```
Create a high-resolution, studio-lit commercial product photograph of a 50ml frosted-glass
serum bottle with a matte brushed-brass cap, standing on a honed travertine counter in warm
morning light. The lighting is soft window light from the left with a subtle bounce fill,
creating gentle diffused highlights along the glass and a long soft shadow to the right.
Shot at eye level in a three-quarter angle with an 85mm lens and shallow depth of field.
The label reads "QUIET SKIN" in a thin, widely-letterspaced warm-charcoal serif. The right
third of the frame is an open, uncluttered expanse of softly lit wall.
```

Notice what changed beyond formatting: the constraints block became positive description
("an open, uncluttered expanse" instead of "keep the right third empty"), and the
anti-over-elaboration clause vanished — GPT Image 2 needs it, Nano Banana 2 errs toward
minimal.

### Techniques that help one and hurt the other

| Technique | GPT Image 2 | Nano Banana 2 |
|---|---|---|
| Labeled blocks / JSON | Officially endorsed | Off-guideline but verified to work [TESTED] |
| Comma-separated tag soup | Tolerated | Documented anti-pattern |
| Explicit negations ("no cars") | Encouraged, appears in official examples | Officially discouraged — prefer "a deserted street". Still works in practice |
| "masterpiece, 8K, stunning" | Wasteful | **Actively harmful** — a leaked Gemini system prompt instructs the model to avoid these exact words [TESTED] |
| Anti-over-elaboration clause | **Needed** — it expands past the brief [TESTED] | Rarely needed |
| Explicit quantities | Usually respected | **Needed** — it over-applies ("use mirrors" → mirrors on mirrors) [TESTED] |
| Aspect ratio inside the prompt text | Pointless — it comes from the parameter | Harmless, and Google's own examples do it |
| Camera and lens vocabulary | Works, as register not physics [OFFICIAL] | Works, and is official best practice |

## Principles that hold for both

1. **Exclusions of an *operation* work everywhere** — "do not add new elements", "change
   only the sofa". Exclusions of scene *content* are where the models split, and the
   universal "never negate" advice is wrong here. OpenAI explicitly recommends literal
   exclusions ("no watermark", "no extra text") because GPT Image 2 has an
   instruction-following front end that parses them; Google prefers positive framing ("an
   empty, deserted plaza" over "no people"). The models that genuinely fail at negation are
   CLIP/T5-conditioned diffusion models, which neither of these is. When unsure, do both:
   describe the clean positive state *and* state the exclusion.
2. **Literal text goes in quotes**, with typography and placement as separate constraints,
   and brand names spelled letter-by-letter if they matter. Documented by both vendors.
3. **Materials beat adjectives.** Not "suit jacket" but "navy blue tweed". This is the fix
   for the generic stock-photo look, and it is the highest-yield edit to a weak prompt.
4. **Change one variable at a time from a short base.** Image models are not locally linear
   — change three things at once and you learn nothing about which mattered.
5. **Delete superlatives.** "Stunning, ultra-detailed, 8k, award-winning" carry almost no
   information on modern models and actively push toward the glossy AI look.
6. **Photorealism means suppressing polish.** Left alone both models render glossy. Name the
   anti-aesthetic — OpenAI's own example says *"No glamorization, no heavy retouching."*
7. **Verify what matters landed.** GPT Image 2 silently drops clauses from dense prompts;
   Nano Banana 2 falls back to lorem-ipsum placeholder text on dense infographics [TESTED].
   Use `view_image` when correctness genuinely matters — but only then, since it costs
   ~1.5k tokens and the user already sees the result in the widget.

## Three shape traps

These are the failures most likely to quietly damage someone's work, so they are worth
knowing before you write the call.

**1. Editing without setting a shape reshapes the user's image.** Nano Banana 2's documented
default is to inherit the input image's ratio [OFFICIAL] — but this server always sends an
explicit ratio, defaulting to `1:1`. So an edit of a 16:9 photo with no shape specified comes
back square. **On any edit, pin the source's shape explicitly.**

**2. On GPT Image 2, `aspect_ratio` does not pin anything — only `size` does.** That model
reports no `aspect_ratio` enum and silently clamps whatever you send to its own narrow shape
set. Measured twice: a `16:9` request returned **1536×1024** (3:2), and a `4:1` request also
returned **1536×1024** (1.5:1) — a near-square image for a letterbox brief, with no error
[LOCAL]. Nothing tells you this happened.

So on GPT Image 2, whenever the shape actually matters, **pass `size` in explicit pixels and
omit `aspect_ratio` and `resolution`** (they are rejected alongside it). This applies to
edits as much as to new work: an edit of a 2048×1152 hero should send
`size: "2048x1152"`, not `aspect_ratio: "16:9"`, or it comes back 3:2. Constraints on `size`:
both edges multiples of 16, long-to-short ratio at most 3:1, max edge ≤3840, total pixels
between 655,360 and 8,294,400.

Nano Banana 2 is the opposite — `aspect_ratio` is reliable there, spans 1:8 to 8:1, and is
the right lever.

**3. A ratio change is generative, not a crop.** Both models regenerate rather than
transform, so requesting a different shape invents new edge content rather than trimming.
To reframe deliberately, say so: `change aspect ratio to 21:9 by expanding background. The
subject remains exactly locked in its current position.` [OFFICIAL]

Related: resolution tiers normalize per-provider rather than being literal pixel counts —
Nano Banana 2 at `resolution: "512"` with `8:1` returned **1456×176** [LOCAL].

## A reasonable default workflow

Explore cheap, then commit. On GPT Image 2 that means `quality: "low"` with `n: 4` — four
candidates for roughly the price of one medium image. On Nano Banana 2, `resolution: "512"`
called a few times, since `n` is fixed at 1. Pick the direction that works, write the prompt
out properly in the model's dialect, and re-render at the higher tier.

Raise the tier when the image carries fine type, dense labels, close-up faces, or
identity-sensitive edits — those are the cases where the sizing knob changes *correctness*
rather than just polish. For a simple single-subject scene it is mostly cost and latency.
