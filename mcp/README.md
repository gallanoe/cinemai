# CinemAI MCP

An MCP app server that generates images via [OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
and displays them in an inline widget — without dumping image bytes into the conversation.

## The design in one picture

```
generate_image  ──> {handle, status: "running"}          the model sees this (~285 bytes)
                └─> widget polls get_job
                        └─> data: URL                     the model never sees this
view_image      ──> image content block, 768px            the model sees this ON REQUEST
```

Three delivery paths, three audiences: **handle** for the model, **`data:` URL** for the eye,
**`view_image`** for opt-in inspection.

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

The preview injects a fake `ExtApps` shim whose `callServerTool` proxies to `/dev/tool/get_job`,
so polling, rendering, and the download button all exercise real handlers.

## Tools

| Tool | Visibility | Returns |
|---|---|---|
| `generate_image` | model | `{handle, jobId, status, prompt, model}` — no bytes, ~45ms |
| `get_job` | widget only (`_meta.ui.visibility: ["app"]`) | status + display-sized `data:` URLs |
| `view_image` | model | image content block, downscaled to 768px |

`image://gen/<id>` is also registered as a resource template so a user can deliberately attach a
generated image. It complements `view_image` rather than replacing it: in most hosts resources are
user-driven, so the tool is what makes an image reachable by the *model*.

`view_image`'s description states its token cost. That sentence is the main lever on whether the
model reads every image reflexively or only when seeing it actually matters.

## Codec choice

Originals are stored exactly as OpenRouter returned them (usually PNG) and served that way for
download. Everything that travels **inside a tool result** — the widget's display variant and
`view_image` — is re-encoded to **JPEG q82**.

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

## Not yet verified

- **Cowork in both execution modes.** Whether the `data:` URL renders with "run on your computer"
  on *and* off. This is the least-tested assumption in the design.
- **Real generation end to end** — requires a live `OPENROUTER_API_KEY`.
