# Audio

Audio is the highest-risk surface on this endpoint, for a reason that is easy to miss:
**`generate_audio` defaults to `true` upstream**, so every clip is an audio clip whether you
wrote an audio prompt or not — and the generated audio is screened for copyright *after*
generation, meaning you can pay for a render and then have it rejected.

**(A)** = official ByteDance; **(B)** = community/third-party.

## Start here: decide whether you want audio at all

If the clip doesn't need diegetic sound, **pass `generate_audio: false`**. This removes an
entire class of paid-then-rejected failure and is the cheapest structural mitigation there is.

If you want sound but not a score, say so literally in the constraint trailer:

```
no background music, silent, no sound
```

An open prompt that says nothing about sound *"rarely comes back quiet"* — practitioners
report it arriving *"scored like a car advert"* (B). Silence is a thing you request, not a
default you inherit.

## The copyright rejection, and how to handle it

The observed failure on this server was a job dying after ~130s with *"the output audio may
contain sensitive information."* Reported upstream error (B):
`OutputAudioSensitiveContentDetected`, with the underlying check described as matching audio
copyright rules.

What matters operationally:

- **It runs on the generated output, not your input.** A prompt that passes input screening
  can still fail after the paid render completes.
- **It is non-deterministic.** The rejected artifact is the sampled audio, not the prompt, so
  the same prompt can pass on retry.
- **Seed won't pin a known-good sample** — seed is unreliable on Seedance 2.0 anyway.
- Therefore **retry-with-jitter beats rewriting** on a first failure. Rewrite only if it
  repeats.
- Highest-risk content: song lyrics, named artists, catchphrases, anything resembling a real
  person's voice, and politically or violently charged dialogue.
- The most common trigger is the **auto-generated background music you never asked for** —
  which is exactly what `generate_audio: false` or an explicit `no background music` removes.

## Dialogue

Two official conventions coexist, and both are shipped in ByteDance examples:

- **Double quotes** — the API reference form: *"It is recommended to put dialogue content in
  double quotes."*
- **`{}` braces** — the 2.0 prompt guide's symbol table.

**Through OpenRouter, prefer double quotes.** The bracket typology below is documented only
on ByteDance's own surfaces, and (B) reports it unverified on third-party gateways. Double
quotes are the safe form here; treat the brackets as an optional extra rather than a
dependency.

**Voice direction triple (A, verbatim pattern):**

```
In a [emotion] emotional state, with a [tone] tone and a [pace] speaking pace, say: "..."
```

Official examples: *"In a calm emotional state, with an even tone and a normal speaking pace,
say: 'Let's begin with what matters most.'"*

**Multi-speaker script form (A)** — visuals and camera first, then a language header, then
speaker rows:

```
[Visual + camera description].
The group speaks in English:
White female: "So… what's our next step?"
Black male: "We need a clearer direction."
```

Speaker labels double as subject labels, so make them descriptive enough to bind.

### Keep lines short — this is the main lever on lip-sync

Lip-sync is supported to a stated *"millisecond-level"* precision (A), across Mandarin and
major Chinese dialects, English, Japanese, Korean, Spanish and Indonesian. But the *reliable*
budget is far below the acoustic one (B):

| Language | Reliable sync in ~15s | Per line |
|---|---|---|
| Mandarin | strongest | one short clause |
| English | ~16–20 words before the mix compresses | 5–10 words |
| Japanese | weaker, mora-timed | one short line |
| Russian | ~10–15 words | under 10 words |

Split a speech across cuts rather than writing a monologue. This corroborates the technical
report's own admission of *"lip-sync errors in multi-speaker scenes"* (A).

**The mechanism, which tells you what to do when sync fails (B):** audio denoises jointly
with the picture, so named sound events act as synchronisation targets and lip-sync is a joint
constraint across both streams — *"every extra head or camera motion tightens it."* So when
sync is failing, **remove a face or remove a camera move**; don't rewrite the line.

**For a specific voice or a weakly-supported language**, attach a real voice clip as a
reference and let the model lip-sync to it rather than synthesising. This is the strongest
field-reported technique (B). Where timbre drifts, the official fix is to *describe* the voice
alongside the reference (A, verbatim): *"Use the low, thick, warm, and finely grainy
middle-aged male voice of @Audio 1 to say…"*

## SFX, ambience and music

Supported types (A): environmental sounds, action effects, synthesized audio, instruments,
background music, vocals. BGM is generated automatically by default.

**Beat sync is prompt-controllable (A, verbatim example):** *"The background music is a
snippet of a fast-paced pop song. The requirement is for this cartoon character to clap hands
in time with the drumbeats of the music."*

**Audio as a clock (B)** — tie each musical landmark to exactly one visible event:
`cut on the beat; the turn lands on the drop; the door slams on the final hit`. Rules: one
event per beat, since stacked events smear; works with clean percussion, not dense mixes; and
make it the *only* clock — don't also supply a timestamp list. Reported #1 audio bug is
reference-audio conflict; fix by making video references silent when audio timing must
dominate, or by stating that the video controls camera only while the audio controls tempo only.

## The bracket typology (ByteDance surfaces)

Documented (A) but **not verified through third-party gateways** (B). Use double quotes for
dialogue here; this is reference for when it's relevant.

| Type | Symbol | Official example |
|---|---|---|
| Music | `（）` | `（fast-paced rock music is playing in the background）` |
| Sound effect | `<>` | `<dog barking can be heard in the distance>` |
| Dialogue | `{}` | `{Hello, world}` |
| Subtitles | `【】` | `【Chapter One: Departure】` |

## Subtitles

Official template (A, verbatim): *"Display subtitles at the bottom-center with the text. The
subtitles must be perfectly synchronized with the audio rhythm and pacing."*

Speech bubbles (A): `[Character] says, "[Dialogue]." Speech bubbles appear around the
character containing the spoken text.`

**Unrequested subtitles are a known defect (A)** and *"it is not possible to directly avoid
generating subtitles 100%."* Three documented mitigations: put `Keep it subtitle-free` in the
trailer; strip text from reference assets before using them; and — genuinely non-obvious —
**prefer landscape**, since *"the probability of generating subtitles in landscape is
significantly lower than in portrait."* For vertical output, consider rendering 16:9 and
cropping.

## Known audio failure modes

| Symptom | Status | Handling |
|---|---|---|
| Copyright rejection after render | (B) reported, [LOCAL] observed | Retry with jitter; `generate_audio: false` if sound isn't needed |
| Click or cut-off noise at clip end on narrated clips | (A) documented | **Unfixable in-prompt.** Budget a post step — fade the tail |
| Mispronounced uncommon or polyphonic characters (Chinese) | (A) documented | Substitute a homophone in the prompt; only a partial fix |
| Voice reference drifts | (A) documented | Add explicit timbre adjectives alongside the reference |
| Audio not continuous across separate calls | (B) | Lay the unifying score in post; each call's audio is independent |
| Model invents dialogue you didn't write | (B) | Name the sounds you want and request silence explicitly |

Two structural notes: output is **mono** per the API reference, and audio does not carry
across calls — a multi-clip piece needs its score assembled afterwards regardless.
