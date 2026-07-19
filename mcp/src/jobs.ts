import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import { generateImages, type GenerateParams } from "./openrouter.js";

export type JobStatus = "running" | "succeeded" | "failed";

export type Job = {
  id: string;
  status: JobStatus;
  prompt: string;
  model: string;
  size?: string;
  aspectRatio?: string;
  seed?: number;
  n: number;
  createdAt: number;
  completedAt?: number;
  /** Filenames under data/images, relative. */
  files?: string[];
  mediaType?: string;
  cost?: number;
  error?: string;
};

export const handleFor = (id: string) => `image://gen/${id}`;

export function idFromHandle(handle: string): string | null {
  const match = /^image:\/\/gen\/([A-Za-z0-9-]+)$/.exec(handle.trim());
  return match ? match[1]! : null;
}

const jobsDir = () => resolve(config.dataDir, "jobs");
const imagesDir = () => resolve(config.dataDir, "images");

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

  let orphaned = 0;
  for (const file of await readdir(jobsDir())) {
    if (!file.endsWith(".json")) continue;
    try {
      const job = JSON.parse(await readFile(resolve(jobsDir(), file), "utf8")) as Job;
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

/**
 * Create a job and kick off generation WITHOUT awaiting it. Returns immediately
 * so the tool handler can respond in milliseconds — a blocking tools/call would
 * freeze the conversation turn for the full 10-90s generation.
 */
export async function startJob(params: GenerateParams & { n: number }): Promise<Job> {
  const job: Job = {
    id: randomUUID(),
    status: "running",
    prompt: params.prompt,
    model: params.model ?? config.defaultModel,
    size: params.size,
    aspectRatio: params.aspect_ratio,
    seed: params.seed,
    n: params.n,
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
    // Full resolution keeps the original bytes and codec — this path is only
    // used for download, where fidelity matters and there is no payload cap.
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
