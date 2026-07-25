import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { DISPLAY_MAX_PX, INSPECT_MAX_PX, config } from "./config.js";
import {
  findJob,
  getJob,
  handleFor,
  handleForJob,
  idFromHandle,
  idFromVideoHandle,
  outputFilePath,
  readFullOutputBase64,
  readVariant,
  startJob,
  startVideoJob,
  toDataUrl,
  type Job,
} from "./jobs.js";
import { validateRequest, validateVideoRequest } from "./models.js";
import { resolveReferences } from "./references.js";

export const WIDGET_URI = "ui://widgets/job.html";
export const VIDEO_WIDGET_URI = "ui://widgets/video.html";

/** Fallback when the caller doesn't specify one. Always sent explicitly, so the
 *  widget can size its placeholder before any pixels exist. */
export const DEFAULT_ASPECT_RATIO = "1:1";
/** Video defaults to widescreen — most clips are cinematic/landscape. */
export const DEFAULT_VIDEO_ASPECT_RATIO = "16:9";

/**
 * The plain-HTTP URL the widget plays a finished video from. Video is served
 * over HTTP rather than as base64 in a tool result — see config.publicBaseUrl —
 * because `<video>` needs range requests to start instantly and to seek.
 */
const mediaUrlFor = (job: Job, index = 0) => {
  const base = config.publicBaseUrl || `http://localhost:${config.port}`;
  // Use the stored filename verbatim — images are "<id>-<n>.png" and videos are
  // "<id>.mp4", and reconstructing that here would be a second place to keep in
  // sync with jobs.ts. The route resolves whatever name we hand it.
  const file = job.files?.[index] ?? `${job.id}.mp4`;
  return `${base}/media/${file}`;
};

/** Base64 chars per download slice. Kept well under the ~150k host tool-result
 *  cap so the surrounding JSON envelope still fits with headroom. */
const DOWNLOAD_CHUNK_CHARS = 100_000;

