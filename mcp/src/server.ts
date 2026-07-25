import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import { config } from "./config.js";
import { getJob, initJobStore, outputFilePath } from "./jobs.js";
import { loadModelCaps, loadVideoModelCaps } from "./models.js";
import { VIDEO_WIDGET_URI, WIDGET_URI, registerTools } from "./tools.js";

const require = createRequire(import.meta.url);

/**
 * Inline the ext-apps browser bundle into the widget HTML.
 *
 * The iframe's CSP blocks CDN imports, so the App class and its transitive deps
 * must be embedded. `app-with-deps` is the dependency-complete browser build; we
 * rewrite its trailing `export{...}` into a global assignment, since the iframe
 * loads it as a plain inline script rather than a module graph.
 */
function loadWidget(file: string): string {
  const bundleSrc = readFileSync(
    require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"),
    "utf8",
  );
  const bundle = bundleSrc.replace(/export\s*\{([^}]*)\};?\s*$/, (_m, body: string) => {
    const pairs = body
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [local, exported] = part.split(/\s+as\s+/).map((s) => s.trim());
        return `${exported ?? local}:${local}`;
      });
    return `globalThis.ExtApps={${pairs.join(",")}};`;
  });

  if (!bundle.includes("globalThis.ExtApps")) {
    throw new Error(
      "Failed to rewrite the ext-apps bundle exports — the package layout changed. " +
        "Check the tail of node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js.",
    );
  }

  const html = readFileSync(resolve(config.widgetsDir, file), "utf8");
  if (!html.includes("/*__EXT_APPS_BUNDLE__*/")) {
    throw new Error(`${file} is missing the /*__EXT_APPS_BUNDLE__*/ placeholder.`);
  }
  return html.replace("/*__EXT_APPS_BUNDLE__*/", () => bundle);
}

function buildServer(widgetHtml: string, videoWidgetHtml: string): McpServer {
  const server = new McpServer(
    { name: "cinemai", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server);
  registerAppResource(
    server,
    "Image Job",
    WIDGET_URI,
    { _meta: { ui: { prefersBorder: false } } },
    async () => ({
      contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml }],
    }),
  );
  registerAppResource(
    server,
    "Video Job",
    VIDEO_WIDGET_URI,
    { _meta: { ui: { prefersBorder: false } } },
    async () => ({
      contents: [{ uri: VIDEO_WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: videoWidgetHtml }],
    }),
  );
  return server;
}

const widgetHtml = loadWidget("job.html");
const videoWidgetHtml = loadWidget("video.html");
await initJobStore();
// Warm the capability caches so the first generation doesn't pay for them.
void loadModelCaps();
void loadVideoModelCaps();

const app = express();
app.use(express.json({ limit: "16mb" }));

// Wire-level trace. The widget talks to this server through the host, so when a
// widget misbehaves the first question is always "did the call arrive at all?"
app.use((req, _res, next) => {
  if (req.path === "/mcp" && req.body?.method) {
    const { method, params } = req.body;
    const detail =
      method === "tools/call"
        ? `${params?.name}`
        : method === "resources/read"
          ? `${params?.uri}`
          : "";
    console.error(`[rpc] ${method}${detail ? " " + detail : ""}`);
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, model: config.defaultModel });
});

/**
 * Serve a generated video over plain HTTP, with range support.
 *
 * NOT used by the widget. The host serves widget iframes under
 * `default-src 'self'`, so `media-src` resolves to the iframe's own origin and
 * a request to this route is blocked by CSP before it reaches the network —
 * observed directly in Claude Desktop, which reports violations of both
 * `media-src` and `connect-src`. The widget therefore loads clips over the MCP
 * connection instead (see widgets/video.html).
 *
 * The route stays because it is genuinely useful *outside* the iframe: opening
 * the URL in a browser, `curl`, or VLC, and as the value the `video://gen/<id>`
 * resource hands back. A host with a permissive CSP could also play it directly.
 *
 * Read-only, and the id is matched against the job store rather than used as a
 * path, so a crafted id can't escape the data directory.
 */
