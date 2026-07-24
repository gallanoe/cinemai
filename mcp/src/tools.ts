import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { DISPLAY_MAX_PX, INSPECT_MAX_PX, config } from "./config.js";
import {
  getJob,
  handleFor,
  idFromHandle,
  imageFilePath,
  readFullImageBase64,
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

/** Base64 chars per download slice. Kept well under the ~150k host tool-result
 *  cap so the surrounding JSON envelope still fits with headroom. */
const DOWNLOAD_CHUNK_CHARS = 100_000;

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
      },
      // visibility ["app"] keeps this out of the model's tool list.
      _meta: { ui: { visibility: ["app"] as const } },
    },
    async ({ jobId }) => {
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
        payload.images = await Promise.all(
          job.files.map(async (_f, i) => {
            const variant = await readVariant(job, i, DISPLAY_MAX_PX);
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
      // Warn loudly here so the real cause is obvious. Full-resolution bytes
      // never travel this path — the download button streams them in slices via
      // get_image_chunk instead, precisely to stay under this cap.
      if (text.length > 130_000) {
        console.error(
          `[warn] get_job payload is ${Math.round(text.length / 1000)}k chars, near the ~150k host cap. ` +
            `Lower DISPLAY_MAX_PX or JPEG quality in config.ts/jobs.ts.`,
        );
      }
      return { content: [{ type: "text", text }] };
    },
  );

  // ------------------------------------------------- get_image_chunk (widget only)
  registerAppTool(
    server,
    "get_image_chunk",
    {
      title: "Get Image Chunk",
      description:
        "Internal: stream one full-resolution image to the widget's Download button as base64 " +
        "slices. A full-res image is multiple megabytes — far over the host's ~150k-char tool " +
        "result cap — so it cannot be returned whole. Not intended for direct model use; call " +
        "view_image to actually see an image.",
      annotations: { title: "Get Image Chunk", readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe("Job id returned by generate_image."),
        index: z.number().int().min(0).optional().describe("Which image, if several. Default 0."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Start offset into the base64 string. Default 0."),
        length: z
          .number()
          .int()
          .min(1)
          .max(DOWNLOAD_CHUNK_CHARS)
          .optional()
          .describe(`Slice length in base64 chars. Default ${DOWNLOAD_CHUNK_CHARS}.`),
      },
      _meta: { ui: { visibility: ["app"] as const } },
    },
    async ({ jobId, index, offset, length }) => {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text: JSON.stringify({ error: text }) }], isError: true });

      const job = getJob(jobId);
      if (!job) return fail("Unknown job id.");
      if (job.status === "running") return fail("Still generating; try again shortly.");
      if (job.status !== "succeeded" || !job.files) return fail(`Generation failed: ${job.error ?? "unknown error"}`);

      const i = index ?? 0;
      if (i >= job.files.length) return fail(`No image at index ${i}.`);

      const { base64, mediaType, ext } = await readFullImageBase64(job, i);
      const start = offset ?? 0;
      const chunk = base64.slice(start, start + (length ?? DOWNLOAD_CHUNK_CHARS));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              index: i,
              imageCount: job.files.length,
              mediaType,
              ext,
              totalChars: base64.length,
              offset: start,
              chunk,
              done: start + chunk.length >= base64.length,
            }),
          },
        ],
      };
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

  // -------------------------------------------------------------- save_image
  server.registerTool(
    "save_image",
    {
      title: "Save Image",
      description:
        "Save a generated image at full resolution to disk, so it can be kept, exported, or edited " +
        "rather than only viewed inline. Two ways to choose where it lands: " +
        "(1) by default it goes into the CinemAI export folder — pass `filename` to name it; or " +
        "(2) pass `dest`, an ABSOLUTE path, to save somewhere specific, such as your own mounted " +
        "workspace directory when you know its real path. An existing file is NOT overwritten " +
        "unless `overwrite` is true. The result reports exactly where the file landed.",
      annotations: { title: "Save Image", readOnlyHint: false },
      inputSchema: {
        handle: z.string().describe("Image handle, e.g. image://gen/<id>. Also accepts a bare id."),
        index: z.number().int().min(0).optional().describe("Which image, if several. Default 0."),
        filename: z
          .string()
          .optional()
          .describe(
            'Filename to save as, e.g. "sunset.png". May include subfolders ("renders/sunset.png"), ' +
              "created as needed. Relative to `dest` if given, otherwise to the export folder. The " +
              "extension is corrected to match the actual image format. Defaults to a name derived " +
              "from the handle.",
          ),
        dest: z
          .string()
          .optional()
          .describe(
            "Absolute path to save to, overriding the export folder. Either a directory (the name " +
              "comes from `filename` or is derived) or a full file path ending in an image " +
              "extension. Use this to save into a directory you can actually see — e.g. your mounted " +
              "workspace. Must be absolute; relative paths are rejected.",
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe("Replace an existing file at the target. Default false: fail if it already exists."),
      },
    },
    async ({ handle, index, filename, dest, overwrite }) => {
      const id = idFromHandle(handle) ?? handle.trim();
      const job = getJob(id);

      if (!job) return { content: [{ type: "text", text: `No such image: ${handle}` }], isError: true };
      if (job.status === "running")
        return { content: [{ type: "text", text: "Still generating; try again shortly." }] };
      if (job.status === "failed")
        return { content: [{ type: "text", text: `Generation failed: ${job.error}` }], isError: true };

      const i = index ?? 0;
      let source: string;
      try {
        source = imageFilePath(job, i);
      } catch (err) {
        return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
      }

      // The real on-disk extension is authoritative — the bytes are copied, not
      // transcoded, so the saved extension must match what's actually written.
      const realExt = source.split(".").pop() ?? "png";
      const hasImageExt = (s: string) => /\.(png|jpe?g|webp|gif)$/i.test(s);

      // Resolve the target directory and file name from `dest` / `filename`.
      // A `dest` that names a file (ends in an image extension) supplies both the
      // directory and the name; otherwise `dest` is the directory and the name
      // comes from `filename` or a derived default.
      const derived = `cinemai-${job.id.slice(0, 8)}${i > 0 ? `-${i + 1}` : ""}`;
      let baseDir: string;
      let name: string;
      if (dest) {
        if (!isAbsolute(dest)) {
          return {
            content: [{ type: "text", text: "`dest` must be an absolute path." }],
            isError: true,
          };
        }
        if (hasImageExt(dest)) {
          baseDir = dirname(dest);
          name = basename(dest);
        } else {
          baseDir = dest;
          name = (filename ?? derived).trim();
        }
      } else {
        baseDir = config.exportDir;
        name = (filename ?? derived).trim();
      }

      if (!name || isAbsolute(name)) {
        return {
          content: [{ type: "text", text: "`filename` must be a relative name, not an absolute path." }],
          isError: true,
        };
      }
      // Force the extension to the true format (append if missing, replace if wrong).
      if (!new RegExp(`\\.${realExt}$`, "i").test(name)) {
        name = name.replace(/\.(png|jpe?g|webp|gif)$/i, "") + `.${realExt}`;
      }

      // The name (which may carry subfolders) must not climb out of baseDir. This
      // guards the filename portion even when `dest` itself is a trusted absolute
      // directory — a "../../x" filename shouldn't escape it.
      const target = resolve(baseDir, name);
      const rel = relative(baseDir, target);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        return {
          content: [{ type: "text", text: `"${name}" would escape ${baseDir}. Use a plain name or a subfolder path.` }],
          isError: true,
        };
      }

      try {
        await mkdir(dirname(target), { recursive: true });
        // COPYFILE_EXCL makes the "don't overwrite" check atomic — no TOCTOU gap
        // between testing existence and writing.
        await copyFile(source, target, overwrite ? 0 : constants.COPYFILE_EXCL);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          return {
            content: [{ type: "text", text: `A file named "${name}" already exists at ${target}. Pass overwrite: true to replace it.` }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: `Could not save image: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }

      // If the file landed in the export folder, also report the workspace-relative
      // name — that's how a sandboxed agent finds it, since we can't compute its
      // VM-side mount path. For a custom `dest`, the absolute path is the answer.
      const inExport = !relative(config.exportDir, target).startsWith("..");
      const savedAs = inExport ? relative(config.exportDir, target).split(sep).join("/") : null;
      const text = savedAs
        ? `Saved ${handleFor(job.id)} to the CinemAI export folder as "${savedAs}". ` +
          `If you're running in a sandbox, look for it under your mounted workspace; ` +
          `the file is on the user's machine at ${target}.`
        : `Saved ${handleFor(job.id)} to ${target}.`;
      return { content: [{ type: "text", text }] };
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
