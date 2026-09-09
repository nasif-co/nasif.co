import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RECIPE_VERSION } from "./recipe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST_PATH = path.resolve(__dirname, "../../assets-manifest.json");

export function emptyManifest() {
  return { version: 1, recipeVersion: RECIPE_VERSION, images: {}, videos: {} };
}

export async function readManifest() {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return emptyManifest();
    throw err;
  }
}

export async function writeManifest(manifest) {
  // Fixed key order, matching SPEC.md §4 — keeps commit diffs readable.
  const toWrite = {
    version: manifest.version ?? 1,
    recipeVersion: RECIPE_VERSION,
    images: manifest.images ?? {},
    videos: manifest.videos ?? {},
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(toWrite, null, 2) + "\n", "utf8");
}