app.get("/media/:file", async (req, res) => {
  console.error(`[media] GET ${req.params.file} range=${req.headers.range ?? "none"}`);

  const match = /^([A-Za-z0-9-]+)\.[A-Za-z0-9]+$/.exec(req.params.file);
  if (!match) return res.status(400).end();
  const stem = match[1]!;

  // Resolve against the job store rather than by splitting the name. A job id is
  // a UUID whose final hex group is all digits ~1 in 288 of the time, so a lazy
  // "<id>-<index>" regex would silently reinterpret part of the id as an index
  // and 404. Whole stem first; only fall back to splitting a trailing -N.
  let job = getJob(stem);
  let index = 0;
  if (!job) {
    const split = /^(.+)-(\d+)$/.exec(stem);
    if (split) {
      job = getJob(split[1]!);
      index = Number(split[2]);
    }
  }
  if (!job || job.status !== "succeeded" || !job.files?.[index]) return res.status(404).end();

  let path: string;
  try {
    path = outputFilePath(job, index);
  } catch {
    return res.status(404).end();
  }

  // sendFile handles Range/206, ETag, conditional requests and content-length —
  // everything <video> relies on for seeking.
  res.type(job.mediaType ?? "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  // The widget iframe is a different (often opaque) origin. A plain <video src>
  // doesn't need CORS, but a fetch()-based reachability probe does, and this
  // removes one variable when diagnosing a dead player. Read-only route.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.sendFile(path, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

/**
 * Dev-only widget preview. Renders the widget in a normal browser tab with a
 * fake ExtApps shim so widget HTML/CSS can be iterated with ordinary devtools,
 * instead of the quit-and-relaunch cycle Claude Desktop's resource cache forces.
 *
 *   http://localhost:3000/widget-preview?payload={"jobId":"..."}
 */
app.get("/widget-preview", (req, res) => {
  const payload = String(req.query.payload ?? "{}");
  const shim = `globalThis.ExtApps={App:class{
    constructor(){} ontoolresult; ontoolinput; onhostcontextchanged;
    async connect(){ this.ontoolresult?.({content:[{type:"text",text:${JSON.stringify(payload)}}]}); }
    getHostContext(){ return { theme: new URLSearchParams(location.search).get("theme") || "light" }; }
    async callServerTool({name, arguments: args}){
      const r = await fetch("/dev/tool/"+name, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(args)});
      return { content: [{ type: "text", text: await r.text() }] };
    }
    sendMessage(m){ console.log("sendMessage", m); }
    updateModelContext(m){ console.log("updateModelContext", m); }
    downloadFile(f){ const c=(f.contents&&f.contents[0]&&f.contents[0].resource)||{}; console.log("downloadFile", c.uri, c.mimeType, ((c.blob||"").length) + " b64 chars"); return { isError:false }; }
    openLink({url}){ window.open(url, "_blank"); }
  }};`;
  // ?widget=video previews the video widget; default stays the image one.
  const file = req.query.widget === "video" ? "video.html" : "job.html";
  const html = readFileSync(resolve(config.widgetsDir, file), "utf8").replace(
    "/*__EXT_APPS_BUNDLE__*/",
    () => shim,
  );
  res.type("html").send(html);
});

/** Dev-only: lets the preview shim reach real tool handlers over plain HTTP. */
app.post("/dev/tool/:name", async (req, res) => {
  const { getJob, handleForJob, readVariant, toDataUrl, readFullOutputBase64 } = await import("./jobs.js");
  const job = getJob(req.body.jobId);

  // Mirror get_output_chunk so the Download button works in preview too.
  if (req.params.name === "get_output_chunk") {
    if (!job || job.status !== "succeeded" || !job.files) return res.json({ error: "not ready" });
    const i = req.body.index ?? 0;
    const { base64, mediaType, ext } = await readFullOutputBase64(job, i);
    const start = req.body.offset ?? 0;
    const chunk = base64.slice(start, start + (req.body.length ?? 100_000));
    return res.json({
      index: i,
      imageCount: job.files.length,
      outputCount: job.files.length,
      kind: job.kind,
      mediaType,
      ext,
      totalChars: base64.length,
      offset: start,
      chunk,
      done: start + chunk.length >= base64.length,
    });
  }

  if (req.params.name !== "get_job") return res.status(404).json({ error: "unknown tool" });
  if (!job) return res.json({ status: "failed", error: "Unknown job id." });

  const payload: Record<string, unknown> = {
    jobId: job.id,
    handle: handleForJob(job),
    kind: job.kind,
    status: job.status,
    prompt: job.prompt,
    model: job.model,
    aspectRatio: job.aspectRatio,
    elapsedMs: (job.completedAt ?? Date.now()) - job.createdAt,
    ...(job.error ? { error: job.error } : {}),
    ...(job.cost !== undefined ? { cost: job.cost } : {}),
  };

  if (job.kind === "video") {
    if (job.duration !== undefined) payload.duration = job.duration;
    if (job.resolution !== undefined) payload.resolution = job.resolution;
    if (job.status === "succeeded" && job.files) {
      const ext = job.files[0]?.split(".").pop() ?? "mp4";
      payload.video = {
        mediaType: job.mediaType ?? "video/mp4",
        url: `${config.publicBaseUrl || `http://localhost:${config.port}`}/media/${job.id}.${ext}`,
        ready: true,
      };
    }
    return res.json(payload);
  }

  if (job.status === "succeeded" && job.files) {
    const { DISPLAY_MAX_PX } = await import("./config.js");
    payload.images = await Promise.all(
      job.files.map(async (_f, i) => {
        const v = await readVariant(job, i, DISPLAY_MAX_PX);
        return { index: i, width: v.width, height: v.height, dataUrl: toDataUrl(v) };
      }),
    );
  }
  res.json(payload);
});

// Stateless: a fresh transport + server per request. Simple and adequate here,
// since all durable state lives in the job store rather than in session memory.
app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    const server = buildServer(widgetHtml, videoWidgetHtml);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] request failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal error" });
  }
});

app.listen(config.port, () => {
  console.error(`[cinemai] MCP on http://localhost:${config.port}/mcp`);
  console.error(`[cinemai] widget preview: http://localhost:${config.port}/widget-preview`);
  console.error(`[cinemai] default model: ${config.defaultModel}`);
});
