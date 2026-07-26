# Failure → fix

You cannot watch the clip, so diagnosis starts with asking the user *what specifically* was
wrong — motion, framing, pacing, identity, artifacts, or audio. This table is organised by the
symptom they'll describe.

**(A)** official ByteDance, **(B)** community, **[LOCAL]** measured here.

## Motion and stability

**Smearing, warping, or the image "coming apart" during a move.** Almost always more than one
camera move in a single shot. ByteDance is explicit (A): *"Try to specify only 1 type of
camera movement in a single shot. Do not require push, pull, pan, and move at the same time,
as this will increase image instability."* Split the compound move across `Shot 1` / `Shot 2`.
The same applies to stacked *actions* — one clear action per shot.

**The camera drifts, or the move goes somewhere you didn't intend.** The move had no
destination. Terminate every camera instruction with where it lands: *"slow dolly-in from a
medium two-shot to a tight single on her hands."* The official mini-formula is
`starting frame composition + move + amplitude + ending frame composition` (A).

**Nothing much moves — a "slideshow".** Too much description of state, not enough verb. Add
body part, range, speed and force. Give physics something to chase: *"leaves scatter on each
impact"*, *"the mug slides and tips"* — not "windy", "clumsy".

**Limbs multiply, faces deform, proportions swim.** Usually large or fast action. Seedance's
docs advise preferring *"slow, gentle, coherent subtle movements"* and avoiding
*"high-burst, large-dynamic actions"* (A). Reduce the motion, then add the official
stability trailer: *"The characters' faces and body proportions remain stable without
deformation. Movements are continuous and natural, not stiff, with no clipping or stutter."*

**Morphing and camera drift are the same defect — which means one fix treats both.** Kling's
documentation explains the mechanism, and it is the single most useful thing to understand
about video artifacts: because these systems *"often lack 3D awareness, they struggle to
distinguish between a camera moving and the actual world changing shape, leading to the
surreal melting effects we often see."* (B, Kling)

So a warping subject and an unintentionally drifting camera are one problem wearing two
faces. **Pinning the camera reduces subject warping**, even when you didn't think the camera
was the issue — "static shot", "fixed lens", "locked-off tripod", "the camera remains
completely still". If a clip is melting and you can't see why, freeze the camera first and
re-render before touching anything else.

**A warped or wrong-looking face specifically.** Consider that this may be a *policy* outcome
rather than a quality one — Seedance is reported to fail silently into distortion on
likeness-policy hits rather than refusing cleanly (B). If the subject resembles a real person,
that's the likely cause, and no amount of prompt tuning fixes it.

**Cuts appeared when you wanted one continuous shot.** The obvious fix is to say
`single continuous take, no cuts` (B) — but try the counter-intuitive one first. Runway
documents that an unwanted cut usually means *"your image and prompt combination would benefit
from a higher duration. First, try increasing the duration… If cuts continue, check your
prompt for phrasing that might indicate a cut and consider adding a prompt component like
`Continuous, seamless shot`."* (B, Runway)

The logic generalises: a cut appears when there is more action than the duration can hold, so
the model compresses by jumping. **Give the action more seconds before you give it more
words.** Seedance's 1-second duration granularity makes this cheap to test — 6s instead of 5s
costs about $0.15 more at 720p.

**Camera and subject motion got conflated** — e.g. you asked the subject to circle and the
camera orbited instead. Verbs like *moves right, follows, circles, rises* apply to both. Make
**"The camera"** the explicit grammatical subject of camera clauses and a named label the
subject of action clauses, in separate clauses. Never "we push in", never a bare participle.

## Identity and subjects

**The character changed between clips.** Consistency rides on the definition protocol, not on
references alone. Define labels in a preamble and never use a pronoun; repeat the same
identity traits word for word in every clip. Supply a **headshot plus a full body**, not a
multi-view sheet.

**Two identical characters appeared.** The documented "twin" defect (A), triggered especially
by multi-view reference sheets with several characters in frame. Explicitly *"not possible to
directly avoid 100%"*. Mitigate with the anti-twin trailer in `tasks.md` §5, and stop
supplying turnaround sheets.

