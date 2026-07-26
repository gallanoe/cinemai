# CinemAI MCP

An MCP app server that generates images and videos via
[OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
and displays them in an inline widget — without dumping media bytes into the conversation.

## The design in one picture

```
generate_image  ──> {handle, status: "running"}          the model sees this (~285 bytes)
                └─> widget polls get_job
                        └─> data: URL                     the model never sees this
generate_video  ──> {handle, status: "running"}          the model sees this
                └─> widget polls get_job
                        └─> get_output_chunk ─> Blob      the model never sees this
view_image      ──> image content block, 768px            the model sees this ON REQUEST
Download button ──> get_output_chunk ─> full-res file     the USER saves this (host download)
save_output     ──> full-res file in the export folder    the AGENT saves this to the workspace
```

Delivery paths by audience: **handle** for the model, **`data:` URL** (image) or **Blob from
streamed chunks** (video) for the eye, **`view_image`** for opt-in inspection, and two
full-resolution exits — the widget's **Download button** (user) and **`save_output`** (agent). None
of the full-res paths put bytes in the conversation.

### Why it's built this way

**OpenRouter's image endpoint is synchronous.** `POST /api/v1/images` blocks for the full
10–90s generation and returns base64. There are no job ids upstream, so the async layer is ours:
`generate_image` starts the work, persists a job record, and returns in ~45ms without awaiting.
A blocking `tools/call` would freeze the conversation turn and risk host request timeouts.

**Image bytes never enter chat context.** Tool results carry only a handle. This is a deliberate
product decision, and it also sidesteps the ~150k-char host truncation cap — a single 2K PNG is
roughly 3× that as base64. When a result exceeds the cap the host substitutes a file-pointer
string, the widget's `JSON.parse` throws, and the failure looks nothing like a size problem.

**Pixels reach the widget as `data:` URLs over `callServerTool`, not HTTP image URLs.** Cowork
has a per-task execution toggle ("This task will run on your computer"), so the execution
environment is a user-flippable setting, not a fixed property. A `http://localhost:3000/img/<id>`
reference would work in local mode and break the moment someone toggles. The `data:` path rides
the MCP connection itself and is correct either way.

**Full-resolution bytes never fit a single tool result, so they're never sent as one.** The same
~150k cap that keeps generation bytes out of chat also bounds the widget's Download button: a full
2K PNG is ~1.4–2M base64 chars, ~10× over. The button therefore streams the image through
`get_output_chunk` in <100k-char **base64-string** slices and reassembles them in the widget — the
slices are of the base64 text, not the raw buffer, so boundaries never land mid-triplet and plain
concatenation restores the bytes exactly. `save_output` sidesteps the cap entirely by copying on
disk and returning only a path. Both ride transports that are correct under either execution mode.

**Video is doubly async, so the poll loop lives server-side.** Unlike images, `POST /api/v1/videos`
returns a job id immediately and the clip is fetched by polling upstream until `completed`, then
downloading an MP4 from `unsigned_urls`. That means two async layers: ours (so `generate_video`
returns instantly) and OpenRouter's. `runVideoJob` owns the upstream poll loop in the background
and writes the finished MP4 to `data/videos/`, so the widget polls exactly one thing — our
`get_job` — and never learns that upstream polling exists.

**Video also reaches the widget over the MCP connection — the host's CSP leaves no alternative.**
The obvious design is to serve clips from `GET /media/<id>.mp4` and let `<video>` use HTTP range
requests: first frame in milliseconds, real scrubbing, only the needed bytes fetched. That was
built, and it does not work in the host. Widget iframes are served under `default-src 'self'`, so
`media-src` resolves to the iframe's own origin and the request is blocked *before it is sent* —
Claude Desktop reports violations of both `media-src` and `connect-src` for the URL, and the server
log stays empty because nothing ever reaches the network. No port, CORS header, or
`CINEMAI_PUBLIC_BASE_URL` value changes this; the policy is set by the host.

So clips ride the same channel as everything else: `get_output_chunk` streams base64 slices, the
widget reassembles them into a `Blob` and plays that. The costs are real and worth stating — the
whole file must arrive before playback starts, and a 5s 720p clip is ~1.8M base64 chars across ~19
slices. Two things soften it: slices after the first are fetched **concurrently** (the first reports
`totalChars`, which makes every remaining offset computable up front — measured ~5.8× faster than
the serial chain), and once loaded, seeking is instant because the entire clip is in memory. That
last point also makes `moov`-at-the-end files a non-issue, which matters because the clips these
models return are *not* faststart.

`GET /media/<id>` remains, and still supports range requests — it is simply not what the widget
uses. It is genuinely useful outside the iframe (a browser, `curl`, VLC) and is the value the
`video://gen/<id>` resource hands back.

## Reachability, TLS and the missing authorization

The server binds **loopback only** (`CINEMAI_HOST`, default `127.0.0.1`). That default is
deliberate and was a fix, not an original choice: `app.listen(port)` with the host omitted
makes Node bind every interface, which put an **unauthenticated `/mcp` on the local network**.
Measured before the change — `LISTEN *:3998`, `http://192.168.4.24:3998/health` → 200, and an
unauthenticated `POST /mcp` → 200. Anyone able to reach the port could spend the API key.

**TLS is opt-in** via `CINEMAI_TLS_KEY` + `CINEMAI_TLS_CERT`; with neither, the server stays
plain HTTP, which is the right default for local use. The motivating case is a host that will
only accept an `https://` connector URL — Cowork does. For a locally-trusted pair:

```bash
brew install mkcert && mkcert -install
mkcert localhost 127.0.0.1 ::1
```

mkcert matters rather than being a convenience: a self-signed certificate will complete the
TLS handshake but clients reject it, because nothing vouches for it. `mkcert -install` adds a
local CA to the system trust store so the certificate actually validates.

**`CINEMAI_AUTH_TOKEN` guards `/mcp`** as `Authorization: Bearer <token>`. Unset means no
check, which is fine while bound to loopback. It stops being optional the moment anything else
can reach the port — and note that **HTTPS is encryption, not authorization**. Putting the
server behind a tunnel to obtain an https URL converts "people on my wifi" into "everyone",
and every call spends OpenRouter credits. The boot log warns when the server is reachable
off-machine without a token.

`/media/<id>` is deliberately left ungated: those URLs carry unguessable job ids, are
read-only, and are handed to players that cannot set headers.

Verified: HTTPS serves (200), the gate returns 401 for a missing and a wrong token and 200 for
the right one, and a LAN request to the loopback-bound port is refused.

### Terminating TLS elsewhere

For a real deployment, a reverse proxy that owns certificate renewal is the better answer, and
this stays out of its way by defaulting to HTTP — Caddy is three lines and handles Let's
Encrypt issuance and renewal itself. A tunnel (`cloudflared tunnel --url http://localhost:3000`,
Tailscale Funnel) gets you an https URL with no certificate handling and no open inbound port,
which is the least-effort route when the server should stay on your machine. In both cases set
`CINEMAI_PUBLIC_BASE_URL` to the external https URL, or the `/media` links in `get_job` and the
`video://gen/<id>` resource keep pointing at `http://localhost`.

## Deployment model: local-first

This server is designed to **run on the user's own machine**. It can be hosted remotely — nothing
in the transport assumes otherwise — but two things are meaningfully better locally:

- **Reference images by file path.** `input_references` accepts an absolute path so the user can
  say "use this photo" about a file they already have. A remote server has no access to that
  filesystem, and the path resolves to a clear error rather than silently doing something else.
- **Generated images and videos stay on the user's disk** under `data/`, rather than accumulating
  on a shared host.
- **Video playback in the widget is transport-independent.** Clips stream over the MCP connection,
  so playback works wherever the server runs. `CINEMAI_PUBLIC_BASE_URL` only affects the
  out-of-band `/media` URL.

This does **not** retract the `data:` URL decision for images. Cowork's per-task execution toggle
means even a "local" deployment can move the *agent*, so pixels still reach the widget over the MCP
connection rather than via `http://localhost`. Video is the deliberate exception, and only because
the widget iframe itself renders host-side on the user's machine regardless of where the agent
runs. Local-first is the target; it is not an assumption the image transport makes.

## Setup

```bash
npm install
cp .env.example .env      # add your OPENROUTER_API_KEY
npm run build
npm start
```

> **The `.env` file is what the server reads.** Two processes are involved and only one is ours:
> Claude Desktop spawns `npx mcp-remote`, while *you* start this server separately. The `env`
> block in `claude_desktop_config.json` therefore configures `mcp-remote`, **not** this server.
> Putting the key there looks right and fails at boot.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{ "mcpServers": { "cinemai": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "http://localhost:3000/mcp",
           "--allow-http", "--transport", "http-only"]
}}}
```

`--transport http-only` matters — the SSE probe otherwise swallows widget-capability negotiation.

Desktop caches UI resources aggressively. After editing `widgets/job.html` or
`widgets/video.html`, **fully quit** (⌘Q, not window-close) and relaunch.

## Development

```bash
npm run smoke -- "a lighthouse at dusk"   # hit OpenRouter directly, write a PNG to data/smoke/
npm run dev                               # tsc --watch + node --watch
```

**Widget preview** — iterate on widget HTML/CSS in a normal browser tab with real devtools,
skipping the Desktop quit-relaunch cycle entirely:

```
http://localhost:3000/widget-preview?payload={"jobId":"<id>"}&theme=dark
http://localhost:3000/widget-preview?widget=video&payload={"jobId":"<id>"}
```

The preview injects a fake `ExtApps` shim whose `callServerTool` proxies to `/dev/tool/<name>`
(`get_job` and `get_output_chunk`), so polling, rendering, and the chunked Download button all
exercise real handlers. The shim's `downloadFile` just logs the resource block rather than saving.
`?widget=video` previews the video widget. Note the preview page runs same-origin in a normal tab,
with none of the host's CSP — so it is the wrong place to test whether a transport is *permitted*.
It exercises the chunk-streaming playback path, not the iframe's restrictions.

## Tools

| Tool | Visibility | Returns |
|---|---|---|
| `generate_image` | model | `{handle, jobId, kind, status, prompt, model}` — no bytes, ~45ms; optional `resolution`, `quality`, `background`, `output_format`, `output_compression`, `aspect_ratio`/`size`, `seed`, `input_references` |
| `generate_video` | model | same shape with `kind: "video"` and a `video://gen/<id>` handle; optional `duration`, `resolution`, `generate_audio`, `input_references` + `reference_mode` |
| `get_job` | widget only (`_meta.ui.visibility: ["app"]`) | status + display-sized `data:` URLs (image) or a media URL (video) |
| `get_output_chunk` | widget only (`_meta.ui.visibility: ["app"]`) | one full-res image or video as a base64-string slice, for the Download button |
| `view_image` | model | image content block, downscaled to 768px; rejects video handles |
| `save_output` | model | copies the full-res image **or** video to the export folder or an absolute `dest`; won't overwrite unless `overwrite: true`; returns the path, no bytes |