const jobSummary = (job: Job) => ({
  handle: handleForJob(job),
  jobId: job.id,
  kind: job.kind,
  status: job.status,
  prompt: job.prompt,
  model: job.model,
  aspectRatio: job.aspectRatio,
  ...(job.kind === "video" && job.duration ? { duration: job.duration } : {}),
  ...(job.kind === "video" && job.resolution ? { resolution: job.resolution } : {}),
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

  // ---------------------------------------------------------- generate_video
  registerAppTool(
    server,
    "generate_video",
    {
      title: "Generate Video",
      description:
        "Generate a video from a text prompt via OpenRouter, and open a live progress widget " +
        "that plays the result inline. Returns IMMEDIATELY with a handle (video://gen/<id>) " +
        "while generation continues in the background — it does not block. " +
        "Video takes considerably longer than an image (roughly 30s to several minutes) and " +
        "costs more, so prefer a short duration and a fast model unless the user asks otherwise. " +
        "The video itself is NOT loaded into the conversation; the user watches it in the widget. " +
        "Pass input_references to animate an existing image (image-to-video).",
      annotations: { title: "Generate Video", readOnlyHint: false, openWorldHint: true },
      inputSchema: {
        prompt: z.string().min(1).describe("Text description of the video to generate."),
        model: z
          .string()
          .optional()
          .describe(
            `OpenRouter video model slug, e.g. "google/veo-3.1", "bytedance/seedance-2.0", ` +
              `"openai/sora-2-pro". Defaults to ${config.defaultVideoModel}.`,
          ),
        duration: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("Clip length in seconds. Supported values vary by model (often 4, 6, or 8)."),
        resolution: z
          .string()
          .optional()
          .describe('Output resolution: "480p", "720p", "1080p", "1K", "2K", or "4K".'),
        aspect_ratio: z
          .string()
          .optional()
          .describe(
            'Aspect ratio, e.g. "16:9", "9:16", "1:1", "4:3", "21:9". Widescreen for cinematic ' +
              `shots, "9:16" for phone-native vertical video. Defaults to ${DEFAULT_VIDEO_ASPECT_RATIO}.`,
          ),
        seed: z.number().int().optional().describe("Seed for deterministic generation."),
        generate_audio: z
          .boolean()
          .optional()
          .describe(
            "Generate a soundtrack alongside the video. Only some models support audio; " +
              "defaults to the model's own default when omitted.",
          ),
        input_references: z
          .array(z.string())
          .max(4)
          .optional()
          .describe(
            "Images to animate or to guide the look. Each entry is one of: an image handle " +
              'from a previous generation ("image://gen/<id>", or "image://gen/<id>#2" for the ' +
              'third image of a multi-image job); a public "https://" URL; or an ABSOLUTE file ' +
              "path on the user's machine. By default the first image becomes the clip's opening " +
              "frame (image-to-video). Relative paths are not accepted; support varies by model.",
          ),
        reference_mode: z
          .enum(["first_frame", "last_frame", "style"])
          .optional()
          .describe(
            'How to use input_references. "first_frame" (default) starts the clip from the ' +
              'image; "last_frame" ends on it; "style" passes them as loose visual guidance ' +
              "without pinning either end.",
          ),
      },
      _meta: { ui: { resourceUri: VIDEO_WIDGET_URI } },
    },
    async (args) => {
      const model = args.model ?? config.defaultVideoModel;
      // As with images, always send an explicit aspect ratio so the widget can
      // size its placeholder before any frames exist.
      const aspectRatio = args.aspect_ratio ?? DEFAULT_VIDEO_ASPECT_RATIO;
      const specs = args.input_references ?? [];
      const mode = args.reference_mode ?? "first_frame";

      const check = await validateVideoRequest({
        model,
        resolution: args.resolution,
        aspect_ratio: aspectRatio,
        duration: args.duration,
        // Only checked when we actually send frame_images. "style" mode sends
        // input_references instead, and the endpoint reports no capability for
        // that — so, as everywhere else here, an unreported capability means
        // "skip the check" rather than "unsupported".
        ...(mode !== "style" ? { frameImages: specs.length, frameType: mode } : {}),
        generate_audio: args.generate_audio,
        seed: args.seed,
      });
      if (!check.ok) {
        return { content: [{ type: "text", text: check.message }], isError: true };
      }

      // Resolve up front so a bad path or handle is an immediate, correctable
      // tool error rather than a job failure minutes later.
      let resolved;
      try {
        resolved = await resolveReferences(specs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
      }

      // frame_images pins an end of the clip; input_references is loose guidance.
      // Upstream treats frame_images as taking precedence, so send only one.
      const framed =
        mode !== "style" && resolved.length
          ? { frame_images: resolved.map((r) => ({ ...r.ref, frame_type: mode as "first_frame" | "last_frame" })) }
          : resolved.length
            ? { input_references: resolved.map((r) => r.ref) }
            : {};

      const job = await startVideoJob(
        {
          prompt: args.prompt,
          model,
          duration: args.duration,
          resolution: args.resolution,
          aspect_ratio: aspectRatio,
          seed: args.seed,
          generate_audio: args.generate_audio,
          ...framed,
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
        handle: handleForJob(job),
        kind: job.kind,
        status: job.status,
        prompt: job.prompt,
        model: job.model,
        aspectRatio: job.aspectRatio,
        elapsedMs: (job.completedAt ?? Date.now()) - job.createdAt,
      };
      if (job.error) payload.error = job.error;
      if (job.cost !== undefined) payload.cost = job.cost;
      if (job.kind === "video") {
        if (job.duration !== undefined) payload.duration = job.duration;
        if (job.resolution !== undefined) payload.resolution = job.resolution;
        // Deliberately no bytes: even a 5s 720p clip is several MB, ~40x the
        // ~150k host cap. The widget plays it over plain HTTP instead, which
        // also buys range requests — instant first frame and real seeking.
        if (job.status === "succeeded" && job.files) {
          payload.video = {
            mediaType: job.mediaType ?? "video/mp4",
            url: mediaUrlFor(job),
            ready: true,
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
      }

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

  // ------------------------------------------------ get_output_chunk (widget only)
  registerAppTool(
    server,
    "get_output_chunk",
    {
      title: "Get Output Chunk",
      description:
        "Internal: stream one full-resolution output (image or video) to the widget as base64 " +
        "slices — for the Download button, and for the inline video player. A full-res image or " +
        "a video clip is multiple megabytes — far over the host's ~150k-char tool result cap — " +
        "so it cannot be returned whole. Not intended for direct model use; call " +
        "view_image to actually see an image.",
      annotations: { title: "Get Output Chunk", readOnlyHint: true },
      inputSchema: {
        jobId: z.string().describe("Job id returned by generate_image or generate_video."),
        index: z.number().int().min(0).optional().describe("Which output, if several. Default 0."),
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
      if (i >= job.files.length) return fail(`No output at index ${i}.`);

      const { base64, mediaType, ext } = await readFullOutputBase64(job, i);
      const start = offset ?? 0;
      const chunk = base64.slice(start, start + (length ?? DOWNLOAD_CHUNK_CHARS));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              index: i,
              // `imageCount` kept for the image widget's existing loop.
              imageCount: job.files.length,
              outputCount: job.files.length,
              kind: job.kind,
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
      // findJob, not idFromHandle: a video handle must still RESOLVE here so the
      // kind check below can explain the problem, rather than falling through to
      // a misleading "no such image".
      const job = findJob(handle);

      if (!job) return { content: [{ type: "text", text: `No such image: ${handle}` }], isError: true };
      if (job.kind === "video")
        return {
          content: [
            {
              type: "text",
              text:
                `${handle} is a video, which cannot be loaded into context. The user can watch it ` +
                `in the widget; use save_output to write it to disk.`,
            },
          ],
          isError: true,
        };
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

  // ------------------------------------------------------------- save_output
  server.registerTool(
    "save_output",
    {
      title: "Save Output",
      description:
        "Save a generated image or video at full resolution to disk, so it can be kept, exported, " +
        "or edited rather than only viewed inline. Accepts either an image handle " +
        "(image://gen/<id>) or a video handle (video://gen/<id>). Two ways to choose where it " +
        "lands: (1) by default it goes into the CinemAI export folder — pass `filename` to name " +
        "it; or (2) pass `dest`, an ABSOLUTE path, to save somewhere specific, such as your own " +
        "mounted workspace directory when you know its real path. An existing file is NOT " +
        "overwritten unless `overwrite` is true. The result reports exactly where the file landed.",
      annotations: { title: "Save Output", readOnlyHint: false },
      inputSchema: {
        handle: z
          .string()
          .describe(
            "Output handle: image://gen/<id> or video://gen/<id>. Also accepts a bare id.",
          ),
        index: z.number().int().min(0).optional().describe("Which output, if several. Default 0."),
        filename: z
          .string()
          .optional()
          .describe(
            'Filename to save as, e.g. "sunset.png" or "clip.mp4". May include subfolders ' +
              '("renders/sunset.png"), created as needed. Relative to `dest` if given, otherwise ' +
              "to the export folder. The extension is corrected to match the actual format. " +
              "Defaults to a name derived from the handle.",
          ),
        dest: z
          .string()
          .optional()
          .describe(
            "Absolute path to save to, overriding the export folder. Either a directory (the name " +
              "comes from `filename` or is derived) or a full file path ending in a media " +
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
      const job = findJob(handle);

      if (!job) return { content: [{ type: "text", text: `No such output: ${handle}` }], isError: true };
      if (job.status === "running")
        return { content: [{ type: "text", text: "Still generating; try again shortly." }] };
      if (job.status === "failed")
        return { content: [{ type: "text", text: `Generation failed: ${job.error}` }], isError: true };

      const i = index ?? 0;
      let source: string;
      try {
        source = outputFilePath(job, i);
      } catch (err) {
        return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
      }

      // The real on-disk extension is authoritative — the bytes are copied, not
      // transcoded, so the saved extension must match what's actually written.
      const realExt = source.split(".").pop() ?? (job.kind === "video" ? "mp4" : "png");
      const hasImageExt = (s: string) => /\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i.test(s);

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
        name = name.replace(/\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i, "") + `.${realExt}`;
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
        return { content: [{ type: "text", text: `Could not save ${job.kind}: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }

      // If the file landed in the export folder, also report the workspace-relative
      // name — that's how a sandboxed agent finds it, since we can't compute its
      // VM-side mount path. For a custom `dest`, the absolute path is the answer.
      const inExport = !relative(config.exportDir, target).startsWith("..");
      const savedAs = inExport ? relative(config.exportDir, target).split(sep).join("/") : null;
      const text = savedAs
        ? `Saved ${handleForJob(job)} to the CinemAI export folder as "${savedAs}". ` +
          `If you're running in a sandbox, look for it under your mounted workspace; ` +
          `the file is on the user's machine at ${target}.`
        : `Saved ${handleForJob(job)} to ${target}.`;
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

  // ------------------------------------------------- video://gen/<id> resource
  server.registerResource(
    "Generated Video",
    new ResourceTemplate("video://gen/{id}", {
      list: async () => ({
        resources: [],
      }),
    }),
    { description: "A generated video, addressable by handle.", mimeType: "video/mp4" },
    async (uri) => {
      const id = idFromVideoHandle(uri.href);
      const job = id ? getJob(id) : undefined;
      if (!job || job.kind !== "video" || job.status !== "succeeded") {
        throw new Error(`No completed video at ${uri.href}`);
      }
      // Unlike the image resource this returns a URL rather than inlining bytes:
      // a clip is multiple MB, and a base64 blob that size is unusable to any
      // consumer bound by the same result cap the widget is.
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: job.mediaType ?? "video/mp4",
            text: mediaUrlFor(job),
          },
        ],
      };
    },
  );
}
