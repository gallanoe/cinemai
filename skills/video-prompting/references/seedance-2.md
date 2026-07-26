# Seedance 2.0 (`bytedance/seedance-2.0`, `bytedance/seedance-2.0-fast`)

Sources are ByteDance's BytePlus ModelArk prompt guides, the Seedance 2.0 technical report
(arXiv 2604.14148) and the Seed launch blog. **(A)** = official ByteDance; **(B)** =
community or third-party; **[LOCAL]** = measured against this server.

Note on access: `docs.byteplus.com` is a JS SPA that returns only navigation chrome to
ordinary fetching. If you need to re-check a claim, `curl https://r.jina.ai/<url>` renders it.

## The two published formulas

**Advanced (A), verbatim:**

> precise subject + action details + scene/environment + lighting & colour tone + camera
> movement + visual style + image quality + constraints

**Simpler, from the 1.5 Pro guide and still fine for plain text-to-video (A):**

> Subject + Movement + Environment (optional) + Camera movement (optional) + Aesthetic
> description (optional) + Sound (optional)

The rationale is worth knowing because it predicts what the model does with your words (A,
verbatim):

> Seedance 2.0 is essentially a multimodal AI director… it internally breaks [input] down
> into two dimensions, the "spatial layer" (what is in the frame) and the "temporal layer"
> (how things change over time)… a good prompt is not simply "copywriting-style description",
> but an "engineering-style instruction": who, in what scene, doing what action, how the
> camera moves, and in what chronological order events occur.

And the plain-language gloss (A): *"first lock in 'who' is 'doing what', then explain 'where'
and 'what atmosphere', then tell the model 'how to shoot', and finally tighten the result with
style, image quality, and constraints."*

## Two legitimate registers — pick one, don't straddle

**Directive.** You write `Shot 1/2/3` and name every camera move. Maximum control; this is
what the prompt guide teaches. Use when the storyboard is settled.

**Delegated.** You give intent, genre and beats and let the model break down the shots. The
technical report claims the model has *"directorial and cinematographic reasoning… enabling
it to autonomously plan shot sequencing"* (A), and ByteDance's own 15-second 4K sample does
exactly this — *"Generate a 15-second off-road motorcycle racing commercial-style short
film"* and merely suggests a sequence.

The failure to avoid is the middle: half-specified camera language that contradicts the
model's own plan. **If you name a move, name it for the whole shot. If you don't, don't
half-name it.**

## Length

The API allows 1000 words but warns (A, verbatim): *"Lengthy text will lead to scattered
information, and the model may ignore details and only focus on key points, resulting in
missing elements."* And separately: *"Do not directly use the complete script as the prompt.
Overly redundant copy can easily cause confusion."*

ByteDance's own examples run 80–250 words single-shot, 150–300 for a 3-shot storyboard,
~330 for the 15s/6-shot 4K piece. Community targets converge on 40–200. **The ceiling is not
the target.**

When over budget, cut in this order (B): duplicate style adjectives, generic quality words,
background detail already visible in references, secondary camera moves, secondary actions,
speculative emotional labels. **Keep** preservation constraints, action timing, and role maps.

Languages (A): English throughout; Seedance 2.0 additionally supports Japanese, Indonesian,
Spanish and Portuguese, plus Chinese. Dialogue must not mix languages except for proper nouns.

## Camera vocabulary

Documented and reliable (A). Basic moves each have a worked official example: **Push, Pull,
Pan, Move (truck), Circle around (orbit), Follow, Rise (crane), Zoom.** The 1.5 Pro guide adds
`dolly-in / dolly-out / Pan / track / Follow / Rise / Fall / Whirl / Rotate / Surround / Zoom`.