`image://gen/<id>` and `video://gen/<id>` are also registered as resource templates so a user can
deliberately attach a generated file. They complement `view_image` rather than replacing it: in
most hosts resources are user-driven, so the tool is what makes an image reachable by the *model*.
The video resource returns its media URL rather than inlined bytes, for the size reason above.

### Video generation

`generate_video` mirrors `generate_image` but targets OpenRouter's async video API. Because a clip
costs meaningfully more and takes 30s–several minutes, the tool description steers the model toward
short durations and a fast default model (`bytedance/seedance-2.0-fast`, overridable via
`CINEMAI_DEFAULT_VIDEO_MODEL`).

`input_references` accepts the same three spec forms as images (handle / `https://` URL / absolute
path) and is paired with `reference_mode`:

- `first_frame` (default) — the image becomes the clip's opening frame (image-to-video)
- `last_frame` — the clip ends on it
- `style` — passed as loose `input_references` guidance without pinning either end

The first two send `frame_images`; `style` sends `input_references`. Upstream treats `frame_images`
as taking precedence, so only one is ever sent.

**Videos cannot be loaded into model context.** There is no video equivalent of `view_image` — the
model gets a handle, the user watches the clip. Extracting a still frame for the model to inspect
would need `ffmpeg` and is deliberately deferred.

