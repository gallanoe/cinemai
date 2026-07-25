import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { VIDEO_POLL_INTERVAL_MS, VIDEO_POLL_TIMEOUT_MS, config } from "./config.js";
import { generateImages, type GenerateParams } from "./openrouter.js";
import {
  downloadVideoBytes,
  pollVideo,
  submitVideo,
  type VideoGenerateParams,
} from "./video.js";

export type JobStatus = "running" | "succeeded" | "failed";

/** Images and videos share this record; `kind` discriminates the two. */
export type JobKind = "image" | "video";

export type Job = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  prompt: string;
  model: string;
  size?: string;
  aspectRatio?: string;
  seed?: number;
  /** Resolution tier. Both kinds use this: "1K"/"2K"/"4K" for images, "720p"
   *  and friends for video. */
  resolution?: string;
  /** Images only: rendering and encoding settings, kept so a job can be
   *  reproduced from its record. */
  quality?: string;
  background?: string;
  outputFormat?: string;
  outputCompression?: number;
  /** Images only: how many were requested. Videos are always a single clip. */
  n: number;
  /** The reference *specs* as given, never the resolved bytes — a job record
   *  with base64 inlined would be megabytes of JSON per generation. */
  inputReferences?: string[];
  createdAt: number;
  completedAt?: number;
  /** Filenames under data/images (image) or data/videos (video), relative. */
  files?: string[];
  mediaType?: string;
  cost?: number;
  error?: string;

  // --- video only -------------------------------------------------------
  duration?: number;
  generateAudio?: boolean;
  /** Upstream OpenRouter job id + polling URL; retained so a future restart
   *  could resume polling instead of only marking the job failed. */
  upstreamId?: string;
  pollingUrl?: string;
};

export const handleFor = (id: string) => `image://gen/${id}`;
export const videoHandleFor = (id: string) => `video://gen/${id}`;

/** The kind-appropriate handle for a job. */
export const handleForJob = (job: Job) =>
  job.kind === "video" ? videoHandleFor(job.id) : handleFor(job.id);

export function idFromHandle(handle: string): string | null {
  const match = /^image:\/\/gen\/([A-Za-z0-9-]+)$/.exec(handle.trim());
  return match ? match[1]! : null;
}

export function idFromVideoHandle(handle: string): string | null {
  const match = /^video:\/\/gen\/([A-Za-z0-9-]+)$/.exec(handle.trim());
  return match ? match[1]! : null;
}

/**
 * Resolve any output handle to its job, accepting an image handle, a video
 * handle, or a bare id. Used by the kind-agnostic tools (save_output, chunked
 * download) so a caller need not know which kind a handle points at.
 */
export function findJob(handle: string): Job | undefined {
  const trimmed = handle.trim();
  const id = idFromHandle(trimmed) ?? idFromVideoHandle(trimmed) ?? trimmed;
  return jobs.get(id);
}

const jobsDir = () => resolve(config.dataDir, "jobs");
const imagesDir = () => resolve(config.dataDir, "images");
const videosDir = () => resolve(config.dataDir, "videos");
const outputDir = (job: Job) => (job.kind === "video" ? videosDir() : imagesDir());

const jobs = new Map<string, Job>();
/** Derived (downscaled) buffers, keyed `${id}:${index}:${maxPx}`. */
const variantCache = new Map<string, { buffer: Buffer; width: number; height: number }>();

async function persist(job: Job): Promise<void> {
  await writeFile(resolve(jobsDir(), `${job.id}.json`), JSON.stringify(job, null, 2));
}

/**
 * Load persisted jobs. Any job still marked `running` cannot be — the upstream
 * request died with the previous process. Mark it failed so a widget polling an
 * old handle gets a definitive answer instead of spinning forever.
 */
