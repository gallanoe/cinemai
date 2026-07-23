import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

/** Package root — dist/config.js lives one level down, so go up one. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail loudly at boot rather than surfacing as a 401 mid-generation.
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in.\n` +
        `Note: the env block in claude_desktop_config.json applies to mcp-remote, not to this server.`,
    );
  }
  return value;
}

export const config = {
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  port: Number(process.env.PORT ?? 3000),
  defaultModel: process.env.CINEMAI_DEFAULT_MODEL ?? "google/gemini-2.5-flash-image",
  dataDir: resolve(ROOT, process.env.CINEMAI_DATA_DIR ?? "./data"),
  widgetsDir: resolve(ROOT, "widgets"),
  // Where save_image lands files. The default is Cowork's hardcoded working
  // directory on macOS — the highest-probability folder that's mounted into a
  // sandboxed agent's workspace. When the server runs on the host and the agent
  // in a VM, a file written here surfaces in the agent's mounted tree; there is
  // no reliable way to compute the agent-side path, so the tool reports this
  // host path and the basename and lets the agent find it by name.
  exportDir: resolve(process.env.CINEMAI_EXPORT_DIR ?? resolve(homedir(), "Documents", "Claude")),
};

/** Sizes, in px on the long edge, for the two downscaled variants we serve. */
export const DISPLAY_MAX_PX = 1024; // widget rendering
export const INSPECT_MAX_PX = 768; // view_image — keeps model context cheap

/**
 * Ceiling for outbound reference images. These go into the OpenRouter request
 * body rather than a tool result, so the ~150k host cap is irrelevant; the
 * limit exists to keep request bodies sane. Larger than the display variants
 * because a reference feeds a generation instead of just being displayed.
 */
export const REFERENCE_MAX_PX = 2048;
export const REFERENCE_MAX_BYTES = 4 * 1024 * 1024;
