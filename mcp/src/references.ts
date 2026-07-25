import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  REFERENCE_MAX_PX,
  REFERENCE_MAX_BYTES,
  REFERENCE_MIN_PX,
  REFERENCE_TOTAL_MAX_BYTES,
} from "./config.js";
import { getJob, idFromHandle, readVariant } from "./jobs.js";
import type { InputReference } from "./openrouter.js";

/**
 * A reference spec is a single string in one of three forms, distinguished by
 * shape rather than by a tagged union — a flat string[] is a much easier schema
 * for a model to fill in correctly than an array of objects.
 *
 *   image://gen/<id>[#<index>]   a previously generated image (also a bare id)
 *   https://example.com/x.jpg    passed straight through to OpenRouter
 *   /Users/me/photo.png          a file on the machine running THIS server
 *
 * Relative paths are rejected on purpose: "photo.png" is ambiguous against a
 * bare job id, and resolving it against the server's cwd is never what the
 * caller means.
 */
export type ResolvedReference = {
  ref: InputReference;
  source: string;
  /** Encoded payload size in bytes, for the aggregate budget. Zero for an
   *  https:// reference, whose bytes never pass through this server. */
  bytes: number;
  /** Long edge actually sent, when we hold the pixels. Used to report shrinkage. */
  px?: number;
};

/** What the aggregate budget did, so the caller can be told rather than guess. */
export type ReferenceFitting = { downscaledTo: number; from: number } | null;

const isHttp = (s: string) => /^https?:\/\//i.test(s);
const isLocalPath = (s: string) => s.startsWith("file://") || isAbsolute(s);

/** `image://gen/<id>#2` or `<id>#2` → id + index. */
function parseHandle(spec: string): { id: string; index: number } | null {
  const [base, frag] = spec.trim().split("#", 2);
  if (!base) return null;
  const id = idFromHandle(base) ?? (/^[A-Za-z0-9-]{8,}$/.test(base) ? base : null);
  if (!id) return null;
  const index = frag ? Number.parseInt(frag, 10) : 0;
  return { id, index: Number.isFinite(index) && index >= 0 ? index : 0 };
}

/**
 * Normalize arbitrary image bytes into a data URL suitable for an outbound
 * reference. Unlike the display/inspect variants, these never travel inside a
 * tool result, so the ~150k host cap doesn't apply — the only budget is the
 * request body OpenRouter will accept.
 *
 * Originals pass through untouched when they're already small enough, which
 * preserves PNG alpha (it can carry real meaning for edit-style prompts).
 * Anything larger is downscaled to JPEG, where q90 rather than the q82 used
 * elsewhere: this image is an *input* to another generation, so artifacts
 * compound rather than merely being looked at.
 */
async function toReferenceDataUrl(
  bytes: Buffer,
  label: string,
  maxPx = REFERENCE_MAX_PX,
): Promise<{ url: string; bytes: number; px: number }> {
  let meta;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw new Error(`${label} is not a readable image.`);
  }

  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longEdge <= maxPx && bytes.length <= REFERENCE_MAX_BYTES && meta.format) {
    const format = meta.format === "jpg" ? "jpeg" : meta.format;
    return {
      url: `data:image/${format};base64,${bytes.toString("base64")}`,
      bytes: bytes.length,
      px: longEdge,
    };
  }

  const resized = await sharp(bytes)
    .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    url: `data:image/jpeg;base64,${resized.data.toString("base64")}`,
    bytes: resized.data.length,
    px: Math.max(resized.info.width, resized.info.height),
  };
}

