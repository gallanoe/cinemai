# Shot craft — vocabulary and structure across models

Transferable material, gathered from the official prompting guides of Google Veo, OpenAI
Sora, Runway, Kling, Luma and ByteDance. **[SOURCED]** = named in an official guide,
**[CRAFT]** = real filmmaking fact whose effect as a prompt lever is unverified,
**[FOLKLORE]** = widely repeated without evidence.

Read `seedance-2.md` for what Seedance specifically documents; this file is the wider context
and the places where providers genuinely disagree.

## What changes going from image to video

A still prompt describes a frozen state. A video prompt must also say **what changes** — and
the slots that carry that are the ones people forget:

| Slot | Example |
|---|---|
| Subject motion | body part + range + speed + force: *"her shoulders rise once with breathing"* |
| Camera motion | one move, with a destination |
| Pacing | real time, slow motion, counted beats |
| Temporal order | what happens first, what lands last |
| End state | where the shot finishes, which is also where the camera lands |

The image-prompt habits that actively hurt:

- **Appearance-heavy, motion-light prompts** produce the slideshow effect. Runway's rule for
  image-to-video is blunt [SOURCED]: *"If a sentence… describes something that's already
  visible in the source image, delete it."*
- **Evaluative adjectives** ("stunning", "cinematic", "epic") carry no visual information and
  push toward the default glossy look. ByteDance punishes exactly this in its own negative
  example.
- **Structured/JSON prompts.** Runway is explicit [SOURCED]: *"JSON prompts give the placebo
  effect of being more accurate… Ultimately, JSON formatting is ignored by generative models —
  what matters is the detail provided within the prompt."* Write prose or shot lists, not
  objects.

## Camera vocabulary

| Term | What it looks like |
|---|---|
| Static / locked-off | Camera fixed. First-class vocabulary in Google's guide; Luma has a literal `Static` concept; Kling recommends rig words — "fixed lens", "tripod", "35mm" |
| Pan / tilt | Camera rotates horizontally / vertically from a fixed position |
| Dolly in / out | Camera physically moves toward or away. Different from zoom — perspective changes |
| Truck / track | Camera moves laterally |
| Pedestal | Camera raises or lowers without tilting |
| Crane / jib | Sweeping vertical move, usually revealing |
| Orbit / arc | Camera circles the subject |
| Push-in / pull-back | Dolly toward / away, usually slow and emotional |
| Handheld | Organic shake, documentary register |
| Steadicam / gimbal | Smooth moving follow, no shake |
| Drone / aerial | High, wide, usually moving |
| Whip pan | Fast blur-pan, often a transition |
| Dolly zoom (Vertigo) | Dolly one way, zoom the other; background warps, subject stays |
| Rack focus | Focus shifts between planes |
| Follow / tracking | Camera holds the moving subject in frame |
| POV | Frame is what a character sees |

Shot sizes: extreme close-up → close-up → medium close-up → medium → cowboy → full → wide →
extreme wide/establishing. Angles: eye level, low, high, bird's-eye, worm's-eye, Dutch,
over-the-shoulder, three-quarter.

**Give every move a destination** [SOURCED, multiple]. *"Slow dolly-in from a medium two-shot
to a tight single on her hands"* beats *"dolly in"*. ByteDance publishes this as a formula:
`starting frame composition + move + amplitude + ending frame composition`.

**One move per shot** is near-unanimous across providers. Stacking moves is the most reliable
way to destabilise an image.

## Describing motion so it reads

- **Quantify.** Body part, range, speed, force. *"He turns his head left about thirty degrees
  and holds"* rather than *"he looks around"*.
- **Give physics a consequence.** *"The mug slides and tips, coffee spreading across the
  paper"* — not *"clumsy"*. Models animate consequences; they don't infer them.
- **Bind the actor.** Verbs like *moves, follows, circles, rises* apply to camera and subject
  alike. Make "the camera" the explicit subject of camera clauses.
- **One clear action per shot.** More than one is the action-side equivalent of stacking
  camera moves.
- **Name the pacing.** Real-time, slow motion, time-lapse. In the absence of a pacing cue,
  several models drift toward a dreamy half-speed.

## Where providers genuinely disagree

These are the places a single house style will be wrong somewhere. Worth knowing even though
this skill is Seedance-centred.

**Negation splits four ways, not two:**

| Approach | Providers |
|---|---|
| A real `negative_prompt` field taking bare nouns | Veo (`negativePrompt`), Pika, legacy Kling only |
| In-prompt constraint words, which genuinely parse | **Seedance**, modern Kling |
| Positive-only — negation actively summons the artifact | Runway, Luma, Sora |
| A preservation clause instead of an exclusion | Luma |

Through this server none of the negative-prompt *fields* are exposed, so for Seedance the
answer is the constraint trailer, and for everything else it is positive phrasing.

**Ordering.** Seedance says placement matters — *"the more an asset requires precise
reference, the earlier it should be placed"* [SOURCED]. Runway says the opposite: *"The order
in which elements are introduced in a prompt do not matter"* [SOURCED]. Both are probably
true of their own model. The safe reading is that **formulas are anti-omission scaffolding
rather than parser contracts** — they stop you forgetting a slot, and on some models they also
weight attention.

**Length.** Luma is the only vendor publishing a target: ~100 words. Caps differ by 6×
(Runway 1,000 characters; Luma 6,000). Seedance allows 1,000 words but its own examples run
80–330. Everyone who publishes guidance says the same thing underneath: specific detail helps,
filler hurts, and the ceiling is not the target.

**Camera parameters.** Kling's `camera_control` parameter works on `kling-v1`/`v1-5` **only** —
on modern Kling versions camera must be prose. Most third-party Kling guides are wrong about
this. Seedance's `camera_fixed` is likewise unsupported on 2.0; use prose.

## Deprecations worth knowing

- `openai/sora-2-pro` — shutdown **2026-09-24**, no successor.
- Runway Gen-3 Alpha — retired 2026-07-08; its formula still circulates.
- Luma "Dream Machine" and "Ray2" — deprecated; Luma's own guidance for AI assistants asks
  that the names not be used.

If you find a prompting guide keyed to any of these, its model-specific advice is stale even
where its craft advice isn't.
