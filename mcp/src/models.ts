import { config } from "./config.js";

const MODELS_URL = "https://openrouter.ai/api/v1/images/models";
const VIDEO_MODELS_URL = "https://openrouter.ai/api/v1/videos/models";

type EnumParam = { type: "enum"; values: string[] };
type RangeParam = { type: "range"; min: number; max: number };

export type ModelCaps = {
  id: string;
  name?: string;
  aspectRatios?: string[];
  maxN?: number;
  maxInputReferences?: number;
};

let cache: Map<string, ModelCaps> | null = null;
let inflight: Promise<Map<string, ModelCaps>> | null = null;

/**
 * Fetch and cache image-model capability descriptors. Used to validate requests
 * before spending a generation on a call the provider will reject — e.g. the
 * default model caps `n` at 1, so a request for 3 images fails upstream.
 *
 * Failures are non-fatal: if the endpoint is unreachable we simply skip
 * validation rather than blocking generation.
 */
export async function loadModelCaps(): Promise<Map<string, ModelCaps>> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const map = new Map<string, ModelCaps>();
    try {
      const res = await fetch(MODELS_URL, {
        headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: unknown[] };

      for (const raw of body.data ?? []) {
        const m = raw as {
          id?: string;
          name?: string;
          supported_parameters?: Record<string, EnumParam | RangeParam | undefined>;
        };
        if (!m.id) continue;
        const p = m.supported_parameters ?? {};
        const ar = p.aspect_ratio;
        const n = p.n;
        const refs = p.input_references;
        map.set(m.id, {
          id: m.id,
          name: m.name,
          aspectRatios: ar?.type === "enum" ? ar.values : undefined,
          maxN: n?.type === "range" ? n.max : undefined,
          maxInputReferences: refs?.type === "range" ? refs.max : undefined,
        });
      }
      console.error(`[models] cached capabilities for ${map.size} image model(s)`);
    } catch (err) {
      console.error(
        `[models] could not load capabilities (${err instanceof Error ? err.message : err}); ` +
          `validation disabled this session`,
      );
    }
    cache = map;
    return map;
  })();

  return inflight;
}

export type Validation = { ok: true } | { ok: false; message: string };

