import { config } from "./config.js";
import type { InputReference } from "./openrouter.js";

const BASE = "https://openrouter.ai/api/v1/videos";

/**
 * A frame image for image-to-video: the same `image_url` shape references.ts
 * already produces, plus which end of the clip it anchors.
 */
export type FrameImage = InputReference & { frame_type: "first_frame" | "last_frame" };

export type VideoGenerateParams = {
  prompt: string;
  model?: string;
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
  seed?: number;
  generate_audio?: boolean;
  /** Reference-to-video: guide the generation from images without pinning a frame. */
  input_references?: InputReference[];
  /** Image-to-video: pin the first (and/or last) frame of the clip. */
  frame_images?: FrameImage[];
};

/** The subset of the upstream job record we care about. */
export type VideoJob = {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  /** Present on completion — direct download links for each output. */
  unsigned_urls?: string[];
  generation_id?: string;
  usage?: { cost?: number };
  error?: string;
};

const headers = () => ({
  Authorization: `Bearer ${config.openrouterApiKey}`,
  "HTTP-Referer": "https://github.com/cinemai/mcp",
  "X-Title": "CinemAI MCP",
});

/**
 * Submit a video job. Unlike the image endpoint this returns immediately with an
 * upstream job id (generation is async, 30s–several minutes); the caller must
 * poll {@link pollVideo} until a terminal status. Returns the upstream job id and
 * its polling URL.
 */
export async function submitVideo(
  params: VideoGenerateParams,
  signal?: AbortSignal,
): Promise<{ id: string; pollingUrl: string; status: VideoJob["status"] }> {
  const model = params.model ?? config.defaultVideoModel;

  const body: Record<string, unknown> = { model, prompt: params.prompt };
  if (params.duration !== undefined) body.duration = params.duration;
  if (params.resolution !== undefined) body.resolution = params.resolution;
  if (params.aspect_ratio !== undefined) body.aspect_ratio = params.aspect_ratio;
  if (params.seed !== undefined) body.seed = params.seed;
  if (params.generate_audio !== undefined) body.generate_audio = params.generate_audio;
  if (params.frame_images?.length) body.frame_images = params.frame_images;
  if (params.input_references?.length) body.input_references = params.input_references;

  const res = await fetch(BASE, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  let json: { id?: string; polling_url?: string; status?: VideoJob["status"]; error?: { message?: string } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenRouter returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || json.error || !json.id) {
    throw new Error(
      `OpenRouter video error (HTTP ${res.status}): ${json.error?.message ?? text.slice(0, 300)}`,
    );
  }

  // polling_url may be absolute or root-relative; normalize to absolute.
  const raw = json.polling_url ?? `${BASE}/${json.id}`;
  const pollingUrl = raw.startsWith("http") ? raw : new URL(raw, "https://openrouter.ai").href;
  return { id: json.id, pollingUrl, status: json.status ?? "pending" };
}

/** Poll one video job for its current status. */
export async function pollVideo(pollingUrl: string, signal?: AbortSignal): Promise<VideoJob> {
  const res = await fetch(pollingUrl, { headers: headers(), signal });
  const text = await res.text();
  // Typed loosely on the way in: `error` arrives as a bare string from some
  // providers and as an object from others, so it's normalized below.
  let json: Omit<VideoJob, "error"> & { error?: string | { message?: string } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenRouter returned non-JSON while polling (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok && !json.status) {
    throw new Error(`OpenRouter poll error (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const error = typeof json.error === "string" ? json.error : json.error?.message;
  return { ...json, error };
}

/**
 * Download the finished video's raw bytes. The content endpoint returns the MP4
 * itself (Content-Type video/mp4) and still requires the auth header even though
 * the URL is "unsigned".
 */
export async function downloadVideoBytes(
  url: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; mediaType: string }> {
  const absolute = url.startsWith("http") ? url : new URL(url, "https://openrouter.ai").href;
  const res = await fetch(absolute, { headers: headers(), redirect: "follow", signal });
  if (!res.ok) {
    throw new Error(`Could not download video (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const mediaType = res.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, mediaType };
}