| Term | Status |
|---|---|
| dolly in/out, push-in, pull-out | Documented, many examples |
| truck / lateral tracking | Documented (`Truck Left/Right`, "smooth lateral tracking") |
| pan | Documented (`Pan Left/Right`) |
| tilt | Not in the noun lists — write "the camera tilts up" or use "rise"/"pan up", both of which appear in official prose |
| crane / boom | As `Rise` / `Fall` |
| orbit / arc | `Surround`, `Rotate`, `Whirl`, "circles around", "360-degree pan around them" |
| handheld | Documented — *"a handheld camera rapidly tracks forward, with slight realistic camera shake"* |
| zoom (optical, distinct from dolly) | Documented; the Hitchcock example separates "dolly out + increase the focal length" |
| focal length | Documented — *"a 45mm wide-angle lens level with his shoulder"* |
| fixed / locked-off | Documented in prose. Note the `camera_fixed` parameter is **not supported** on 2.0 |
| whip pan, rack focus | **Not** in any official guide; (B) reports both read cleanly. For focus, prefer describing the *result* — "the frame gradually blurs", "a close-up with a small depth of field" — rather than naming the operator's move |

Shot sizes and angles are well supported (A): `long shot, full shot, medium shot, close-up,
big close-up`; `high angle, low angle, bird view, eye-level`; `over-the-shoulder, subjective
view, surveillance view`; `front, profile, half-profile, back, top, bottom`.

**The camera-move mini-formula (A)** — the closest thing to a published DSL:

> Starting frame composition + shot movement + shot movement amplitude + ending frame
> composition

Worked (A, verbatim): *"The camera starts with a medium shot (above the chest), slowly zooms
in at a steady sliding speed, approaching his face, and finally reaches an extreme close-up
(showing only the area of his eyes and nose bridge)."*

**Named compound rigs (A):** `Hitchcock shot = dolly-in/out + zoom-out/in`;
`Bullet time = time slowdown + surround`. These are the documented exception to one-move-per-shot.

### The honest limit

Technical report, verbatim (A): *"Advanced camera movement is the hardest sub-category:
Seedance 2.0 and Kling 3.0 tie on MQ (2.71), and no model exceeds 3.14 on any metric."*

So basic shot sizes and single simple moves are reliable; exotic choreography is not, on any
model. When a move must be exact, the documented escape hatch is a **camera-movement
reference video** — `Refer to the [Camera Movement Description] from [Video N]`.

## Multi-shot

Documented as the recommended default for anything complex (A, verbatim):

> The ideal prompt form for a complex video is a timeline-based storyboard: break the video
> into several shots, and dynamically describe each shot in the order events occur: who +
> where + doing what + how the camera moves.

Per-shot slot order (A): **camera movement or transition → subject actions and expressions →
position or spatial change → audio.** Note this differs from the global formula; the global
one governs the preamble and trailer, the per-shot one governs each `Shot N:` line.

ByteDance's own negative/positive pair (A, verbatim):

> **Negative**: "A man runs nervously down the street, and the scene feels very cinematic."
>
> **Positive**:
> Shot 1: Side shot of a street alley; the man slowly starts running, with a sense of rapid breathing.
> Shot 2: The man knocks over a fruit stand; the camera shakes quickly and gives a close-up of the man's frightened face.
> Shot 3: The man climbs over a low wall and disappears; the camera slowly pulls back and freezes on the empty street.

Budget roughly **3 shots per 8–12 seconds**. Timestamps are officially discouraged in favour
of shot numbering.

## Character and subject consistency

This is the model's advertised strength, and it rests on a **subject-definition protocol**
rather than on the references alone.

Define labels first, then never use a pronoun (A):

```
Define [feature A, feature B] in Image 1 as <NAME_1>, and define [feature C, feature D]
in Image 2 as <NAME_2>.
```

Then `<NAME_1>` in every subsequent clause. For undefined subjects the inline binding form is
`Zhang San@Image 1`.

**Asset kit (A):** 1–2 character images — **a headshot plus a full body, not multi-view** —
plus one scene image, one camera-movement video, one audio clip. Recommended total is 4–5
assets, and the docs advise *not* filling every slot. Order matters: *"the more an asset
requires precise reference, the earlier it should be placed in the prompt."*

Hard identity lock (A): `<Subject 1> facial features reference image 1 (headshot), makeup and
styling reference image 2 (full-body photo)`.

