/**
 * Verification step 1: hit OpenRouter directly and write a PNG to disk.
 * Confirms auth, model slug, and response shape before any MCP is involved.
 *
 *   npm run build && npm run smoke -- "a red bicycle"
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config.js";
import { generateImages } from "../openrouter.js";

const prompt = process.argv.slice(2).join(" ") || "a cinematic still of a lighthouse at dusk";

const started = Date.now();
console.log(`model:  ${config.defaultModel}`);
console.log(`prompt: ${prompt}`);
console.log("generating...");

const result = await generateImages({ prompt });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const outDir = resolve(config.dataDir, "smoke");
await mkdir(outDir, { recursive: true });

for (const [i, img] of result.images.entries()) {
  const ext = img.mediaType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const path = resolve(outDir, `smoke-${i}.${ext}`);
  await writeFile(path, img.bytes);
  console.log(`  wrote ${path} (${(img.bytes.length / 1024).toFixed(0)} KB, ${img.mediaType})`);
}

console.log(`done in ${elapsed}s${result.cost !== undefined ? `, cost $${result.cost}` : ""}`);
console.log(`\nNote: ${(result.images[0]!.bytes.length / 1024).toFixed(0)} KB as base64 is ~${
  Math.round((result.images[0]!.bytes.length * 1.37) / 1000)
}k chars — vs the ~150k host cap. This is why bytes never go in a tool result.`);
