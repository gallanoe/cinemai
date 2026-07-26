# Task recipes

Each recipe gives the call shape and the prompt shape. Evidence labels: **[OFFICIAL]**
vendor docs, **[TESTED]** independent hands-on, **[LOCAL]** measured against this server,
**[CRAFT]** established practice.

Remember the constraint that shapes all of these: this server has no mask endpoint and no
conversational multi-turn. **Editing and iteration both work by passing a prior handle back
as `input_references`.**

---

## 1. New image from text

Work in two phases. Do not start in convergence mode — a long fully-specified first prompt
locks you into a composition you have not evaluated yet.

**Diverge.** 15–30 words, subject + medium + one light cue. On GPT Image 2 use `n: 4` and
`quality: "low"` — four candidates for about the price of one medium image [LOCAL: low is
$0.006]. On Nano Banana 2, `n` is fixed at 1, so call four times at `resolution: "512"`.

**Converge.** Take the winner, write it out properly in the model's dialect (see SKILL.md),
and raise the sizing knob. Target 40–80 words for a standard single subject; 80–200 in
labeled blocks for complex scenes or in-image typography.

Slots worth filling, in the order each model wants them:

- subject, with 2–3 concrete material details
- action or pose
- setting, time of day, atmosphere
- composition: shot size, angle, where the subject sits in frame
- camera: focal length, aperture/depth of field
- lighting: source, direction, quality, colour temperature
- colour palette or grade
- medium and finish
- intended use — for GPT Image 2 this is documented as setting the "mode" and level of
  polish [OFFICIAL]

The specificity test for every clause: *if I delete this, would the image change?* If not,
delete it. Filler adjectives crowd out content and dilute attention across constraints.

---

## 2. Editing an existing image

The pattern is the one fully portable thing between these models [OFFICIAL, both]:

```
Change only [X] to [Y]. Keep everything else exactly the same.
```

Google's canonical form:

> Using the provided image, change only the [element] to [new element]. Keep everything
> else in the image exactly the same, preserving the original style, lighting, and
> composition.

OpenAI's minimal form is blunter — `Remove the flower from man's hand. Do not change
anything else.` — and its rule adds the highest-value, least-known line in either guide:
for a surgical edit, explicitly forbid changes to **saturation, contrast, layout, arrows,
labels, camera angle, and surrounding objects** [OFFICIAL].

Full preserve block:

```
Change ONLY [X]: [precise description of the change].
Keep everything else the same.
Preserve: camera angle, framing, composition, lighting direction, shadows, colour
temperature, saturation, contrast, layout, labels, text, background, and all surrounding
objects — exactly as they appear in the input image.
Do not add, remove, or restyle anything not explicitly named above.
```

Call shape:

```json
{ "prompt": "<the above>",
  "input_references": ["image://gen/<id>"],
  "aspect_ratio": "<the SOURCE image's ratio>" }