/** Validate a request against cached capabilities. Unknown model → allow. */
export async function validateRequest(params: {
  model: string;
  n?: number;
  aspect_ratio?: string;
  inputReferences?: number;
}): Promise<Validation> {
  const caps = (await loadModelCaps()).get(params.model);
  if (!caps) return { ok: true };

  // Reference support varies widely — some models take 16, others 4, others
  // none. As elsewhere here, an unreported capability means "skip the check"
  // rather than "unsupported": a false rejection would block a working call.
  if (
    params.inputReferences !== undefined &&
    params.inputReferences > 0 &&
    caps.maxInputReferences !== undefined &&
    params.inputReferences > caps.maxInputReferences
  ) {
    return {
      ok: false,
      message:
        caps.maxInputReferences === 0
          ? `${params.model} does not accept reference images. Omit input_references, or pick a model that supports image input.`
          : `${params.model} accepts at most ${caps.maxInputReferences} reference image(s); got ${params.inputReferences}.`,
    };
  }

  if (params.n !== undefined && caps.maxN !== undefined && params.n > caps.maxN) {
    return {
      ok: false,
      message:
        `${params.model} supports at most n=${caps.maxN} image(s) per request; got n=${params.n}. ` +
        (caps.maxN === 1 ? "Call generate_image multiple times for variations." : ""),
    };
  }

  if (
    params.aspect_ratio !== undefined &&
    caps.aspectRatios &&
    !caps.aspectRatios.includes(params.aspect_ratio)
  ) {
    return {
      ok: false,
      message:
        `${params.model} does not support aspect_ratio "${params.aspect_ratio}". ` +
        `Supported: ${caps.aspectRatios.join(", ")}.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------- video models

/**
 * Video capabilities as the endpoint actually reports them. Every field is
 * nullable upstream, and `null` means "unspecified" rather than "unsupported" —
 * so an absent value skips its check rather than rejecting the request.
 */
export type VideoModelCaps = {
  id: string;
  name?: string;
  /** Discrete enumerated values the model accepts. */
  resolutions?: string[];
  aspectRatios?: string[];
  durations?: number[];
  /** Which ends of the clip can be pinned, e.g. ["first_frame","last_frame"].
   *  Absent (null upstream) means the model takes no frame images at all. */
  frameImages?: string[];
  /** Explicit false means the parameter is rejected; undefined means unknown. */
  supportsAudio?: boolean;
  supportsSeed?: boolean;
};

let videoCache: Map<string, VideoModelCaps> | null = null;
let videoInflight: Promise<Map<string, VideoModelCaps>> | null = null;

/**
 * Fetch and cache video-model capability descriptors from the videos endpoint,
 * which reports a different shape than the image one (discrete resolutions and
 * durations rather than n/reference ranges). Same fail-open policy: an
 * unreachable endpoint disables validation rather than blocking generation.
 */
export async function loadVideoModelCaps(): Promise<Map<string, VideoModelCaps>> {
  if (videoCache) return videoCache;
  if (videoInflight) return videoInflight;

  videoInflight = (async () => {
    const map = new Map<string, VideoModelCaps>();
    try {
      const res = await fetch(VIDEO_MODELS_URL, {
        headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: unknown[] };

      // Upstream uses null for "unspecified"; normalize that to undefined so
      // every check below can treat undefined as "don't validate".
      const asEnum = (v: unknown): string[] | undefined =>
        Array.isArray(v) && v.length ? v.map(String) : undefined;
      const asNums = (v: unknown): number[] | undefined =>
        Array.isArray(v) && v.length
          ? v.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
          : undefined;
      const asBool = (v: unknown): boolean | undefined =>
        typeof v === "boolean" ? v : undefined;

      for (const raw of body.data ?? []) {
        const m = raw as Record<string, unknown>;
        const id = typeof m.id === "string" ? m.id : undefined;
        if (!id) continue;
        map.set(id, {
          id,
          name: typeof m.name === "string" ? m.name : undefined,
          resolutions: asEnum(m.supported_resolutions),
          aspectRatios: asEnum(m.supported_aspect_ratios),
          durations: asNums(m.supported_durations),
          frameImages: asEnum(m.supported_frame_images),
          supportsAudio: asBool(m.generate_audio),
          supportsSeed: asBool(m.seed),
        });
      }
      console.error(`[models] cached capabilities for ${map.size} video model(s)`);
    } catch (err) {
      console.error(
        `[models] could not load video capabilities (${err instanceof Error ? err.message : err}); ` +
          `validation disabled this session`,
      );
    }
    videoCache = map;
    return map;
  })();

  return videoInflight;
}

/** Validate a video request against cached capabilities. Unknown model → allow. */
export async function validateVideoRequest(params: {
  model: string;
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  /** How many frame/reference images the caller supplied. */
  frameImages?: number;
  /** Which end of the clip they pin, when frameImages > 0. */
  frameType?: string;
  generate_audio?: boolean;
  seed?: number;
}): Promise<Validation> {
  const caps = (await loadVideoModelCaps()).get(params.model);
  if (!caps) return { ok: true };

  if (
    params.resolution !== undefined &&
    caps.resolutions?.length &&
    !caps.resolutions.includes(params.resolution)
  ) {
    return {
      ok: false,
      message:
        `${params.model} does not support resolution "${params.resolution}". ` +
        `Supported: ${caps.resolutions.join(", ")}.`,
    };
  }

  if (
    params.aspect_ratio !== undefined &&
    caps.aspectRatios?.length &&
    !caps.aspectRatios.includes(params.aspect_ratio)
  ) {
    return {
      ok: false,
      message:
        `${params.model} does not support aspect_ratio "${params.aspect_ratio}". ` +
        `Supported: ${caps.aspectRatios.join(", ")}.`,
    };
  }

  if (
    params.duration !== undefined &&
    caps.durations?.length &&
    !caps.durations.includes(params.duration)
  ) {
    return {
      ok: false,
      message:
        `${params.model} does not support duration ${params.duration}s. ` +
        `Supported: ${caps.durations.join(", ")}s.`,
    };
  }

  if (params.frameImages !== undefined && params.frameImages > 0) {
    // `supported_frame_images` absent entirely means the model is text-only
    // (e.g. sora-2-pro); a present list names which ends can be pinned.
    if (!caps.frameImages) {
      return {
        ok: false,
        message:
          `${params.model} does not accept reference images — it generates from text only. ` +
          `Omit input_references, or pick an image-to-video model such as google/veo-3.1 or bytedance/seedance-2.0.`,
      };
    }
    if (params.frameType && !caps.frameImages.includes(params.frameType)) {
      return {
        ok: false,
        message:
          `${params.model} does not support "${params.frameType}". ` +
          `Supported: ${caps.frameImages.join(", ")}.`,
      };
    }
  }

  if (params.generate_audio === true && caps.supportsAudio === false) {
    return {
      ok: false,
      message: `${params.model} cannot generate audio. Omit generate_audio, or pick a model that supports it.`,
    };
  }

  if (params.seed !== undefined && caps.supportsSeed === false) {
    return {
      ok: false,
      message: `${params.model} does not support seeded generation. Omit seed.`,
    };
  }

  return { ok: true };
}
