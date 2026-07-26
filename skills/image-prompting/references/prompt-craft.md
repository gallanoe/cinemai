# Prompt craft: vocabulary that changes the image

Model-agnostic. Terms here are photographic and cinematographic facts; the column notes
where a provider guide explicitly names the term as effective prompt language.
**[SOURCED]** = named in an official prompting guide. **[CRAFT]** = real craft term,
reliable as *meaning*, unverified as a prompt lever. **[FOLKLORE]** = widely repeated
without evidence.

The general rule underneath all of this: **specific detail helps, filler hurts.** For every
clause ask *if I delete this, would the image change?*

---

## Shot size and framing

| Term | What it does |
|---|---|
| Extreme close-up | A detail fills the frame — an eye, a hand, a texture. Abstracts and intensifies; loses context |
| Close-up | Head and a little shoulder. Reads emotion |
| Medium close-up | Head to mid-chest. The portrait/interview default |
| Medium shot | Waist up. Balances face and gesture |
| Cowboy shot | Mid-thigh up. Confident, standing, slightly heroic |
| Full shot | Whole body, feet included. Best for costume, posture, full-body product |
| Wide shot | Subject small, environment dominant. Isolation, scale |
| Establishing shot | Landscape or architecture; opens a scene, sets geography |
| Over-the-shoulder | Camera behind one subject looking at another. Depth plus a foreground occluder |
| Two-shot | Two subjects framed together — the relationship is the content |

Name the shot size as a noun phrase, early: "A wide establishing shot of…". Both vendors'
templates do this [SOURCED].

## Camera angle

| Term | What it does |
|---|---|
| Eye level | Neutral, observational. The default if unstated |
| Low angle | Subject reads powerful, monumental; verticals converge upward |
| High angle | Subject reads small, vulnerable, observed |
| Bird's-eye / top-down | Flattens into graphic pattern. Flat-lay, food, maps |
| Worm's-eye | Exaggerated verticals, sky-heavy, disorienting |
| Dutch angle | Tilted horizon; unease. 5–15° reads intentional, more reads accidental |
| Three-quarter | Subject rotated ~45°. The most flattering, most dimensional portrait orientation |
| Profile | Fully side-on. Graphic, iconic, emotionally distancing |
| Elevated 45° | The standard product angle — shows top and front face at once [SOURCED, Google] |

## Lens and optics

Focal lengths are full-frame equivalents.

| Term | What it does |
|---|---|
| 14mm | Ultra-wide. Extreme perspective stretch; anything near the lens looms |
| 24mm | Wide. Whole room or landscape; environment shares billing with the subject |
| 35mm | Mild wide. The documentary/reportage standard — natural with a little extra air |
| 50mm | Normal. Closest to unaided human vision. Neutral, honest |
| 85mm | The portrait lens. Flattering facial proportions, background compressed and cleanly separated |
| 135mm | Strong compression; background becomes a soft flattened wash |
| 200mm+ | Heavy compression stacks foreground and background into one plane. Candid, voyeuristic |
| Macro | 1:1 magnification. Extremely shallow focus, reveals micro-texture |
| Tilt-shift | Corrects converging verticals, or produces the "miniature world" band of focus |
| Anamorphic | Oval bokeh, horizontal flares, 2.39:1 frame |
| Motion blur | Specify *what* is blurred and what stays sharp |
| Long exposure | Silky water, light trails, ghosted crowds |
| Deep focus | Foreground to horizon sharp. Pair with f/16 |

