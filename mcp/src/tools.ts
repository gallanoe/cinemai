import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { DISPLAY_MAX_PX, INSPECT_MAX_PX, config } from "./config.js";
import {
  getJob,
  handleFor,
  idFromHandle,
  readVariant,
  startJob,
  toDataUrl,
  type Job,
} from "./jobs.js";
import { validateRequest } from "./models.js";
import { resolveReferences } from "./references.js";

export const WIDGET_URI = "ui://widgets/job.html";

/** Fallback when the caller doesn't specify one. Always sent explicitly, so the
 *  widget can size its placeholder before any pixels exist. */
export const DEFAULT_ASPECT_RATIO = "1:1";

const jobSummary = (job: Job) => ({
  handle: handleFor(job.id),
  jobId: job.id,
  status: job.status,
  prompt: job.prompt,
  model: job.model,
  aspectRatio: job.aspectRatio,
  ...(job.n > 1 ? { n: job.n } : {}),
  ...(job.inputReferences?.length ? { inputReferences: job.inputReferences } : {}),
  ...(job.error ? { error: job.error } : {}),
});

export function registerTools(server: McpServer): void {
  // ---------------------------------------------------------------- generate
  registerAppTool(
    server,
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Generate an image from a text prompt via OpenRouter, and open a live progress widget " +
        "that displays the result inline. Returns IMMEDIATELY with a handle (image://gen/<id>) " +
        "while generation continues in the background — it does not block. " +
        "The image itself is NOT loaded into the conversation; the user sees it in the widget. " +
        "Use view_image only if you specifically need to see the image yourself.",
      annotations: { title: "Generate Image", readOnlyHint: false, openWorldHint: true },
      inputSchema: {
        prompt: z.string().min(1).describe("Text description of the image to generate."),
        model: z
          .string()
          .optional()
          .describe(`OpenRouter image model slug. Defaults to ${config.defaultModel}.`),
        n: z.number().int().min(1).max(4).optional().describe("How many images (1-4). Default 1."),
        size: z.string().optional().describe('Size tier ("2K") or pixels ("2048x2048").'),
        aspect_ratio: z
          .string()
          .optional()
          .describe(
            'Aspect ratio, e.g. "1:1", "16:9", "9:16", "4:3", "21:9". Choose one that suits the ' +
              `subject — widescreen for cinematic or landscape shots, tall for portraits. ` +
              `Defaults to ${DEFAULT_ASPECT_RATIO}.`,
          ),
        seed: z.number().int().optional().describe("Seed for deterministic generation."),
        input_references: z
          .array(z.string())
          .max(16)
          .optional()
          .describe(
            "Reference images to guide or edit from. Each entry is one of: an image handle " +
              'from a previous generation ("image://gen/<id>", or "image://gen/<id>#2" for the ' +
              'third image of a multi-image job); a public "https://" URL; or an ABSOLUTE file ' +
              'path on the user\'s machine ("/Users/me/photo.png"). Use this to iterate on an ' +
              "earlier result or to work from an image the user supplied. Relative paths are " +
              "not accepted. Support and max count vary by model.",
          ),
      },
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async (args) => {
      const model = args.model ?? config.defaultModel;
      // Always send an explicit aspect ratio. Providers differ in what they
      // default to, and the widget needs the shape up front to size its
      // placeholder — otherwise the frame renders square and snaps on arrival.
      const aspectRatio = args.aspect_ratio ?? DEFAULT_ASPECT_RATIO;
      const n = args.n ?? 1;

      const specs = args.input_references ?? [];

      // Catch provider-rejected combinations before spending a generation.
      const check = await validateRequest({
        model,
        n,
        aspect_ratio: aspectRatio,
        inputReferences: specs.length,
      });
      if (!check.ok) {
        return { content: [{ type: "text", text: check.message }], isError: true };
      }

      // Resolve references here rather than inside the job: a missing file or a
      // bad handle is a caller mistake the model can fix immediately, and it
      // would be invisible if it surfaced as a job failure 30s later.
      let resolved;
      try {
        resolved = await resolveReferences(specs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
      }

      const job = await startJob(
        {
          prompt: args.prompt,
          model: args.model,
          n,
          size: args.size,
          aspect_ratio: aspectRatio,
          seed: args.seed,
          ...(resolved.length ? { input_references: resolved.map((r) => r.ref) } : {}),
        },
        resolved.map((r) => r.source),
      );

      // Handle + metadata only. No bytes — this is the core invariant.
      return { content: [{ type: "text", text: JSON.stringify(jobSummary(job)) }] };
    },
  );

  // ------------------------------------------------------- get_job (widget only)
  registerAppTool(
    server,
    "get_job",
    {
      title: "Get Job Status",
      description:
        "Internal: poll a generation job and return display-sized image data URLs. " +
        "Used by the progress widget; not intended for direct model use.",
      annotations: { title: "Get Job Status", readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe("Job id returned by generate_image."),
        full: z
          .boolean()
          .optional()
          .describe("Return full-resolution images instead of display-sized. Used for download."),
      },
      // visibility ["app"] keeps this out of the model's tool list.
      _meta: { ui: { visibility: ["app"] as const } },
    },
    async ({ jobId, full }) => {
      const job = getJob(jobId);
      if (!job) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "failed", error: "Unknown job id." }) }],
          isError: true,
        };
      }

      const payload: Record<string, unknown> = {
        jobId: job.id,
        handle: handleFor(job.id),
        status: job.status,
        prompt: job.prompt,
        model: job.model,
        aspectRatio: job.aspectRatio,
        elapsedMs: (job.completedAt ?? Date.now()) - job.createdAt,
      };
      if (job.error) payload.error = job.error;
      if (job.cost !== undefined) payload.cost = job.cost;

      if (job.status === "succeeded" && job.files) {
        const maxPx = full ? null : DISPLAY_MAX_PX;
        payload.images = await Promise.all(
          job.files.map(async (_f, i) => {
            const variant = await readVariant(job, i, maxPx);
            return {
              index: i,
              width: variant.width,
              height: variant.height,
              dataUrl: toDataUrl(variant),
            };
          }),
        );
      }

      const text = JSON.stringify(payload);
      // Hosts truncate tool results around 150k chars and substitute a file
      // pointer, which surfaces in the widget as an opaque JSON parse error.
      // Warn loudly here so the real cause is obvious.
      if (!full && text.length > 130_000) {
        console.error(
          `[warn] get_job payload is ${Math.round(text.length / 1000)}k chars, near the ~150k host cap. ` +
            `Lower DISPLAY_MAX_PX or JPEG quality in config.ts/jobs.ts.`,
        );
      }
      return { content: [{ type: "text", text }] };
    },
  );

  // -------------------------------------------------------------- view_image
  server.registerTool(
    "view_image",
    {
      title: "View Image",
      description:
        "Load a previously generated image into your context so you can actually SEE it. " +
        "Costs roughly 1.5k tokens per image. Call this ONLY when seeing the image matters — " +
        "e.g. to check it matches the brief, compare candidates, or answer a question about its " +
        "content. Do not call it routinely after generate_image; the user already sees the image.",
      annotations: { title: "View Image", readOnlyHint: true },
      inputSchema: {
        handle: z.string().describe("Image handle, e.g. image://gen/<id>. Also accepts a bare id."),
        index: z.number().int().min(0).optional().describe("Which image, if several. Default 0."),
      },
    },
    async ({ handle, index }) => {
      const id = idFromHandle(handle) ?? handle.trim();
      const job = getJob(id);

      if (!job) return { content: [{ type: "text", text: `No such image: ${handle}` }], isError: true };
      if (job.status === "running")
        return { content: [{ type: "text", text: "Still generating; try again shortly." }] };
      if (job.status === "failed")
        return { content: [{ type: "text", text: `Generation failed: ${job.error}` }], isError: true };

      // Downscaled: inspection quality doesn't improve past ~768px, but cost does.
      const variant = await readVariant(job, index ?? 0, INSPECT_MAX_PX);
      return {
        content: [
          { type: "image", data: variant.buffer.toString("base64"), mimeType: variant.mediaType },
          { type: "text", text: `${handleFor(job.id)} — "${job.prompt}" (${job.model})` },
        ],
      };
    },
  );

  // ------------------------------------------------- image://gen/<id> resource
  server.registerResource(
    "Generated Image",
    new ResourceTemplate("image://gen/{id}", {
      list: async () => ({
        resources: [],
      }),
    }),
    { description: "A generated image, addressable by handle.", mimeType: "image/png" },
    async (uri) => {
      const id = idFromHandle(uri.href);
      const job = id ? getJob(id) : undefined;
      if (!job || job.status !== "succeeded") {
        throw new Error(`No completed image at ${uri.href}`);
      }
      const variant = await readVariant(job, 0, null);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: variant.mediaType,
            blob: variant.buffer.toString("base64"),
          },
        ],
      };
    },
  );
}