```

That last line is not optional. This server always sends an explicit ratio and defaults to
`1:1`; Nano Banana 2 would otherwise have inherited the input's ratio [OFFICIAL]. Omit it
and a 16:9 photo comes back square.

**Both models regenerate the whole image rather than patching it** [TESTED]. Pixel-identical
untouched regions are not achievable through this endpoint — the preserve list reduces
drift, it does not eliminate it. If a region must be bit-exact, composite downstream.

**Restate the preserve list on every iteration.** OpenAI documents this explicitly as drift
control [OFFICIAL].

---

## 3. Iteration and variation

**Variations of one concept.** GPT Image 2: raise `n` rather than editing the prompt —
OpenAI's own logo example uses `n: 4` for exactly this. Nano Banana 2: repeat the call.
`seed` is accepted by the endpoint but neither of these models documents reproducible
seeding; do not depend on it.

**Refining one result.** Change one variable per turn. What to change when the result is
close but wrong:

| Symptom | The one clause to edit |
|---|---|
| Right content, wrong feel | The lighting clause. Highest-leverage single lever [OFFICIAL, BFL] |
| Right feel, wrong framing | Shot size + angle. Touch nothing else |
| One element is wrong | Stop editing text — switch to an edit call on the previous output |
| It added something unasked | Add an invariant list naming what should exist, rather than negating the intruder |
| An instruction is ignored | It is competing with something. Delete the competitor or give it its own labeled line |
| Result is bland | *Remove* adjectives. Genericity comes from too many non-committal modifiers |
| Prompt has become unmanageable | Restart from a clean 25-word base; re-add only clauses that demonstrably changed the image |

**When to stop editing text and pass the image back as a reference** [CRAFT]:

1. The composition is right and only the rendering is wrong — text cannot reproduce a
   composition you already have.
2. An identity or specific object must persist across images.
3. You have hit the same failure three times from text — the model does not have the
   concept from language, so give it pixels.

Conversely, stay in text when the *composition itself* is wrong. Feeding back a badly
composed image anchors you to the bad composition.

---

## 4. Style transfer

Style transfer is: keep the content, replace the visual language. Every failure is a
failure to separate those two.

**Named style, no reference image.** Works when the style is a well-known movement, medium,
or era — ukiyo-e, Art Deco, gouache, film noir. Google's template [OFFICIAL]:

> Transform the provided photograph of [subject] into the artistic style of [style].
> Preserve the original composition but render it with [stylistic elements].

**With a style reference image.** Necessary when the style is idiosyncratic or belongs to
someone you should not name.

Before writing anything, settle **which reference is which** — this is the failure that
costs a whole generation to discover, and it is easy to get backwards. Filenames are not
reliable evidence: a pair named `style-from` / `style-to` can plausibly mean "the style
comes *from* A and goes *to* B" or "convert A *to* B's look," and those produce opposite
images. When the roles are not unambiguous from what the user said, state your reading in
one line before you call — *"taking the painterly treatment from A and applying it to the
character in B"* — so a wrong assumption costs a sentence rather than a render.

Then say positively **what the output must depict**. Naming the subject is a stronger guard
than excluding the other one, because an exclusion list still leaves the model guessing what
to draw. "The output shows the dragonborn from Image 2" does work that "no human figures"
cannot.

The other failure mode here has a name in the literature — *content leakage*: objects,
poses and backgrounds bleed from the style reference into the output.

The mitigation is to **enumerate the attributes to take** instead of saying "match this":

```
Image 1: content reference.
Image 2: style reference.

