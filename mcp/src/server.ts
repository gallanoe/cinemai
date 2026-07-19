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
import { initJobStore } from "./jobs.js";
import { loadModelCaps } from "./models.js";
import { WIDGET_URI, registerTools } from "./tools.js";

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

function buildServer(widgetHtml: string): McpServer {
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
  return server;
}

const widgetHtml = loadWidget("job.html");
await initJobStore();
// Warm the capability cache so the first generate_image doesn't pay for it.
void loadModelCaps();

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
    downloadFile(f){ console.log("downloadFile", f.name, f.mimeType, f.content.length + " b64 chars"); }
    openLink({url}){ window.open(url, "_blank"); }
  }};`;
  const html = readFileSync(resolve(config.widgetsDir, "job.html"), "utf8").replace(
    "/*__EXT_APPS_BUNDLE__*/",
    () => shim,
  );
  res.type("html").send(html);
});

/** Dev-only: lets the preview shim reach real tool handlers over plain HTTP. */
app.post("/dev/tool/:name", async (req, res) => {
  const { getJob, handleFor, readVariant, toDataUrl } = await import("./jobs.js");
  if (req.params.name !== "get_job") return res.status(404).json({ error: "unknown tool" });

  const job = getJob(req.body.jobId);
  if (!job) return res.json({ status: "failed", error: "Unknown job id." });

  const payload: Record<string, unknown> = {
    jobId: job.id,
    handle: handleFor(job.id),
    status: job.status,
    prompt: job.prompt,
    model: job.model,
    aspectRatio: job.aspectRatio,
    elapsedMs: (job.completedAt ?? Date.now()) - job.createdAt,
    ...(job.error ? { error: job.error } : {}),
    ...(job.cost !== undefined ? { cost: job.cost } : {}),
  };
  if (job.status === "succeeded" && job.files) {
    const { DISPLAY_MAX_PX } = await import("./config.js");
    payload.images = await Promise.all(
      job.files.map(async (_f, i) => {
        const v = await readVariant(job, i, req.body.full ? null : DISPLAY_MAX_PX);
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
    const server = buildServer(widgetHtml);
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