export async function initJobStore(): Promise<void> {
  await mkdir(jobsDir(), { recursive: true });
  await mkdir(imagesDir(), { recursive: true });
  await mkdir(videosDir(), { recursive: true });

  let orphaned = 0;
  for (const file of await readdir(jobsDir())) {
    if (!file.endsWith(".json")) continue;
    try {
      const job = JSON.parse(await readFile(resolve(jobsDir(), file), "utf8")) as Job;
      // Records written before video support predate `kind`; they're all images.
      if (!job.kind) job.kind = "image";
      if (job.status === "running") {
        job.status = "failed";
        job.error = "Generation was interrupted by a server restart.";
        job.completedAt = Date.now();
        await persist(job);
        orphaned++;
      }
      jobs.set(job.id, job);
    } catch {
      // A corrupt record shouldn't stop the server from booting.
    }
  }
  console.error(
    `[jobs] loaded ${jobs.size} job(s)${orphaned ? `, ${orphaned} marked failed (interrupted)` : ""}`,
  );
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Absolute path to the original, full-resolution bytes of output `index`
 *  (an image or a video, depending on the job's kind). */
export function outputFilePath(job: Job, index: number): string {
  const file = job.files?.[index];
  if (!file) throw new Error(`Job ${job.id} has no output at index ${index}.`);
  return resolve(outputDir(job), file);
}

/**
 * Create a job and kick off generation WITHOUT awaiting it. Returns immediately
 * so the tool handler can respond in milliseconds — a blocking tools/call would
 * freeze the conversation turn for the full 10-90s generation.
 */
export async function startJob(
  params: GenerateParams & { n: number },
  refSpecs?: string[],
  /** Shape for the widget's placeholder, when it can't be read off
   *  `params.aspect_ratio` — an explicit-pixel `size` carries the ratio instead,
   *  and sending `aspect_ratio` alongside it is a 400 upstream. */
  displayAspectRatio?: string,
): Promise<Job> {
  const job: Job = {
    id: randomUUID(),
    kind: "image",
    status: "running",
    prompt: params.prompt,
    model: params.model ?? config.defaultModel,
    size: params.size,
    aspectRatio: params.aspect_ratio ?? displayAspectRatio,
    seed: params.seed,
    n: params.n,
    resolution: params.resolution,
    quality: params.quality,
    background: params.background,
    outputFormat: params.output_format,
    outputCompression: params.output_compression,
    ...(refSpecs?.length ? { inputReferences: refSpecs } : {}),
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  await persist(job);

  void runJob(job, params);
  return job;
}

async function runJob(job: Job, params: GenerateParams): Promise<void> {
  try {
    const result = await generateImages(params);
    const files: string[] = [];

    for (const [i, img] of result.images.entries()) {
      const ext = img.mediaType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
      const name = `${job.id}-${i}.${ext}`;
      await writeFile(resolve(imagesDir(), name), img.bytes);
      files.push(name);
    }

    job.status = "succeeded";
    job.files = files;
    job.mediaType = result.images[0]!.mediaType;
    job.cost = result.cost;
    job.completedAt = Date.now();
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = Date.now();
  }
  await persist(job).catch(() => {});
}

/**
 * Create a video job and kick off generation WITHOUT awaiting it — same
 * non-blocking contract as {@link startJob}. Video generation is doubly async:
 * it's slow (30s–minutes) AND the upstream API is itself a submit/poll flow, so
 * runVideoJob owns the whole poll loop in the background.
 */
export async function startVideoJob(
  params: VideoGenerateParams & { model: string },
  refSpecs?: string[],
): Promise<Job> {
  const job: Job = {
    id: randomUUID(),
    kind: "video",
    status: "running",
    prompt: params.prompt,
    model: params.model,
    aspectRatio: params.aspect_ratio,
    seed: params.seed,
    n: 1,
    duration: params.duration,
    resolution: params.resolution,
    generateAudio: params.generate_audio,
    ...(refSpecs?.length ? { inputReferences: refSpecs } : {}),
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  await persist(job);

  void runVideoJob(job, params);
  return job;
}

async function runVideoJob(job: Job, params: VideoGenerateParams): Promise<void> {
  try {
    const submitted = await submitVideo(params);
    job.upstreamId = submitted.id;
    job.pollingUrl = submitted.pollingUrl;
    await persist(job).catch(() => {});

    const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
    let result;
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${Math.round(VIDEO_POLL_TIMEOUT_MS / 60_000)} min waiting for the video.`,
        );
      }
      await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
      const poll = await pollVideo(submitted.pollingUrl);
      if (poll.status === "completed") {
        result = poll;
        break;
      }
      if (poll.status === "failed" || poll.status === "cancelled" || poll.status === "expired") {
        throw new Error(poll.error ?? `Video generation ${poll.status}.`);
      }
      // pending / in_progress — keep polling.
    }

    const url = result.unsigned_urls?.[0];
    if (!url) throw new Error("Video completed but returned no download URL.");
    const { bytes, mediaType } = await downloadVideoBytes(url);
    const ext = mediaType.split("/")[1]?.split(";")[0]?.trim() || "mp4";
    const name = `${job.id}.${ext}`;
    await writeFile(resolve(videosDir(), name), bytes);

    job.status = "succeeded";
    job.files = [name];
    job.mediaType = mediaType;
    job.cost = result.usage?.cost;
    job.completedAt = Date.now();
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = Date.now();
  }
  await persist(job).catch(() => {});
}

export type Variant = {
  buffer: Buffer;
  width: number;
  height: number;
  mediaType: string;
};

/**
 * Read image `index` of a job, downscaled so its long edge is at most `maxPx`.
 * Never upscales. Results are cached in memory — a poll loop shouldn't re-encode.
 */
export async function readVariant(
  job: Job,
  index: number,
  maxPx: number | null,
): Promise<Variant> {
  const file = job.files?.[index];
  if (!file) throw new Error(`Job ${job.id} has no image at index ${index}.`);

  const key = `${job.id}:${index}:${maxPx ?? "full"}`;
  const cached = variantCache.get(key);
  if (cached) return { ...cached, mediaType: "image/jpeg" };

  const original = await readFile(resolve(imagesDir(), file));

  if (maxPx === null) {
    // Full resolution keeps the original bytes and codec. Used by the resource
    // handler and the chunked download path — never inlined whole into a tool
    // result, which the host would truncate around 150k chars.
    const meta = await sharp(original).metadata();
    return {
      buffer: original,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      mediaType: job.mediaType ?? "image/png",
    };
  }

  // JPEG, not PNG. These variants travel inside tool results, and hosts cap
  // those around 150k chars. A 768px PNG of a photographic image is ~580KB
  // (~800k base64 chars) — 5x over the cap. The same image as JPEG is ~60KB.
  // Lossy compression costs nothing here: neither display nor model inspection
  // benefits from lossless pixels.
  const resized = await sharp(original)
    .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const variant = {
    buffer: resized.data,
    width: resized.info.width,
    height: resized.info.height,
  };
  variantCache.set(key, variant);
  return { ...variant, mediaType: "image/jpeg" };
}

export const toDataUrl = (v: Variant) =>
  `data:${v.mediaType};base64,${v.buffer.toString("base64")}`;

/** Full-resolution base64 of the ORIGINAL on-disk bytes, cached per image. */
const fullBase64Cache = new Map<string, FullImage>();

export type FullImage = { base64: string; mediaType: string; ext: string };

/**
 * The full-resolution output (image or video) as one base64 string, for the
 * widget's chunked transfer. The Download button — and, for video, the inline
 * preview — reassembles it from slices of THIS string; slicing the base64 text
 * (not the raw buffer) means chunk boundaries never land mid-triplet, so plain
 * concatenation restores the original bytes exactly.
 */
export async function readFullOutputBase64(job: Job, index: number): Promise<FullImage> {
  const file = job.files?.[index];
  if (!file) throw new Error(`Job ${job.id} has no output at index ${index}.`);

  const key = `${job.id}:${index}`;
  const cached = fullBase64Cache.get(key);
  if (cached) return cached;

  const bytes = await readFile(resolve(outputDir(job), file));
  const entry: FullImage = {
    base64: bytes.toString("base64"),
    mediaType: job.mediaType ?? (job.kind === "video" ? "video/mp4" : "image/png"),
    ext: file.split(".").pop() ?? (job.kind === "video" ? "mp4" : "png"),
  };
  fullBase64Cache.set(key, entry);
  return entry;
}
