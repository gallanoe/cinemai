import { config } from "./config.js";

const MODELS_URL = "https://openrouter.ai/api/v1/images/models";

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
