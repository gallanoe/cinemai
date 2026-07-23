# CinemAI MCP

An MCP app server that generates images via [OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
and displays them in an inline widget — without dumping image bytes into the conversation.

## The design in one picture

```
generate_image  ──> {handle, status: "running"}          the model sees this (~285 bytes)
                └─> widget polls get_job
                        └─> data: URL                     the model never sees this
view_image      ──> image content block, 768px            the model sees this ON REQUEST
Download button ──> get_image_chunk ─> full-res file      the USER saves this (host download)
save_image      ──> full-res file in the export folder    the AGENT saves this to the workspace
```

Delivery paths by audience: **handle** for the model, **`data:` URL** for the eye, **`view_image`**
for opt-in inspection, and two full-resolution exits — the widget's **Download button** (user) and
**`save_image`** (agent). None of the full-res paths put bytes in the conversation.

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
`get_image_chunk` in <100k-char **base64-string** slices and reassembles them in the widget — the
slices are of the base64 text, not the raw buffer, so boundaries never land mid-triplet and plain
concatenation restores the bytes exactly. `save_image` sidesteps the cap entirely by copying on
disk and returning only a path. Both ride transports that are correct under either execution mode.

## Deployment model: local-first

This server is designed to **run on the user's own machine**. It can be hosted remotely — nothing
in the transport assumes otherwise — but two things are meaningfully better locally:

- **Reference images by file path.** `input_references` accepts an absolute path so the user can
  say "use this photo" about a file they already have. A remote server has no access to that
  filesystem, and the path resolves to a clear error rather than silently doing something else.
- **Generated images stay on the user's disk** under `data/`, rather than accumulating on a shared
  host.

This does **not** retract the `data:` URL decision below. Cowork's per-task execution toggle means
even a "local" deployment can move, so pixels still reach the widget over the MCP connection rather
than via `http://localhost`. Local-first is the target; it is not an assumption the transport makes.

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

Desktop caches UI resources aggressively. After editing `widgets/job.html`, **fully quit** (⌘Q,
not window-close) and relaunch.

## Development

```bash
npm run smoke -- "a lighthouse at dusk"   # hit OpenRouter directly, write a PNG to data/smoke/
npm run dev                               # tsc --watch + node --watch
```

**Widget preview** — iterate on widget HTML/CSS in a normal browser tab with real devtools,
skipping the Desktop quit-relaunch cycle entirely:

```
http://localhost:3000/widget-preview?payload={"jobId":"<id>"}&theme=dark
```

The preview injects a fake `ExtApps` shim whose `callServerTool` proxies to `/dev/tool/<name>`
(`get_job` and `get_image_chunk`), so polling, rendering, and the chunked Download button all
exercise real handlers. The shim's `downloadFile` just logs the resource block rather than saving.

## Tools

| Tool | Visibility | Returns |
|---|---|---|
| `generate_image` | model | `{handle, jobId, status, prompt, model}` — no bytes, ~45ms; optional `input_references` |
| `get_job` | widget only (`_meta.ui.visibility: ["app"]`) | status + display-sized `data:` URLs |
| `get_image_chunk` | widget only (`_meta.ui.visibility: ["app"]`) | one full-res image as a base64-string slice, for the Download button |
| `view_image` | model | image content block, downscaled to 768px |
| `save_image` | model | writes the full-res file to the export folder; returns the saved name + host path, no bytes |

`image://gen/<id>` is also registered as a resource template so a user can deliberately attach a
generated image. It complements `view_image` rather than replacing it: in most hosts resources are
user-driven, so the tool is what makes an image reachable by the *model*.

`view_image`'s description states its token cost. That sentence is the main lever on whether the
model reads every image reflexively or only when seeing it actually matters.

## Full-resolution exits: Download button and `save_image`

Two ways to get the real file out, for two actors.

**The widget Download button** is user-driven. It streams the full-res image through
`get_image_chunk` (see the rationale above) and hands the reassembled base64 to the host's
`downloadFile` — the host owns the save location, exactly like a browser download. This makes the
whole "which filesystem does the container see" question moot: nothing is written server-side and
no path is guessed. `downloadFile` takes MCP resource content blocks
(`{contents: [{type: "resource", resource: {uri: "file:///name.png", mimeType, blob}}]}`), and the
saved filename is the `file:///` URI's basename — **not** a flat `{name, content}` object.

**`save_image`** is agent-driven, for "keep this / put it in my project" without a human clicking.
Here the container question is real and unavoidable, so the design answers it structurally: **the
server owns the directory; the agent only names the file.**

- Files land in `CINEMAI_EXPORT_DIR` (default `~/Documents/Claude` — Cowork's hardcoded working
  directory on macOS, the highest-probability folder mounted into a sandboxed agent's workspace).
- `filename` may include subfolders but is **contained**: absolute paths and `../` escapes are
  rejected by resolving against the export dir and checking the result stays inside. The extension
  is forced to the true on-disk format, since bytes are copied rather than transcoded.
- The result reports the workspace-relative name (what a sandboxed agent opens) **and** the host
  absolute path (for the user). There is no reliable way to compute the agent's VM-side mount path
  ([claude-code#27758](https://github.com/anthropics/claude-code/issues/27758) — closed as
  not-planned), so the basename is how the agent finds the file in its own tree.

**Why not let the agent pass a destination path?** Under Cowork the server runs on the host and the
agent in a VM; the two have different path namespaces and the host does **not** rewrite paths inside
MCP tool arguments. A destination the agent invents would be meaningless to the server. Inverting
control — server picks the folder, agent picks the name — is the only arrangement that works across
both execution modes.

> **This only round-trips to the agent if `CINEMAI_EXPORT_DIR` is a folder attached to the session.**
> The VirtioFS mount is what makes a host-written file appear on the agent's side. If the export dir
> isn't an attached workspace folder, the file still lands correctly on the host — good for local
> desktop use — but the agent won't see it. The tool can't detect the difference; point the setting
> at an attached folder.

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
- `aspect_ratio` against the model's supported enum
- `input_references` count against the model's max — this varies a lot: `openai/gpt-image-*` accept
  16, `bytedance-seed/seedream-4.5` 14, and the default `google/gemini-2.5-flash-image` only **3**

These failures return the supported values rather than a provider error.

An **unreported** capability skips its check rather than rejecting. Some models omit descriptors —
`google/gemini-2.5-flash-image-preview` reports no `input_references` range at all — and a false
rejection would block a call that would have worked. Unknown model → allow, same principle.

## Codec choice

Originals are stored exactly as OpenRouter returned them (usually PNG) and delivered untouched by
both full-resolution exits — the Download button (streamed via `get_image_chunk`) and `save_image`
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

Images at `data/images/<id>-<n>.png`, job records at `data/jobs/<id>.json`. Handles survive
restarts. Jobs left `running` when the process died are marked `failed` on boot — a job stuck
`running` forever would hang the widget's poll loop.

There is **no TTL or cleanup pass**; `data/` grows without bound. Add one if this sees heavy use.

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
  `get_image_chunk`), and `downloadFile` had been called with the wrong argument shape
  (`{name, content}` instead of `{contents: [{resource: {…blob}}]}`).
- `save_image` filename handling — containment (`../` and absolute paths rejected), extension
  correction, and a full-resolution copy verified locally against a real job.

**Not yet verified: a generation that actually sends `input_references`.** The capability
descriptors are confirmed live and the code typechecks, but no round trip has been made with a
reference attached — so the request-body shape OpenRouter accepts is still taken from the docs
rather than observed. All three source forms are unexercised.

**Not yet verified: `save_image` round-tripping into a sandboxed agent.** The write path is
confirmed locally, but that a file written to `CINEMAI_EXPORT_DIR` on the host actually surfaces in
a Cowork agent's mounted workspace — the whole point of the export-folder design — has not been
observed. It depends on the export dir being an attached workspace folder (see that section), which
the tool can't enforce.

**Not yet verified: Cowork specifically.** The widget renders and the Download button works in
Claude Desktop, but Cowork with "run on your computer" **on vs. off** — the case the `data:` URL and
chunked-transport choices were made for — has never been confirmed empirically.