**Role-binding with exclusions (B)** — the community's main addition, and worth using:

```
@Image1 controls subject identity only. @Video1 controls camera pace only.
@Audio1 controls tempo only.
Preserve the subject from @Image1; do not copy characters, logos, music, voice, or
environment from @Video1/@Audio1.
```

**The twin problem (A).** With many characters in frame and multi-view reference sheets,
*"two identical characters may easily appear in the same generated video frame"* — and
explicitly *"it is not possible to directly avoid the twin problem 100%."* Mitigation trailer:

```
Throughout the video, characters with completely identical appearance, clothing, and
accessories are prohibited. Do not generate duplicate avatars or a twin effect. Keep only
a single corresponding character in the same frame.
```

**Identity drift escalates into moderation.** Drift can cause *"the character in the video to
resemble a celebrity and be blocked during review"* (A) — so an ID failure can surface as a
policy rejection rather than as a wrong face.

## Reference sentence patterns (A, verbatim)

```
Reference <Subject_N> in <Image_N> to generate ...
Reference <Action/Camera_movement/Style/Sound_effect> in <Video_N> to generate ...
Reference the timbre in <Audio_N> to generate ...
Refer to the [Camera Movement Description] from [Video N] to generate [Scene Description],
  keeping the scene consistent.
```

Critical disambiguation (A): for **edit or extend** tasks say `Video 1`, **not** "reference
Video 1", or the request is misrouted as a reference task.

Through this server, references reach the model via `input_references` + `reference_mode`;
the `@Image1` / `<Image_N>` notation is how you refer to them *inside the prompt text*.

## Admitted limitations (A) — quoted because they are unusually candid

From the technical report:

> Areas for improvement remain: minor deformation artifacts, motion plausibility in edge
> cases, high-frequency visual noise, audio distortion and noise, and lip-sync errors in
> multi-speaker scenes.

> There is still room for optimization in multi-subject consistency, text restoration
> accuracy, and the performance of complex editing tasks.

Quantified weak spots, all (A):

| Axis | Score | Comparison |
|---|---|---|
| Advanced camera movement | 2.71 | tied with Kling 3.0; nothing above 3.14 |
| First-frame preservation | 2.71 | Kling 3 Omni 4.31 — explicitly trades fidelity for motion |
| Video extension | 1.93 | Veo 3.1 2.78 |
| Joint image+audio conditioning | 2.29/3 | *"remains a difficult problem"* |

Physics cuts both ways: the report claims adherence to real-world motion laws, while also
admitting *"motion plausibility in edge cases."* Read it as a relative strength that is still
fragile on multi-body contact and fast interaction.

**Native resolution is 480p/720p** — 1080p and 4K are upscales. Combined with per-pixel
billing, that makes Seedance 4K poor value; see `models.md`.

## Discrepancies worth knowing

Three places where BytePlus documentation disagrees with OpenRouter's capability descriptor.
The descriptor is what this server validates against, so a call will be *accepted* either way
— but don't build on the disputed behaviour:

- **`seed`** — OpenRouter reports it supported; BytePlus says unsupported on 2.0 (accepted but
  likely ignored). Don't design a workflow that depends on reproducible seeds.
- **`camera_fixed`** — unsupported on 2.0; use prose ("fixed shot", "locked-off").
- **Audio channels** — the API says output is mono; the technical report claims binaural.

## Constraint trailer library (A, all verbatim)

```
HD, rich details, cinematic texture, natural colors, soft lighting
Keep it subtitle-free
Avoid generating any text or subtitles
Do not generate a logo
Do not generate a watermark
The character's face remains stable without deformation; movements are natural and smooth,
  with no stutter or flicker.
The characters' faces and body proportions remain stable without deformation. Movements are
  continuous and natural, not stiff, with no clipping or stutter.
Keep the same [subject], same [prop], and same [location] throughout. Make the shot sizes
  and angles clearly distinct, avoid repetition, keep the action continuous.
```

This trailer is the one place literal negation is documented to work. Use it.
