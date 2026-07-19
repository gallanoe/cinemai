import { config } from "./config.js";

const ENDPOINT = "https://openrouter.ai/api/v1/images";

export type GenerateParams = {
  prompt: string;
  model?: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  seed?: number;
};

export type GeneratedImage = { bytes: Buffer; mediaType: string };

export type GenerateResult = {
  images: GeneratedImage[];
  model: string;
  cost?: number;
};

type ImagesResponse = {
  created?: number;
  data?: { b64_json?: string; media_type?: string }[];
  usage?: { cost?: number };
  error?: { message?: string };
};

/**
 * POST /api/v1/images. This is synchronous upstream — it blocks for the full
 * generation (10-90s depending on model). Callers must not await it inside a
 * tool handler; see jobs.ts.
 */
export async function generateImages(
  params: GenerateParams,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const model = params.model ?? config.defaultModel;

  const body: Record<string, unknown> = { model, prompt: params.prompt };
  if (params.n !== undefined) body.n = params.n;
  if (params.size !== undefined) body.size = params.size;
  if (params.aspect_ratio !== undefined) body.aspect_ratio = params.aspect_ratio;
  if (params.seed !== undefined) body.seed = params.seed;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/cinemai/mcp",
      "X-Title": "CinemAI MCP",
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  let json: ImagesResponse;
  try {
    json = JSON.parse(text) as ImagesResponse;
  } catch {
    throw new Error(`OpenRouter returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok || json.error) {
    throw new Error(
      `OpenRouter error (HTTP ${res.status}): ${json.error?.message ?? text.slice(0, 300)}`,
    );
  }

  const data = json.data ?? [];
  if (data.length === 0) throw new Error("OpenRouter returned no images.");

  const images: GeneratedImage[] = [];
  for (const item of data) {
    if (!item.b64_json) continue;
    images.push({
      bytes: Buffer.from(item.b64_json, "base64"),
      mediaType: item.media_type ?? "image/png",
    });
  }
  if (images.length === 0) throw new Error("OpenRouter response contained no image data.");

  return { images, model, cost: json.usage?.cost };
}
