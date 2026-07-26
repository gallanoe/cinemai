# Task recipes

**(A)** official ByteDance, **(B)** community, **[LOCAL]** measured against this server.

Remember the two constraints that shape all of these: you cannot see the result, and a clip
costs dollars. Draft at 480p, commit at 720p.

---

## 1. Text to video, single shot

Fill the official formula. 40–200 words.

```
[Precise subject: 2–3 stable static features], [action with body part + range + speed +
force], in [scene/environment]. [Lighting and colour tone]. The camera [ONE move]
[amplitude/speed], ending on [end-frame composition]. [Visual style].
HD, rich details, cinematic texture, natural colours, soft lighting.
Keep it subtitle-free; do not generate a logo; do not generate a watermark. The character's
face remains stable without deformation; movements are natural and smooth, with no stutter
or flicker.
```

A worked example of the difference specificity makes (B, both actually generated):

> **Vague:** *A beautiful cinematic video of a dancer, stunning, 8k, masterpiece, epic.*
>
> **Visual:** *A flamenco dancer in a deep red dress drops into a low spin on a worn wooden
> stage, the skirt flaring wide before she snaps upright and stamps twice, dust lifting in the
> single hard spotlight above her. Shot from a low front angle on a long lens, the background
> falling into black, a warm amber grade with hard-edged shadows.*

The rule underneath: **motion is what the model animates, so spend words on verbs.**

---

## 2. Multi-shot sequence

The documented default for anything with more than one beat. Per-shot order is
**camera → action/expression → space → audio**; roughly 3 shots per 8–12s.

```
[Preamble: asset binding, subject definitions, global style]

Shot 1: [camera move / shot size]. [Subject] [action + expression]. [Position]. [Audio].
Shot 2: The camera cuts to [shot size]. [Subject] [action]. [Space]. [Audio].
Shot 3: [camera move]. [Subject] [action]. The camera [final move] and freezes on
        [final composition]. [Audio].

The entire video should be [style], with [colour tone] and [lighting]. The characters' faces
and body proportions remain stable without deformation. Movements are continuous and natural,
not stiff, with no clipping or stutter. Keep it subtitle-free.
```

**If you want no cuts**, say `single continuous take, no cuts` (B) — a long action
description otherwise gets silently broken into shots.

---

## 3. Animating a still (image to video)

`reference_mode: "first_frame"` (the default) with the image in `input_references`.

Two things to get right:

**Pass the source's aspect ratio.** This server always sends a ratio and defaults to `16:9`,
so animating a 9:16 still without setting `aspect_ratio` reshapes it.

**Describe only what changes.** The frame already establishes subject, wardrobe, lighting and
composition — restating them wastes attention budget and invites the model to re-render rather
than animate. Write the motion path, not the picture.

```
[What moves, as one continuous action with body part + range + speed].
The camera [ONE move], ending on [final framing].
[Ambience / SFX, or: no background music].
Preserve the subject's face, clothing and the scene layout exactly as in the reference frame.
Movements are natural and smooth, with no stutter or flicker.
```

Be aware of the honest limit: ByteDance's own benchmark scores **first-frame preservation at
2.71** against Kling 3 Omni's 4.31, describing it as producing *"more dynamic video at the
cost of lower first-frame fidelity"* (A). Seedance moves things; it does not treat your still
as sacred. If exact preservation matters more than motion quality, that is a reason to
consider a different model.

---

## 4. First and last frame pinned

Two images, `reference_mode` set per end. Describe **only the path between them** — the
endpoints are already supplied, and re-describing them is the main way this goes wrong.

Official example is a single line (A): *"The girl in the frame says 'Cheese' to the camera,
with a 360-degree orbiting camera shot."*

```
@Image1 is the first frame. @Image2 is the last frame — the final visual target, not a mood
reference.
Generate a continuous transition from [starting state] to [ending state].
Motion: [one physical action path].
Camera: [one controlled move that gets from framing A to framing B].
Lighting: [source and continuity].
Preserve [subject / product / logo / outfit] and the scene layout.
Constraints: no new text, no watermark, no identity change, no object redesign.
```

For transformations, name a **persisting carrier** — something that stays put while everything
else changes (B): `the bottle stays fixed at centre frame throughout`. Without an anchor the
model has nothing to hold onto and the transition becomes a dissolve.

---

## 5. Character consistency across clips

Consistency rests on the **definition protocol**, not on references alone.

1. Define labels in a preamble, then never use a pronoun:
   `Define [features] in Image 1 as <NAME_1>, and define [features] in Image 2 as <NAME_2>.`
2. Supply a **headshot plus a full body** — not a multi-view turnaround sheet, which is what
   triggers the twin defect (A).
3. Bind roles explicitly and state what must *not* transfer (B):
   `@Image1 controls subject identity only. @Video1 controls camera pace only. Do not copy
   characters, logos, music, or environment from @Video1.`
4. Repeat the same identity traits word for word in every clip of a series.

Add the anti-twin trailer whenever more than one similar character shares the frame (A):

```
Throughout the video, characters with completely identical appearance, clothing, and
accessories are prohibited. Do not generate duplicate avatars or a twin effect. Keep only a
single corresponding character in the same frame.
```

Note the escalation path: drift can make a character *"resemble a celebrity and be blocked
during review"* (A) — so an identity problem can surface as a moderation rejection.

---

## 6. Dialogue and sound

See `audio.md` in full before writing any audio prompt — it is the riskiest surface here.
The short version:

- Decide first whether you want audio at all. If not, `generate_audio: false`.
- Dialogue in **double quotes** through this server.
- **5–10 English words per line.** Split speeches across cuts.
- Request silence explicitly if you want it — `no background music`.
- If lip-sync fails, remove a face or remove a camera move rather than rewriting the line.

---

## 7. Iterating

You cannot see the result, so iteration is a conversation with the user, not a self-check.
That changes the economics:

- **Draft at 480p.** A 5s draft is about **$0.27** on `seedance-2.0`, versus $0.76 at 720p and
  $1.70 at 1080p [LOCAL formula].
- **Change one variable per attempt.** With no ability to inspect, a multi-variable change
  leaves you unable to attribute the difference from the user's description.
- **Ask the user what specifically was wrong** — motion, framing, pacing, identity, audio.
  The failure→fix table in `troubleshooting.md` is organised by symptom for exactly this.
- When the composition is right and only the motion is wrong, keep the prompt and change the
  motion clause alone. When the composition is wrong, consider supplying a first frame instead
  of describing it — an image is cheaper to iterate on than a video.

That last point is worth taking seriously: **generating a still first, then animating it**, is
often cheaper and more controllable than trying to land a composition through video prompts.
Use `generate_image` to settle the frame, then pass the handle as `input_references`.
