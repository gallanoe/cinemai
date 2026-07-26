# Choosing a video model, and what it costs

Capability rows are from OpenRouter's live descriptors — treat those as ground truth.
**[LEADERBOARD]**, **[OFFICIAL]**, **[INDEPENDENT]**, **[LOCAL]** label everything else.

## Capability table

| Model | Resolutions | Aspect ratios | Durations (s) | Frames | Audio | Seed |
|---|---|---|---|---|---|---|
| `bytedance/seedance-2.0` | 480p→4K | 7, incl. 21:9 / 9:21 | every int **4–15** | first + last | yes | reported, disputed |
| `bytedance/seedance-2.0-fast` | 480p, 720p | same 7 | 4–15 | first + last | yes | same |
| `bytedance/seedance-1-5-pro` | 480p→1080p | same 7 | 4–12 | first + last | yes | yes |
| `google/veo-3.1` | 720p→4K | **16:9, 9:16 only** | **4, 6, 8** | first + last | yes | yes |
| `google/veo-3.1-fast` | 720p→4K | 16:9, 9:16 | 4, 6, 8 | first + last | yes | yes |
| `google/veo-3.1-lite` | 720p, 1080p | 16:9, 9:16 | 4, 6, 8 | first + last | yes | yes |
| `openai/sora-2-pro` | 720p, 1080p | 16:9, 9:16 | 4, 8, 12, 16, 20 | **none** | yes | **no** |

Also available: `kwaivgi/kling-v3.0-pro`, `kwaivgi/kling-v3.0-std`, `kwaivgi/kling-video-o1`,
`minimax/hailuo-2.3`, `alibaba/wan-2.7`, `alibaba/wan-2.6`, `x-ai/grok-imagine-video-1.5`,
`alibaba/happyhorse-1.1`.

## Sora 2 Pro is deprecated — do not build on it

OpenAI announced deprecation of the Videos API and every Sora 2 alias on 2026-03-24, with
**shutdown on 2026-09-24** and no successor [OFFICIAL]. Its missing image input and missing
seed are moot; just don't select it.

## Capability walls that settle a brief outright

- **Anything wider than 16:9 or taller than 9:16** must be Seedance (or Kling/Wan) — Veo and
  Sora offer exactly two ratios. Seedance is the only model here reaching **21:9 and 9:21**.
- **Any duration that isn't 4, 6 or 8 seconds** rules out Veo. Seedance gives every integer
  from 4 to 15, which is the widest granularity available.
- **Animating a supplied still** rules out Sora entirely.
- **1080p or above** rules out `seedance-2.0-fast`, the server default.

## Cost

Seedance bills per **video token**; Veo and Sora bill per **second**. That difference inverts
the ranking at high resolution, so compute rather than assume.

```
tokens = (width × height × fps × duration) / 1024        at 24 fps
```

Verified: a `seedance-2.0-fast` 4s/480p clip predicts **$0.21504** against a measured
**$0.2152** [LOCAL] — 0.07% off.

**Per second:**

| | 480p | 720p | 1080p | 4K |
|---|---|---|---|---|
| `seedance-2.0` | $0.067 | $0.151 | $0.340 | $1.361 |
| `seedance-2.0-fast` | $0.054 | $0.121 | — | — |
| `veo-3.1` | — | $0.40 w/ audio, $0.20 without | same | $0.60 / $0.40 |
| `veo-3.1-lite` | — | $0.05–0.08 | $0.08 | — |

**Worked comparisons:**

| Job | Seedance 2.0 | Veo 3.1 | Veo 3.1 Lite |
|---|---|---|---|
| 5s @ 720p | **$0.76** | $2.00 | ~$0.40 |
| 8s @ 4K | **$10.89** | $4.80 | **$0.64** |

Two things fall out. **Aspect ratio is free on Seedance** — the pixel budget is constant, so a
21:9 clip costs exactly what 16:9 does. And **4K on Seedance is bad value twice over**: it is
~17× Veo Lite, *and* it is an upscale, because Seedance's native resolution is 480p/720p
[OFFICIAL]. If you need 4K, use Veo. If you need Seedance's motion at 4K, render 720p and
upscale in post.

`seedance-1-5-pro` is roughly a third of 2.0's token price and worth considering for volume
work where the extra quality isn't load-bearing.

## Quality, as far as anything is measurable

Artificial Analysis has **Seedance 2.0 at #2 overall (1228 Elo)** [LEADERBOARD], about 130 Elo
above every Veo tier, and first among the models on this platform for both text-to-video and
image-to-video, with and without audio. `wan-2.7` (1164) and `happyhorse-1.1` (1153) also
outrank all Veo tiers and are worth A/B-ing if you're exploring.

**The three Veo tiers are statistically indistinguishable** — 1096 / 1093 / 1092 on 5:1.5:1
pricing [LEADERBOARD]. Full `veo-3.1` is almost always waste; if you want Veo, take Lite.

Treat these as directional. This topic's search results are heavily polluted by AI-generated
SEO content that contradicts both itself and the provider docs, and no hands-on comparison
from a major outlet appears to exist.

## Latency

Everything is an async job. A `seedance-2.0-fast` 4s/480p clip took **~136s** end to end
[LOCAL] — which is the cheapest, smallest, fastest configuration available, so treat it as a
floor. Budget **2–4 minutes** at 480p/720p and **4–8 minutes** for Seedance 4K
[INDEPENDENT].

Note the collision: this server marks a job failed after **10 minutes**
(`VIDEO_POLL_TIMEOUT_MS`). At the top of the 4K range that is thin headroom.

A widely-copied claim of "22 seconds per 5-second clip" contradicts the local measurement by
~6× and appears to be recycled Seedance 1.0 marketing. Discard it.

## Task → model

| Task | Model | Why |
|---|---|---|
| Cheap iteration / drafting | `seedance-2.0-fast` @ 480p | ~$0.054/s; a 5s draft is $0.27 |
| General best quality | `seedance-2.0` @ 720p | Top of the leaderboard here; $0.151/s |
| Ultra-wide 21:9 or vertical 9:21 | `seedance-2.0` | The only model here that reaches them, and ratio is free |
| Clip longer than 8s | `seedance-2.0` | Veo caps at 8; Seedance goes to 15 |
| Odd duration (5s, 7s, 11s) | `seedance-2.0` | Only model with 1-second granularity |
| Animating a still | `seedance-2.0`, or Veo if first-frame fidelity matters more than motion | Seedance scores 2.71 on first-frame preservation and trades fidelity for dynamism |
| Character consistency | `seedance-2.0` | Its advertised strength; see the definition protocol in `seedance-2.md` |
| 4K final | `veo-3.1-lite` | ~17× cheaper than Seedance 4K, and Seedance 4K is an upscale anyway |
| Volume work, quality not critical | `seedance-1-5-pro` | ~⅓ the token price of 2.0 |

## Gotchas beyond Seedance's own

- **Veo deletes outputs after 2 days** [OFFICIAL] — save anything you want to keep with
  `save_output` promptly.
- **Veo's seed does not guarantee determinism** [OFFICIAL].
- **Veo's `negativePrompt` is not exposed by this server**, so its one real advantage over
  Seedance on exclusions is unavailable here. Phrase exclusions positively regardless of model.
- **Seedance can fail silently into distortion** on likeness-policy hits rather than refusing
  cleanly [INDEPENDENT] — a warped face may be a policy outcome, not a quality problem.
