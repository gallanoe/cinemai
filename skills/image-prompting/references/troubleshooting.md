# Failure → fix

Diagnose from the symptom. Most of these are prompt fixes; a few are parameter fixes.

## Image quality

**Muddy, washed out, low contrast.** No lighting direction specified, so the model defaulted
to flat ambient. Add a *directional* light with quality and temperature — "hard low sun from
camera left, deep shadows to the right, warm 3000K key against cool ambient" — plus a tonal
instruction: "high contrast, crushed blacks, specular highlights." Lighting is the
highest-leverage single edit.

**Generic stock-photo look.** Generic nouns and non-committal adjectives. Replace every
generic noun with a specific one and every mood adjective with a concrete fact. "A
businessman" → "a man in his 50s in a rumpled navy tweed jacket, tie loosened, reading
glasses pushed up." Add a specific place, a time, and one incidental detail.

**Over-saturated glossy "AI look", plastic skin.** Default aesthetic priors, amplified by
quality-cue words. Three moves: delete every superlative ("stunning", "hyper-detailed",
"8k"); add physical imperfection ("visible skin pores, fine lines, flyaway hairs, slight
fabric wear"); and explicitly suppress polish — OpenAI's own phrasing is *"No glamorization,
no heavy retouching"* and *"not an overly enhanced or cinematic movie-poster image."* Cap
saturation directly: "muted, desaturated palette."

Nano Banana 2 in particular tends oversaturated, so this fix is load-bearing there.

**Flat, depthless.** No depth cues. Add explicit layering: "a blurred foliage branch in the
near foreground, the subject in the midground, a hazy ridge line in the far background."
Atmospheric perspective and a shallow-DoF cue reinforce it.

**Wrong mood despite the right words.** Mood adjectives are weak; mood comes from light and
colour. Delete the adjective and specify what produces it — "melancholy" becomes "overcast
diffused light, desaturated blue-grey palette, low contrast, rain on the window."

## Content and layout

**Wrong object count.** Numerals are weak conditioning. Enumerate positionally instead —
"three apples: one on the left edge, one centred, one on the right" — or give each instance
a distinguishing attribute. Keep counts at five or under; beyond that describe an
arrangement ("a row of apples") rather than a number.

On Nano Banana 2 this is more acute: it over-applies literal instructions ("use mirrors"
produced *mirrors on mirrors*). State exact quantities: "exactly one mirror."

**Ignored spatial relations.** "Left of", "behind", "on top of" bind unreliably. Convert the
relation into a composition instruction: "a cat occupies the left third of the frame; a dog
occupies the right third; the cat is nearer the camera and partially overlaps the dog."
Naming frame regions and depth layers is far more reliable than relational prepositions.
GPT Image 2 lists precise placement in structured layouts as an admitted limitation.

**Subject too small.** Shot size unstated, and environment description outweighing subject
description. Name the shot size early ("A tight medium close-up of…"), cut environment
detail, and add a proportional instruction: "the subject fills roughly 70% of the frame
height."

**`aspect_ratio` silently changes framing**, which is easy to miss. The same prompt tends to
produce a full body in a portrait ratio and a waist-up crop in a landscape one, because the
model fills the canvas it is given. So a framing problem may actually be a ratio problem —
check the ratio before rewriting the prompt. The documented steer: for wider framing make
the *environment* the grammatical subject; for tighter framing keep the *person* the
subject.

**It added things you didn't ask for.** On GPT Image 2 this is a documented tendency to
over-elaborate past the brief. Add `No additional elements or sections beyond those listed.`
More generally, prefer an *invariant list* naming what should exist over a negation of the
intruder.

**Parts of the prompt silently ignored.** Too many competing constraints; the model
averages. GPT Image 2's characteristic failure is dropping one clause silently. Cut to the
load-bearing clauses, verify they land, then re-add. Move must-have constraints onto their
own labeled lines. And audit for self-contradiction first — "shallow depth of field" plus
"everything sharp", "minimalist" plus fifteen listed objects, "golden hour" plus "overhead
noon sun". One will be dropped and you cannot predict which.

**Anatomy errors, hands.** The non-obvious fix is **framing, not wording**: distortion is
documented as worst *at a distance*, because a hand a few dozen pixels across has no room to
resolve. Move the subject closer — "close-up", "portrait", "hands prominent in frame" — and
give the hands a job: "both hands visible, five fingers each, resting flat on the table", or
"hands naturally gripping the mug handle." Alternatively frame them out entirely: "cropped
at the chest."

The community boilerplate (`bad hands, extra fingers, mutated hands`) is folklore with no
vendor backing, and it is *inert here regardless* — neither model has a negative-prompt
field, so those tokens land in the positive prompt and describe what you don't want.

## Text

**Garbled or misspelled text.** Put the literal string in quotes or ALL CAPS; specify font
style, size, colour and placement as constraints; spell tricky words letter-by-letter; keep
strings short. Raise the sizing knob — `quality: "high"` on GPT Image 2, `resolution: "2K"`
or higher on Nano Banana 2. One of the few places a parameter changes correctness rather
than polish.

**Duplicated or echoed text.** Add `Ensure text appears once` and `no extra characters, no
duplicate text`. OpenAI includes these clauses in its own shipped examples, which is itself
evidence the failure is real.

**Lorem-ipsum placeholder text.** A silent Nano Banana 2 failure mode on dense infographics.
There is no prompt fix that reliably prevents it — inspect the output and regenerate. Reduce
the number of distinct text elements to three to five.

**Text appears when you didn't ask for any.** Add an explicit `No text. No watermarks.`
Nano Banana 2 can also render your *narration* into the image; say "create an image of…" so
it does not treat prose as content to depict.

## Edits and references

**Identity drifted across iterations.** The preserve list was not restated. Repeat the full
list on every turn — this is documented, not optional. For characters, keep one canonical
anchor image in `input_references` and repeat the same identity traits word for word.
Re-wording the subject mid-series is the main cause of drift.

Three further levers, each vendor-documented:

- **Never use a pronoun.** "her" invites reinterpretation; "the woman with short black hair"
  does not. Naming each character or object explicitly is Google's stated advice for
  multi-subject consistency.
- **Your verb sets the change scope.** "Transform" without qualifiers signals that a
  complete change is wanted. Prefer the narrow verb — "change the clothes", "replace the
  background".
- **Lock composition, not just the face.** "Keep her position, scale, pose, camera angle,
  and framing identical" — identity survives edits that reframe, but the image stops
  matching its siblings.

If drift has already compounded over many turns, stop editing and re-anchor: start from a
fresh generation with a detailed description rather than trying to correct the accumulated
result.

**The whole image changed when you asked for one small edit.** Expected — both models
regenerate rather than patch. The preserve list reduces drift, it does not eliminate it.
There is no mask parameter through this server. If a region must be bit-exact, composite
downstream.

**The edit came back the wrong shape.** You omitted `aspect_ratio` on an edit. This server
always sends one and defaults to `1:1`, so a 16:9 source gets squared. Pass the source's
ratio explicitly.

**A style reference leaked its content.** Enumerate the attributes to take — medium,
palette, saturation, texture, rendering technique, mood — instead of saying "match this",
and add `Do not carry over any objects, figures, or background elements from Image 2.` If
the reference has a dominant subject, crop to a texture region first.

**Reference images seem to be ignored.** On Nano Banana 2, check you are not using
generation-mode language ("make the same image but with a red car"). Use the inpainting
template instead. On either model, check you have not exceeded the high-fidelity reference
count — Nano Banana 2 accepts 14 but only holds 4 characters + 10 objects at full fidelity.

## Errors and refusals

**"does not support background transparent".** Neither model emits alpha. Generate on a flat
backdrop with `crisp silhouette, no halos/fringing` and key it downstream, or switch to
`recraft/recraft-v4.1-vector`.

**"size conflicts with aspect_ratio" / the tool rejected the combination.** Explicit pixels
are authoritative upstream. Use `size` alone for exact pixels, or `resolution` +
`aspect_ratio` and let the provider pick dimensions. Do not send both.

**"does not support resolution / quality".** These are near-disjoint across the two models.
Nano Banana 2 takes `resolution`; GPT Image 2 takes `quality`. Sending the wrong one reaches
the provider unvalidated, since unreported capabilities skip their check.

**"supports at most n=1".** Nano Banana 2 is single-image. Call `generate_image` repeatedly
for variations, or use GPT Image 2 where `n` goes to 10.

**A content-policy refusal.** Filtering runs on the prompt, the generated image, *and* any
reference images, independently. Because output filtering depends on what the model happened
to render, **refusals are nondeterministic — retry once before rewriting.** If it persists:
describe people by attributes rather than by name, declare originality explicitly (`Original
artwork only. No trademarks. No logos.`), and decompose a named style into visual facts.
OpenAI's `moderation` parameter is not exposed through this server.

**The generation failed after a long wait.** Complex prompts can take up to two minutes on
GPT Image 2, and `quality: "high"` is dramatically slower than `low`. The job record
preserves the upstream error message verbatim — read it rather than guessing.