**The subject drifted out of frame.** Bind the framing at the end of the camera instruction,
and name where the subject sits in the final composition.

**A first frame was supplied but the model re-rendered rather than animated it.** Partly
expected: Seedance scores **2.71 on first-frame preservation** and explicitly trades fidelity
for dynamism (A). Reduce the motion asked for, add explicit preservation language, and stop
restating what the frame already shows. If exact preservation matters more than motion, this
is a reason to switch models.

## Frame and format

**The clip came back the wrong shape.** `aspect_ratio` defaults to `16:9` and is *always*
sent, including when you supply a reference image. Pass the source's ratio explicitly when a
reference establishes the framing.

**Requested 1080p and it was rejected.** The server default `seedance-2.0-fast` supports only
480p and 720p. Name `bytedance/seedance-2.0`.

**Unrequested subtitles burned into the frame.** Documented (A), and *"not possible to
directly avoid 100%."* Three mitigations: `Keep it subtitle-free` in the trailer; strip text
from reference assets before using them; and — non-obviously — **prefer landscape**, since
*"the probability of generating subtitles in landscape is significantly lower than in
portrait"* (A). For vertical delivery, consider rendering 16:9 and cropping.

**A platform logo or watermark appeared that you never asked for.** Documented hallucination
(A). Add `Do not generate a watermark` and `Do not generate a logo`. Distinguish this from the
`watermark` *parameter* — that defaults to false and isn't exposed here anyway, but note that
ByteDance's own sample code passes `watermark=True`, so copying their snippets elsewhere
inherits a visible mark.

**Text in the video is garbled.** Prefer common characters; avoid rare glyphs and special
symbols (A). For an exact wordmark, supply an image reference rather than describing the text.
Anything with strict internal logic — counters, clocks, progress bars, ordered reveals — should
be driven by a reference video, not by text; ByteDance's own example is a countdown that
*"jumps randomly and fails to follow standard countdown logic"* (A).

## Style

**Drifted to live-action when you wanted stylised.** Documented (A): if the reference image is
realistic and the prompt doesn't insist on style, the output drifts realistic. Add an explicit
style constraint — *"2D Japanese anime style"* — or, for precise control, restyle the reference
image first and then generate.

**Generic over-polished "AI video" look.** Same cause as in image prompting: superlatives.
Delete "stunning, cinematic, epic, 8k, masterpiece" — ByteDance's own negative example is
punished precisely for *"the scene feels very cinematic."* Replace with concrete facts: soft
side backlight, wet asphalt reflections, locked medium shot, quiet room tone.

## Audio

See `audio.md` for the full surface. Symptom shortcuts:

| Symptom | Fix |
|---|---|
| Job failed with output-audio / sensitive-content error | Non-deterministic copyright screen on the *generated* audio. **Retry with jitter first**; rewrite only if it repeats. `generate_audio: false` removes the risk class |
| Music you never asked for | `generate_audio` defaults **true**. Pass `false`, or add `no background music, silent, no sound` |
| Lip-sync drifts | Shorten lines to 5–10 English words and split across cuts. If still failing, **remove a face or remove a camera move** — sync tightens with each additional head and each camera motion (B) |
| Click or cut-off noise at the end of a narrated clip | Documented (A) and **unfixable in-prompt**. Fade the tail in post |
| Voice doesn't match the reference | Add explicit timbre adjectives alongside the reference (A) |
| Audio doesn't match across clips in a sequence | Expected — audio is independent per call. Lay the score in post |

## Job-level failures

**Job marked failed after ~10 minutes.** `VIDEO_POLL_TIMEOUT_MS` is 10 minutes. Seedance 4K is
reported at 4–8 minutes, so long high-resolution renders sit close to the ceiling. Drop the
resolution or the duration, or raise the constant.

**`fetch failed` with no detail.** Seen on the image endpoint with large multi-reference
payloads and with long-running requests [LOCAL]. If references are involved, reduce their
number or size; otherwise retry once before treating it as real.

**Cost was far higher than expected.** Seedance bills per pixel-second, so resolution
dominates. 4K is ~9× the per-second cost of 720p on the same model, and is an upscale from
native 480p/720p. Check `models.md` before committing to a high-resolution render.
