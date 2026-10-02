import { createHash } from "node:crypto";

// SPEC.md §5: short hex (6-8 chars) of a SHA-256 over source bytes + recipe.
const HASH_LENGTH = 8;

/**
 * Hash input is source file bytes + the serialized encoding recipe (see
 * recipe.js — serializeImageRecipe or serializeVideoRecipe, whichever fits the
 * source). Not a hash of the derivative output — must be
 * computable before encoding so unchanged sources skip all encoding work.
 * Not a hash of source bytes alone — changing the recipe must shift every
 * hash so immutable URLs don't keep serving stale encodings.
 */
export function computeAssetHash(sourceBuffer, recipeString) {
  const digest = createHash("sha256")
    .update(sourceBuffer)
    .update(recipeString)
    .digest("hex");
  return digest.slice(0, HASH_LENGTH);
}