`view_image`'s description states its token cost. That sentence is the main lever on whether the
model reads every image reflexively or only when seeing it actually matters.

## Full-resolution exits: Download button and `save_output`

Two ways to get the real file out, for two actors.

**The widget Download button** is user-driven. It streams the full-res image through
`get_output_chunk` (see the rationale above) and hands the reassembled base64 to the host's
`downloadFile` — the host owns the save location, exactly like a browser download. This makes the
whole "which filesystem does the container see" question moot: nothing is written server-side and
no path is guessed. `downloadFile` takes MCP resource content blocks
(`{contents: [{type: "resource", resource: {uri: "file:///name.png", mimeType, blob}}]}`), and the
saved filename is the `file:///` URI's basename — **not** a flat `{name, content}` object.

**`save_output`** is agent-driven, for "keep this / put it in my project" without a human clicking.
It offers two ways to choose where the file lands:

- **Default — the export folder.** With no `dest`, files go into `CINEMAI_EXPORT_DIR` (default
  `~/Documents/Claude` — Cowork's hardcoded working directory on macOS, the highest-probability
  folder mounted into a sandboxed agent's workspace). `filename` names the file and may include
  subfolders. The result reports the workspace-relative name (how a sandboxed agent finds it) **and**
  the host absolute path (for the user).
- **Explicit — an absolute `dest`.** The agent can pass an absolute path (a directory, or a full
  file path) to save somewhere specific, such as its own mounted workspace.

Guards, both modes: the extension is forced to the true on-disk format (bytes are copied, not
transcoded); a `filename` carrying `../` can't climb out of its base directory; and an existing file
is not overwritten unless `overwrite: true` (implemented with `COPYFILE_EXCL`, so the check is atomic
rather than a check-then-write race).

**Why `dest` is trusted, after first refusing it.** The original design forbade an agent-supplied
path on the theory that under Cowork the agent only knows *VM* paths (`/mnt/…`), which a host-side
server can't write to. That turned out to be wrong for the case that matters: in local agent mode the
agent knows the **real host path** of its mounted workspace (just not the rest of the machine). A
path it hands over is therefore writable and round-trips. Trusting it is also consistent with
`input_references`, which already reads any absolute path with no allowlist (see below).

**Why not auto-derive the workspace instead of asking the agent?** Because we checked, and it isn't
there to derive. MCP's [roots](https://modelcontextprotocol.io/specification/2025-06-18/client/roots)
feature is exactly "client exposes its workspace directories to the server," so we instrumented the
server and connected from Cowork. Result: Cowork's local agent mode **advertises** the `roots`
capability and **answers** `roots/list` — but returns an **empty array**. The plumbing works end to
end (a stateful transport, a real round-trip); Cowork simply exposes no roots to MCP servers. So
there is no host path to read automatically — the agent supplying `dest` is the only channel that
carries one. (This is the same gap as
[claude-code#27758](https://github.com/anthropics/claude-code/issues/27758), closed as not-planned.)

> **The default (export-folder) mode only round-trips to the agent if `CINEMAI_EXPORT_DIR` is a
> folder attached to the session.** The VirtioFS mount is what makes a host-written file appear on
> the agent's side. If the export dir isn't an attached workspace folder, the file still lands
> correctly on the host — good for local desktop use — but the agent won't see it. The tool can't
> detect the difference; point the setting at an attached folder, or pass an explicit `dest` the
> agent already knows.

## Reference images (image-to-image)

`generate_image` takes an optional `input_references: string[]`, forwarded to OpenRouter's
`input_references` parameter. Each entry is a plain string, disambiguated by shape:

| Form | Example | Resolution |
|---|---|---|
| Generated image | `image://gen/<id>`, `image://gen/<id>#2` | read from `data/images/`, encoded server-side |
| Public URL | `https://example.com/photo.jpg` | passed through; OpenRouter fetches it |
| Local file | `/Users/me/photo.png` | read from the server's filesystem, encoded server-side |

A flat `string[]` rather than an array of `{type, image_url}` objects: models fill in the flat form
far more reliably, and the object wrapper carries no information we can't infer. **Relative paths
are rejected** — `photo.png` is ambiguous against a bare job id, and resolving it against the
server's cwd is never what the caller meant.

The `#<index>` suffix addresses one image of a multi-image job. Bare ids work too.

**References are resolved in the tool handler, before the job is created.** A missing file or a
stale handle is a caller mistake that should come back as an immediate tool error the model can
correct — not as a job that fails 30 seconds later in a widget.

**Job records store the reference *specs*, never the resolved bytes.** `data/jobs/<id>.json` would
otherwise be megabytes of inlined base64 per generation.

Outbound references cap at `REFERENCE_MAX_PX` (2048) and 4 MB. Images already under both limits are
sent **as-is**, preserving PNG alpha, which can carry real meaning in edit-style prompts. Larger
ones are downscaled to JPEG q90 — higher than the q82 used for display variants, because a
reference is an *input* to another generation, so artifacts compound instead of merely being seen.
The ~150k host cap does not apply on this path: these bytes go into the OpenRouter request body,
not a tool result.

**Those per-image limits are necessary but not sufficient, and the gap is easy to hit.** Several
references that each clear them can still add up to a body OpenRouter refuses. Measured: three
1254×1254 PNGs at ~1.66 MB each pass every per-image check and are therefore sent untouched,
producing a ~6.6 MB base64 body that fails on **both** `openai/gpt-image-2` and
`google/gemini-2.5-flash-image` with an opaque `fetch failed` — no status code, nothing naming
size. The same three images at ~0.42 MB total succeed. Multi-reference work (character sheets,
compositing, multi-angle consistency) is exactly where this lands, so `REFERENCE_TOTAL_MAX_BYTES`
(3 MB) bounds the **combined** set: `resolveReferences` re-encodes everything at progressively
halved long edges until the total fits, giving up at `REFERENCE_MIN_PX` (512) with an error that
names the problem rather than another `fetch failed`.

The shrink is **reported, not silent** — the tool result carries a `referencesDownscaled` note. A
quietly halved reference would surface later as unexplained likeness drift, which is a worse
outcome than being told. `https://` references contribute nothing to the budget, since OpenRouter
fetches those itself and their bytes never pass through this server.

> The exact upstream threshold is **not** known. 6.6 MB fails and 0.42 MB succeeds; the boundary
> between them has not been bisected, and OpenRouter documents no limit. The 3 MB budget is a
> conservative guess from those two data points, not a published figure — treat it as tunable.

> **A model-supplied absolute path is read from disk.** That is the intended capability for a
> local single-user server, and it is worth being deliberate about before hosting this for anyone
> else. There is no path allowlist.

## Sizing and validation

`generate_image` **always sends an explicit `aspect_ratio`** (defaulting to `1:1`), rather than
letting the provider pick. That makes the output shape known at job-creation time, so the widget
sizes its placeholder correctly from the first paint instead of rendering square and snapping when
the image lands. Providers round to pixel multiples, so the final image can be ~2% off the exact
ratio — imperceptible.

Capabilities are fetched once from `/api/v1/images/models` and cached at boot. Requests are
validated locally before spending a generation:

- `n` against the model's max — the default model caps at **1**, despite the schema allowing more
- `aspect_ratio`, `resolution`, `quality`, `background` and `output_format` against each model's
  supported enum
- `output_compression` against the model's reported range
- `input_references` count against the model's max — this varies a lot: `openai/gpt-image-*` accept
  16, `bytedance-seed/seedream-4.5` 14, and the default `google/gemini-2.5-flash-image` only **3**

These failures return the supported values rather than a provider error.

An **unreported** capability skips its check rather than rejecting. Some models omit descriptors —
`openai/gpt-image-2` reports no `aspect_ratio` enum at all, yet accepts one — and a false rejection
would block a call that would have worked. Unknown model → allow, same principle.

One check is model-independent and therefore runs even for unknown models: `background:
"transparent"` with `output_format: "jpeg"` can't be satisfied by any provider, because JPEG has no
alpha channel.

### `size` vs `resolution` + `aspect_ratio`

OpenRouter offers two ways to ask for dimensions, and they do not compose. `resolution` is a
normalized tier (`512`/`1K`/`2K`/`4K`) that combines with `aspect_ratio`; `size` is a shorthand that
also accepts **explicit pixels** (`"1536x1024"`), and explicit pixels are *authoritative* — a
`resolution` or a disagreeing `aspect_ratio` sent alongside them is rejected upstream with
`HTTP 400: size "1024x1024" conflicts with aspect_ratio "16:9"`.

That collides with the always-send-an-aspect-ratio rule above: the `1:1` default alone would 400
every non-square pixel request. So an explicit-pixel `size` **suppresses** `aspect_ratio`, and the
shape the widget needs is derived from the pixels instead. An `aspect_ratio` that *agrees* with the
pixels is merely redundant and is dropped rather than rejected; only a genuine contradiction (or any
`resolution`) returns an error, and it names both values.

Tiers are normalized per-provider rather than being a literal pixel count, and `aspect_ratio` is
clamped to what the provider actually offers. Two measured examples: `google/gemini-3.1-flash-image`
at `resolution: "512"`, `aspect_ratio: "8:1"` returns **1456×176**; `openai/gpt-image-2` asked for
`16:9` returns **1536×1024** (3:2) — that model's real shape set is square, 3:2 and 2:3, so a
widescreen request lands on the nearest thing it has.

## Codec choice

Originals are stored exactly as OpenRouter returned them (usually PNG) and delivered untouched by
both full-resolution exits — the Download button (streamed via `get_output_chunk`) and `save_output`
(copied on disk). Everything that travels **inside a tool result** — the widget's display variant
and `view_image` — is re-encoded to **JPEG q82**.

This is not an aesthetic call. A 768px PNG of a photographic image is ~580KB, which is ~800k
base64 chars against a ~150k host cap — it would be silently truncated. Measured on a real
generation:

| | PNG | JPEG q82 |
|---|---|---|
| `get_job` payload | ~1900k chars | **51k** |
| display data URL | 1397 KB | **50 KB** |
| `view_image` | 796k chars | **31k** (~450 tokens) |

`get_job` logs a warning if a payload ever exceeds 130k chars, so this can't regress silently.

## Storage

Images at `data/images/<id>-<n>.png`, videos at `data/videos/<id>.mp4`, job records at
`data/jobs/<id>.json`. One `Job` record type covers both, discriminated by `kind`; records written
before video support are migrated to `kind: "image"` on load. Handles survive restarts. Jobs left
`running` when the process died are marked `failed` on boot — a job stuck `running` forever would
hang the widget's poll loop. For video that also covers a lost upstream poll loop: the upstream job
id and polling URL are persisted, so resuming rather than failing is a possible future improvement.

There is **no TTL or cleanup pass**; `data/` grows without bound. Add one if this sees heavy use —
this matters more now that a single clip can be tens of megabytes.

## Notes on dependencies

**Pin `@modelcontextprotocol/ext-apps` to `^1.x`.** This project was initially written against
`^0.1.0`, which npm resolves to `0.1.0` and never upgrades — caret ranges on `0.x` packages are
capped at the same minor. That version predates most of the apps surface: no `/server` export, no
`app-with-deps` bundle, `connect()` required an explicit `PostMessageTransport`, and
`downloadFile` / `updateModelContext` / `openLink` did not exist.

The failure mode is nasty: the widget iframe **mounts and renders completely blank**, with no
error in the host UI, because the widget script throws on the first API call. If you see an empty
widget frame, check the installed version first.

`registerAppTool` also emits both the modern `_meta.ui.resourceUri` and the legacy flat
`_meta["ui/resourceUri"]` for host compatibility — worth using the helper rather than writing
`_meta` by hand.

## Verification status

Verified against a live key:

- Capability descriptors for `input_references` — 40 image models returned; the `{type: "range",
  min, max}` shape matches what `models.ts` parses. Per-model maxima as listed above.
- End-to-end generation — `generate_image` returns in ~40ms with a ~230-byte handle payload and
  no base64; job completes in ~7s; `get_job` and `view_image` both return correctly sized images.
- Capability validation rejects `n > max` and unsupported aspect ratios without spending.
- Restart recovery — a job left `running` is marked `failed` on boot.
- Widget rendering and the chunked **Download button** in Claude Desktop — confirmed working after
  fixing two stacked bugs: full-res bytes overflowed the tool-result cap (now streamed via
  `get_output_chunk`), and `downloadFile` had been called with the wrong argument shape
  (`{name, content}` instead of `{contents: [{resource: {…blob}}]}`).
- `save_output` filename handling — containment (`../` and absolute paths rejected), extension
  correction, and a full-resolution copy verified locally against a real job.
- **Rendering parameters** (`resolution`, `quality`, `background`, `output_format`,
  `output_compression`) — 19 validation cases against live descriptors, all passing, including
  `transparent` on `gpt-image-2` (which reports `auto, opaque` only), `8:1` on the original Nano
  Banana, an out-of-range compression level, and fail-open on an unknown model. Four rejections and
  one generation exercised end to end through a real MCP client.
- **Live round trips with the new parameters** — `gpt-image-2` at `quality: "low"`,
  `output_format: "jpeg"`, `output_compression: 60`, `size: "1024x1024"` → a 1024×1024 JPEG in 12s
  for $0.006; `gemini-3.1-flash-image` at `resolution: "512"`, `aspect_ratio: "8:1"` → a 1456×176
  PNG in 8s for $0.045.
- **The `size`/`aspect_ratio` conflict** — confirmed upstream as a real `HTTP 400`, and confirmed
  that the guard rejects a contradiction while letting an agreeing pair through (the resulting job
  records `aspectRatio: "3:2"` derived from `size: "1536x1024"`).

**Verified: generations that actually send `input_references`.** Four round trips, on both
`openai/gpt-image-2` and `google/gemini-3.1-flash-image`: an `image://gen/<id>` handle (normalized
to `#0` in the job record), an absolute local path, and a stale handle correctly rejected as an
immediate tool error rather than a job failure. The edits landed semantically — "change only the
pear to a red apple, keep everything else the same" preserved framing, lighting and shadow
direction. **The https:// URL form remains unexercised.**

That test also confirmed a behaviour worth designing around: **an edit regenerates the whole
image rather than patching it.** The unedited regions of the apple result are visually
consistent with the source but not pixel-identical — the fruit sits slightly differently and the
contact shadow differs. A preserve list reduces drift; it cannot eliminate it. There is no mask
parameter on this endpoint, so a region that must be bit-exact has to be composited downstream.

**Not yet verified: `save_output` round-tripping into a sandboxed agent.** The write path is
confirmed locally, but that a file written to `CINEMAI_EXPORT_DIR` on the host actually surfaces in
a Cowork agent's mounted workspace — the whole point of the export-folder design — has not been
observed. It depends on the export dir being an attached workspace folder (see that section), which
the tool can't enforce.

**Not yet verified: Cowork specifically.** The widget renders and the Download button works in
Claude Desktop, but Cowork with "run on your computer" **on vs. off** — the case the `data:` URL and
chunked-transport choices were made for — has never been confirmed empirically.

### Video: verification status

Verified against a live key:

- Capability descriptors — 17 video models returned from `/api/v1/videos/models`. The real shape
  differs from the image endpoint and from the prose docs: `supported_frame_images` is a list of
  frame *types* (`["first_frame","last_frame"]`), not a boolean; `generate_audio` and `seed` are
  tri-state capability flags where `false` means rejected and `null` means unspecified;
  `supported_aspect_ratios` is `null` for some models. There is **no** `input_references`
  capability field at all, so that dimension is unvalidated. `models.ts` parses the observed shape.
- Capability validation — 12 cases exercised against live descriptors, including unsupported
  resolution/duration/aspect ratio, `last_frame` on a first-frame-only model, reference images on
  text-only `openai/sora-2-pro`, `seed` on a model that rejects it, and audio on a silent model.
  Unknown models and `null` capability fields fail open as intended.
- The `/media/<id>` route — `Accept-Ranges`, a `206 Partial Content` with correct `Content-Range`,
  `404` for unknown ids, and `400` for a path-traversal attempt.
- Tool surface — `generate_video` advertises the video widget, `get_output_chunk` stays
  `visibility: ["app"]`, and `save_image` is gone in favour of `save_output`.
- **End-to-end generation** — `bytedance/seedance-2.0-fast`, 4s, 480p, 16:9. `generate_video`
  returned a handle immediately; the background loop polled ~136s and wrote a 1,376,854-byte
  H.264 MP4 to `data/videos/`, capturing `cost: 0.2152`. The `get_job` payload for the finished
  clip is **499 bytes** — the design invariant, against the ~1.84M base64 chars the same clip
  would have cost inline.
- Playback transport — the media URL serves the clip byte-identically to the file on disk, and a
  mid-file range request returns `206` with an exact `Content-Range`.
- Chunked download for video — 19 round trips reassembled to a **sha256-identical** MP4, so the
  Download button's transport is confirmed for clips as well as images.
- `save_output` on a `video://gen/<id>` handle — saves, refuses to clobber an existing file, and
  corrects a wrong extension (`clip.png` → `clip.mp4`).
- `view_image` on a video handle explains that video can't enter context, rather than reporting a
  bogus "no such image".
- The video widget resource inlines the ext-apps bundle (330 KB) and the dev preview renders.

**Observed provider behaviour worth knowing:** the same prompt with `generate_audio: true` failed
upstream after ~130s with *"the output audio may contain sensitive information"* — Seedance
moderates the generated audio track. The failure propagated correctly (job marked `failed`, message
preserved verbatim), but it means audio generation can fail on prompts whose video succeeds.

**Resolved: the iframe CSP does block HTTP media playback.** This was the open question above, and
it was answered empirically in Claude Desktop rather than by reading docs. The widget originally
pointed `<video>` at `http://localhost:$PORT/media/<id>.mp4`; the host reported

```
CSP blocked http://localhost:3000/media/<id>.mp4
  violated: media-src        (and connect-src for a fetch probe)
  policy:   default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: …
```

with `MediaError 4 (SRC_NOT_SUPPORTED)` and no corresponding entry in the server's request log —
i.e. blocked before the request was ever sent. The symptom that pointed at it: **Download worked
while preview didn't**, because `downloadFile` and `callServerTool` are proxied by the host over the
MCP connection, whereas `<video src>` was the one direct network request the iframe made.

Playback now goes through `get_output_chunk` into a Blob URL, verified sha256-identical to the file
on disk, with concurrent slice fetching (~5.8× faster than serial). The `/media` route is retained
for out-of-band use only.