Render the content of Image 1 with the medium, colour palette, saturation level, texture,
rendering technique, and overall mood of Image 2.
Keep Image 1's composition, subject identity, pose, and framing unchanged.
Do not carry over any objects, figures, or background elements from Image 2.
```

Index your references by number for GPT Image 2 (`Image 1: … Image 2: …`) [OFFICIAL]; refer
to them by role for Nano Banana 2 ("the dress from the first image") [OFFICIAL]. If the
style reference has a dominant subject, crop to a texture region before using it.

**Medium change with composition lock:**

```
Re-render this image as a [gouache illustration].
Preserve exactly: the subject's pose and proportions, the camera angle and framing, the
position of every element, and the direction and relative intensity of the light.
Change only the rendering: [flat opaque matte colour fields, no gradients, visible brush
edges, limited five-colour palette].
Do not add, remove, or reposition any element.
```

**Naming artists.** Google's own template says "artist/art style" and its docs use Van Gogh
by name. OpenAI's examples never name an artist, consistently using `Original artwork only
/ No trademarks / No logos` instead. The portable move is to decompose the style into
visual facts — "hand-painted watercolour look, soft outlines, warm earthy colours" — which
also survives policy filtering and gives you editable variables.

---

## 5. Text, typography and infographics

Both vendors document the same core recipe: **literal string in quotes, typography as a
separate constraint, and raise the sizing knob** [OFFICIAL, both].

GPT Image 2's text-lock block:

```
[ELEMENT] text (EXACT, verbatim, no extra characters):
"[YOUR COPY]"
Typography: [weight] [serif/sans-serif], [colour] on [background], [alignment], clean kerning.
Placement: [top-left / centred / lower third].
Ensure text appears once and is perfectly legible.
No extra text, no duplicate text, no watermarks, no logos.
```

The anti-duplication clause is not decoration — OpenAI prompts against echoed text in its
own shipped examples, which is itself evidence the failure is real. Set `quality: "high"`
for small or dense text; this is one of the few places the parameter changes *correctness*
rather than just polish [OFFICIAL].

Nano Banana 2 wants the same information in prose, and needs `resolution: "2K"` or higher
for fine type — 1K goes soft [TESTED]. Its documented multi-line form:

> Next to the product, render three lines of text with the following exact styling: for the
> top line, the word 'GLOW' in a flowing, elegant Brush Script font. For the middle line,
> the text '10% OFF' in a heavy, blocky Impact font…

Practical ceilings: keep to **3–5 distinct text elements**; beyond that accuracy slips on
both. Short quoted strings are reliable; long paragraphs, tiny legal copy and stylized
multi-line layouts are the failure boundary. **Proofread every letter** — no source claims
100%, and Nano Banana 2 silently falls back to lorem-ipsum placeholder text on dense
infographics [TESTED].

Google's "text-first" rule is worth adapting: settle the exact copy in conversation with
the user *before* generating, rather than asking the model to invent copy and render it in
one pass [OFFICIAL].

---

## 6. Character and subject consistency

Neither model has a conversational anchor here, so consistency is carried entirely by
`input_references` plus repeated language.

**The anchor workflow** [OFFICIAL, both vendors]:

1. Generate the character once, clean — front on, eye level, neutral expression, flat
   lighting. This is your canonical reference.
2. For every subsequent image, pass that handle in `input_references` **and** repeat the
   same identity traits word for word. Re-wording the subject mid-series is the main cause
   of drift [TESTED]. **Give each character a name and never use a pronoun** — "Mira, the
   woman with short black hair" rather than "her" [OFFICIAL, Google]. Pronouns invite
   reinterpretation on every call.
3. Re-anchor periodically on a recent good output to fight cumulative drift.

GPT Image 2's continuation block:

```
Character Consistency:
- Same [outfit items]
- Same facial features, proportions, and colour palette
Constraints:
- Do not redesign the character
```

Nano Banana 2's documented idiom is blunter and works: `It is strictly important to keep
identity consistent of all the [N] characters.` Add its anti-duplication clause when a
character could be doubled: `Make sure to only have one of each character in each image.`

**Reference counts degrade before they cap.** Nano Banana 2 accepts 14 but documents high
fidelity for only 4 characters + 10 objects; the remainder parse at "minor changes"
fidelity [OFFICIAL]. GPT Image 2 accepts 16 and processes every input at high fidelity
automatically — `input_fidelity` is not settable and does not need to be [OFFICIAL].

One asymmetry worth knowing: Nano Banana 2's consistency is strong across *its own*
generations but reportedly weaker at matching a user-supplied reference face [TESTED].

---

## 7. Cutouts and transparency

There is no path to an alpha channel through either model. `background: "transparent"` is
rejected outright by GPT Image 2 (it reports `auto, opaque` only), and Gemini emits flat
RGB [OFFICIAL, both].

Three workarounds, cheapest first:

1. **Flat backdrop + downstream key.** OpenAI's own documented approach. Their prompt asks
   for `crisp silhouette, no halos/fringing` specifically so the downstream removal is
   clean. A pure chroma colour (`#FF00FF`) keys more reliably than white, unless the
   subject contains that hue [TESTED].
2. **Triangulation matting.** Render on pure white and pure black, diff per-pixel to
   recover true alpha including soft edges. Most robust, doubles the cost [TESTED].
3. **Switch models.** `recraft/recraft-v4.1-vector` produces real editable SVG with native
   transparency.

The validation layer will catch a transparent request before it spends anything and points
at option 1.