**Aperture → depth of field:** f/1.2–1.8 paper-thin, eyes sharp and ears soft (and the "AI
portrait" cliché); f/2.8 shallow but usable, the safe portrait default; f/4–5.6 subject
separated with the environment still legible; f/8–11 deep, most lenses' sharpness peak, good
for product and architecture; f/16–22 very deep, sun becomes a starburst.

BFL's cheat sheet maps exactly this range [SOURCED]. OpenAI's caveat applies to all of it:
camera specs steer *look*, not optics — "detailed camera specs may be interpreted loosely."

## Lighting

BFL states lighting "produces the greatest single impact on output quality" [SOURCED], and
it is the first clause to edit when a result has the right content but the wrong feel.
Describe **source, quality, direction, temperature**.

| Term | What it does |
|---|---|
| Hard light | Small source. Sharp-edged shadows, high local contrast, texture emphasized |
| Soft light | Large source. Gradual shadow edges, forgiving on skin |
| Three-point | Key + fill + backlight. The interview/portrait standard [SOURCED] |
| Rembrandt | Key ~45° and above; small triangle of light on the shadow-side cheek [SOURCED, BFL] |
| Split lighting | Key at 90°. Half the face lit, half in shadow. Severe |
| Butterfly / Paramount | Key high and frontal; small shadow under the nose. Glamour, old Hollywood |
| Loop lighting | Key ~30–45°; small nose shadow not touching the cheek shadow. The flattering default |
| Rim / backlight / kicker | Source behind. Bright outline separating subject from background |
| Chiaroscuro | Extreme light/dark opposition, little midtone. Subject emerges from near-black [SOURCED] |
| High key | Bright, low contrast, minimal shadow. Clean, commercial, editorial |
| Low key | Predominantly dark with small bright areas. Noir, product-on-black |
| Practical lights | Sources visible *in* frame — lamps, screens, neon. A large realism upgrade [SOURCED, BFL] |
| Volumetric / god rays | Beams visible through particulate. Needs an occluder to shape them |
| Golden hour | Low, warm ~3000K, long shadows, frequent backlight [SOURCED] |
| Blue hour | Even, cool, deep blue ambient; artificial lights read warm against it |
| Overcast | The sky as one giant softbox. Even, shadowless, low contrast |
| Top light | Eye sockets go dark. Unflattering, institutional |
| Underlight | Horror shorthand; inverts natural shadow logic |
| Gobo / dappled | Patterned shadow from a cut-out — blinds, foliage |
| Mixed colour temperature | Warm interior practical against cool window daylight. Separates planes by temperature rather than brightness — the most reliable "cinematic not rendered" move [CRAFT] |

Kelvin reference: ~1500K candle, ~2700K domestic bulb, ~3200K tungsten and sunrise, ~5500K
daylight, ~7000K shade, ~12000K clear blue sky.

## Colour

| Term | How to phrase it |
|---|---|
| Complementary | "complementary orange-and-blue palette" |
| Analogous | "analogous palette of amber, ochre, and rust" |
| Monochrome | "monochromatic blue palette" |
| Teal and orange | "teal-and-orange colour grade" — legible but dated |
| Muted / desaturated | "muted, desaturated palette" — documentary, somber, expensive-looking |
| Pastel | High value, low saturation. Soft, nostalgic |
| Earth tones | Ochre, umber, olive, terracotta, bone |
| High contrast | "high contrast with crushed blacks" |
| Low contrast | "low contrast, lifted matte blacks" — film-print look |
| Limited palette | "limited four-colour palette: cream, terracotta, forest green, black". The strongest cohesion lever for illustration |
| Hex codes | Supported by BFL explicitly; works in practice on both models here — verify per use |

**Bind a colour to its object in a copular construction.** BFL's guidance is that `The car is
#FF0000` works better than `use red #FF0000 in the image` [SOURCED] — the clearest published
instruction on attribute binding, and it generalizes past hex codes. Keep each adjective
next to the noun it modifies; a colour floating loose in a prompt attaches to whatever the
model likes.

## Composition

| Term | What it does |
|---|---|
| Rule of thirds | Subject on a third-intersection. Dynamic, conventional |
| Centred / symmetrical | Formal, iconic, confrontational, still |
| Leading lines | Roads, rails, shadows directing the eye |
| Negative space | Large empty area around a small subject — and room for type [SOURCED, Google's template] |
| Frame within a frame | Doorway, arch, foliage enclosing the subject. Adds depth |
| Fore/mid/background layering | Distinct content at three depths. **The fastest fix for a flat image** |
| Atmospheric perspective | Distant elements lighter, lower-contrast, bluer. Depth without lens language |
| Headroom / lead room | Space above the head, space in front of the gaze. Absence reads cramped |
| Horizon placement | Low horizon → expansive sky; high horizon → grounded detail |
| Explicit placement | "logo top-right", "subject centred with negative space on left" [SOURCED, OpenAI] |

## Art media and style

Watercolour (transparent washes, paper tooth, blooms at wash edges, whites are unpainted
paper) · gouache (opaque matte flat colour fields, poster-like) · oil (visible brushwork,
glazing depth, canvas weave) · impasto (paint thick enough to cast its own shadows) · ink
wash / sumi-e (monochrome brush, economy of stroke, large negative space) · charcoal
(smudged tonal drawing, erased highlights) · linocut/woodcut (bold high-contrast shapes,
gouge marks, no midtones) · screenprint (flat opaque ink layers, slight misregistration) ·
risograph (limited fluorescent spot colours, halftone grain, deliberate offset) · etching
(hatched lines describing tone, no continuous gradient) · cel animation (flat fills, hard
ink outlines, limited shading steps) · claymation (fingerprints and tool marks, real
practical lighting, tiny-set scale cues) · isometric 3D (parallel projection, no
convergence, soft AO shadows) · vector flat (solid fills, geometric simplification,
consistent stroke weight) · technical illustration (precise line weights, cutaways, callout
leaders) · blueprint (cyan ground, dimension lines, title block) · ukiyo-e (flat colour
areas, bold contours, no cast shadows) · Art Nouveau (whiplash organic curves, botanical
motifs, decorative borders) · Art Deco (geometric symmetry, stepped forms, sunbursts,
metallics) · Bauhaus (primaries, geometric primitives, grid) · brutalist (board-formed
concrete, monolithic geometry, overcast grey light) · Swiss/International (grid, Helvetica,
generous white space) · film noir (low-key, venetian-blind light, wet streets).

BFL advises referencing actual movements, decades, or recognized aesthetics rather than
vague descriptors [SOURCED]. "Octane render" and "Unreal Engine 5" are legacy
Stable-Diffusion-era keywords; "physically based render, soft studio HDRI, ambient
occlusion, subsurface scattering" is more precise on modern models.

## Materials and texture

Both OpenAI and BFL single this out as the difference between "AI image" and "photograph"
[SOURCED]. Replace the generic noun with the material noun — not "suit jacket" but "navy
blue tweed"; not "armor" but "ornate elven plate armor, etched with silver leaf patterns."

Vocabulary: brushed aluminium, anodized, patinated brass, oxidized copper, board-formed
concrete, terrazzo, raw linen, boiled wool, waxed canvas, cracked leather, frosted glass,
satin ceramic glaze, unglazed stoneware, weathered teak, powder-coated steel, moiré silk,
ribbed corduroy, subsurface scattering.

For photorealism specifically, ask for imperfection: "visible skin pores, fine lines,
flyaway hairs, slight fabric wear, a dust mote in the light."

## Film emulation — read this before using stock names

This is the most folklore-heavy area of prompt craft, and the correction is worth stating
plainly: **OpenAI's cookbook names no film stock at all.** A grep of the source for
portra/tri-x/cinestill/velvia/ektachrome/kodak/polaroid/halation/anamorphic returns zero
hits — only "film grain" and "35mm". Search summaries confidently attribute "name a real
film stock (Portra 400, CineStill 800T)" to OpenAI; that text is from third-party blogs.

**Black Forest Labs is the only provider that documents branded stock names — and it always
pairs the name with a description of the intended effect** ("shot on Kodak Portra 400,
*natural grain, organic colors*"). Google's guide is explicitly generic: "as if on 1980s
color film, slightly grainy", plus camera *bodies* as a stylistic lever (Fujifilm for colour
science, a disposable camera for "a raw, nostalgic flash aesthetic").

The one published A/B test ran five stocks through a model with a deliberately sparse prompt
and concluded there was "not a huge distinction between all the samples." Its most revealing
result: prompting "Amber D400" made the model apply *amber* to the palette, diverging from
the real film, which skews green — direct evidence the model parses the literal words in the
name rather than the film's colour science.

**The reliable split** is between terms naming a *visible physical structure* and terms
naming a *colour science*:

| Reliable — visible geometry | Unreliable — colour response |
|---|---|
| Polaroid (the white frame is the tell) | Portra vs Gold vs Ektar |
| Anamorphic (horizontal streaks, oval bokeh) | Velvia, Ektachrome |
| Vignette falloff | "Cross-processed" as a single look |
| Direct-flash falloff (hot subject, dark background) | Push/pull processing |
| Visible grain | Expired film |
| Halation described as "red-orange bloom around highlights" | "CineStill 800T" as a bare name |

Practical rule: **describe the effect, and append the stock name as an optional bonus
token** — exactly as BFL does. "Warm, low-contrast, fine-grained, slightly faded, natural
skin tones" outperforms "Kodak Portra 400" alone, and loses nothing if you append the name
anyway.

Two mechanisms worth knowing because captions routinely conflate them: **halation** is light
reflecting off the film base and re-exposing from beneath, which is why it is red-orange and
wraps high-contrast edges — a white or blue "halation" glow is a digital fake. **Light
leaks** are not frame-aligned; real ones cross into sprocket holes and repeat position on
the roll, not on the composition.

## Length

| Task | Target |
|---|---|
| Style exploration | 15–30 words: subject + medium + one light cue |
| Standard single subject | **40–80 words** — the productive default |
| Complex scene or in-image typography | 80–200 words, in labeled blocks |
| Edit turn | 10–35 words: one verb-first change + the preserve list |
| Over ~250 words | Split into a base generation plus successive edits |

Context capacity is not the constraint any more — attention allocation is. Twenty
equally-weighted requirements each get about 5% of the model's attention; three get a third
each. Rank your requirements and cut below the top eight or so.

The "77-token limit" applies to CLIP-conditioned models and is obsolete for both models
here. Do not cite it.
