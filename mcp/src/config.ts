import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
};

/** Sizes, in px on the long edge, for the two downscaled variants we serve. */
export const DISPLAY_MAX_PX = 1024; // widget rendering
export const INSPECT_MAX_PX = 768; // view_image — keeps model context cheap