async function resolveOne(spec: string, maxPx = REFERENCE_MAX_PX): Promise<ResolvedReference> {
  const trimmed = spec.trim();
  if (!trimmed) throw new Error("Empty reference.");

  // 1. HTTP(S) — OpenRouter fetches it itself; nothing for us to do, and none
  //    of its bytes count against our request-body budget.
  if (isHttp(trimmed)) {
    return { ref: { type: "image_url", image_url: { url: trimmed } }, source: trimmed, bytes: 0 };
  }

  // 2. Local file on the server's own filesystem.
  if (isLocalPath(trimmed)) {
    const path = trimmed.startsWith("file://") ? fileURLToPath(trimmed) : trimmed;
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      throw new Error(
        `Cannot read ${path}. The path must exist on the machine running the CinemAI server — ` +
          `if the server is running remotely, a local file path won't resolve there.`,
      );
    }
    const encoded = await toReferenceDataUrl(bytes, path, maxPx);
    return {
      ref: { type: "image_url", image_url: { url: encoded.url } },
      source: path,
      bytes: encoded.bytes,
      px: encoded.px,
    };
  }

  // 3. A previously generated image.
  const parsed = parseHandle(trimmed);
  if (!parsed) {
    throw new Error(
      `Unrecognized reference "${trimmed}". Use an image handle (image://gen/<id>), ` +
        `an https:// URL, or an absolute file path.`,
    );
  }

  const job = getJob(parsed.id);
  if (!job) throw new Error(`No such image: ${trimmed}`);
  if (job.status === "running") throw new Error(`${trimmed} is still generating; try again shortly.`);
  if (job.status === "failed") throw new Error(`${trimmed} failed to generate: ${job.error}`);

  // readVariant already caches, so reusing a reference across calls is cheap.
  const variant = await readVariant(job, parsed.index, maxPx);
  return {
    ref: {
      type: "image_url",
      image_url: { url: `data:${variant.mediaType};base64,${variant.buffer.toString("base64")}` },
    },
    source: `image://gen/${job.id}#${parsed.index}`,
    bytes: variant.buffer.length,
    px: Math.max(variant.width, variant.height),
  };
}

const totalBytes = (refs: ResolvedReference[]) => refs.reduce((n, r) => n + r.bytes, 0);

/**
 * Resolve every spec, or throw on the first failure. Called from the tool
 * handler before the job is created: a bad path should surface as an immediate
 * tool error the model can correct, not as a job that fails 30s later.
 *
 * The per-image limits are necessary but not sufficient. Several references that
 * each clear them can still add up to a body OpenRouter rejects — measured, three
 * 1254px PNGs at 1.66MB each pass individually and fail together with an opaque
 * `fetch failed`. So after resolving we check the COMBINED size and, if it's over,
 * re-encode everything at progressively smaller long edges until it fits.
 *
 * Shrinking is reported rather than silent: a reference feeds another generation,
 * so quietly halving one and letting the caller wonder why likeness drifted is a
 * worse outcome than saying what happened.
 */
export async function resolveReferences(
  specs: string[],
): Promise<{ refs: ResolvedReference[]; fitting: ReferenceFitting }> {
  const refs: ResolvedReference[] = [];
  for (const spec of specs) refs.push(await resolveOne(spec));

  if (totalBytes(refs) <= REFERENCE_TOTAL_MAX_BYTES) return { refs, fitting: null };

  // Halve the long edge until the whole set fits. Halving rather than computing a
  // target keeps this predictable and terminates quickly; images already smaller
  // than the current ceiling are untouched by `withoutEnlargement`.
  const startPx = Math.max(...refs.map((r) => r.px ?? 0), REFERENCE_MAX_PX);
  for (let maxPx = Math.floor(startPx / 2); maxPx >= REFERENCE_MIN_PX; maxPx = Math.floor(maxPx / 2)) {
    const attempt: ResolvedReference[] = [];
    for (const spec of specs) attempt.push(await resolveOne(spec, maxPx));
    if (totalBytes(attempt) <= REFERENCE_TOTAL_MAX_BYTES) {
      return { refs: attempt, fitting: { downscaledTo: maxPx, from: startPx } };
    }
  }

  throw new Error(
    `These ${specs.length} reference images are too large to send together: even at ` +
      `${REFERENCE_MIN_PX}px they exceed the ${Math.round(REFERENCE_TOTAL_MAX_BYTES / 1024 / 1024)}MB ` +
      `request budget. Use fewer references, or pass smaller files.`,
  );
}
